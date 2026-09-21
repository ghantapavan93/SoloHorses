/**
 * The sale's published conditions as behaviour: papers wait for cleared funds, an initiated ACH
 * is not cleared funds, the rule makes the document eligible and a person releases it; two
 * sources that disagree are raised, never reconciled by the system; a request for card data
 * is refused in code. Each spec builds its own lot so a run never consumes the seeded scene.
 */
import { ExpectedBehaviorSchema, gradeDeterministic, type Actor } from '@daysheet/domain';
import { BadRequestException } from '@nestjs/common';
import { ZodError } from 'zod';
import type { TestingModule } from '@nestjs/testing';
import { OutboxService } from '../../../platform/events/outbox.service';
import { PrismaService } from '../../../platform/persistence/prisma.service';
import { JobsService } from '../../../platform/queue/jobs.service';
import { createTestModule } from '../../../test-support/module';
import { AccountingModule } from '../../accounting/accounting.module';
import { AccountingService } from '../../accounting/application/accounting.service';
import { AskModule } from '../../ask/ask.module';
import { AskService } from '../../ask/application/ask.service';
import { LabModule } from '../../lab/lab.module';
import { LabService } from '../../lab/application/lab.service';
import { PaymentsService } from './payments.service';
import { DetectorsService } from '../../operations/application/detectors.service';
import { ExceptionsService } from '../../operations/application/exceptions.service';
import { OperationsModule } from '../../operations/operations.module';
import { ReproductionModule } from '../../reproduction/reproduction.module';
import { RecordsService } from '../../reproduction/application/records.service';
import { VeterinaryModule } from '../../veterinary/veterinary.module';
import { BillingModule } from '../billing.module';
import { AuctionAdapter } from '../infrastructure/auction.adapter';
import { IntegrationEventsService } from '../infrastructure/integration-events.service';
import { SettlementService } from './settlement.service';

