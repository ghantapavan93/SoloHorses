import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { canSeeRecord, type Actor, paymentTransition, providerEventApplies } from '@daysheet/domain';
import type { Invoice, PaymentMethod, PaymentStatus, Prisma } from '@daysheet/db';
import { AuditService } from '../../../platform/audit/audit.service';
import { CodesService } from '../../../platform/codes/codes.service';
import { OutboxService } from '../../../platform/events/outbox.service';
import { currentCorrelationId } from '../../../platform/observability/correlation';
import { PrismaService } from '../../../platform/persistence/prisma.service';
import { JobsService, UnrecoverableJobError } from '../../../platform/queue/jobs.service';
import { BillingEvents, type InvoicePaidPayload, type PaymentEventPayload } from '../domain/events';
import { IntegrationEventsService } from '../infrastructure/integration-events.service';
import { StripeService } from '../infrastructure/stripe.service';

/**
 * Turns Stripe events into ledger state. Everything here is idempotent:
 *  - the IntegrationEvent inbox rejects duplicate deliveries before we get here
 *  - Payment rows are unique on the Stripe payment-intent id, so two events describing the
 *    same money (invoice.paid + payment_intent.succeeded) converge on one row
 *  - status only moves forward (PROCESSING → SUCCEEDED, never back)
 *  - with a real key, the current object is fetched from Stripe before anything is written:
 *    the event says what happened once, the object says what is true now
 *
 * Billing writes the ledger and announces what happened (PaymentSucceeded, InvoicePaid…)
 * through the outbox in the same transaction. The accounting sync, the contract state and
 * the collection sheet follow from those events; nothing here enqueues a job after a commit.
 */

/** The subset of a Stripe event we rely on, shaped so the simulator can produce it too. */
interface StripeLikeEvent {
  id: string;
  type: string;
  data: { object: Record<string, unknown> };
}

/** What a payment intent's current Stripe status means for the ledger; null when it says nothing yet. */
export function ledgerStatusOf(intentStatus: string): PaymentStatus | null {
  switch (intentStatus) {
    case 'succeeded':
      return 'SUCCEEDED';
    case 'processing':
      return 'PROCESSING';
    case 'canceled':
      return 'FAILED';
    default:
      return null; // requires_payment_method, requires_action, requires_confirmation, requires_capture
  }
}

/** Why an event was set aside without touching the ledger. */
interface Applied {
  handled: boolean;
  reason?: string;
}

@Injectable()
export class PaymentsService {
  private readonly logger = new Logger(PaymentsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly stripe: StripeService,
    private readonly events: IntegrationEventsService,
    private readonly jobs: JobsService,
    private readonly codes: CodesService,
    private readonly outbox: OutboxService,
  ) {}

  private get db() {
    return this.prisma.client;
  }

  // ───────────────────────────── inbound: webhook / simulator → inbox → job ─────────────────────────────

  async ingestStripeEvent(
    event: StripeLikeEvent,
    simulated: boolean,
  ): Promise<{ received: true; duplicate: boolean; eventId: string; mode: string; deliveries: number }> {
    const result = await this.events.ingest('STRIPE', event.id, event.type, { ...event, simulated });
    if (result.duplicate) {
      this.logger.log(
        `duplicate Stripe delivery ignored: ${event.id} (${result.status}, delivery #${result.deliveries})`,
      );
      return { received: true, duplicate: true, eventId: event.id, mode: 'inbox', deliveries: result.deliveries };
    }
    const { mode } = await this.jobs.enqueue(
      'stripe-event',
      { integrationEventId: result.id },
      { jobId: `stripe_${event.id}` },
    );
    return { received: true, duplicate: false, eventId: event.id, mode, deliveries: 1 };
  }

