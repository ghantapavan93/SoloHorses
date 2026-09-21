import { Injectable } from '@nestjs/common';
import { createHash } from 'node:crypto';
import {
  addDays,
  barnClock,
  barnDate,
  barnLocalToUtc,
  can,
  evaluateDeparture,
  gestationDay,
  isCollectionDay,
  nextCollectionDay,
  settlementDueOn,
  type Actor,
  type BarnDate,
  type ClearanceRecord,
} from '@daysheet/domain';
import type { Prisma } from '@daysheet/db';
import { ClockService } from '../../../platform/clock/clock.service';
import { PrismaService } from '../../../platform/persistence/prisma.service';
import { EXCEPTIONS } from '../domain/exceptions';
import {
  baselineFor,
  breakdown,
  groupChanges,
  lookaheadDays,
  mine,
  rankForReader,
  sortLookahead,
  stateIdOf,
  urgencyOf,
  promptsFor,
  type ChangeGroup,
  type LookaheadItem,
  type MorningDecision,
  type NeedsYouRow,
  type SnapshotPoint,
} from '../domain/brief';
import { ExceptionsService } from './exceptions.service';

export type SnapshotTrigger = 'sweep' | 'boot';

export interface Brief {
  asOf: string;
  barnDate: BarnDate;
  demoClock: boolean;
  open: number;
  atStakeCents: number;
  withStake: number;
  bySource: Record<string, number>;
  bySeverity: Record<string, number>;
  /** The instant "since yesterday" counts from: the baseline snapshot, or 24 hours ago when there is none yet. */
  since: string;
  baseline: SnapshotPoint | null;
  sinceYesterday: {
    raised: NeedsYouRow[];
    resolved: {
      id: string;
      kind: string;
      label: string;
      title: string;
      status: string;
      resolvedAt: string | null;
      resolution: string | null;
      resolvedBy: string | null;
    }[];
    changes: ChangeGroup[];
  };
  /** Who is reading, and how many of the open rows are theirs to take the next step on. */
  viewer: { role: string; forYou: number };
  needsYou: NeedsYouRow[];
  lookahead: LookaheadItem[];
  series: SnapshotPoint[];
}

/**
 * The front door's five seconds: how many decisions wait, how many are the reader's, what
 * moved since yesterday, the dollars held up (each obligation once), and the three to open
 * first. Every number is read from the board now; the LLM never computes any of it.
 */
export interface MorningBrief {
  generatedAt: string;
  barnDate: BarnDate;
  /** The same open rows in the same states give the same id. */
  stateId: string;
  /** The recorded snapshot "since yesterday" counts from; null on the first day. */
  snapshotId: string | null;
  since: string;
  decisions: number;
  needsYou: number;
  changed: { raised: number; resolved: number };
  /** Each obligation once: papers held on an invoice and a conflict about the same invoice are one figure. */
  atStakeCents: number;
  byOwner: Record<string, number>;
  byChannel: Record<string, number>;
  viewer: { role: string };
  top: MorningDecision[];
  /** Three questions worth asking this morning, chosen from the board — the entry line's chips. */
  prompts: string[];
}

/** Two weeks of hourly points is as far back as the sparkline looks. */
const SERIES_POINTS = 24 * 14;

/**
 * The morning brief: what needs a person first, what changed since yesterday, and what the
 * next two days hold. Every number is read from the tables now; "yesterday" is a snapshot
 * this service wrote, so the comparison is against a recorded state. The lookahead is the
 * rules' own view of what is coming (the departure rule, the milestone days, the settlement
 * due date), not a forecast.
 */
