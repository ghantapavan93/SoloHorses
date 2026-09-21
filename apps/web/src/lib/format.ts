import { format, formatDistanceToNowStrict, parseISO } from 'date-fns';

export function usd(cents: number | null | undefined): string {
  if (cents === null || cents === undefined) return '—';
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 2 }).format(
    cents / 100,
  );
}

export function day(iso: string | null | undefined): string {
  if (!iso) return '—';
  return format(parseISO(iso), 'MMM d');
}

export function dayLong(iso: string | null | undefined): string {
  if (!iso) return '—';
  return format(parseISO(iso), 'EEE, MMM d, yyyy');
}

export function dateTime(iso: string | null | undefined): string {
  if (!iso) return '—';
  return format(parseISO(iso), 'MMM d, h:mm a');
}

export function ago(iso: string | null | undefined): string {
  if (!iso) return '—';
  return formatDistanceToNowStrict(parseISO(iso), { addSuffix: true });
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