  /** Job handler. Re-reads the inbox row so a retried job sees the latest state. */
  async processIntegrationEvent(integrationEventId: string): Promise<void> {
    const row = await this.db.integrationEvent.findUnique({ where: { id: integrationEventId } });
    if (!row) throw new UnrecoverableJobError(`integration event ${integrationEventId} vanished`);
    if (row.status === 'PROCESSED' || row.status === 'IGNORED') return;
    const event = row.payload as unknown as StripeLikeEvent & { simulated?: boolean };
    try {
      // The ambient correlation (the job's, inherited from the webhook) keeps the audit rows in one trace.
      const applied = await this.apply(
        event,
        Boolean(event.simulated),
        currentCorrelationId() ?? row.correlationId ?? row.id,
      );
      if (applied.handled) await this.events.markProcessed(row.id);
      else await this.events.markIgnored(row.id, applied.reason ?? `no handler for ${event.type}`);
    } catch (error) {
      await this.events.markFailed(row.id, (error as Error).message);
      throw error;
    }
  }

  private async apply(event: StripeLikeEvent, simulated: boolean, correlationId: string): Promise<Applied> {
    const obj = event.data.object;
    const canonical = !simulated && this.stripe.live;
    switch (event.type) {
      case 'invoice.paid':
      case 'invoice.payment_succeeded': {
        if (canonical) {
          const now = await this.stripe.currentInvoice(String(obj['id']));
          if (now.status !== 'paid')
            return {
              handled: false,
              reason: `Stripe invoice ${String(obj['id'])} is ${now.status ?? 'unknown'} now, not paid; nothing booked`,
            };
          await this.onInvoicePaid({ ...obj, amount_paid: now.amountPaidCents }, simulated, correlationId);
          return { handled: true };
        }
        await this.onInvoicePaid(obj, simulated, correlationId);
        return { handled: true };
      }
      case 'invoice.payment_failed':
        await this.onPaymentOutcome(obj, 'FAILED', simulated, correlationId, 'invoice');
        return { handled: true };
      case 'payment_intent.processing':
      case 'payment_intent.succeeded':
      case 'payment_intent.payment_failed': {
        const said: PaymentStatus =
          event.type === 'payment_intent.succeeded'
            ? 'SUCCEEDED'
            : event.type === 'payment_intent.processing'
              ? 'PROCESSING'
              : 'FAILED';
        if (!canonical) {
          await this.onPaymentOutcome(obj, said, simulated, correlationId, 'payment_intent');
          return { handled: true };
        }
        // The event is one delivery in an unknown order; the intent is what is true now.
        const now = await this.stripe.currentPaymentIntent(String(obj['id']));
        const status = ledgerStatusOf(now.status) ?? said;
        if (status !== said)
          this.logger.log(
            `payment intent ${String(obj['id'])}: the event said ${said}, Stripe says ${now.status}; applying ${status}`,
          );
        const reconciled = {
          ...obj,
          amount: now.amountCents,
          ...(now.lastPaymentError ? { last_payment_error: { message: now.lastPaymentError } } : {}),
        };
        await this.onPaymentOutcome(reconciled, status, simulated, correlationId, 'payment_intent');
        return { handled: true };
      }
      case 'charge.refunded':
        await this.onChargeRefunded(obj, simulated, correlationId);
        return { handled: true };
      case 'customer.created':
        await this.onCustomerCreated(obj);
        return { handled: true };
      default:
        return { handled: false };
    }
  }

  // ───────────────────────────── handlers ─────────────────────────────

  private async onInvoicePaid(obj: Record<string, unknown>, simulated: boolean, correlationId: string): Promise<void> {
    const invoice = await this.findLocalInvoice(obj);
    if (!invoice) throw new UnrecoverableJobError(`no local invoice for Stripe invoice ${String(obj['id'])}`);
    const paymentIntentId = firstPaymentIntentId(obj);
    const method = await this.methodFor(obj, paymentIntentId, simulated);
    const amountCents = typeof obj['amount_paid'] === 'number' ? obj['amount_paid'] : invoice.amountCents;
    await this.upsertPayment({
      invoice,
      paymentIntentId,
      chargeId: null,
      method,
      status: 'SUCCEEDED',
      amountCents,
      failureReason: null,
      correlationId,
      simulated,
    });
  }

