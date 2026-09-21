import { describe, expect, it } from 'vitest';
import { FEES } from '../money';
import { stakeFor, sumStakes, type StakeLookups } from './stake';

/** The number a founder reads on a signal comes from the records, never from the detector's payload. */
describe('stakeFor: what an open exception holds up, in dollars', () => {
  const lookups: StakeLookups = {
    invoiceAmountCents: (id) => (id === 'INV-26-0077' ? 1_250_000 : null),
    paymentAmountCents: (id) => (id === 'PAY-26-0063' ? 239_800 : id === 'PAY-26-0077' ? 1_250_000 : null),
    paymentInvoiceId: (id) => (id === 'PAY-26-0063' ? 'INV-26-0081' : id === 'PAY-26-0077' ? 'INV-26-0077' : null),
    embryo: (id) =>
      id === 'E-26-0009'
        ? { source: 'FLUSH', wasFrozen: false, contractType: 'FRESH_COOLED', studFeeCents: 350_000 }
        : id === 'E-26-0100'
          ? { source: 'ICSI', wasFrozen: false, contractType: 'ICSI', studFeeCents: 600_000 }
          : null,
    contractBalanceCents: (id) => (id === 'K-26-0012' ? 450_000 : null),
  };

  it('reads the settlement amount from the invoice, whatever the detector wrote', () => {
    expect(stakeFor('PAPERS_HELD', { invoiceId: 'INV-26-0077', amountCents: 1 }, 'DOC-26-0001', lookups)).toEqual({
      amountCents: 1_250_000,
      label: 'settlement, waiting to clear',
      exposureKey: 'invoice:INV-26-0077',
    });
    expect(
      stakeFor('PAPERS_RELEASED_FUNDS_RETURNED', { invoiceId: 'INV-26-0077' }, 'DOC-26-0001', lookups)?.amountCents,
    ).toBe(1_250_000);
    expect(stakeFor('PAPERS_HELD', { invoiceId: 'INV-26-9999' }, 'DOC-26-0001', lookups)).toBeNull();
  });

  it('names the published recipient purchase fee for a returned mare', () => {
    expect(stakeFor('RETURN_ASSESSMENT_MISSING', {}, 'R-0052', lookups)).toEqual({
      amountCents: FEES.recipLateReturn,
      label: 'recipient purchase fee, waiting on the vet',
      exposureKey: 'recip-return:R-0052',
    });
    expect(stakeFor('RETURN_FEE_DECISION', {}, 'R-0052', lookups)?.amountCents).toBe(FEES.recipLateReturn);
  });

  it('follows the money the books refused or disagree about', () => {
    expect(stakeFor('ACCOUNTING_SYNC_FAILED', {}, 'PAY-26-0063', lookups)).toEqual({
      amountCents: 239_800,
      label: 'not in the books',
      exposureKey: 'invoice:INV-26-0081',
    });
    expect(
      stakeFor('RECONCILIATION_MISMATCH', { localValue: { amountCents: 100_000 } }, 'INV-26-0077', lookups)
        ?.amountCents,
    ).toBe(100_000);
    expect(
      stakeFor('RECONCILIATION_MISMATCH', { localValue: { invoiceId: null } }, 'PAY-26-0063', lookups)?.amountCents,
    ).toBe(239_800);
  });

  it('prices an overdue check only at the milestones that issue a fee', () => {
    expect(stakeFor('CHECK_OVERDUE', { milestone: 24 }, 'E-26-0009', lookups)).toEqual({
      amountCents: FEES.leaseFeeFlushOrThawed,
      label: 'lease fee, waiting on the check',
      exposureKey: 'milestone:E-26-0009:24',
    });
    expect(stakeFor('CHECK_OVERDUE', { milestone: 45 }, 'E-26-0009', lookups)).toBeNull();
    expect(stakeFor('CHECK_OVERDUE', { milestone: 45 }, 'E-26-0100', lookups)).toEqual({
      amountCents: 600_000,
      label: 'stallion fee, waiting on the check',
      exposureKey: 'milestone:E-26-0100:45',
    });
    expect(stakeFor('CHECK_OVERDUE', { milestone: 24 }, 'E-26-0100', lookups)?.amountCents).toBe(
      FEES.leaseFeeFreshIcsi,
    );
  });

  it('keys every stake by the obligation it is: a payment by the invoice it pays', () => {
    expect(stakeFor('PAPERS_HELD', { invoiceId: 'INV-26-0077' }, 'DOC-26-0001', lookups)?.exposureKey).toBe(
      'invoice:INV-26-0077',
    );
    expect(stakeFor('WEBHOOK_FAILED', {}, 'PAY-26-0077', lookups)?.exposureKey).toBe('invoice:INV-26-0077');
    expect(stakeFor('ACCOUNTING_SYNC_FAILED', {}, 'PAY-26-0063', lookups)?.exposureKey).toBe('invoice:INV-26-0081');
    expect(stakeFor('RETURN_ASSESSMENT_MISSING', { recipId: 'R-0052' }, 'R-0052', lookups)?.exposureKey).toBe(
      'recip-return:R-0052',
    );
    expect(stakeFor('CHECK_OVERDUE', { milestone: 24 }, 'E-26-0009', lookups)?.exposureKey).toBe(
      'milestone:E-26-0009:24',
    );
    expect(stakeFor('SHIP_BLOCKED', { contractId: 'K-26-0012' }, 'ORD-1', lookups)?.exposureKey).toBe(
      'contract:K-26-0012',
    );
  });

  it('adds the same dollars once: papers held on an invoice, the sources disagreeing about it and its payment not applied are one obligation', () => {
    const held = stakeFor('PAPERS_HELD', { invoiceId: 'INV-26-0077' }, 'DOC-26-0001', lookups);
    const conflict = stakeFor('SETTLEMENT_CONFLICT', { invoiceId: 'INV-26-0077' }, 'DOC-26-0001', lookups);
    const notApplied = stakeFor('WEBHOOK_FAILED', {}, 'PAY-26-0077', lookups);
    const returned = stakeFor('RETURN_ASSESSMENT_MISSING', { recipId: 'R-0052' }, 'R-0052', lookups);
    const all = [held, conflict, notApplied, returned].flatMap((s) => (s ? [s] : []));
    expect(all).toHaveLength(4);
    // Three rows, one invoice: $12,500 once, plus the $6,000 nobody can decide yet — not $43,500.
    expect(sumStakes(all)).toBe(1_250_000 + FEES.recipLateReturn);
    // Where two rows price one obligation differently, the larger figure stands.
    expect(
      sumStakes([
        { amountCents: 100, label: 'a', exposureKey: 'invoice:X' },
        { amountCents: 250, label: 'b', exposureKey: 'invoice:X' },
      ]),
    ).toBe(250);
    expect(sumStakes([])).toBe(0);
  });

  it('is silent where no dollar is at stake', () => {
    expect(stakeFor('DEPARTURE_UNCONFIRMED', {}, 'R-0037', lookups)).toBeNull();
    expect(stakeFor('RECIPIENT_CONFLICT', {}, 'E-26-0054', lookups)).toBeNull();
    expect(stakeFor('JOB_DEAD_LETTERED', {}, null, lookups)).toBeNull();
    expect(stakeFor('SHIP_BLOCKED', { contractId: 'K-26-0012' }, 'ORD-1', lookups)).toEqual({
      amountCents: 450_000,
      label: 'balance that holds the order',
      exposureKey: 'contract:K-26-0012',
    });
  });
});
