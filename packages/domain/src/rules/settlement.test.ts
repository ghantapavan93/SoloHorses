import { describe, expect, it } from 'vitest';
import { evaluateDeparture, evaluateRecipReturn } from './recip-return';
import { evaluateRegistrationRelease, fundsState, settlementDueOn, settlementSourcesAgree } from './settlement';
import { implantFeeFor } from '../money';
import { parseIntakeMessage } from '../intake/parse';

const lot = { id: 'LOT-26-0041', documentId: 'DOC-26-0001' };
const invoice = { id: 'INV-26-0100', amountCents: 1_250_000, status: 'OPEN' as const };

describe('registration release (the sale: papers held until payment clears)', () => {
  it('an initiated ACH debit is not cleared funds: the papers stay held', () => {
    const r = evaluateRegistrationRelease(lot, invoice, [
      { id: 'PAY-26-0100', status: 'PROCESSING', method: 'ACH', amountCents: 1_250_000 },
    ]);
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.code).toBe('SETTLEMENT_PROCESSING');
      expect(r.reason).toMatch(/initiated is not cleared/);
      expect(r.evidenceIds).toEqual(
        expect.arrayContaining(['LOT-26-0041', 'DOC-26-0001', 'INV-26-0100', 'PAY-26-0100']),
      );
    }
  });

  it('cleared funds make the papers eligible — eligible, not released', () => {
    const r = evaluateRegistrationRelease(lot, invoice, [
      { id: 'PAY-26-0100', status: 'SUCCEEDED', method: 'ACH', amountCents: 1_250_000 },
    ]);
    expect(r.ok).toBe(true);
  });

  it('a card payment that succeeded at once is cleared', () => {
    expect(fundsState(invoice, [{ id: 'p', status: 'SUCCEEDED', method: 'CARD', amountCents: 1_250_000 }])).toBe(
      'CLEARED',
    );
  });

  it('names partial, failed and unpaid states in the sale office’s words', () => {
    expect(fundsState(invoice, [{ id: 'p', status: 'SUCCEEDED', method: 'CARD', amountCents: 250_000 }])).toBe(
      'PARTIAL',
    );
    expect(fundsState(invoice, [{ id: 'p', status: 'FAILED', method: 'ACH', amountCents: 1_250_000 }])).toBe('FAILED');
    expect(fundsState(invoice, [])).toBe('UNPAID');
    const failed = evaluateRegistrationRelease(lot, invoice, [
      { id: 'p', status: 'FAILED', method: 'ACH', amountCents: 1_250_000 },
    ]);
    expect(!failed.ok && failed.code).toBe('SETTLEMENT_FAILED');
    const partial = evaluateRegistrationRelease(lot, invoice, [
      { id: 'p', status: 'SUCCEEDED', method: 'CARD', amountCents: 250_000 },
    ]);
    expect(!partial.ok && partial.code).toBe('SETTLEMENT_PARTIAL');
  });

  it('settlement is due the Monday after the sale closes', () => {
    expect(settlementDueOn('2026-04-18')).toBe('2026-04-20'); // Saturday → Monday
    expect(settlementDueOn('2026-04-19')).toBe('2026-04-20'); // Sunday → Monday
    expect(settlementDueOn('2026-04-20')).toBe('2026-04-27'); // a Monday close → the next Monday
  });
});

