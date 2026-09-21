import type { RuleResult } from './clearance';

/**
 * The ledger's word for a payment moves one way. A provider's events may arrive twice and out
 * of order; a person's command may be mistaken. Both are answered here, by the same table:
 *
 *   PENDING → PROCESSING → SUCCEEDED → (PARTIALLY_REFUNDED →) REFUNDED
 *   PENDING | PROCESSING → FAILED → (the same intent, retried) PROCESSING | SUCCEEDED
 *   SUCCEEDED → RETURNED   the bank pulled an ACH debit back after it looked settled
 *
 * "Initiated" is never "cleared"; "returned" is never "cleared" again. A returned debit is a
 * new payment if the buyer pays again, not a revival of this row.
 */
export type PaymentStatus =
  'PENDING' | 'PROCESSING' | 'SUCCEEDED' | 'FAILED' | 'REFUNDED' | 'PARTIALLY_REFUNDED' | 'RETURNED';

export const PAYMENT_TRANSITIONS: Record<PaymentStatus, readonly PaymentStatus[]> = {
  PENDING: ['PROCESSING', 'SUCCEEDED', 'FAILED'],
  PROCESSING: ['SUCCEEDED', 'FAILED'],
  SUCCEEDED: ['PARTIALLY_REFUNDED', 'REFUNDED', 'RETURNED'],
  PARTIALLY_REFUNDED: ['REFUNDED'],
  REFUNDED: [],
  FAILED: ['PROCESSING', 'SUCCEEDED'],
  RETURNED: [],
};

const WORD: Record<PaymentStatus, string> = {
  PENDING: 'pending',
  PROCESSING: 'processing (initiated, not cleared)',
  SUCCEEDED: 'cleared',
  FAILED: 'failed',
  REFUNDED: 'refunded',
  PARTIALLY_REFUNDED: 'partly refunded',
  RETURNED: 'returned by the bank',
};

/** May the ledger move this payment from `from` to `to`? The same status again is a no-op, not an error. */
export function paymentTransition(
  paymentId: string,
  from: PaymentStatus,
  to: PaymentStatus,
): RuleResult & { noop: boolean } {
  if (from === to) return { ok: true, evidenceIds: [paymentId], noop: true };
  if (PAYMENT_TRANSITIONS[from].includes(to)) return { ok: true, evidenceIds: [paymentId], noop: false };
  return {
    ok: false,
    code: 'INVALID_PAYMENT_TRANSITION',
    reason: `A payment that is ${WORD[from]} cannot become ${WORD[to]}${from === 'RETURNED' && to === 'SUCCEEDED' ? '; a returned ACH debit does not clear again — the buyer pays again, as a new payment' : ''}.`,
    evidenceIds: [paymentId],
    noop: false,
  };
}

/** Provider events arrive twice and out of order: a transition the table refuses is ignored, and the inbox keeps the word for the detector. */
export function providerEventApplies(paymentId: string, from: PaymentStatus, to: PaymentStatus): boolean {
  const verdict = paymentTransition(paymentId, from, to);
  return verdict.ok && !verdict.noop;
}