  private async onPaymentOutcome(
    obj: Record<string, unknown>,
    status: PaymentStatus,
    simulated: boolean,
    correlationId: string,
    shape: 'invoice' | 'payment_intent',
  ): Promise<void> {
    const paymentIntentId = shape === 'payment_intent' ? String(obj['id']) : firstPaymentIntentId(obj);
    let invoice = await this.findLocalInvoice(obj);
    if (!invoice && shape === 'payment_intent' && paymentIntentId && !simulated && this.stripe.live) {
      const stripeInvoiceId = await this.stripe.invoiceIdForPaymentIntent(paymentIntentId);
      if (stripeInvoiceId)
        invoice = await this.db.invoice.findUnique({
          where: { stripeInvoiceId },
          include: { customer: true, contract: true },
        });
    }
    if (!invoice) {
      // A payment we cannot tie to a record is recorded as ignored, never guessed.
      this.logger.warn(`payment ${paymentIntentId ?? '?'} (${status}) has no local invoice; ignoring`);
      return;
    }
    const method = await this.methodFor(obj, paymentIntentId, simulated);
    const amountCents =
      typeof obj['amount'] === 'number'
        ? obj['amount']
        : typeof obj['amount_due'] === 'number'
          ? obj['amount_due']
          : invoice.amountCents;
    const failure =
      (obj['last_payment_error'] as { message?: string } | undefined)?.message ??
      (status === 'FAILED' ? 'payment failed' : null);
    await this.upsertPayment({
      invoice,
      paymentIntentId,
      chargeId: null,
      method,
      status,
      amountCents,
      failureReason: failure,
      correlationId,
      simulated,
    });
  }

  private async onChargeRefunded(
    obj: Record<string, unknown>,
    simulated: boolean,
    correlationId: string,
  ): Promise<void> {
    const paymentIntentId = typeof obj['payment_intent'] === 'string' ? obj['payment_intent'] : null;
    if (!paymentIntentId) throw new UnrecoverableJobError('charge.refunded without a payment_intent');
    const payment = await this.db.payment.findUnique({
      where: { stripePaymentIntentId: paymentIntentId },
      include: { invoice: true },
    });
    if (!payment) throw new UnrecoverableJobError(`refund for unknown payment intent ${paymentIntentId}`);

    const refunds =
      simulated || !this.stripe.live
        ? ((obj['refunds'] as { data?: { id: string; amount: number; reason?: string | null }[] } | undefined)?.data ??
          [])
        : (await this.stripe.refundsForCharge(String(obj['id']))).map((r) => ({
            id: r.id,
            amount: r.amount,
            reason: r.reason,
          }));

    await this.db.$transaction(async (tx) => {
      let refundedCents = 0;
      for (const refund of refunds) {
        const existing = await tx.refund.findUnique({ where: { stripeRefundId: refund.id } });
        if (!existing) {
          await tx.refund.create({
            data: {
              id: await this.codes.next('refund', seasonOf(payment.id), tx),
              paymentId: payment.id,
              amountCents: refund.amount,
              reason: refund.reason ?? null,
              stripeRefundId: refund.id,
            },
          });
        }
        refundedCents += refund.amount;
      }
      const status: PaymentStatus =
        refundedCents >= payment.amountCents ? 'REFUNDED' : refundedCents > 0 ? 'PARTIALLY_REFUNDED' : payment.status;
      await tx.payment.update({ where: { id: payment.id }, data: { refundedCents, status } });
      if (payment.invoiceId && status === 'REFUNDED') {
        await tx.invoice.update({ where: { id: payment.invoiceId }, data: { status: 'REFUNDED' } });
      }
      await this.audit.record(
        {
          actor: null,
          source: 'WEBHOOK',
          action: 'payment.refunded',
          entityType: 'Payment',
          entityId: payment.id,
          before: { status: payment.status, refundedCents: payment.refundedCents },
          after: { status, refundedCents, simulated },
          correlationId,
        },
        tx,
      );
      const payload: PaymentEventPayload = {
        paymentId: payment.id,
        invoiceId: payment.invoiceId,
        customerId: payment.customerId,
        contractId: payment.invoice?.contractId ?? null,
        amountCents: payment.amountCents,
        refundedCents,
        method: payment.method,
        status,
        simulated,
      };
      await this.outbox.append(tx, {
        aggregateType: 'Payment',
        aggregateId: payment.id,
        type: BillingEvents.PaymentRefunded,
        payload,
      });
    });
    await this.outbox.flush();
  }

