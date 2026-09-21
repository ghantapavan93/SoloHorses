import { Injectable, NotFoundException } from '@nestjs/common';
import { addDays, evaluateDeparture, gestationDay, nextMilestoneDay, type Actor } from '@daysheet/domain';
import { ClockService } from '../../../platform/clock/clock.service';
import { PrismaService } from '../../../platform/persistence/prisma.service';
import { RecordsService, type TimelineEvent } from './records.service';
import { TransfersService } from './transfers.service';

/**
 * One mare's story: every handoff across every system, with the exceptions that touch
 * her interleaved, each row carrying the system it came from and the correlation id of the
 * work that produced it. This is the front door; it reads the same tables everything else
 * does and adds nothing that is not a row.
 */
export type StorySource =
  'stallion office' | 'lab' | 'recip farm' | 'vet' | 'billing' | 'stripe' | 'quickbooks' | 'text' | 'board';

/** FACT (public pages): mares carrying foals move to the North facility for foaling. ASSUMPTION: at about day 300. */
const MOVE_NORTH_GESTATION_DAY = 300;

export interface StoryRow {
  id: string;
  at: string;
  source: StorySource;
  /** `planned`: a handoff the published workflow says is coming; copy, not a record. */
  kind: 'event' | 'exception' | 'planned';
  title: string;
  detail?: string;
  amountCents?: number;
  evidenceIds: string[];
  correlationId: string | null;
  /** For exception rows: the exception's code and the rule that raised it. */
  exception?: { exceptionId: string; kindName: string; severity: string; status: string; rule: string | null };
}

