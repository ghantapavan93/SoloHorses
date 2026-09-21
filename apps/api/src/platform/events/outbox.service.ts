import { AsyncLocalStorage } from 'node:async_hooks';
import { Injectable, Logger, type OnModuleDestroy, type OnModuleInit } from '@nestjs/common';
import type { Prisma } from '@daysheet/db';
import { EnvService } from '../config/env.module';
import { newCorrelationId, withCorrelation } from '../observability/correlation';
import { PlatformBus } from '../observability/platform-bus';
import { PrismaService } from '../persistence/prisma.service';
import { JobsService } from '../queue/jobs.service';
import { appendDomainEvent, type DomainEventInput, type DomainEventRecord } from './domain-event';

/**
 * The transactional outbox.
 *
 *   append()          inside the producer's transaction: the fact and the row change commit together
 *   publishPending()  afterwards: every unpublished event becomes a `domain-event` job, in order
 *   flush()           the polite way to call publishPending after a commit
 *
 * If the process dies between the commit and the publish, the interval publisher finds the
 * event on the next tick. If it dies between the publish and marking published, the event is
 * published twice under the same job id, which the queue and the consumers both tolerate.
 */
@Injectable()
export class OutboxService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(OutboxService.name);
  private timer: NodeJS.Timeout | null = null;
  private publishing: Promise<number> | null = null;
  private readonly publishScope = new AsyncLocalStorage<true>();

  constructor(
    private readonly prisma: PrismaService,
    private readonly jobs: JobsService,
    private readonly bus: PlatformBus,
    private readonly envService: EnvService,
  ) {}

  onModuleInit(): void {
    this.jobs.onDeadLetter(() => void this.flush().catch((e: Error) => this.logger.warn(`outbox: ${e.message}`)));
    if (this.envService.env.NODE_ENV === 'test') return;
    this.timer = setInterval(
      () => void this.publishPending().catch((e: Error) => this.logger.warn(`outbox: ${e.message}`)),
      2_000,
    );
    this.timer.unref();
  }

  onModuleDestroy(): void {
    if (this.timer) clearInterval(this.timer);
  }

  async append(tx: Prisma.TransactionClient, input: DomainEventInput): Promise<DomainEventRecord> {
    const event = await appendDomainEvent(tx, input);
    this.bus.emit({
      kind: 'event',
      eventId: event.id,
      type: event.type,
      aggregate: `${event.aggregateType}:${event.aggregateId}`,
      stage: 'appended',
    });
    return event;
  }

  /**
   * Call after the transaction that appended events has committed. Inline mode runs the
   * consumers before returning so the caller's next read is consistent; redis mode hands
   * off and returns.
   */
  flush(): Promise<number> {
    if (this.jobs.mode === 'inline') return this.publishPending();
    void this.publishPending().catch((e: Error) => this.logger.warn(`outbox: ${e.message}`));
    return Promise.resolve(0);
  }

  /** Publishes in occurrence order; one in-flight pass per process. */
  publishPending(): Promise<number> {
    if (this.publishScope.getStore()) {
      // A consumer (or a job it enqueued) appended events while this pass was running; the
      // pass re-queries after each round, so there is nothing to wait for here.
      return Promise.resolve(0);
    }
    if (this.publishing) return this.publishing;
    this.publishing = this.publishScope
      .run(true, () => this.publishBatch())
      .finally(() => {
        this.publishing = null;
      });
    return this.publishing;
  }

  /**
   * Publishes until nothing is left. Consumers append events of their own inside their
   * transactions; in inline mode those exist by the time a round ends, so the loop picks
   * them up without recursing into itself.
   */
  private async publishBatch(): Promise<number> {
    let total = 0;
    for (let round = 0; round < 10; round += 1) {
      const published = await this.publishRound();
      total += published;
      if (published === 0) break;
    }
    return total;
  }

  private async publishRound(): Promise<number> {
    const db = this.prisma.client;
    const events = await db.domainEvent.findMany({
      where: { publishedAt: null },
      orderBy: { occurredAt: 'asc' },
      take: 100,
    });
    let published = 0;
    for (const event of events) {
      try {
        // The job inherits the event's correlation, so a consumer's audit rows join the same story.
        await withCorrelation(
          { correlationId: event.correlationId ?? newCorrelationId('evt'), causationId: event.id },
          () => this.jobs.enqueue('domain-event', { eventId: event.id }, { jobId: `evt_${event.id}` }),
        );
        await db.domainEvent.update({
          where: { id: event.id },
          data: { publishedAt: new Date(), publishAttempts: { increment: 1 }, lastError: null },
        });
        this.bus.emit({
          kind: 'event',
          eventId: event.id,
          type: event.type,
          aggregate: `${event.aggregateType}:${event.aggregateId}`,
          stage: 'published',
        });
        published += 1;
      } catch (error) {
        await db.domainEvent.update({
          where: { id: event.id },
          data: { publishAttempts: { increment: 1 }, lastError: (error as Error).message.slice(0, 500) },
        });
        this.logger.warn(`could not publish ${event.type} ${event.id}: ${(error as Error).message}`);
      }
    }
    return published;
  }

  async recent(limit = 50, aggregateType?: string, aggregateId?: string) {
    return this.prisma.client.domainEvent.findMany({
      where: aggregateType ? { aggregateType, ...(aggregateId ? { aggregateId } : {}) } : {},
      orderBy: { occurredAt: 'desc' },
      take: limit,
    });
  }

  async lag(): Promise<{ unpublished: number; oldestUnpublishedAgeMs: number | null }> {
    const db = this.prisma.client;
    const unpublished = await db.domainEvent.count({ where: { publishedAt: null } });
    const oldest =
      unpublished > 0
        ? await db.domainEvent.findFirst({ where: { publishedAt: null }, orderBy: { occurredAt: 'asc' } })
        : null;
    return { unpublished, oldestUnpublishedAgeMs: oldest ? Date.now() - oldest.occurredAt.getTime() : null };
  }
}
