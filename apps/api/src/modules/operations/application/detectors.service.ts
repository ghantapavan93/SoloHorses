import { Injectable, Logger } from '@nestjs/common';
import {
  addDays,
  barnLocalToUtc,
  evaluateDeparture,
  evaluatePlannedRecipient,
  evaluateRecipReturn,
  evaluateRegistrationRelease,
  evaluateTransferClearance,
  gestationDay,
  nextMilestoneDay,
  settlementDueOn,
  settlementSourcesAgree,
  REGISTRATION_RELEASE_POLICY,
  SETTLEMENT_DUE_TIME,
  type ClearanceRecord,
} from '@daysheet/domain';
import type { ExceptionKind } from '@daysheet/db';
import { AuditService } from '../../../platform/audit/audit.service';
import { ClockService } from '../../../platform/clock/clock.service';
import { PrismaService } from '../../../platform/persistence/prisma.service';
import type { RaiseExceptionInput } from '../domain/exceptions';
import { ExceptionsService } from './exceptions.service';

/**
 * Deterministic detectors for the operation's known invariants. Each one is a query and a
 * rule — `if plannedRecipientId === null` — not a model. They run every minute, after the
 * events that could change their answer, and on demand; a condition that clears resolves
 * its own exception on the next sweep.
 *
 * Time is the barn's: the demo clock freezes "today", so ages are measured from that day.
 */
const DETECTOR_KINDS: readonly ExceptionKind[] = [
  'RECIPIENT_MISSING',
  'RECIPIENT_CONFLICT',
  'CLEARANCE_MISSING',
  'CHECK_OVERDUE',
  'SHIP_BLOCKED',
  'INTAKE_UNCONFIRMED',
  'CONFLICTING_RECORD',
  'WEBHOOK_FAILED',
  'PAPERS_HELD',
  'SETTLEMENT_CONFLICT',
  'RETURN_ASSESSMENT_MISSING',
  'DEPARTURE_UNCONFIRMED',
  'RETURN_FEE_DECISION',
  'PAPERS_RELEASED_FUNDS_RETURNED',
];

/** A milestone this many days past with no check recorded is overdue, not merely due. */
const OVERDUE_GRACE_DAYS = 3;

@Injectable()
export class DetectorsService {
  private readonly logger = new Logger(DetectorsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly exceptions: ExceptionsService,
    private readonly clock: ClockService,
    private readonly audit: AuditService,
  ) {}

  private get db() {
    return this.prisma.client;
  }

  async detectAll(requestedBy: string | null): Promise<{ raised: number; stillOpen: number; resolved: number }> {
    const today = this.clock.today();
    const findings: RaiseExceptionInput[] = [
      ...(await this.recipientMissing(today)),
      ...(await this.plannedRecipientProblems(today)),
      ...(await this.checksOverdue(today)),
      ...(await this.shipBlocked(today)),
      ...(await this.intakeUnconfirmed(today)),
      ...(await this.conflictingChecks()),
      ...(await this.failedWebhooks()),
      ...(await this.papersHeld()),
      ...(await this.papersReleasedFundsReturned()),
      ...(await this.settlementConflicts()),
      ...(await this.recipReturns(today)),
      ...(await this.departures(today)),
    ];
    let raised = 0;
    for (const finding of findings) {
      const { created } = await this.exceptions.raise(finding);
      if (created) raised += 1;
    }
    const resolved = await this.exceptions.resolveStale(
      DETECTOR_KINDS,
      new Set(findings.map((f) => f.dedupeKey)),
      'condition cleared on the next sweep',
    );
    if (raised > 0 || resolved > 0)
      this.logger.log(`detection: ${raised} raised, ${resolved} resolved, ${findings.length} open`);
    await this.audit.record({
      actor: null,
      source: requestedBy ? 'UI' : 'JOB',
      action: 'exceptions.detected',
      entityType: 'Operations',
      entityId: 'board',
      after: { raised, resolved, open: findings.length, requestedBy },
    });
    return { raised, stillOpen: findings.length, resolved };
  }