describe('settlement sources', () => {
  it('a ledger that says cleared while the provider’s latest word is processing is a conflict, not a winner', () => {
    const r = settlementSourcesAgree('SUCCEEDED', 'processing');
    expect(r.ok).toBe(false);
    expect(!r.ok && r.code).toBe('SETTLEMENT_CONFLICT');
  });

  it('processing on both sides, or succeeded on both, agree', () => {
    expect(settlementSourcesAgree('PROCESSING', 'processing').ok).toBe(true);
    expect(settlementSourcesAgree('SUCCEEDED', 'succeeded').ok).toBe(true);
    expect(settlementSourcesAgree('SUCCEEDED', null).ok).toBe(true);
  });

  // Mutation survivors: with the failure rows emptied, every failed payment raised a conflict.
  it('a failure both sides name, a cancellation the ledger calls failed, a return after a success: no conflict', () => {
    expect(settlementSourcesAgree('FAILED', 'failed').ok).toBe(true);
    expect(settlementSourcesAgree('RETURNED', 'failed').ok).toBe(true);
    expect(settlementSourcesAgree('FAILED', 'canceled').ok).toBe(true);
    expect(settlementSourcesAgree('RETURNED', 'succeeded').ok).toBe(true);
    expect(settlementSourcesAgree('PENDING', 'processing').ok).toBe(true);
    expect(settlementSourcesAgree('REFUNDED', 'succeeded').ok).toBe(true);
    expect(settlementSourcesAgree('PARTIALLY_REFUNDED', 'succeeded').ok).toBe(true);
    expect(settlementSourcesAgree('SUCCEEDED', 'canceled').ok).toBe(false);
  });
});

describe('recipient return (the sale: back after weaning, open and in good health)', () => {
  const base = {
    recipId: 'R-0104',
    lotId: 'LOT-25-0017',
    weanedOn: '2026-03-30',
    returnedOn: '2026-04-18',
    assessment: null,
  };

  it('a returned mare with no veterinary assessment blocks the decision — it never decides the fee', () => {
    const r = evaluateRecipReturn(base, '2026-04-20');
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.code).toBe('RETURN_ASSESSMENT_MISSING');
      expect(r.reason).not.toMatch(/\$6,000/);
    }
  });

  it('an assessment that finds her open and in good health meets the condition', () => {
    const r = evaluateRecipReturn(
      {
        ...base,
        assessment: {
          id: 'CLR-26-0090',
          kind: 'RETURN_ASSESSMENT',
          result: 'CLEAR',
          performedOn: '2026-04-19',
          expiresOn: null,
        },
      },
      '2026-04-20',
    );
    expect(r.ok).toBe(true);
  });

  it('an assessment that does not find her open and healthy hands the $6,000 question to a person', () => {
    const r = evaluateRecipReturn(
      {
        ...base,
        assessment: {
          id: 'CLR-26-0090',
          kind: 'RETURN_ASSESSMENT',
          result: 'ABNORMAL',
          performedOn: '2026-04-19',
          expiresOn: null,
        },
      },
      '2026-04-20',
    );
    expect(!r.ok && r.code).toBe('RETURN_CONDITION_NOT_MET');
    expect(!r.ok && r.reason).toMatch(/a person decides/);
  });

  it('not weaned, or weaned and not yet due: nothing to decide; past December 1 unreturned: overdue', () => {
    expect(evaluateRecipReturn({ ...base, weanedOn: null, returnedOn: null }, '2026-04-20').ok).toBe(true);
    expect(evaluateRecipReturn({ ...base, returnedOn: null }, '2026-11-30').ok).toBe(true);
    expect(evaluateRecipReturn({ ...base, returnedOn: null }, '2026-12-01').ok).toBe(true); // by December 1: the day itself is still in time
    const late = evaluateRecipReturn({ ...base, returnedOn: null }, '2026-12-02');
    expect(!late.ok && late.code).toBe('RETURN_OVERDUE');
  });

  // Mutation survivor: with the pending branch gone, a result still out read as "open and in good health".
  it('a return assessment still pending decides nothing', () => {
    const pending = evaluateRecipReturn(
      {
        ...base,
        assessment: {
          id: 'CLR-26-0090',
          kind: 'RETURN_ASSESSMENT',
          result: 'PENDING',
          performedOn: '2026-04-18',
          expiresOn: null,
        },
      },
      '2026-04-20',
    );
    expect(!pending.ok && pending.code).toBe('RETURN_ASSESSMENT_PENDING');
    expect(pending.evidenceIds).toEqual(['R-0104', 'LOT-25-0017', 'CLR-26-0090']);
  });
});