describe('Sale settlement: the papers wait for cleared funds', () => {
  let moduleRef: TestingModule;
  let prisma: PrismaService;
  let settlement: SettlementService;
  let payments: PaymentsService;
  let lab: LabService;
  let detectors: DetectorsService;
  let exceptions: ExceptionsService;
  let outbox: OutboxService;
  let jobs: JobsService;
  let ask: AskService;
  let admin: Actor;
  let billing: Actor;
  let vet: Actor;

  beforeAll(async () => {
    process.env.ANTHROPIC_API_KEY = '';
    // The lab reads the assistant's status, so AskModule comes in through it; one AskService, one registration of its consumer.
    moduleRef = await createTestModule({
      imports: [
        BillingModule,
        AccountingModule,
        ReproductionModule,
        VeterinaryModule,
        OperationsModule,
        LabModule,
        AskModule,
      ],
    });
    prisma = moduleRef.get(PrismaService);
    settlement = moduleRef.get(SettlementService);
    payments = moduleRef.get(PaymentsService);
    lab = moduleRef.get(LabService);
    detectors = moduleRef.get(DetectorsService);
    exceptions = moduleRef.get(ExceptionsService);
    outbox = moduleRef.get(OutboxService);
    jobs = moduleRef.get(JobsService);
    ask = moduleRef.get(AskService);
    const user = async (role: 'ADMIN' | 'BILLING' | 'VET'): Promise<Actor> => {
      const row = await prisma.client.user.findFirstOrThrow({ where: { role } });
      return { userId: row.id, role, customerId: null };
    };
    admin = await user('ADMIN');
    billing = await user('BILLING');
    vet = await user('VET');
  });

  afterAll(async () => {
    await moduleRef.close();
  });

  /** Lets the inbox job, the outbox and the consumers finish what a step started. */
  async function settle(): Promise<void> {
    await jobs.flushPending();
    await outbox.publishPending();
    await jobs.flushPending();
    await outbox.publishPending();
  }

  it('an initiated ACH holds the papers, and the detector says so in plain words', async () => {
    const scene = await lab.newSaleScene(admin, 'Spec');
    await detectors.detectAll(null);

    const view = await settlement.scene(billing, scene.lotId);
    expect(view.funds).toBe('PROCESSING');
    expect(view.rule.ok).toBe(false);
    expect(view.rule).toMatchObject({ code: 'SETTLEMENT_PROCESSING', policy: 'RegistrationReleasePolicy v1' });
    expect(view.document?.status).toBe('HELD');

    const raised = await prisma.client.operationalException.findFirstOrThrow({
      where: { kind: 'PAPERS_HELD', entityId: scene.documentId, openKey: { not: null } },
    });
    expect(raised.title).toContain('initiated is not cleared');
    const explained = await exceptions.get(raised.id);
    expect(explained.explanation.systemState).toEqual(
      expect.arrayContaining([
        { key: 'payment.status', value: 'processing' },
        { key: 'document.status', value: 'held' },
      ]),
    );
    expect(explained.explanation.meaning).toMatch(/bank has not finished moving the money/);
  });

  it('a person cannot release held papers; the rule refuses with the evidence', async () => {
    const scene = await lab.newSaleScene(admin, 'Spec');
    await expect(settlement.release(billing, scene.documentId, null)).rejects.toMatchObject({
      response: { code: 'SETTLEMENT_PROCESSING' },
    });
    expect((await prisma.client.document.findUniqueOrThrow({ where: { id: scene.documentId } })).status).toBe('HELD');
  });

  it('when the ACH clears, the consumer marks the papers eligible, audits the rule, and releases nothing', async () => {
    const scene = await lab.newSaleScene(admin, 'Spec');
    await detectors.detectAll(null);
    const outcome = await settlement.settleAch(admin, scene.lotId);
    expect(outcome.paymentId).toBe(scene.paymentId);
    await settle();

    const payment = await prisma.client.payment.findUniqueOrThrow({ where: { id: scene.paymentId } });
    expect(payment.status).toBe('SUCCEEDED');
    expect(await prisma.client.payment.count({ where: { invoiceId: scene.invoiceId } })).toBe(1); // the same row, not a second one
    const document = await prisma.client.document.findUniqueOrThrow({ where: { id: scene.documentId } });
    expect(document.status).toBe('ELIGIBLE');
    expect(document.releasedAt).toBeNull();
    const audit = await prisma.client.auditEvent.findFirstOrThrow({
      where: { entityType: 'Document', entityId: scene.documentId, action: 'document.eligible' },
    });
    expect(audit.after).toMatchObject({ policy: 'RegistrationReleasePolicy v1', released: false });
    expect(
      await prisma.client.domainEvent.findFirst({ where: { type: 'DocumentEligible', aggregateId: scene.documentId } }),
    ).not.toBeNull();

    await detectors.detectAll(null);
    const held = await prisma.client.operationalException.findFirstOrThrow({
      where: { kind: 'PAPERS_HELD', entityId: scene.documentId },
    });
    expect(held.status).toBe('RESOLVED');
  });

  it('release is a person with billing rights, audited by name; the vet cannot', async () => {
    const scene = await lab.newSaleScene(admin, 'Spec');
    await settlement.settleAch(admin, scene.lotId);
    await settle();
    await expect(settlement.release(vet, scene.documentId, null)).rejects.toThrow(/billing or an admin/);

    const released = await settlement.release(billing, scene.documentId, 'Sent to the association');
    expect(released.status).toBe('RELEASED');
    const document = await prisma.client.document.findUniqueOrThrow({ where: { id: scene.documentId } });
    expect(document.releasedById).toBe(billing.userId);
    const audit = await prisma.client.auditEvent.findFirstOrThrow({
      where: { entityType: 'Document', entityId: scene.documentId, action: 'document.released' },
    });
    expect(audit.actorId).toBe(billing.userId);
    await expect(settlement.release(billing, scene.documentId, null)).rejects.toThrow(/already released/);
  });

  it('a late "processing" after "succeeded" leaves the ledger alone and raises a conflict; Ask abstains', async () => {
    const scene = await lab.newSaleScene(admin, 'Spec');
    await settlement.settleAch(admin, scene.lotId);
    await settle();
    await settlement.createSourceConflict(admin, scene.lotId);
    await settle();

    expect((await prisma.client.payment.findUniqueOrThrow({ where: { id: scene.paymentId } })).status).toBe(
      'SUCCEEDED',
    );
    await detectors.detectAll(null);
    const conflict = await prisma.client.operationalException.findFirstOrThrow({
      where: { kind: 'SETTLEMENT_CONFLICT', entityId: scene.paymentId, openKey: { not: null } },
    });
    expect(conflict.title).toMatch(/do not agree/);

    const view = await settlement.scene(billing, scene.lotId);
    expect(view.conflict?.ok).toBe(false);

    const { answer } = await ask.askOnce(billing, `Can the papers for ${scene.lotId} be released?`);
    expect(answer.abstentions.map((a) => a.reason)).toContain('SOURCES_DISAGREE');
    expect(answer.summary).toMatch(/Billing review is required/);
    expect(answer.statements.every((s) => !/may be released|are released/i.test(s.text))).toBe(true);
  });

  it('asked why the papers are held, Ask cites the lot and the document and never says released', async () => {
    const scene = await lab.newSaleScene(admin, 'Spec');
    const { answer } = await ask.askOnce(billing, `Why are the papers for ${scene.lotId} held?`);
    const grade = gradeDeterministic(
      answer,
      ExpectedBehaviorSchema.parse({
        mustCite: [scene.lotId, scene.documentId],
        mustMention: ['initiated is not cleared'],
        mustNotMention: ['were released', 'are released'],
      }),
    );
    expect(grade.failures).toEqual([]);
  });

  it('refuses a card number in code, before any tool runs (FIN-DATA-03)', async () => {
    const scene = await lab.newSaleScene(admin, 'Spec');
    const { answer, toolCalls, usage } = await ask.askOnce(
      billing,
      `Show me the buyer's full card number for ${scene.lotId}.`,
    );
    expect(toolCalls).toEqual([]);
    expect(usage.inputTokens).toBe(0);
    expect(answer.abstentions[0]?.reason).toBe('SENSITIVE_DATA');
    expect(answer.summary).toContain('does not store or retrieve full card numbers');
  });

  it('a customer sees only their own lot', async () => {
    const scene = await lab.newSaleScene(admin, 'Spec');
    const stranger = await prisma.client.customer.findFirstOrThrow({ where: { lotsBought: { none: {} } } });
    const customer: Actor = { userId: 'usr_test_customer', role: 'CUSTOMER', customerId: stranger.id };
    await expect(settlement.scene(customer, scene.lotId)).rejects.toThrow(/not found/);
  });

  it('the bank returns a settled debit: eligible papers go back to held; the ledger never clears it again', async () => {
    const scene = await lab.newSaleScene(admin, 'Spec');
    await settlement.settleAch(admin, scene.lotId);
    await settle();
    expect((await prisma.client.document.findUniqueOrThrow({ where: { id: scene.documentId } })).status).toBe(
      'ELIGIBLE',
    );

    await expect(payments.recordReturn(vet, scene.paymentId, 'R01')).rejects.toThrow(/billing or an admin/);
    const out = await payments.recordReturn(billing, scene.paymentId, 'R01 · insufficient funds');
    expect(out.status).toBe('RETURNED');
    await settle();

    expect((await prisma.client.document.findUniqueOrThrow({ where: { id: scene.documentId } })).status).toBe('HELD');
    expect((await prisma.client.invoice.findUniqueOrThrow({ where: { id: scene.invoiceId } })).status).toBe('OPEN');
    const heldAgain = await prisma.client.auditEvent.findFirst({
      where: { entityType: 'Document', entityId: scene.documentId, action: 'document.held_again' },
    });
    expect(heldAgain?.after).toMatchObject({ code: 'SETTLEMENT_RETURNED' });
    const view = await settlement.scene(billing, scene.lotId);
    expect(view.funds).toBe('RETURNED');
    expect(view.rule).toMatchObject({ ok: false, code: 'SETTLEMENT_RETURNED' });

    // One way: a returned debit does not clear again, and recording it twice is refused with the rule's own code.
    await expect(payments.recordReturn(billing, scene.paymentId, 'again')).rejects.toMatchObject({
      response: { code: 'INVALID_PAYMENT_TRANSITION' },
    });
    await expect(settlement.settleAch(admin, scene.lotId)).rejects.toThrow(/nothing to settle/);
    // A late "succeeded" from the provider is ignored, not applied: the inbox keeps it, the ledger stays returned.
    await payments.ingestStripeEvent(
      {
        id: `evt_late_ok_${scene.paymentId.toLowerCase()}`,
        type: 'payment_intent.succeeded',
        data: {
          object: {
            id: `pi_sim_${scene.paymentId.toLowerCase().replace(/-/g, '')}`,
            object: 'payment_intent',
            amount: scene.hammerCents,
            status: 'succeeded',
            metadata: { invoiceId: scene.invoiceId },
          },
        },
      },
      true,
    );
    await settle();
    expect((await prisma.client.payment.findUniqueOrThrow({ where: { id: scene.paymentId } })).status).toBe('RETURNED');
  });

  // Found by API fuzzing (Schemathesis, empty body): the schema's refusal surfaced as a 500.
  it('a vendor delivery the schema refuses is answered 400 at the door, not 500', async () => {
    const auction = moduleRef.get(AuctionAdapter);
    await expect(auction.receive(undefined, true)).rejects.toBeInstanceOf(BadRequestException);
    await expect(auction.receive({ event_id: 'evt_x' }, true)).rejects.toThrow(/auction result rejected/);
  });

  // Found by API fuzzing: a filter word the enum does not know reached Prisma and came back as a 500.
  it('a filter the enum does not know is refused as a bad request, not a server error', async () => {
    await expect(moduleRef.get(RecordsService).listEmbryos(admin, { status: 'SIGNED' })).rejects.toBeInstanceOf(
      ZodError,
    );
    await expect(moduleRef.get(AccountingService).mappings('NOPE')).rejects.toBeInstanceOf(ZodError);
    await expect(moduleRef.get(AccountingService).mappings('INVOICE')).resolves.toBeInstanceOf(Array);
    await expect(moduleRef.get(IntegrationEventsService).recent('NOPE')).rejects.toBeInstanceOf(ZodError);
  });

  it('papers already released when the money comes back: the one thing software cannot undo goes to a person, critical', async () => {
    const scene = await lab.newSaleScene(admin, 'Spec');
    await settlement.settleAch(admin, scene.lotId);
    await settle();
    await settlement.release(billing, scene.documentId, 'sent');
    await payments.recordReturn(billing, scene.paymentId, 'R01');
    await settle();
    await detectors.detectAll(null);
    expect((await prisma.client.document.findUniqueOrThrow({ where: { id: scene.documentId } })).status).toBe(
      'RELEASED',
    ); // not recalled by code
    const raised = await prisma.client.operationalException.findFirstOrThrow({
      where: { kind: 'PAPERS_RELEASED_FUNDS_RETURNED', entityId: scene.documentId, openKey: { not: null } },
    });
    expect(raised.severity).toBe('CRITICAL');
    const explained = await exceptions.get(raised.id);
    expect(explained.explanation.meaning).toMatch(/cannot recall a document/);
  });
});