  private async onCustomerCreated(obj: Record<string, unknown>): Promise<void> {
    const customerId = (obj['metadata'] as { customerId?: string } | undefined)?.customerId;
    if (!customerId) return;
    await this.db.customer.updateMany({
      where: { id: customerId, stripeCustomerId: null },
      data: { stripeCustomerId: String(obj['id']) },
    });
  }

  // ───────────────────────────── the idempotent core ─────────────────────────────

  private async upsertPayment(input: {
    invoice: Invoice & { customer: { id: string } };
    paymentIntentId: string | null;
    chargeId: string | null;
    method: PaymentMethod;
    status: PaymentStatus;
    amountCents: number;
    failureReason: string | null;
    correlationId: string;
    simulated: boolean;
  }): Promise<void> {
    const { invoice } = input;
    await this.db.$transaction(async (tx) => {
      const existing = input.paymentIntentId
        ? await tx.payment.findUnique({ where: { stripePaymentIntentId: input.paymentIntentId } })
        : null;

      let paymentId: string;
      if (existing) {
        // One way only. A late `processing` after `succeeded`, or the same word twice, is ignored here;
        // the inbox keeps the provider's word, and the detector raises a disagreement if one stands.
        if (!providerEventApplies(existing.id, existing.status, input.status)) return;
        await tx.payment.update({
          where: { id: existing.id },
          data: { status: input.status, failureReason: input.failureReason, amountCents: input.amountCents },
        });
        await this.audit.record(
          {
            actor: null,
            source: 'WEBHOOK',
            action: `payment.${input.status.toLowerCase()}`,
            entityType: 'Payment',
            entityId: existing.id,
            before: { status: existing.status },
            after: { status: input.status, simulated: input.simulated },
            correlationId: input.correlationId,
          },
          tx,
        );
        paymentId = existing.id;
      } else {
        paymentId = await this.codes.next('payment', seasonOf(invoice.id), tx);
        await tx.payment.create({
          data: {
            id: paymentId,
            invoiceId: invoice.id,
            customerId: invoice.customerId,
            method: input.method,
            status: input.status,
            amountCents: input.amountCents,
            stripePaymentIntentId: input.paymentIntentId,
            stripeChargeId: input.chargeId,
            failureReason: input.failureReason,
            receivedAt: new Date(),
          },
        });
        await this.audit.record(
          {
            actor: null,
            source: 'WEBHOOK',
            action: `payment.${input.status.toLowerCase()}`,
            entityType: 'Payment',
            entityId: paymentId,
            after: {
              invoiceId: invoice.id,
              amountCents: input.amountCents,
              method: input.method,
              status: input.status,
              simulated: input.simulated,
            },
            correlationId: input.correlationId,
          },
          tx,
        );
      }

      // The facts, in the same transaction as the rows. Consumers do the rest.
      const payload: PaymentEventPayload = {
        paymentId,
        invoiceId: invoice.id,
        customerId: invoice.customerId,
        contractId: invoice.contractId,
        amountCents: input.amountCents,
        refundedCents: 0,
        method: input.method,
        status: input.status,
        simulated: input.simulated,
      };
      await this.outbox.append(tx, {
        aggregateType: 'Payment',
        aggregateId: paymentId,
        type: eventTypeFor(input.status),
        payload,
      });
      if (input.status === 'SUCCEEDED') {
        await tx.invoice.update({ where: { id: invoice.id }, data: { status: 'PAID' } });
        const paid: InvoicePaidPayload = {
          invoiceId: invoice.id,
          customerId: invoice.customerId,
          contractId: invoice.contractId,
          amountCents: invoice.amountCents,
        };
        await this.outbox.append(tx, {
          aggregateType: 'Invoice',
          aggregateId: invoice.id,
          type: BillingEvents.InvoicePaid,
          payload: paid,
        });
      }
    });
    await this.outbox.flush();
  }

  // ───────────────────────────── staff actions ─────────────────────────────

