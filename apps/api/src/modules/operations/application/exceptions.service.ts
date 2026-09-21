import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { can, stakeFor, sumStakes, type Actor, type Stake, type StakeLookups } from '@daysheet/domain';
import type { ExceptionKind, ExceptionStatus, Prisma } from '@daysheet/db';
import { AuditService } from '../../../platform/audit/audit.service';
import { ClockService } from '../../../platform/clock/clock.service';
import { CodesService } from '../../../platform/codes/codes.service';
import { currentCorrelationId } from '../../../platform/observability/correlation';
import { PlatformBus } from '../../../platform/observability/platform-bus';
import { PrismaService } from '../../../platform/persistence/prisma.service';
import { JobsService } from '../../../platform/queue/jobs.service';
import { EXCEPTIONS, type RaiseExceptionInput } from '../domain/exceptions';
import { explain } from '../domain/explain';
import { signalMap, type SignalMap } from '../domain/map';
import { RING_CHANNELS, RING_PREFERENCE, SIGNAL_SHAPES, type SignalChannel } from '../domain/signals';

export interface Signal {
  id: string;
  kind: string;
  label: string;
  severity: string;
  source: string;
  status: string;
  channel: SignalChannel;
  channelLabel: string;
  entityType: string | null;
  entityId: string | null;
  title: string;
  /** The two or three facts that say where it stands, from the same template the board shows. */
  state: { key: string; value: string }[];
  meaning: string;
  /** The dollars this row holds up, read from the records now — or null where no money waits. */
  stake: Stake | null;
  next: string;
  owner: string;
  ownerName: string | null;
  surface: string;
  correlationId: string | null;
  createdAt: string;
  /** How many facts from the records the full explanation lays out (the ring shows three). */
  evidence: number;
  /** For a sale signal: the lot, so the page can open the right one. */
  lotId: string | null;
  /** Why this one, laid out: only on a signal's own address. */
  map?: SignalMap;
}

/**
 * The exception aggregate. Raising is idempotent on the dedupe key while the exception is
 * open; resolution by a person is audited; resolution by the system says why.
 */
