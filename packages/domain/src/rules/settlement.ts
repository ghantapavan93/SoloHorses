import { type BarnDate } from '../time';
import type { RuleResult } from './clearance';

/**
 * Sale settlement and paper release, from the sale's published conditions:
 *
 *   FACT  Settlement is due by Monday, 5 PM CST, after the sale closes.
 *   FACT  Registration certificates are held until payment clears, then sent to the breed
 *         association; papers are never released on sale day.
 *
 * The rule is small and it is the whole point: an ACH debit that has been *initiated* is not
 * cleared funds. Eligibility is decided here, deterministically, from the ledger; releasing
 * the document is a person's click, never this function's.
 */
export const REGISTRATION_RELEASE_POLICY = 'RegistrationReleasePolicy v1';

export interface SettlementPayment {
  id: string;
  status: 'PENDING' | 'PROCESSING' | 'SUCCEEDED' | 'FAILED' | 'REFUNDED' | 'PARTIALLY_REFUNDED' | 'RETURNED';
  method: 'CARD' | 'ACH' | 'CHECK' | 'CASH';
  amountCents: number;
}

export interface SettlementInvoice {
  id: string;
  amountCents: number;
  status: 'DRAFT' | 'OPEN' | 'PAID' | 'VOID' | 'REFUNDED';
}

/** What the ledger can say about the money behind a lot. */
export type FundsState = 'CLEARED' | 'PROCESSING' | 'PARTIAL' | 'UNPAID' | 'FAILED' | 'RETURNED';

export function fundsState(invoice: SettlementInvoice, payments: SettlementPayment[]): FundsState {
  const cleared = payments
    .filter((p) => p.status === 'SUCCEEDED' || p.status === 'PARTIALLY_REFUNDED')
    .reduce((sum, p) => sum + p.amountCents, 0);
  if (cleared >= invoice.amountCents) return 'CLEARED';
  const inFlight = payments
    .filter((p) => p.status === 'PROCESSING' || p.status === 'PENDING')
    .reduce((sum, p) => sum + p.amountCents, 0);
  if (cleared + inFlight >= invoice.amountCents) return 'PROCESSING';
  if (cleared > 0) return 'PARTIAL';
  // The bank pulled the money back after it looked settled: not failed, not unpaid — returned, and a person's problem.
  if (payments.some((p) => p.status === 'RETURNED') && inFlight === 0) return 'RETURNED';
  if (payments.some((p) => p.status === 'FAILED') && cleared === 0 && inFlight === 0) return 'FAILED';
  return 'UNPAID';
}

/**
 * May the registration certificate be released? Only when funds have cleared. Every other
 * state names why not, in the words a person would use at the sale office.
 */
export function evaluateRegistrationRelease(
  lot: { id: string; documentId: string },
  invoice: SettlementInvoice,
  payments: SettlementPayment[],
): RuleResult {
  const evidence = [lot.id, lot.documentId, invoice.id, ...payments.map((p) => p.id)];
  const state = fundsState(invoice, payments);
  switch (state) {
    case 'CLEARED':
      return { ok: true, evidenceIds: evidence };
    case 'PROCESSING': {
      const ach = payments.find((p) => p.method === 'ACH' && (p.status === 'PROCESSING' || p.status === 'PENDING'));
      return {
        ok: false,
        code: 'SETTLEMENT_PROCESSING',
        reason: ach
          ? `an ACH debit for ${invoice.id} has been initiated but has not settled; initiated is not cleared`
          : `a payment for ${invoice.id} is still pending`,
        evidenceIds: evidence,
      };
    }
    case 'PARTIAL':
      return {
        ok: false,
        code: 'SETTLEMENT_PARTIAL',
        reason: `${invoice.id} is only partly paid`,
        evidenceIds: evidence,
      };
    case 'FAILED':
      return {
        ok: false,
        code: 'SETTLEMENT_FAILED',
        reason: `the payment for ${invoice.id} failed and no other payment is in flight`,
        evidenceIds: evidence,
      };
    case 'RETURNED':
      return {
        ok: false,
        code: 'SETTLEMENT_RETURNED',
        reason: `the bank returned the debit for ${invoice.id} after it looked settled; the funds are not cleared, and a person decides what happens to the papers`,
        evidenceIds: evidence,
      };
    default:
      return {
        ok: false,
        code: 'SETTLEMENT_UNPAID',
        reason: `no payment has been made against ${invoice.id}`,
        evidenceIds: evidence,
      };
  }
}

/**
 * Two sources with an opinion on the same money: the ledger's row and the payment provider's
 * last word. They may disagree — a late delivery, an out-of-order event, a hand edit. The
 * rule does not pick a winner; it says they disagree, and a person with billing rights does.
 */
export function settlementSourcesAgree(
  ledger: SettlementPayment['status'],
  providerLatest: 'processing' | 'succeeded' | 'failed' | 'canceled' | null,
): RuleResult {
  if (providerLatest === null) return { ok: true, evidenceIds: [] };
  // What the ledger may say when the provider's latest word is each of these. A ledger that
  // says cleared while the provider's last word is "processing" is the case that matters.
  const expected: Record<typeof providerLatest, SettlementPayment['status'][]> = {
    processing: ['PROCESSING', 'PENDING'],
    succeeded: ['SUCCEEDED', 'PARTIALLY_REFUNDED', 'REFUNDED', 'RETURNED'], // a return is the bank's word after the provider's; not a disagreement
    failed: ['FAILED', 'RETURNED'],
    canceled: ['FAILED'],
  };
  const conflict = !expected[providerLatest].includes(ledger);
  return conflict
    ? {
        ok: false,
        code: 'SETTLEMENT_CONFLICT',
        reason: `the ledger says ${ledger.toLowerCase()} and the provider's latest event says ${providerLatest}; they do not agree`,
        evidenceIds: [],
      }
    : { ok: true, evidenceIds: [] };
}

/** Settlement is due the Monday after the sale closes, 5 PM CST (published). Barn dates are calendar days. */
export function settlementDueOn(closedOn: BarnDate): BarnDate {
  const d = new Date(`${closedOn}T12:00:00Z`);
  const day = d.getUTCDay(); // 0 Sunday … 6 Saturday
  const daysToMonday = day === 1 ? 7 : (8 - day) % 7 || 7;
  d.setUTCDate(d.getUTCDate() + daysToMonday);
  return d.toISOString().slice(0, 10);
}

export const SETTLEMENT_DUE_TIME = '5:00 PM CST';