  async hostedLink(actor: Actor, invoiceId: string) {
    const invoice = await this.db.invoice.findUnique({ where: { id: invoiceId }, include: { customer: true } });
    if (!invoice) throw new NotFoundException(`${invoiceId} not found`);
    if (!canSeeRecord(actor, 'invoice', invoice)) throw new ForbiddenException();
    if (invoice.status !== 'OPEN')
      throw new BadRequestException(`${invoiceId} is ${invoice.status.toLowerCase()}, not payable`);
    if (!this.stripe.live) return { simulated: true as const, invoiceId, hostedInvoiceUrl: null };
    const { hostedInvoiceUrl, stripeInvoiceId } = await this.stripe.createHostedInvoice(invoice, invoice.customer);
    await this.audit.record({
      actor,
      source: 'UI',
      action: 'invoice.hosted_link',
      entityType: 'Invoice',
      entityId: invoiceId,
      after: { stripeInvoiceId },
    });
    return { simulated: false as const, invoiceId, hostedInvoiceUrl };
  }

  async recordManualPayment(
    actor: Actor,
    invoiceId: string,
    method: 'CHECK' | 'CASH',
    amountCents: number,
    note: string | null,
  ) {
    const invoice = await this.db.invoice.findUnique({ where: { id: invoiceId }, include: { customer: true } });
    if (!invoice) throw new NotFoundException(`${invoiceId} not found`);
    if (invoice.status !== 'OPEN') throw new BadRequestException(`${invoiceId} is not open`);
    const id = await this.db.$transaction(async (tx) => {
      const code = await this.codes.next('payment', seasonOf(invoice.id), tx);
      await tx.payment.create({
        data: {
          id: code,
          invoiceId,
          customerId: invoice.customerId,
          method,
          status: 'SUCCEEDED',
          amountCents,
          receivedAt: new Date(),
        },
      });
      await tx.invoice.update({
        where: { id: invoiceId },
        data: { status: amountCents >= invoice.amountCents ? 'PAID' : 'OPEN' },
      });
      await this.audit.record(
        {
          actor,
          source: 'UI',
          action: 'payment.manual',
          entityType: 'Payment',
          entityId: code,
          after: { invoiceId, method, amountCents, note },
        },
        tx,
      );
      const payload: PaymentEventPayload = {
        paymentId: code,
        invoiceId,
        customerId: invoice.customerId,
        contractId: invoice.contractId,
        amountCents,
        refundedCents: 0,
        method,
        status: 'SUCCEEDED',
        simulated: false,
      };
      await this.outbox.append(tx, {
        aggregateType: 'Payment',
        aggregateId: code,
        type: BillingEvents.PaymentSucceeded,
        payload,
      });
      if (amountCents >= invoice.amountCents) {
        const paid: InvoicePaidPayload = {
          invoiceId,
          customerId: invoice.customerId,
          contractId: invoice.contractId,
          amountCents: invoice.amountCents,
        };
        await this.outbox.append(tx, {
          aggregateType: 'Invoice',
          aggregateId: invoiceId,
          type: BillingEvents.InvoicePaid,
          payload: paid,
        });
      }
      return code;
    });
    await this.outbox.flush();
    return { paymentId: id };
  }

