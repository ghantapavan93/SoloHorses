import { AsyncLocalStorage } from 'node:async_hooks';
import { Injectable, Logger, type OnModuleDestroy, type OnModuleInit } from '@nestjs/common';
import type { JobStatus, Prisma } from '@daysheet/db';
import { Queue, Worker, type Job } from 'bullmq';
import IORedis from 'ioredis';
import { EnvService } from '../config/env.module';
import { appendDomainEvent } from '../events/domain-event';
import {
  currentCausationId,
  currentCorrelationId,
  newCorrelationId,
  withCorrelation,
} from '../observability/correlation';
import { PlatformBus } from '../observability/platform-bus';
import { PrismaService } from '../persistence/prisma.service';

/**
 * Background work with a durable ledger.
 *
 * BullMQ on Redis schedules and retries; the JobRecord table remembers every job in either
 * mode, so "how many jobs are waiting, how many were lost" is answered from Postgres, not
 * from memory. A laptop without Redis runs the same handlers inline (the health endpoint
 * says which). Every job is idempotent by construction: its id is derived from the thing
 * being processed, and handlers re-read state before acting.
 *
 * A job that exhausts its attempts is dead-lettered: marked DEAD and turned into a
 * JobDeadLettered domain event in the same transaction, which the operations context
 * turns into an exception a person can see, retry or resolve.
 */

export interface JobPayloads {
  'domain-event': { eventId: string };
  'stripe-event': { integrationEventId: string };
  'auction-result': { integrationEventId: string };
  'qbo-sync': { entityType: 'CUSTOMER' | 'INVOICE' | 'PAYMENT' | 'CREDIT'; entityId: string; reason: string };
  reconcile: { requestedBy: string | null };
  'send-message': { messageId: string };
  'detect-exceptions': { requestedBy: string | null };
  'brief-snapshot': { trigger: 'sweep' | 'boot' };
}

export type JobName = keyof JobPayloads;
export interface JobContext {
  id: string;
  attempt: number;
}
export type JobHandler<N extends JobName> = (payload: JobPayloads[N], job: JobContext) => Promise<void>;

/** The provider asked us to slow down; the whole queue pauses for the window it named. No attempt is consumed. */
export class RateLimitedError extends Error {
  constructor(
    readonly retryAfterMs: number,
    message = 'rate limited',
  ) {
    super(message);
  }
}

/** A circuit breaker is open for a dependency; the job waits for the cooldown. No attempt is consumed. */
export class DependencyUnavailableError extends Error {
  constructor(
    readonly dependency: string,
    readonly retryAfterMs: number,
  ) {
    super(`${dependency} is unavailable (circuit open); retry after ${retryAfterMs}ms`);
  }
}

/** Retrying cannot help (validation, auth). Dead-letters immediately. */
export class UnrecoverableJobError extends Error {}

const QUEUE_OPTIONS: Record<
  JobName,
  { attempts: number; backoffMs: number; concurrency: number; limiter?: { max: number; duration: number } }
> = {
  'domain-event': { attempts: 5, backoffMs: 1_000, concurrency: 4 },
  'stripe-event': { attempts: 3, backoffMs: 2_000, concurrency: 4 },
  'auction-result': { attempts: 3, backoffMs: 2_000, concurrency: 2 },
  'qbo-sync': { attempts: 5, backoffMs: 2_000, concurrency: 2, limiter: { max: 5, duration: 1_000 } },
  reconcile: { attempts: 1, backoffMs: 0, concurrency: 1 },
  'send-message': { attempts: 3, backoffMs: 5_000, concurrency: 4 },
  'detect-exceptions': { attempts: 1, backoffMs: 0, concurrency: 1 },
  'brief-snapshot': { attempts: 1, backoffMs: 0, concurrency: 1 },
};

const MAX_INLINE_WAIT_MS = 10_000;

export interface EnqueueOptions {
  jobId?: string;
  delayMs?: number;
  /** Write the ledger row inside this transaction; the hand-off happens on the next flush. */
  tx?: Prisma.TransactionClient;
}

