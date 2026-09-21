import { daysBetween, type BarnDate } from '../time';
import { newestFirst, type ClearanceRecord, type RuleResult } from './clearance';

/**
 * Two published conditions on a recipient mare leaving the farm, and one on her coming back.
 *
 *   FACT (recipient leasing)  A leased mare is video-confirmed in foal within three days of
 *                             departure; once she leaves, the guarantee ends.
 *   FACT (the sale)           A recipient sold with a foal in utero must come back after
 *                             weaning, in good health and open, or the buyer owes a $6,000
 *                             recipient purchase fee.
 *
 * Neither rule decides a veterinary question. The departure rule asks whether the vet's
 * confirmation exists and is recent; the return rule asks whether the vet's assessment
 * exists and what it found. Whether a fee is charged is a person's decision, always: the
 * rule only says when that decision can be made and when it cannot.
 */
export const DEPARTURE_CONFIRMATION_WINDOW_DAYS = 3;
export const RECIP_RETURN_DEADLINE_MONTH_DAY = '12-01';

export function evaluateDeparture(
  recip: { id: string; scheduledDepartureOn: BarnDate | null; clearances: ClearanceRecord[] },
  today: BarnDate,
): RuleResult {
  if (!recip.scheduledDepartureOn) return { ok: true, evidenceIds: [recip.id] };
  const evidence = [recip.id];
  const daysUntil = daysBetween(today, recip.scheduledDepartureOn);
  if (daysUntil > DEPARTURE_CONFIRMATION_WINDOW_DAYS) return { ok: true, evidenceIds: evidence };
  const videos = recip.clearances.filter((c) => c.kind === 'VIDEO_IN_FOAL').sort(newestFirst);
  const latest = videos[0];
  if (!latest) {
    return {
      ok: false,
      code: 'DEPARTURE_UNCONFIRMED',
      reason: `${recip.id} leaves ${daysUntil <= 0 ? 'today' : `in ${daysUntil} day${daysUntil === 1 ? '' : 's'}`} and no video confirmation of pregnancy is on record; the vet confirms her in foal within ${DEPARTURE_CONFIRMATION_WINDOW_DAYS} days of departure.`,
      evidenceIds: evidence,
    };
  }
  evidence.push(latest.id);
  if (latest.result !== 'CLEAR') {
    return {
      ok: false,
      code: 'DEPARTURE_NOT_IN_FOAL',
      reason: `the latest video check on ${recip.id} (${latest.id}, ${latest.performedOn}) did not confirm her in foal; she cannot leave as a carrying mare.`,
      evidenceIds: evidence,
    };
  }
  if (daysBetween(latest.performedOn, recip.scheduledDepartureOn) > DEPARTURE_CONFIRMATION_WINDOW_DAYS) {
    return {
      ok: false,
      code: 'DEPARTURE_CONFIRMATION_STALE',
      reason: `the video confirmation on ${recip.id} is from ${latest.performedOn}, more than ${DEPARTURE_CONFIRMATION_WINDOW_DAYS} days before departure; it must be repeated.`,
      evidenceIds: evidence,
    };
  }
  return { ok: true, evidenceIds: evidence };
}

export interface RecipReturnContext {
  recipId: string;
  lotId: string;
  /** The foal's weaning date, when known; the return is due after it. */
  weanedOn: BarnDate | null;
  returnedOn: BarnDate | null;
  /** The vet's assessment on return: CLEAR = open and in good health. */
  assessment: ClearanceRecord | null;
}

/**
 * Where a returned recipient stands against the sale condition. The fee is never decided
 * here; the codes say whether a person can decide it yet, and on what evidence.
 */
export function evaluateRecipReturn(ctx: RecipReturnContext, today: BarnDate): RuleResult {
  const evidence = [ctx.recipId, ctx.lotId];
  if (!ctx.returnedOn) {
    if (ctx.weanedOn && today > `${ctx.weanedOn.slice(0, 4)}-${RECIP_RETURN_DEADLINE_MONTH_DAY}`) {
      return {
        ok: false,
        code: 'RETURN_OVERDUE',
        reason: `${ctx.recipId} was sold with a foal in utero, the foal was weaned on ${ctx.weanedOn}, and she has not come back by December 1; the sale condition names a $6,000 recipient purchase fee — a person decides whether it applies.`,
        evidenceIds: evidence,
      };
    }
    return { ok: true, evidenceIds: evidence }; // not due yet, or not weaned yet: nothing to decide
  }
  if (!ctx.assessment) {
    return {
      ok: false,
      code: 'RETURN_ASSESSMENT_MISSING',
      reason: `${ctx.recipId} came back on ${ctx.returnedOn} and no veterinary return assessment is on record; whether she is open and in good health cannot be established from the record.`,
      evidenceIds: evidence,
    };
  }
  evidence.push(ctx.assessment.id);
  if (ctx.assessment.result === 'PENDING') {
    return {
      ok: false,
      code: 'RETURN_ASSESSMENT_PENDING',
      reason: `the return assessment on ${ctx.recipId} (${ctx.assessment.id}) is still pending.`,
      evidenceIds: evidence,
    };
  }
  if (ctx.assessment.result === 'ABNORMAL') {
    return {
      ok: false,
      code: 'RETURN_CONDITION_NOT_MET',
      reason: `the vet's return assessment on ${ctx.recipId} (${ctx.assessment.id}, ${ctx.assessment.performedOn}) did not find her open and in good health; the sale condition names a $6,000 recipient purchase fee — a person decides whether it applies.`,
      evidenceIds: evidence,
    };
  }
  return { ok: true, evidenceIds: evidence };
}
