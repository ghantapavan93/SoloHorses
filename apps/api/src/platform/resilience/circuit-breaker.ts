import { Injectable } from '@nestjs/common';
import { PlatformBus } from '../observability/platform-bus';

/**
 * A circuit breaker per external dependency.
 *
 *   CLOSED     calls flow; consecutive transient failures are counted
 *   OPEN       calls are refused immediately for the cooldown; callers park their work
 *   HALF_OPEN  one probe call is allowed; success closes, failure re-opens
 *
 * State is per process (each instance judges the dependency from what it sees, the way
 * resilience4j and Polly do). The point is that a dead accounting system degrades one
 * feature — accounting sync — instead of piling retries onto every request in the app.
 *
 * Only *transient* failures trip the breaker: a 429, a 5xx, a timeout. A validation error
 * means the dependency is healthy and disagrees with us; that is a discrepancy, not an outage.
 */
export type BreakerState = 'closed' | 'open' | 'half-open';

export interface BreakerOptions {
  failureThreshold: number;
  cooldownMs: number;
}

export class CircuitOpenError extends Error {
  constructor(
    readonly dependency: string,
    readonly retryAfterMs: number,
  ) {
    super(`${dependency}: circuit open; retry after ${retryAfterMs}ms`);
  }
}

interface BreakerRecord {
  state: BreakerState;
  consecutiveFailures: number;
  openedAt: number | null;
  lastError: string | null;
  lastChangeAt: number;
  options: BreakerOptions;
}

const DEFAULTS: BreakerOptions = { failureThreshold: 3, cooldownMs: 20_000 };

@Injectable()
export class CircuitBreakerRegistry {
  private readonly breakers = new Map<string, BreakerRecord>();

  constructor(private readonly bus: PlatformBus) {}

  configure(dependency: string, options: Partial<BreakerOptions>): void {
    const record = this.record(dependency);
    record.options = { ...record.options, ...options };
  }

  /**
   * Runs `fn` through the breaker. `isTransient` decides whether a thrown error counts
   * against the dependency (default: everything counts).
   */
  async execute<T>(
    dependency: string,
    fn: () => Promise<T>,
    isTransient: (error: unknown) => boolean = () => true,
  ): Promise<T> {
    const record = this.record(dependency);
    this.maybeHalfOpen(dependency, record);
    if (record.state === 'open') throw new CircuitOpenError(dependency, this.retryAfterMs(record));
    try {
      const result = await fn();
      this.onSuccess(dependency, record);
      return result;
    } catch (error) {
      if (isTransient(error)) this.onFailure(dependency, record, (error as Error).message);
      throw error;
    }
  }

  /** The lab's "restore" and a person's "reset": clears the count and closes the circuit. */
  reset(dependency: string): void {
    const record = this.record(dependency);
    record.state = 'closed';
    record.consecutiveFailures = 0;
    record.openedAt = null;
    record.lastError = null;
    record.lastChangeAt = Date.now();
    this.emit(dependency, record);
  }

  snapshot(): Record<
    string,
    {
      state: BreakerState;
      consecutiveFailures: number;
      lastError: string | null;
      retryAfterMs: number | null;
      since: string;
      options: BreakerOptions;
    }
  > {
    const out: ReturnType<CircuitBreakerRegistry['snapshot']> = {};
    for (const [dependency, record] of this.breakers) {
      this.maybeHalfOpen(dependency, record);
      out[dependency] = {
        state: record.state,
        consecutiveFailures: record.consecutiveFailures,
        lastError: record.lastError,
        retryAfterMs: record.state === 'open' ? this.retryAfterMs(record) : null,
        since: new Date(record.lastChangeAt).toISOString(),
        options: record.options,
      };
    }
    return out;
  }

  stateOf(dependency: string): BreakerState {
    const record = this.record(dependency);
    this.maybeHalfOpen(dependency, record);
    return record.state;
  }

  private record(dependency: string): BreakerRecord {
    let record = this.breakers.get(dependency);
    if (!record) {
      record = {
        state: 'closed',
        consecutiveFailures: 0,
        openedAt: null,
        lastError: null,
        lastChangeAt: Date.now(),
        options: { ...DEFAULTS },
      };
      this.breakers.set(dependency, record);
    }
    return record;
  }

  private maybeHalfOpen(dependency: string, record: BreakerRecord): void {
    if (
      record.state === 'open' &&
      record.openedAt !== null &&
      Date.now() - record.openedAt >= record.options.cooldownMs
    ) {
      record.state = 'half-open';
      record.lastChangeAt = Date.now();
      this.emit(dependency, record);
    }
  }

  private onSuccess(dependency: string, record: BreakerRecord): void {
    const wasClosed = record.state === 'closed' && record.consecutiveFailures === 0;
    record.state = 'closed';
    record.consecutiveFailures = 0;
    record.openedAt = null;
    record.lastError = null;
    if (!wasClosed) {
      record.lastChangeAt = Date.now();
      this.emit(dependency, record);
    }
  }

  private onFailure(dependency: string, record: BreakerRecord, message: string): void {
    record.consecutiveFailures += 1;
    record.lastError = message.slice(0, 300);
    if (record.state === 'half-open' || record.consecutiveFailures >= record.options.failureThreshold) {
      record.state = 'open';
      record.openedAt = Date.now();
      record.lastChangeAt = Date.now();
      this.emit(dependency, record);
    }
  }

  private retryAfterMs(record: BreakerRecord): number {
    return Math.max(250, record.options.cooldownMs - (Date.now() - (record.openedAt ?? Date.now())));
  }

  private emit(dependency: string, record: BreakerRecord): void {
    this.bus.emit({
      kind: 'breaker',
      dependency,
      state: record.state,
      failures: record.consecutiveFailures,
      cooldownMs: record.options.cooldownMs,
    });
  }
}
