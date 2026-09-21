/**
 * A decision's x-ray, on the seeded board: the graph is drawn from rows that exist, the block is
 * the rule that refused, the person is the one the signal names, a customer sees none of it, and
 * the assistant's "why" explains the same state.
 */
import type { Actor } from '@daysheet/domain';
import type { TestingModule } from '@nestjs/testing';
import { ForbiddenException } from '@nestjs/common';
import { PrismaService } from '../../../platform/persistence/prisma.service';
import { createTestModule } from '../../../test-support/module';
import { AccountingModule } from '../../accounting/accounting.module';
import { AskModule } from '../../ask/ask.module';
import { AskService } from '../../ask/application/ask.service';
import { BillingModule } from '../../billing/billing.module';
import { ReproductionModule } from '../../reproduction/reproduction.module';
import { VeterinaryModule } from '../../veterinary/veterinary.module';
import { OperationsModule } from '../operations.module';
import { SIGNAL_SHAPES } from '../domain/signals';
import type { Xray } from '../domain/xray';
import { ExceptionsService } from './exceptions.service';
import { XrayService } from './xray.service';

const admin: Actor = { userId: 'test-admin', role: 'ADMIN', customerId: null };
const customer: Actor = { userId: 'test-customer', role: 'CUSTOMER', customerId: 'C-0001' };

describe('a decision’s x-ray', () => {
  let moduleRef: TestingModule;
  let prisma: PrismaService;
  let xrays: XrayService;
  let exceptions: ExceptionsService;
  let ask: AskService;
  let signalId: string;
  let recipId: string;
  let xray: Xray;

  beforeAll(async () => {
    moduleRef = await createTestModule({
      imports: [AccountingModule, BillingModule, ReproductionModule, VeterinaryModule, OperationsModule, AskModule],
    });
    prisma = moduleRef.get(PrismaService);
    xrays = moduleRef.get(XrayService);
    exceptions = moduleRef.get(ExceptionsService);
    ask = moduleRef.get(AskService);
    // The story mare's leading open signal: the decision the front door's card opens on.
    recipId = await xrays.storyRecipId();
    const open = await exceptions.openRelatedTo(recipId);
    const leading = open.find((s) => s.severity === 'CRITICAL') ?? open[0];
    if (!leading) throw new Error(`the seed left no open signal about ${recipId}`);
    signalId = leading.id;
    const built = await xrays.forSignal(admin, signalId);
    if (!built) throw new Error(`${signalId} resolved to no mare`);
    xray = built;
  });

  afterAll(async () => {
    await moduleRef.close();
  });

  it('is drawn from rows that exist: every record node opens on its row, and the graph is lit at the decision', async () => {
    expect(xray.subject).toBe(recipId);
    expect(xray.focusId).toBe(`signal:${signalId}`);
    expect(xray.blockId).toBe(xray.focusId);
    const refs = xray.nodes.filter((n) => n.recordRef).map((n) => n.recordRef!);
    expect(refs.length).toBeGreaterThanOrEqual(4);
    const db = prisma.client;
    for (const ref of refs) {
      const row =
        ref.startsWith('R-') || ref.startsWith('H-')
          ? await db.horse.findUnique({ where: { id: ref } })
          : ref.startsWith('E-')
            ? await db.embryo.findUnique({ where: { id: ref } })
            : ref.startsWith('TR-')
              ? await db.transfer.findUnique({ where: { id: ref } })
              : ref.startsWith('CHK-')
                ? await db.pregnancyCheck.findUnique({ where: { id: ref } })
                : ref.startsWith('CLR-')
                  ? await db.clearance.findUnique({ where: { id: ref } })
                  : ref.startsWith('INV-')
                    ? await db.invoice.findUnique({ where: { id: ref } })
                    : ref.startsWith('PAY-')
                      ? await db.payment.findUnique({ where: { id: ref } })
                      : ref.startsWith('OX-')
                        ? await db.operationalException.findUnique({ where: { id: ref } })
                        : ref.startsWith('RQ-')
                          ? await db.request.findUnique({ where: { id: ref } })
                          : null;
      expect(row).not.toBeNull();
    }
    // Every edge joins two nodes that are there; no node is decorative.
    const ids = new Set(xray.nodes.map((n) => n.id));
    for (const edge of xray.edges) expect(ids.has(edge.from) && ids.has(edge.to)).toBe(true);
    expect(
      xray.nodes.every(
        (n) => n.recordRef || n.type === 'rule' || n.type === 'gap' || n.type === 'fact' || n.type === 'decision',
      ),
    ).toBe(true);
  });

  it('names the condition that blocks and the person who decides, from the signal’s own rule and owner', async () => {
    const row = await prisma.client.operationalException.findUniqueOrThrow({ where: { id: signalId } });
    const detail = row.detail as { code?: string } | null;
    const blocked = xray.rulesApplied.filter((r) => r.verdict === 'blocked');
    expect(blocked.length).toBeGreaterThan(0);
    if (detail?.code) expect(blocked.map((r) => r.code)).toContain(detail.code);
    expect(xray.unresolvedBoundary?.owner).toBe(SIGNAL_SHAPES[row.kind].owner);
    expect(xray.unresolvedBoundary?.next).toBe(SIGNAL_SHAPES[row.kind].next);
    expect(xray.conclusion.length).toBeGreaterThan(0);
  });

  it('is read by staff only: a customer gets no evidence graph, and a decision with no mare behind it has none', async () => {
    await expect(xrays.forSignal(customer, signalId)).rejects.toBeInstanceOf(ForbiddenException);
    const books = await prisma.client.operationalException.findFirst({
      where: { kind: 'ACCOUNTING_SYNC_FAILED', status: { in: ['OPEN', 'ACKNOWLEDGED'] } },
      select: { id: true },
    });
    if (books) await expect(xrays.forSignal(admin, books.id)).resolves.toBeNull();
  });

  it('the assistant’s "why" explains the same state: the same fingerprint, evidence drawn from the same rows', async () => {
    // Ask writes the conversation under a real user; the seeded admin stands in.
    const seededAdmin = await prisma.client.user.findFirstOrThrow({ where: { role: 'ADMIN' }, select: { id: true } });
    let investigation: { stateHash: string; subject: string } | null = null;
    let cited: string[] = [];
    for await (const event of ask.ask(
      { userId: seededAdmin.id, role: 'ADMIN', customerId: null },
      `What is blocking ${recipId}?`,
      null,
    )) {
      if (event.type === 'answer') {
        investigation = event.investigation;
        cited = [
          ...event.answer.statements.flatMap((s) => s.evidence),
          ...event.answer.conflicts.flatMap((c) => c.ids),
        ];
      }
      if (event.type === 'error') throw new Error(event.message);
    }
    expect(investigation?.subject).toBe(recipId);
    expect(investigation?.stateHash).toBe(xray.stateHash);
    const known = new Set(xray.nodes.flatMap((n) => (n.recordRef ? [n.recordRef] : [])));
    expect(cited.length).toBeGreaterThan(0);
    for (const id of cited) expect(known.has(id)).toBe(true);
  });
});
