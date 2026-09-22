/**
 * A send whose answer never came is not a failure: the provider may have sent it. The
 * delivery service says UNKNOWN, opens the exception a person reconciles from, and never
 * sends again on its own; a provider that said no is FAILED and final; a provider that was
 * not there is retried.
 */
import type { TestingModule } from '@nestjs/testing';
import { OperationsModule } from '../../modules/operations/operations.module';
import { createTestModule } from '../../test-support/module';
import { OutboxService } from '../events/outbox.service';
import { PrismaService } from '../persistence/prisma.service';
import { UnrecoverableJobError } from '../queue/jobs.service';
import { classifySendError, DeliveryService } from './delivery.service';
import { MessagingService } from './messaging.provider';

class ScriptedMessaging {
  readonly smsMode = 'simulated' as const;
  readonly emailMode = 'simulated' as const;
  next: Error | null = null;
  sent = 0;
  sendSms(): Promise<{ providerMessageId: string | null; simulated: boolean }> {
    if (this.next) {
      const error = this.next;
      this.next = null;
      return Promise.reject(error);
    }
    this.sent += 1;
    return Promise.resolve({ providerMessageId: `SM_test_${this.sent}`, simulated: true });
  }
  sendEmail(): Promise<{ providerMessageId: string | null; simulated: boolean }> {
    return this.sendSms();
  }
  verifyInbound(): boolean {
    return false;
  }
}

describe('classifySendError', () => {
  it('reads the provider status when there is one, the network code when there is not, and calls the rest unknown', () => {
    expect(classifySendError(Object.assign(new Error('bad number'), { status: 400 }))).toBe('rejected');
    expect(classifySendError(Object.assign(new Error('service unavailable'), { status: 503 }))).toBe('unaccepted');
    expect(classifySendError(Object.assign(new Error('refused'), { code: 'ECONNREFUSED' }))).toBe('unaccepted');
    expect(classifySendError(Object.assign(new Error('reset'), { code: 'ECONNRESET' }))).toBe('unknown');
    const timeout = new Error('The operation was aborted due to timeout');
    timeout.name = 'TimeoutError';
    expect(classifySendError(timeout)).toBe('unknown');
    expect(classifySendError(new Error('fetch failed'))).toBe('unknown');
  });
});

describe('DeliveryService and the outcome it cannot prove', () => {
  const modules: TestingModule[] = [];
  let prisma: PrismaService;
  let delivery: DeliveryService;
  let outbox: OutboxService;
  const messaging = new ScriptedMessaging();

  beforeAll(async () => {
    const moduleRef = await createTestModule(
      { imports: [OperationsModule] },
      { overrides: [{ provide: MessagingService, useValue: messaging }] },
    );
    modules.push(moduleRef);
    prisma = moduleRef.get(PrismaService);
    delivery = moduleRef.get(DeliveryService);
    outbox = moduleRef.get(OutboxService);
  });

  afterAll(async () => {
    await Promise.all(modules.map((m) => m.close()));
  });

  async function queued(): Promise<string> {
    const message = await prisma.client.message.create({
      data: {
        direction: 'OUT',
        channel: 'SMS',
        status: 'QUEUED',
        fromAddress: '+15550000000',
        toAddress: '+15550000001',
        body: 'test: the day-14 check is recorded',
      },
    });
    return message.id;
  }

  it('marks a send that never answered UNKNOWN, opens the exception, and does not send again', async () => {
    const id = await queued();
    const timeout = new Error('The operation was aborted due to timeout');
    timeout.name = 'TimeoutError';
    messaging.next = timeout;
    const before = messaging.sent;

    await expect(delivery.deliver(id)).resolves.toBeUndefined();
    const row = await prisma.client.message.findUniqueOrThrow({ where: { id } });
    expect(row.status).toBe('UNKNOWN');
    expect(row.sentAt).toBeNull();

    await outbox.publishPending();
    const exception = await prisma.client.operationalException.findFirst({
      where: { kind: 'DELIVERY_UNKNOWN', entityId: id },
    });
    expect(exception?.status).toBe('OPEN');
    expect(exception?.title).toContain('may or may not have gone out');

    // A retry of the same job is a no-op: nothing goes out twice on the system's own initiative.
    await delivery.deliver(id);
    expect(messaging.sent).toBe(before);
  });

  it('calls a provider rejection FAILED and final, and a provider outage retryable', async () => {
    const rejected = await queued();
    messaging.next = Object.assign(new Error('invalid To number'), { status: 400 });
    await expect(delivery.deliver(rejected)).rejects.toBeInstanceOf(UnrecoverableJobError);
    expect((await prisma.client.message.findUniqueOrThrow({ where: { id: rejected } })).status).toBe('FAILED');

    const outage = await queued();
    messaging.next = Object.assign(new Error('service unavailable'), { status: 503 });
    await expect(delivery.deliver(outage)).rejects.not.toBeInstanceOf(UnrecoverableJobError);
    expect((await prisma.client.message.findUniqueOrThrow({ where: { id: outage } })).status).toBe('FAILED');
    // Not there, then there: the retry sends once.
    await delivery.deliver(outage);
    expect((await prisma.client.message.findUniqueOrThrow({ where: { id: outage } })).status).toBe('SENT');
  });
});