@Injectable()
export class ExceptionsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly codes: CodesService,
    private readonly clock: ClockService,
    private readonly jobs: JobsService,
    private readonly bus: PlatformBus,
  ) {}

  private get db() {
    return this.prisma.client;
  }

  /** Raises once per open dedupe key. Returns the open row either way. Safe inside a consumer transaction. */
  async raise(input: RaiseExceptionInput, tx?: Prisma.TransactionClient): Promise<{ id: string; created: boolean }> {
    const client = tx ?? this.db;
    const open = await client.operationalException.findUnique({ where: { openKey: input.dedupeKey } });
    if (open) {
      // The same condition, seen again: refresh what we know, do not raise twice.
      await client.operationalException.update({
        where: { id: open.id },
        data: { detail: (input.detail ?? open.detail ?? undefined) as Prisma.InputJsonValue, title: input.title },
      });
      return { id: open.id, created: false };
    }
    const definition = EXCEPTIONS[input.kind];
    const id = await this.codes.next('exception', Number(this.clock.today().slice(0, 4)), tx);
    try {
      await client.operationalException.create({
        data: {
          id,
          kind: input.kind,
          severity: input.severity ?? definition.severity,
          source: input.source ?? definition.source,
          title: input.title,
          detail: (input.detail ?? undefined) as Prisma.InputJsonValue | undefined,
          entityType: input.entityType ?? null,
          entityId: input.entityId ?? null,
          dedupeKey: input.dedupeKey,
          openKey: input.dedupeKey,
          correlationId: input.correlationId === undefined ? currentCorrelationId() : input.correlationId,
        },
      });
    } catch (error) {
      // Two detectors saw the same condition at the same moment; the unique open key decides, not the race.
      if (isUniqueViolation(error)) {
        const winner = await client.operationalException.findUniqueOrThrow({ where: { openKey: input.dedupeKey } });
        return { id: winner.id, created: false };
      }
      throw error;
    }
    await this.audit.record(
      {
        actor: null,
        source: 'JOB',
        action: 'exception.raised',
        entityType: 'OperationalException',
        entityId: id,
        after: { kind: input.kind, dedupeKey: input.dedupeKey, entityType: input.entityType, entityId: input.entityId },
      },
      tx,
    );
    this.bus.emit({ kind: 'exception', exceptionId: id, status: 'opened', title: input.title, kindName: input.kind });
    return { id, created: true };
  }

  /** The system noticed the condition cleared. No person involved; the resolution says what happened. */
  async resolveByKey(dedupeKey: string, resolution: string, tx?: Prisma.TransactionClient): Promise<boolean> {
    const client = tx ?? this.db;
    const open = await client.operationalException.findUnique({ where: { openKey: dedupeKey } });
    if (!open) return false;
    await client.operationalException.update({
      where: { id: open.id },
      data: { status: 'RESOLVED', openKey: null, resolution, resolvedAt: new Date() },
    });
    await this.audit.record(
      {
        actor: null,
        source: 'JOB',
        action: 'exception.resolved',
        entityType: 'OperationalException',
        entityId: open.id,
        after: { resolution, automatic: true },
      },
      tx,
    );
    this.bus.emit({
      kind: 'exception',
      exceptionId: open.id,
      status: 'resolved',
      title: open.title,
      kindName: open.kind,
    });
    return true;
  }

  /** Resolves every open exception of the given kinds whose key is not in `stillOpen`. Used after a detection sweep. */
  async resolveStale(kinds: readonly string[], stillOpen: Set<string>, resolution: string): Promise<number> {
    const rows = await this.db.operationalException.findMany({
      where: { openKey: { not: null }, kind: { in: kinds as never[] } },
    });
    let resolved = 0;
    for (const row of rows) {
      if (stillOpen.has(row.dedupeKey)) continue;
      if (await this.resolveByKey(row.dedupeKey, resolution)) resolved += 1;
    }
    return resolved;
  }

  // ───────────────────────────── people ─────────────────────────────

  async acknowledge(actor: Actor, id: string) {
    const row = await this.openOrThrow(id);
    await this.db.operationalException.update({
      where: { id },
      data: { status: 'ACKNOWLEDGED', acknowledgedAt: new Date(), ownerId: row.ownerId ?? actor.userId },
    });
    await this.audit.record({
      actor,
      source: 'UI',
      action: 'exception.acknowledged',
      entityType: 'OperationalException',
      entityId: id,
    });
    this.bus.emit({ kind: 'exception', exceptionId: id, status: 'acknowledged', title: row.title, kindName: row.kind });
    return { ok: true };
  }

  async assign(actor: Actor, id: string, ownerId: string | null) {
    const row = await this.openOrThrow(id);
    await this.db.operationalException.update({ where: { id }, data: { ownerId } });
    await this.audit.record({
      actor,
      source: 'UI',
      action: 'exception.assigned',
      entityType: 'OperationalException',
      entityId: id,
      before: { ownerId: row.ownerId },
      after: { ownerId },
    });
    return { ok: true };
  }

  async resolve(actor: Actor, id: string, note: string) {
    const row = await this.openOrThrow(id);
    await this.db.operationalException.update({
      where: { id },
      data: { status: 'RESOLVED', openKey: null, resolution: note, resolvedAt: new Date(), resolvedById: actor.userId },
    });
    await this.audit.record({
      actor,
      source: 'UI',
      action: 'exception.resolved',
      entityType: 'OperationalException',
      entityId: id,
      after: { resolution: note },
    });
    this.bus.emit({ kind: 'exception', exceptionId: id, status: 'resolved', title: row.title, kindName: row.kind });
    return { ok: true };
  }

  async ignore(actor: Actor, id: string, note: string) {
    const row = await this.openOrThrow(id);
    await this.db.operationalException.update({
      where: { id },
      data: { status: 'IGNORED', openKey: null, resolution: note, resolvedAt: new Date(), resolvedById: actor.userId },
    });
    await this.audit.record({
      actor,
      source: 'UI',
      action: 'exception.ignored',
      entityType: 'OperationalException',
      entityId: id,
      after: { note },
    });
    this.bus.emit({ kind: 'exception', exceptionId: id, status: 'ignored', title: row.title, kindName: row.kind });
    return { ok: true };
  }

  /** For exceptions backed by a job: re-arm the job. The exception stays open until the job recovers. */
  async retry(actor: Actor, id: string) {
    const row = await this.openOrThrow(id);
    const jobId = (row.detail as { jobId?: string } | null)?.jobId;
    if (!jobId) throw new BadRequestException('this exception is not backed by a job');
    // Acknowledge first: with inline jobs the retry completes — and the recovery consumer
    // resolves this row — before the call returns, and an acknowledgement written afterwards
    // would reopen what the job just closed.
    await this.db.operationalException.update({
      where: { id },
      data: {
        status: 'ACKNOWLEDGED',
        acknowledgedAt: row.acknowledgedAt ?? new Date(),
        ownerId: row.ownerId ?? actor.userId,
      },
    });
    const result = await this.jobs.retry(jobId);
    await this.audit.record({
      actor,
      source: 'UI',
      action: 'exception.retry',
      entityType: 'OperationalException',
      entityId: id,
      after: { jobId, ...result },
    });
    return result;
  }

  // ───────────────────────────── reads ─────────────────────────────

  /** The board is staff's: the same line `can` draws for the UI, applied to rows the assistant is about to read out. */
  visibleTo<T>(actor: Actor, rows: T[]): T[] {
    return can(actor, 'read', 'operations') ? rows : [];
  }

  /** Every row carries its explanation: the system state as the tables hold it, and what that means to the person who acts. */
  async list(status: ExceptionStatus[] = ['OPEN', 'ACKNOWLEDGED'], limit = 200) {
    const rows = await this.db.operationalException.findMany({
      where: { status: { in: status } },
      orderBy: [{ status: 'asc' }, { severity: 'desc' }, { createdAt: 'desc' }],
      take: limit,
      include: { owner: { select: { id: true, name: true } }, resolvedBy: { select: { id: true, name: true } } },
    });
    const stakes = await this.stakes(rows);
    return rows.map((row) => ({
      ...row,
      explanation: explain(row.kind, row.detail as Record<string, unknown> | null, row.entityId),
      stake: stakes.get(row.id) ?? null,
    }));
  }

  /**
   * The money behind a set of rows, looked up fresh in one round trip per table: the invoice
   * a settlement waits on, the payment the books refused, the embryo whose check gates a fee,
   * the contract whose balance holds an order. The detector's payload is never the source.
   */
  private async stakes(
    rows: { id: string; kind: ExceptionKind; detail: unknown; entityId: string | null }[],
  ): Promise<Map<string, Stake>> {
    const invoiceIds = new Set<string>();
    const paymentIds = new Set<string>();
    const embryoIds = new Set<string>();
    const contractIds = new Set<string>();
    for (const row of rows) {
      const detail = (row.detail ?? null) as Record<string, unknown> | null;
      for (const id of [row.entityId, detail?.['invoiceId'], detail?.['paymentId']]) {
        if (typeof id !== 'string') continue;
        if (id.startsWith('INV-')) invoiceIds.add(id);
        if (id.startsWith('PAY-')) paymentIds.add(id);
      }
      if (row.kind === 'CHECK_OVERDUE' && row.entityId) embryoIds.add(row.entityId);
      if (row.kind === 'SHIP_BLOCKED' && typeof detail?.['contractId'] === 'string')
        contractIds.add(detail['contractId']);
    }
    const [invoices, payments, embryos, contractInvoices] = await Promise.all([
      invoiceIds.size
        ? this.db.invoice.findMany({ where: { id: { in: [...invoiceIds] } }, select: { id: true, amountCents: true } })
        : [],
      paymentIds.size
        ? this.db.payment.findMany({
            where: { id: { in: [...paymentIds] } },
            select: { id: true, amountCents: true, invoiceId: true },
          })
        : [],
      embryoIds.size
        ? this.db.embryo.findMany({
            where: { id: { in: [...embryoIds] } },
            select: {
              id: true,
              source: true,
              storageTank: true,
              contract: { select: { type: true, studFeeCents: true } },
            },
          })
        : [],
      contractIds.size
        ? this.db.invoice.findMany({
            where: { contractId: { in: [...contractIds] }, status: 'OPEN' },
            select: { contractId: true, amountCents: true },
          })
        : [],
    ]);
    const invoiceAmount = new Map(invoices.map((i) => [i.id, i.amountCents]));
    const paymentAmount = new Map(payments.map((p) => [p.id, p.amountCents]));
    const paymentInvoice = new Map(payments.map((p) => [p.id, p.invoiceId]));
    const embryoById = new Map(
      embryos.map((e) => [
        e.id,
        {
          source: e.source,
          wasFrozen: e.storageTank !== null,
          contractType: e.contract?.type ?? null,
          studFeeCents: e.contract?.studFeeCents ?? null,
        },
      ]),
    );
    const balance = new Map<string, number>();
    for (const i of contractInvoices)
      if (i.contractId) balance.set(i.contractId, (balance.get(i.contractId) ?? 0) + i.amountCents);
    const lookups: StakeLookups = {
      invoiceAmountCents: (id) => invoiceAmount.get(id) ?? null,
      paymentAmountCents: (id) => paymentAmount.get(id) ?? null,
      paymentInvoiceId: (id) => paymentInvoice.get(id) ?? null,
      embryo: (id) => embryoById.get(id) ?? null,
      contractBalanceCents: (id) => balance.get(id) ?? null,
    };
    const out = new Map<string, Stake>();
    for (const row of rows) {
      const stake = stakeFor(row.kind, (row.detail ?? null) as Record<string, unknown> | null, row.entityId, lookups);
      if (stake) out.set(row.id, stake);
    }
    return out;
  }

  /**
   * The open exceptions as signals: one per front-door channel first (sale, recipient,
   * reproduction, accounting), then the rest by severity. The ring, the dock and the board
   * are one list; the ids and correlation ids are the same everywhere.
   */
  async signals(limit = 12): Promise<Signal[]> {
    const rows = await this.list(['OPEN', 'ACKNOWLEDGED'], Math.max(200, limit));
    const rank = (s: Signal) => (s.severity === 'CRITICAL' ? 0 : s.severity === 'WARN' ? 1 : 2);
    const all = this.toSignals(rows).sort((a, b) => rank(a) - rank(b) || a.createdAt.localeCompare(b.createdAt));
    const first: Signal[] = [];
    for (const channel of RING_CHANNELS) {
      const preference = RING_PREFERENCE[channel] ?? [];
      const candidates = all
        .filter((s) => s.channel === channel && !first.includes(s))
        .sort((a, b) => {
          const ia = preference.indexOf(a.kind as (typeof preference)[number]);
          const ib = preference.indexOf(b.kind as (typeof preference)[number]);
          return (ia === -1 ? 99 : ia) - (ib === -1 ? 99 : ib);
        });
      if (candidates[0]) first.push(candidates[0]);
    }
    return [...first, ...all.filter((s) => !first.includes(s))].slice(0, limit);
  }

  /** One signal, by its exception id — open or not, so a shared link still lands. */
  async signal(id: string): Promise<Signal | null> {
    const row = await this.db.operationalException.findUnique({
      where: { id },
      include: { owner: { select: { id: true, name: true } }, resolvedBy: { select: { id: true, name: true } } },
    });
    if (!row) return null;
    const stakes = await this.stakes([row]);
    const detail = row.detail as Record<string, unknown> | null;
    const explanation = explain(row.kind, detail, row.entityId);
    const [signal] = this.toSignals([{ ...row, explanation, stake: stakes.get(row.id) ?? null }]);
    if (!signal) return null;
    // The map reads the whole explanation, not the three-line summary the ring shows.
    return {
      ...signal,
      map: signalMap({
        id: row.id,
        label: signal.label,
        entityId: row.entityId,
        detail,
        systemState: explanation.systemState,
        next: signal.next,
        owner: signal.owner,
      }),
    };
  }

  private toSignals(
    rows: {
      id: string;
      kind: ExceptionKind;
      severity: string;
      source: string;
      status: string;
      title: string;
      detail: unknown;
      entityType: string | null;
      entityId: string | null;
      correlationId: string | null;
      createdAt: Date;
      owner: { name: string } | null;
      explanation: { systemState: { key: string; value: string }[]; meaning: string };
      stake: Stake | null;
    }[],
  ): Signal[] {
    return rows.map((row) => {
      const shape = SIGNAL_SHAPES[row.kind];
      const detail = row.detail as Record<string, unknown> | null;
      return {
        id: row.id,
        kind: row.kind,
        label: EXCEPTIONS[row.kind].label,
        severity: row.severity,
        source: row.source,
        status: row.status,
        channel: shape.channel,
        channelLabel: shape.channelLabel,
        entityType: row.entityType,
        entityId: row.entityId,
        title: row.title,
        state: row.explanation.systemState.slice(0, 3),
        meaning: row.explanation.meaning,
        stake: row.stake,
        next: shape.next,
        owner: shape.owner,
        ownerName: row.owner?.name ?? null,
        surface: shape.surface,
        correlationId: row.correlationId,
        createdAt: row.createdAt.toISOString(),
        evidence: row.explanation.systemState.length + (row.entityId ? 1 : 0),
        lotId: typeof detail?.['lotId'] === 'string' ? detail['lotId'] : null,
      };
    });
  }

  async get(id: string) {
    const row = await this.db.operationalException.findUnique({
      where: { id },
      include: { owner: { select: { id: true, name: true } }, resolvedBy: { select: { id: true, name: true } } },
    });
    if (!row) throw new NotFoundException(`${id} not found`);
    const job = (row.detail as { jobId?: string } | null)?.jobId
      ? await this.db.jobRecord.findUnique({ where: { id: (row.detail as { jobId: string }).jobId } })
      : null;
    return {
      ...row,
      definition: EXCEPTIONS[row.kind],
      job,
      explanation: explain(row.kind, row.detail as Record<string, unknown> | null, row.entityId),
    };
  }

  /**
   * Open exceptions that touch one record, following the record's own relations: a recip's
   * carried embryo, its transfer, invoices and payments, and the embryos held for her; an
   * embryo's transfer, invoices and payments. What "about this mare" means, in code.
   */
  async openRelatedTo(id: string) {
    const related = new Set<string>([id]);
    if (id.startsWith('R-') || id.startsWith('H-')) {
      const horse = await this.db.horse.findUnique({
        where: { id },
        include: {
          plannedEmbryos: { select: { id: true } },
          transfers: {
            include: { embryo: { include: { invoices: { include: { payments: { select: { id: true } } } } } } },
          },
        },
      });
      for (const e of horse?.plannedEmbryos ?? []) related.add(e.id);
      for (const t of horse?.transfers ?? []) {
        related.add(t.id);
        related.add(t.embryoId);
        for (const inv of t.embryo.invoices) {
          related.add(inv.id);
          for (const p of inv.payments) related.add(p.id);
        }
      }
    } else if (id.startsWith('E-')) {
      const embryo = await this.db.embryo.findUnique({
        where: { id },
        include: {
          transfers: { select: { id: true, recipientId: true } },
          invoices: { include: { payments: { select: { id: true } } } },
        },
      });
      for (const t of embryo?.transfers ?? []) {
        related.add(t.id);
        related.add(t.recipientId);
      }
      for (const inv of embryo?.invoices ?? []) {
        related.add(inv.id);
        for (const p of inv.payments) related.add(p.id);
      }
    }
    const rows = await this.list(['OPEN', 'ACKNOWLEDGED'], 200);
    const ids = Array.from(related);
    return rows.filter((x) => (x.entityId && related.has(x.entityId)) || ids.some((r) => x.title.includes(r)));
  }

  async summary() {
    const open = await this.db.operationalException.findMany({
      where: { openKey: { not: null } },
      select: { id: true, kind: true, severity: true, source: true, status: true, detail: true, entityId: true },
    });
    const by = (key: 'kind' | 'severity' | 'source' | 'status') =>
      open.reduce<Record<string, number>>((acc, row) => ((acc[row[key]] = (acc[row[key]] ?? 0) + 1), acc), {});
    // The one number a founder reads first: every dollar an open row holds up, each obligation
    // once — two rows about the same invoice are one exposure, never double.
    const stakes = await this.stakes(open);
    const atStakeCents = sumStakes(stakes.values());
    return {
      open: open.length,
      atStakeCents,
      withStake: stakes.size,
      byKind: by('kind'),
      bySeverity: by('severity'),
      bySource: by('source'),
      byStatus: by('status'),
    };
  }

  private async openOrThrow(id: string) {
    const row = await this.db.operationalException.findUnique({ where: { id } });
    if (!row) throw new NotFoundException(`${id} not found`);
    if (row.openKey === null) throw new BadRequestException(`${id} is already ${row.status.toLowerCase()}`);
    return row;
  }
}

function isUniqueViolation(error: unknown): boolean {
  return (
    typeof error === 'object' && error !== null && 'code' in error && (error as { code?: string }).code === 'P2002'
  );
}
