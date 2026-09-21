import { AsyncLocalStorage } from 'node:async_hooks';
import { randomBytes } from 'node:crypto';

/**
 * One identifier follows a piece of work across the web request, the API, the outbox, the
 * queue, the accounting adapter and the audit trail. Anything that writes a row or a log
 * line reads it from here instead of threading a parameter through every call.
 *
 *   correlationId  the whole story ("this payment, from click to books")
 *   causationId    the immediate cause of the current step (a request id, an event id, a job id)
 */
export interface CorrelationContext {
  correlationId: string;
  causationId: string | null;
  requestId: string | null;
}

const storage = new AsyncLocalStorage<CorrelationContext>();

export function newCorrelationId(prefix = 'corr'): string {
  return `${prefix}_${randomBytes(6).toString('hex')}`;
}

/** Runs `fn` with the given context; nested calls inherit unless they override. */
export function withCorrelation<T>(context: Partial<CorrelationContext> & { correlationId: string }, fn: () => T): T {
  const parent = storage.getStore();
  return storage.run(
    {
      correlationId: context.correlationId,
      causationId: context.causationId ?? parent?.causationId ?? null,
      requestId: context.requestId ?? parent?.requestId ?? null,
    },
    fn,
  );
}

export function currentCorrelation(): CorrelationContext | undefined {
  return storage.getStore();
}

export function currentCorrelationId(): string | null {
  return storage.getStore()?.correlationId ?? null;
}

export function currentCausationId(): string | null {
  return storage.getStore()?.causationId ?? null;
}

/** Accepts a caller-supplied id only if it looks like one of ours; otherwise mints a fresh one. */
export function acceptCorrelationId(candidate: unknown): string {
  return typeof candidate === 'string' && /^[a-z]{2,8}_[a-z0-9]{6,32}$/i.test(candidate)
    ? candidate
    : newCorrelationId();
}
