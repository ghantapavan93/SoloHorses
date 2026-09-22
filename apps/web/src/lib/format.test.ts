import { describe, expect, it } from 'vitest';
import { barnDate, dateTime, day, dayLong, hrefFor, label, usd } from './format';

describe('hrefFor', () => {
  it('routes every citable code to its page', () => {
    expect(hrefFor('E-26-2041')).toBe('/embryos/E-26-2041');
    expect(hrefFor('SS-26-0533')).toBe('/contracts/SS-26-0533');
    expect(hrefFor('R-0347')).toBe('/horses/R-0347');
    expect(hrefFor('H-0012')).toBe('/horses/H-0012');
    expect(hrefFor('C-0004')).toBe('/customers/C-0004');
    expect(hrefFor('INV-26-1093')).toBe('/money?focus=INV-26-1093');
  });
  it('leaves checks and transfers as plain chips', () => {
    expect(hrefFor('CHK-26-0912')).toBeNull();
    expect(hrefFor('TR-26-0512')).toBeNull();
    expect(hrefFor('not a code')).toBeNull();
  });
});

describe('formatting', () => {
  it('formats cents as dollars and enums as words', () => {
    expect(usd(650_000)).toBe('$6,500.00');
    expect(usd(null)).toBe('—');
    expect(label('HOLD_UNPAID')).toBe('hold unpaid');
  });
});

describe("dates read in the barn's time zone wherever they are rendered", () => {
  it('prints the same text for a server in UTC and a browser in Texas', () => {
    // 01:30 UTC on the 21st is still the evening of the 20th in the barn.
    expect(dateTime('2026-04-21T01:30:00.000Z')).toBe('Apr 20, 8:30 PM');
    expect(day('2026-04-21T01:30:00.000Z')).toBe('Apr 20');
    expect(dayLong('2026-04-21T01:30:00.000Z')).toBe('Mon, Apr 20, 2026');
    expect(barnDate('2026-04-21T01:30:00.000Z')).toBe('2026-04-20');
    expect(barnDate('2026-04-20')).toBe('2026-04-20');
    expect(dateTime(null)).toBe('—');
  });
});