  /**
   * The bank pulled an ACH debit back after it looked settled. The office learns of it from the
   * bank or the provider's dashboard and a person with billing rights records it; the ledger
   * moves one way (SUCCEEDED → RETURNED and nothing else), the invoice reopens, and the fact
   * goes out for the rules to read — the papers, if they were merely eligible, go back to held.
   */
  async recordReturn(actor: Actor, paymentId: string, reason: string) {
    if (actor.role !== 'BILLING' && actor.role !== 'ADMIN')
      throw new ForbiddenException('only billing or an admin records a returned payment');
    const payment = await this.db.payment.findUnique({ where: { id: paymentId }, include: { invoice: true } });
    if (!payment) throw new NotFoundException(`${paymentId} not found`);
    const verdict = paymentTransition(payment.id, payment.status, 'RETURNED');
    if (!verdict.ok)
      throw new ConflictException({ code: verdict.code, message: verdict.reason, evidenceIds: verdict.evidenceIds });
    if (verdict.noop)
      throw new ConflictException({
        code: 'INVALID_PAYMENT_TRANSITION',
        message: `${paymentId} is already recorded as returned`,
        evidenceIds: [paymentId],
      });
    await this.db.$transaction(async (tx) => {
      await tx.payment.update({ where: { id: payment.id }, data: { status: 'RETURNED', failureReason: reason } });
      if (payment.invoice && payment.invoice.status === 'PAID')
        await tx.invoice.update({ where: { id: payment.invoice.id }, data: { status: 'OPEN' } });
      await this.audit.record(
        {
          actor,
          source: 'UI',
          action: 'payment.returned',
          entityType: 'Payment',
          entityId: payment.id,
          before: { status: payment.status },
          after: { status: 'RETURNED', reason, invoiceId: payment.invoiceId },
        },
        tx,
      );
      const payload: PaymentEventPayload = {
        paymentId: payment.id,
        invoiceId: payment.invoiceId,
        customerId: payment.customerId,
        contractId: payment.invoice?.contractId ?? null,
        amountCents: payment.amountCents,
        refundedCents: payment.refundedCents,
        method: payment.method,
        status: 'RETURNED',
        simulated: false,
      };
      await this.outbox.append(tx, {
        aggregateType: 'Payment',
        aggregateId: payment.id,
        type: BillingEvents.PaymentReturned,
        payload,
      });
    });
    await this.outbox.flush();
    return { paymentId: payment.id, status: 'RETURNED' as const, invoiceId: payment.invoiceId };
  }

  async refund(actor: Actor, paymentId: string, amountCents: number, reason: string) {
    const payment = await this.db.payment.findUnique({ where: { id: paymentId } });
    if (!payment) throw new NotFoundException(`${paymentId} not found`);
    if (payment.status !== 'SUCCEEDED' && payment.status !== 'PARTIALLY_REFUNDED')
      throw new BadRequestException('only settled payments can be refunded');
    if (amountCents <= 0 || amountCents > payment.amountCents - payment.refundedCents)
      throw new BadRequestException('refund exceeds the refundable amount');
    await this.audit.record({
      actor,
      source: 'UI',
      action: 'refund.requested',
      entityType: 'Payment',
      entityId: paymentId,
      after: { amountCents, reason },
    });
    if (this.stripe.live && payment.stripePaymentIntentId) {
      const refund = await this.stripe.refund(payment, amountCents, reason);
      return { requested: true, stripeRefundId: refund.id, simulated: false };
    }
    // Simulator: emit the same event Stripe would, through the same inbox.
    const result = await this.ingestStripeEvent(
      simulatedRefundEvent(
        payment.stripePaymentIntentId ?? `pi_sim_${paymentId}`,
        payment.stripeChargeId ?? `ch_sim_${paymentId}`,
        amountCents,
        reason,
      ),
      true,
    );
    return { requested: true, stripeRefundId: null, simulated: true, ...result };
  }

  // ───────────────────────────── simulator ─────────────────────────────

  /** Builds the event Stripe would send and runs it through the real pipeline. */
  async simulate(
    actor: Actor,
    invoiceId: string,
    outcome: 'succeeded' | 'processing' | 'failed',
    method: 'CARD' | 'ACH',
  ) {
    const invoice = await this.db.invoice.findUnique({ where: { id: invoiceId } });
    if (!invoice) throw new NotFoundException(`${invoiceId} not found`);
    await this.audit.record({
      actor,
      source: 'UI',
      action: 'payment.simulated',
      entityType: 'Invoice',
      entityId: invoiceId,
      after: { outcome, method },
    });
    const event = simulatedInvoiceEvent(invoice, outcome, method);
    return { event: { id: event.id, type: event.type }, ...(await this.ingestStripeEvent(event, true)) };
  }

