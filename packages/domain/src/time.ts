/**
 * Barn time. The operation runs on Central Time; the database stores UTC.
 * Everything that depends on "which day is it" goes through here so the cutoff rules
 * (order by 5 PM the day before, cancel by 8 AM the day of) are testable and unambiguous.
 *
 * Intl is used instead of a date library to keep this package dependency-free.
 */

export const BARN_TIME_ZONE = 'America/Chicago';

/** ISO calendar date, e.g. "2026-03-14". */
export type BarnDate = string;

const dateFormatter = new Intl.DateTimeFormat('en-CA', {
  timeZone: BARN_TIME_ZONE,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
});

const partsFormatter = new Intl.DateTimeFormat('en-US', {
  timeZone: BARN_TIME_ZONE,
  hour12: false,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
});

/** The calendar date at the barn for a UTC instant. */
export function barnDate(instant: Date): BarnDate {
  return dateFormatter.format(instant);
}

export interface BarnClock {
  date: BarnDate;
  hour: number;
  minute: number;
  weekday: number; // 0 = Sunday
}

export function barnClock(instant: Date): BarnClock {
  const parts = Object.fromEntries(partsFormatter.formatToParts(instant).map((p) => [p.type, p.value])) as Record<
    string,
    string
  >;
  const date = `${parts.year}-${parts.month}-${parts.day}`;
  // Intl renders midnight as "24" in some engines under hour12:false.
  const hour = Number(parts.hour) % 24;
  return { date, hour, minute: Number(parts.minute), weekday: weekdayOf(date) };
}

/** Day of week for an ISO date, computed in UTC to avoid local-zone drift. */
export function weekdayOf(date: BarnDate): number {
  const [y, m, d] = date.split('-').map(Number);
  return new Date(Date.UTC(y ?? 1970, (m ?? 1) - 1, d ?? 1)).getUTCDay();
}

export function addDays(date: BarnDate, days: number): BarnDate {
  const [y, m, d] = date.split('-').map(Number);
  const next = new Date(Date.UTC(y ?? 1970, (m ?? 1) - 1, (d ?? 1) + days));
  return next.toISOString().slice(0, 10);
}

export function daysBetween(from: BarnDate, to: BarnDate): number {
  const [fy, fm, fd] = from.split('-').map(Number);
  const [ty, tm, td] = to.split('-').map(Number);
  const a = Date.UTC(fy ?? 1970, (fm ?? 1) - 1, fd ?? 1);
  const b = Date.UTC(ty ?? 1970, (tm ?? 1) - 1, td ?? 1);
  return Math.round((b - a) / 86_400_000);
}

/**
 * Convert a barn-local wall time to a UTC instant. Handles DST by probing the offset at the
 * target date (Central is UTC-6 or UTC-5; we pick the one Intl agrees with).
 */
export function barnLocalToUtc(date: BarnDate, hour: number, minute = 0): Date {
  const [y, m, d] = date.split('-').map(Number);
  for (const offsetHours of [5, 6]) {
    const candidate = new Date(Date.UTC(y ?? 1970, (m ?? 1) - 1, d ?? 1, hour + offsetHours, minute));
    const back = barnClock(candidate);
    if (back.date === date && back.hour === hour && back.minute === minute) return candidate;
  }
  // Wall time does not exist (spring-forward gap); fall back to the later offset.
  return new Date(Date.UTC(y ?? 1970, (m ?? 1) - 1, d ?? 1, hour + 5, minute));
}

export function isMonday(date: BarnDate): boolean {
  return weekdayOf(date) === 1;
}

/** Breeding season boundaries the public site states. Month is 1-based. */
export const SEASON = {
  collectionStart: { month: 2, day: 1 },
  collectionEnd: { month: 7, day: 31 },
  transferStart: { month: 2, day: 1 },
  transferEnd: { month: 7, day: 15 },
  recipReturnDeadline: { month: 12, day: 1 },
} as const;

function withinWindow(
  date: BarnDate,
  start: { month: number; day: number },
  end: { month: number; day: number },
): boolean {
  const [, m, d] = date.split('-').map(Number);
  const key = (m ?? 0) * 100 + (d ?? 0);
  return key >= start.month * 100 + start.day && key <= end.month * 100 + end.day;
}

export function isInCollectionSeason(date: BarnDate): boolean {
  return withinWindow(date, SEASON.collectionStart, SEASON.collectionEnd);
}

export function isInTransferWindow(date: BarnDate): boolean {
  return withinWindow(date, SEASON.transferStart, SEASON.transferEnd);
}

/**
 * Collections happen every other day in season. Which parity is a scheduling choice made each
 * season; we anchor on Feb 1 of the season year so the rule is deterministic and inspectable.
 */
export function isCollectionDay(date: BarnDate): boolean {
  if (!isInCollectionSeason(date)) return false;
  const [y] = date.split('-').map(Number);
  const anchor: BarnDate = `${y}-02-01`;
  return daysBetween(anchor, date) % 2 === 0;
}

export function nextCollectionDay(from: BarnDate): BarnDate | null {
  let candidate = addDays(from, 1);
  for (let i = 0; i < 366; i += 1) {
    if (isCollectionDay(candidate)) return candidate;
    candidate = addDays(candidate, 1);
  }
  return null;
}

export function seasonYearOf(date: BarnDate): number {
  return Number(date.slice(0, 4));
}
