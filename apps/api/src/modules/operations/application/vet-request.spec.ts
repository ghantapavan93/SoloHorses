/**
 * The one consequential act the assistant may prepare for a mare who cannot leave: a
 * veterinary confirmation request. Proposing sends nothing; approval sends it through the
 * same call "Send to team" uses, with the approver's name on it; a video recorded in between
 * makes the proposal stale and nothing goes out.
 */
import { ConflictException, ForbiddenException } from '@nestjs/common';
import type { TestingModule } from '@nestjs/testing';
import { evaluateDeparture } from '@daysheet/domain';
import { ClockService } from '../../../platform/clock/clock.service';
import { PrismaService } from '../../../platform/persistence/prisma.service';
import { createTestModule } from '../../../test-support/module';
import { ReproductionModule } from '../../reproduction/reproduction.module';
import { OperationsModule } from '../operations.module';
import { ProposalsService } from './proposals.service';

describe('a veterinary confirmation request, proposed by the assistant and sent by a person (integration)', () => {
  const modules: TestingModule[] = [];
  let prisma: PrismaService;
  let proposals: ProposalsService;
  let vet: { userId: string; role: 'VET'; customerId: null };

  let moduleRef: TestingModule;

  beforeAll(async () => {
    moduleRef = await createTestModule({ imports: [ReproductionModule, OperationsModule] });
    modules.push(moduleRef);
    prisma = moduleRef.get(PrismaService);
    proposals = moduleRef.get(ProposalsService);
    // A request row carries the sender's user: the seeded vet, so the foreign key holds.
    const user = await prisma.client.user.findFirstOrThrow({ where: { role: 'VET' } });
    vet = { userId: user.id, role: 'VET', customerId: null };
  });

  afterAll(async () => {
    await Promise.all(modules.map((m) => m.close()));
  });

  async function leavingRecip() {
    const rows = await prisma.client.$queryRaw<
      { value: number }[]
    >`INSERT INTO "Sequence" ("key", "value") VALUES ('test-vet-request', 1) ON CONFLICT ("key") DO UPDATE SET "value" = "Sequence"."value" + 1 RETURNING "value"`;
    const n = rows[0]?.value ?? Date.now() % 10_000;
    const recip = await prisma.client.horse.create({
      data: {
        id: `R-97${String(n).padStart(4, '0')}`,
        name: 'Test Leaving Recip',
        sex: 'MARE',
        kind: 'RECIPIENT',
        site: 'RECIP_FARM',
        recipNumber: 970_000 + n,
        recipStatus: 'CARRYING',
        scheduledDepartureOn: new Date(Date.now() + 2 * 86_400_000),
      },
    });
    return { recip, n };
  }

  const payloadFor = (recipId: string) => ({
    recipId,
    subject: `Veterinary confirmation for ${recipId}`,
    body: `${recipId} leaves in two days without a video-confirmed in-foal check on record.`,
  });
  const requestsAbout = (recipId: string) => prisma.client.request.count({ where: { evidenceIds: { has: recipId } } });

  it('proposing sends nothing; approval sends the request through the team-request service with the approver on it, edits included', async () => {
    const { recip } = await leavingRecip();
    const proposal = await proposals.propose(vet, 'REQUEST_VETERINARY_CONFIRMATION', payloadFor(recip.id), 'test', [
      recip.id,
    ]);
    expect(await requestsAbout(recip.id)).toBe(0);
    const outcome = await proposals.approve(vet, proposal.id, {
      body: 'Please confirm her in foal on video before she leaves Thursday.',
      note: 'tightened the wording',
    });
    expect(outcome.status).toBe('APPROVED');
    const request = await prisma.client.request.findFirstOrThrow({ where: { evidenceIds: { has: recip.id } } });
    expect(request.createdById).toBe(vet.userId);
    expect(request.subject).toBe(`Veterinary confirmation for ${recip.id}`);
    expect(request.body).toBe('Please confirm her in foal on video before she leaves Thursday.');
    const row = await prisma.client.proposal.findUniqueOrThrow({ where: { id: proposal.id } });
    expect(row.status).toBe('APPROVED');
    expect(row.decision).toContain('with an edit');
    expect((row.result as { requestId: string }).requestId).toBe(request.id);
    expect(
      await prisma.client.auditEvent.count({
        where: { entityType: 'Request', entityId: request.id, action: 'request.created' },
      }),
    ).toBe(1);
  });

  it('a video recorded between the proposal and the click makes it stale: nothing is sent, and the row says so', async () => {
    const { recip, n } = await leavingRecip();
    const proposal = await proposals.propose(vet, 'REQUEST_VETERINARY_CONFIRMATION', payloadFor(recip.id), 'test', [
      recip.id,
    ]);
    expect((await prisma.client.proposal.findUniqueOrThrow({ where: { id: proposal.id } })).stateHash).toMatch(
      /^[0-9a-f]{16}$/,
    );
    await prisma.client.clearance.create({
      data: {
        id: `CLR-97-${String(n).padStart(4, '0')}V`.slice(0, 20),
        horseId: recip.id,
        kind: 'VIDEO_IN_FOAL',
        result: 'CLEAR',
        performedOn: new Date(),
      },
    });
    const outcome = await proposals.approve(vet, proposal.id);
    expect(outcome).toMatchObject({ status: 'STALE', code: 'PROPOSAL_STALE' });
    expect(await requestsAbout(recip.id)).toBe(0);
    const row = await prisma.client.proposal.findUniqueOrThrow({ where: { id: proposal.id } });
    expect(row.status).toBe('STALE');
    expect(
      await prisma.client.auditEvent.count({
        where: { entityType: 'Proposal', entityId: proposal.id, action: 'proposal.stale' },
      }),
    ).toBe(1);
  });

  it('once one request has gone out, a second proposal for the same mare is stale: the same request is never sent twice', async () => {
    const { recip } = await leavingRecip();
    const first = await proposals.propose(vet, 'REQUEST_VETERINARY_CONFIRMATION', payloadFor(recip.id), 'test', [
      recip.id,
    ]);
    const second = await proposals.propose(vet, 'REQUEST_VETERINARY_CONFIRMATION', payloadFor(recip.id), 'test', [
      recip.id,
    ]);
    expect((await proposals.approve(vet, first.id)).status).toBe('APPROVED');
    expect(await proposals.approve(vet, second.id)).toMatchObject({ status: 'STALE', code: 'PROPOSAL_STALE' });
    expect(await requestsAbout(recip.id)).toBe(1);
  });

  it('a proposal prepared while the request is already open is refused by the rule at approval, even though a person said yes', async () => {
    const { recip } = await leavingRecip();
    const first = await proposals.propose(vet, 'REQUEST_VETERINARY_CONFIRMATION', payloadFor(recip.id), 'test', [
      recip.id,
    ]);
    expect((await proposals.approve(vet, first.id)).status).toBe('APPROVED');
    // Prepared after the request went out: its fingerprint already includes the open request, so it is not stale — the rule refuses it instead.
    const later = await proposals.propose(vet, 'REQUEST_VETERINARY_CONFIRMATION', payloadFor(recip.id), 'test', [
      recip.id,
    ]);
    expect(await proposals.approve(vet, later.id)).toMatchObject({ status: 'DECLINED', code: 'REFUSED_BY_RULE' });
    expect(await requestsAbout(recip.id)).toBe(1);
    expect((await prisma.client.proposal.findUniqueOrThrow({ where: { id: later.id } })).decision).toContain(
      'already open',
    );
  });

  // The diff a person reads before the click: the same reads the fingerprint binds, and the same verdict on staleness.
  it('the diff shows what a yes changes from exactly the reads the proposal is bound to, and turns stale when they move', async () => {
    const { recip } = await leavingRecip();
    const proposal = await proposals.propose(vet, 'REQUEST_VETERINARY_CONFIRMATION', payloadFor(recip.id), 'test', [
      recip.id,
    ]);
    const fresh = await proposals.diff(vet, proposal.id);
    expect(fresh.stale).toBe(false);
    expect(fresh.stateHashAtProposal).toBe(fresh.stateHashNow);
    expect(fresh.subject).toBe(recip.id);
    const request = fresh.lines.find((l) => l.field === 'request to the vet');
    expect(request).toMatchObject({ record: recip.id, before: 'none', changes: true });
    expect(request?.after).toContain(payloadFor(recip.id).subject);
    expect(fresh.lines.filter((l) => !l.changes).length).toBeGreaterThan(0); // the facts the rule reads and leaves alone
    // The rule's preview is the domain's own verdict over the same read, on the barn's date.
    const today = moduleRef.get(ClockService).today();
    const verdict = evaluateDeparture(
      {
        id: recip.id,
        scheduledDepartureOn: recip.scheduledDepartureOn?.toISOString().slice(0, 10) ?? null,
        clearances: [],
      },
      today,
    );
    expect(fresh.rule?.verdict).toBe(verdict.ok ? 'ok' : 'blocked');
    expect(fresh.authority.roles).toContain('VET');
    expect(fresh.willNot).toContain('clear the mare');
    // A video recorded after the proposal moves the reads: the diff says so before anyone clicks, and approval refuses.
    await prisma.client.clearance.create({
      data: {
        id: `CLR-97-${recip.recipNumber}`,
        horseId: recip.id,
        kind: 'VIDEO_IN_FOAL',
        result: 'CLEAR',
        performedOn: new Date(),
      },
    });
    const moved = await proposals.diff(vet, proposal.id);
    expect(moved.stale).toBe(true);
    expect(moved.stateHashNow).not.toBe(moved.stateHashAtProposal);
    expect(moved.lines.find((l) => l.field === 'video-confirmed in foal')?.before).toContain('CLR-97-');
    expect(await proposals.approve(vet, proposal.id)).toMatchObject({ status: 'STALE' });
    expect((await proposals.diff(vet, proposal.id)).stale).toBe(true);
    await expect(
      proposals.diff({ userId: 'usr_test_customer', role: 'CUSTOMER', customerId: 'C-0001' }, proposal.id),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  // The ledger: projected from the rows, in order, appended to and never rewritten, honest about the outcome.
  it('the ledger reads prepared → approved → executed in order, names who did what, points every event at a row, and awaits the outcome rather than claiming it', async () => {
    const { recip } = await leavingRecip();
    const proposal = await proposals.propose(vet, 'REQUEST_VETERINARY_CONFIRMATION', payloadFor(recip.id), 'test', [
      recip.id,
    ]);
    const waiting = await proposals.ledger(vet, proposal.id);
    expect(waiting.summary).toMatchObject({
      decisionId: proposal.id,
      subject: recip.id,
      kind: 'REQUEST_VETERINARY_CONFIRMATION',
      status: 'PROPOSED',
      decidedBy: null,
      executedAt: null,
      executionRef: null,
    });
    expect(waiting.summary.evidenceFingerprint).toBe(proposal.stateHash);
    expect(waiting.outcome).toMatchObject({ state: 'none' });
    const kinds = (ledger: typeof waiting) => ledger.timeline.map((e) => e.kind);
    expect(kinds(waiting)).toEqual(['prepared']);
    expect(waiting.timeline[0]).toMatchObject({ result: 'prepared', ref: proposal.id, by: { role: 'VET' } });
    expect(waiting.timeline[0]?.provenance).toMatchObject({ stateHash: proposal.stateHash, evidenceIds: [recip.id] });
    expect(waiting.timeline[0]?.provenance.auditId).toBeTruthy();

    await proposals.approve(vet, proposal.id);
    const approved = await proposals.ledger(vet, proposal.id);
    expect(kinds(approved)).toEqual(['prepared', 'decided', 'executed']);
    // Append-only: what was there is still there, unchanged.
    expect(approved.timeline[0]).toEqual(waiting.timeline[0]);
    const at = approved.timeline.map((e) => e.at);
    expect([...at].sort()).toEqual(at);
    const decided = approved.timeline.find((e) => e.kind === 'decided');
    const executed = approved.timeline.find((e) => e.kind === 'executed');
    expect(decided).toMatchObject({ result: 'approved', by: { role: 'VET' } });
    expect(decided?.by?.name.length).toBeGreaterThan(0);
    expect(decided?.provenance.auditId).toBeTruthy();
    expect(executed).toMatchObject({ result: 'executed', by: { role: 'VET' } });
    expect(executed?.ref).toMatch(/^RQ-\d{2}-\d{4,6}$/); // the request's own code, minted like every record's
    expect(executed?.provenance.rule).toContain('RequestsService.create');
    expect(approved.summary).toMatchObject({
      status: 'APPROVED',
      decidedBy: { role: 'VET' },
      executionRef: executed?.ref,
    });
    // Sending the request is executed; the mare's question is still open, so the outcome is awaited, not claimed.
    expect(approved.outcome).toMatchObject({ state: 'awaiting' });
    expect(approved.timeline.some((e) => e.kind === 'outcome')).toBe(false);
  });

  it('a stale refusal and a rejection are decisions with nothing executed, each naming the person and the reason', async () => {
    const { recip } = await leavingRecip();
    const first = await proposals.propose(vet, 'REQUEST_VETERINARY_CONFIRMATION', payloadFor(recip.id), 'test', [
      recip.id,
    ]);
    await prisma.client.clearance.create({
      data: {
        id: `CLR-97-${recip.recipNumber}L`,
        horseId: recip.id,
        kind: 'VIDEO_IN_FOAL',
        result: 'CLEAR',
        performedOn: new Date(),
      },
    });
    expect((await proposals.approve(vet, first.id)).status).toBe('STALE');
    const stale = await proposals.ledger(vet, first.id);
    expect(stale.timeline.map((e) => e.kind)).toEqual(['prepared', 'decided']);
    expect(stale.timeline[1]).toMatchObject({ result: 'stale', by: { role: 'VET' } });
    expect(stale.timeline[1]?.provenance.stateHash).toContain('→'); // both fingerprints: the one it was made from, the one it met
    expect(stale.outcome).toMatchObject({ state: 'none' });
    expect(stale.summary.executedAt).toBeNull();

    const second = await proposals.propose(vet, 'REQUEST_VETERINARY_CONFIRMATION', payloadFor(recip.id), 'test', [
      recip.id,
    ]);
    await proposals.decline(vet, second.id, 'not today');
    const declined = await proposals.ledger(vet, second.id);
    expect(declined.timeline.map((e) => e.result)).toEqual(['prepared', 'declined']);
    expect(declined.summary).toMatchObject({ status: 'DECLINED', executionRef: null });
    expect(declined.summary.decision).toContain('not today');

    // The board's line: a customer reads no ledger.
    await expect(
      proposals.ledger({ userId: 'usr_test_customer', role: 'CUSTOMER', customerId: 'C-0001' }, second.id),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('two people click approve at once: one request goes out, the other click learns it lost', async () => {
    const { recip } = await leavingRecip();
    const proposal = await proposals.propose(vet, 'REQUEST_VETERINARY_CONFIRMATION', payloadFor(recip.id), 'test', [
      recip.id,
    ]);
    const outcomes = await Promise.allSettled([
      proposals.approve(vet, proposal.id),
      proposals.approve(vet, proposal.id),
    ]);
    const fulfilled = outcomes.filter((o) => o.status === 'fulfilled');
    const rejected = outcomes.filter((o): o is PromiseRejectedResult => o.status === 'rejected');
    expect(fulfilled).toHaveLength(1);
    expect(rejected).toHaveLength(1);
    expect(rejected[0]?.reason).toBeInstanceOf(ConflictException);
    expect(await requestsAbout(recip.id)).toBe(1);
  });

  it('only a role with operations rights approves it', async () => {
    const { recip } = await leavingRecip();
    const proposal = await proposals.propose(vet, 'REQUEST_VETERINARY_CONFIRMATION', payloadFor(recip.id), 'test', [
      recip.id,
    ]);
    await expect(
      proposals.approve({ userId: 'test-customer', role: 'CUSTOMER', customerId: 'C-0001' }, proposal.id),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(await requestsAbout(recip.id)).toBe(0);
  });
});
