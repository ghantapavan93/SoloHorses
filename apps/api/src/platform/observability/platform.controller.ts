import { Body, Controller, Get, Param, Post, Query } from '@nestjs/common';
import type { Actor } from '@daysheet/domain';
import { z } from 'zod';
import { AuditService } from '../audit/audit.service';
import { CacheService } from '../cache/cache.service';
import { ClockService } from '../clock/clock.service';
import { EnvService } from '../config/env.module';
import { EventDispatcher } from '../events/event-dispatcher';
import { OutboxService } from '../events/outbox.service';
import { ZodBodyPipe } from '../http/zod-body.pipe';
import { PrismaService } from '../persistence/prisma.service';
import { JobsService } from '../queue/jobs.service';
import { CircuitBreakerRegistry } from '../resilience/circuit-breaker';
import { RateLimiter } from '../resilience/rate-limit';
import { CurrentActor } from '../security/actor';
import { Requires } from '../security/permission.guard';
import { MetricsService } from './metrics.service';

const CacheKeySchema = z.object({ key: z.string().min(1).max(200) });

/**
 * What the platform is doing, from its own tables and counters. This is what the
 * Architecture page and the Operations "Inspect" drawer read. Nothing here is typed by
 * hand: consumers come from the dispatcher's registry, jobs from the ledger, breakers
 * from the registry, and a trace from every row that shares a correlation id.
 */
@Controller('platform')
export class PlatformController {
  constructor(
    private readonly metrics: MetricsService,
    private readonly jobs: JobsService,
    private readonly outbox: OutboxService,
    private readonly dispatcher: EventDispatcher,
    private readonly breakers: CircuitBreakerRegistry,
    private readonly cache: CacheService,
    private readonly rateLimiter: RateLimiter,
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly clock: ClockService,
    private readonly envService: EnvService,
  ) {}

  @Get('metrics')
  @Requires('read', 'platform')
  async snapshot() {
    const [jobs, lag] = await Promise.all([this.jobs.health(), this.outbox.lag()]);
    return {
      metrics: this.metrics.snapshot(),
      jobs,
      outbox: lag,
      breakers: this.breakers.snapshot(),
      stores: { cache: this.cache.store, rateLimit: this.rateLimiter.store, queue: this.jobs.mode },
      integrations: this.envService.integrations,
      today: this.clock.today(),
    };
  }

  @Get('consumers')
  @Requires('read', 'platform')
  consumers() {
    return this.dispatcher.registry();
  }

  @Get('jobs')
  @Requires('read', 'platform')
  jobsList(@Query('queue') queue?: string, @Query('limit') limit?: string) {
    return this.jobs.recent(Math.min(Number(limit ?? '50') || 50, 200), queue);
  }

  @Post('jobs/:id/retry')
  @Requires('write', 'platform')
  async retryJob(@CurrentActor() actor: Actor, @Param('id') id: string) {
    const result = await this.jobs.retry(id);
    await this.audit.record({
      actor,
      source: 'UI',
      action: 'job.retried',
      entityType: 'JobRecord',
      entityId: id,
      after: result,
    });
    return result;
  }

  @Get('events')
  @Requires('read', 'platform')
  events(
    @Query('aggregateType') aggregateType?: string,
    @Query('aggregateId') aggregateId?: string,
    @Query('limit') limit?: string,
  ) {
    return this.outbox.recent(Math.min(Number(limit ?? '50') || 50, 200), aggregateType, aggregateId);
  }

  @Get('events/:id/processed')
  @Requires('read', 'platform')
  processed(@Param('id') id: string) {
    return this.dispatcher.processedFor(id);
  }

  @Post('breakers/:dependency/reset')
  @Requires('write', 'platform')
  async resetBreaker(@CurrentActor() actor: Actor, @Param('dependency') dependency: string) {
    this.breakers.reset(dependency);
    await this.audit.record({
      actor,
      source: 'UI',
      action: 'breaker.reset',
      entityType: 'Dependency',
      entityId: dependency,
    });
    await this.jobs.flushPending();
    return { ok: true, state: this.breakers.stateOf(dependency) };
  }

