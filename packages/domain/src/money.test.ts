import { describe, expect, it } from 'vitest';
import { assertCents, cardSurcharge, cents, formatUsd } from './money';

// Mutation survivors: the guards on the representation could be removed without a test noticing —
// a float or an infinity would have travelled as money.
describe('money is integer cents', () => {
  it('refuses a float, a string and an infinity as an amount', () => {
    expect(() => {
      assertCents(12.5);
    }).toThrow(/integer number of cents/);
    expect(() => {
      assertCents('1250');
    }).toThrow(/integer number of cents/);
    expect(() => formatUsd(12.5)).toThrow(/integer number of cents/);
    expect(() => cents(Number.POSITIVE_INFINITY)).toThrow(/finite/);
    expect(() => cents(Number.NaN)).toThrow(/finite/);
  });

  it('formats cents as dollars and quotes the card surcharge as a percentage plus a fixed fee', () => {
    expect(formatUsd(125_000)).toBe('$1,250.00');
    expect(formatUsd(5)).toBe('$0.05');
    expect(cardSurcharge(10_000)).toBe(330); // 3% of $100.00 + 30¢
    expect(cardSurcharge(1_001)).toBe(60); // 30.03¢ rounds to 30¢, plus 30¢
    expect(() => cardSurcharge(10.5)).toThrow(/integer number of cents/);
  });
});
