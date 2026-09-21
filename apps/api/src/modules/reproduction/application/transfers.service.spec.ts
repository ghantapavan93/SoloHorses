/**
 * The deterministic rules at the boundary: a transfer into an uncleared or unavailable recip
 * never becomes a row; the assistant's proposal to hold a recip executes only through the
 * same rule, and only when a person approves.
 */
import { ConflictException } from '@nestjs/common';
import type { TestingModule } from '@nestjs/testing';
import { PrismaService } from '../../../platform/persistence/prisma.service';
import { createCustomerFixture } from '../../../test-support/fixtures';
import { createTestModule } from '../../../test-support/module';
import { OperationsModule } from '../../operations/operations.module';
import { ProposalsService } from '../../operations/application/proposals.service';
import { ReproductionModule } from '../reproduction.module';
import { TransfersService } from './transfers.service';

const RECIPS = { userId: 'test-recips', role: 'RECIPS' as const, customerId: null };
const VET = { userId: 'test-vet', role: 'VET' as const, customerId: null };

describe('transfers and proposals (integration)', () => {
  const modules: TestingModule[] = [];
  let prisma: PrismaService;
  let transfers: TransfersService;
  let proposals: ProposalsService;
  let seq = 0;

  beforeAll(async () => {
    const moduleRef = await createTestModule({ imports: [ReproductionModule, OperationsModule] });
    modules.push(moduleRef);
    prisma = moduleRef.get(PrismaService);
    transfers = moduleRef.get(TransfersService);
    proposals = moduleRef.get(ProposalsService);
  });

  afterAll(async () => {
    await Promise.all(modules.map((m) => m.close()));
  });

  async function recipFixture(
    status: 'SET_UP' | 'CARRYING' | 'AVAILABLE',
    clearances: ('EXAM_CLEAR' | 'EXAM_PENDING' | 'CULTURE_CLEAR')[],
  ) {
    const rows = await prisma.client.$queryRaw<
      { value: number }[]
    >`INSERT INTO "Sequence" ("key", "value") VALUES ('test-transfer', 1) ON CONFLICT ("key") DO UPDATE SET "value" = "Sequence"."value" + 1 RETURNING "value"`;
    const n = rows[0]?.value ?? ++seq;
    const recip = await prisma.client.horse.create({
      data: {
        id: `R-98${String(n).padStart(4, '0')}`,
        name: 'Test Recip',
        sex: 'MARE',
        kind: 'RECIPIENT',
        site: 'RECIP_FARM',
        recipNumber: 980_000 + n,
        recipStatus: status,
      },
    });
    for (const c of clearances) {
      const kind = c === 'CULTURE_CLEAR' ? 'UTERINE_CULTURE' : 'PRE_TRANSFER_EXAM';
      await prisma.client.clearance.create({
        data: {
          id: `CLR-98-${String(n).padStart(4, '0')}${c === 'CULTURE_CLEAR' ? 'C' : 'E'}`.slice(0, 20),
          horseId: recip.id,
          kind,
          result: c === 'EXAM_PENDING' ? 'PENDING' : 'CLEAR',
          performedOn: new Date(),
        },
      });
    }
    return recip;
  }

  async function embryoFixture() {
    const customer = await createCustomerFixture(prisma.client);
    const rows = await prisma.client.$queryRaw<
      { value: number }[]
    >`INSERT INTO "Sequence" ("key", "value") VALUES ('test-transfer', 1) ON CONFLICT ("key") DO UPDATE SET "value" = "Sequence"."value" + 1 RETURNING "value"`;
    const n = rows[0]?.value ?? ++seq;
    return prisma.client.embryo.create({
      data: {
        id: `E-98-${String(n).padStart(4, '0')}`,
        source: 'SHIPPED_IN',
        status: 'ARRIVED',
        customerId: customer.id,
        sireName: 'Test Sire',
        damName: 'Test Dam',
        arrivedAt: new Date(),
      },
    });
  }

  it('records a transfer into a cleared, set-up recip and cites the clearances', async () => {
    const recip = await recipFixture('SET_UP', ['EXAM_CLEAR', 'CULTURE_CLEAR']);
    const embryo = await embryoFixture();
    const result = await transfers.record(VET, { embryoId: embryo.id, recipientId: recip.id });
    expect(result.clearance).toContain(recip.id);
    expect(result.clearance.some((id) => id.startsWith('CLR-'))).toBe(true);
    const after = await prisma.client.embryo.findUniqueOrThrow({ where: { id: embryo.id } });
    expect(after.status).toBe('TRANSFERRED');
    expect((await prisma.client.horse.findUniqueOrThrow({ where: { id: recip.id } })).recipStatus).toBe('CARRYING');
  });

  it('refuses a transfer into a recip whose pre-transfer exam is pending — a 409 with the rule, not a warning', async () => {
    const recip = await recipFixture('SET_UP', ['EXAM_PENDING', 'CULTURE_CLEAR']);
    const embryo = await embryoFixture();
    await expect(transfers.record(VET, { embryoId: embryo.id, recipientId: recip.id })).rejects.toBeInstanceOf(
      ConflictException,
    );
    await expect(transfers.record(VET, { embryoId: embryo.id, recipientId: recip.id })).rejects.toMatchObject({
      response: { code: 'CLEARANCE_PENDING' },
    });
    expect(await prisma.client.transfer.count({ where: { embryoId: embryo.id } })).toBe(0);
  });

  it('refuses to hold a carrying recip for an embryo, and a person approving the proposal cannot override the rule', async () => {
    const recip = await recipFixture('CARRYING', ['EXAM_CLEAR', 'CULTURE_CLEAR']);
    const embryo = await embryoFixture();
    const proposal = await proposals.propose(
      RECIPS,
      'ASSIGN_PLANNED_RECIPIENT',
      { embryoId: embryo.id, recipientId: recip.id },
      'test',
      [embryo.id, recip.id],
    );
    const outcome = await proposals.approve(RECIPS, proposal.id);
    expect(outcome.status).toBe('DECLINED');
    const row = await prisma.client.proposal.findUniqueOrThrow({ where: { id: proposal.id } });
    expect(row.decision).toContain('refused by the rule');
    expect((await prisma.client.embryo.findUniqueOrThrow({ where: { id: embryo.id } })).plannedRecipientId).toBeNull();
  });

  it('an approved proposal for a set-up recip changes the record through the rule and is audited', async () => {
    const recip = await recipFixture('SET_UP', ['EXAM_CLEAR', 'CULTURE_CLEAR']);
    const embryo = await embryoFixture();
    const proposal = await proposals.propose(
      RECIPS,
      'ASSIGN_PLANNED_RECIPIENT',
      { embryoId: embryo.id, recipientId: recip.id },
      'test',
      [embryo.id, recip.id],
    );
    expect((await prisma.client.embryo.findUniqueOrThrow({ where: { id: embryo.id } })).plannedRecipientId).toBeNull(); // proposing changes nothing
    const outcome = await proposals.approve(RECIPS, proposal.id);
    expect(outcome.status).toBe('APPROVED');
    expect((await prisma.client.embryo.findUniqueOrThrow({ where: { id: embryo.id } })).plannedRecipientId).toBe(
      recip.id,
    );
    const audit = await prisma.client.auditEvent.findFirst({
      where: { entityType: 'Embryo', entityId: embryo.id, action: 'embryo.planned_recipient' },
    });
    expect(audit?.source).toBe('AI');
  });

  it('a proposal is bound to the records it was made from: if they move before approval, it is refused as stale, not executed', async () => {
    const first = await recipFixture('SET_UP', ['EXAM_CLEAR', 'CULTURE_CLEAR']);
    const second = await recipFixture('SET_UP', ['EXAM_CLEAR', 'CULTURE_CLEAR']);
    const embryo = await embryoFixture();
    const proposal = await proposals.propose(
      RECIPS,
      'ASSIGN_PLANNED_RECIPIENT',
      { embryoId: embryo.id, recipientId: first.id },
      'test',
      [embryo.id, first.id],
    );
    expect((await prisma.client.proposal.findUniqueOrThrow({ where: { id: proposal.id } })).stateHash).toMatch(
      /^[0-9a-f]{16}$/,
    );
    // Between the proposal and the click, the office holds a different mare for the embryo.
    await transfers.assignPlannedRecipient(RECIPS, embryo.id, second.id);
    const outcome = await proposals.approve(RECIPS, proposal.id);
    expect(outcome).toMatchObject({ status: 'STALE', code: 'PROPOSAL_STALE' });
    const row = await prisma.client.proposal.findUniqueOrThrow({ where: { id: proposal.id } });
    expect(row.status).toBe('STALE');
    expect(row.decision).toContain('stale');
    // The stale approval moved nothing: the hold the office made stands.
    expect((await prisma.client.embryo.findUniqueOrThrow({ where: { id: embryo.id } })).plannedRecipientId).toBe(
      second.id,
    );
    expect(
      await prisma.client.auditEvent.count({
        where: { entityType: 'Proposal', entityId: proposal.id, action: 'proposal.stale' },
      }),
    ).toBe(1);
  });

  it('a customer may not approve anything', async () => {
    const recip = await recipFixture('SET_UP', ['EXAM_CLEAR', 'CULTURE_CLEAR']);
    const embryo = await embryoFixture();
    const proposal = await proposals.propose(
      RECIPS,
      'ASSIGN_PLANNED_RECIPIENT',
      { embryoId: embryo.id, recipientId: recip.id },
      'test',
      [],
    );
    await expect(
      proposals.approve({ userId: 'test-customer', role: 'CUSTOMER', customerId: embryo.customerId }, proposal.id),
    ).rejects.toThrow(/may not approve/);
  });
});
