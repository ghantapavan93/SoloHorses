import Link from 'next/link';
import { Fragment } from 'react';
import { Check, CircleDashed, X } from 'lucide-react';
import { dateTime, day, label, usd } from '@/lib/format';
import type { IntegrityTimelineRow, InvoiceIntegrityRow } from '@/lib/types';
import { cn } from '@/lib/utils';

/**
 * Money integrity, the way an accountant reads it: one invoice, three systems with an
 * opinion, one mark each, then every step in order with its source and its timestamp.
 * No chart. No card per number. Precision is the design.
 */
function Mark({ ok }: { ok: boolean | null }) {
  if (ok === true) return <Check className="size-3.5 text-ok" aria-label="agrees" />;
  if (ok === false) return <X className="size-3.5 text-critical" aria-label="disagrees" />;
  return <CircleDashed className="size-3.5 text-muted-foreground" aria-label="pending" />;
}

const SOURCE_LABEL: Record<IntegrityTimelineRow['source'], string> = {
  daysheet: 'daysheet',
  stripe: 'stripe',
  quickbooks: 'quickbooks',
  queue: 'queue',
};

export function InvoiceIntegrityTable({ rows, focus }: { rows: InvoiceIntegrityRow[]; focus: string | null }) {
  return (
    <div className="overflow-x-auto rounded-md border">
      <table className="w-full text-[13px]">
        <thead className="text-left text-[10.5px] uppercase tracking-[0.14em] text-muted-foreground">
          <tr className="border-b">
            <th className="px-3 py-2 font-medium">Invoice</th>
            <th className="px-3 py-2 font-medium">Customer</th>
            <th className="px-3 py-2 text-right font-medium">Amount</th>
            <th className="px-3 py-2 font-medium">Daysheet</th>
            <th className="px-3 py-2 font-medium">Stripe</th>
            <th className="px-3 py-2 font-medium">Books</th>
            <th className="px-3 py-2 font-medium">Issued</th>
          </tr>
        </thead>
        <tbody className="divide-y">
          {rows.map((r) => (
            <tr key={r.id} id={r.id} className={cn('row h-9', focus === r.id && 'bg-brand-tint')}>
              <td className="px-3 py-1.5">
                <Link href={`/money?focus=${r.id}`} className="code underline-offset-2 hover:underline">
                  {r.id}
                </Link>
                <span className="ml-2 text-[11px] text-muted-foreground">{label(r.kind)}</span>
              </td>
              <td className="px-3 py-1.5">{r.customer.name}</td>
              <td className="money px-3 py-1.5 text-right">{usd(r.amountCents)}</td>
              <td className="px-3 py-1.5">
                <Side ok={r.daysheet.ok} status={r.daysheet.status} />
              </td>
              <td className="px-3 py-1.5">
                <Side
                  ok={r.stripe.ok}
                  status={r.stripe.status}
                  note={r.stripe.duplicates > 0 ? `${r.stripe.duplicates} dup` : null}
                />
              </td>
              <td className="px-3 py-1.5">
                <Side
                  ok={r.books.ok}
                  status={r.books.status}
                  note={r.openDiscrepancies > 0 ? `${r.openDiscrepancies} open` : null}
                />
              </td>
              <td className="px-3 py-1.5 text-muted-foreground">{day(r.issuedOn)}</td>
            </tr>
          ))}
          {rows.length === 0 ? (
            <tr>
              <td colSpan={7} className="px-3 py-6 text-center text-muted-foreground">
                No invoices.
              </td>
            </tr>
          ) : null}
        </tbody>
      </table>
    </div>
  );
}

function Side({ ok, status, note }: { ok: boolean | null; status: string; note?: string | null }) {
  return (
    <span className="inline-flex items-center gap-1.5">
      <Mark ok={ok} />
      <span
        className={cn(
          'readout',
          ok === false ? 'text-critical' : ok === true ? 'text-foreground' : 'text-muted-foreground',
        )}
      >
        {status === 'NONE' ? '—' : status.toLowerCase()}
      </span>
      {note ? <span className="text-[11px] text-warn">{note}</span> : null}
    </span>
  );
}

/** The three systems in the order the money moves: Stripe hears of it, the ledger records it, the books carry it. */
type Station = {
  name: string;
  sub: string;
  side: { status: string; ok: boolean | null; note: string | null };
  extra: string | null;
};

/** The line between two stations: solid when both agree, red when either disagrees, dashed while one is still pending. */
function joint(a: Station, b: Station): string {
  if (a.side.ok === false || b.side.ok === false) return 'bg-critical';
  if (a.side.ok === true && b.side.ok === true) return 'bg-ok/70';
  return 'border-t border-dashed border-muted-foreground/60 bg-transparent';
}

