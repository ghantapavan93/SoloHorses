import { Injectable, Logger, type OnModuleDestroy, type OnModuleInit } from '@nestjs/common';
import IORedis from 'ioredis';
import { EnvService } from '../config/env.module';
import { PlatformBus } from '../observability/platform-bus';
import { PrismaService } from '../persistence/prisma.service';

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
 *
 * Every key carries the world's generation — the seed's own stamp. A reseed writes a new
 * stamp; the service notices within seconds and every entry from the previous world becomes
 * unreachable at once, without a restart and without a person remembering one. Found by
 * reseeding under a running API and reading a horse summary from the world before.
 */
const GENERATION_POLL_MS = 10_000;
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
  private readonly logger = new Logger(CacheService.name);
  private redis: IORedis | null = null;
  private readonly memory = new Map<string, { raw: string; expiresAt: number }>();
  store: 'redis' | 'memory' = 'memory';
  /** The seed stamp the keys are bound to; 'unseeded' until a world is read. */
  generation = 'unseeded';
  private generationTimer: NodeJS.Timeout | null = null;

  constructor(
    private readonly envService: EnvService,
    private readonly bus: PlatformBus,
    private readonly prisma: PrismaService,
  ) {}

  /** The key as stored: the world's generation first, so a reseed leaves nothing reachable. */
  private k(key: string): string {
    return `${this.generation}:${key}`;
  }

  /**
   * Reads the seed's stamp; a new one means a new world. Entries from the old world are not
   * deleted — their keys can no longer be formed — and memory is cleared outright.
   */
  async refreshGeneration(): Promise<{ changed: boolean; generation: string }> {
    let next = this.generation;
    try {
      const seed = (await this.prisma.client.setting.findUnique({ where: { key: 'seed' } }))?.value as
        { seededAt?: string } | null | undefined;
      next = seed?.seededAt ? `g${seed.seededAt.replace(/[^0-9]/g, '').slice(0, 14)}` : 'unseeded';
    } catch {
      return { changed: false, generation: this.generation }; // the database is away; the keys stay as they are
    }
    const changed = next !== this.generation;
    if (changed) {
      const previous = this.generation;
      this.generation = next;
      this.memory.clear();
      if (previous !== 'unseeded') {
        this.logger.warn(
          `the world was reseeded (${previous} → ${next}): every cached projection from before is unreachable`,
        );
        this.bus.emit({ kind: 'cache', key: `${previous}:*`, op: 'invalidate' });
      }
    }
    return { changed, generation: next };
  }

  async onModuleInit(): Promise<void> {
    await this.refreshGeneration();
    if (this.envService.env.NODE_ENV !== 'test') {
      this.generationTimer = setInterval(() => void this.refreshGeneration(), GENERATION_POLL_MS);
      this.generationTimer.unref();
    }
    if (this.envService.env.NODE_ENV === 'test' || !this.envService.env.REDIS_URL) return;
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
    if (this.generationTimer) clearInterval(this.generationTimer);
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
    if (this.redis) await this.redis.set(this.k(key), raw, 'PX', ttlMs);
    else this.memory.set(this.k(key), { raw, expiresAt: now + ttlMs });
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
      if (this.redis) removed += await this.redis.del(this.k(key));
      else removed += this.memory.delete(this.k(key)) ? 1 : 0;
      this.bus.emit({ kind: 'cache', key, op: 'invalidate' });
    }
    return removed;
  }

  async invalidatePrefix(prefix: string): Promise<number> {
    if (this.redis) {
      const keys: string[] = [];
      let cursor = '0';
      do {
        const [next, batch] = await this.redis.scan(cursor, 'MATCH', `daysheet:cache:${this.k(prefix)}*`, 'COUNT', 200);
        cursor = next;
        keys.push(...batch.map((k) => k.replace(`daysheet:cache:${this.generation}:`, '')));
      } while (cursor !== '0');
      return keys.length > 0 ? this.invalidate(...keys) : 0;
    }
    const stored = this.k(prefix);
    const keys = [...this.memory.keys()]
      .filter((k) => k.startsWith(stored))
      .map((k) => k.slice(this.generation.length + 1));
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
      ? await this.redis.pttl(this.k(key))
      : Math.max(0, (this.memory.get(this.k(key))?.expiresAt ?? 0) - Date.now());
    return { present: true, entry, ttlMs };
  }

  private async read<T>(key: string): Promise<CacheEntry<Jsonified<T>> | null> {
    if (this.redis) {
      const raw = await this.redis.get(this.k(key));
      return raw ? (JSON.parse(raw) as CacheEntry<Jsonified<T>>) : null;
    }
    const hit = this.memory.get(this.k(key));
    if (!hit) return null;
    if (hit.expiresAt <= Date.now()) {
      this.memory.delete(this.k(key));
      return null;
    }
    return JSON.parse(hit.raw) as CacheEntry<Jsonified<T>>;
  }
}
