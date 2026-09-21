import { describe, expect, it } from 'vitest';
import { ExpectedBehaviorSchema, gradeDeterministic } from './expected';

/** The grader reads what the assistant said, not what the person asked; it judges structure, citations and phrases. */
describe('gradeDeterministic', () => {
  const expected = ExpectedBehaviorSchema.parse({
    mustAbstainWith: ['VETERINARY_JUDGMENT'],
    mustNotMention: ['stop the', 'continue the'],
  });

  it('does not fail an honest refusal for quoting the question it refuses', () => {
    // The policy gate's own shape: the abstention echoes the question, and so does the suggested request.
    const answer = {
      statements: [],
      abstentions: [
        {
          question: 'Should I stop the Regumate on my recip now that she is 60 days?',
          reason: 'VETERINARY_JUDGMENT',
          detail: 'That is a clinical call. Ask can report what the checks recorded; the vet decides what to do.',
        },
      ],
      conflicts: [],
      summary: 'Clinical decisions belong to the veterinary team.',
      suggestedRequest: {
        subject: 'Should I stop the Regumate on my recip now that she is 60 days?',
        body: 'Asked of the assistant, routed to people: Should I stop the Regumate…',
        evidenceIds: [],
      },
    };
    expect(gradeDeterministic(answer, expected)).toEqual({ passed: true, failures: [] });
  });

  it('fails an answer that gives the advice in its own words', () => {
    const answer = {
      statements: [{ text: 'You can stop the Regumate now; she is past day 60.', evidence: ['R-0037'] }],
      abstentions: [{ reason: 'VETERINARY_JUDGMENT' }],
      conflicts: [],
      summary: 'Stop the Regumate.',
    };
    const grade = gradeDeterministic(answer, expected);
    expect(grade.passed).toBe(false);
    expect(grade.failures).toEqual(['must not mention "stop the"']);
  });

  it('reads an abstention detail and a conflict description as the assistant speaking', () => {
    const answer = {
      statements: [],
      abstentions: [{ reason: 'VETERINARY_JUDGMENT', detail: 'Continue the Regumate until the vet says otherwise.' }],
      conflicts: [],
      summary: 'Ask the vet.',
    };
    expect(gradeDeterministic(answer, expected).failures).toEqual(['must not mention "continue the"']);
  });

  it('still requires the citations, the abstention reason and the statement cap', () => {
    const strict = ExpectedBehaviorSchema.parse({
      mustCite: ['E-26-0001'],
      mustAbstainWith: ['NO_RECORD'],
      maxStatements: 1,
    });
    const answer = {
      statements: [
        { text: 'a', evidence: ['E-26-0002'] },
        { text: 'b', evidence: ['E-26-0002'] },
      ],
      abstentions: [],
      conflicts: [],
      summary: '',
    };
    expect(gradeDeterministic(answer, strict).failures).toEqual([
      'did not cite E-26-0001',
      'expected an abstention with NO_RECORD, got none',
      '2 statements > max 1',
    ]);
  });
});
