import { z } from 'zod';
import { daysBetween, type BarnDate } from '../time';

/**
 * Deterministic go/no-go rules for putting an embryo into a recipient mare.
 *
 * These are the invariants a person would enforce by looking at the pen sheet and the
 * vet's notes; here they return a typed result the API, the Day Sheet, the detectors and
 * the assistant all read the same way. Nothing probabilistic decides a transfer.
 *
 * ASSUMPTION (docs/ASSUMPTIONS.md): which clearances a transfer needs and how long each
 * stays valid. The public pages establish that recips are "set up" and that mares are
 * "cultured clean" before semen ships; the exact pre-transfer checklist is the operation's
 * to correct.
 */
export const ClearanceKindSchema = z.enum([
  'COGGINS',
  'UTERINE_CULTURE',
  'UTERINE_CYTOLOGY',
  'PRE_TRANSFER_EXAM',
  'VIDEO_IN_FOAL',
  'RETURN_ASSESSMENT',
]);
export type ClearanceKind = z.infer<typeof ClearanceKindSchema>;

export const ClearanceResultSchema = z.enum(['CLEAR', 'ABNORMAL', 'PENDING']);
export type ClearanceResult = z.infer<typeof ClearanceResultSchema>;

export const ClearanceRecordSchema = z.object({
  id: z.string(),
  kind: ClearanceKindSchema,
  result: ClearanceResultSchema,
  performedOn: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  expiresOn: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .nullable(),
});
export type ClearanceRecord = z.infer<typeof ClearanceRecordSchema>;

/** A rule's verdict. `evidenceIds` are the records a person (or the assistant) would cite. */
export const RuleResultSchema = z.discriminatedUnion('ok', [
  z.object({ ok: z.literal(true), evidenceIds: z.array(z.string()) }),
  z.object({ ok: z.literal(false), code: z.string(), reason: z.string(), evidenceIds: z.array(z.string()) }),
]);
export type RuleResult = z.infer<typeof RuleResultSchema>;

/** What a transfer needs on the recipient, and for how long a result counts. */
export const TRANSFER_CLEARANCES: Record<'PRE_TRANSFER_EXAM' | 'UTERINE_CULTURE', { validDays: number }> = {
  PRE_TRANSFER_EXAM: { validDays: 14 },
  UTERINE_CULTURE: { validDays: 30 },
};

/**
 * Newest record first. On the same day the harder stop governs — abnormal, then pending, then
 * clear — and ids break the last tie, so a verdict never depends on the order rows come back
 * in. ASSUMPTION: a re-test the same day does not override an abnormal result on its own; the
 * vet's review does.
 */
const RESULT_SEVERITY: Record<ClearanceResult, number> = { ABNORMAL: 2, PENDING: 1, CLEAR: 0 };
export function newestFirst(a: ClearanceRecord, b: ClearanceRecord): number {
  if (a.performedOn !== b.performedOn) return a.performedOn < b.performedOn ? 1 : -1;
  if (a.result !== b.result) return RESULT_SEVERITY[b.result] - RESULT_SEVERITY[a.result];
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}

export function isClearanceCurrent(record: ClearanceRecord, today: BarnDate, validDays: number): boolean {
  if (record.expiresOn !== null) return record.expiresOn >= today;
  return daysBetween(record.performedOn, today) <= validDays;
}

/**
 * The recipient side of "may this embryo go into this mare today?"
 * Order of the verdicts matters: an abnormal result is a harder stop than a missing one.
 */
export function evaluateTransferClearance(
  recip: { id: string; clearances: ClearanceRecord[] },
  today: BarnDate,
): RuleResult {
  const evidence: string[] = [recip.id];
  const missing: string[] = [];
  for (const [kind, rule] of Object.entries(TRANSFER_CLEARANCES) as [
    'PRE_TRANSFER_EXAM' | 'UTERINE_CULTURE',
    { validDays: number },
  ][]) {
    const records = recip.clearances.filter((c) => c.kind === kind).sort(newestFirst);
    const latest = records[0];
    if (!latest) {
      missing.push(kind);
      continue;
    }
    evidence.push(latest.id);
    if (latest.result === 'ABNORMAL') {
      return {
        ok: false,
        code: 'CLEARANCE_ABNORMAL',
        reason: `${label(kind)} on ${recip.id} came back abnormal (${latest.id}, ${latest.performedOn}); veterinary review is required before a transfer.`,
        evidenceIds: evidence,
      };
    }
    if (latest.result === 'PENDING') {
      return {
        ok: false,
        code: 'CLEARANCE_PENDING',
        reason: `${label(kind)} on ${recip.id} is still pending (${latest.id}, sampled ${latest.performedOn}); the result must be back before a transfer.`,
        evidenceIds: evidence,
      };
    }
    if (!isClearanceCurrent(latest, today, rule.validDays)) {
      return {
        ok: false,
        code: 'CLEARANCE_EXPIRED',
        reason: `${label(kind)} on ${recip.id} is from ${latest.performedOn}, older than ${rule.validDays} days; it must be repeated before a transfer.`,
        evidenceIds: evidence,
      };
    }
  }
  if (missing.length > 0) {
    return {
      ok: false,
      code: 'CLEARANCE_MISSING',
      reason: `No ${missing.map(label).join(' or ')} is on record for ${recip.id}; the vet has not cleared this mare for a transfer.`,
      evidenceIds: evidence,
    };
  }
  return { ok: true, evidenceIds: evidence };
}

/** The barn's name for each clearance kind, for audit rows and screens. */
export const CLEARANCE_LABELS: Record<ClearanceKind, string> = {
  PRE_TRANSFER_EXAM: 'pre-transfer exam',
  UTERINE_CULTURE: 'uterine culture',
  UTERINE_CYTOLOGY: 'uterine cytology',
  COGGINS: 'Coggins',
  VIDEO_IN_FOAL: 'video confirmation in foal',
  RETURN_ASSESSMENT: 'return assessment',
};

function label(kind: string): string {
  switch (kind) {
    case 'PRE_TRANSFER_EXAM':
      return 'pre-transfer exam';
    case 'VIDEO_IN_FOAL':
      return 'video confirmation in foal';
    case 'RETURN_ASSESSMENT':
      return 'return assessment';
    case 'UTERINE_CULTURE':
      return 'uterine culture';
    case 'UTERINE_CYTOLOGY':
      return 'uterine cytology';
    case 'COGGINS':
      return 'Coggins';
    default:
      return kind.toLowerCase();
  }
}
