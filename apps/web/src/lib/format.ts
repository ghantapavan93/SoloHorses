import { formatDistanceToNowStrict, parseISO } from 'date-fns';

/**
 * The barn's clock. Every date on a screen reads in the operation's own time zone wherever the
 * page happens to be rendered — a server in another region and the browser in front of a person
 * must print the same text, or React finds the two disagreeing at hydration.
 */
export const BARN_TIME_ZONE = 'America/Chicago';

const inBarnTime = (options: Intl.DateTimeFormatOptions) =>
  new Intl.DateTimeFormat('en-US', { timeZone: BARN_TIME_ZONE, ...options });
const DAY = inBarnTime({ month: 'short', day: 'numeric' });
const DAY_LONG = inBarnTime({ weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' });
const DATE_TIME = inBarnTime({ month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
const BARN_DATE = new Intl.DateTimeFormat('en-CA', {
  timeZone: BARN_TIME_ZONE,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
});
/** Newer ICU puts a narrow no-break space before AM/PM; a plain space reads the same and diffs the same everywhere. */
const plain = (text: string) => text.replace(/ /g, ' ');

/**
 * A barn date (`YYYY-MM-DD`) names a calendar day, not an instant. Parsed as local midnight it
 * would land on the evening before in the barn's zone wherever the process runs east of it —
 * Vercel's UTC server printed Apr 19 for the 20th and the browser disagreed at hydration. Noon
 * UTC on that day is the same calendar day in the barn, whatever the clock.
 */
const instant = (iso: string): Date =>
  /^\d{4}-\d{2}-\d{2}$/.test(iso) ? new Date(`${iso}T12:00:00.000Z`) : parseISO(iso);

export function usd(cents: number | null | undefined): string {
  if (cents === null || cents === undefined) return '—';
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 2 }).format(
    cents / 100,
  );
}

export function day(iso: string | null | undefined): string {
  if (!iso) return '—';
  return plain(DAY.format(instant(iso)));
}

export function dayLong(iso: string | null | undefined): string {
  if (!iso) return '—';
  return plain(DAY_LONG.format(instant(iso)));
}

export function dateTime(iso: string | null | undefined): string {
  if (!iso) return '—';
  return plain(DATE_TIME.format(instant(iso)));
}

/** The barn's calendar date for an instant, `YYYY-MM-DD`: the day the operation would write on the record. */
export function barnDate(iso: string): string {
  return BARN_DATE.format(instant(iso));
}

export function ago(iso: string | null | undefined): string {
  if (!iso) return '—';
  return formatDistanceToNowStrict(instant(iso), { addSuffix: true });
}

export function label(value: string | null | undefined): string {
  if (!value) return '—';
  return value.toLowerCase().replace(/_/g, ' ');
}

/** Where a record code lives in the UI. */
export function hrefFor(id: string): string | null {
  if (/^E-\d{2}-\d{4,}$/.test(id)) return `/embryos/${id}`;
  if (/^SS-\d{2}-\d{4,}$/.test(id)) return `/contracts/${id}`;
  if (/^(H|R)-\d{4,}$/.test(id)) return `/horses/${id}`;
  if (/^C-\d{4,}$/.test(id)) return `/customers/${id}`;
  if (/^INV-\d{2}-\d{4,}$/.test(id)) return `/money?focus=${id}`;
  if (/^PAY-\d{2}-\d{4,}$/.test(id)) return `/money?focus=${id}`;
  if (/^RQ-\d{2}-\d{4,}$/.test(id)) return '/operations?tab=requests';
  if (/^DEC-\d{2}-\d{4,}$/.test(id)) return `/decisions/${id}`;
  if (/^(TR|CHK)-\d{2}-\d{4,}$/.test(id)) return null;
  return null;
}
