import { BadRequestException, Inject, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { reconcile, type Actor } from '@daysheet/domain';
import { MappedEntityType, type DiscrepancyResolution, type Prisma } from '@daysheet/db';
import { z } from 'zod';
import { AuditService } from '../../../platform/audit/audit.service';
import { ClockService } from '../../../platform/clock/clock.service';
import { OutboxService } from '../../../platform/events/outbox.service';
import { PlatformBus } from '../../../platform/observability/platform-bus';
import { PrismaService } from '../../../platform/persistence/prisma.service';
import {
  DependencyUnavailableError,
  JobsService,
  RateLimitedError,
  UnrecoverableJobError,
} from '../../../platform/queue/jobs.service';
import { CircuitBreakerRegistry, CircuitOpenError } from '../../../platform/resilience/circuit-breaker';
import {
  AccountingEvents,
  type DiscrepancyRaisedPayload,
  type DiscrepancyResolvedPayload,
  type EntitySyncedPayload,
} from '../domain/events';
import {
  ACCOUNTING_PROVIDER,
  AccountingAuthError,
  AccountingRateLimitError,
  AccountingTransientError,
  AccountingValidationError,
  type AccountingProvider,
} from '../infrastructure/accounting.provider';

/** The breaker's name for the books; the same string the Architecture page and the lab show. */
export const ACCOUNTING_DEPENDENCY = 'quickbooks';

const ITEM_NAMES: Record<string, string> = {
  DEPOSIT: 'Booking Deposit',
  STUD_FEE: 'Stud Fee',
  CHUTE_FEE: 'Chute Fee',
  LEASE_FEE: 'Recipient Mare Lease Fee',
  BOARD: 'Recipient Mare Board',
  ICSI_STALLION_FEE: 'ICSI Stallion Fee',
  EMBRYO_PURCHASE: 'Embryo Purchase',
  LATE_RETURN: 'Recipient Purchase Fee',
  RECIP_DEPOSIT: 'Recipient Mare Deposit',
  IMPLANT_FEE: 'Recipient Mare Implant Fee',
  SALE_SETTLEMENT: 'Sale Settlement',
  OTHER: 'Other Services',
  CREDIT: 'Refund',
};

/**
 * Keeps the books in step with the ledger.
 *
 * Sync is at-least-once and idempotent: every push first asks the provider whether the
 * document already exists under our code (there is no idempotency key on that side), then
 * creates or updates. Failures land on the mapping row with the provider's request id, so
 * a person can retry from the UI with the exact reference support would ask for.
 *
 * Every call to the provider goes through a circuit breaker. When the books are down, the
 * breaker opens after a few transient failures and sync jobs park until the cooldown; the
 * rest of the application never waits on the books.
 */
@Injectable()
export class AccountingService {
  private readonly logger = new Logger(AccountingService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly clock: ClockService,
    private readonly jobs: JobsService,
    private readonly outbox: OutboxService,
    private readonly breakers: CircuitBreakerRegistry,
    private readonly bus: PlatformBus,
    @Inject(ACCOUNTING_PROVIDER) private readonly provider: AccountingProvider,
  ) {
    this.breakers.configure(ACCOUNTING_DEPENDENCY, { failureThreshold: 3, cooldownMs: 20_000 });
  }

  private get db() {
    return this.prisma.client;
  }

  get mode() {
    return { mode: this.provider.mode, label: this.provider.label };
  }

  // ───────────────────────────── sync (job handler) ─────────────────────────────

  async sync(entityType: MappedEntityType, entityId: string, job: { id: string; attempt: number }): Promise<void> {
    const mapping = await this.db.accountingMapping.upsert({
      where: { entityType_entityId_provider: { entityType, entityId, provider: 'QBO' } },
      create: { entityType, entityId, provider: 'QBO', status: 'PENDING' },
      update: {},
    });
    // An open breaker is not an attempt: the job parks until the cooldown and no attempt row is written.
    if (this.breakers.stateOf(ACCOUNTING_DEPENDENCY) === 'open') {
      const retryAfterMs = this.breakers.snapshot()[ACCOUNTING_DEPENDENCY]?.retryAfterMs ?? 5_000;
      throw new DependencyUnavailableError(ACCOUNTING_DEPENDENCY, retryAfterMs);
    }
    const attempt = await this.db.syncAttempt.create({ data: { mappingId: mapping.id, jobId: job.id } });

    try {
      const result = await this.breakers.execute(
        ACCOUNTING_DEPENDENCY,
        () => this.push(entityType, entityId),
        isTransientAccountingError,
      );
      await this.db.$transaction(async (tx) => {
        await tx.accountingMapping.update({
          where: { id: mapping.id },
          data: {
            externalId: result.externalId,
            syncToken: result.syncToken,
            status: 'SYNCED',
            attempts: { increment: 1 },
            lastError: null,
            lastSyncedAt: new Date(),
          },
        });
        await tx.syncAttempt.update({
          where: { id: attempt.id },
          data: { finishedAt: new Date(), ok: true, httpStatus: 200 },
        });
        await this.audit.record(
          {
            actor: null,
            source: 'JOB',
            action: 'accounting.synced',
            entityType: entityType,
            entityId,
            after: { externalId: result.externalId, provider: this.provider.mode, attempt: job.attempt },
          },
          tx,
        );
        const payload: EntitySyncedPayload = {
          entityType,
          entityId,
          externalId: result.externalId,
          attempt: job.attempt,
        };
        await this.outbox.append(tx, {
          aggregateType: 'AccountingMapping',
          aggregateId: mapping.id,
          type: AccountingEvents.EntitySynced,
          payload,
        });
      });
      this.bus.emit({
        kind: 'integration',
        dependency: ACCOUNTING_DEPENDENCY,
        op: `${entityType} ${entityId}`,
        outcome: 'ok',
        attempt: job.attempt,
        httpStatus: 200,
        jobId: job.id,
      });
      await this.outbox.flush();
    } catch (error) {
      if (error instanceof CircuitOpenError)
        throw new DependencyUnavailableError(ACCOUNTING_DEPENDENCY, error.retryAfterMs);
      const err = error as Error & { requestId?: string | null; code?: string; retryAfterMs?: number };
      const requestId = 'requestId' in err ? (err.requestId ?? null) : null;
      const httpStatus =
        error instanceof AccountingRateLimitError
          ? 429
          : error instanceof AccountingAuthError
            ? 401
            : error instanceof AccountingTransientError
              ? 503
              : error instanceof AccountingValidationError
                ? 400
                : 500;
      await this.db.$transaction([
        this.db.accountingMapping.update({
          where: { id: mapping.id },
          data: {
            attempts: { increment: 1 },
            lastError: err.message.slice(0, 500),
            status:
              error instanceof AccountingValidationError || error instanceof AccountingAuthError
                ? 'FAILED'
                : mapping.status === 'SYNCED'
                  ? 'SYNCED'
                  : 'PENDING',
          },
        }),
        this.db.syncAttempt.update({
          where: { id: attempt.id },
          data: {
            finishedAt: new Date(),
            ok: false,
            httpStatus,
            error: err.message.slice(0, 500),
            remoteRequestId: requestId,
          },
        }),
      ]);
      this.bus.emit({
        kind: 'integration',
        dependency: ACCOUNTING_DEPENDENCY,
        op: `${entityType} ${entityId}`,
        outcome: httpStatus === 429 ? 'rate-limited' : 'fail',
        attempt: job.attempt,
        httpStatus,
        retryAfterMs: error instanceof AccountingRateLimitError ? error.retryAfterMs : undefined,
        jobId: job.id,
      });

      if (error instanceof AccountingRateLimitError) throw new RateLimitedError(error.retryAfterMs, error.message);
      // Validation and auth failures cannot be retried into success; the dead letter becomes a person's problem.
      if (error instanceof AccountingValidationError)
        throw new UnrecoverableJobError(`${error.code}: ${error.message}`);
      if (error instanceof AccountingAuthError) throw new UnrecoverableJobError(err.message);
      throw error; // transient → back-off, then dead letter
    }
  }

  private async push(
    entityType: MappedEntityType,
    entityId: string,
  ): Promise<{ externalId: string; syncToken: string | null }> {
    switch (entityType) {
      case 'CUSTOMER':
        return this.pushCustomer(entityId);
      case 'INVOICE':
        return this.pushInvoice(entityId);
      case 'PAYMENT':
        return this.pushPayment(entityId);
      case 'CREDIT':
        return this.pushCredit(entityId);
      case 'ITEM':
        return { externalId: (await this.provider.ensureItem(entityId)).id, syncToken: null };
    }
  }

  private async remoteCustomerId(customerId: string): Promise<string> {
    const mapping = await this.db.accountingMapping.findUnique({
      where: { entityType_entityId_provider: { entityType: 'CUSTOMER', entityId: customerId, provider: 'QBO' } },
    });
    if (mapping?.externalId && mapping.status === 'SYNCED') return mapping.externalId;
    const { externalId } = await this.pushCustomer(customerId);
    return externalId;
  }

  private async pushCustomer(customerId: string) {
    const customer = await this.db.customer.findUnique({ where: { id: customerId } });
    if (!customer) throw new AccountingValidationError('LOCAL_MISSING', `${customerId} does not exist`, null);
    const existing = await this.provider.findCustomerByName(customer.displayName);
    const remote =
      existing ??
      (await this.provider.createCustomer({
        displayName: customer.displayName,
        email: customer.email,
        phone: customer.phone,
      }));
    await this.db.accountingMapping.upsert({
      where: { entityType_entityId_provider: { entityType: 'CUSTOMER', entityId: customerId, provider: 'QBO' } },
      create: {
        entityType: 'CUSTOMER',
        entityId: customerId,
        provider: 'QBO',
        externalId: remote.id,
        syncToken: remote.syncToken,
        status: 'SYNCED',
        lastSyncedAt: new Date(),
        attempts: 1,
      },
      update: { externalId: remote.id, syncToken: remote.syncToken, status: 'SYNCED', lastSyncedAt: new Date() },
    });
    return { externalId: remote.id, syncToken: remote.syncToken };
  }

  private async pushInvoice(invoiceId: string) {
    const invoice = await this.db.invoice.findUnique({ where: { id: invoiceId } });
    if (!invoice) throw new AccountingValidationError('LOCAL_MISSING', `${invoiceId} does not exist`, null);
    if (invoice.status === 'DRAFT' || invoice.status === 'VOID')
      throw new AccountingValidationError('NOT_SYNCABLE', `${invoiceId} is ${invoice.status}`, null);
    const customerExternalId = await this.remoteCustomerId(invoice.customerId);
    const item = await this.provider.ensureItem(ITEM_NAMES[invoice.kind] ?? ITEM_NAMES['OTHER']!);
    const existing = await this.provider.findInvoiceByDocNumber(invoice.id);
    if (existing) {
      if (existing.totalCents !== invoice.amountCents) {
        const updated = await this.provider.updateInvoiceAmount(existing.id, existing.syncToken, invoice.amountCents);
        return { externalId: updated.id, syncToken: updated.syncToken };
      }
      return { externalId: existing.id, syncToken: existing.syncToken };
    }
    const created = await this.provider.createInvoice({
      docNumber: invoice.id,
      customerId: customerExternalId,
      itemId: item.id,
      description: invoice.description,
      amountCents: invoice.amountCents,
      txnDate: invoice.issuedOn.toISOString().slice(0, 10),
      dueDate: invoice.dueOn.toISOString().slice(0, 10),
    });
    return { externalId: created.id, syncToken: created.syncToken };
  }

  private async pushPayment(paymentId: string) {
    const payment = await this.db.payment.findUnique({ where: { id: paymentId }, include: { invoice: true } });
    if (!payment) throw new AccountingValidationError('LOCAL_MISSING', `${paymentId} does not exist`, null);
    if (payment.status !== 'SUCCEEDED' && payment.status !== 'PARTIALLY_REFUNDED' && payment.status !== 'REFUNDED')
      throw new AccountingValidationError('NOT_SETTLED', `${paymentId} is ${payment.status}`, null);
    const customerExternalId = await this.remoteCustomerId(payment.customerId);
    const existing = await this.provider.findPaymentByReference(payment.id);
    if (existing) return { externalId: existing.id, syncToken: existing.syncToken };
    let linkedInvoiceId: string | null = null;
    if (payment.invoice) {
      const invoiceMapping = await this.db.accountingMapping.findUnique({
        where: {
          entityType_entityId_provider: { entityType: 'INVOICE', entityId: payment.invoice.id, provider: 'QBO' },
        },
      });
      linkedInvoiceId = invoiceMapping?.externalId ?? (await this.pushInvoice(payment.invoice.id)).externalId;
    }
    const created = await this.provider.createPayment({
      referenceNumber: payment.id,
      customerId: customerExternalId,
      amountCents: payment.amountCents,
      txnDate: payment.receivedAt.toISOString().slice(0, 10),
      linkedInvoiceId,
    });
    return { externalId: created.id, syncToken: created.syncToken };
  }

  private async pushCredit(paymentId: string) {
    const payment = await this.db.payment.findUnique({ where: { id: paymentId }, include: { refunds: true } });
    if (!payment) throw new AccountingValidationError('LOCAL_MISSING', `${paymentId} does not exist`, null);
    const customerExternalId = await this.remoteCustomerId(payment.customerId);
    const item = await this.provider.ensureItem(ITEM_NAMES['CREDIT']!);
    let last: { id: string; syncToken: string } | null = null;
    for (const refund of payment.refunds) {
      const existing = await this.provider.findCreditByDocNumber(refund.id);
      last =
        existing ??
        (await this.provider.createCredit({
          docNumber: refund.id,
          customerId: customerExternalId,
          itemId: item.id,
          amountCents: refund.amountCents,
          txnDate: refund.createdAt.toISOString().slice(0, 10),
          description: `Refund of ${payment.id}${refund.reason ? ` — ${refund.reason}` : ''}`,
        }));
    }
    if (!last) throw new AccountingValidationError('NO_REFUNDS', `${paymentId} has no refunds to credit`, null);
    return { externalId: last.id, syncToken: last.syncToken };
  }

  // ───────────────────────────── reconciliation ─────────────────────────────

  async reconcileNow(
    requestedBy: string | null,
  ): Promise<{ findings: number; inSync: { invoices: number; payments: number } }> {
    const db = this.db;
    const [localInvoices, localPayments, customerMaps, invoiceMaps] = await Promise.all([
      db.invoice.findMany({ where: { status: { in: ['OPEN', 'PAID', 'REFUNDED'] } } }),
      db.payment.findMany({ where: { status: { in: ['SUCCEEDED', 'PARTIALLY_REFUNDED', 'REFUNDED'] } } }),
      db.accountingMapping.findMany({ where: { entityType: 'CUSTOMER', status: 'SYNCED' } }),
      db.accountingMapping.findMany({ where: { entityType: 'INVOICE', externalId: { not: null } } }),
    ]);
    const [remoteInvoices, remotePayments] = await Promise.all([
      this.provider.listInvoices(localInvoices.map((i) => i.id)),
      this.provider.listPayments(localPayments.map((p) => p.id)),
    ]);

    const result = reconcile({
      localInvoices: localInvoices.map((i) => ({
        id: i.id,
        customerId: i.customerId,
        amountCents: i.amountCents,
        status: i.status,
      })),
      localPayments: localPayments.map((p) => ({
        id: p.id,
        invoiceId: p.invoiceId,
        customerId: p.customerId,
        amountCents: p.amountCents,
        status: p.status,
        refundedCents: p.refundedCents,
      })),
      remoteInvoices: remoteInvoices.map((r) => ({
        externalId: r.id,
        docNumber: r.docNumber,
        customerExternalId: r.customerId,
        totalCents: r.totalCents,
        balanceCents: r.balanceCents,
        syncToken: r.syncToken,
      })),
      remotePayments: remotePayments.map((r) => ({
        externalId: r.id,
        referenceNumber: r.referenceNumber,
        customerExternalId: r.customerId,
        totalCents: r.totalCents,
        linkedInvoiceExternalIds: r.linkedInvoiceIds,
        syncToken: r.syncToken,
      })),
      customerMap: new Map(customerMaps.map((m) => [m.entityId, m.externalId ?? ''])),
      invoiceMap: new Map(invoiceMaps.map((m) => [m.entityId, m.externalId ?? ''])),
    });

    // Missing-remote for rows that were never pushed is PENDING, not a discrepancy.
    const pushed = new Set(invoiceMaps.filter((m) => m.status === 'SYNCED').map((m) => m.entityId));
    const paymentMaps = await db.accountingMapping.findMany({ where: { entityType: 'PAYMENT', status: 'SYNCED' } });
    for (const m of paymentMaps) pushed.add(m.entityId);

    let raised = 0;
    for (const finding of result.findings) {
      if (finding.kind === 'MISSING_REMOTE' && !pushed.has(finding.entityId)) {
        await this.jobs.enqueue(
          'qbo-sync',
          { entityType: finding.entityType, entityId: finding.entityId, reason: 'reconcile' },
          { jobId: `qbo_${finding.entityType}_${finding.entityId}_reconcile` },
        );
        continue;
      }
      const mapping = await db.accountingMapping.findUnique({
        where: {
          entityType_entityId_provider: { entityType: finding.entityType, entityId: finding.entityId, provider: 'QBO' },
        },
      });
      const open = await db.discrepancy.findFirst({
        where: { entityType: finding.entityType, entityId: finding.entityId, kind: finding.kind, resolvedAt: null },
      });
      if (open) continue;
      await this.raiseDiscrepancy({
        kind: finding.kind,
        entityType: finding.entityType,
        entityId: finding.entityId,
        mappingId: mapping?.id ?? null,
        localValue: finding.localValue,
        remoteValue: finding.remoteValue,
      });
      if (mapping)
        await db.accountingMapping.update({
          where: { id: mapping.id },
          data: { status: finding.kind === 'MISSING_LOCAL' ? 'ORPHANED' : 'MISMATCH' },
        });
      raised += 1;
    }

    for (const id of [...result.inSync.invoices, ...result.inSync.payments]) {
      await db.accountingMapping.updateMany({
        where: { entityId: id, provider: 'QBO', status: 'MISMATCH' },
        data: { status: 'SYNCED' },
      });
    }

    await this.audit.record({
      actor: null,
      source: requestedBy ? 'UI' : 'JOB',
      action: 'accounting.reconciled',
      entityType: 'Accounting',
      entityId: 'QBO',
      after: {
        findings: result.findings.length,
        raised,
        inSync: { invoices: result.inSync.invoices.length, payments: result.inSync.payments.length },
        requestedBy,
      },
    });
    await this.outbox.flush();
    return {
      findings: result.findings.length,
      inSync: { invoices: result.inSync.invoices.length, payments: result.inSync.payments.length },
    };
  }

  private async raiseDiscrepancy(input: {
    kind:
      'AMOUNT_MISMATCH' | 'CUSTOMER_MISMATCH' | 'MISSING_REMOTE' | 'MISSING_LOCAL' | 'UNLINKED_PAYMENT' | 'SYNC_FAILED';
    entityType: MappedEntityType;
    entityId: string;
    mappingId: string | null;
    localValue: unknown;
    remoteValue: unknown;
  }): Promise<void> {
    const existing = await this.db.discrepancy.findFirst({
      where: { entityType: input.entityType, entityId: input.entityId, kind: input.kind, resolvedAt: null },
    });
    if (existing) return;
    await this.db.$transaction(async (tx) => {
      const row = await tx.discrepancy.create({
        data: {
          kind: input.kind,
          entityType: input.entityType,
          entityId: input.entityId,
          mappingId: input.mappingId,
          localValue: input.localValue as Prisma.InputJsonValue,
          remoteValue: input.remoteValue as Prisma.InputJsonValue,
        },
      });
      const payload: DiscrepancyRaisedPayload = {
        discrepancyId: row.id,
        kind: row.kind,
        entityType: row.entityType,
        entityId: row.entityId,
        localValue: input.localValue,
        remoteValue: input.remoteValue,
      };
      await this.outbox.append(tx, {
        aggregateType: 'Discrepancy',
        aggregateId: row.id,
        type: AccountingEvents.DiscrepancyRaised,
        payload,
      });
    });
  }

  // ───────────────────────────── human resolution ─────────────────────────────

  async resolve(actor: Actor, discrepancyId: string, resolution: DiscrepancyResolution, note: string | null) {
    const discrepancy = await this.db.discrepancy.findUnique({ where: { id: discrepancyId } });
    if (!discrepancy) throw new NotFoundException('discrepancy not found');
    if (discrepancy.resolvedAt) throw new BadRequestException('already resolved');

    await this.db.$transaction(async (tx) => {
      await tx.discrepancy.update({
        where: { id: discrepancyId },
        data: { resolvedAt: new Date(), resolution, resolvedById: actor.userId, note },
      });
      await this.audit.record(
        {
          actor,
          source: 'UI',
          action: 'discrepancy.resolved',
          entityType: discrepancy.entityType,
          entityId: discrepancy.entityId,
          before: { kind: discrepancy.kind, localValue: discrepancy.localValue, remoteValue: discrepancy.remoteValue },
          after: { resolution, note },
        },
        tx,
      );
      if (
        resolution === 'ACCEPT_REMOTE' &&
        discrepancy.kind === 'AMOUNT_MISMATCH' &&
        discrepancy.entityType === 'INVOICE'
      ) {
        const remote = discrepancy.remoteValue as { amountCents?: number } | null;
        if (remote?.amountCents !== undefined) {
          const before = await tx.invoice.findUnique({ where: { id: discrepancy.entityId } });
          await tx.invoice.update({ where: { id: discrepancy.entityId }, data: { amountCents: remote.amountCents } });
          await this.audit.record(
            {
              actor,
              source: 'UI',
              action: 'invoice.amount_accepted_from_books',
              entityType: 'Invoice',
              entityId: discrepancy.entityId,
              before: { amountCents: before?.amountCents },
              after: { amountCents: remote.amountCents },
            },
            tx,
          );
        }
      }
      if (discrepancy.mappingId) {
        await tx.accountingMapping.update({
          where: { id: discrepancy.mappingId },
          data: { status: resolution === 'IGNORE' ? 'SYNCED' : 'PENDING' },
        });
      }
      if ((resolution === 'REPUSH_LOCAL' || resolution === 'RETRY') && discrepancy.entityType !== 'ITEM') {
        const entityType = discrepancy.entityType;
        await this.jobs.enqueue(
          'qbo-sync',
          { entityType, entityId: discrepancy.entityId, reason: resolution.toLowerCase() },
          { jobId: `qbo_${entityType}_${discrepancy.entityId}_${resolution.toLowerCase()}_${Date.now()}`, tx },
        );
      }
      const payload: DiscrepancyResolvedPayload = { discrepancyId, resolution, resolvedBy: actor.userId };
      await this.outbox.append(tx, {
        aggregateType: 'Discrepancy',
        aggregateId: discrepancyId,
        type: AccountingEvents.DiscrepancyResolved,
        payload,
      });
    });
    await this.outbox.flush();
    await this.jobs.flushPending();
    return { resolved: true };
  }

  async retryMapping(actor: Actor, mappingId: string) {
    const mapping = await this.db.accountingMapping.findUnique({ where: { id: mappingId } });
    if (!mapping) throw new NotFoundException('mapping not found');
    if (mapping.entityType === 'ITEM') throw new BadRequestException('items are synced on demand');
    await this.audit.record({
      actor,
      source: 'UI',
      action: 'accounting.retry',
      entityType: mapping.entityType,
      entityId: mapping.entityId,
    });
    return this.jobs.enqueue(
      'qbo-sync',
      { entityType: mapping.entityType, entityId: mapping.entityId, reason: 'manual-retry' },
      { jobId: `qbo_${mapping.entityType}_${mapping.entityId}_retry_${Date.now()}` },
    );
  }

  // ───────────────────────────── reads ─────────────────────────────

  async summary() {
    const db = this.db;
    const [byStatus, openDiscrepancies, recentAttempts, unsyncedInvoices, unsyncedPayments] = await Promise.all([
      db.accountingMapping.groupBy({ by: ['entityType', 'status'], _count: { _all: true } }),
      db.discrepancy.count({ where: { resolvedAt: null } }),
      db.syncAttempt.findMany({ orderBy: { startedAt: 'desc' }, take: 20, include: { mapping: true } }),
      db.invoice.count({
        where: {
          status: { in: ['OPEN', 'PAID'] },
          id: {
            notIn: (
              await db.accountingMapping.findMany({
                where: { entityType: 'INVOICE', status: 'SYNCED' },
                select: { entityId: true },
              })
            ).map((m) => m.entityId),
          },
        },
      }),
      db.payment.count({
        where: {
          status: 'SUCCEEDED',
          id: {
            notIn: (
              await db.accountingMapping.findMany({
                where: { entityType: 'PAYMENT', status: 'SYNCED' },
                select: { entityId: true },
              })
            ).map((m) => m.entityId),
          },
        },
      }),
    ]);
    return {
      provider: this.mode,
      byStatus,
      openDiscrepancies,
      recentAttempts,
      unsynced: { invoices: unsyncedInvoices, payments: unsyncedPayments },
      jobsMode: this.jobs.mode,
    };
  }

  async mappings(entityType?: string) {
    // Found by API fuzzing: an unknown entity type reached Prisma and came back as a 500.
    const filter = entityType ? z.enum(MappedEntityType).parse(entityType) : undefined;
    return this.db.accountingMapping.findMany({
      where: filter ? { entityType: filter } : {},
      orderBy: [{ status: 'asc' }, { updatedAt: 'desc' }],
      take: 300,
      include: { syncAttempts: { orderBy: { startedAt: 'desc' }, take: 3 } },
    });
  }

  async discrepancies(includeResolved = false) {
    return this.db.discrepancy.findMany({
      where: includeResolved ? {} : { resolvedAt: null },
      orderBy: { detectedAt: 'desc' },
      take: 200,
      include: { resolvedBy: { select: { name: true } }, mapping: true },
    });
  }

  async booksView() {
    return this.db.simulatorRecord.findMany({
      where: { provider: 'QBO' },
      orderBy: [{ entityType: 'asc' }, { updatedAt: 'desc' }],
      take: 500,
    });
  }
}

/** Only failures that say "try later" count against the breaker; the books disagreeing with us is not an outage. */
function isTransientAccountingError(error: unknown): boolean {
  return error instanceof AccountingTransientError || error instanceof AccountingRateLimitError;
}
