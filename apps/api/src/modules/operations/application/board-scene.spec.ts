/**
 * The board scene the seed writes is state, not a picture: a payment whose accounting sync
 * was rate-limited five times and dead-lettered. "Retry" on the board must re-run the real
 * sync against the simulator, book the payment, and let the recovery close the exception.
 * The spec builds its own copy of the scene so a run never consumes the seeded one.
 */
import type { TestingModule } from '@nestjs/testing';
import { OutboxService } from '../../../platform/events/outbox.service';
import { PrismaService } from '../../../platform/persistence/prisma.service';
import { createDeadSyncSceneFixture } from '../../../test-support/fixtures';
import { createTestModule } from '../../../test-support/module';
import { AccountingModule } from '../../accounting/accounting.module';
import { BillingModule } from '../../billing/billing.module';
import { ReproductionModule } from '../../reproduction/reproduction.module';
import { OperationsModule } from '../operations.module';
import { ExceptionsService } from './exceptions.service';

describe('The accounting scene on the board', () => {
  let moduleRef: TestingModule;
  let prisma: PrismaService;
  let exceptions: ExceptionsService;
  let outbox: OutboxService;

  beforeAll(async () => {
    moduleRef = await createTestModule({
      imports: [AccountingModule, BillingModule, ReproductionModule, OperationsModule],
    });
    prisma = moduleRef.get(PrismaService);
    exceptions = moduleRef.get(ExceptionsService);
    outbox = moduleRef.get(OutboxService);
  });

  afterAll(async () => {
    await moduleRef.close();
  });

  it('is a dead-lettered sync with five rate-limited attempts behind it', async () => {
    const scene = await createDeadSyncSceneFixture(prisma.client);
    const attempts = await prisma.client.syncAttempt.findMany({ where: { jobId: scene.jobId } });
    expect(attempts).toHaveLength(5);
    expect(attempts.every((a) => a.httpStatus === 429 && a.ok === false)).toBe(true);
    expect((await prisma.client.jobRecord.findUniqueOrThrow({ where: { id: scene.jobId } })).status).toBe('DEAD');
    expect(scene.exception.kind).toBe('ACCOUNTING_SYNC_FAILED');
  });

  it('a person pressing Retry runs the real sync, books the payment and closes the exception', async () => {
    const admin = await prisma.client.user.findFirstOrThrow({ where: { role: 'ADMIN' } });
    const scene = await createDeadSyncSceneFixture(prisma.client);

    const result = await exceptions.retry({ userId: admin.id, role: 'ADMIN', customerId: null }, scene.exception.id);
    expect(result.ok).toBe(true);
    await outbox.publishPending(); // JobRecovered → the operations consumer resolves it

    expect((await prisma.client.jobRecord.findUniqueOrThrow({ where: { id: scene.jobId } })).status).toBe('COMPLETED');
    const mapping = await prisma.client.accountingMapping.findFirstOrThrow({
      where: { entityType: 'PAYMENT', entityId: scene.paymentId },
    });
    expect(mapping.status).toBe('SYNCED');
    expect(mapping.externalId).not.toBeNull();
    const closed = await prisma.client.operationalException.findUniqueOrThrow({ where: { id: scene.exception.id } });
    expect(closed.status).toBe('RESOLVED');
    expect(closed.resolution).toMatch(/retry/);
  });
});
