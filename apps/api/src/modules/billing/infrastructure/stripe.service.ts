import { Injectable, Logger, ServiceUnavailableException } from '@nestjs/common';
import Stripe from 'stripe';
import type { Customer, Invoice, Payment } from '@daysheet/db';
import { PrismaService } from '../../../platform/persistence/prisma.service';
import { EnvService } from '../../../platform/config/env.module';

/**
 * The one place that talks to Stripe. Test mode only: the client refuses to boot with a
 * live key. When no key is present the service reports `live = false` and the payments
 * module falls back to the labeled simulator, which feeds the same event pipeline.
 */
@Injectable()
export class StripeService {
  readonly live: boolean;
  readonly apiVersion = Stripe.API_VERSION;
  private readonly client: Stripe | null;
  private readonly webhookSecret: string;
  private readonly logger = new Logger(StripeService.name);

  constructor(
    envService: EnvService,
    private readonly prisma: PrismaService,
  ) {
    const key = envService.env.STRIPE_SECRET_KEY;
    if (key.startsWith('sk_live_') || key.startsWith('rk_live_')) {
      throw new Error('Refusing to start with a live Stripe key. This prototype is test mode only.');
    }
    this.live = key.length > 0;
    this.webhookSecret = envService.env.STRIPE_WEBHOOK_SECRET;
    this.client = this.live
      ? new Stripe(key, { apiVersion: Stripe.API_VERSION, appInfo: { name: 'daysheet-prototype', version: '0.1.0' } })
      : null;
    if (!this.live) this.logger.warn('Stripe key absent — payments run through the simulator.');
  }

  private get stripe(): Stripe {
    if (!this.client) throw new ServiceUnavailableException('Stripe is not configured; use the payment simulator.');
    return this.client;
  }

  constructEvent(rawBody: Buffer, signature: string): Stripe.Event {
    if (!this.webhookSecret) throw new ServiceUnavailableException('STRIPE_WEBHOOK_SECRET is not set.');
    return this.stripe.webhooks.constructEvent(rawBody, signature, this.webhookSecret);
  }

  /** Our customer code travels in Stripe metadata so every webhook can find its way home. */
  async ensureCustomer(customer: Customer): Promise<string> {
    if (customer.stripeCustomerId) return customer.stripeCustomerId;
    const created = await this.stripe.customers.create(
      {
        name: customer.displayName,
        email: customer.email ?? undefined,
        phone: customer.phone ?? undefined,
        metadata: { customerId: customer.id },
      },
      { idempotencyKey: `customer:${customer.id}` },
    );
    await this.prisma.client.customer.update({ where: { id: customer.id }, data: { stripeCustomerId: created.id } });
    return created.id;
  }

  /**
   * A hosted Stripe invoice mirrors our invoice one-to-one and accepts card or ACH.
   * Idempotency keys are our invoice code, so a retried request cannot double-bill.
   */
  async createHostedInvoice(
    invoice: Invoice,
    customer: Customer,
  ): Promise<{ stripeInvoiceId: string; hostedInvoiceUrl: string | null }> {
    if (invoice.stripeInvoiceId) {
      const existing = await this.stripe.invoices.retrieve(invoice.stripeInvoiceId);
      return { stripeInvoiceId: existing.id, hostedInvoiceUrl: existing.hosted_invoice_url ?? null };
    }
    const stripeCustomerId = await this.ensureCustomer(customer);
    const draft = await this.stripe.invoices.create(
      {
        customer: stripeCustomerId,
        collection_method: 'send_invoice',
        days_until_due: 14,
        auto_advance: false,
        payment_settings: { payment_method_types: ['card', 'us_bank_account'] },
        metadata: { invoiceId: invoice.id, customerId: customer.id, kind: invoice.kind },
        description: invoice.description,
      },
      { idempotencyKey: `invoice:${invoice.id}:create` },
    );
    await this.stripe.invoiceItems.create(
      {
        customer: stripeCustomerId,
        invoice: draft.id,
        amount: invoice.amountCents,
        currency: 'usd',
        description: invoice.description,
        metadata: { invoiceId: invoice.id },
      },
      { idempotencyKey: `invoice:${invoice.id}:item` },
    );
    const finalized = await this.stripe.invoices.finalizeInvoice(
      draft.id,
      {},
      { idempotencyKey: `invoice:${invoice.id}:finalize` },
    );
    await this.prisma.client.invoice.update({ where: { id: invoice.id }, data: { stripeInvoiceId: finalized.id } });
    return { stripeInvoiceId: finalized.id, hostedInvoiceUrl: finalized.hosted_invoice_url ?? null };
  }

  async refund(payment: Payment, amountCents: number, reason: string): Promise<Stripe.Refund> {
    if (!payment.stripePaymentIntentId)
      throw new ServiceUnavailableException('Payment has no Stripe payment intent to refund.');
    return this.stripe.refunds.create(
      {
        payment_intent: payment.stripePaymentIntentId,
        amount: amountCents,
        metadata: { paymentId: payment.id, reason },
      },
      { idempotencyKey: `refund:${payment.id}:${amountCents}:${reason.slice(0, 40)}` },
    );
  }

  async paymentMethodTypeFor(paymentIntentId: string): Promise<'CARD' | 'ACH'> {
    const intent = await this.stripe.paymentIntents.retrieve(paymentIntentId, { expand: ['payment_method'] });
    const method = intent.payment_method;
    const type = typeof method === 'object' && method !== null ? method.type : intent.payment_method_types[0];
    return type === 'us_bank_account' ? 'ACH' : 'CARD';
  }

  /** Basil removed `PaymentIntent.invoice`; the link now lives on InvoicePayment. */
  async invoiceIdForPaymentIntent(paymentIntentId: string): Promise<string | null> {
    const list = await this.stripe.invoicePayments.list({
      payment: { type: 'payment_intent', payment_intent: paymentIntentId },
      limit: 1,
    });
    const first = list.data[0];
    if (!first) return null;
    return typeof first.invoice === 'string' ? first.invoice : first.invoice.id;
  }

  /**
   * The payment intent as Stripe has it now, not as the event described it. Events arrive
   * in any order; the current object is the truth the ledger is reconciled against.
   */
  async currentPaymentIntent(
    paymentIntentId: string,
  ): Promise<{ status: Stripe.PaymentIntent.Status; amountCents: number; lastPaymentError: string | null }> {
    const intent = await this.stripe.paymentIntents.retrieve(paymentIntentId);
    return {
      status: intent.status,
      amountCents: intent.amount,
      lastPaymentError: intent.last_payment_error?.message ?? null,
    };
  }

  /** Same for an invoice: a paid event about an invoice since voided must not book a payment. */
  async currentInvoice(
    stripeInvoiceId: string,
  ): Promise<{ status: Stripe.Invoice.Status | null; amountPaidCents: number }> {
    const invoice = await this.stripe.invoices.retrieve(stripeInvoiceId);
    return { status: invoice.status, amountPaidCents: invoice.amount_paid };
  }

  async refundsForCharge(chargeId: string): Promise<Stripe.Refund[]> {
    const list = await this.stripe.refunds.list({ charge: chargeId, limit: 20 });
    return list.data;
  }
}