@Injectable()
export class JobsService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(JobsService.name);
  private readonly handlers = new Map<JobName, JobHandler<JobName>>();
  private readonly queues = new Map<JobName, Queue>();
  private readonly workers = new Map<JobName, Worker>();
  private connection: IORedis | null = null;
  private flushTimer: NodeJS.Timeout | null = null;
  private afterDeadLetter: (() => void) | null = null;
  private flushing: Promise<number> | null = null;
  /** Marks work running inside a flush, so a nested flush defers instead of waiting on itself. */
  private readonly flushScope = new AsyncLocalStorage<true>();
  mode: 'redis' | 'inline' = 'inline';
  /** Whether a Redis was configured at all: a missing one is a choice, an unreachable one is an outage. */
  redis: 'connected' | 'unreachable' | 'none' = 'none';
  paused = false;

  constructor(
    private readonly envService: EnvService,
    private readonly prisma: PrismaService,
    private readonly bus: PlatformBus,
  ) {}

  private get db() {
    return this.prisma.client;
  }

  async onModuleInit(): Promise<void> {
    if (this.envService.env.NODE_ENV === 'test') return; // tests drive handlers and flushes directly
    const url = this.envService.env.REDIS_URL;
    if (!url) {
      this.logger.log('No REDIS_URL: one process, jobs run inline from the ledger');
      this.startFlushTimer();
      return;
    }
    const probe = new IORedis(url, {
      lazyConnect: true,
      maxRetriesPerRequest: 1,
      connectTimeout: 1_500,
      enableOfflineQueue: false,
    });
    probe.on('error', () => undefined); // surfaced below as a warning, not an unhandled event
    try {
      await probe.connect();
      const info = await probe.info('server');
      const version = /redis_version:(\S+)/.exec(info)?.[1] ?? '?';
      if (Number(version.split('.')[0]) < 5) throw new Error(`Redis ${version} is too old for BullMQ (needs 5+)`);
      probe.disconnect();
      // BullMQ wants its own connection shape: no per-request retry cap (blocking commands) and an offline queue.
      this.connection = new IORedis(url, { maxRetriesPerRequest: null, enableReadyCheck: false });
      this.connection.on('error', (error) => this.logger.warn(`redis: ${error.message}`));
      this.mode = 'redis';
      this.redis = 'connected';
      this.logger.log(`BullMQ connected to Redis ${version} at ${url}`);
      if (this.envService.env.WORKERS === 'off')
        this.logger.log('WORKERS=off: this process enqueues; a worker process runs the queues');
      else this.startWorkers();
    } catch (error) {
      probe.disconnect();
      this.mode = 'inline';
      this.redis = 'unreachable';
      this.logger.warn(
        `Redis unavailable (${(error as Error).message}); jobs run inline in this process. Set REDIS_URL to use BullMQ.`,
      );
    }
    this.startFlushTimer();
  }

  /** The safety net: ledger rows written in a transaction but never handed off, and inline retries whose wait has elapsed. */
  private startFlushTimer(): void {
    this.flushTimer = setInterval(
      () => void this.flushPending().catch((e: Error) => this.logger.warn(`flush: ${e.message}`)),
      2_000,
    );
    this.flushTimer.unref();
  }

  async onModuleDestroy(): Promise<void> {
    if (this.flushTimer) clearInterval(this.flushTimer);
    await Promise.all([...this.workers.values()].map((w) => w.close()));
    await Promise.all([...this.queues.values()].map((q) => q.close()));
    this.connection?.disconnect();
  }

  /** Processors call this at module init. One handler per job name. */
  register<N extends JobName>(name: N, handler: JobHandler<N>): void {
    this.handlers.set(name, handler as JobHandler<JobName>);
  }

  /** The events module hooks the outbox flush here so a dead letter is published promptly. */
  onDeadLetter(callback: () => void): void {
    this.afterDeadLetter = callback;
  }

  // ───────────────────────────── enqueue ─────────────────────────────

  async enqueue<N extends JobName>(
    name: N,
    payload: JobPayloads[N],
    options: EnqueueOptions = {},
  ): Promise<{ mode: 'redis' | 'inline'; jobId: string; duplicate: boolean }> {
    // BullMQ rejects custom ids containing ':'; every id here uses '_' as the separator.
    const jobId = options.jobId ?? `${name}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    const client = options.tx ?? this.db;
    const existing = await client.jobRecord.findUnique({ where: { id: jobId } });
    if (existing && (existing.status === 'QUEUED' || existing.status === 'ACTIVE' || existing.status === 'RETRYING')) {
      // Same deterministic id, already in flight: the work will happen once. Finished or dead
      // jobs may be re-armed — a payment that moved from processing to succeeded syncs again.
      return { mode: this.mode, jobId, duplicate: true };
    }
    await client.jobRecord.upsert({
      where: { id: jobId },
      create: {
        id: jobId,
        queue: name,
        payload,
        maxAttempts: QUEUE_OPTIONS[name].attempts,
        correlationId: currentCorrelationId(),
        causationId: currentCausationId(),
        nextRunAt: options.delayMs ? new Date(Date.now() + options.delayMs) : null,
      },
      update: {
        status: 'QUEUED',
        attempts: 0,
        lastError: null,
        enqueuedAt: null,
        finishedAt: null,
        nextRunAt: null,
        payload,
      },
    });
    this.bus.emit({ kind: 'job', jobId, queue: name, status: 'queued' });
    if (options.tx) return { mode: this.mode, jobId, duplicate: false }; // hand-off after the caller commits
    await this.handOff(jobId, name, payload, options.delayMs ?? 0);
    return { mode: this.mode, jobId, duplicate: false };
  }

  /** Re-arms a dead or stuck job. Used by the operations UI ("Retry"). */
  async retry(jobId: string): Promise<{ ok: boolean; reason?: string }> {
    const record = await this.db.jobRecord.findUnique({ where: { id: jobId } });
    if (!record) return { ok: false, reason: 'unknown job' };
    if (record.status === 'ACTIVE') return { ok: false, reason: 'job is running' };
    await this.db.jobRecord.update({
      where: { id: jobId },
      data: { status: 'QUEUED', attempts: 0, lastError: null, enqueuedAt: null, finishedAt: null, nextRunAt: null },
    });
    if (this.mode === 'redis') {
      const stale = await this.queueFor(record.queue as JobName).getJob(jobId);
      if (stale) await stale.remove();
    }
    this.bus.emit({ kind: 'job', jobId, queue: record.queue, status: 'queued' });
    await this.handOff(jobId, record.queue as JobName, record.payload as JobPayloads[JobName], 0);
    return { ok: true };
  }

  /**
   * Schedules a flush after the current unit of work; the way to flush from inside a job.
   * Scheduled outside the flush scope: async context follows timers, and an immediate that
   * inherited "inside a flush" would defer itself forever.
   */
  flushSoon(): void {
    this.flushScope.exit(() =>
      setImmediate(() => void this.flushPending().catch((e: Error) => this.logger.warn(`flush: ${e.message}`))),
    );
  }

  /**
   * Hands off every ledger row that has not reached the queue yet, and runs inline retries
   * whose wait has elapsed. Idempotent; one pass in flight per process.
   */
  flushPending(): Promise<number> {
    if (this.flushScope.getStore()) {
      // Called from inside a job that this very flush is running: finish that job first.
      this.flushSoon();
      return Promise.resolve(0);
    }
    if (this.flushing) return this.flushing;
    this.flushing = this.flushScope
      .run(true, () => this.flushBatch())
      .finally(() => {
        this.flushing = null;
      });
    return this.flushing;
  }

  private async flushBatch(): Promise<number> {
    if (this.mode === 'redis') await this.reconcileWithQueue();
    const now = new Date();
    const due = { OR: [{ nextRunAt: null }, { nextRunAt: { lte: now } }] };
    const pending = await this.db.jobRecord.findMany({
      where: {
        OR: [
          // Written inside a transaction and never handed off (or the hand-off failed).
          { status: 'QUEUED', enqueuedAt: null, ...due },
          // Inline mode owns its own retries and its paused backlog; BullMQ owns those in redis mode.
          ...(this.mode === 'inline'
            ? [
                { status: 'QUEUED' as JobStatus, ...due },
                { status: 'RETRYING' as JobStatus, nextRunAt: { lte: now } },
              ]
            : []),
        ],
      },
      orderBy: { createdAt: 'asc' },
      take: 200,
    });
    let handed = 0;
    for (const record of pending) {
      if (this.paused) break;
      const delayMs =
        record.nextRunAt && record.enqueuedAt === null ? Math.max(0, record.nextRunAt.getTime() - Date.now()) : 0;
      await this.handOff(record.id, record.queue as JobName, record.payload as JobPayloads[JobName], delayMs);
      handed += 1;
    }
    return handed;
  }

  /**
   * The ledger is written by this process after BullMQ moves a job; a crash in between
   * leaves a row that says ACTIVE for work Redis knows finished. Every few seconds the
   * ledger asks Redis about rows that have been in flight too long and corrects itself,
   * so "how many jobs are waiting" stays true across restarts.
   */
  private lastReconcileAt = 0;

  private async reconcileWithQueue(): Promise<void> {
    if (Date.now() - this.lastReconcileAt < 10_000) return;
    this.lastReconcileAt = Date.now();
    // RETRYING rows too: a Redis that restarted without persistence forgets a delayed retry, and the ledger
    // would say "retrying" forever. Found by running: a parked sync job outlived the Redis it was parked in.
    const stale = await this.db.jobRecord.findMany({
      where: {
        status: { in: ['ACTIVE', 'QUEUED', 'RETRYING'] },
        enqueuedAt: { not: null },
        updatedAt: { lt: new Date(Date.now() - 30_000) },
      },
      take: 100,
    });
    for (const record of stale) {
      const name = record.queue as JobName;
      const job = await this.queueFor(name).getJob(record.id);
      const state = job ? await job.getState() : 'missing';
      if (state === 'completed') {
        await this.complete(record.id, name, job?.attemptsMade ?? record.attempts, record.deadLetteredAt !== null);
      } else if (state === 'failed') {
        await this.deadLetter(
          record.id,
          name,
          record.payload as Record<string, unknown>,
          job?.attemptsMade ?? record.attempts,
          job?.failedReason ?? 'failed while the process was away',
        );
      } else if (state === 'missing') {
        // Redis has no memory of it (evicted, or the add never happened): hand it off again.
        await this.db.jobRecord.update({ where: { id: record.id }, data: { status: 'QUEUED', enqueuedAt: null } });
      }
      // waiting / active / delayed: Redis still owns it; leave the row alone.
    }
  }

  // ───────────────────────────── operations ─────────────────────────────

  /**
   * The lab's "kill the worker": nothing is processed until resume; nothing is lost.
   * In redis mode the queues themselves are paused in Redis — a worker's own pause flag
   * cannot stop a fetch that was already blocking on Redis when the flag flipped.
   */
  async pause(): Promise<void> {
    this.paused = true;
    if (this.mode === 'redis') {
      for (const name of Object.keys(QUEUE_OPTIONS) as JobName[]) await this.queueFor(name).pause();
      for (const worker of this.workers.values()) await worker.pause(true);
      for (const name of this.queues.keys()) this.bus.emit({ kind: 'job', jobId: '-', queue: name, status: 'paused' });
    } else {
      this.bus.emit({ kind: 'job', jobId: '-', queue: 'inline', status: 'paused' });
    }
  }

  async resume(): Promise<void> {
    this.paused = false;
    if (this.mode === 'redis') {
      for (const name of Object.keys(QUEUE_OPTIONS) as JobName[]) await this.queueFor(name).resume();
      for (const worker of this.workers.values()) worker.resume();
    }
    await this.flushPending();
  }

  async health() {
    const rows = await this.db.jobRecord.groupBy({ by: ['status'], _count: { _all: true } });
    const byStatus = Object.fromEntries(rows.map((r) => [r.status, r._count._all])) as Partial<
      Record<JobStatus, number>
    >;
    const queues: Record<string, { waiting: number; active: number; delayed: number; failed: number }> = {};
    if (this.mode === 'redis') {
      for (const name of Object.keys(QUEUE_OPTIONS) as JobName[]) {
        const counts = await this.queueFor(name).getJobCounts('waiting', 'active', 'delayed', 'failed');
        queues[name] = {
          waiting: counts['waiting'] ?? 0,
          active: counts['active'] ?? 0,
          delayed: counts['delayed'] ?? 0,
          failed: counts['failed'] ?? 0,
        };
      }
    }
    return { mode: this.mode, redis: this.redis, paused: this.paused, byStatus, queues };
  }

  async recent(limit = 50, queue?: string) {
    return this.db.jobRecord.findMany({ where: queue ? { queue } : {}, orderBy: { updatedAt: 'desc' }, take: limit });
  }

  // ───────────────────────────── hand-off ─────────────────────────────

  private async handOff<N extends JobName>(
    jobId: string,
    name: N,
    payload: JobPayloads[N],
    delayMs: number,
  ): Promise<void> {
    if (this.mode === 'redis' && this.connection) {
      const opts = QUEUE_OPTIONS[name];
      const queue = this.queueFor(name);
      // BullMQ keeps finished jobs around; adding the same id again would silently return the old one.
      const stale = await queue.getJob(jobId);
      if (stale && ((await stale.isCompleted()) || (await stale.isFailed()))) await stale.remove();
      await queue.add(name, payload, {
        jobId,
        delay: delayMs,
        attempts: opts.attempts,
        backoff: { type: 'exponential', delay: opts.backoffMs },
        removeOnComplete: 500,
        removeOnFail: 1_000,
      });
      await this.db.jobRecord.update({ where: { id: jobId }, data: { enqueuedAt: new Date() } });
      return;
    }
    await this.db.jobRecord.update({ where: { id: jobId }, data: { enqueuedAt: new Date() } });
    if (this.paused) return; // stays QUEUED in the ledger until resume
    await this.runInline(name, payload, jobId);
  }

  /**
   * One attempt, now. A failure parks the job as RETRYING with a due time and returns, so a
   * request that happened to trigger the job is never held hostage by back-off; the flush
   * loop runs the next attempt when it is due. Rate limits and open breakers park the job
   * without spending an attempt.
   */
  private async runInline<N extends JobName>(name: N, payload: JobPayloads[N], jobId: string): Promise<void> {
    const handler = this.handlers.get(name);
    if (!handler) throw new Error(`no handler registered for job ${name}`);
    const opts = QUEUE_OPTIONS[name];
    const record = await this.db.jobRecord.findUniqueOrThrow({ where: { id: jobId } });
    if (record.status === 'COMPLETED' || record.status === 'ACTIVE') return;
    const correlationId = record.correlationId ?? newCorrelationId();
    const attempt = record.attempts + 1;
    await this.db.jobRecord.update({
      where: { id: jobId },
      data: { status: 'ACTIVE', attempts: attempt, startedAt: new Date() },
    });
    this.bus.emit({ kind: 'job', jobId, queue: name, status: 'active', attempt });
    try {
      await withCorrelation({ correlationId, causationId: jobId }, () => handler(payload, { id: jobId, attempt }));
      await this.complete(jobId, name, attempt, record.deadLetteredAt !== null);
    } catch (error) {
      const err = error as Error;
      if (error instanceof RateLimitedError || error instanceof DependencyUnavailableError) {
        await this.db.jobRecord.update({
          where: { id: jobId },
          data: {
            status: 'RETRYING',
            attempts: attempt - 1,
            nextRunAt: new Date(Date.now() + error.retryAfterMs),
            lastError: err.message,
          },
        });
        this.bus.emit({ kind: 'job', jobId, queue: name, status: 'retrying', attempt, error: err.message });
        return;
      }
      if (error instanceof UnrecoverableJobError || attempt >= opts.attempts) {
        await this.deadLetter(jobId, name, payload, attempt, err.message);
        return;
      }
      const wait = Math.min(opts.backoffMs * 2 ** (attempt - 1), MAX_INLINE_WAIT_MS);
      await this.db.jobRecord.update({
        where: { id: jobId },
        data: { status: 'RETRYING', lastError: err.message.slice(0, 1000), nextRunAt: new Date(Date.now() + wait) },
      });
      this.bus.emit({ kind: 'job', jobId, queue: name, status: 'retrying', attempt, error: err.message });
    }
  }

  /** COMPLETED in the ledger; a job that had died announces its recovery so the exception it raised can close. */
  private async complete(jobId: string, name: JobName, attempt: number, wasDead: boolean): Promise<void> {
    await this.db.$transaction(async (tx) => {
      await tx.jobRecord.updateMany({
        where: { id: jobId },
        data: { status: 'COMPLETED', finishedAt: new Date(), lastError: null, deadLetteredAt: null },
      });
      if (wasDead)
        await appendDomainEvent(tx, {
          aggregateType: 'JobRecord',
          aggregateId: jobId,
          type: 'JobRecovered',
          payload: { queue: name, attempt },
          causationId: jobId,
        });
    });
    this.bus.emit({ kind: 'job', jobId, queue: name, status: 'completed', attempt });
    if (wasDead) this.afterDeadLetter?.();
  }

  /** DEAD in the ledger and a JobDeadLettered event in the outbox, in one transaction. */
  private async deadLetter(
    jobId: string,
    name: JobName,
    payload: Record<string, unknown>,
    attempts: number,
    error: string,
  ): Promise<void> {
    await this.db.$transaction(async (tx) => {
      await tx.jobRecord.update({
        where: { id: jobId },
        data: {
          status: 'DEAD',
          attempts,
          finishedAt: new Date(),
          deadLetteredAt: new Date(),
          lastError: error.slice(0, 1000),
        },
      });
      await appendDomainEvent(tx, {
        aggregateType: 'JobRecord',
        aggregateId: jobId,
        type: 'JobDeadLettered',
        payload: { queue: name, attempts, error: error.slice(0, 500), payload },
        causationId: jobId,
      });
    });
    this.logger.error(`job ${name}#${jobId} dead-lettered after ${attempts} attempt(s): ${error}`);
    this.bus.emit({ kind: 'job', jobId, queue: name, status: 'dead', attempt: attempts, error });
    this.afterDeadLetter?.();
  }

  private queueFor(name: JobName): Queue {
    let queue = this.queues.get(name);
    if (!queue) {
      queue = new Queue(name, { connection: this.connection! });
      this.queues.set(name, queue);
    }
    return queue;
  }

  private startWorkers(): void {
    for (const name of Object.keys(QUEUE_OPTIONS) as JobName[]) {
      const opts = QUEUE_OPTIONS[name];
      const worker = new Worker(
        name,
        async (job: Job) => {
          const handler = this.handlers.get(name);
          if (!handler) throw new UnrecoverableJobError(`no handler for ${name}`);
          const jobId = String(job.id);
          const attempt = job.attemptsMade + 1;
          const maxAttempts = job.opts.attempts ?? opts.attempts;
          const record = await this.db.jobRecord.findUnique({ where: { id: jobId } });
          const correlationId = record?.correlationId ?? newCorrelationId();
          await this.db.jobRecord.updateMany({
            where: { id: jobId },
            data: { status: 'ACTIVE', attempts: attempt, startedAt: new Date() },
          });
          this.bus.emit({ kind: 'job', jobId, queue: name, status: 'active', attempt });
          try {
            await withCorrelation({ correlationId, causationId: jobId }, () =>
              handler(job.data as JobPayloads[typeof name], { id: jobId, attempt }),
            );
          } catch (error) {
            // The ledger is written here, before BullMQ hears about the outcome, so the two never disagree for long.
            if (error instanceof RateLimitedError || error instanceof DependencyUnavailableError) {
              // Pause the whole queue for the window we were given, then retry this job without spending an attempt.
              await this.db.jobRecord.updateMany({
                where: { id: jobId },
                data: {
                  status: 'RETRYING',
                  attempts: attempt - 1,
                  nextRunAt: new Date(Date.now() + error.retryAfterMs),
                  lastError: error.message,
                },
              });
              this.bus.emit({ kind: 'job', jobId, queue: name, status: 'retrying', attempt, error: error.message });
              await worker.rateLimit(error.retryAfterMs);
              throw Worker.RateLimitError();
            }
            const message = (error as Error).message;
            if (error instanceof UnrecoverableJobError || attempt >= maxAttempts) {
              await this.deadLetter(jobId, name, job.data as Record<string, unknown>, attempt, message);
              const { UnrecoverableError } = await import('bullmq');
              throw new UnrecoverableError(message);
            }
            await this.db.jobRecord.updateMany({
              where: { id: jobId },
              data: {
                status: 'RETRYING',
                lastError: message.slice(0, 1000),
                nextRunAt: new Date(Date.now() + opts.backoffMs * 2 ** (attempt - 1)),
              },
            });
            this.bus.emit({ kind: 'job', jobId, queue: name, status: 'retrying', attempt, error: message });
            throw error;
          }
          await this.complete(jobId, name, attempt, record?.deadLetteredAt != null);
        },
        { connection: this.connection!, concurrency: opts.concurrency, limiter: opts.limiter },
      );
      worker.on('failed', (job, error) => {
        if (job && error.name !== 'RateLimitError')
          this.logger.warn(`${name}#${String(job.id)} failed (attempt ${job.attemptsMade}): ${error.message}`);
      });
      worker.on('error', (error) => this.logger.warn(`worker ${name}: ${error.message}`));
      this.workers.set(name, worker);
    }
  }
}
