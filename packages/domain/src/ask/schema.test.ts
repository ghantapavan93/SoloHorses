import { describe, expect, it } from 'vitest';
import { AskAnswerSchema, normalizeAnswerCandidate } from './schema';

/**
 * A local model gets the answer's shape right and the regex wrong. The boundary keeps what is
 * evidence, turns what is not into an abstention, and never lets a claim through without a code.
 */
describe("normalizeAnswerCandidate: the verifier's discipline at the parsing boundary", () => {
  it('drops a rule code cited as evidence and keeps the record code beside it', () => {
    const raw = {
      statements: [
        {
          text: 'R-0037 is not cleared: her pre-transfer exam expired.',
          evidence: ['CLEARANCE_EXPIRED', 'CLR-26-0031'],
          confidence: 'HIGH',
        },
      ],
      abstentions: [
        { question: 'Can she leave?', reason: 'VETERINARY_JUDGMENT', detail: 'Veterinary review is required.' },
      ],
      conflicts: [],
      summary: 'Not cleared.',
    };
    expect(AskAnswerSchema.safeParse(raw).success).toBe(false);
    const parsed = AskAnswerSchema.safeParse(normalizeAnswerCandidate(raw));
    expect(parsed.success).toBe(true);
    if (parsed.success) {
      expect(parsed.data.statements[0]?.evidence).toEqual(['CLR-26-0031']);
      expect(parsed.data.abstentions).toHaveLength(1);
    }
  });

  it('turns a statement with no record code into an abstention, never a bare claim', () => {
    const raw = {
      statements: [{ text: 'The barn is busy today.', evidence: ['busy'] }],
      abstentions: [],
      conflicts: [],
      summary: 'Busy.',
    };
    const parsed = AskAnswerSchema.safeParse(normalizeAnswerCandidate(raw));
    expect(parsed.success).toBe(true);
    if (parsed.success) {
      expect(parsed.data.statements).toHaveLength(0);
      expect(parsed.data.abstentions[0]).toMatchObject({ reason: 'UNVERIFIABLE', question: 'The barn is busy today.' });
    }
  });

  it('maps an unknown reason to UNVERIFIABLE and drops a conflict with fewer than two codes', () => {
    const raw = {
      statements: [],
      abstentions: [{ question: 'x', reason: 'NOT_A_REASON', detail: 'y' }],
      conflicts: [
        { ids: ['CHK-26-0077', 'not-a-code'], description: 'one code only' },
        { ids: ['CHK-26-0076', 'CHK-26-0077'], description: 'two checks disagree', preferredId: 'nope' },
      ],
      summary: 's',
    };
    const parsed = AskAnswerSchema.safeParse(normalizeAnswerCandidate(raw));
    expect(parsed.success).toBe(true);
    if (parsed.success) {
      expect(parsed.data.abstentions[0]?.reason).toBe('UNVERIFIABLE');
      expect(parsed.data.conflicts).toHaveLength(1);
      expect(parsed.data.conflicts[0]?.preferredId).toBeUndefined();
    }
  });

  it('leaves a well-formed answer exactly as it was, and a non-object alone', () => {
    const raw = {
      statements: [{ text: 'E-26-0001 is pregnant.', evidence: ['E-26-0001'], confidence: 'HIGH' }],
      abstentions: [],
      conflicts: [],
      summary: 'Pregnant.',
    };
    expect(normalizeAnswerCandidate(raw)).toEqual(raw);
    expect(normalizeAnswerCandidate('nope')).toBe('nope');
  });
});
