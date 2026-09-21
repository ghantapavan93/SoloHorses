/**
 * Integration tests against the real database (the seeded synthetic world).
 * They prove the properties the money pipeline exists for:
 *   - a redelivered Stripe event never produces a second payment
 *   - status moves forward only (processing → succeeded, never back)
 *   - a settled balance flips the contract to SHIPPABLE and releases held orders
 *   - refunds are recorded once per Stripe refund id
 *   - with a real key, the ledger follows the object Stripe holds now, not the event's order
 *
 * Run with: pnpm --filter api test  (needs DATABASE_URL and a seeded database)
 */
import { PrismaService } from '../../../platform/persistence/prisma.service';
import { createContractFixture } from '../../../test-support/fixtures';
import type { TestingModule } from '@nestjs/testing';
import { createTestModule } from '../../../test-support/module';
import { AccountingModule } from '../../accounting/accounting.module';
import { JobsService } from '../../../platform/queue/jobs.service';
import { OperationsModule } from '../../operations/operations.module';
import { ReproductionModule } from '../../reproduction/reproduction.module';
import { BillingModule } from '../billing.module';
import { StripeService } from '../infrastructure/stripe.service';
import { ledgerStatusOf, PaymentsService } from './payments.service';

const ADMIN = { userId: 'test-admin', role: 'ADMIN' as const, customerId: null };