@Injectable()
export class StoryService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly records: RecordsService,
    private readonly transfers: TransfersService,
    private readonly clock: ClockService,
  ) {}

  private get db() {
    return this.prisma.client;
  }

  /** Which mare the front door tells; written by the seed, changeable by an admin. */
  async storyRecipId(): Promise<string> {
    const setting = await this.db.setting.findUnique({ where: { key: 'story' } });
    const value = setting?.value as { recipId?: string } | null;
    if (!value?.recipId) throw new NotFoundException('no story is configured; run the seed');
    return value.recipId;
  }

  async build(actor: Actor, recipId: string) {
    const today = this.clock.today();
    const recip = await this.db.horse.findUnique({
      where: { id: recipId },
      include: {
        clearances: { orderBy: { performedOn: 'desc' } },
        transfers: { include: { embryo: true }, orderBy: { performedOn: 'desc' } },
        plannedEmbryos: { select: { id: true, status: true, expectedOn: true } },
      },
    });
    if (!recip || recip.kind !== 'RECIPIENT') throw new NotFoundException(`${recipId} is not a recip`);
    const current =
      recip.transfers.find((t) => t.embryo.status === 'TRANSFERRED' || t.embryo.status === 'PREGNANT') ??
      recip.transfers[0] ??
      null;
    if (!current) throw new NotFoundException(`${recipId} has not carried an embryo`);

    const { embryo, timeline } = await this.records.getEmbryo(actor, current.embryoId);
    const invoiceIds = embryo.invoices.map((i) => i.id);
    const paymentIds = embryo.invoices.flatMap((i) => i.payments.map((p) => p.id));
    const relatedIds = [
      recip.id,
      embryo.id,
      current.id,
      ...invoiceIds,
      ...paymentIds,
      ...recip.plannedEmbryos.map((e) => e.id),
    ];
    const [exceptions, auditRows, mappings, jobs, inbox] = await Promise.all([
      this.db.operationalException.findMany({
        where: { OR: [{ entityId: { in: relatedIds } }, { detail: { path: ['recipId'], equals: recip.id } }] },
        orderBy: { createdAt: 'desc' },
      }),
      this.db.auditEvent.findMany({ where: { entityId: { in: relatedIds } }, orderBy: { at: 'asc' } }),
      this.db.accountingMapping.findMany({
        where: { entityId: { in: [...invoiceIds, ...paymentIds] } },
        include: { syncAttempts: { orderBy: { startedAt: 'desc' }, take: 5 } },
      }),
      this.db.jobRecord.findMany({
        where: { queue: 'qbo-sync', OR: [...invoiceIds, ...paymentIds].map((id) => ({ id: { contains: id } })) },
        orderBy: { updatedAt: 'desc' },
        take: 20,
      }),
      this.db.integrationEvent.findMany({
        where: {
          provider: 'STRIPE',
          OR: invoiceIds.map((id) => ({ payload: { path: ['data', 'object', 'metadata', 'invoiceId'], equals: id } })),
        },
        orderBy: { receivedAt: 'asc' },
      }),
    ]);
    const correlationFor = (entityId: string): string | null =>
      auditRows.filter((a) => a.entityId === entityId && a.correlationId).map((a) => a.correlationId)[0] ?? null;

    const rows: StoryRow[] = timeline.map((t: TimelineEvent) => ({
      id: t.id,
      at: t.at,
      source: sourceOf(t.kind),
      kind: 'event',
      title: t.title,
      detail: t.detail,
      amountCents: t.amountCents,
      evidenceIds: Array.from(new Set([t.id, ...t.links])),
      correlationId: correlationFor(t.id),
    }));
    for (const x of exceptions) {
      const rule = (x.detail as { code?: string } | null)?.code ?? null;
      // Detectors run on the real clock; the story runs on the barn's day. An exception raised
      // "this morning" sits on today's date here, with its real time of day, so the timeline stays in order.
      const at =
        x.createdAt.toISOString().slice(0, 10) > today
          ? `${today}T${x.createdAt.toISOString().slice(11)}`
          : x.createdAt.toISOString();
      rows.push({
        id: x.id,
        at,
        source: sourceOfException(x.source),
        kind: 'exception',
        title: x.title,
        evidenceIds: Array.from(
          new Set([
            x.id,
            ...(x.entityId ? [x.entityId] : []),
            ...((x.detail as { evidenceIds?: string[] } | null)?.evidenceIds ?? []),
          ]),
        ),
        correlationId: x.correlationId,
        exception: { exceptionId: x.id, kindName: x.kind, severity: x.severity, status: x.status, rule },
      });
    }
    // The fourth site handoff, ahead of the mare: the move North for foaling. A planned row, labeled as such.
    const transferredOn = current.performedOn.toISOString().slice(0, 10);
    if (embryo.status === 'PREGNANT' || embryo.status === 'TRANSFERRED') {
      rows.push({
        id: `${current.id}:north`,
        at: `${addDays(transferredOn, MOVE_NORTH_GESTATION_DAY)}T12:00:00.000Z`,
        source: 'recip farm',
        kind: 'planned',
        title: `Moves to the North facility for foaling · about day ${MOVE_NORTH_GESTATION_DAY}`,
        detail:
          'Planned from the published workflow — mares carrying foals foal at the North facility. The day is an assumption; no record exists yet.',
        evidenceIds: [recip.id, embryo.id],
        correlationId: null,
      });
    }
    rows.sort((a, b) => a.at.localeCompare(b.at));

    const day = gestationDay(transferredOn, today);
    const checks = embryo.transfers.find((t) => t.id === current.id)?.checks ?? [];
    const lastCheck = checks[checks.length - 1] ?? null;
    const clearance = await this.transfers.clearanceFor(recip.id);
    // Leaving with her client: the lease's video rule, asked the way the detector asks it.
    const clearanceRecords = recip.clearances.map((c) => ({
      id: c.id,
      kind: c.kind,
      result: c.result,
      performedOn: c.performedOn.toISOString().slice(0, 10),
      expiresOn: c.expiresOn?.toISOString().slice(0, 10) ?? null,
    }));
    const scheduledDepartureOn = recip.scheduledDepartureOn?.toISOString().slice(0, 10) ?? null;
    const departure = scheduledDepartureOn
      ? {
          scheduledDepartureOn,
          rule: evaluateDeparture({ id: recip.id, scheduledDepartureOn, clearances: clearanceRecords }, today),
        }
      : null;
    const payment = embryo.invoices.flatMap((i) => i.payments).find((p) => p.status === 'SUCCEEDED') ?? null;
    const stripeEvent = inbox[inbox.length - 1] ?? null;
    // A set-up mare held for nobody: what a person (or a proposal) would reach for to resolve a double-booking.
    const freeRecip = await this.db.horse.findFirst({
      where: { kind: 'RECIPIENT', recipStatus: 'SET_UP', plannedEmbryos: { none: {} } },
      orderBy: { recipNumber: 'asc' },
      select: { id: true, recipNumber: true },
    });

    return {
      today,
      recip: {
        id: recip.id,
        number: recip.recipNumber,
        status: recip.recipStatus,
        name: recip.name,
        clearances: clearanceRecords,
        clearance,
        departure,
        heldFor: recip.plannedEmbryos.map((e) => ({
          id: e.id,
          status: e.status,
          expectedOn: e.expectedOn?.toISOString().slice(0, 10) ?? null,
        })),
      },
      embryo: {
        id: embryo.id,
        status: embryo.status,
        source: embryo.source,
        cross: `${embryo.sire?.name ?? embryo.sireName ?? '?'} x ${embryo.dam?.name ?? embryo.damName ?? '?'}`,
        customer: { id: embryo.customerId, name: embryo.customer.displayName },
        contract: embryo.contract
          ? {
              id: embryo.contract.id,
              type: embryo.contract.type,
              status: embryo.contract.status,
              stallion: embryo.contract.stallion.name,
            }
          : null,
      },
      pregnancy: {
        transferId: current.id,
        transferredOn: current.performedOn.toISOString().slice(0, 10),
        gestationDay: day,
        lastCheck: lastCheck
          ? {
              id: lastCheck.id,
              day: lastCheck.dayNumber,
              result: lastCheck.result,
              on: lastCheck.performedOn.toISOString().slice(0, 10),
            }
          : null,
        nextMilestone: nextMilestoneDay(lastCheck?.dayNumber ?? 0),
      },
      money: {
        invoices: embryo.invoices.map((i) => ({
          id: i.id,
          kind: i.kind,
          status: i.status,
          amountCents: i.amountCents,
          payments: i.payments.map((p) => ({
            id: p.id,
            status: p.status,
            method: p.method,
            amountCents: p.amountCents,
            receivedAt: p.receivedAt.toISOString(),
            stripePaymentIntentId: p.stripePaymentIntentId,
          })),
        })),
        stripe: stripeEvent
          ? {
              eventId: stripeEvent.externalId,
              status: stripeEvent.status,
              deliveries: 1 + stripeEvent.duplicateDeliveries,
              duplicatesRejected: stripeEvent.duplicateDeliveries,
              paymentsForInvoice: payment ? 1 : 0,
              receivedAt: stripeEvent.receivedAt.toISOString(),
            }
          : null,
        books: mappings.map((m) => ({
          entityType: m.entityType,
          entityId: m.entityId,
          status: m.status,
          externalId: m.externalId,
          attempts: m.attempts,
          lastError: m.lastError,
          lastSyncedAt: m.lastSyncedAt?.toISOString() ?? null,
          recentAttempts: m.syncAttempts.map((a) => ({
            at: a.startedAt.toISOString(),
            ok: a.ok,
            httpStatus: a.httpStatus,
            error: a.error,
          })),
        })),
        jobs: jobs.map((j) => ({
          id: j.id,
          status: j.status,
          attempts: j.attempts,
          maxAttempts: j.maxAttempts,
          lastError: j.lastError,
          nextRunAt: j.nextRunAt?.toISOString() ?? null,
        })),
      },
      exceptions: exceptions.map((x) => ({
        id: x.id,
        kind: x.kind,
        severity: x.severity,
        status: x.status,
        title: x.title,
        entityId: x.entityId,
        correlationId: x.correlationId,
        rule: (x.detail as { code?: string } | null)?.code ?? null,
        detail: x.detail,
      })),
      freeRecip,
      rows,
    };
  }
}

function sourceOf(kind: string): StorySource {
  switch (kind) {
    case 'intake':
      return 'text';
    case 'aspiration':
      return 'vet';
    case 'lab':
      return 'lab';
    case 'arrival':
    case 'transfer':
      return 'recip farm';
    case 'check':
      return 'vet';
    case 'invoice':
      return 'billing';
    case 'payment':
      return 'stripe';
    default:
      return 'stallion office';
  }
}

function sourceOfException(source: string): StorySource {
  switch (source) {
    case 'STRIPE':
      return 'stripe';
    case 'QBO':
    case 'RECONCILIATION':
      return 'quickbooks';
    case 'VETERINARY':
      return 'vet';
    case 'REPRODUCTION':
      return 'recip farm';
    case 'BILLING':
      return 'billing';
    default:
      return 'board';
  }
}
