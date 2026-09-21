import { describe, expect, it } from 'vitest';
import { AskAnswerSchema, askAnswerJsonSchema, type AskAnswer } from './schema';
import { citedIds, verifyEvidence } from './verify';

const seen = new Set(['E-26-2041', 'TR-26-0512', 'CHK-26-0912', 'R-0347']);

const good: AskAnswer = {
  statements: [
    {
      text: 'E-26-2041 was transferred into R-0347 on April 3.',
      evidence: ['E-26-2041', 'TR-26-0512', 'R-0347'],
      confidence: 'HIGH',
    },
    { text: 'The 24-day check on April 20 found a heartbeat.', evidence: ['CHK-26-0912'], confidence: 'HIGH' },
  ],
  abstentions: [],
  conflicts: [],
  summary: 'E-26-2041 is in R-0347 and confirmed at day 24.',
};

describe('verifyEvidence', () => {
  it('passes an answer whose evidence was all retrieved', () => {
    const report = verifyEvidence(good, seen);
    expect(report.ok).toBe(true);
    expect(report.answer.statements).toHaveLength(2);
    expect(citedIds(report.answer).sort()).toEqual(['CHK-26-0912', 'E-26-2041', 'R-0347', 'TR-26-0512']);
  });

  it('turns a statement with invented evidence into an UNVERIFIABLE abstention', () => {
    const bad: AskAnswer = {
      ...good,
      statements: [
        ...good.statements,
        { text: 'A second embryo E-26-2099 was also transferred.', evidence: ['E-26-2099'], confidence: 'MEDIUM' },
      ],
    };
    const report = verifyEvidence(bad, seen);
    expect(report.ok).toBe(false);
    expect(report.answer.statements).toHaveLength(2);
    expect(report.answer.abstentions).toHaveLength(1);
    expect(report.answer.abstentions[0]?.reason).toBe('UNVERIFIABLE');
    expect(report.answer.abstentions[0]?.detail).toContain('E-26-2099');
  });

  it('drops conflicts that reference unseen records and keeps the ones it can vouch for', () => {
    const withConflict: AskAnswer = {
      ...good,
      abstentions: [
        { question: 'What does Jane owe?', reason: 'ACCESS_DENIED', detail: 'Money is visible to billing and admins.' },
      ],
      conflicts: [
        { ids: ['CHK-26-0912', 'CHK-26-0999'], description: 'Two checks disagree.' },
        { ids: ['CHK-26-0912', 'TR-26-0512'], description: 'The check and the transfer disagree on the day.' },
      ],
    };
    const report = verifyEvidence(withConflict, seen);
    expect(report.rejectedConflicts).toBe(1);
    expect(report.ok).toBe(false);
    expect(report.answer.conflicts).toEqual([withConflict.conflicts[1]]);
    // The model's own abstentions are the safety output; verification adds to them, never drops them.
    expect(report.answer.abstentions).toEqual(withConflict.abstentions);
    expect(citedIds(report.answer)).toContain('TR-26-0512');
  });

  // Mutation survivor: a suggested request kept an id nobody retrieved; a person would have sent it.
  it('a suggested request carries only evidence that was retrieved', () => {
    const withRequest: AskAnswer = {
      ...good,
      suggestedRequest: {
        subject: 'Confirm the check',
        body: 'Please confirm.',
        evidenceIds: ['CHK-26-0912', 'CHK-26-0999'],
      },
    };
    expect(verifyEvidence(withRequest, seen).answer.suggestedRequest?.evidenceIds).toEqual(['CHK-26-0912']);
    const clean: AskAnswer = {
      ...good,
      suggestedRequest: { subject: 'Confirm the check', body: 'Please confirm.', evidenceIds: ['CHK-26-0912'] },
    };
    expect(verifyEvidence(clean, seen).answer.suggestedRequest).toEqual(clean.suggestedRequest);
  });
});

describe('AskAnswerSchema', () => {
  it('refuses a statement with no evidence', () => {
    const result = AskAnswerSchema.safeParse({ ...good, statements: [{ text: 'Trust me.', evidence: [] }] });
    expect(result.success).toBe(false);
  });
  it('refuses evidence that is not an entity code', () => {
    const result = AskAnswerSchema.safeParse({ ...good, statements: [{ text: 'x', evidence: ['not-an-id'] }] });
    expect(result.success).toBe(false);
  });
  it('produces a JSON schema for structured output', () => {
    const schema = askAnswerJsonSchema();
    expect(schema).toHaveProperty('properties');
    expect(JSON.stringify(schema)).toContain('statements');
  });
});
