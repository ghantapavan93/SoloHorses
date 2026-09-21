import {
  CanActivate,
  ExecutionContext,
  HttpException,
  HttpStatus,
  Injectable,
  SetMetadata,
  type OnModuleDestroy,
  type OnModuleInit,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Request, Response } from 'express';
import IORedis from 'ioredis';
import { EnvService } from '../config/env.module';
import { PlatformBus } from '../observability/platform-bus';
import type { RequestWithActor } from '../security/actor';

/**
 * Per-endpoint rate limits, because different endpoints carry different risk:
 *
 *   search            100 / min / user   cheap, frequent
 *   ask               20 / min / user    costs money per call
 *   payments          5 / min / user     consequential; a burst is a bug or an attack
 *   login             10 / min / email   credential guessing against one account (the web
 *                                        app calls this server-to-server, so its IP is shared)
 *   webhooks          not user-limited   signature-verified instead
 *
 * Counters live in Redis when it is reachable (one limit across every instance) and in
 * memory otherwise. Fixed windows — good enough here, and simple enough to reason about.
 */
export interface RateLimitRule {
  /** Requests allowed per window. */
  points: number;
  windowMs: number;
  scope: 'user' | 'ip' | 'email';
  /** A stable name for telemetry and the counter key. */
  name: string;
}

export const RATE_LIMIT_KEY = 'rateLimit';
export const RateLimit = (rule: RateLimitRule) => SetMetadata(RATE_LIMIT_KEY, rule);

interface Counter {
  hit(key: string, windowMs: number): Promise<{ count: number; resetAt: number }>;
}

class MemoryCounter implements Counter {
  private readonly windows = new Map<string, { count: number; resetAt: number }>();

  hit(key: string, windowMs: number): Promise<{ count: number; resetAt: number }> {
    return Promise.resolve(this.hitSync(key, windowMs));
  }

  private hitSync(key: string, windowMs: number): { count: number; resetAt: number } {
    const now = Date.now();
    const current = this.windows.get(key);
    if (!current || current.resetAt <= now) {
      const fresh = { count: 1, resetAt: now + windowMs };
      this.windows.set(key, fresh);
      if (this.windows.size > 10_000) for (const [k, v] of this.windows) if (v.resetAt <= now) this.windows.delete(k);
      return fresh;
    }
    current.count += 1;
    return current;
  }
}

class RedisCounter implements Counter {
  constructor(private readonly redis: IORedis) {}

  async hit(key: string, windowMs: number): Promise<{ count: number; resetAt: number }> {
    const count = await this.redis.incr(key);
    if (count === 1) await this.redis.pexpire(key, windowMs);
    const ttl = await this.redis.pttl(key);
    return { count, resetAt: Date.now() + Math.max(ttl, 0) };
  }
}

@Injectable()
export class RateLimiter implements OnModuleInit, OnModuleDestroy {
  private counter: Counter = new MemoryCounter();
  private redis: IORedis | null = null;
  store: 'redis' | 'memory' = 'memory';

  constructor(private readonly envService: EnvService) {}

  async onModuleInit(): Promise<void> {
    if (this.envService.env.NODE_ENV === 'test') return;
    const client = new IORedis(this.envService.env.REDIS_URL, {
      lazyConnect: true,
      maxRetriesPerRequest: 1,
      connectTimeout: 1_500,
      enableOfflineQueue: false,
    });
    client.on('error', () => undefined);
    try {
      await client.connect();
      this.redis = client;
      this.counter = new RedisCounter(client);
      this.store = 'redis';
    } catch {
      client.disconnect();
    }
  }

  onModuleDestroy(): void {
    this.redis?.disconnect();
  }

  async consume(
    rule: RateLimitRule,
    subject: string,
  ): Promise<{ allowed: boolean; remaining: number; resetAt: number }> {
    const window = Math.floor(Date.now() / rule.windowMs);
    const { count, resetAt } = await this.counter.hit(`rl:${rule.name}:${subject}:${window}`, rule.windowMs);
    return { allowed: count <= rule.points, remaining: Math.max(0, rule.points - count), resetAt };
  }
}

function emailOf(req: Request): string {
  const body = req.body as { email?: unknown } | undefined;
  return typeof body?.email === 'string' ? body.email.trim().toLowerCase() : (req.ip ?? 'unknown');
}

@Injectable()
export class RateLimitGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly limiter: RateLimiter,
    private readonly bus: PlatformBus,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const rule = this.reflector.getAllAndOverride<RateLimitRule | undefined>(RATE_LIMIT_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (!rule) return true;
    const req = context.switchToHttp().getRequest<Request & Partial<RequestWithActor>>();
    const res = context.switchToHttp().getResponse<Response>();
    const subject =
      rule.scope === 'user'
        ? (req.actor?.userId ?? req.ip ?? 'anonymous')
        : rule.scope === 'email'
          ? emailOf(req)
          : (req.ip ?? 'unknown');
    const result = await this.limiter.consume(rule, subject);
    res.setHeader('X-RateLimit-Limit', String(rule.points));
    res.setHeader('X-RateLimit-Remaining', String(result.remaining));
    res.setHeader('X-RateLimit-Reset', String(Math.ceil(result.resetAt / 1000)));
    this.bus.emit({
      kind: 'rate-limit',
      route: rule.name,
      scope: rule.scope,
      outcome: result.allowed ? 'allowed' : 'rejected',
    });
    if (!result.allowed) {
      res.setHeader('Retry-After', String(Math.max(1, Math.ceil((result.resetAt - Date.now()) / 1000))));
      throw new HttpException(
        {
          message: `Too many ${rule.name} requests; try again in a moment.`,
          correlationId: res.getHeader('x-correlation-id'),
        },
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }
    return true;
  }
}
