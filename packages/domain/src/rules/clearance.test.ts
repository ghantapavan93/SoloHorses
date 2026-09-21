import { describe, expect, it } from 'vitest';
import { evaluateTransferClearance, RuleResultSchema, type ClearanceRecord } from './clearance';
import { evaluatePlannedRecipient } from './recipient';

const today = '2026-04-20';
const exam = (over: Partial<ClearanceRecord> = {}): ClearanceRecord => ({
  id: 'CLR-26-0001',
  kind: 'PRE_TRANSFER_EXAM',
  result: 'CLEAR',
  performedOn: '2026-04-15',
  expiresOn: null,
  ...over,
});
const culture = (over: Partial<ClearanceRecord> = {}): ClearanceRecord => ({
  id: 'CLR-26-0002',
  kind: 'UTERINE_CULTURE',
  result: 'CLEAR',
  performedOn: '2026-04-01',
  expiresOn: null,
  ...over,
});

describe('evaluateTransferClearance', () => {
  it('clears a recip with a current exam and culture, citing both', () => {
    const result = evaluateTransferClearance({ id: 'R-0034', clearances: [exam(), culture()] }, today);
    expect(RuleResultSchema.parse(result)).toEqual({ ok: true, evidenceIds: ['R-0034', 'CLR-26-0001', 'CLR-26-0002'] });
  });

  it('blocks when nothing is on record, naming what is missing', () => {
    const result = evaluateTransferClearance({ id: 'R-0034', clearances: [] }, today);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.code).toBe('CLEARANCE_MISSING');
      expect(result.reason).toContain('pre-transfer exam');
      expect(result.reason).toContain('uterine culture');
    }
  });

  it('a pending result blocks until it is back; an abnormal one blocks harder', () => {
    const pending = evaluateTransferClearance(
      { id: 'R-0034', clearances: [exam({ result: 'PENDING' }), culture()] },
      today,
    );
    expect(!pending.ok && pending.code).toBe('CLEARANCE_PENDING');
    const abnormal = evaluateTransferClearance(
      { id: 'R-0034', clearances: [exam(), culture({ result: 'ABNORMAL' })] },
      today,
    );
    expect(!abnormal.ok && abnormal.code).toBe('CLEARANCE_ABNORMAL');
  });

  it('an exam older than its validity window must be repeated', () => {
    const stale = evaluateTransferClearance(
      { id: 'R-0034', clearances: [exam({ performedOn: '2026-03-20' }), culture()] },
      today,
    );
    expect(!stale.ok && stale.code).toBe('CLEARANCE_EXPIRED');
    const explicit = evaluateTransferClearance(
      { id: 'R-0034', clearances: [exam({ performedOn: '2026-03-20', expiresOn: '2026-04-30' }), culture()] },
      today,
    );
    expect(explicit.ok).toBe(true);
  });

  // Mutation survivors: an explicit expiry that always counted as current; the validity window
  // that ended a day early.
  it('an explicit expiry counts through its last day and not past it; the validity window includes its last day', () => {
    const expiredToday = evaluateTransferClearance(
      { id: 'R-0034', clearances: [exam({ performedOn: '2026-04-01', expiresOn: '2026-04-19' }), culture()] },
      today,
    );
    expect(!expiredToday.ok && expiredToday.code).toBe('CLEARANCE_EXPIRED');
    expect(
      evaluateTransferClearance(
        { id: 'R-0034', clearances: [exam({ performedOn: '2026-04-01', expiresOn: '2026-04-20' }), culture()] },
        today,
      ).ok,
    ).toBe(true);
    expect(
      evaluateTransferClearance({ id: 'R-0034', clearances: [exam({ performedOn: '2026-04-06' }), culture()] }, today)
        .ok,
    ).toBe(true); // exactly 14 days
    expect(
      evaluateTransferClearance({ id: 'R-0034', clearances: [exam({ performedOn: '2026-04-05' }), culture()] }, today)
        .ok,
    ).toBe(false);
  });

  it('uses the latest record of each kind', () => {
    const result = evaluateTransferClearance(
      {
        id: 'R-0034',
        clearances: [
          exam({ id: 'CLR-26-0009', result: 'ABNORMAL', performedOn: '2026-04-01' }),
          exam({ id: 'CLR-26-0010', performedOn: '2026-04-18' }),
          culture(),
        ],
      },
      today,
    );
    expect(result.ok).toBe(true);
    expect(result.evidenceIds).toContain('CLR-26-0010');
  });

  // Found by the property suite (invariants.property.test.ts, seed 20260919): two exams on one
  // day, one clear and one abnormal, gave a verdict that depended on which row came back first.
  it('a clear and an abnormal exam on the same day: the abnormal governs, whichever order the rows arrive in', () => {
    const clearExam = exam({ id: 'CLR-26-0011', performedOn: '2026-04-17' });
    const abnormalExam = exam({ id: 'CLR-26-0012', result: 'ABNORMAL', performedOn: '2026-04-17' });
    for (const clearances of [
      [clearExam, abnormalExam, culture()],
      [abnormalExam, clearExam, culture()],
    ]) {
      const result = evaluateTransferClearance({ id: 'R-0034', clearances }, today);
      expect(!result.ok && result.code).toBe('CLEARANCE_ABNORMAL');
      expect(result.evidenceIds).toContain('CLR-26-0012');
    }
  });
});

