import { barnClock, barnDate, isCollectionDay, addDays, type BarnDate } from '../time';
import type { ContractStatus } from './contract';

/**
 * Semen order rules, as published:
 *  - order by 5:00 PM Central the day before a scheduled collection
 *  - cancel by 8:00 AM Central the morning of the collection
 *  - collections every other day, February through July
 *  - deposit + stud fee + chute fee paid before semen goes out the door
 */

export const ORDER_CUTOFF_HOUR = 17; // 5 PM the day before
export const CANCEL_CUTOFF_HOUR = 8; // 8 AM the day of

export type SemenHoldReason =
  | 'CONTRACT_UNPAID'
  | 'CONTRACT_UNSIGNED'
  | 'CONTRACT_CLOSED'
  | 'NOT_A_COLLECTION_DAY'
  | 'ORDERED_AFTER_CUTOFF'
  | 'CANCELLED';

export interface SemenOrderFacts {
  contractStatus: ContractStatus;
  /** UTC instant the order was placed. */
  placedAt: Date;
  /** Barn date of the collection the order is for. */
  requestedFor: BarnDate;
  cancelledAt: Date | null;
}

export interface SemenOrderEvaluation {
  canShip: boolean;
  holds: SemenHoldReason[];
  orderCutoffMissed: boolean;
}

/** The last instant an order may be placed for a given collection day: 5 PM the day before. */
export function orderCutoffFor(requestedFor: BarnDate): { date: BarnDate; hour: number } {
  return { date: addDays(requestedFor, -1), hour: ORDER_CUTOFF_HOUR };
}

export function wasPlacedBeforeCutoff(placedAt: Date, requestedFor: BarnDate): boolean {
  const clock = barnClock(placedAt);
  const cutoff = orderCutoffFor(requestedFor);
  if (clock.date < cutoff.date) return true;
  if (clock.date > cutoff.date) return false;
  return clock.hour < cutoff.hour;
}

export function isCancellationOnTime(cancelledAt: Date, requestedFor: BarnDate): boolean {
  const clock = barnClock(cancelledAt);
  if (clock.date < requestedFor) return true;
  if (clock.date > requestedFor) return false;
  return clock.hour < CANCEL_CUTOFF_HOUR;
}

export function evaluateSemenOrder(facts: SemenOrderFacts): SemenOrderEvaluation {
  const holds: SemenHoldReason[] = [];

  if (facts.cancelledAt) holds.push('CANCELLED');
  holds.push(...contractHolds(facts.contractStatus));
  if (!isCollectionDay(facts.requestedFor)) holds.push('NOT_A_COLLECTION_DAY');

  const orderCutoffMissed = !wasPlacedBeforeCutoff(facts.placedAt, facts.requestedFor);
  if (orderCutoffMissed) holds.push('ORDERED_AFTER_CUTOFF');

  return { canShip: holds.length === 0, holds, orderCutoffMissed };
}

/** Which part of "paid in full and signed" is missing. Both can be. */
export function contractHolds(status: ContractStatus): SemenHoldReason[] {
  switch (status) {
    case 'SHIPPABLE':
      return [];
    case 'PAID_IN_FULL':
      return ['CONTRACT_UNSIGNED'];
    case 'SIGNED':
      return ['CONTRACT_UNPAID'];
    case 'DEPOSIT_PAID':
    case 'RESERVED':
      return ['CONTRACT_UNPAID', 'CONTRACT_UNSIGNED'];
    case 'CLOSED':
    case 'CANCELLED':
      return ['CONTRACT_CLOSED'];
  }
}

export function describeHold(reason: SemenHoldReason): string {
  switch (reason) {
    case 'CONTRACT_UNPAID':
      return 'Balance due — deposit, stud fee and chute fee must be paid before semen ships.';
    case 'CONTRACT_UNSIGNED':
      return 'Contract not signed.';
    case 'CONTRACT_CLOSED':
      return 'Contract is closed or cancelled.';
    case 'NOT_A_COLLECTION_DAY':
      return 'Requested date is not a collection day.';
    case 'ORDERED_AFTER_CUTOFF':
      return 'Ordered after 5 PM the day before collection.';
    case 'CANCELLED':
      return 'Order was cancelled.';
  }
}

/** Convenience for the Day Sheet: is `instant` still inside the cancellation window for `requestedFor`? */
export function cancellationWindowOpen(instant: Date, requestedFor: BarnDate): boolean {
  return isCancellationOnTime(instant, requestedFor);
}

export function todayAtBarn(instant: Date): BarnDate {
  return barnDate(instant);
}
