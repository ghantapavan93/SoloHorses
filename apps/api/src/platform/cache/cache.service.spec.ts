/**
 * The cache's one contract: what comes back is JSON data, on a hit and on a miss, in memory
 * and in Redis. A `Date` that survives only until the first cache hit is the bug this pins.
 */
import type { TestingModule } from '@nestjs/testing';
import { createTestModule } from '../../test-support/module';
import { CacheService } from './cache.service';

describe('CacheService', () => {
  let moduleRef: TestingModule;
  let cache: CacheService;

  beforeAll(async () => {
    moduleRef = await createTestModule({});
    cache = moduleRef.get(CacheService);
  });

  afterAll(async () => {
    await moduleRef.close();
  });

  it('returns the same JSON shape from a miss and from a hit', async () => {
    const key = `spec:cache:${Date.now()}`;
    const loaded = {
      id: 'X-1',
      performedOn: new Date('2026-04-20T15:00:00Z'),
      nested: [{ at: new Date('2026-04-01T00:00:00Z') }],
      note: undefined as string | undefined,
    };
    const miss = await cache.wrap(key, 5_000, () => Promise.resolve(loaded));
    const hit = await cache.wrap<typeof loaded>(key, 5_000, () => Promise.reject(new Error('must not load twice')));

    expect(miss.cached).toBe(false);
    expect(hit.cached).toBe(true);
    expect(miss.value).toEqual(hit.value);
    expect(miss.value.performedOn).toBe('2026-04-20T15:00:00.000Z');
    expect(hit.value.nested[0]?.at).toBe('2026-04-01T00:00:00.000Z');
    expect('note' in hit.value).toBe(false);
  });

  it('refuses an entry built from another version of the state', async () => {
    const key = `spec:cache:versioned:${Date.now()}`;
    await cache.wrap(key, 5_000, () => Promise.resolve({ n: 1 }), 'v1');
    const other = await cache.wrap(key, 5_000, () => Promise.resolve({ n: 2 }), 'v2');
    expect(other.cached).toBe(false);
    expect(other.value.n).toBe(2);
  });
});
