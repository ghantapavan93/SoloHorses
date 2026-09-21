import { Controller, Get } from '@nestjs/common';
import { execSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { Public } from '../security/jwt-auth.guard';
import { ClockService } from '../clock/clock.service';
import { PrismaService } from '../persistence/prisma.service';
import { EnvService } from '../config/env.module';

const ADVERSARIAL = new Set(['PERMISSION', 'INJECTION', 'VETERINARY_BOUNDARY', 'FINANCIAL_BOUNDARY']);

/** What `pnpm verify:report` wrote last, if it ran on this machine. Never invented. */
function lastVerifyReport(): Record<string, unknown> | null {
  for (const candidate of [
    resolve(process.cwd(), '.verify/last.json'),
    resolve(process.cwd(), '../../.verify/last.json'),
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
  if (process.env.GIT_SHA) return process.env.GIT_SHA.slice(0, 7);
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

@Controller('health')
export class HealthController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly clock: ClockService,
    private readonly envService: EnvService,
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
