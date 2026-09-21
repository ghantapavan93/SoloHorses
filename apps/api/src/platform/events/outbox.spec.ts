/**
 * Integration tests for the spine: the outbox, idempotent consumers, the job ledger, dead
 * letters and the exceptions they raise. Run against the test database.
 */
import type { TestingModule } from '@nestjs/testing';
import { OperationsModule } from '../../modules/operations/operations.module';
import { createTestModule } from '../../test-support/module';
import { PrismaService } from '../persistence/prisma.service';
import { JobsService } from '../queue/jobs.service';
import { EventDispatcher } from './event-dispatcher';
import { OutboxService } from './outbox.service';

describe('outbox → dispatcher → consumers (integration)', () => {
  const modules: TestingModule[] = [];
  let prisma: PrismaService;
  let outbox: OutboxService;
  let dispatcher: EventDispatcher;
  let jobs: JobsService;
  const handled: string[] = [];
  let failNext = 0;

  beforeAll(async () => {
    const moduleRef = await createTestModule({ imports: [OperationsModule] });
    modules.push(moduleRef);
    prisma = moduleRef.get(PrismaService);
    outbox = moduleRef.get(OutboxService);
    dispatcher = moduleRef.get(EventDispatcher);
    jobs = moduleRef.get(JobsService);
    dispatcher.register({
      name: 'test.counter',
      events: ['TestThingHappened'],
      handle: async (event) => {
        if (failNext > 0) {
          failNext -= 1;
          throw new Error('consumer hiccup');
        }
        handled.push(event.id);
        await Promise.resolve();
      },
    });
  });

  afterAll(async () => {
    await Promise.all(modules.map((m) => m.close()));
  });

  it('delivers an event appended in a transaction exactly once, even when published twice', async () => {
    const event = await prisma.client.$transaction((tx) =>
      outbox.append(tx, { aggregateType: 'Test', aggregateId: 'T-1', type: 'TestThingHappened', payload: { n: 1 } }),
    );
    expect((await prisma.client.domainEvent.findUniqueOrThrow({ where: { id: event.id } })).publishedAt).toBeNull();

    await outbox.publishPending();
    expect(handled.filter((id) => id === event.id)).toHaveLength(1);
    expect(await dispatcher.processedFor(event.id)).toHaveLength(1);

    // A second dispatch of the same event (a redelivered job) is acknowledged and skipped.
    await dispatcher.dispatch(event.id);
    expect(handled.filter((id) => id === event.id)).toHaveLength(1);
  });

  it('a failing consumer rolls back its processed row so the next delivery tries again', async () => {
    failNext = 1;
    const event = await prisma.client.$transaction((tx) =>
      outbox.append(tx, { aggregateType: 'Test', aggregateId: 'T-2', type: 'TestThingHappened', payload: { n: 2 } }),
    );
    await outbox.publishPending(); // inline: the domain-event job runs, the consumer throws, the job parks as RETRYING
    expect(handled).not.toContain(event.id);
    expect(await dispatcher.processedFor(event.id)).toHaveLength(0);
    const parked = await prisma.client.jobRecord.findUniqueOrThrow({ where: { id: `evt_${event.id}` } });
    expect(parked.status).toBe('RETRYING');
    expect(parked.lastError).toContain('consumer hiccup');

    // The retry (here: forced, as the flush loop would when the wait elapses) succeeds.
    await prisma.client.jobRecord.update({ where: { id: parked.id }, data: { nextRunAt: new Date(Date.now() - 1) } });
    await jobs.flushPending();
    expect(handled).toContain(event.id);
    expect(await dispatcher.processedFor(event.id)).toHaveLength(1);
  });

  it('a job that exhausts its attempts is dead-lettered into an exception; a successful retry resolves it', async () => {
    let broken = true;
    jobs.register('reconcile', async () => {
      if (broken) throw new Error('books unreachable');
      await Promise.resolve();
    });
    const jobId = `reconcile_test_${Date.now().toString(36)}`;
    await jobs.enqueue('reconcile', { requestedBy: null }, { jobId }); // reconcile allows one attempt
    const dead = await prisma.client.jobRecord.findUniqueOrThrow({ where: { id: jobId } });
    expect(dead.status).toBe('DEAD');

    await outbox.publishPending(); // JobDeadLettered → operations.dead-letter → exception
    const exception = await prisma.client.operationalException.findUnique({ where: { openKey: `job:${jobId}` } });
    expect(exception?.kind).toBe('JOB_DEAD_LETTERED');
    expect(exception?.status).toBe('OPEN');

    broken = false;
    await jobs.retry(jobId);
    expect((await prisma.client.jobRecord.findUniqueOrThrow({ where: { id: jobId } })).status).toBe('COMPLETED');
    await outbox.publishPending(); // JobRecovered → operations.job-recovered → resolved
    const resolved = await prisma.client.operationalException.findUniqueOrThrow({ where: { id: exception!.id } });
    expect(resolved.status).toBe('RESOLVED');
    expect(resolved.resolution).toContain('retry');
  });
});
