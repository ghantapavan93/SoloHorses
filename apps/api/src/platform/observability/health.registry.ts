import { Injectable } from '@nestjs/common';

/**
 * What the dependency readout says about one thing the API leans on. Every row comes from the
 * service that owns the dependency, asked at the moment of the request — never a stored
 * "healthy". A service that cannot answer in time is reported as such, not as fine.
 */
export type DependencyState = 'HEALTHY' | 'DEGRADED' | 'DOWN' | 'NONE';

export interface DependencyRow {
  name: string;
  state: DependencyState;
  /** One line a person can act on: the mode, the latency, the reason. */
  note: string;
  latencyMs?: number | null;
}

type Probe = () => Promise<DependencyRow | DependencyRow[]>;

const PROBE_TIMEOUT_MS = 3_000;

/**
 * Services register what they know about their own dependency; the health controller asks
 * them all. The platform never imports a bounded context, so a context's dependency (the
 * model behind Ask, for one) reaches the readout this way, on the context's own terms.
 */
@Injectable()
export class HealthRegistry {
  private readonly probes = new Map<string, Probe>();

  register(key: string, probe: Probe): void {
    this.probes.set(key, probe);
  }

  async rows(): Promise<DependencyRow[]> {
    const results = await Promise.all(
      [...this.probes.entries()].map(async ([key, probe]) => {
        try {
          const rows = await withTimeout(probe(), PROBE_TIMEOUT_MS);
          return Array.isArray(rows) ? rows : [rows];
        } catch (error) {
          return [{ name: key, state: 'DOWN' as const, note: `did not answer: ${(error as Error).message}` }];
        }
      }),
    );
    return results.flat();
  }
}

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`no answer within ${ms} ms`)), ms);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error: unknown) => {
        clearTimeout(timer);
        reject(error instanceof Error ? error : new Error(String(error)));
      },
    );
  });
}