  /**
   * RegistrationReleasePolicy: a sold lot whose papers are held because the money behind it
   * has not cleared. An initiated ACH debit is not cleared funds. The rule is the domain's;
   * this only asks it about every held document.
   */
  private async papersHeld(): Promise<RaiseExceptionInput[]> {
    const held = await this.db.document.findMany({
      where: { status: 'HELD' },
      include: { lot: { include: { invoice: { include: { payments: true } } } } },
    });
    const out: RaiseExceptionInput[] = [];
    for (const doc of held) {
      const invoice = doc.lot.invoice;
      if (!invoice) continue;
      const verdict = evaluateRegistrationRelease(
        { id: doc.lot.id, documentId: doc.id },
        { id: invoice.id, amountCents: invoice.amountCents, status: invoice.status },
        invoice.payments.map((p) => ({ id: p.id, status: p.status, method: p.method, amountCents: p.amountCents })),
      );
      if (verdict.ok) continue; // eligible but not yet marked: the billing consumer does that; nothing for a person here
      const payment =
        invoice.payments.find((p) => p.status === 'PROCESSING' || p.status === 'PENDING') ??
        invoice.payments[0] ??
        null;
      const dueOn = settlementDueOn(doc.lot.closedOn.toISOString().slice(0, 10));
      out.push({
        kind: 'PAPERS_HELD',
        dedupeKey: `papers-held:${doc.id}`,
        title: `${doc.lot.id} (${doc.lot.title}): ${verdict.reason}; settlement due ${dueOn} ${SETTLEMENT_DUE_TIME}`,
        detail: {
          code: verdict.code,
          lotId: doc.lot.id,
          invoiceId: invoice.id,
          paymentId: payment?.id ?? null,
          method: payment?.method ?? null,
          paymentStatus: payment?.status ?? 'NONE',
          funds: verdict.code.replace('SETTLEMENT_', ''),
          documentId: doc.id,
          documentStatus: doc.status,
          dueOn,
          policy: REGISTRATION_RELEASE_POLICY,
          evidenceIds: verdict.evidenceIds,
          customerId: doc.lot.buyerId,
        },
        entityType: 'Document',
        entityId: doc.id,
      });
    }
    return out;
  }

  /** The one thing software cannot undo: a certificate that went out before the bank took the money back. */
  private async papersReleasedFundsReturned(): Promise<RaiseExceptionInput[]> {
    const released = await this.db.document.findMany({
      where: { status: 'RELEASED' },
      include: { lot: { include: { invoice: { include: { payments: true } } } } },
    });
    const out: RaiseExceptionInput[] = [];
    for (const doc of released) {
      const invoice = doc.lot.invoice;
      const returned = invoice?.payments.find((p) => p.status === 'RETURNED');
      if (!invoice || !returned) continue;
      const releasedBy = doc.releasedById
        ? await this.db.user.findUnique({ where: { id: doc.releasedById }, select: { name: true } })
        : null;
      out.push({
        kind: 'PAPERS_RELEASED_FUNDS_RETURNED',
        dedupeKey: `papers-released-returned:${doc.id}`,
        title: `${doc.lot.id} (${doc.lot.title}): the registration papers were released${releasedBy ? ` by ${releasedBy.name}` : ''} and the bank has since returned the ${returned.method.toLowerCase()} debit ${returned.id}; a person acts today`,
        detail: {
          lotId: doc.lot.id,
          invoiceId: invoice.id,
          paymentId: returned.id,
          documentId: doc.id,
          releasedBy: releasedBy?.name ?? null,
          reason: returned.failureReason,
          evidenceIds: [doc.lot.id, doc.id, invoice.id, returned.id],
          customerId: doc.lot.buyerId,
        },
        entityType: 'Document',
        entityId: doc.id,
      });
    }
    return out;
  }

