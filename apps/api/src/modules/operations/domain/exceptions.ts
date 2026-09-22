import type { ExceptionKind, ExceptionSeverity, ExceptionSource } from '@daysheet/db';

/**
 * An operational exception is the one shape for "a person needs to look at this", whatever
 * produced it: a dead job, a webhook that would not apply, books that disagree, an embryo
 * arriving with no recip set aside, a check nobody recorded. Today's board is a projection
 * of the ones still open.
 *
 * Rules:
 *   - deterministic code raises them; the assistant may explain them, never open or close one
 *   - `dedupeKey` names the condition, so a detector that runs every minute raises once
 *   - a condition that clears (the check gets recorded, the job recovers) resolves its own exception
 */
export interface ExceptionDefinition {
  label: string;
  severity: ExceptionSeverity;
  source: ExceptionSource;
  /** What a person can do about it, as the UI offers it. */
  actions: readonly ('retry' | 'inspect' | 'resolve' | 'ignore')[];
}

export const EXCEPTIONS: Record<ExceptionKind, ExceptionDefinition> = {
  JOB_DEAD_LETTERED: {
    label: 'Background job failed',
    severity: 'CRITICAL',
    source: 'QUEUE',
    actions: ['retry', 'inspect', 'resolve', 'ignore'],
  },
  DELIVERY_UNKNOWN: {
    label: 'A message may or may not have gone out',
    severity: 'WARN',
    source: 'QUEUE',
    actions: ['inspect', 'resolve', 'ignore'],
  },
  WEBHOOK_FAILED: {
    label: 'Payment event could not be applied',
    severity: 'CRITICAL',
    source: 'STRIPE',
    actions: ['retry', 'inspect', 'resolve', 'ignore'],
  },
  ACCOUNTING_SYNC_FAILED: {
    label: 'Books did not accept a document',
    severity: 'WARN',
    source: 'QBO',
    actions: ['retry', 'inspect', 'resolve', 'ignore'],
  },
  RECONCILIATION_MISMATCH: {
    label: 'Books disagree with the ledger',
    severity: 'WARN',
    source: 'RECONCILIATION',
    actions: ['inspect', 'resolve', 'ignore'],
  },
  INTEGRATION_DEGRADED: { label: 'A dependency is down', severity: 'WARN', source: 'QBO', actions: ['inspect'] },
  RECIPIENT_MISSING: {
    label: 'Embryo arriving with no recip set aside',
    severity: 'CRITICAL',
    source: 'REPRODUCTION',
    actions: ['inspect', 'resolve', 'ignore'],
  },
  RECIPIENT_CONFLICT: {
    label: 'Recip held for an embryo she cannot carry',
    severity: 'CRITICAL',
    source: 'REPRODUCTION',
    actions: ['inspect', 'resolve', 'ignore'],
  },
  CLEARANCE_MISSING: {
    label: 'Transfer blocked: no veterinary clearance on the recip',
    severity: 'CRITICAL',
    source: 'VETERINARY',
    actions: ['inspect', 'resolve', 'ignore'],
  },
  CHECK_OVERDUE: {
    label: 'Pregnancy check overdue',
    severity: 'WARN',
    source: 'VETERINARY',
    actions: ['inspect', 'resolve', 'ignore'],
  },
  SHIP_BLOCKED: {
    label: 'Semen order on hold for a collection day',
    severity: 'WARN',
    source: 'BILLING',
    actions: ['inspect', 'resolve', 'ignore'],
  },
  INTAKE_UNCONFIRMED: {
    label: 'Text parsed but never confirmed',
    severity: 'INFO',
    source: 'REPRODUCTION',
    actions: ['inspect', 'resolve', 'ignore'],
  },
  CONFLICTING_RECORD: {
    label: 'Two records disagree',
    severity: 'CRITICAL',
    source: 'VETERINARY',
    actions: ['inspect', 'resolve', 'ignore'],
  },
  // The sale's published conditions, and the lease's, as rules a person can see fire.
  PAPERS_HELD: {
    label: 'Registration papers held: funds not cleared',
    severity: 'WARN',
    source: 'BILLING',
    actions: ['inspect', 'resolve', 'ignore'],
  },
  SETTLEMENT_CONFLICT: {
    label: 'Ledger and payment provider disagree',
    severity: 'CRITICAL',
    source: 'STRIPE',
    actions: ['inspect', 'resolve', 'ignore'],
  },
  RETURN_ASSESSMENT_MISSING: {
    label: 'Recip returned: veterinary assessment missing',
    severity: 'WARN',
    source: 'VETERINARY',
    actions: ['inspect', 'resolve', 'ignore'],
  },
  DEPARTURE_UNCONFIRMED: {
    label: 'Recip leaving: not video-confirmed in foal',
    severity: 'CRITICAL',
    source: 'VETERINARY',
    actions: ['inspect', 'resolve', 'ignore'],
  },
  RETURN_FEE_DECISION: {
    label: 'Recipient purchase fee: a person decides',
    severity: 'WARN',
    source: 'BILLING',
    actions: ['inspect', 'resolve', 'ignore'],
  },
  PAPERS_RELEASED_FUNDS_RETURNED: {
    label: 'Papers released, then the bank returned the money',
    severity: 'CRITICAL',
    source: 'BILLING',
    actions: ['inspect', 'resolve'],
  },
};

export interface RaiseExceptionInput {
  kind: ExceptionKind;
  dedupeKey: string;
  title: string;
  detail?: Record<string, unknown>;
  entityType?: string | null;
  entityId?: string | null;
  severity?: ExceptionSeverity;
  source?: ExceptionSource;
  correlationId?: string | null;
}

function text(value: unknown, fallback: string): string {
  return typeof value === 'string' ? value : fallback;
}

/** Which kind a dead job of a given queue becomes: the queue says which system failed. */
export function kindForDeadQueue(queue: string): ExceptionKind {
  if (queue === 'qbo-sync') return 'ACCOUNTING_SYNC_FAILED';
  if (queue === 'stripe-event') return 'WEBHOOK_FAILED';
  return 'JOB_DEAD_LETTERED';
}

/** A one-line title for a dead job, in the operation's words rather than the queue's. */
export function titleForDeadJob(
  queue: string,
  payload: Record<string, unknown>,
  attempts: number,
  error: string,
): string {
  const after = `after ${attempts} attempt${attempts === 1 ? '' : 's'}`;
  switch (queue) {
    case 'qbo-sync':
      return `QuickBooks ${text(payload['entityType'], 'document').toLowerCase()} sync for ${text(payload['entityId'], '?')} failed ${after}: ${error}`;
    case 'stripe-event':
      return `A Stripe event could not be applied ${after}: ${error}`;
    case 'send-message':
      return `A text or email could not be sent ${after}: ${error}`;
    case 'domain-event':
      return `An event consumer kept failing ${after}: ${error}`;
    default:
      return `${queue} failed ${after}: ${error}`;
  }
}
