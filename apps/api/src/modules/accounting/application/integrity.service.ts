import { Injectable, NotFoundException } from '@nestjs/common';
import type { Actor } from '@daysheet/domain';
import { canSeeRecord } from '@daysheet/domain';
import { PrismaService } from '../../../platform/persistence/prisma.service';

/**
 * Money integrity: one invoice seen from the three systems that hold an opinion about it —
 * the ledger here, Stripe's inbox, the books' mapping — and the timeline that joins them.
 *
 * A read model only. It never decides anything; it makes "which side is right?" answerable
 * by showing every step with its timestamp, its source and its correlation id.
 */
export type SideStatus = { status: string; ok: boolean | null; note: string | null };

export interface InvoiceIntegrityRow {
  id: string;
  kind: string;
  status: string;
  amountCents: number;
  issuedOn: string;
  customer: { id: string; name: string };
  embryoId: string | null;
  daysheet: SideStatus;
  stripe: SideStatus & { eventId: string | null; deliveries: number; duplicates: number };
  books: SideStatus & { invoice: string | null; payment: string | null };
  openDiscrepancies: number;
}

export interface IntegrityTimelineRow {
  at: string;
  source: 'daysheet' | 'stripe' | 'quickbooks' | 'queue';
  title: string;
  detail: string | null;
  ok: boolean | null;
  correlationId: string | null;
  ids: string[];
}

@Injectable()
export class IntegrityService {
  constructor(private readonly prisma: PrismaService) {}

  private get db() {
    return this.prisma.client;
  }

  /** Every invoice with the state each system reports, newest first. */
  async list(actor: Actor, options: { limit?: number; invoiceId?: string } = {}): Promise<InvoiceIntegrityRow[]> {
    const { limit = 200, invoiceId } = options;
    const invoices = await this.db.invoice.findMany({
      where: {
        ...(actor.role === 'CUSTOMER' ? { customerId: actor.customerId ?? '__none__' } : {}),
        ...(invoiceId ? { id: invoiceId } : {}),
      },
      include: { customer: true, payments: { orderBy: { receivedAt: 'desc' } } },
      orderBy: { issuedOn: 'desc' },
      take: limit,
    });
    const invoiceIds = invoices.map((i) => i.id);
    const paymentIds = invoices.flatMap((i) => i.payments.map((p) => p.id));
    const [mappings, discrepancies, inbox] = await Promise.all([
      this.db.accountingMapping.findMany({ where: { entityId: { in: [...invoiceIds, ...paymentIds] } } }),
      this.db.discrepancy.findMany({
        where: { resolvedAt: null, entityId: { in: [...invoiceIds, ...paymentIds] } },
        select: { entityId: true },
      }),
      this.db.integrationEvent.findMany({
        where: {
          provider: 'STRIPE',
          OR: invoiceIds.map((id) => ({ payload: { path: ['data', 'object', 'metadata', 'invoiceId'], equals: id } })),
        },
        orderBy: { receivedAt: 'desc' },
      }),
    ]);
    const mappingFor = (id: string) => mappings.find((m) => m.entityId === id) ?? null;
    const eventFor = (invoiceId: string) =>
      inbox.find(
        (e) =>
          (e.payload as { data?: { object?: { metadata?: { invoiceId?: string } } } }).data?.object?.metadata
            ?.invoiceId === invoiceId,
      ) ?? null;

    return invoices.map((invoice) => {
      const payment =
        invoice.payments.find((p) => p.status === 'SUCCEEDED' || p.status === 'PROCESSING') ??
        invoice.payments[0] ??
        null;
      const event = eventFor(invoice.id);
      const invoiceMapping = mappingFor(invoice.id);
      const paymentMapping = payment ? mappingFor(payment.id) : null;
      const booksStatus = paymentMapping?.status ?? invoiceMapping?.status ?? null;
      const open = discrepancies.filter(
        (d) => d.entityId === invoice.id || (payment && d.entityId === payment.id),
      ).length;
      return {
        id: invoice.id,
        kind: invoice.kind,
        status: invoice.status,
        amountCents: invoice.amountCents,
        issuedOn: invoice.issuedOn.toISOString().slice(0, 10),
        customer: { id: invoice.customerId, name: invoice.customer.displayName },
        embryoId: invoice.embryoId,
        // The ledger cannot disagree with itself: paid is settled, everything else is still in motion.
        daysheet: {
          status: invoice.status,
          ok: invoice.status === 'PAID' ? true : null,
          note: payment ? `${payment.id} · ${payment.method.toLowerCase()}` : null,
        },
        stripe: {
          status: payment ? payment.status : 'NONE',
          ok: payment ? (payment.status === 'SUCCEEDED' ? true : payment.status === 'FAILED' ? false : null) : null,
          note: payment?.failureReason ?? null,
          eventId: event?.externalId ?? null,
          deliveries: event ? 1 + event.duplicateDeliveries : 0,
          duplicates: event?.duplicateDeliveries ?? 0,
        },
        books: {
          status: open > 0 ? 'MISMATCH' : (booksStatus ?? 'NONE'),
          ok: open > 0 ? false : booksStatus === 'SYNCED' ? true : booksStatus === 'FAILED' ? false : null,
          note: paymentMapping?.lastError ?? invoiceMapping?.lastError ?? null,
          invoice: invoiceMapping?.status ?? null,
          payment: paymentMapping?.status ?? null,
        },
        openDiscrepancies: open,
      };
    });
  }