  /**
   * Delivers the `invoice.paid` event Stripe would have sent for an already-settled payment,
   * under a fixed event id. The first delivery converges on the existing payment row (same
   * payment intent, forward-only status); every later delivery is a counted duplicate. The
   * front door's "deliver the webhook again" control.
   */
  async deliverCanonical(actor: Actor, invoiceId: string) {
    const invoice = await this.db.invoice.findUnique({
      where: { id: invoiceId },
      include: { payments: { where: { status: 'SUCCEEDED' }, take: 1 } },
    });
    if (!invoice) throw new NotFoundException(`${invoiceId} not found`);
    const payment = invoice.payments[0];
    if (!payment) throw new BadRequestException(`${invoiceId} has no settled payment to deliver an event for`);
    const paymentIntentId = payment.stripePaymentIntentId ?? `pi_sim_${payment.id.toLowerCase().replace(/-/g, '')}`;
    const eventId = `evt_story_${payment.id.toLowerCase().replace(/-/g, '')}`;
    await this.audit.record({
      actor,
      source: 'LAB',
      action: 'payment.webhook_redelivered',
      entityType: 'Invoice',
      entityId: invoiceId,
      after: { eventId, paymentId: payment.id },
    });
    const event: StripeLikeEvent = {
      id: eventId,
      type: 'invoice.paid',
      data: {
        object: {
          metadata: { invoiceId: invoice.id, customerId: invoice.customerId, method: payment.method },
          payment_method_types: [payment.method === 'ACH' ? 'us_bank_account' : 'card'],
          id: invoice.stripeInvoiceId ?? `in_sim_${invoice.id.toLowerCase()}`,
          object: 'invoice',
          amount_paid: payment.amountCents,
          amount_due: 0,
          status: 'paid',
          payments: {
            data: [
              {
                status: 'paid',
                amount_paid: payment.amountCents,
                payment: { type: 'payment_intent', payment_intent: paymentIntentId },
              },
            ],
          },
        },
      },
    };
    const outcome = await this.ingestStripeEvent(event, true);
    const inbox = await this.db.integrationEvent.findUnique({
      where: { provider_externalId: { provider: 'STRIPE', externalId: eventId } },
    });
    const paymentsForInvoice = await this.db.payment.count({ where: { invoiceId } });
    return {
      eventId,
      deliveries: 1 + (inbox?.duplicateDeliveries ?? 0),
      duplicatesRejected: inbox?.duplicateDeliveries ?? 0,
      processed: inbox?.status === 'PROCESSED' ? 1 : 0,
      paymentsForInvoice,
      mode: outcome.mode,
    };
  }

  /** Replays a previously received event id — the duplicate-delivery proof. */
  async replay(eventExternalId: string) {
    const row = await this.db.integrationEvent.findUnique({
      where: { provider_externalId: { provider: 'STRIPE', externalId: eventExternalId } },
    });
    if (!row) throw new NotFoundException(`event ${eventExternalId} was never received`);
    const payload = row.payload as unknown as StripeLikeEvent & { simulated?: boolean };
    return this.ingestStripeEvent(payload, Boolean(payload.simulated));
  }

  async listPayments(actor: Actor) {
    return this.db.payment.findMany({
      where: actor.role === 'CUSTOMER' ? { customerId: actor.customerId ?? '__none__' } : {},
      include: { invoice: true, customer: true, refunds: true },
      orderBy: { receivedAt: 'desc' },
      take: 200,
    });
  }

  // ───────────────────────────── helpers ─────────────────────────────

  private async findLocalInvoice(obj: Record<string, unknown>) {
    const metadata = obj['metadata'] as { invoiceId?: string } | undefined;
    const byMeta = metadata?.invoiceId
      ? await this.db.invoice.findUnique({
          where: { id: metadata.invoiceId },
          include: { customer: true, contract: true },
        })
      : null;
    if (byMeta) return byMeta;
    const stripeInvoiceId = typeof obj['id'] === 'string' && obj['id'].startsWith('in_') ? obj['id'] : null;
    return stripeInvoiceId
      ? this.db.invoice.findUnique({ where: { stripeInvoiceId }, include: { customer: true, contract: true } })
      : null;
  }

  private async methodFor(
    obj: Record<string, unknown>,
    paymentIntentId: string | null,
    simulated: boolean,
  ): Promise<PaymentMethod> {
    const hinted = (obj['metadata'] as { method?: string } | undefined)?.method;
    if (hinted === 'ACH' || hinted === 'CARD') return hinted;
    const types = obj['payment_method_types'];
    if (Array.isArray(types) && types[0] === 'us_bank_account') return 'ACH';
    if (!simulated && this.stripe.live && paymentIntentId) return this.stripe.paymentMethodTypeFor(paymentIntentId);
    return 'CARD';
  }
}

