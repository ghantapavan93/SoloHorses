import { FEES, type Cents } from '../money';
import { addDays, daysBetween, type BarnDate } from '../time';

/**
 * Pregnancy milestones are billing events. The three milestones the public price sheets
 * describe are not aligned with each other, which is exactly why billing gets confused:
 *
 *   day 24  heartbeat  → recip lease fee due ($5,000 flush/thawed, $6,500 fresh ICSI) and
 *                        board starts at $22/day
 *   day 45–60 pregnant → ICSI-contract stallion fee due (fee is on the contract)
 *   day 55  pregnant   → a purchased embryo counts as "confirmed" (purchase price already paid;
 *                        this is a status event, not an invoice)
 *
 * This module turns a recorded check into a list of *intents*. Each intent carries a
 * deterministic idempotency key so recording the same check twice cannot bill twice.
 */

export type CheckResult = 'HEARTBEAT' | 'PREGNANT' | 'OPEN' | 'LOST' | 'UNCLEAR';
export type EmbryoSource = 'ICSI' | 'FLUSH' | 'SHIPPED_IN';

export interface MilestoneContext {
  checkId: string;
  transferId: string;
  embryoId: string;
  customerId: string;
  contractId: string | null;
  /** ICSI contracts owe the stallion fee at 45–60 days. */
  contractType: 'FRESH_COOLED' | 'FROZEN' | 'ICSI' | null;
  contractStudFeeCents: Cents | null;
  /** Fresh ICSI embryos carry the higher lease fee; flushes and thawed embryos the lower one. */
  embryoSource: EmbryoSource;
  embryoWasFrozen: boolean;
  /** True when the embryo was bought through the embryo program (55-day confirmation applies). */
  purchasedEmbryo: boolean;
  dayNumber: number;
  result: CheckResult;
  performedOn: BarnDate;
  /** Invoice kinds already issued for this transfer, to keep the engine idempotent. */
  alreadyIssued: ReadonlySet<InvoiceIntentKind>;
}

export type InvoiceIntentKind = 'LEASE_FEE' | 'ICSI_STALLION_FEE';

export interface InvoiceIntent {
  kind: InvoiceIntentKind;
  idempotencyKey: string;
  customerId: string;
  contractId: string | null;
  embryoId: string;
  transferId: string;
  triggeredByCheckId: string;
  amountCents: Cents;
  description: string;
  issuedOn: BarnDate;
  dueOn: BarnDate;
}

export type StatusIntent =
  | { kind: 'BOARD_STARTS'; transferId: string; from: BarnDate; ratePerDayCents: Cents }
  | { kind: 'EMBRYO_CONFIRMED'; embryoId: string; on: BarnDate }
  | { kind: 'EMBRYO_OPEN'; embryoId: string; on: BarnDate; remedy: 'REDO_OR_CREDIT' }
  | { kind: 'PREGNANCY_LOST'; embryoId: string; on: BarnDate }
  | { kind: 'RECHECK_REQUIRED'; transferId: string; on: BarnDate };

export interface MilestoneOutcome {
  invoices: InvoiceIntent[];
  statuses: StatusIntent[];
  /** Plain-language explanation shown in the audit trail and to the vet who recorded it. */
  notes: string[];
}

export const HEARTBEAT_DAY = 24;
export const ICSI_FEE_WINDOW = { from: 45, to: 60 } as const;
export const PURCHASE_CONFIRM_DAY = 55;
export const PAYMENT_TERMS_DAYS = 14;

export function leaseFeeFor(ctx: Pick<MilestoneContext, 'embryoSource' | 'embryoWasFrozen'>): Cents {
  const freshIcsi = ctx.embryoSource === 'ICSI' && !ctx.embryoWasFrozen;
  return freshIcsi ? FEES.leaseFeeFreshIcsi : FEES.leaseFeeFlushOrThawed;
}

