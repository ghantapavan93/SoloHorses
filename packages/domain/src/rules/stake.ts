import { FEES } from '../money';
import { leaseFeeFor } from './milestones';

/**
 * What an open exception holds up, in dollars, from the records as they stand now — never
 * from the payload the detector wrote. A founder reads the board in money: papers held on
 * $12,500, a $6,000 fee nobody can decide yet, a $2,398 payment the books refused. The
 * projection looks the ids up fresh and this function says which number is the one that
 * matters and what it is waiting on.
 */
export interface Stake {
  amountCents: number;
  /** What the money is waiting on, in the office's words. */
  label: string;
  /**
   * The one obligation this money is: an invoice (a payment is keyed by the invoice it pays),
   * a recipient's return, a milestone fee, a contract balance. Two exceptions about the same
   * dollars share a key, and the board adds each key once (`sumStakes`).
   */
  exposureKey: string;
}

export interface StakeLookups {
  invoiceAmountCents: (invoiceId: string) => number | null;
  paymentAmountCents: (paymentId: string) => number | null;
  /** The invoice a payment pays, so the payment and its invoice are one exposure, not two. */
  paymentInvoiceId: (paymentId: string) => string | null;
  /** The embryo behind a check, for the fee its next milestone would issue. */
  embryo: (embryoId: string) => {
    source: 'ICSI' | 'FLUSH' | 'SHIPPED_IN';
    wasFrozen: boolean;
    contractType: string | null;
    studFeeCents: number | null;
  } | null;
  /** The open balance on a contract, for an order held on it. */
  contractBalanceCents: (contractId: string) => number | null;
}

/** The exception kinds that hold money up. Any other kind has no stake. */
export type StakeKind =
  | 'PAPERS_HELD'
  | 'SETTLEMENT_CONFLICT'
  | 'PAPERS_RELEASED_FUNDS_RETURNED'
  | 'RETURN_ASSESSMENT_MISSING'
  | 'RETURN_FEE_DECISION'
  | 'ACCOUNTING_SYNC_FAILED'
  | 'RECONCILIATION_MISMATCH'
  | 'WEBHOOK_FAILED'
  | 'CHECK_OVERDUE'
  | 'SHIP_BLOCKED';

export function stakeFor(
  kind: StakeKind | (string & {}),
  detail: Record<string, unknown> | null,
  entityId: string | null,
  lookups: StakeLookups,
): Stake | null {
  const str = (key: string): string | null => (typeof detail?.[key] === 'string' ? detail[key] : null);
  const num = (key: string): number | null => (typeof detail?.[key] === 'number' ? detail[key] : null);
  const money = (id: string | null): number | null =>
    id?.startsWith('INV-')
      ? lookups.invoiceAmountCents(id)
      : id?.startsWith('PAY-')
        ? lookups.paymentAmountCents(id)
        : null;
  // The invoice is the obligation; a payment's exposure is the invoice it pays.
  const invoiceExposure = (id: string | null): string =>
    `invoice:${id?.startsWith('PAY-') ? (lookups.paymentInvoiceId(id) ?? id) : (id ?? 'unknown')}`;
  const with_ = (amountCents: number | null, label: string, exposureKey: string): Stake | null =>
    amountCents !== null && amountCents > 0 ? { amountCents, label, exposureKey } : null;

  switch (kind as StakeKind) {
    case 'PAPERS_HELD':
      return with_(money(str('invoiceId')), 'settlement, waiting to clear', invoiceExposure(str('invoiceId')));
    case 'SETTLEMENT_CONFLICT':
      return with_(money(str('invoiceId')), 'settlement the sources disagree about', invoiceExposure(str('invoiceId')));
    case 'PAPERS_RELEASED_FUNDS_RETURNED':
      return with_(
        money(str('invoiceId')),
        'returned by the bank after the papers went out',
        invoiceExposure(str('invoiceId')),
      );
    case 'RETURN_ASSESSMENT_MISSING':
      return with_(
        FEES.recipLateReturn,
        'recipient purchase fee, waiting on the vet',
        `recip-return:${str('recipId') ?? entityId ?? 'unknown'}`,
      );
    case 'RETURN_FEE_DECISION':
      return with_(
        FEES.recipLateReturn,
        'recipient purchase fee, a person decides',
        `recip-return:${str('recipId') ?? entityId ?? 'unknown'}`,
      );
    case 'ACCOUNTING_SYNC_FAILED':
      return with_(money(entityId), 'not in the books', invoiceExposure(entityId));
    case 'RECONCILIATION_MISMATCH': {
      const local = detail?.['localValue'] as Record<string, unknown> | undefined;
      const fromRow = typeof local?.['amountCents'] === 'number' ? local['amountCents'] : null;
      return with_(fromRow ?? money(entityId), 'the books disagree', invoiceExposure(entityId));
    }
    case 'WEBHOOK_FAILED':
      return with_(money(entityId), 'paid, not applied', invoiceExposure(entityId));
    case 'CHECK_OVERDUE': {
      // The check gates a fee only at the milestones that issue one: the day-24 heartbeat (the
      // lease fee) and, for a fresh ICSI pregnancy, the day-45 confirmation (the stallion fee).
      const embryo = entityId ? lookups.embryo(entityId) : null;
      const milestone = num('milestone');
      if (!embryo || milestone === null) return null;
      if (milestone === 24)
        return with_(
          leaseFeeFor({ embryoSource: embryo.source, embryoWasFrozen: embryo.wasFrozen }),
          'lease fee, waiting on the check',
          `milestone:${entityId}:24`,
        );
      if (
        milestone >= 45 &&
        milestone <= 60 &&
        embryo.contractType === 'ICSI' &&
        embryo.source === 'ICSI' &&
        !embryo.wasFrozen
      )
        return with_(embryo.studFeeCents, 'stallion fee, waiting on the check', `milestone:${entityId}:45`);
      return null;
    }
    case 'SHIP_BLOCKED':
      return with_(
        lookups.contractBalanceCents(str('contractId') ?? ''),
        'balance that holds the order',
        `contract:${str('contractId') ?? 'unknown'}`,
      );
    default:
      return null;
  }
}

/**
 * The board's one number, each obligation once. Papers held on an invoice and the sources
 * disagreeing about the same invoice are one exposure, not two; where two rows price one
 * obligation differently the larger figure stands, because the smaller is never the whole of it.
 */
export function sumStakes(stakes: Iterable<Stake>): number {
  const byExposure = new Map<string, number>();
  for (const stake of stakes)
    byExposure.set(stake.exposureKey, Math.max(byExposure.get(stake.exposureKey) ?? 0, stake.amountCents));
  let total = 0;
  for (const amount of byExposure.values()) total += amount;
  return total;
}