function firstPaymentIntentId(invoiceObj: Record<string, unknown>): string | null {
  const payments = invoiceObj['payments'] as
    { data?: { payment?: { payment_intent?: string | { id: string } } }[] } | undefined;
  const first = payments?.data?.[0]?.payment?.payment_intent;
  if (typeof first === 'string') return first;
  if (first && typeof first === 'object') return first.id;
  const legacy = invoiceObj['payment_intent'];
  return typeof legacy === 'string' ? legacy : null;
}

function eventTypeFor(status: PaymentStatus): string {
  switch (status) {
    case 'SUCCEEDED':
      return BillingEvents.PaymentSucceeded;
    case 'PROCESSING':
    case 'PENDING':
      return BillingEvents.PaymentProcessing;
    case 'FAILED':
      return BillingEvents.PaymentFailed;
    case 'PARTIALLY_REFUNDED':
    case 'REFUNDED':
      return BillingEvents.PaymentRefunded;
    case 'RETURNED':
      return BillingEvents.PaymentReturned;
  }
}

/** Codes inherit the season of the document they belong to (INV-26-… → PAY-26-…). */
function seasonOf(code: string): number {
  const yy = code.split('-')[1];
  return yy && /^\d{2}$/.test(yy) ? 2000 + Number(yy) : new Date().getUTCFullYear();
}

function stampNow(): string {
  return `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`;
}

function simulatedInvoiceEvent(
  invoice: Invoice,
  outcome: 'succeeded' | 'processing' | 'failed',
  method: 'CARD' | 'ACH',
): StripeLikeEvent {
  const stamp = stampNow();
  const paymentIntentId = `pi_sim_${invoice.id.toLowerCase().replace(/-/g, '')}_${stamp}`;
  const base = {
    metadata: { invoiceId: invoice.id, customerId: invoice.customerId, method },
    payment_method_types: [method === 'ACH' ? 'us_bank_account' : 'card'],
  };
  if (outcome === 'succeeded') {
    return {
      id: `evt_sim_${stamp}`,
      type: 'invoice.paid',
      data: {
        object: {
          ...base,
          id: invoice.stripeInvoiceId ?? `in_sim_${invoice.id.toLowerCase()}`,
          object: 'invoice',
          amount_paid: invoice.amountCents,
          amount_due: 0,
          status: 'paid',
          payments: {
            data: [
              {
                status: 'paid',
                amount_paid: invoice.amountCents,
                payment: { type: 'payment_intent', payment_intent: paymentIntentId },
              },
            ],
          },
        },
      },
    };
  }
  if (outcome === 'processing') {
    return {
      id: `evt_sim_${stamp}`,
      type: 'payment_intent.processing',
      data: {
        object: {
          ...base,
          id: paymentIntentId,
          object: 'payment_intent',
          amount: invoice.amountCents,
          status: 'processing',
        },
      },
    };
  }
  return {
    id: `evt_sim_${stamp}`,
    type: 'payment_intent.payment_failed',
    data: {
      object: {
        ...base,
        id: paymentIntentId,
        object: 'payment_intent',
        amount: invoice.amountCents,
        status: 'requires_payment_method',
        last_payment_error: {
          message: method === 'ACH' ? 'The bank account has insufficient funds.' : 'Your card was declined.',
        },
      },
    },
  };
}

function simulatedRefundEvent(
  paymentIntentId: string,
  chargeId: string,
  amountCents: number,
  reason: string,
): StripeLikeEvent {
  const stamp = stampNow();
  return {
    id: `evt_sim_${stamp}`,
    type: 'charge.refunded',
    data: {
      object: {
        id: chargeId,
        object: 'charge',
        payment_intent: paymentIntentId,
        refunds: { data: [{ id: `re_sim_${stamp}`, amount: amountCents, reason }] },
      },
    },
  };
}

export type { StripeLikeEvent };
export type PaymentRecord = Prisma.PaymentGetPayload<{ include: { invoice: true; customer: true; refunds: true } }>;