describe('departure (leasing: video-confirmed in foal within three days)', () => {
  const clear = {
    id: 'CLR-26-0080',
    kind: 'VIDEO_IN_FOAL' as const,
    result: 'CLEAR' as const,
    performedOn: '2026-04-19',
    expiresOn: null,
  };

  it('leaving in two days with no video on record is blocked', () => {
    const r = evaluateDeparture({ id: 'R-0050', scheduledDepartureOn: '2026-04-22', clearances: [] }, '2026-04-20');
    expect(!r.ok && r.code).toBe('DEPARTURE_UNCONFIRMED');
  });

  it('a recent clear video lets her go; a stale one must be repeated', () => {
    expect(
      evaluateDeparture({ id: 'R-0050', scheduledDepartureOn: '2026-04-22', clearances: [clear] }, '2026-04-20').ok,
    ).toBe(true);
    const stale = evaluateDeparture(
      { id: 'R-0050', scheduledDepartureOn: '2026-04-22', clearances: [{ ...clear, performedOn: '2026-04-10' }] },
      '2026-04-20',
    );
    expect(!stale.ok && stale.code).toBe('DEPARTURE_CONFIRMATION_STALE');
  });

  // The same row-order defect the property suite found on transfer clearances, on the video check.
  it('a clear and a not-in-foal video on the same day: she does not leave, whichever order the rows arrive in', () => {
    const notInFoal = { ...clear, id: 'CLR-26-0081', result: 'ABNORMAL' as const };
    for (const clearances of [
      [clear, notInFoal],
      [notInFoal, clear],
    ]) {
      const r = evaluateDeparture({ id: 'R-0050', scheduledDepartureOn: '2026-04-22', clearances }, '2026-04-20');
      expect(!r.ok && r.code).toBe('DEPARTURE_NOT_IN_FOAL');
    }
  });

  // Mutation survivors: with the kind filter gone, a clear culture counted as the video; with the
  // window boundary moved, day three was skipped; with the early return gone, a mare with no
  // departure on the calendar threw.
  it('only a video confirms her; the window includes the third day; no departure, nothing to confirm', () => {
    const culture = { ...clear, id: 'CLR-26-0082', kind: 'UTERINE_CULTURE' as const };
    const onCulture = evaluateDeparture(
      { id: 'R-0050', scheduledDepartureOn: '2026-04-22', clearances: [culture] },
      '2026-04-20',
    );
    expect(!onCulture.ok && onCulture.code).toBe('DEPARTURE_UNCONFIRMED');
    const dayThree = evaluateDeparture(
      { id: 'R-0050', scheduledDepartureOn: '2026-04-23', clearances: [] },
      '2026-04-20',
    );
    expect(!dayThree.ok && dayThree.code).toBe('DEPARTURE_UNCONFIRMED');
    expect(evaluateDeparture({ id: 'R-0050', scheduledDepartureOn: null, clearances: [] }, '2026-04-20')).toEqual({
      ok: true,
      evidenceIds: ['R-0050'],
    });
  });

  it('a departure more than three days out is not yet the rule’s business', () => {
    expect(
      evaluateDeparture({ id: 'R-0050', scheduledDepartureOn: '2026-05-01', clearances: [] }, '2026-04-20').ok,
    ).toBe(true);
  });
});

describe('the implant fee', () => {
  it('the first attempt is covered by the deposit; every later one is invoiced', () => {
    expect(implantFeeFor(1)).toEqual({ amountCents: 0, coveredByDeposit: true });
    expect(implantFeeFor(2)).toEqual({ amountCents: 100_000, coveredByDeposit: false });
    expect(() => implantFeeFor(0)).toThrow();
  });
});

describe('the two intake texts', () => {
  it('an ovulation heads-up on a flush names the day the embryo is expected', () => {
    const p = parseIntakeMessage('Sunny Bar x Miss Tally ovulated 4/12, will flush and ship', { referenceYear: 2026 });
    expect(p.kind).toBe('FLUSH');
    expect(p.stage).toBe('SHIPMENT'); // "ship" is in the text: it announces a shipment
    const heads = parseIntakeMessage('Sunny Bar x Miss Tally ovulated 4/12', { referenceYear: 2026 });
    expect(heads.stage).toBe('OVULATION');
    expect(heads.expectedFlushOn).toBe('2026-04-20');
  });
});