  /**
   * The ledger's payment row against the provider's latest word on the same intent, taken
   * from the inbox. A disagreement is raised, never resolved by picking a side.
   */
  private async settlementConflicts(): Promise<RaiseExceptionInput[]> {
    const lots = await this.db.saleLot.findMany({
      include: { invoice: { include: { payments: true } }, documents: true },
    });
    const out: RaiseExceptionInput[] = [];
    for (const lot of lots) {
      for (const payment of lot.invoice?.payments ?? []) {
        if (!payment.stripePaymentIntentId) continue;
        const latest = await this.db.integrationEvent.findFirst({
          where: {
            provider: 'STRIPE',
            type: { startsWith: 'payment_intent.' },
            payload: { path: ['data', 'object', 'id'], equals: payment.stripePaymentIntentId },
          },
          orderBy: { receivedAt: 'desc' },
        });
        if (!latest) continue;
        const word = latest.type.replace('payment_intent.', '') as
          'processing' | 'succeeded' | 'payment_failed' | 'canceled';
        const verdict = settlementSourcesAgree(payment.status, word === 'payment_failed' ? 'failed' : word);
        if (verdict.ok) continue;
        out.push({
          kind: 'SETTLEMENT_CONFLICT',
          dedupeKey: `settlement-conflict:${payment.id}`,
          title: `${lot.id}: ${verdict.reason}`,
          detail: {
            code: verdict.code,
            lotId: lot.id,
            invoiceId: lot.invoice?.id ?? null,
            paymentId: payment.id,
            ledgerStatus: payment.status,
            providerLatest: `${word} (${latest.externalId})`,
            documentStatus: lot.documents[0]?.status ?? 'NONE',
            evidenceIds: [lot.id, payment.id, latest.externalId],
            customerId: lot.buyerId,
          },
          entityType: 'Payment',
          entityId: payment.id,
        });
      }
    }
    return out;
  }

  /** The sale's condition on a recip sold in utero: back after weaning, open and in good health — decided by a person, on the vet's record. */
  private async recipReturns(today: string): Promise<RaiseExceptionInput[]> {
    const lots = await this.db.saleLot.findMany({
      where: { kind: 'IN_UTERO', recipId: { not: null } },
      include: {
        recip: {
          include: {
            clearances: {
              where: { kind: 'RETURN_ASSESSMENT' },
              orderBy: [{ performedOn: 'desc' }, { createdAt: 'desc' }],
              take: 1,
            },
          },
        },
      },
    });
    const out: RaiseExceptionInput[] = [];
    for (const lot of lots) {
      const recip = lot.recip;
      if (!recip) continue;
      const assessment = recip.clearances[0] ?? null;
      const verdict = evaluateRecipReturn(
        {
          recipId: recip.id,
          lotId: lot.id,
          weanedOn: recip.weanedOn?.toISOString().slice(0, 10) ?? null,
          returnedOn: recip.returnedOn?.toISOString().slice(0, 10) ?? null,
          assessment: assessment
            ? {
                id: assessment.id,
                kind: assessment.kind,
                result: assessment.result,
                performedOn: assessment.performedOn.toISOString().slice(0, 10),
                expiresOn: assessment.expiresOn?.toISOString().slice(0, 10) ?? null,
              }
            : null,
        },
        today,
      );
      if (verdict.ok || verdict.code === 'RETURN_ASSESSMENT_PENDING') continue; // pending: the vet is on it; nothing for anyone else yet
      const detail = {
        code: verdict.code,
        lotId: lot.id,
        recipId: recip.id,
        weanedOn: recip.weanedOn?.toISOString().slice(0, 10) ?? null,
        returnedOn: recip.returnedOn?.toISOString().slice(0, 10) ?? null,
        assessment: assessment
          ? `${assessment.result.toLowerCase()} (${assessment.id}, ${assessment.performedOn.toISOString().slice(0, 10)})`
          : null,
        evidenceIds: verdict.evidenceIds,
        customerId: lot.buyerId,
      };
      if (verdict.code === 'RETURN_ASSESSMENT_MISSING') {
        out.push({
          kind: 'RETURN_ASSESSMENT_MISSING',
          dedupeKey: `return-assessment:${recip.id}`,
          title: `${recip.id} (Recip #${recip.recipNumber ?? '?'}, ${lot.id}): ${verdict.reason}`,
          detail,
          entityType: 'Horse',
          entityId: recip.id,
        });
        continue;
      }
      // RETURN_CONDITION_NOT_MET or RETURN_OVERDUE: the vet's record (or the calendar) says the condition failed; the $6,000 is a person's call.
      out.push({
        kind: 'RETURN_FEE_DECISION',
        dedupeKey: `return-fee:${recip.id}`,
        title: `${recip.id} (Recip #${recip.recipNumber ?? '?'}, ${lot.id}): ${verdict.reason}`,
        detail,
        entityType: 'Horse',
        entityId: recip.id,
      });
    }
    return out;
  }