export function InvoiceIntegrityPanel({
  row,
  timeline,
}: {
  row: InvoiceIntegrityRow;
  timeline: IntegrityTimelineRow[];
}) {
  const stations: Station[] = [
    {
      name: 'stripe',
      sub: 'the processor',
      side: row.stripe,
      extra: row.stripe.eventId
        ? `${row.stripe.eventId} · ${row.stripe.deliveries} deliver${row.stripe.deliveries === 1 ? 'y' : 'ies'}${row.stripe.duplicates > 0 ? ` · ${row.stripe.duplicates} rejected as duplicate` : ''}`
        : null,
    },
    { name: 'daysheet', sub: 'the ledger', side: row.daysheet, extra: null },
    {
      name: 'quickbooks',
      sub: 'the books',
      side: row.books,
      extra:
        [
          row.books.invoice ? `invoice ${row.books.invoice.toLowerCase()}` : null,
          row.books.payment ? `payment ${row.books.payment.toLowerCase()}` : null,
        ]
          .filter(Boolean)
          .join(' · ') || null,
    },
  ];
  return (
    <section className="rounded-md border">
      <div className="border-b px-4 py-3">
        <p className="eyebrow">Invoice</p>
        <p className="mt-1 flex flex-wrap items-baseline gap-x-3">
          <span className="code text-[15px] font-medium">{row.id}</span>
          <span className="money text-[15px]">{usd(row.amountCents)}</span>
          <span className="text-[12px] text-muted-foreground">
            {label(row.kind)} · {row.customer.name}
            {row.embryoId ? (
              <>
                {' '}
                ·{' '}
                <Link href={`/embryos/${row.embryoId}`} className="code underline-offset-2 hover:underline">
                  {row.embryoId}
                </Link>
              </>
            ) : null}
          </span>
        </p>
        {/* The trail as a line: each system's word on this money, and whether the neighbours agree. */}
        <ol
          className="mt-3 grid items-start gap-y-2 md:grid-cols-[minmax(0,1fr)_40px_minmax(0,1fr)_40px_minmax(0,1fr)] md:gap-y-0"
          aria-label="The money trail, system by system"
          data-testid="money-trail-strip"
        >
          {stations.map((s, i) => (
            <Fragment key={s.name}>
              {i > 0 ? (
                <li className="hidden self-center md:block" aria-hidden>
                  <span className={cn('block h-px w-full', joint(stations[i - 1]!, s))} />
                </li>
              ) : null}
              <li
                className={cn(
                  'card-op px-3 py-2 text-[12px]',
                  s.side.ok === false && 'border-critical/50',
                  s.side.ok === null && s.side.status !== 'NONE' && 'border-warn/50',
                )}
                data-state={s.side.ok === false ? 'disagrees' : s.side.ok === null ? 'pending' : 'agrees'}
              >
                <p className="flex items-center justify-between gap-2">
                  <span className="readout text-muted-foreground">
                    {s.name} <span className="normal-case tracking-normal">· {s.sub}</span>
                  </span>
                  <Mark ok={s.side.ok} />
                </p>
                <p className={cn('mt-0.5 readout', s.side.ok === false ? 'text-critical' : 'text-foreground')}>
                  {s.side.status === 'NONE' ? '—' : s.side.status.toLowerCase()}
                </p>
                {s.extra ? (
                  <p className="mt-0.5 truncate text-[11px] text-muted-foreground" title={s.extra}>
                    {s.extra}
                  </p>
                ) : null}
                {s.side.note ? <p className="mt-0.5 text-[11px] text-warn">{s.side.note}</p> : null}
              </li>
            </Fragment>
          ))}
        </ol>
      </div>
      <ol className="divide-y">
        {timeline.map((t, i) => (
          <li
            key={`${t.at}-${i}`}
            className="grid grid-cols-[150px_84px_1fr] items-baseline gap-3 px-4 py-1.5 text-[12px]"
          >
            <span className="code text-muted-foreground">{dateTime(t.at)}</span>
            <span
              className={cn(
                'readout',
                t.source === 'stripe' ? 'text-brand' : t.source === 'quickbooks' ? 'text-ok' : 'text-muted-foreground',
              )}
            >
              {SOURCE_LABEL[t.source]}
            </span>
            <span className="min-w-0">
              <span className={cn(t.ok === false && 'text-critical')}>{t.title}</span>
              {t.detail ? <span className="ml-2 text-muted-foreground">{t.detail}</span> : null}
              {t.correlationId ? (
                <span className="code ml-2 text-[10px] text-muted-foreground">{t.correlationId}</span>
              ) : null}
            </span>
          </li>
        ))}
        {timeline.length === 0 ? (
          <li className="px-4 py-4 text-center text-[12px] text-muted-foreground">
            Nothing has happened to this invoice yet.
          </li>
        ) : null}
      </ol>
    </section>
  );
}