describe('evaluatePlannedRecipient', () => {
  it('accepts a set-up mare held for nobody else', () => {
    expect(
      evaluatePlannedRecipient({
        recip: { id: 'R-0040', recipStatus: 'SET_UP' },
        embryoId: 'E-26-0054',
        otherPlannedEmbryoIds: [],
        carryingEmbryoId: null,
      }),
    ).toEqual({ ok: true, evidenceIds: ['R-0040', 'E-26-0054'] });
  });

  it('refuses a mare that is carrying, and cites what she carries', () => {
    const result = evaluatePlannedRecipient({
      recip: { id: 'R-0034', recipStatus: 'CARRYING' },
      embryoId: 'E-26-0054',
      otherPlannedEmbryoIds: [],
      carryingEmbryoId: 'E-26-0052',
    });
    expect(!result.ok && result.code).toBe('RECIPIENT_CARRYING');
    expect(result.evidenceIds).toEqual(['R-0034', 'E-26-0054', 'E-26-0052']);
  });

  // Mutation survivors: either signal of a pregnancy alone must refuse her — the status without a
  // linked embryo, the linked embryo under a stale status.
  it('refuses a mare on either sign of carrying, and names leased-out and retired mares as unavailable', () => {
    const staleStatus = evaluatePlannedRecipient({
      recip: { id: 'R-0034', recipStatus: 'SET_UP' },
      embryoId: 'E-26-0054',
      otherPlannedEmbryoIds: [],
      carryingEmbryoId: 'E-26-0052',
    });
    expect(!staleStatus.ok && staleStatus.code).toBe('RECIPIENT_CARRYING');
    const noLink = evaluatePlannedRecipient({
      recip: { id: 'R-0034', recipStatus: 'CARRYING' },
      embryoId: 'E-26-0054',
      otherPlannedEmbryoIds: [],
      carryingEmbryoId: null,
    });
    expect(!noLink.ok && noLink.code).toBe('RECIPIENT_CARRYING');
    for (const recipStatus of ['LEASED_OUT', 'RETIRED'] as const) {
      const away = evaluatePlannedRecipient({
        recip: { id: 'R-0034', recipStatus },
        embryoId: 'E-26-0054',
        otherPlannedEmbryoIds: [],
        carryingEmbryoId: null,
      });
      expect(!away.ok && away.code).toBe('RECIPIENT_UNAVAILABLE');
    }
  });

  it('refuses a mare already held for another embryo', () => {
    const result = evaluatePlannedRecipient({
      recip: { id: 'R-0040', recipStatus: 'SET_UP' },
      embryoId: 'E-26-0054',
      otherPlannedEmbryoIds: ['E-26-0055'],
      carryingEmbryoId: null,
    });
    expect(!result.ok && result.code).toBe('RECIPIENT_DOUBLE_BOOKED');
  });

  it('refuses a mare that is not set up', () => {
    const result = evaluatePlannedRecipient({
      recip: { id: 'R-0040', recipStatus: 'AVAILABLE' },
      embryoId: 'E-26-0054',
      otherPlannedEmbryoIds: [],
      carryingEmbryoId: null,
    });
    expect(!result.ok && result.code).toBe('RECIPIENT_NOT_SET_UP');
  });
});
