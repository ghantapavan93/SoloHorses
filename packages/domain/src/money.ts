/**
 * Money is integer cents everywhere. Floats never touch a dollar amount.
 */

export type Cents = number;

export function cents(dollars: number): Cents {
  if (!Number.isFinite(dollars)) throw new Error('amount must be finite');
  return Math.round(dollars * 100);
}

export function assertCents(value: unknown, label = 'amount'): asserts value is Cents {
  if (typeof value !== 'number' || !Number.isInteger(value)) {
    throw new Error(`${label} must be an integer number of cents`);
  }
}

const usd = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' });

export function formatUsd(amount: Cents): string {
  assertCents(amount);
  return usd.format(amount / 100);
}

/** Card processors quote a percentage plus a fixed fee; both are passed through to the client. */
export function cardSurcharge(amount: Cents, percent = 3, fixedCents = 30): Cents {
  assertCents(amount);
  return Math.round((amount * percent) / 100) + fixedCents;
}

/**
 * Published fee schedule (see docs/ASSUMPTIONS.md for provenance).
 *
 *   FACT  A recipient lease starts with a $1,000 mare deposit at reservation; each transfer
 *         attempt carries a $1,000 implant fee, the first covered by the deposit. The lease
 *         fee ($5,000 flush/thawed, $6,500 fresh ICSI) and $22/day board follow the day-24
 *         positive heartbeat check.
 *   FACT  A recipient sold with a foal in utero that does not come back after weaning, open
 *         and in good health, carries a $6,000 recipient purchase fee (the sale's conditions).
 */
export const FEES = {
  recipDeposit: cents(1_000),
  recipImplantPerAttempt: cents(1_000),
  leaseFeeFlushOrThawed: cents(5_000),
  leaseFeeFreshIcsi: cents(6_500),
  boardPerDay: cents(22),
  recipLateReturn: cents(6_000),
  reAspirationChute: cents(2_000),
} as const;

/**
 * What a transfer attempt costs the client: the first implant of a lease is covered by the
 * deposit; every attempt after it is invoiced. `attempt` is 1-based.
 */
export function implantFeeFor(attempt: number): { amountCents: Cents; coveredByDeposit: boolean } {
  if (!Number.isInteger(attempt) || attempt < 1) throw new Error('attempt must be a positive integer');
  return attempt === 1
    ? { amountCents: 0, coveredByDeposit: true }
    : { amountCents: FEES.recipImplantPerAttempt, coveredByDeposit: false };
}