describe('PaymentsService (integration)', () => {
  const modules: TestingModule[] = [];
  let payments: PaymentsService;
  let prisma: PrismaService;
  let jobs: JobsService;

  beforeAll(async () => {
    const moduleRef = await tracked(
      createTestModule({ imports: [AccountingModule, BillingModule, ReproductionModule, OperationsModule] }),
    );
    payments = moduleRef.get(PaymentsService);
    prisma = moduleRef.get(PrismaService);
    jobs = moduleRef.get(JobsService);
    expect(jobs.mode).toBe('inline');
  });

  afterAll(async () => {
    await Promise.all(modules.map((m) => m.close()));
  });

  async function tracked(pending: Promise<TestingModule>): Promise<TestingModule> {
    const m = await pending;
    modules.push(m);
    return m;
  }

  async function freshOpenInvoice() {
    const fixture = await createContractFixture(prisma.client, { status: 'SIGNED' });
    const [invoice] = fixture.openInvoices;
    if (!invoice) throw new Error('a SIGNED fixture always carries open invoices');
    return invoice;
  }

  it('records exactly one payment when the same event is delivered twice', async () => {
    const invoice = await freshOpenInvoice();
    const first = await payments.simulate(ADMIN, invoice.id, 'succeeded', 'CARD');
    expect(first.duplicate).toBe(false);

    const replay = await payments.replay(first.eventId);
    expect(replay.duplicate).toBe(true);

    const rows = await prisma.client.payment.findMany({ where: { invoiceId: invoice.id } });
    expect(rows).toHaveLength(1);
    expect(rows[0]?.status).toBe('SUCCEEDED');
    const updated = await prisma.client.invoice.findUniqueOrThrow({ where: { id: invoice.id } });
    expect(updated.status).toBe('PAID');

    const inbox = await prisma.client.integrationEvent.findUnique({
      where: { provider_externalId: { provider: 'STRIPE', externalId: first.eventId } },
    });
    expect(inbox?.status).toBe('PROCESSED');
  });

  it('moves an ACH payment from processing to succeeded on the same row', async () => {
    const invoice = await freshOpenInvoice();
    const processing = await payments.simulate(ADMIN, invoice.id, 'processing', 'ACH');
    expect(processing.duplicate).toBe(false);
    const rowsAfterProcessing = await prisma.client.payment.findMany({ where: { invoiceId: invoice.id } });
    expect(rowsAfterProcessing).toHaveLength(1);
    expect(rowsAfterProcessing[0]?.status).toBe('PROCESSING');
    expect(rowsAfterProcessing[0]?.method).toBe('ACH');

    // The succeeded event refers to the same payment intent; the simulator creates a new
    // intent id per event, so drive the upsert directly with the stored id.
    const intentId = rowsAfterProcessing[0]?.stripePaymentIntentId ?? '';
    await payments.ingestStripeEvent(
      {
        id: `evt_test_${Date.now()}`,
        type: 'payment_intent.succeeded',
        data: {
          object: {
            id: intentId,
            object: 'payment_intent',
            amount: invoice.amountCents,
            metadata: { invoiceId: invoice.id, customerId: invoice.customerId, method: 'ACH' },
          },
        },
      },
      true,
    );

    const rowsAfter = await prisma.client.payment.findMany({ where: { invoiceId: invoice.id } });
    expect(rowsAfter).toHaveLength(1);
    expect(rowsAfter[0]?.status).toBe('SUCCEEDED');

    // A late "processing" for the same intent must not regress the ledger.
    await payments.ingestStripeEvent(
      {
        id: `evt_test_late_${Date.now()}`,
        type: 'payment_intent.processing',
        data: {
          object: {
            id: intentId,
            object: 'payment_intent',
            amount: invoice.amountCents,
            metadata: { invoiceId: invoice.id, customerId: invoice.customerId, method: 'ACH' },
          },
        },
      },
      true,
    );
    const rowsFinal = await prisma.client.payment.findMany({ where: { invoiceId: invoice.id } });
    expect(rowsFinal[0]?.status).toBe('SUCCEEDED');
  });

  it('flips a signed contract to SHIPPABLE and releases held orders when the balance settles', async () => {
    const { contract, openInvoices, order } = await createContractFixture(prisma.client, {
      status: 'SIGNED',
      withHeldOrder: true,
    });
    expect(order?.status).toBe('HOLD_UNPAID');
    for (const invoice of openInvoices) {
      await payments.simulate(ADMIN, invoice.id, 'succeeded', 'CARD');
    }
    const after = await prisma.client.contract.findUniqueOrThrow({
      where: { id: contract.id },
      include: { semenOrders: true },
    });
    expect(after.status).toBe('SHIPPABLE');
    expect(after.semenOrders.map((o) => o.status)).toEqual(['SCHEDULED']);
    const audit = await prisma.client.auditEvent.findFirst({
      where: { entityType: 'Contract', entityId: contract.id, action: 'contract.status' },
      orderBy: { at: 'desc' },
    });
    expect(audit?.after).toMatchObject({ status: 'SHIPPABLE', ordersReleased: 1 });
  });

  it('records a refund once per Stripe refund id and marks the payment', async () => {
    const invoice = await freshOpenInvoice();
    await payments.simulate(ADMIN, invoice.id, 'succeeded', 'CARD');
    const paid = await prisma.client.payment.findFirstOrThrow({ where: { invoiceId: invoice.id } });
    const result = await payments.refund(ADMIN, paid.id, 10_000, 'test partial refund');
    expect(result.simulated).toBe(true);
    const refunds = await prisma.client.refund.findMany({ where: { paymentId: paid.id } });
    expect(refunds).toHaveLength(1);
    const after = await prisma.client.payment.findUniqueOrThrow({ where: { id: paid.id } });
    expect(after.refundedCents).toBe(10_000);
    expect(after.status).toBe('PARTIALLY_REFUNDED');
  });

  it('rejects a refund larger than the refundable amount', async () => {
    const invoice = await freshOpenInvoice();
    await payments.simulate(ADMIN, invoice.id, 'succeeded', 'CARD');
    const paid = await prisma.client.payment.findFirstOrThrow({ where: { invoiceId: invoice.id } });
    await expect(payments.refund(ADMIN, paid.id, paid.amountCents + 1, 'too much')).rejects.toThrow(/exceeds/);
  });

  describe('with a real key, the current object wins over the event', () => {
    // Stripe as it would answer: the intent has already succeeded, but the delivery that
    // arrives first is the older `processing` event.
    const stripeNow = {
      live: true,
      currentPaymentIntent: (id: string) =>
        Promise.resolve({ status: 'succeeded' as const, amountCents: 123_400, lastPaymentError: null, id }),
      currentInvoice: (id: string) => Promise.resolve({ status: 'void' as const, amountPaidCents: 0, id }),
      paymentMethodTypeFor: () => Promise.resolve('ACH' as const),
      invoiceIdForPaymentIntent: () => Promise.resolve(null),
      refundsForCharge: () => Promise.resolve([]),
    };
    let livePayments: PaymentsService;

    beforeAll(async () => {
      const moduleRef = await tracked(
        createTestModule(
          { imports: [AccountingModule, BillingModule, ReproductionModule, OperationsModule] },
          { overrides: [{ provide: StripeService, useValue: stripeNow }] },
        ),
      );
      livePayments = moduleRef.get(PaymentsService);
    });

    it('books the intent as Stripe holds it now, not as a stale processing event describes it', async () => {
      const invoice = await freshOpenInvoice();
      const intentId = `pi_test_${Date.now().toString(36)}`;
      await livePayments.ingestStripeEvent(
        {
          id: `evt_live_${intentId}`,
          type: 'payment_intent.processing',
          data: {
            object: {
              id: intentId,
              object: 'payment_intent',
              amount: 1,
              metadata: { invoiceId: invoice.id, customerId: invoice.customerId, method: 'ACH' },
            },
          },
        },
        false,
      );
      const row = await prisma.client.payment.findUniqueOrThrow({ where: { stripePaymentIntentId: intentId } });
      expect(row.status).toBe('SUCCEEDED');
      expect(row.amountCents).toBe(123_400);
    });

    it('sets aside a paid event for an invoice Stripe has since voided, with the reason on the inbox row', async () => {
      const invoice = await freshOpenInvoice();
      const eventId = `evt_live_void_${Date.now().toString(36)}`;
      await livePayments.ingestStripeEvent(
        {
          id: eventId,
          type: 'invoice.paid',
          data: {
            object: {
              id: `in_test_${invoice.id.toLowerCase()}`,
              object: 'invoice',
              amount_paid: invoice.amountCents,
              metadata: { invoiceId: invoice.id, customerId: invoice.customerId, method: 'CARD' },
            },
          },
        },
        false,
      );
      expect(await prisma.client.payment.count({ where: { invoiceId: invoice.id } })).toBe(0);
      const inbox = await prisma.client.integrationEvent.findUniqueOrThrow({
        where: { provider_externalId: { provider: 'STRIPE', externalId: eventId } },
      });
      expect(inbox.status).toBe('IGNORED');
      expect(inbox.error).toMatch(/void now, not paid/);
    });

    it('maps intent statuses to the ledger and stays silent on the ones that mean nothing yet', () => {
      expect(ledgerStatusOf('succeeded')).toBe('SUCCEEDED');
      expect(ledgerStatusOf('processing')).toBe('PROCESSING');
      expect(ledgerStatusOf('canceled')).toBe('FAILED');
      expect(ledgerStatusOf('requires_payment_method')).toBeNull();
    });
  });
});
