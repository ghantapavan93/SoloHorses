/**
 * The vet's word, written down, is what every rule reads: the departure rule wants a video,
 * the return rule wants an assessment, the transfer rule wants a current exam and culture.
 * Recording one changes nothing else directly; the detectors and the rules see it on the
 * next pass. Each spec builds its own mare.
 */
import type { Actor } from '@daysheet/domain';
import type { TestingModule } from '@nestjs/testing';
import { OutboxService } from '../../../platform/events/outbox.service';
import { PrismaService } from '../../../platform/persistence/prisma.service';
import { JobsService } from '../../../platform/queue/jobs.service';
import { seq } from '../../../test-support/fixtures';
import { createTestModule } from '../../../test-support/module';
import { BillingModule } from '../../billing/billing.module';
import { SettlementService } from '../../billing/application/settlement.service';
import { DetectorsService } from '../../operations/application/detectors.service';
import { OperationsModule } from '../../operations/operations.module';
import { ReproductionModule } from '../../reproduction/reproduction.module';
import { TransfersService } from '../../reproduction/application/transfers.service';
import { VeterinaryModule } from '../veterinary.module';
import { ClearancesService } from './clearances.service';

describe('Clearances: the vet records, the rules read', () => {
  let moduleRef: TestingModule;
  let prisma: PrismaService;
  let clearances: ClearancesService;
  let detectors: DetectorsService;
  let transfers: TransfersService;
  let settlement: SettlementService;
  let outbox: OutboxService;
  let jobs: JobsService;
  let vet: Actor;
  let recips: Actor;

  beforeAll(async () => {
    moduleRef = await createTestModule({
      imports: [VeterinaryModule, ReproductionModule, BillingModule, OperationsModule],
    });
    prisma = moduleRef.get(PrismaService);
    clearances = moduleRef.get(ClearancesService);
    detectors = moduleRef.get(DetectorsService);
    transfers = moduleRef.get(TransfersService);
    settlement = moduleRef.get(SettlementService);
    outbox = moduleRef.get(OutboxService);
    jobs = moduleRef.get(JobsService);
    const user = async (role: 'VET' | 'RECIPS'): Promise<Actor> => {
      const row = await prisma.client.user.findFirstOrThrow({ where: { role } });
      return { userId: row.id, role, customerId: null };
    };
    vet = await user('VET');
    recips = await user('RECIPS');
  });

  afterAll(async () => {
    await moduleRef.close();
  });

  /** A recip of this spec's own; the shared sequence keeps ids unique across runs against one database. */
  async function mare(data: Record<string, unknown> = {}) {
    const n = await seq(prisma.client);
    const id = `R-9${n}`;
    return prisma.client.horse.create({
      data: {
        id,
        name: `Spec recip ${n}`,
        sex: 'MARE',
        kind: 'RECIPIENT',
        site: 'RECIP_FARM',
        recipNumber: 90000 + Number(n),
        recipStatus: 'CARRYING',
        ...data,
      },
    });
  }

  async function settle(): Promise<void> {
    await outbox.publishPending();
    await jobs.flushPending();
  }

  it('only the vet team records a clearance, and the row carries who and when', async () => {
    const r = await mare();
    await expect(clearances.record(recips, { horseId: r.id, kind: 'VIDEO_IN_FOAL', result: 'CLEAR' })).rejects.toThrow(
      /vet team/,
    );
    const out = await clearances.record(vet, {
      horseId: r.id,
      kind: 'VIDEO_IN_FOAL',
      result: 'CLEAR',
      note: 'seen on video',
    });
    const row = await prisma.client.clearance.findUniqueOrThrow({ where: { id: out.clearanceId } });
    expect(row.recordedById).toBe(vet.userId);
    expect(row.note).toBe('seen on video');
    const audit = await prisma.client.auditEvent.findFirstOrThrow({
      where: { entityType: 'Clearance', entityId: out.clearanceId, action: 'clearance.recorded' },
    });
    expect(audit.actorId).toBe(vet.userId);
    expect(
      await prisma.client.domainEvent.findFirst({ where: { type: 'ClearanceRecorded', aggregateId: out.clearanceId } }),
    ).not.toBeNull();
  });

  it('a leaving mare without a video is raised; the video resolves it on the next sweep', async () => {
    const departureOn = new Date(Date.UTC(2026, 3, 22, 12)); // two days after the demo clock
    const r = await mare({ scheduledDepartureOn: departureOn });
    await detectors.detectAll(null);
    const raised = await prisma.client.operationalException.findFirstOrThrow({
      where: { kind: 'DEPARTURE_UNCONFIRMED', entityId: r.id, openKey: { not: null } },
    });
    expect(raised.title).toMatch(/no video confirmation/);

    await clearances.record(vet, { horseId: r.id, kind: 'VIDEO_IN_FOAL', result: 'CLEAR' });
    await settle();
    await detectors.detectAll(null);
    const after = await prisma.client.operationalException.findUniqueOrThrow({ where: { id: raised.id } });
    expect(after.status).toBe('RESOLVED');
  });

  it('a returned in-utero mare waits on the vet; a clear assessment meets the condition, an abnormal one leaves the fee to a person', async () => {
    const buyer = await prisma.client.customer.findFirstOrThrow();
    const r = await mare({
      recipStatus: 'OPEN',
      weanedOn: new Date(Date.UTC(2026, 2, 31, 12)),
      returnedOn: new Date(Date.UTC(2026, 3, 14, 12)),
    });
    const lotId = `LOT-99-${r.id.slice(3)}`;
    await prisma.client.saleLot.create({
      data: {
        id: lotId,
        kind: 'IN_UTERO',
        title: 'Spec in-utero lot',
        closedOn: new Date(Date.UTC(2025, 8, 13, 12)),
        hammerCents: 1_000_000,
        buyerId: buyer.id,
        recipId: r.id,
      },
    });
    await detectors.detectAll(null);
    const raised = await prisma.client.operationalException.findFirstOrThrow({
      where: { kind: 'RETURN_ASSESSMENT_MISSING', entityId: r.id, openKey: { not: null } },
    });

    const admin = await prisma.client.user.findFirstOrThrow({ where: { role: 'ADMIN' } });
    const before = (await settlement.returns({ userId: admin.id, role: 'ADMIN', customerId: null })).find(
      (x) => x.lot.id === lotId,
    );
    expect(before?.decision).toBe('WAITING_ON_VET');

    await clearances.record(vet, { horseId: r.id, kind: 'RETURN_ASSESSMENT', result: 'ABNORMAL', note: 'not open' });
    await settle();
    await detectors.detectAll(null);
    expect((await prisma.client.operationalException.findUniqueOrThrow({ where: { id: raised.id } })).status).toBe(
      'RESOLVED',
    );
    const abnormal = (await settlement.returns({ userId: admin.id, role: 'ADMIN', customerId: null })).find(
      (x) => x.lot.id === lotId,
    );
    expect(abnormal?.decision).toBe('A_PERSON_DECIDES');
    expect(abnormal?.rule.ok).toBe(false);
    expect(abnormal && !abnormal.rule.ok ? abnormal.rule.reason : '').toMatch(/a person decides/);
    // The decision lands on the board for billing, with nothing charged.
    const decision = await prisma.client.operationalException.findFirstOrThrow({
      where: { kind: 'RETURN_FEE_DECISION', entityId: r.id, openKey: { not: null } },
    });
    expect(decision.source).toBe('BILLING');
    expect(await prisma.client.invoice.count({ where: { customerId: buyer.id, kind: 'LATE_RETURN' } })).toBe(0);

    await clearances.record(vet, { horseId: r.id, kind: 'RETURN_ASSESSMENT', result: 'CLEAR' });
    await settle();
    await detectors.detectAll(null);
    const clear = (await settlement.returns({ userId: admin.id, role: 'ADMIN', customerId: null })).find(
      (x) => x.lot.id === lotId,
    );
    expect(clear?.decision).toBe('CONDITION_MET');
    expect((await prisma.client.operationalException.findUniqueOrThrow({ where: { id: decision.id } })).status).toBe(
      'RESOLVED',
    );
  });

  it('a current exam and culture clear a mare for transfer; the rule reads the new rows', async () => {
    const r = await mare({ recipStatus: 'SET_UP' });
    expect((await transfers.clearanceFor(r.id)).ok).toBe(false);
    await clearances.record(vet, { horseId: r.id, kind: 'UTERINE_CULTURE', result: 'CLEAR' });
    expect((await transfers.clearanceFor(r.id)).ok).toBe(false);
    const exam = await clearances.record(vet, { horseId: r.id, kind: 'PRE_TRANSFER_EXAM', result: 'CLEAR' });
    expect(exam.expiresOn).not.toBeNull();
    const verdict = await transfers.clearanceFor(r.id);
    expect(verdict.ok).toBe(true);
    expect(verdict.evidenceIds).toContain(exam.clearanceId);
  });
});
