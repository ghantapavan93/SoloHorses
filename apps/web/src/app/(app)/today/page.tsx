import Link from 'next/link';
import { redirect } from 'next/navigation';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { StatusPill } from '@/components/ui/status-pill';
import { RecordCheckDialog } from '@/components/record/check-dialog';
import { ArrowRight } from 'lucide-react';
import { apiFetch, apiFetchOrNull } from '@/lib/api';
import { auth } from '@/lib/auth';
import { day, dateTime, hrefFor, label, usd } from '@/lib/format';
import { MorningBriefHero } from '@/components/operations/morning-brief';
import { cn } from '@/lib/utils';
import type { Brief, Daysheet, MorningBrief } from '@/lib/types';

export const metadata = { title: 'Today' };

const HOLD_LABEL: Record<string, string> = {
  CONTRACT_UNPAID: 'balance due',
  CONTRACT_UNSIGNED: 'not signed',
  CONTRACT_CLOSED: 'contract closed',
  NOT_A_COLLECTION_DAY: 'not a collection day',
  ORDERED_AFTER_CUTOFF: 'ordered after 5 PM cutoff',
  CANCELLED: 'cancelled',
};

const STATE_DOT: Record<string, string> = {
  blocked: 'bg-critical',
  due: 'bg-warn',
  watch: 'bg-muted-foreground/60',
  ready: 'bg-ok',
};

/**
 * The day, as a decision surface: what needs a person, one line to ask from, the three to open
 * first, the next things the rules see coming — and the full Day Sheet one click below, not
 * underneath. A person who wants the tables asks for them.
 */
