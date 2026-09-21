import { Injectable, Logger, type OnModuleInit } from '@nestjs/common';
import { PlatformBus } from '../observability/platform-bus';
import { PrismaService } from '../persistence/prisma.service';
import { JobsService } from '../queue/jobs.service';
import type { DomainEventRecord, EventConsumer } from './domain-event';

/**
 * Delivers one published event to every consumer registered for its type.
 *
 * Each consumer runs in its own transaction that begins by inserting (consumer, eventId)
 * into processed_events. A second delivery hits the primary key, is acknowledged and
 * skipped; a handler that throws rolls back its own work *and* the processed row, so the
 * next delivery tries again. At-least-once delivery, exactly-once effect per consumer.
 *
 * Consumers run sequentially in registration order. One failing consumer fails the job
 * (BullMQ retries it); the consumers that already succeeded are skipped on the retry.
 */
@Injectable()
export class EventDispatcher implements OnModuleInit {
  private readonly logger = new Logger(EventDispatcher.name);
  private readonly consumers: EventConsumer[] = [];

  constructor(
    private readonly prisma: PrismaService,
    private readonly jobs: JobsService,
    private readonly bus: PlatformBus,
  ) {}

  onModuleInit(): void {
    this.jobs.register('domain-event', ({ eventId }) => this.dispatch(eventId));
  }

  register(consumer: EventConsumer): void {
    if (this.consumers.some((c) => c.name === consumer.name))
      throw new Error(`event consumer ${consumer.name} registered twice`);
    this.consumers.push(consumer);
  }

  /** What the Architecture page shows: who listens to what. Derived from code, not typed by hand. */
  registry(): { name: string; events: string[] }[] {
    return this.consumers.map((c) => ({ name: c.name, events: [...c.events] }));
  }

  async dispatch(eventId: string): Promise<void> {
    const db = this.prisma.client;
    const row = await db.domainEvent.findUnique({ where: { id: eventId } });
    if (!row) throw new Error(`domain event ${eventId} not found`);
    const event: DomainEventRecord = { ...row, payload: row.payload as Record<string, unknown> };
    const aggregate = `${event.aggregateType}:${event.aggregateId}`;
    const failures: string[] = [];
    for (const consumer of this.consumers.filter((c) => c.events.includes(event.type))) {
      try {
        const outcome = await db.$transaction(async (tx) => {
          const claimed = await tx.processedEvent.createMany({
            data: { consumer: consumer.name, eventId: event.id },
            skipDuplicates: true,
          });
          if (claimed.count === 0) return 'skipped' as const;
          await consumer.handle(event, tx);
          return 'consumed' as const;
        });
        this.bus.emit({
          kind: 'event',
          eventId: event.id,
          type: event.type,
          aggregate,
          stage: outcome,
          consumer: consumer.name,
        });
      } catch (error) {
        const message = (error as Error).message;
        failures.push(`${consumer.name}: ${message}`);
        this.logger.warn(`consumer ${consumer.name} failed on ${event.type} ${event.id}: ${message}`);
        this.bus.emit({
          kind: 'event',
          eventId: event.id,
          type: event.type,
          aggregate,
          stage: 'failed',
          consumer: consumer.name,
          error: message,
        });
      }
    }
    if (failures.length > 0) throw new Error(failures.join('; '));
    // Consumers may have enqueued jobs inside their transactions; hand them off now (or, if this
    // dispatch is itself running inside a flush, right after it).
    await this.jobs.flushPending();
  }

  async processedFor(eventId: string) {
    return this.prisma.client.processedEvent.findMany({ where: { eventId } });
  }
}
