/**
 * The vet records a check; money follows the rules, once, with an audit trail.
 */
import { PrismaService } from '../../../platform/persistence/prisma.service';
import { createTransferFixture } from '../../../test-support/fixtures';
import type { TestingModule } from '@nestjs/testing';
import { createTestModule } from '../../../test-support/module';
import { AccountingModule } from '../../accounting/accounting.module';
import { OperationsModule } from '../../operations/operations.module';
import { VeterinaryModule } from '../veterinary.module';
import { ChecksService } from './checks.service';

describe('ChecksService (integration)', () => {
  const modules: TestingModule[] = [];
  let checks: ChecksService;
  let prisma: PrismaService;
  let vet: { userId: string; role: 'VET'; customerId: null };
  let recips: { userId: string; role: 'RECIPS'; customerId: null };

  beforeAll(async () => {
    const moduleRef = await tracked(
      createTestModule({ imports: [AccountingModule, VeterinaryModule, OperationsModule] }),
    );
    checks = moduleRef.get(ChecksService);
    prisma = moduleRef.get(PrismaService);
    const vetUser = await prisma.client.user.findFirstOrThrow({ where: { role: 'VET' } });
    const recipUser = await prisma.client.user.findFirstOrThrow({ where: { role: 'RECIPS' } });
    vet = { userId: vetUser.id, role: 'VET', customerId: null };
    recips = { userId: recipUser.id, role: 'RECIPS', customerId: null };
  });

  afterAll(async () => {
    await Promise.all(modules.map((m) => m.close()));
  });

  async function tracked(pending: Promise<TestingModule>): Promise<TestingModule> {
    const m = await pending;
    modules.push(m);
    return m;
  }

  async function transferWithoutLeaseFee() {
    const { transfer } = await createTransferFixture(prisma.client, { vetUserId: vet.userId, daysAgo: 17 });
    return transfer;
  }

  it('a day-24 heartbeat invoices the lease fee exactly once', async () => {
    const transfer = await transferWithoutLeaseFee();
    const first = await checks.record(vet, { transferId: transfer.id, result: 'HEARTBEAT', dayNumber: 24 });
    expect(first.invoices).toHaveLength(1);
    expect(first.embryoStatus).toBe('PREGNANT');
    expect(first.boardStartsOn).not.toBeNull();

    const invoice = await prisma.client.invoice.findUniqueOrThrow({ where: { id: first.invoices[0]! } });
    expect(invoice.kind).toBe('LEASE_FEE');
    expect(invoice.triggeredByCheckId).toBe(first.checkId);
    expect(invoice.amountCents).toBe(650_000); // fresh ICSI embryo → the higher lease fee

    // Recording the heartbeat again (a second scan the same day) must not bill twice.
    const second = await checks.record(vet, { transferId: transfer.id, result: 'HEARTBEAT', dayNumber: 25 });
    expect(second.invoices).toHaveLength(0);
    const leaseFees = await prisma.client.invoice.count({ where: { transferId: transfer.id, kind: 'LEASE_FEE' } });
    expect(leaseFees).toBe(1);

    const audit = await prisma.client.auditEvent.findMany({ where: { entityType: 'Invoice', entityId: invoice.id } });
    expect(audit.some((a) => a.action === 'invoice.created')).toBe(true);
  });

  it('never bills on UNCLEAR and asks for a recheck', async () => {
    const transfer = await transferWithoutLeaseFee();
    const out = await checks.record(vet, { transferId: transfer.id, result: 'UNCLEAR', dayNumber: 24 });
    expect(out.invoices).toHaveLength(0);
    expect(out.statuses[0]).toMatchObject({ kind: 'RECHECK_REQUIRED' });
  });

  it('refuses a check recorded by a non-vet role', async () => {
    const transfer = await transferWithoutLeaseFee();
    await expect(checks.record(recips, { transferId: transfer.id, result: 'PREGNANT', dayNumber: 30 })).rejects.toThrow(
      /vet team/,
    );
  });
});
