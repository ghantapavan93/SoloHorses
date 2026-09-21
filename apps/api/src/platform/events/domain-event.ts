import type { Prisma } from '@daysheet/db';
import { currentCausationId, currentCorrelationId } from '../observability/correlation';

/**
 * A domain event is a business fact, past tense, named in the operation's language:
 * PaymentSucceeded, CheckRecorded, EmbryoExpected. The producer writes it in the same
 * transaction as the change it describes and knows nothing about who listens.
 *
 * Consumers are named, idempotent and transactional (see EventDispatcher). A consumer
 * that must talk to the outside world enqueues a job instead of calling out in-transaction.
 */
export interface DomainEventInput<T = Record<string, unknown>> {
  aggregateType: string;
  aggregateId: string;
  type: string;
  payload: T;
  /** Defaults to the current request/job/event; pass explicitly when reacting to another event. */
  causationId?: string | null;
}

export interface DomainEventRecord<T = Record<string, unknown>> {
  id: string;
  aggregateType: string;
  aggregateId: string;
  type: string;
  payload: T;
  occurredAt: Date;
  correlationId: string | null;
  causationId: string | null;
}

export interface EventConsumer<T = Record<string, unknown>> {
  /** Stable and unique; it is half of the processed_events key, so renaming it replays history. */
  readonly name: string;
  readonly events: readonly string[];
  handle(event: DomainEventRecord<T>, tx: Prisma.TransactionClient): Promise<void>;
}

/**
 * Appends an event to the outbox inside the caller's transaction. Framework-free so the
 * queue can dead-letter through the same door without depending on the events module.
 */
export async function appendDomainEvent(
  tx: Prisma.TransactionClient,
  input: DomainEventInput,
): Promise<DomainEventRecord> {
  const row = await tx.domainEvent.create({
    data: {
      aggregateType: input.aggregateType,
      aggregateId: input.aggregateId,
      type: input.type,
      payload: input.payload as Prisma.InputJsonValue,
      correlationId: currentCorrelationId(),
      causationId: input.causationId === undefined ? currentCausationId() : input.causationId,
    },
  });
  return { ...row, payload: row.payload as Record<string, unknown> };
}