export default async function DaysheetPage({
  searchParams,
}: {
  searchParams: Promise<{ date?: string; tab?: string; sheet?: string }>;
}) {
  const [{ date, tab, sheet: wantsSheet }, session] = await Promise.all([searchParams, auth()]);
  const role = session?.user.role ?? 'CUSTOMER';
  // A client's day is her own record — her embryos, her mare, her invoices — not the barn's counters.
  if (role === 'CUSTOMER' && session?.user.customerId)
    redirect(`/customers/${encodeURIComponent(session.user.customerId)}`);
  // The day leads with what needs a person; customers have no board to read.
  const [sheet, brief, lookahead] = await Promise.all([
    apiFetch<Daysheet>(`/daysheet${date ? `?date=${encodeURIComponent(date)}` : ''}`),
    role === 'CUSTOMER' ? Promise.resolve(null) : apiFetchOrNull<MorningBrief>('/operations/brief/morning'),
    role === 'CUSTOMER' ? Promise.resolve(null) : apiFetchOrNull<Brief>('/operations/brief'),
  ]);
  const showSheet = wantsSheet === '1' || tab !== undefined || date !== undefined || !brief;
  const canRecordChecks = role === 'VET' || role === 'ADMIN';
  const ship = sheet.collection.filter((r) => r.disposition === 'SHIP').length;
  const hold = sheet.collection.filter((r) => r.disposition === 'HOLD').length;
  const crossing = sheet.checksDue.filter((c) => c.crossesToday).length;
  const defaultTab =
    tab ?? (sheet.collection.length > 0 && role !== 'RECIPS' && role !== 'VET' ? 'collection' : 'transfer');
  const upNext = (lookahead?.lookahead ?? []).slice(0, 4);

  return (
    <div className="space-y-6">
      {brief ? <MorningBriefHero brief={brief} /> : null}

      {brief && upNext.length > 0 ? (
        <section aria-labelledby="up-next-heading">
          <p id="up-next-heading" className="eyebrow mb-1">
            Up next
          </p>
          <ol className="divide-y rounded-md border" data-testid="up-next">
            {upNext.map((item, i) => {
              const href = item.entityId ? hrefFor(item.entityId) : null;
              const row = (
                <>
                  <span
                    className={cn('size-1.5 shrink-0 rounded-full', STATE_DOT[item.state] ?? 'bg-muted-foreground/60')}
                    aria-hidden
                  />
                  <span className="w-[52px] shrink-0 text-[12px] text-muted-foreground">
                    {day(`${item.on}T12:00:00Z`)}
                  </span>
                  <span className="min-w-0 flex-1 truncate">{item.label}</span>
                  {item.entityId && !item.label.includes(item.entityId) ? (
                    <span className="code hidden text-[11px] text-muted-foreground sm:inline">{item.entityId}</span>
                  ) : null}
                  <span className="hidden readout text-muted-foreground md:inline">{item.state}</span>
                  {href ? <ArrowRight className="size-3.5 shrink-0 text-muted-foreground" aria-hidden /> : null}
                </>
              );
              const className = 'row flex items-center gap-3 px-3 py-2 text-[13px]';
              return (
                <li key={`${item.kind}-${item.entityId ?? i}`}>
                  {href ? (
                    <Link href={href} className={cn(className, 'hover:bg-muted/40')}>
                      {row}
                    </Link>
                  ) : (
                    <div className={className}>{row}</div>
                  )}
                </li>
              );
            })}
          </ol>
        </section>
      ) : null}

      {!showSheet ? (
        <p className="text-[12px]">
          <Link
            href="/today?sheet=1"
            className="inline-flex items-center gap-1 rounded-md border px-2.5 py-1.5 text-foreground hover:bg-muted"
            data-testid="view-day-sheet"
          >
            View full Day Sheet <ArrowRight className="size-3" aria-hidden />
          </Link>
          <span className="ml-2 text-muted-foreground">
            {sheet.isCollectionDay ? 'Collection day' : 'No collection today'}
            {sheet.isAspirationDay ? ' · aspiration Monday' : ''} · {sheet.collection.length} orders ·{' '}
            {sheet.checksDue.length} checks due
          </span>
        </p>
      ) : null}

      {showSheet ? (
        <>
          <div className="flex flex-wrap items-end justify-between gap-3 border-t pt-5">
            <div>
              <p className="eyebrow">Day Sheet</p>
              <h2 className="text-xl font-bold">
                {sheet.isCollectionDay ? 'Collection day' : 'No collection today'}
                {sheet.isAspirationDay ? ' · aspiration Monday' : ''}
              </h2>
            </div>
            <SiteCounters counters={sheet.counters} />
          </div>

          <Tabs defaultValue={defaultTab}>
            <TabsList>
              {role !== 'RECIPS' && role !== 'VET' && role !== 'CUSTOMER' ? (
                <TabsTrigger value="collection">
                  Collection <Count n={sheet.collection.length} />
                </TabsTrigger>
              ) : null}
              <TabsTrigger value="transfer">
                Transfer <Count n={sheet.transfers.length + sheet.checksDue.length} />
              </TabsTrigger>
              {sheet.labDue.length > 0 ? (
                <TabsTrigger value="lab">
                  Lab <Count n={sheet.labDue.length} />
                </TabsTrigger>
              ) : null}
            </TabsList>

            <TabsContent value="collection" className="space-y-3">
              <p className="text-[13px] text-muted-foreground">
                {sheet.collectionDay
                  ? `Orders for ${day(`${sheet.collectionDay}T12:00:00Z`)}`
                  : 'No upcoming collection day'}{' '}
                · {ship} ship · {hold} hold
              </p>
              <div className="overflow-x-auto rounded-md border">
                <table className="w-full text-[13px]">
                  <thead className="bg-muted/60 text-left text-[11px] uppercase tracking-wider text-muted-foreground">
                    <tr>
                      <th className="px-3 py-2 font-medium">Disposition</th>
                      <th className="px-3 py-2 font-medium">Mare</th>
                      <th className="px-3 py-2 font-medium">Stallion</th>
                      <th className="px-3 py-2 font-medium">Customer</th>
                      <th className="px-3 py-2 font-medium">Ship to</th>
                      <th className="px-3 py-2 font-medium">Placed</th>
                      <th className="px-3 py-2 text-right font-medium">Balance</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y">
                    {sheet.collection.map((r) => (
                      <tr key={r.orderId} className="h-9 hover:bg-muted/40">
                        <td className="px-3 py-1.5">
                          <div className="flex flex-wrap items-center gap-1.5">
                            <StatusPill
                              tone={r.disposition === 'SHIP' ? 'ok' : r.disposition === 'HOLD' ? 'warn' : 'neutral'}
                            >
                              {r.disposition}
                            </StatusPill>
                            {r.holds
                              .filter((h) => h !== 'CANCELLED')
                              .map((h) => (
                                <span key={h} className="text-[11px] text-muted-foreground">
                                  {HOLD_LABEL[h] ?? label(h)}
                                </span>
                              ))}
                          </div>
                        </td>
                        <td className="px-3 py-1.5">
                          <Link className="horse-name hover:underline" href={`/horses/${r.mareId}`}>
                            {r.mare}
                          </Link>
                        </td>
                        <td className="px-3 py-1.5">
                          <Link className="hover:underline" href={`/horses/${r.stallionId}`}>
                            {r.stallion}
                          </Link>
                        </td>
                        <td className="px-3 py-1.5">
                          <Link className="hover:underline" href={`/customers/${r.customerId}`}>
                            {r.customer}
                          </Link>
                          <span className="code ml-2 text-muted-foreground">
                            <Link href={`/contracts/${r.contractId}`}>{r.contractId}</Link>
                          </span>
                        </td>
                        <td className="px-3 py-1.5 text-muted-foreground">
                          {r.shipTo} · {r.container}
                        </td>
                        <td className="px-3 py-1.5 text-muted-foreground">{dateTime(r.placedAt)}</td>
                        <td className="money px-3 py-1.5 text-right">
                          {r.balanceCents === null ? (
                            ''
                          ) : r.balanceCents > 0 ? (
                            <span className="text-warn">{usd(r.balanceCents)}</span>
                          ) : (
                            '—'
                          )}
                        </td>
                      </tr>
                    ))}
                    {sheet.collection.length === 0 ? (
                      <tr>
                        <td colSpan={7} className="px-3 py-8 text-center text-muted-foreground">
                          No orders.
                        </td>
                      </tr>
                    ) : null}
                  </tbody>
                </table>
              </div>
            </TabsContent>

            <TabsContent value="transfer" className="space-y-5">
              <section className="space-y-2">
                <h2 className="text-[13px] font-semibold">
                  Checks due{' '}
                  {crossing > 0 ? (
                    <span className="ml-1 font-normal text-muted-foreground">
                      · {crossing} crossing a billing milestone today
                    </span>
                  ) : null}
                </h2>
                <div className="overflow-x-auto rounded-md border">
                  <table className="w-full text-[13px]">
                    <thead className="bg-muted/60 text-left text-[11px] uppercase tracking-wider text-muted-foreground">
                      <tr>
                        <th className="px-3 py-2 font-medium">Recip</th>
                        <th className="px-3 py-2 font-medium">Embryo</th>
                        <th className="px-3 py-2 font-medium">Owner</th>
                        <th className="px-3 py-2 text-right font-medium">Day</th>
                        <th className="px-3 py-2 font-medium">Last check</th>
                        <th className="px-3 py-2 font-medium">Milestone</th>
                        {canRecordChecks ? <th className="px-3 py-2" /> : null}
                      </tr>
                    </thead>
                    <tbody className="divide-y">
                      {sheet.checksDue.map((c) => (
                        <tr key={c.transferId} className="h-9 hover:bg-muted/40">
                          <td className="px-3 py-1.5">
                            <Link className="horse-name hover:underline" href={`/horses/${c.recipId}`}>
                              Recip #{c.recipNumber ?? '?'}
                            </Link>
                          </td>
                          <td className="code px-3 py-1.5">
                            <Link className="hover:underline" href={`/embryos/${c.embryoId}`}>
                              {c.embryoId}
                            </Link>
                          </td>
                          <td className="px-3 py-1.5">
                            <Link className="hover:underline" href={`/customers/${c.customerId}`}>
                              {c.customer}
                            </Link>
                          </td>
                          <td className="px-3 py-1.5 text-right tabular-nums">{c.gestationDay}</td>
                          <td className="px-3 py-1.5 text-muted-foreground">
                            {c.lastCheck
                              ? `day ${c.lastCheck.day} · ${label(c.lastCheck.result)} · ${day(`${c.lastCheck.on}T12:00:00Z`)}`
                              : 'none yet'}
                          </td>
                          <td className="px-3 py-1.5">
                            {c.crossesToday === 'HEARTBEAT' ? (
                              <StatusPill tone="warn">day 24 · lease fee invoices on heartbeat</StatusPill>
                            ) : c.crossesToday === 'ICSI_FEE_WINDOW' ? (
                              <StatusPill tone="warn">day 45 · ICSI stallion fee</StatusPill>
                            ) : c.crossesToday === 'PURCHASE_CONFIRM' ? (
                              <StatusPill tone="neutral">day 55 · confirms purchase</StatusPill>
                            ) : (
                              <span className="text-muted-foreground">next at day {c.nextMilestone ?? '—'}</span>
                            )}
                          </td>
                          {canRecordChecks ? (
                            <td className="px-3 py-1.5 text-right">
                              <RecordCheckDialog
                                transferId={c.transferId}
                                embryoId={c.embryoId}
                                gestationDay={c.gestationDay}
                                recipLabel={`Recip #${c.recipNumber ?? '?'}`}
                              />
                            </td>
                          ) : null}
                        </tr>
                      ))}
                      {sheet.checksDue.length === 0 ? (
                        <tr>
                          <td colSpan={7} className="px-3 py-6 text-center text-muted-foreground">
                            Nothing due.
                          </td>
                        </tr>
                      ) : null}
                    </tbody>
                  </table>
                </div>
              </section>

              <section className="space-y-2">
                <h2 className="text-[13px] font-semibold">Embryos expected or waiting for a recip</h2>
                <div className="overflow-x-auto rounded-md border">
                  <table className="w-full text-[13px]">
                    <thead className="bg-muted/60 text-left text-[11px] uppercase tracking-wider text-muted-foreground">
                      <tr>
                        <th className="px-3 py-2 font-medium">Embryo</th>
                        <th className="px-3 py-2 font-medium">Cross</th>
                        <th className="px-3 py-2 font-medium">Owner</th>
                        <th className="px-3 py-2 font-medium">Status</th>
                        <th className="px-3 py-2 font-medium">Expected</th>
                        <th className="px-3 py-2 font-medium">Storage</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y">
                      {sheet.transfers.map((t) => (
                        <tr key={t.embryoId} className="h-9 hover:bg-muted/40">
                          <td className="code px-3 py-1.5">
                            <Link className="hover:underline" href={`/embryos/${t.embryoId}`}>
                              {t.embryoId}
                            </Link>
                          </td>
                          <td className="px-3 py-1.5">{t.cross}</td>
                          <td className="px-3 py-1.5">
                            <Link className="hover:underline" href={`/customers/${t.customerId}`}>
                              {t.customer}
                            </Link>
                          </td>
                          <td className="px-3 py-1.5">
                            <StatusPill tone={t.status === 'ARRIVED' ? 'ok' : 'neutral'}>{label(t.status)}</StatusPill>
                          </td>
                          <td className="px-3 py-1.5 text-muted-foreground">
                            {t.expectedOn
                              ? dateTime(t.expectedOn)
                              : t.arrivedAt
                                ? `arrived ${dateTime(t.arrivedAt)}`
                                : '—'}
                          </td>
                          <td className="code px-3 py-1.5 text-muted-foreground">{t.storage ?? '—'}</td>
                        </tr>
                      ))}
                      {sheet.transfers.length === 0 ? (
                        <tr>
                          <td colSpan={6} className="px-3 py-6 text-center text-muted-foreground">
                            Nothing inbound.
                          </td>
                        </tr>
                      ) : null}
                    </tbody>
                  </table>
                </div>
              </section>
            </TabsContent>

            <TabsContent value="lab" className="space-y-2">
              <p className="text-[13px] text-muted-foreground">
                Oocytes at the outside ICSI lab. Counts come back day 7–10; the farm sets up recips before the number is
                known.
              </p>
              <div className="overflow-x-auto rounded-md border">
                <table className="w-full text-[13px]">
                  <thead className="bg-muted/60 text-left text-[11px] uppercase tracking-wider text-muted-foreground">
                    <tr>
                      <th className="px-3 py-2 font-medium">Batch</th>
                      <th className="px-3 py-2 font-medium">Donor</th>
                      <th className="px-3 py-2 font-medium">Shipped</th>
                      <th className="px-3 py-2 font-medium">Expected</th>
                      <th className="px-3 py-2 text-right font-medium">Days out</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y">
                    {sheet.labDue.map((l) => (
                      <tr key={l.labBatchId} className="h-9">
                        <td className="code px-3 py-1.5">{l.labBatchId}</td>
                        <td className="px-3 py-1.5">
                          <Link className="horse-name hover:underline" href={`/horses/${l.donorId}`}>
                            {l.donor}
                          </Link>
                        </td>
                        <td className="px-3 py-1.5 text-muted-foreground">{day(`${l.shippedOn}T12:00:00Z`)}</td>
                        <td className="px-3 py-1.5 text-muted-foreground">{day(`${l.expectedResultOn}T12:00:00Z`)}</td>
                        <td className="px-3 py-1.5 text-right tabular-nums">
                          {l.daysOut > 10 ? <span className="text-warn">{l.daysOut}</span> : l.daysOut}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </TabsContent>
          </Tabs>
        </>
      ) : null}
    </div>
  );
}

/** The brief in one line: the board, its dollars, the day's delta and the next two days, each read now; the whole thing opens Operations. */
function Count({ n }: { n: number }) {
  return <span className="ml-1.5 rounded-sm bg-muted px-1.5 text-[11px] tabular-nums text-muted-foreground">{n}</span>;
}

function SiteCounters({ counters }: { counters: Daysheet['counters'] }) {
  const cells = [
    {
      label: 'South',
      items: [
        [counters.south.stallions, 'stallions'],
        [counters.south.ordersOnHold, 'on hold'],
        [counters.south.labBatchesOut, 'at lab'],
      ],
    },
    { label: 'North', items: [[counters.north.donorsOnSite, 'donors on site']] },
    {
      label: 'Recip Farm',
      items: [
        [counters.recipFarm.setUp, 'set up'],
        [counters.recipFarm.carrying, 'carrying'],
        [counters.recipFarm.embryosExpected, 'expected'],
      ],
    },
  ] as const;
  return (
    <div className="flex flex-wrap gap-2">
      {cells.map((c) => (
        <div key={c.label} className="rounded-md border px-3 py-2">
          <p className="eyebrow">{c.label}</p>
          <div className="mt-1 flex gap-4">
            {c.items.map(([n, l]) => (
              <div key={l}>
                <span className="text-[15px] font-semibold tabular-nums">{n}</span>{' '}
                <span className="text-[11px] text-muted-foreground">{l}</span>
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}
