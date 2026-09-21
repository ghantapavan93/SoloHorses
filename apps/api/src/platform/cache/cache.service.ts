import { Injectable, type OnModuleDestroy, type OnModuleInit } from '@nestjs/common';
import IORedis from 'ioredis';
import { EnvService } from '../config/env.module';
import { PlatformBus } from '../observability/platform-bus';

/**
 * A read cache with two rules.
 *
 *   Domain invalidation is the rule: a mutation raises a domain event, and a consumer
 *   deletes the projections that event makes stale. That is what keeps a cached horse
 *   summary correct.
 *
 *   TTL is the safety net, never the business model. Nothing correctness-sensitive is
 *   cached at all: balances, ACH settlement state, reconciliation results, clearances.
 *
 * What is cached: slow-changing, read-heavy representations — a horse summary, the
 * stallion roster, the assistant's record projections (keyed by a hash of the record
 * state, so a stale entry is unreachable rather than merely short-lived).
 *
 * Redis when reachable, memory otherwise; the same key space either way — and the same
 * semantics: a value goes through JSON on the way in and comes back as JSON data, so a
 * `Date` is an ISO string on every read, cached or not. The memory backend round-trips
 * too, on purpose: a laptop run must behave like production or the tests prove nothing.
 */
export interface CacheEntry<T> {
  value: T;
  storedAt: string;
  expiresAt: string;
  version: string | null;
}

/** What a JSON round-trip leaves of T: Dates become ISO strings, `undefined` fields vanish. */
export type Jsonified<T> = T extends Date
  ? string
  : T extends (infer U)[]
    ? Jsonified<U>[]
    : T extends object
      ? { [K in keyof T]: Jsonified<T[K]> }
      : T;

function jsonify<T>(value: T): Jsonified<T> {
  return JSON.parse(JSON.stringify(value)) as Jsonified<T>;
}

@Injectable()
export class CacheService implements OnModuleInit, OnModuleDestroy {
  private redis: IORedis | null = null;
  private readonly memory = new Map<string, { raw: string; expiresAt: number }>();
  store: 'redis' | 'memory' = 'memory';

  constructor(
    private readonly envService: EnvService,
    private readonly bus: PlatformBus,
  ) {}

  async onModuleInit(): Promise<void> {
    if (this.envService.env.NODE_ENV === 'test') return;
    const client = new IORedis(this.envService.env.REDIS_URL, {
      lazyConnect: true,
      maxRetriesPerRequest: 1,
      connectTimeout: 1_500,
      enableOfflineQueue: false,
      keyPrefix: 'daysheet:cache:',
    });
    client.on('error', () => undefined);
    try {
      await client.connect();
      this.redis = client;
      this.store = 'redis';
    } catch {
      client.disconnect();
    }
  }

  onModuleDestroy(): void {
    this.redis?.disconnect();
  }

  async get<T>(key: string): Promise<CacheEntry<Jsonified<T>> | null> {
    const entry = await this.read<T>(key);
    this.bus.emit({ kind: 'cache', key, op: entry ? 'hit' : 'miss' });
    return entry;
  }

  async set<T>(key: string, value: T, ttlMs: number, version: string | null = null): Promise<CacheEntry<Jsonified<T>>> {
    const now = Date.now();
    const entry: CacheEntry<Jsonified<T>> = {
      value: jsonify(value),
      storedAt: new Date(now).toISOString(),
      expiresAt: new Date(now + ttlMs).toISOString(),
      version,
    };
    const raw = JSON.stringify(entry);
    if (this.redis) await this.redis.set(key, raw, 'PX', ttlMs);
    else this.memory.set(key, { raw, expiresAt: now + ttlMs });
    this.bus.emit({ kind: 'cache', key, op: 'set' });
    return entry;
  }

  /**
   * Read-through: the common shape. `version` lets a caller refuse an entry built from older
   * state. A miss returns the same JSON shape a hit would, so callers cannot come to depend
   * on a `Date` that only exists the first time.
   */
  async wrap<T>(
    key: string,
    ttlMs: number,
    load: () => Promise<T>,
    version: string | null = null,
  ): Promise<{ value: Jsonified<T>; cached: boolean; entry: CacheEntry<Jsonified<T>> }> {
    const hit = await this.get<T>(key);
    if (hit && (version === null || hit.version === version)) return { value: hit.value, cached: true, entry: hit };
    const value = await load();
    const entry = await this.set(key, value, ttlMs, version);
    return { value: entry.value, cached: false, entry };
  }

  async invalidate(...keys: string[]): Promise<number> {
    let removed = 0;
    for (const key of keys) {
      if (this.redis) removed += await this.redis.del(key);
      else removed += this.memory.delete(key) ? 1 : 0;
      this.bus.emit({ kind: 'cache', key, op: 'invalidate' });
    }
    return removed;
  }

  async invalidatePrefix(prefix: string): Promise<number> {
    if (this.redis) {
      const keys: string[] = [];
      let cursor = '0';
      do {
        const [next, batch] = await this.redis.scan(cursor, 'MATCH', `daysheet:cache:${prefix}*`, 'COUNT', 200);
        cursor = next;
        keys.push(...batch.map((k) => k.replace(/^daysheet:cache:/, '')));
      } while (cursor !== '0');
      return keys.length > 0 ? this.invalidate(...keys) : 0;
    }
    const keys = [...this.memory.keys()].filter((k) => k.startsWith(prefix));
    return this.invalidate(...keys);
  }

  /** The lab's "stale cached record": overwrite an entry with a wrong value on purpose. */
  async poison<T>(key: string, value: T, ttlMs: number): Promise<void> {
    await this.set(key, value, ttlMs, 'poisoned');
    this.bus.emit({ kind: 'cache', key, op: 'poison' });
  }

  async inspect(key: string): Promise<{ present: boolean; entry: CacheEntry<unknown> | null; ttlMs: number | null }> {
    const entry = await this.read<unknown>(key);
    if (!entry) return { present: false, entry: null, ttlMs: null };
    const ttlMs = this.redis
      ? await this.redis.pttl(key)
      : Math.max(0, (this.memory.get(key)?.expiresAt ?? 0) - Date.now());
    return { present: true, entry, ttlMs };
  }

  private async read<T>(key: string): Promise<CacheEntry<Jsonified<T>> | null> {
    if (this.redis) {
      const raw = await this.redis.get(key);
      return raw ? (JSON.parse(raw) as CacheEntry<Jsonified<T>>) : null;
    }
    const hit = this.memory.get(key);
    if (!hit) return null;
    if (hit.expiresAt <= Date.now()) {
      this.memory.delete(key);
      return null;
    }
    return JSON.parse(hit.raw) as CacheEntry<Jsonified<T>>;
  }
}
