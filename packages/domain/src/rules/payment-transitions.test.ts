import { describe, expect, it } from 'vitest';
import {
  PAYMENT_TRANSITIONS,
  paymentTransition,
  providerEventApplies,
  type PaymentStatus,
} from './payment-transitions';
import { evaluateRegistrationRelease, fundsState, settlementSourcesAgree } from './settlement';
import { screenMemory } from '../ask/memory';

describe('payment transitions: one way, and a person cannot be mistaken into clearing money', () => {
  it('initiated → processing → cleared; processing → failed', () => {
    expect(paymentTransition('p', 'PENDING', 'PROCESSING').ok).toBe(true);
    expect(paymentTransition('p', 'PROCESSING', 'SUCCEEDED').ok).toBe(true);
    expect(paymentTransition('p', 'PROCESSING', 'FAILED').ok).toBe(true);
  });

  // Mutation survivors: an edge of the published diagram could vanish from the table and a real
  // provider event would be refused — a card that clears at once, a refund, a retry after failure.
  it('every edge of the diagram is open', () => {
    const edges: [PaymentStatus, PaymentStatus][] = [
      ['PENDING', 'PROCESSING'],
      ['PENDING', 'SUCCEEDED'],
      ['PENDING', 'FAILED'],
      ['PROCESSING', 'SUCCEEDED'],
      ['PROCESSING', 'FAILED'],
      ['SUCCEEDED', 'PARTIALLY_REFUNDED'],
      ['SUCCEEDED', 'REFUNDED'],
      ['SUCCEEDED', 'RETURNED'],
      ['PARTIALLY_REFUNDED', 'REFUNDED'],
      ['FAILED', 'PROCESSING'],
      ['FAILED', 'SUCCEEDED'],
    ];
    for (const [from, to] of edges) expect(providerEventApplies('p', from, to), `${from} → ${to}`).toBe(true);
    expect(PAYMENT_TRANSITIONS.REFUNDED).toEqual([]);
    expect(PAYMENT_TRANSITIONS.RETURNED).toEqual([]);
  });

  it('cleared → returned, and never returned → cleared', () => {
    expect(paymentTransition('p', 'SUCCEEDED', 'RETURNED').ok).toBe(true);
    const back = paymentTransition('p', 'RETURNED', 'SUCCEEDED');
    expect(back.ok).toBe(false);
    if (!back.ok) {
      expect(back.code).toBe('INVALID_PAYMENT_TRANSITION');
      expect(back.reason).toMatch(/returned by the bank cannot become cleared/);
    }
    expect(paymentTransition('p', 'PROCESSING', 'RETURNED').ok).toBe(false);
  });

  it('a late or repeated provider event is ignored, not an error', () => {
    expect(providerEventApplies('p', 'SUCCEEDED', 'PROCESSING')).toBe(false);
    expect(providerEventApplies('p', 'SUCCEEDED', 'SUCCEEDED')).toBe(false);
    expect(providerEventApplies('p', 'FAILED', 'SUCCEEDED')).toBe(true); // the same intent, retried
  });

  // Mutation survivors: the no-op branch removed turned a repeated command into a 409; the
  // partial-refund row lost its way to a full refund.
  it('the same status again is a no-op a person is not scolded for; a partial refund can still complete', () => {
    expect(paymentTransition('p', 'SUCCEEDED', 'SUCCEEDED')).toEqual({ ok: true, evidenceIds: ['p'], noop: true });
    expect(paymentTransition('p', 'PARTIALLY_REFUNDED', 'REFUNDED')).toEqual({
      ok: true,
      evidenceIds: ['p'],
      noop: false,
    });
    expect(paymentTransition('p', 'REFUNDED', 'PARTIALLY_REFUNDED').ok).toBe(false);
  });

  it('a returned debit is not cleared funds: the papers go back to held, with the bank named', () => {
    const invoice = { id: 'INV-26-0100', amountCents: 1_250_000, status: 'OPEN' as const };
    expect(fundsState(invoice, [{ id: 'p', status: 'RETURNED', method: 'ACH', amountCents: 1_250_000 }])).toBe(
      'RETURNED',
    );
    const r = evaluateRegistrationRelease({ id: 'LOT-26-0041', documentId: 'DOC-26-0001' }, invoice, [
      { id: 'p', status: 'RETURNED', method: 'ACH', amountCents: 1_250_000 },
    ]);
    expect(!r.ok && r.code).toBe('SETTLEMENT_RETURNED');
    // A return is the bank's word after the provider's "succeeded": the sources do not disagree.
    expect(settlementSourcesAgree('RETURNED', 'succeeded').ok).toBe(true);
  });
});

describe('memory: preferences, never facts or rules of thumb', () => {
  it('keeps a presentation preference', () => {
    expect(screenMemory('digest.format', 'One line per embryo, newest check first.')).toEqual({
      ok: true,
      category: 'digest',
    });
    expect(screenMemory('terminology.recip', 'Say "recip", not "recipient mare".')).toEqual({
      ok: true,
      category: 'terminology',
    });
  });

  it('refuses a record, an amount, or a learned policy', () => {
    expect(screenMemory('preference.mare', 'R-0036 is usually fine to transfer').ok).toBe(false);
    expect(screenMemory('workflow.fees', 'She generally approves the $6,000 fee').ok).toBe(false);
    expect(screenMemory('preference.papers', 'papers can be released once the buyer says the wire went out').ok).toBe(
      false,
    );
    expect(screenMemory('random', 'no category').ok).toBe(false);
  });
});