  @Post('cache/inspect')
  @Requires('read', 'platform')
  inspectCache(@Body(new ZodBodyPipe(CacheKeySchema)) body: z.infer<typeof CacheKeySchema>) {
    return this.cache.inspect(body.key);
  }

  /** Everything that shares one correlation id: audit rows, events, jobs, sync attempts, inbox rows. */
  @Get('trace/:correlationId')
  @Requires('read', 'platform')
  async trace(@Param('correlationId') correlationId: string) {
    const db = this.prisma.client;
    const [auditRows, events, jobs, inbox, exceptions] = await Promise.all([
      db.auditEvent.findMany({ where: { correlationId }, orderBy: { at: 'asc' }, take: 100 }),
      db.domainEvent.findMany({ where: { correlationId }, orderBy: { occurredAt: 'asc' }, take: 100 }),
      db.jobRecord.findMany({ where: { correlationId }, orderBy: { createdAt: 'asc' }, take: 100 }),
      db.integrationEvent.findMany({ where: { correlationId }, orderBy: { receivedAt: 'asc' }, take: 50 }),
      db.operationalException.findMany({ where: { correlationId }, orderBy: { createdAt: 'asc' }, take: 50 }),
    ]);
    const jobIds = jobs.map((j) => j.id);
    const syncAttempts =
      jobIds.length > 0
        ? await db.syncAttempt.findMany({
            where: { jobId: { in: jobIds } },
            include: { mapping: true },
            orderBy: { startedAt: 'asc' },
          })
        : [];
    // `until` is when the row's own work ended, so the trace can be drawn on a time axis: a job from
    // creation to finish, an event from commit to publish, a books call, an exception to its
    // resolution. `ok` is false only where the row itself records a failure.
    const steps = [
      ...auditRows.map((r) => ({
        at: r.at,
        until: null,
        kind: 'audit' as const,
        label: r.action,
        ref: `${r.entityType} ${r.entityId}`,
        ok: null,
        detail: r.after,
      })),
      ...events.map((e) => ({
        at: e.occurredAt,
        until: e.publishedAt,
        kind: 'event' as const,
        label: e.type,
        ref: `${e.aggregateType} ${e.aggregateId}`,
        ok: null,
        detail: { published: e.publishedAt !== null },
      })),
      ...jobs.map((j) => ({
        at: j.createdAt,
        until: j.finishedAt,
        kind: 'job' as const,
        label: `${j.queue} ${j.status.toLowerCase()}`,
        ref: j.id,
        ok: j.status === 'DEAD' ? false : j.status === 'COMPLETED' ? true : null,
        detail: { attempts: j.attempts, lastError: j.lastError, startedAt: j.startedAt },
      })),
      ...inbox.map((i) => ({
        at: i.receivedAt,
        until: i.processedAt,
        kind: 'webhook' as const,
        label: `${i.provider} ${i.type}`,
        ref: i.externalId,
        ok: i.status === 'FAILED' ? false : i.status === 'PROCESSED' ? true : null,
        detail: { status: i.status, duplicateDeliveries: i.duplicateDeliveries },
      })),
      ...syncAttempts.map((s) => ({
        at: s.startedAt,
        until: s.finishedAt,
        kind: 'integration' as const,
        label: `${s.mapping.entityType} ${s.ok ? 'ok' : 'fail'} ${s.httpStatus ?? ''}`.trim(),
        ref: s.mapping.entityId,
        ok: s.ok,
        detail: { error: s.error, remoteRequestId: s.remoteRequestId },
      })),
      ...exceptions.map((x) => ({
        at: x.createdAt,
        until: x.resolvedAt,
        kind: 'exception' as const,
        label: `${x.kind} ${x.status.toLowerCase()}`,
        ref: x.id,
        ok: null,
        detail: { title: x.title },
      })),
    ].sort((a, b) => a.at.getTime() - b.at.getTime());
    return { correlationId, steps };
  }
}
