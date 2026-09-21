import type { AskAnswer, Statement } from './schema';

/**
 * Deterministic post-check. The model may only cite IDs that actually appeared in tool
 * results during this turn. Anything else is downgraded to an abstention — not silently
 * dropped, so the person can see that a claim was attempted and rejected.
 */

export interface VerificationReport {
  answer: AskAnswer;
  rejectedStatements: { statement: Statement; unknownIds: string[] }[];
  rejectedConflicts: number;
  ok: boolean;
}

export function verifyEvidence(answer: AskAnswer, seenIds: ReadonlySet<string>): VerificationReport {
  const rejectedStatements: VerificationReport['rejectedStatements'] = [];
  const statements: Statement[] = [];

  for (const statement of answer.statements) {
    const unknownIds = statement.evidence.filter((id) => !seenIds.has(id));
    if (unknownIds.length > 0) {
      rejectedStatements.push({ statement, unknownIds });
    } else {
      statements.push(statement);
    }
  }

  const conflicts = answer.conflicts.filter((c) => c.ids.every((id) => seenIds.has(id)));
  const rejectedConflicts = answer.conflicts.length - conflicts.length;

  const abstentions = [...answer.abstentions];
  for (const rejected of rejectedStatements) {
    abstentions.push({
      question: rejected.statement.text,
      reason: 'UNVERIFIABLE',
      detail: `Cited ${rejected.unknownIds.join(', ')} which did not appear in the records retrieved for this question.`,
    });
  }

  const suggestedRequest =
    answer.suggestedRequest && answer.suggestedRequest.evidenceIds.every((id) => seenIds.has(id))
      ? answer.suggestedRequest
      : answer.suggestedRequest
        ? {
            ...answer.suggestedRequest,
            evidenceIds: answer.suggestedRequest.evidenceIds.filter((id) => seenIds.has(id)),
          }
        : undefined;

  const verified: AskAnswer = {
    statements,
    abstentions: abstentions.slice(0, 6),
    conflicts,
    summary: answer.summary,
    ...(suggestedRequest ? { suggestedRequest } : {}),
  };

  return {
    answer: verified,
    rejectedStatements,
    rejectedConflicts,
    ok: rejectedStatements.length === 0 && rejectedConflicts === 0,
  };
}

/** Every ID the answer still relies on after verification — what the UI turns into chips. */
export function citedIds(answer: AskAnswer): string[] {
  const ids = new Set<string>();
  for (const s of answer.statements) for (const id of s.evidence) ids.add(id);
  for (const c of answer.conflicts) for (const id of c.ids) ids.add(id);
  return Array.from(ids);
}
