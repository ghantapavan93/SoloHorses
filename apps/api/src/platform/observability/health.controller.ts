import { Controller, Get, HttpCode, Res } from '@nestjs/common';
import type { Response } from 'express';
import { execSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { Public } from '../security/jwt-auth.guard';
import { Requires } from '../security/permission.guard';
import { ClockService } from '../clock/clock.service';
import { PrismaService } from '../persistence/prisma.service';
import { EnvService } from '../config/env.module';
import { OutboxService } from '../events/outbox.service';
import { JobsService } from '../queue/jobs.service';
import { HealthRegistry, type DependencyRow } from './health.registry';

const ADVERSARIAL = new Set(['PERMISSION', 'INJECTION', 'VETERINARY_BOUNDARY', 'FINANCIAL_BOUNDARY']);

/**
 * What `pnpm verify:report` wrote last: the run on this machine first, else the copy committed
 * with the code (`docs/verify/last.json`), which names the commit it was of. Never invented.
 */
function lastVerifyReport(): Record<string, unknown> | null {
  for (const candidate of [
    resolve(process.cwd(), '.verify/last.json'),
    resolve(process.cwd(), '../../.verify/last.json'),
    resolve(process.cwd(), 'docs/verify/last.json'),
    resolve(process.cwd(), '../../docs/verify/last.json'),
  ]) {
    if (existsSync(candidate)) {
      try {
        return JSON.parse(readFileSync(candidate, 'utf8')) as Record<string, unknown>;
      } catch {
        return null;
      }
    }
  }
  return null;
}

/**
 * The commit this process is running, so the readout can say when the last verify run was of
 * a different one. `GIT_SHA` in a container that carries no repository; `git` on a checkout;
 * null when neither is known — the page then shows the report's commit alone.
 */
function runningCommit(): string | null {
  // The platforms say which commit they built; a container carries no repository to ask.
  const given = process.env.GIT_SHA ?? process.env.RENDER_GIT_COMMIT ?? process.env.VERCEL_GIT_COMMIT_SHA;
  if (given) return given.slice(0, 7);
  try {
    return (
      execSync('git rev-parse --short HEAD', { stdio: ['ignore', 'pipe', 'ignore'] })
        .toString()
        .trim() || null
    );
  } catch {
    return null;
  }
}

/** The first line of an error: enough to act on, never a connection string. */
const firstLine = (error: unknown): string => ((error as Error).message ?? String(error)).split('\n')[0] ?? '';

@Controller('health')
export class HealthController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly clock: ClockService,
    private readonly envService: EnvService,
    private readonly jobs: JobsService,
    private readonly outbox: OutboxService,
    private readonly registry: HealthRegistry,
  ) {}

  /**
   * Liveness for a platform's probe: the process is up. No database round trip, so a probe every
   * few seconds does not keep a database that suspends when idle awake all month.
   */
  @Get('live')
  @Public()
  live() {
    return { ok: true, uptimeSec: Math.round(process.uptime()) };
  }

  /**
   * Readiness: can this instance serve operational traffic? Only what operational truth needs —
   * the database answering, the schema present, a seeded world — so a model that is away
   * never makes the estate "not ready" while the deterministic composer can answer. 503 when
   * not, so a platform or the web can read the status line alone.
   */
  @Get('ready')
  @Public()
  @HttpCode(200)
  async ready(@Res({ passthrough: true }) res: Response) {
    const started = Date.now();
    const checks: Record<string, { ok: boolean; note: string; latencyMs?: number }> = {};
    try {
      await this.prisma.client.$queryRaw`SELECT 1`;
      checks['database'] = { ok: true, note: 'answering', latencyMs: Date.now() - started };
    } catch (error) {
      checks['database'] = { ok: false, note: `not answering: ${firstLine(error)}` };
    }
    if (checks['database']?.ok) {
      try {
        // The schema is what the migrations made it; the seed stamp says a world is in it.
        const seed = (await this.prisma.client.setting.findUnique({ where: { key: 'seed' } }))?.value as
          { seededAt?: string } | null | undefined;
        checks['schema'] = { ok: true, note: 'migrated' };
        checks['world'] = seed?.seededAt
          ? { ok: true, note: `seeded ${seed.seededAt}` }
          : { ok: false, note: 'no seeded world yet' };
      } catch (error) {
        checks['schema'] = { ok: false, note: `not migrated: ${firstLine(error)}` };
      }
    }
    const ok = Object.values(checks).every((c) => c.ok);
    if (!ok) res.status(503);
    return { ok, checks, uptimeSec: Math.round(process.uptime()) };
  }

  /**
   * The dependency readout, for staff and the proof page: one row per thing the API leans on,
   * each from the service that owns it, at this moment. DEGRADED is a state, not a failure to
   * report; a green row is never written by hand.
   */
  @Get('dependencies')
  @Requires('read', 'platform')
  async dependencies() {
    const rows: DependencyRow[] = [{ name: 'API', state: 'HEALTHY', note: `up ${Math.round(process.uptime())} s` }];
    const dbStarted = Date.now();
    const dbOk = await this.prisma.client.$queryRaw`SELECT 1`.then(
      () => true,
      () => false,
    );
    const dbMs = Date.now() - dbStarted;
    rows.push(
      dbOk
        ? { name: 'Postgres', state: 'HEALTHY', note: `${dbMs} ms`, latencyMs: dbMs }
        : { name: 'Postgres', state: 'DOWN', note: 'not answering' },
    );
    const jobs = await this.jobs.health().catch(() => null);
    rows.push(
      jobs === null
        ? { name: 'Queue', state: 'DOWN', note: 'ledger not readable' }
        : jobs.redis === 'unreachable'
          ? { name: 'Queue', state: 'DEGRADED', note: 'Redis unreachable · jobs run inline from the ledger' }
          : jobs.redis === 'connected'
            ? { name: 'Queue', state: 'HEALTHY', note: 'BullMQ on Redis · the ledger first' }
            : { name: 'Queue', state: 'HEALTHY', note: 'none configured · inline from the ledger, one process' },
    );
    const worker = this.jobs.workerHealth();
    const flushAgo = worker.lastFlushAgeMs === null ? null : `${Math.round(worker.lastFlushAgeMs / 1000)} s ago`;
    const requeued =
      worker.interrupted > 0
        ? ` · ${worker.interrupted} interrupted job${worker.interrupted === 1 ? '' : 's'} requeued`
        : '';
    rows.push(
      jobs?.paused
        ? { name: 'Worker', state: 'DEGRADED', note: 'paused from the lab' }
        : flushAgo === null
          ? { name: 'Worker', state: 'DEGRADED', note: 'no flush yet' }
          : (worker.lastFlushAgeMs ?? 0) > 30_000
            ? { name: 'Worker', state: 'DEGRADED', note: `last flush ${flushAgo}` }
            : {
                name: 'Worker',
                state: 'HEALTHY',
                note: `${jobs?.mode ?? 'inline'} · last flush ${flushAgo}${requeued}`,
              },
    );
    rows.push(...(await this.registry.rows()));
    const lag = dbOk ? await this.outbox.lag().catch(() => null) : null;
    rows.push(
      lag === null
        ? { name: 'Outbox lag', state: 'DOWN', note: 'not readable' }
        : lag.unpublished === 0
          ? { name: 'Outbox lag', state: 'HEALTHY', note: '0' }
          : (lag.oldestUnpublishedAgeMs ?? 0) > 30_000
            ? {
                name: 'Outbox lag',
                state: 'DEGRADED',
                note: `${lag.unpublished} unpublished · oldest ${Math.round((lag.oldestUnpublishedAgeMs ?? 0) / 1000)} s`,
              }
            : { name: 'Outbox lag', state: 'HEALTHY', note: `${lag.unpublished} in flight` },
    );
    const dead = dbOk
      ? await this.prisma.client.jobRecord.count({ where: { status: 'DEAD' } }).catch(() => null)
      : null;
    rows.push(
      dead === null
        ? { name: 'Dead letters', state: 'DOWN', note: 'not readable' }
        : dead === 0
          ? { name: 'Dead letters', state: 'HEALTHY', note: '0' }
          : { name: 'Dead letters', state: 'DEGRADED', note: `${dead} · each an open exception a person owns` },
    );
    rows.push({ name: 'Build', state: 'NONE', note: runningCommit() ?? 'unknown commit' });
    return { rows, at: new Date().toISOString() };
  }

  @Get()
  @Public()
  async health() {
    const started = Date.now();
    await this.prisma.client.$queryRaw`SELECT 1`;
    // Which world this is: the seed's own stamp, so a session from an earlier world can tell.
    const seed = (await this.prisma.client.setting.findUnique({ where: { key: 'seed' } }))?.value as
      { seededAt?: string } | null | undefined;
    return {
      ok: true,
      dbLatencyMs: Date.now() - started,
      today: this.clock.today(),
      demoClock: this.clock.isFrozen(),
      integrations: this.envService.integrations,
      syntheticData: true,
      seededAt: seed?.seededAt ?? null,
    };
  }

  /** The honesty page's readout: the last verify run, the last event, the last trace, the last Stripe delivery. */
  @Get('build')
  @Public()
  async build() {
    const db = this.prisma.client;
    const [lastEvent, lastAudit, lastStripe, lastEval] = await Promise.all([
      db.domainEvent.findFirst({
        orderBy: { occurredAt: 'desc' },
        select: { type: true, aggregateId: true, occurredAt: true, correlationId: true },
      }),
      db.auditEvent.findFirst({
        where: { correlationId: { not: null } },
        orderBy: { at: 'desc' },
        select: { action: true, entityId: true, at: true, correlationId: true },
      }),
      db.integrationEvent.findFirst({
        where: { provider: 'STRIPE' },
        orderBy: { receivedAt: 'desc' },
        select: { externalId: true, type: true, status: true, duplicateDeliveries: true, receivedAt: true },
      }),
      db.evalRun.findFirst({
        where: { finishedAt: { not: null } },
        orderBy: { startedAt: 'desc' },
        select: {
          id: true,
          passed: true,
          total: true,
          model: true,
          startedAt: true,
          results: { select: { passed: true, case: { select: { category: true } } } },
        },
      }),
    ]);
    // The red team's half of the last run: the categories that try to get past the authority model.
    const adversarialResults = (lastEval?.results ?? []).filter((r) => ADVERSARIAL.has(r.case.category));
    const adversarial = lastEval
      ? { passed: adversarialResults.filter((r) => r.passed).length, total: adversarialResults.length }
      : null;
    return {
      verify: lastVerifyReport(),
      head: runningCommit(),
      lastEvent: lastEvent
        ? {
            type: lastEvent.type,
            aggregateId: lastEvent.aggregateId,
            at: lastEvent.occurredAt.toISOString(),
            correlationId: lastEvent.correlationId,
          }
        : null,
      lastTrace: lastAudit
        ? {
            action: lastAudit.action,
            entityId: lastAudit.entityId,
            at: lastAudit.at.toISOString(),
            correlationId: lastAudit.correlationId,
          }
        : null,
      lastStripeEvent: lastStripe
        ? {
            eventId: lastStripe.externalId,
            type: lastStripe.type,
            status: lastStripe.status,
            deliveries: 1 + lastStripe.duplicateDeliveries,
            at: lastStripe.receivedAt.toISOString(),
          }
        : null,
      lastEval: lastEval
        ? {
            id: lastEval.id,
            passed: lastEval.passed,
            total: lastEval.total,
            model: lastEval.model,
            at: lastEval.startedAt.toISOString(),
            adversarial,
          }
        : null,
    };
  }
}