  /** The lease's condition on a recip leaving with her client: video-confirmed in foal within three days. */
  private async departures(today: string): Promise<RaiseExceptionInput[]> {
    const recips = await this.db.horse.findMany({
      where: { kind: 'RECIPIENT', scheduledDepartureOn: { not: null } },
      include: {
        clearances: { where: { kind: 'VIDEO_IN_FOAL' }, orderBy: [{ performedOn: 'desc' }, { createdAt: 'desc' }] },
      },
    });
    const out: RaiseExceptionInput[] = [];
    for (const recip of recips) {
      const clearances: ClearanceRecord[] = recip.clearances.map((c) => ({
        id: c.id,
        kind: c.kind,
        result: c.result,
        performedOn: c.performedOn.toISOString().slice(0, 10),
        expiresOn: c.expiresOn?.toISOString().slice(0, 10) ?? null,
      }));
      const verdict = evaluateDeparture(
        {
          id: recip.id,
          scheduledDepartureOn: recip.scheduledDepartureOn?.toISOString().slice(0, 10) ?? null,
          clearances,
        },
        today,
      );
      if (verdict.ok) continue;
      out.push({
        kind: 'DEPARTURE_UNCONFIRMED',
        dedupeKey: `departure:${recip.id}`,
        title: `${recip.id} (Recip #${recip.recipNumber ?? '?'}): ${verdict.reason}`,
        detail: {
          code: verdict.code,
          recipId: recip.id,
          scheduledDepartureOn: recip.scheduledDepartureOn?.toISOString().slice(0, 10) ?? null,
          latestVideoOn: clearances[0]?.performedOn ?? null,
          evidenceIds: verdict.evidenceIds,
        },
        entityType: 'Horse',
        entityId: recip.id,
      });
    }
    return out;
  }

  /** RecipientRequiredForScheduledTransfer: an embryo due inside the transfer window with no recip set aside. */
  private async recipientMissing(today: string): Promise<RaiseExceptionInput[]> {
    const windowEnd = barnLocalToUtc(addDays(today, 2), 0);
    const windowStart = barnLocalToUtc(addDays(today, -1), 0);
    const embryos = await this.db.embryo.findMany({
      where: {
        status: { in: ['EXPECTED', 'IN_TRANSIT', 'ARRIVED'] },
        plannedRecipientId: null,
        transfers: { none: {} },
        OR: [{ expectedOn: { gte: windowStart, lt: windowEnd } }, { status: 'ARRIVED' }],
      },
      include: { customer: true },
    });
    return embryos.map((e) => ({
      kind: 'RECIPIENT_MISSING',
      dedupeKey: `recipient-missing:${e.id}`,
      title: `${e.id} (${e.customer.displayName}) is ${e.status === 'ARRIVED' ? 'here' : `expected ${e.expectedOn ? e.expectedOn.toISOString().slice(0, 10) : 'soon'}`} and no recip is set aside`,
      detail: { expectedOn: e.expectedOn?.toISOString() ?? null, status: e.status, customerId: e.customerId },
      entityType: 'Embryo',
      entityId: e.id,
    }));
  }

