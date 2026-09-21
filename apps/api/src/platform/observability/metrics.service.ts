import { Injectable, type OnModuleInit } from '@nestjs/common';
import { PlatformBus } from './platform-bus';

/**
 * In-process counters and timings, derived from the platform bus and from HTTP hooks.
 * Enough for the Architecture page to show live numbers; a production deployment would
 * export the same names to Prometheus/OpenTelemetry. Reset on restart by design.
 */
export interface MetricsSnapshot {
  startedAt: string;
  uptimeSeconds: number;
  http: {
    requests: number;
    errors: number;
    byRoute: Record<string, { count: number; errors: number; p50Ms: number; maxMs: number }>;
  };
  jobs: Record<string, number>;
  events: Record<string, number>;
  breakers: Record<string, { state: string; failures: number; since: string }>;
  cache: { hits: number; misses: number; invalidations: number; hitRatio: number };
  rateLimit: { allowed: number; rejected: number };
  integrations: Record<string, { ok: number; fail: number; rateLimited: number }>;
  sse: { subscribers: number };
}

@Injectable()
export class MetricsService implements OnModuleInit {
  private readonly startedAt = new Date();
  private readonly counters = new Map<string, number>();
  private readonly routes = new Map<string, { count: number; errors: number; samples: number[] }>();
  private readonly breakers = new Map<string, { state: string; failures: number; since: string }>();

  constructor(private readonly bus: PlatformBus) {}

  onModuleInit(): void {
    this.bus.subscribe((signal) => {
      switch (signal.kind) {
        case 'job':
          this.inc(`jobs.${signal.status}`);
          break;
        case 'event':
          this.inc(`events.${signal.stage}`);
          break;
        case 'breaker':
          this.breakers.set(signal.dependency, { state: signal.state, failures: signal.failures, since: signal.at });
          break;
        case 'cache':
          this.inc(`cache.${signal.op}`);
          break;
        case 'rate-limit':
          this.inc(`rateLimit.${signal.outcome}`);
          break;
        case 'integration':
          this.inc(`integration.${signal.dependency}.${signal.outcome}`);
          break;
        default:
          break;
      }
    });
  }

  inc(name: string, by = 1): void {
    this.counters.set(name, (this.counters.get(name) ?? 0) + by);
  }

  observeRequest(route: string, statusCode: number, durationMs: number): void {
    this.inc('http.requests');
    if (statusCode >= 500) this.inc('http.errors');
    const bucket = this.routes.get(route) ?? { count: 0, errors: 0, samples: [] };
    bucket.count += 1;
    if (statusCode >= 500) bucket.errors += 1;
    bucket.samples.push(durationMs);
    if (bucket.samples.length > 200) bucket.samples.shift();
    this.routes.set(route, bucket);
  }

  snapshot(): MetricsSnapshot {
    const get = (name: string) => this.counters.get(name) ?? 0;
    const byRoute: MetricsSnapshot['http']['byRoute'] = {};
    for (const [route, bucket] of this.routes) {
      const sorted = [...bucket.samples].sort((a, b) => a - b);
      byRoute[route] = {
        count: bucket.count,
        errors: bucket.errors,
        p50Ms: sorted[Math.floor(sorted.length / 2)] ?? 0,
        maxMs: sorted[sorted.length - 1] ?? 0,
      };
    }
    const hits = get('cache.hit');
    const misses = get('cache.miss');
    const integrations: MetricsSnapshot['integrations'] = {};
    for (const [name, value] of this.counters) {
      const match = /^integration\.([^.]+)\.(ok|fail|rate-limited)$/.exec(name);
      if (!match) continue;
      const entry = (integrations[match[1]!] ??= { ok: 0, fail: 0, rateLimited: 0 });
      if (match[2] === 'ok') entry.ok = value;
      else if (match[2] === 'fail') entry.fail = value;
      else entry.rateLimited = value;
    }
    return {
      startedAt: this.startedAt.toISOString(),
      uptimeSeconds: Math.round((Date.now() - this.startedAt.getTime()) / 1000),
      http: { requests: get('http.requests'), errors: get('http.errors'), byRoute },
      jobs: pick(this.counters, 'jobs.'),
      events: pick(this.counters, 'events.'),
      breakers: Object.fromEntries(this.breakers),
      cache: {
        hits,
        misses,
        invalidations: get('cache.invalidate'),
        hitRatio: hits + misses === 0 ? 0 : Math.round((hits / (hits + misses)) * 100) / 100,
      },
      rateLimit: { allowed: get('rateLimit.allowed'), rejected: get('rateLimit.rejected') },
      integrations,
      sse: { subscribers: this.bus.listenerCount - 1 }, // minus this service's own subscription
    };
  }
}

function pick(counters: Map<string, number>, prefix: string): Record<string, number> {
  const out: Record<string, number> = {};
  for (const [name, value] of counters) if (name.startsWith(prefix)) out[name.slice(prefix.length)] = value;
  return out;
}
