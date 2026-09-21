import { describe, expect, it } from 'vitest';
import { resolveArrival } from './arrival';

// 2026-04-20 is a Monday.
describe('resolveArrival', () => {
  it('reads today, tonight and tomorrow', () => {
    expect(resolveArrival('tonight', '2026-04-20')).toBe('2026-04-20');
    expect(resolveArrival('fedex tomorrow', '2026-04-20')).toBe('2026-04-21');
  });
  it('reads a weekday as the next such day, today included', () => {
    expect(resolveArrival('Tue by 1pm', '2026-04-20')).toBe('2026-04-21');
    expect(resolveArrival('Monday', '2026-04-20')).toBe('2026-04-20');
    expect(resolveArrival('thurs am', '2026-04-20')).toBe('2026-04-23');
  });
  it('refuses to guess', () => {
    expect(resolveArrival('coming counter to counter', '2026-04-20')).toBeNull();
    expect(resolveArrival(null, '2026-04-20')).toBeNull();
  });
});
