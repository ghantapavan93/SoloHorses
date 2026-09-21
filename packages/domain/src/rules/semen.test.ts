import { describe, expect, it } from 'vitest';
import { barnLocalToUtc, isCollectionDay, nextCollectionDay } from '../time';
import { evaluateSemenOrder, isCancellationOnTime, wasPlacedBeforeCutoff } from './semen';

describe('collection calendar', () => {
  it('runs every other day from Feb 1 through July', () => {
    expect(isCollectionDay('2026-02-01')).toBe(true);
    expect(isCollectionDay('2026-02-02')).toBe(false);
    expect(isCollectionDay('2026-02-03')).toBe(true);
    expect(isCollectionDay('2026-07-31')).toBe(true); // 180 days after Feb 1 (leap-free 2026)
    expect(isCollectionDay('2026-08-02')).toBe(false); // out of season
    expect(isCollectionDay('2026-01-30')).toBe(false);
  });
  it('finds the next collection day', () => {
    expect(nextCollectionDay('2026-02-01')).toBe('2026-02-03');
    expect(nextCollectionDay('2026-07-31')).toBe('2027-02-01');
  });
});

describe('order cutoff: 5 PM Central the day before', () => {
  it('accepts an order at 4:59 PM the day before', () => {
    const placed = barnLocalToUtc('2026-04-01', 16, 59);
    expect(wasPlacedBeforeCutoff(placed, '2026-04-02')).toBe(true);
  });
  it('rejects an order at 5:00 PM the day before', () => {
    const placed = barnLocalToUtc('2026-04-01', 17, 0);
    expect(wasPlacedBeforeCutoff(placed, '2026-04-02')).toBe(false);
  });
  it('rejects an order placed the morning of collection', () => {
    const placed = barnLocalToUtc('2026-04-02', 9, 0);
    expect(wasPlacedBeforeCutoff(placed, '2026-04-02')).toBe(false);
  });
  it('accepts an order placed weeks ahead', () => {
    const placed = barnLocalToUtc('2026-03-10', 12, 0);
    expect(wasPlacedBeforeCutoff(placed, '2026-04-02')).toBe(true);
  });
  it('handles UTC-vs-Central correctly near midnight', () => {
    // 11 PM Central on Apr 1 is 04:00 UTC on Apr 2 — still "the day before" at the barn, but after 5 PM.
    const placed = barnLocalToUtc('2026-04-01', 23, 0);
    expect(placed.toISOString()).toBe('2026-04-02T04:00:00.000Z');
    expect(wasPlacedBeforeCutoff(placed, '2026-04-02')).toBe(false);
  });
});

describe('cancellation cutoff: 8 AM Central the day of', () => {
  it('is on time at 7:59 AM', () => {
    expect(isCancellationOnTime(barnLocalToUtc('2026-04-02', 7, 59), '2026-04-02')).toBe(true);
  });
  it('is late at 8:00 AM', () => {
    expect(isCancellationOnTime(barnLocalToUtc('2026-04-02', 8, 0), '2026-04-02')).toBe(false);
  });
});

describe('evaluateSemenOrder', () => {
  const placedOnTime = barnLocalToUtc('2026-04-01', 10, 0); // Apr 2, 2026 is a collection day (60 days after Feb 1)

  it('ships when the contract is shippable, the day is a collection day, and the order was on time', () => {
    const out = evaluateSemenOrder({
      contractStatus: 'SHIPPABLE',
      placedAt: placedOnTime,
      requestedFor: '2026-04-02',
      cancelledAt: null,
    });
    expect(out).toEqual({ canShip: true, holds: [], orderCutoffMissed: false });
  });

  it('holds when the contract is not paid in full', () => {
    const out = evaluateSemenOrder({
      contractStatus: 'DEPOSIT_PAID',
      placedAt: placedOnTime,
      requestedFor: '2026-04-02',
      cancelledAt: null,
    });
    expect(out.canShip).toBe(false);
    expect(out.holds).toEqual(['CONTRACT_UNPAID', 'CONTRACT_UNSIGNED']);
  });

  it('names the missing signature separately from the missing money', () => {
    const paidNotSigned = evaluateSemenOrder({
      contractStatus: 'PAID_IN_FULL',
      placedAt: placedOnTime,
      requestedFor: '2026-04-02',
      cancelledAt: null,
    });
    expect(paidNotSigned.holds).toEqual(['CONTRACT_UNSIGNED']);
    const signedNotPaid = evaluateSemenOrder({
      contractStatus: 'SIGNED',
      placedAt: placedOnTime,
      requestedFor: '2026-04-02',
      cancelledAt: null,
    });
    expect(signedNotPaid.holds).toEqual(['CONTRACT_UNPAID']);
  });

  it('reports every reason at once', () => {
    const out = evaluateSemenOrder({
      contractStatus: 'RESERVED',
      placedAt: barnLocalToUtc('2026-04-05', 9, 0),
      requestedFor: '2026-04-05', // not a collection day (Apr 4 and Apr 6 are)
      cancelledAt: barnLocalToUtc('2026-04-05', 9, 30),
    });
    expect(out.holds).toEqual([
      'CANCELLED',
      'CONTRACT_UNPAID',
      'CONTRACT_UNSIGNED',
      'NOT_A_COLLECTION_DAY',
      'ORDERED_AFTER_CUTOFF',
    ]);
  });
});
