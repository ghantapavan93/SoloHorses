import type { RuleResult } from './clearance';

/**
 * Whether a recip can be the planned recipient for an embryo. A mare can carry one
 * pregnancy; a mare already carrying, leased out or retired is not a candidate, and one
 * mare cannot be held for two embryos. The Day Sheet, the detectors, the transfer endpoint
 * and the assistant's proposals all ask this one function.
 */
export type RecipStatus = 'AVAILABLE' | 'SET_UP' | 'CARRYING' | 'LEASED_OUT' | 'OPEN' | 'RETIRED';

export interface PlannedRecipientContext {
  recip: { id: string; recipStatus: RecipStatus | null };
  /** The embryo being planned for this recip. */
  embryoId: string;
  /** Other embryos (not this one) that already name this recip as their planned recipient. */
  otherPlannedEmbryoIds: string[];
  /** The embryo this recip is carrying right now, if any. */
  carryingEmbryoId: string | null;
}

export function evaluatePlannedRecipient(ctx: PlannedRecipientContext): RuleResult {
  const evidence = [ctx.recip.id, ctx.embryoId];
  if (ctx.recip.recipStatus === 'CARRYING' || ctx.carryingEmbryoId) {
    return {
      ok: false,
      code: 'RECIPIENT_CARRYING',
      reason: `${ctx.recip.id} is already carrying${ctx.carryingEmbryoId ? ` ${ctx.carryingEmbryoId}` : ''}; she cannot be held for ${ctx.embryoId}.`,
      evidenceIds: ctx.carryingEmbryoId ? [...evidence, ctx.carryingEmbryoId] : evidence,
    };
  }
  if (ctx.recip.recipStatus === 'LEASED_OUT' || ctx.recip.recipStatus === 'RETIRED') {
    return {
      ok: false,
      code: 'RECIPIENT_UNAVAILABLE',
      reason: `${ctx.recip.id} is ${ctx.recip.recipStatus.toLowerCase().replace('_', ' ')} and not in the herd for a transfer.`,
      evidenceIds: evidence,
    };
  }
  if (ctx.otherPlannedEmbryoIds.length > 0) {
    return {
      ok: false,
      code: 'RECIPIENT_DOUBLE_BOOKED',
      reason: `${ctx.recip.id} is already held for ${ctx.otherPlannedEmbryoIds.join(', ')}; one mare carries one embryo.`,
      evidenceIds: [...evidence, ...ctx.otherPlannedEmbryoIds],
    };
  }
  if (ctx.recip.recipStatus !== 'SET_UP') {
    return {
      ok: false,
      code: 'RECIPIENT_NOT_SET_UP',
      reason: `${ctx.recip.id} is ${(ctx.recip.recipStatus ?? 'unknown').toLowerCase().replace('_', ' ')}, not set up (synchronized) for a transfer day.`,
      evidenceIds: evidence,
    };
  }
  return { ok: true, evidenceIds: evidence };
}
