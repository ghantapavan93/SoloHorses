import { EventEmitter } from 'node:events';
import { Injectable } from '@nestjs/common';
import { currentCorrelationId } from './correlation';

/**
 * The in-process feed of what the platform is doing right now: jobs moving, events being
 * published and consumed, breakers opening, caches invalidating, exceptions being raised.
 * It is observability, not truth — the tables are the truth — so nothing subscribes to it
 * for business behavior. The SSE stream and the metrics counters read from here.
 */
export type PlatformSignal =
  | {
      kind: 'job';
      jobId: string;
      queue: string;
      status: 'queued' | 'active' | 'retrying' | 'completed' | 'dead' | 'paused';
      attempt?: number;
      error?: string;
      runId?: string;
    }
  | {
      kind: 'event';
      eventId: string;
      type: string;
      aggregate: string;
      stage: 'appended' | 'published' | 'consumed' | 'skipped' | 'failed';
      consumer?: string;
      error?: string;
    }
  | {
      kind: 'breaker';
      dependency: string;
      state: 'closed' | 'open' | 'half-open';
      failures: number;
      cooldownMs?: number;
    }
  | { kind: 'cache'; key: string; op: 'hit' | 'miss' | 'set' | 'invalidate' | 'poison' }
  | {
      kind: 'exception';
      exceptionId: string;
      status: 'opened' | 'acknowledged' | 'resolved' | 'ignored' | 'reopened';
      title: string;
      kindName: string;
    }
  | {
      kind: 'integration';
      dependency: string;
      op: string;
      outcome: 'ok' | 'fail' | 'rate-limited';
      attempt?: number;
      httpStatus?: number;
      retryAfterMs?: number;
      jobId?: string;
    }
  | { kind: 'rate-limit'; route: string; scope: string; outcome: 'allowed' | 'rejected' }
  | { kind: 'lab'; runId: string; scenario: string; step: string; detail?: Record<string, unknown> };

export type PlatformSignalEnvelope = PlatformSignal & { at: string; correlationId: string | null; seq: number };

@Injectable()
export class PlatformBus {
  private readonly emitter = new EventEmitter();
  private seq = 0;
  private readonly recent: PlatformSignalEnvelope[] = [];

  constructor() {
    this.emitter.setMaxListeners(100);
  }

  emit(signal: PlatformSignal): void {
    const envelope: PlatformSignalEnvelope = {
      ...signal,
      at: new Date().toISOString(),
      correlationId: currentCorrelationId(),
      seq: (this.seq += 1),
    };
    this.recent.push(envelope);
    if (this.recent.length > 500) this.recent.shift();
    this.emitter.emit('signal', envelope);
  }

  subscribe(listener: (signal: PlatformSignalEnvelope) => void): () => void {
    this.emitter.on('signal', listener);
    return () => this.emitter.off('signal', listener);
  }

  /** The last N signals, for a page that opens after the interesting part happened. */
  history(limit = 200, filter?: (signal: PlatformSignalEnvelope) => boolean): PlatformSignalEnvelope[] {
    const rows = filter ? this.recent.filter(filter) : this.recent;
    return rows.slice(-limit);
  }

  get listenerCount(): number {
    return this.emitter.listenerCount('signal');
  }
}