@Injectable()
export class BriefService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly clock: ClockService,
    private readonly exceptions: ExceptionsService,
  ) {}

  private get db() {
    return this.prisma.client;
  }

  /** One row per barn hour; the same hour taken again refreshes it. */
  snapshotId(now = this.clock.now()): string {
    const { date, hour } = barnClock(now);
    return `brief_${date}_${String(hour).padStart(2, '0')}`;
  }

  async snapshot(trigger: SnapshotTrigger): Promise<{ id: string; open: number; atStakeCents: number }> {
    const now = this.clock.now();
    const [summary, openRows] = await Promise.all([
      this.exceptions.summary(),
      this.db.operationalException.findMany({ where: { openKey: { not: null } }, select: { id: true } }),
    ]);
    const id = this.snapshotId(now);
    const fields = {
      takenAt: now,
      barnDate: barnClock(now).date,
      trigger,
      open: summary.open,
      atStakeCents: summary.atStakeCents,
      withStake: summary.withStake,
      bySource: summary.bySource as Prisma.InputJsonValue,
      bySeverity: summary.bySeverity as Prisma.InputJsonValue,
      openIds: openRows.map((r) => r.id) as Prisma.InputJsonValue,
    };
    await this.db.briefSnapshot.upsert({ where: { id }, create: { id, ...fields }, update: fields });
    return { id, open: summary.open, atStakeCents: summary.atStakeCents };
  }

  async morning(actor: Actor): Promise<MorningBrief> {
    const now = this.clock.now();
    const todayStart = barnLocalToUtc(barnDate(now), 0);
    const recent = await this.db.briefSnapshot.findMany({
      orderBy: { takenAt: 'desc' },
      take: SERIES_POINTS,
      select: { id: true, takenAt: true, open: true, atStakeCents: true },
    });
    const baseline = baselineFor(
      recent
        .reverse()
        .map((p) => ({ id: p.id, takenAt: p.takenAt.toISOString(), open: p.open, atStakeCents: p.atStakeCents })),
      todayStart.toISOString(),
    );
    const since = baseline ? new Date(baseline.takenAt) : new Date(now.getTime() - 24 * 3_600_000);
    const [summary, resolved] = await Promise.all([
      this.exceptions.summary(),
      this.db.operationalException.count({ where: { resolvedAt: { gte: since } } }),
    ]);
    // Every open row, so the split by owner adds up to the board's own count.
    const signals = await this.exceptions.signals(Math.max(200, summary.open));
    const rows = signals.map((s) => ({ ...s, stakeCents: s.stake?.amountCents ?? null }));
    const sinceIso = since.toISOString();
    return {
      generatedAt: now.toISOString(),
      barnDate: this.clock.today(),
      stateId: stateIdOf(rows, (text) => createHash('sha1').update(text).digest('hex')),
      snapshotId: baseline?.id ?? null,
      since: sinceIso,
      decisions: summary.open,
      needsYou: mine(rows, actor.role).length,
      changed: { raised: rows.filter((r) => r.createdAt >= sinceIso).length, resolved },
      atStakeCents: summary.atStakeCents,
      ...breakdown(rows),
      viewer: { role: actor.role },
      prompts: promptsFor(rows, actor.role, rows.filter((r) => r.createdAt >= sinceIso).length + resolved),
      top: rankForReader(rows, actor.role, 3).map((s) => ({
        id: s.id,
        label: s.label,
        title: s.title,
        reason: s.meaning,
        urgency: urgencyOf(s.severity),
        owner: s.owner,
        ownerName: s.ownerName,
        evidence: s.evidence,
        stakeCents: s.stakeCents,
        stakeLabel: s.stake?.label ?? null,
        next: s.next,
        surface: s.surface,
        entityId: s.entityId,
        createdAt: s.createdAt,
      })),
    };
  }

  async build(actor: Actor): Promise<Brief> {
    const now = this.clock.now();
    // The board's rows carry real instants, so "yesterday" is the real calendar's, even when the barn date is frozen for the demo.
    const todayStart = barnLocalToUtc(barnDate(now), 0);
    const recent = await this.db.briefSnapshot.findMany({
      orderBy: { takenAt: 'desc' },
      take: SERIES_POINTS,
      select: { id: true, takenAt: true, open: true, atStakeCents: true },
    });
    const series: SnapshotPoint[] = recent
      .reverse()
      .map((p) => ({ id: p.id, takenAt: p.takenAt.toISOString(), open: p.open, atStakeCents: p.atStakeCents }));
    const baseline = baselineFor(series, todayStart.toISOString());
    const since = baseline ? new Date(baseline.takenAt) : new Date(now.getTime() - 24 * 3_600_000);

    const [signals, summary, resolvedRows, trail, lookahead] = await Promise.all([
      this.exceptions.signals(60),
      this.exceptions.summary(),
      this.db.operationalException.findMany({
        where: { resolvedAt: { gte: since } },
        orderBy: { resolvedAt: 'desc' },
        take: 20,
        include: { resolvedBy: { select: { name: true } } },
      }),
      // The seed's rows are the world's backfill, not something that happened since yesterday.
      this.db.auditEvent.findMany({
        where: { at: { gte: since }, source: { not: 'SEED' } },
        select: { action: true, at: true },
        orderBy: { at: 'desc' },
        take: 2_000,
      }),
      this.lookahead(actor),
    ]);

    const rows: NeedsYouRow[] = signals.map((s) => ({
      id: s.id,
      kind: s.kind,
      label: s.label,
      title: s.title,
      severity: s.severity,
      source: s.source,
      entityId: s.entityId,
      stakeCents: s.stake?.amountCents ?? null,
      stakeLabel: s.stake?.label ?? null,
      owner: s.owner,
      next: s.next,
      surface: s.surface,
      createdAt: s.createdAt,
    }));
    const sinceIso = since.toISOString();
    const raised = rows.filter((r) => r.createdAt >= sinceIso).sort((a, b) => b.createdAt.localeCompare(a.createdAt));

    return {
      asOf: now.toISOString(),
      barnDate: this.clock.today(),
      demoClock: this.clock.isFrozen(),
      open: summary.open,
      atStakeCents: summary.atStakeCents,
      withStake: summary.withStake,
      bySource: summary.bySource,
      bySeverity: summary.bySeverity,
      since: sinceIso,
      baseline,
      sinceYesterday: {
        raised,
        resolved: resolvedRows.map((x) => ({
          id: x.id,
          kind: x.kind,
          label: EXCEPTIONS[x.kind].label,
          title: x.title,
          status: x.status,
          resolvedAt: x.resolvedAt?.toISOString() ?? null,
          resolution: x.resolution,
          resolvedBy: x.resolvedBy?.name ?? null,
        })),
        changes: groupChanges(trail.map((e) => ({ action: e.action, at: e.at.toISOString() }))),
      },
      viewer: { role: actor.role, forYou: mine(rows, actor.role).length },
      needsYou: rankForReader(rows, actor.role, 5),
      lookahead,
      series,
    };
  }

  /**
   * Today and tomorrow, as the rules see them: a mare leaving (the departure rule's verdict),
   * an embryo arriving (with or without a recip set aside), a pregnancy crossing a billing
   * milestone, a lab result expected, an invoice or a settlement falling due, a collection day.
   * Dollar items appear only for a role that may read invoices.
   */
  private async lookahead(actor: Actor): Promise<LookaheadItem[]> {
    const today = this.clock.today();
    const days = lookaheadDays(today);
    const first = days[0] ?? today;
    const last = days[days.length - 1] ?? today;
    // Date-only columns are stored at a fixed UTC hour; instants (an embryo "by 1 PM") are barn-local.
    const dateWindow = { gte: new Date(`${first}T00:00:00.000Z`), lt: new Date(`${addDays(last, 1)}T00:00:00.000Z`) };
    const instantWindow = { gte: barnLocalToUtc(first, 0), lt: barnLocalToUtc(addDays(last, 1), 0) };
    const showMoney = can(actor, 'read', 'invoice');
    const dateOf = (value: Date) => value.toISOString().slice(0, 10);

    const [recips, embryos, transfers, batches, invoices, lots] = await Promise.all([
      this.db.horse.findMany({
        where: { kind: 'RECIPIENT', scheduledDepartureOn: dateWindow },
        include: {
          clearances: { where: { kind: 'VIDEO_IN_FOAL' }, orderBy: [{ performedOn: 'desc' }, { createdAt: 'desc' }] },
        },
      }),
      this.db.embryo.findMany({
        where: { expectedOn: instantWindow, status: { in: ['EXPECTED', 'IN_TRANSIT'] } },
        select: { id: true, expectedOn: true, plannedRecipientId: true },
      }),
      this.db.transfer.findMany({
        where: { embryo: { status: { in: ['TRANSFERRED', 'PREGNANT'] } } },
        select: { embryoId: true, recipientId: true, performedOn: true },
      }),
      this.db.labBatch.findMany({
        where: { expectedResultOn: dateWindow, resultReceivedOn: null },
        select: { id: true, expectedResultOn: true },
      }),
      showMoney
        ? this.db.invoice.findMany({
            where: { dueOn: dateWindow, status: 'OPEN', lot: null },
            select: { id: true, dueOn: true, amountCents: true, description: true },
          })
        : Promise.resolve([]),
      this.db.saleLot.findMany({
        where: { invoice: { status: 'OPEN' } },
        select: { id: true, closedOn: true, invoice: { select: { amountCents: true } } },
      }),
    ]);

    const items: LookaheadItem[] = [];
    for (const recip of recips) {
      if (!recip.scheduledDepartureOn) continue;
      const on = dateOf(recip.scheduledDepartureOn);
      const clearances: ClearanceRecord[] = recip.clearances.map((c) => ({
        id: c.id,
        kind: c.kind,
        result: c.result,
        performedOn: dateOf(c.performedOn),
        expiresOn: c.expiresOn ? dateOf(c.expiresOn) : null,
      }));
      const verdict = evaluateDeparture({ id: recip.id, scheduledDepartureOn: on, clearances }, today);
      items.push({
        on,
        kind: 'departure',
        label: `${recip.id} (Recip #${recip.recipNumber ?? '?'}) leaves`,
        entityId: recip.id,
        state: verdict.ok ? 'ready' : 'blocked',
        note: verdict.ok ? 'video-confirmed in foal' : verdict.reason,
      });
    }
    for (const embryo of embryos) {
      if (!embryo.expectedOn) continue;
      items.push({
        on: barnDate(embryo.expectedOn),
        kind: 'embryo_expected',
        label: `${embryo.id} arrives`,
        entityId: embryo.id,
        state: embryo.plannedRecipientId ? 'ready' : 'blocked',
        note: embryo.plannedRecipientId ? `into ${embryo.plannedRecipientId}` : 'no recip set aside',
      });
    }
    for (const transfer of transfers) {
      const transferOn = dateOf(transfer.performedOn);
      for (const on of days) {
        const day = gestationDay(transferOn, on);
        const note =
          day === 24
            ? 'heartbeat check · lease fee invoices on heartbeat'
            : day === 45
              ? 'day 45 check · ICSI stallion fee window'
              : day === 55
                ? 'day 55 check · confirms the purchase'
                : null;
        if (note)
          items.push({
            on,
            kind: 'milestone',
            label: `${transfer.embryoId} in ${transfer.recipientId} · day ${day}`,
            entityId: transfer.embryoId,
            state: 'due',
            note,
          });
      }
    }
    for (const batch of batches)
      items.push({
        on: dateOf(batch.expectedResultOn),
        kind: 'lab_result',
        label: `${batch.id} result`,
        entityId: batch.id,
        state: 'watch',
        note: 'ICSI lab result expected',
      });
    for (const invoice of invoices)
      items.push({
        on: dateOf(invoice.dueOn),
        kind: 'invoice_due',
        label: `${invoice.id} due`,
        entityId: invoice.id,
        state: 'due',
        note: invoice.description,
        amountCents: invoice.amountCents,
      });
    for (const lot of lots) {
      const due = settlementDueOn(dateOf(lot.closedOn));
      if (!days.includes(due)) continue;
      items.push({
        on: due,
        kind: 'settlement_due',
        label: `${lot.id} settlement due`,
        entityId: lot.id,
        state: 'due',
        note: 'papers wait for cleared funds',
        ...(showMoney && lot.invoice ? { amountCents: lot.invoice.amountCents } : {}),
      });
    }
    const collectionDay = isCollectionDay(today) ? today : nextCollectionDay(today);
    if (collectionDay && days.includes(collectionDay)) {
      items.push({
        on: collectionDay,
        kind: 'collection',
        label: 'Collection day',
        entityId: null,
        state: 'watch',
        note:
          collectionDay === today
            ? 'orders ship today; holds are on the Day Sheet'
            : 'orders ship tomorrow; the 5 PM cutoff is today',
      });
    }
    return sortLookahead(items);
  }
}