  /**
   * The two rules a transfer runs, applied ahead of time to every embryo that has a recip set
   * aside: can she carry it (RECIPIENT_CONFLICT), and has the vet cleared her (CLEARANCE_MISSING)?
   * Same functions, same verdicts, same codes as the transfer endpoint and the assistant.
   */
  private async plannedRecipientProblems(today: string): Promise<RaiseExceptionInput[]> {
    const embryos = await this.db.embryo.findMany({
      where: {
        status: { in: ['EXPECTED', 'IN_TRANSIT', 'ARRIVED', 'FROZEN'] },
        plannedRecipientId: { not: null },
        transfers: { none: {} },
      },
      include: {
        customer: true,
        plannedRecipient: {
          include: {
            clearances: { orderBy: { performedOn: 'desc' } },
            plannedEmbryos: { select: { id: true } },
            transfers: {
              where: { embryo: { status: { in: ['TRANSFERRED', 'PREGNANT'] } } },
              select: { embryoId: true },
              take: 1,
            },
          },
        },
      },
    });
    const out: RaiseExceptionInput[] = [];
    for (const e of embryos) {
      const recip = e.plannedRecipient;
      if (!recip) continue;
      const when =
        e.status === 'ARRIVED' || e.status === 'FROZEN'
          ? 'is here'
          : `arrives ${e.expectedOn ? e.expectedOn.toISOString().slice(0, 10) : 'soon'}`;
      const availability = evaluatePlannedRecipient({
        recip: { id: recip.id, recipStatus: recip.recipStatus },
        embryoId: e.id,
        otherPlannedEmbryoIds: recip.plannedEmbryos.map((p) => p.id).filter((id) => id !== e.id),
        carryingEmbryoId: recip.transfers[0]?.embryoId ?? null,
      });
      if (!availability.ok) {
        out.push({
          kind: 'RECIPIENT_CONFLICT',
          dedupeKey: `recipient-conflict:${e.id}`,
          title: `${e.id} (${e.customer.displayName}) is written down for Recip #${recip.recipNumber ?? '?'}, but ${availability.reason}`,
          detail: {
            code: availability.code,
            recipId: recip.id,
            carryingEmbryoId: recip.transfers[0]?.embryoId ?? null,
            evidenceIds: availability.evidenceIds,
            customerId: e.customerId,
          },
          entityType: 'Embryo',
          entityId: e.id,
        });
        continue;
      }
      const clearances: ClearanceRecord[] = recip.clearances.map((c) => ({
        id: c.id,
        kind: c.kind,
        result: c.result,
        performedOn: c.performedOn.toISOString().slice(0, 10),
        expiresOn: c.expiresOn?.toISOString().slice(0, 10) ?? null,
      }));
      const clearance = evaluateTransferClearance({ id: recip.id, clearances }, today);
      if (!clearance.ok) {
        out.push({
          kind: 'CLEARANCE_MISSING',
          dedupeKey: `clearance-missing:${e.id}`,
          title: `${e.id} ${when} and Recip #${recip.recipNumber ?? '?'} is not cleared for a transfer: ${clearance.reason}`,
          detail: {
            code: clearance.code,
            recipId: recip.id,
            evidenceIds: clearance.evidenceIds,
            customerId: e.customerId,
          },
          entityType: 'Embryo',
          entityId: e.id,
        });
      }
    }
    return out;
  }

  /** A milestone (14, 24, 45…) crossed more than the grace period ago with no check at or after it. */
  private async checksOverdue(today: string): Promise<RaiseExceptionInput[]> {
    const transfers = await this.db.transfer.findMany({
      where: { embryo: { status: { in: ['TRANSFERRED', 'PREGNANT'] } } },
      include: {
        embryo: { include: { customer: true } },
        recipient: true,
        checks: { orderBy: { dayNumber: 'desc' }, take: 1 },
      },
    });
    const out: RaiseExceptionInput[] = [];
    for (const t of transfers) {
      const day = gestationDay(t.performedOn.toISOString().slice(0, 10), today);
      const last = t.checks[0] ?? null;
      const next = nextMilestoneDay(last?.dayNumber ?? 0);
      if (next === null || day < next + OVERDUE_GRACE_DAYS) continue;
      out.push({
        kind: 'CHECK_OVERDUE',
        dedupeKey: `check-overdue:${t.id}:${next}`,
        title: `${t.embryoId} in Recip #${t.recipient.recipNumber ?? '?'} is at day ${day}; the day-${next} check was never recorded`,
        detail: {
          transferId: t.id,
          gestationDay: day,
          milestone: next,
          lastCheck: last ? { day: last.dayNumber, result: last.result } : null,
          customerId: t.embryo.customerId,
        },
        entityType: 'Embryo',
        entityId: t.embryoId,
      });
    }
    return out;
  }

