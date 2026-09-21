import { z } from 'zod';
import { ENTITY_ID_PATTERN } from '../ids';

/**
 * The assistant's answer is data, not prose. Every factual statement carries the IDs of the
 * records that support it; a statement without evidence is not allowed to exist. When the
 * records don't answer the question, the model must say so in `abstentions`. When two
 * records disagree, it must say so in `conflicts`. The `summary` is the only free prose and
 * may only restate what the statements already say.
 */

export const EntityIdSchema = z.string().regex(ENTITY_ID_PATTERN, 'must be an entity code like E-26-2041');

export const AbstainReasonSchema = z.enum([
  'NO_RECORD', // nothing matched
  'FIELD_EMPTY', // the record exists but the field is not filled in
  'ACCESS_DENIED', // the actor's role cannot see it
  'VETERINARY_JUDGMENT', // a clinical question; route to the vet
  'FINANCIAL_ACTION', // asked to move money or change a ledger
  'OUT_OF_SCOPE', // not about this operation
  'UNVERIFIABLE', // the model could not tie the claim to a record
  'SENSITIVE_DATA', // asked for data this application does not store or retrieve (full card or account numbers)
  'SOURCES_DISAGREE', // two systems of record disagree; a person with billing rights decides
]);

export const StatementSchema = z.object({
  text: z.string().min(1).max(400),
  evidence: z.array(EntityIdSchema).min(1).max(12),
  confidence: z.enum(['HIGH', 'MEDIUM', 'LOW']).default('HIGH'),
});

export const AbstentionSchema = z.object({
  question: z.string().min(1).max(300),
  reason: AbstainReasonSchema,
  detail: z.string().max(300).optional(),
});

export const ConflictSchema = z.object({
  ids: z.array(EntityIdSchema).min(2).max(6),
  description: z.string().min(1).max(400),
  /** Which record the model believes is newer/authoritative, if it can tell. */
  preferredId: EntityIdSchema.optional(),
});

export const SuggestedRequestSchema = z.object({
  subject: z.string().min(1).max(120),
  body: z.string().min(1).max(600),
  evidenceIds: z.array(EntityIdSchema).max(12),
});

export const AskAnswerSchema = z.object({
  statements: z.array(StatementSchema).max(8),
  abstentions: z.array(AbstentionSchema).max(6),
  conflicts: z.array(ConflictSchema).max(4),
  summary: z.string().max(600),
  /** Offered when the person should hand this to a human; never executed by the assistant. */
  suggestedRequest: SuggestedRequestSchema.optional(),
});

export type AskAnswer = z.infer<typeof AskAnswerSchema>;
export type Statement = z.infer<typeof StatementSchema>;
export type Abstention = z.infer<typeof AbstentionSchema>;
export type Conflict = z.infer<typeof ConflictSchema>;
export type AbstainReason = z.infer<typeof AbstainReasonSchema>;

/** JSON Schema for the model's structured output, derived from the same Zod definition. */
export function askAnswerJsonSchema(): Record<string, unknown> {
  return z.toJSONSchema(AskAnswerSchema, { target: 'draft-7' });
}

const isEntityId = (value: unknown): value is string => typeof value === 'string' && ENTITY_ID_PATTERN.test(value);
const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);
const asArray = (value: unknown): unknown[] => (Array.isArray(value) ? value : []);

/**
 * A model's answer with the verifier's discipline applied at the boundary, before the schema
 * judges it. A local model decoding against the JSON schema gets the shape right but not the
 * regex: it cites a rule code (`CLEARANCE_EXPIRED`) beside a record code, or a reason outside
 * the list. Throwing the whole answer away for that would hide a right answer behind a
 * formatting slip, so instead: evidence that is not a record code is dropped, a statement left
 * with none becomes an UNVERIFIABLE abstention (never a bare claim), a conflict with fewer than
 * two codes is dropped, an unknown reason becomes UNVERIFIABLE. Nothing is added; the verifier
 * still checks every surviving code against what the tools returned.
 */
export function normalizeAnswerCandidate(candidate: unknown): unknown {
  if (!isRecord(candidate)) return candidate;
  const reasons = new Set<string>(AbstainReasonSchema.options);
  const statements: unknown[] = [];
  const abstentions: unknown[] = [];
  for (const raw of asArray(candidate['statements'])) {
    if (!isRecord(raw)) continue;
    const evidence = asArray(raw['evidence']).filter(isEntityId);
    if (evidence.length > 0) statements.push({ ...raw, evidence: evidence.slice(0, 12) });
    else if (typeof raw['text'] === 'string' && raw['text'].length > 0)
      abstentions.push({
        question: raw['text'].slice(0, 300),
        reason: 'UNVERIFIABLE',
        detail: 'No record code supported this statement.',
      });
  }
  for (const raw of asArray(candidate['abstentions'])) {
    if (!isRecord(raw)) continue;
    abstentions.push({
      ...raw,
      reason: typeof raw['reason'] === 'string' && reasons.has(raw['reason']) ? raw['reason'] : 'UNVERIFIABLE',
    });
  }
  const conflicts = asArray(candidate['conflicts'])
    .filter(isRecord)
    .map((raw) => ({
      ...raw,
      ids: asArray(raw['ids']).filter(isEntityId).slice(0, 6),
      preferredId: isEntityId(raw['preferredId']) ? raw['preferredId'] : undefined,
    }))
    .filter((c) => c.ids.length >= 2);
  const request = isRecord(candidate['suggestedRequest'])
    ? {
        ...candidate['suggestedRequest'],
        evidenceIds: asArray(candidate['suggestedRequest']['evidenceIds']).filter(isEntityId).slice(0, 12),
      }
    : undefined;
  return {
    ...candidate,
    statements: statements.slice(0, 8),
    abstentions: abstentions.slice(0, 6),
    conflicts: conflicts.slice(0, 4),
    ...(request ? { suggestedRequest: request } : {}),
  };
}