  /** The invoice behind a payment code, for callers that hold only the payment. */
  async invoiceIdForPayment(paymentId: string): Promise<string | null> {
    const payment = await this.db.payment.findUnique({ where: { id: paymentId }, select: { invoiceId: true } });
    return payment?.invoiceId ?? null;
  }

  /** One invoice, every step across every system, in order. */
  async timeline(
    actor: Actor,
    invoiceId: string,
  ): Promise<{ row: InvoiceIntegrityRow; timeline: IntegrityTimelineRow[] }> {
    const invoice = await this.db.invoice.findUnique({ where: { id: invoiceId }, include: { payments: true } });
    if (!invoice) throw new NotFoundException(`${invoiceId} not found`);
    if (!canSeeRecord(actor, 'invoice', { customerId: invoice.customerId }))
      throw new NotFoundException(`${invoiceId} not found`);
    const [row] = await this.list(actor, { invoiceId });
    if (!row) throw new NotFoundException(`${invoiceId} not found`);

    const paymentIds = invoice.payments.map((p) => p.id);
    const ids = [invoice.id, ...paymentIds];
    const [audit, inbox, mappings, jobs] = await Promise.all([
      this.db.auditEvent.findMany({ where: { entityId: { in: ids } }, orderBy: { at: 'asc' } }),
      this.db.integrationEvent.findMany({
        where: {
          provider: 'STRIPE',
          payload: { path: ['data', 'object', 'metadata', 'invoiceId'], equals: invoice.id },
        },
        orderBy: { receivedAt: 'asc' },
      }),
      this.db.accountingMapping.findMany({
        where: { entityId: { in: ids } },
        include: { syncAttempts: { orderBy: { startedAt: 'asc' } } },
      }),
      this.db.jobRecord.findMany({
        where: { queue: 'qbo-sync', OR: ids.map((id) => ({ id: { contains: id } })) },
        orderBy: { createdAt: 'asc' },
      }),
    ]);

    const timeline: IntegrityTimelineRow[] = [];
    for (const a of audit) {
      timeline.push({
        at: a.at.toISOString(),
        source: a.source === 'WEBHOOK' ? 'stripe' : 'daysheet',
        title: a.action.replace(/[._]/g, ' '),
        detail: summarize(a.after),
        ok: null,
        correlationId: a.correlationId,
        ids: [a.entityId],
      });
    }
    for (const e of inbox) {
      timeline.push({
        at: e.receivedAt.toISOString(),
        source: 'stripe',
        title: `${e.type} received`,
        detail:
          e.duplicateDeliveries > 0
            ? `delivered ${1 + e.duplicateDeliveries}× · ${e.duplicateDeliveries} rejected as duplicate`
            : 'first delivery',
        ok: e.status === 'FAILED' ? false : e.status === 'PROCESSED' ? true : null,
        correlationId: e.correlationId,
        ids: [e.externalId],
      });
      if (e.processedAt)
        timeline.push({
          at: e.processedAt.toISOString(),
          source: 'stripe',
          title: e.status === 'IGNORED' ? 'event set aside' : 'event applied to the ledger',
          detail: e.error,
          ok: e.status === 'PROCESSED',
          correlationId: e.correlationId,
          ids: [e.externalId],
        });
    }
    for (const m of mappings) {
      for (const attempt of m.syncAttempts) {
        timeline.push({
          at: attempt.startedAt.toISOString(),
          source: 'quickbooks',
          title: attempt.ok
            ? `${m.entityType.toLowerCase()} synced`
            : attempt.ok === false
              ? `${m.entityType.toLowerCase()} sync failed${attempt.httpStatus ? ` (${attempt.httpStatus})` : ''}`
              : `${m.entityType.toLowerCase()} sync attempted`,
          detail: attempt.error ?? (attempt.remoteRequestId ? `tid ${attempt.remoteRequestId}` : null),
          ok: attempt.ok,
          correlationId: null,
          ids: [m.entityId, ...(m.externalId ? [m.externalId] : [])],
        });
      }
    }
    for (const j of jobs) {
      timeline.push({
        at: (j.enqueuedAt ?? j.createdAt).toISOString(),
        source: 'queue',
        title: `sync job ${j.status.toLowerCase()}`,
        detail:
          j.lastError ??
          `${j.attempts}/${j.maxAttempts} attempts${j.nextRunAt && j.status === 'RETRYING' ? ` · next ${j.nextRunAt.toISOString()}` : ''}`,
        ok: j.status === 'COMPLETED' ? true : j.status === 'DEAD' ? false : null,
        correlationId: j.correlationId,
        ids: [j.id],
      });
    }
    timeline.sort((a, b) => a.at.localeCompare(b.at));
    return { row, timeline };
  }
}

function summarize(after: unknown): string | null {
  if (!after || typeof after !== 'object') return null;
  const o = after as Record<string, unknown>;
  const parts: string[] = [];
  for (const key of ['status', 'amountCents', 'method', 'simulated', 'eventId', 'reason']) {
    const value = o[key];
    // Only scalars make a readable detail; nested objects belong in the drawer, not the row.
    if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean')
      parts.push(`${key} ${String(value)}`);
  }
  return parts.length > 0 ? parts.join(' · ') : null;
}