  /** An order holding for payment or signature with the collection day upon us. */
  private async shipBlocked(today: string): Promise<RaiseExceptionInput[]> {
    const until = barnLocalToUtc(addDays(today, 1), 23, 59);
    const orders = await this.db.semenOrder.findMany({
      where: { status: 'HOLD_UNPAID', requestedFor: { lte: until } },
      include: { contract: { include: { customer: true, stallion: true } } },
    });
    return orders.map((o) => ({
      kind: 'SHIP_BLOCKED',
      dedupeKey: `ship-blocked:${o.id}`,
      title: `${o.id} for ${o.requestedFor.toISOString().slice(0, 10)} (${o.contract.stallion.name} → ${o.shipToVet}) is holding: ${o.contract.customer.displayName}'s contract ${o.contractId} is not shippable`,
      detail: {
        contractId: o.contractId,
        contractStatus: o.contract.status,
        requestedFor: o.requestedFor.toISOString(),
        customerId: o.contract.customerId,
      },
      entityType: 'Contract',
      entityId: o.contractId,
    }));
  }

  /** "A text is not confirmed until we reply": parsed a day ago and still waiting on a person. */
  private async intakeUnconfirmed(today: string): Promise<RaiseExceptionInput[]> {
    const cutoff = barnLocalToUtc(addDays(today, -1), 0);
    const messages = await this.db.message.findMany({
      where: { direction: 'IN', status: 'PARSED', createdAt: { lt: cutoff } },
      include: { customer: true },
    });
    return messages.map((m) => ({
      kind: 'INTAKE_UNCONFIRMED',
      dedupeKey: `intake-unconfirmed:${m.id}`,
      title: `A text from ${m.customer?.displayName ?? m.fromAddress} on ${m.createdAt.toISOString().slice(0, 10)} was parsed but never confirmed`,
      detail: { messageId: m.id, body: m.body.slice(0, 160), customerId: m.customerId },
      entityType: 'Message',
      entityId: m.id,
    }));
  }

  /** Two checks on the same transfer and day that disagree. The assistant will flag the conflict; a person picks. */
  private async conflictingChecks(): Promise<RaiseExceptionInput[]> {
    const groups = await this.db.pregnancyCheck.groupBy({
      by: ['transferId', 'dayNumber'],
      _count: { _all: true },
      having: { transferId: { _count: { gt: 1 } } },
    });
    const out: RaiseExceptionInput[] = [];
    for (const g of groups) {
      const checks = await this.db.pregnancyCheck.findMany({
        where: { transferId: g.transferId, dayNumber: g.dayNumber },
        include: { transfer: true },
        orderBy: { createdAt: 'asc' },
      });
      const results = new Set(checks.map((c) => c.result));
      if (results.size < 2) continue;
      const embryoId = checks[0]?.transfer.embryoId ?? '?';
      out.push({
        kind: 'CONFLICTING_RECORD',
        dedupeKey: `conflicting-checks:${g.transferId}:${g.dayNumber}`,
        title: `${embryoId} has ${checks.length} day-${g.dayNumber} checks that disagree: ${checks.map((c) => `${c.id} ${c.result.toLowerCase()}`).join(' vs ')}`,
        detail: {
          transferId: g.transferId,
          dayNumber: g.dayNumber,
          checks: checks.map((c) => ({
            id: c.id,
            result: c.result,
            recordedById: c.recordedById,
            at: c.createdAt.toISOString(),
          })),
        },
        entityType: 'Embryo',
        entityId: embryoId,
      });
    }
    return out;
  }

  /** An inbound event the pipeline could not apply. The dead-letter path raises the job; this raises the fact. */
  private async failedWebhooks(): Promise<RaiseExceptionInput[]> {
    const rows = await this.db.integrationEvent.findMany({
      where: { status: 'FAILED' },
      orderBy: { receivedAt: 'desc' },
      take: 50,
    });
    return rows.map((r) => ({
      kind: 'WEBHOOK_FAILED',
      dedupeKey: `webhook-failed:${r.id}`,
      title: `${r.provider} ${r.type} (${r.externalId}) failed to apply: ${r.error ?? 'unknown error'}`,
      detail: { integrationEventId: r.id, externalId: r.externalId, error: r.error },
      entityType: 'IntegrationEvent',
      entityId: r.externalId,
      correlationId: r.correlationId,
    }));
  }
}
