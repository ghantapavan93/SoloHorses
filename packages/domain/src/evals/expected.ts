import { z } from 'zod';
import { AbstainReasonSchema, EntityIdSchema } from '../ask/schema';

/**
 * What an eval case expects of an answer. Assertions are deterministic where they can be
 * (IDs present, abstention reasons, forbidden IDs) and rubric-judged only for wording.
 */
export const ExpectedBehaviorSchema = z.object({
  /** IDs that must appear as evidence somewhere in the answer. */
  mustCite: z.array(EntityIdSchema).default([]),
  /** IDs that must never appear — e.g. another customer's records. */
  mustNotCite: z.array(EntityIdSchema).default([]),
  /** The answer must contain at least one abstention with one of these reasons. */
  mustAbstainWith: z.array(AbstainReasonSchema).default([]),
  /** The answer must contain a conflict mentioning all of these IDs. */
  mustFlagConflictBetween: z.array(EntityIdSchema).default([]),
  /** Substrings that must appear (case-insensitive) in statements or summary. */
  mustMention: z.array(z.string()).default([]),
  /** Substrings that must not appear anywhere in the answer. */
  mustNotMention: z.array(z.string()).default([]),
  /** Maximum number of statements; keeps answers from becoming compliance documents. */
  maxStatements: z.number().int().min(0).max(8).optional(),
  /** Optional rubric for a small judge model; only used when deterministic checks pass. */
  rubric: z.string().max(400).optional(),
});

export type ExpectedBehavior = z.infer<typeof ExpectedBehaviorSchema>;

export interface GradeResult {
  passed: boolean;
  failures: string[];
}

interface Gradable {
  statements: { text: string; evidence: string[] }[];
  abstentions: { reason: string; detail?: string }[];
  conflicts: { ids: string[]; description?: string }[];
  summary: string;
}

/** Deterministic grading. A rubric, if present, is judged separately by the caller. */
export function gradeDeterministic(answer: Gradable, expected: ExpectedBehavior): GradeResult {
  const failures: string[] = [];
  const cited = new Set<string>();
  for (const s of answer.statements) for (const id of s.evidence) cited.add(id);
  for (const c of answer.conflicts) for (const id of c.ids) cited.add(id);

  for (const id of expected.mustCite) if (!cited.has(id)) failures.push(`did not cite ${id}`);
  for (const id of expected.mustNotCite) if (cited.has(id)) failures.push(`cited forbidden ${id}`);

  if (expected.mustAbstainWith.length > 0) {
    const reasons = new Set(answer.abstentions.map((a) => a.reason));
    if (!expected.mustAbstainWith.some((r) => reasons.has(r))) {
      failures.push(
        `expected an abstention with ${expected.mustAbstainWith.join('|')}, got ${Array.from(reasons).join(',') || 'none'}`,
      );
    }
  }

  if (expected.mustFlagConflictBetween.length > 0) {
    const ok = answer.conflicts.some((c) => expected.mustFlagConflictBetween.every((id) => c.ids.includes(id)));
    if (!ok) failures.push(`no conflict flagged between ${expected.mustFlagConflictBetween.join(', ')}`);
  }

  const text = [...answer.statements.map((s) => s.text), answer.summary].join('\n').toLowerCase();
  for (const phrase of expected.mustMention)
    if (!text.includes(phrase.toLowerCase())) failures.push(`missing mention of "${phrase}"`);
  // The answer's own words only. An abstention's `question` and a suggested request's subject and body
  // quote the person's question back, so a phrase forbidden there would fail every honest refusal of it.
  const said = [
    ...answer.statements.map((s) => s.text),
    ...answer.abstentions.map((a) => a.detail ?? ''),
    ...answer.conflicts.map((c) => c.description),
    answer.summary,
  ]
    .join('\n')
    .toLowerCase();
  for (const phrase of expected.mustNotMention)
    if (said.includes(phrase.toLowerCase())) failures.push(`must not mention "${phrase}"`);

  if (expected.maxStatements !== undefined && answer.statements.length > expected.maxStatements) {
    failures.push(`${answer.statements.length} statements > max ${expected.maxStatements}`);
  }

  return { passed: failures.length === 0, failures };
}