export function evaluateCheck(ctx: MilestoneContext): MilestoneOutcome {
  const out: MilestoneOutcome = { invoices: [], statuses: [], notes: [] };
  const dueOn = addDays(ctx.performedOn, PAYMENT_TERMS_DAYS);

  if (ctx.result === 'UNCLEAR') {
    out.statuses.push({ kind: 'RECHECK_REQUIRED', transferId: ctx.transferId, on: ctx.performedOn });
    out.notes.push('Result unclear — nothing billed. Recheck required.');
    return out;
  }

  if (ctx.result === 'OPEN') {
    out.statuses.push({ kind: 'EMBRYO_OPEN', embryoId: ctx.embryoId, on: ctx.performedOn, remedy: 'REDO_OR_CREDIT' });
    out.notes.push('Mare is open. Client is owed a redo or a lease-fee credit for next season.');
    return out;
  }

  if (ctx.result === 'LOST') {
    out.statuses.push({ kind: 'PREGNANCY_LOST', embryoId: ctx.embryoId, on: ctx.performedOn });
    out.notes.push('Pregnancy lost after confirmation. Board stops; no refund is implied by this record.');
    return out;
  }

  // HEARTBEAT or PREGNANT from here on.
  const positive = ctx.result === 'HEARTBEAT' || ctx.result === 'PREGNANT';
  if (!positive) return out;

  if (ctx.dayNumber >= HEARTBEAT_DAY && !ctx.alreadyIssued.has('LEASE_FEE')) {
    const amountCents = leaseFeeFor(ctx);
    out.invoices.push({
      kind: 'LEASE_FEE',
      idempotencyKey: `${ctx.transferId}:LEASE_FEE`,
      customerId: ctx.customerId,
      contractId: ctx.contractId,
      embryoId: ctx.embryoId,
      transferId: ctx.transferId,
      triggeredByCheckId: ctx.checkId,
      amountCents,
      description: `Recipient mare lease fee — heartbeat confirmed day ${ctx.dayNumber} (${ctx.embryoId})`,
      issuedOn: ctx.performedOn,
      dueOn,
    });
    out.statuses.push({
      kind: 'BOARD_STARTS',
      transferId: ctx.transferId,
      from: ctx.performedOn,
      ratePerDayCents: FEES.boardPerDay,
    });
    out.notes.push(`Heartbeat at day ${ctx.dayNumber}: lease fee invoiced, board starts at $22/day.`);
  }

  const inIcsiWindow = ctx.dayNumber >= ICSI_FEE_WINDOW.from && ctx.dayNumber <= ICSI_FEE_WINDOW.to;
  if (
    inIcsiWindow &&
    ctx.contractType === 'ICSI' &&
    ctx.contractId &&
    ctx.contractStudFeeCents !== null &&
    !ctx.alreadyIssued.has('ICSI_STALLION_FEE')
  ) {
    out.invoices.push({
      kind: 'ICSI_STALLION_FEE',
      idempotencyKey: `${ctx.transferId}:ICSI_STALLION_FEE`,
      customerId: ctx.customerId,
      contractId: ctx.contractId,
      embryoId: ctx.embryoId,
      transferId: ctx.transferId,
      triggeredByCheckId: ctx.checkId,
      amountCents: ctx.contractStudFeeCents,
      description: `ICSI stallion fee — pregnancy confirmed day ${ctx.dayNumber} (${ctx.contractId})`,
      issuedOn: ctx.performedOn,
      dueOn,
    });
    out.notes.push(`Day ${ctx.dayNumber} in the 45–60 window: ICSI stallion fee invoiced.`);
  }

  if (ctx.purchasedEmbryo && ctx.dayNumber >= PURCHASE_CONFIRM_DAY) {
    out.statuses.push({ kind: 'EMBRYO_CONFIRMED', embryoId: ctx.embryoId, on: ctx.performedOn });
    out.notes.push(`Day ${ctx.dayNumber}: purchased embryo counts as confirmed.`);
  }

  if (out.invoices.length === 0 && out.statuses.length === 0) {
    out.notes.push(`Positive check at day ${ctx.dayNumber}: no billing milestone crossed.`);
  }

  return out;
}

/** Board accrues from the heartbeat until the mare leaves the farm (or the pregnancy ends). */
export function boardAccruedCents(from: BarnDate, until: BarnDate, ratePerDayCents: Cents = FEES.boardPerDay): Cents {
  const days = Math.max(0, daysBetween(from, until));
  return days * ratePerDayCents;
}

/** The next milestone a positive pregnancy will cross, for the Day Sheet's "crossing today" column. */
/** The days a pregnancy is checked, in order: the billing milestones first, the routine ones after. */
export const CHECK_MILESTONES: readonly number[] = [
  14,
  HEARTBEAT_DAY,
  ICSI_FEE_WINDOW.from,
  PURCHASE_CONFIRM_DAY,
  ICSI_FEE_WINDOW.to,
  90,
  120,
  150,
];

export function nextMilestoneDay(dayNumber: number): number | null {
  return CHECK_MILESTONES.find((m) => m > dayNumber) ?? null;
}

/** Gestation day for a transfer on `performedOn` as of `today`, using embryo age at transfer. */
export function gestationDay(transferOn: BarnDate, today: BarnDate, embryoAgeAtTransfer = 7): number {
  return daysBetween(transferOn, today) + embryoAgeAtTransfer;
}

/** ASSUMPTION (A15): a mare foals at about day 340 of gestation; the estimate is for planning, never a record. */
export const EXPECTED_FOALING_DAY = 340;

export function expectedFoalingOn(transferOn: BarnDate, embryoAgeAtTransfer = 7): BarnDate {
  return addDays(transferOn, EXPECTED_FOALING_DAY - embryoAgeAtTransfer);
}
