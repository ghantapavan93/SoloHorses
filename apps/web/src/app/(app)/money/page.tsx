import { MoneyControls } from '@/components/money/money-controls';
import { can } from '@daysheet/domain';
import { NotForRole } from '@/components/shell/not-for-role';
import { currentActor } from '@/lib/actor';
import { DiscrepancyList } from '@/components/money/discrepancy-list';
import { InvoiceIntegrityPanel, InvoiceIntegrityTable } from '@/components/money/invoice-integrity';
import { FocusLive } from '@/components/record/focus-live';
import { StatusPill, toneForStatus } from '@/components/ui/status-pill';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { apiFetch, apiFetchOrNull } from '@/lib/api';
import { dateTime, label, usd } from '@/lib/format';
import type {
  AccountingMapping,
  Discrepancy,
  IntegrationEvent,
  IntegrityTimelineRow,
  InvoiceIntegrityRow,
  MoneySummary,
  Payment,
  SimulatorRecord,
} from '@/lib/types';

export const metadata = { title: 'Money' };

export default async function MoneyPage({ searchParams }: { searchParams: Promise<{ focus?: string }> }) {
  const actor = await currentActor();
  if (!can(actor, 'read', 'accounting')) return <NotForRole page="Money" role={actor.role} />;
  const { focus } = await searchParams;
  const [summary, mappings, discrepancies, events, payments, books, invoices] = await Promise.all([
    apiFetch<MoneySummary>('/money/summary'),
    apiFetch<AccountingMapping[]>('/money/mappings'),
    apiFetch<Discrepancy[]>('/money/discrepancies?all=true'),
    apiFetch<IntegrationEvent[]>('/integrations/events?provider=STRIPE'),
    apiFetch<Payment[]>('/payments'),
    apiFetch<SimulatorRecord[]>('/money/books'),
    apiFetch<InvoiceIntegrityRow[]>('/money/integrity'),
  ]);
  // A payment code in ?focus= opens its invoice; the integrity view is always per invoice.
  const focusedInvoiceId = focus
    ? focus.startsWith('PAY-')
      ? (payments.find((p) => p.id === focus)?.invoiceId ?? null)
      : focus
    : null;
  const focused = focusedInvoiceId
    ? await apiFetchOrNull<{ row: InvoiceIntegrityRow; timeline: IntegrityTimelineRow[] }>(
        `/money/integrity/${focusedInvoiceId}`,
      )
    : null;
  const open = discrepancies.filter((d) => !d.resolvedAt);
  const counts = (type: string) =>
    Object.fromEntries(summary.byStatus.filter((b) => b.entityType === type).map((b) => [b.status, b._count._all]));
  const inv = counts('INVOICE');
  const pay = counts('PAYMENT');

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="eyebrow">Billing · {summary.provider.label}</p>
          <h1 className="text-2xl font-bold">Money</h1>
          <p className="mt-1 text-[12px] text-muted-foreground">
            Payment events originate in Stripe; the books reconcile to them. Where they disagree, a person decides.
          </p>
        </div>
        <MoneyControls simulated={summary.provider.mode === 'simulated'} jobsMode={summary.jobsMode} />
      </div>

      <dl className="flex flex-wrap items-baseline gap-x-6 gap-y-1 border-y py-2 text-[12px]">
        <Stat label="open discrepancies" value={String(open.length)} tone={open.length > 0 ? 'warn' : 'ok'} />
        <Stat
          label="invoices in the books"
          value={`${inv['SYNCED'] ?? 0} / ${Object.values(inv).reduce((a, b) => a + b, 0)}`}
          sub={`${inv['PENDING'] ?? 0} pending · ${inv['MISMATCH'] ?? 0} mismatch · ${inv['FAILED'] ?? 0} failed`}
        />
        <Stat
          label="payments in the books"
          value={`${pay['SYNCED'] ?? 0} / ${Object.values(pay).reduce((a, b) => a + b, 0)}`}
          sub={`${pay['PENDING'] ?? 0} pending · ${pay['MISMATCH'] ?? 0} mismatch`}
        />
        <Stat
          label="jobs"
          value={summary.jobsMode === 'redis' ? 'BullMQ on Redis' : 'inline'}
          sub={
            summary.jobsMode === 'redis'
              ? 'retries with backoff, rate-limited'
              : 'no Redis reachable — same handlers, same retries, in-process'
          }
        />
      </dl>

      {focused ? (
        <FocusLive id="trail" focused about={[focused.row.id]} className="p-0">
          <InvoiceIntegrityPanel row={focused.row} timeline={focused.timeline} />
        </FocusLive>
      ) : null}

      <Tabs defaultValue={focused ? 'invoices' : open.length > 0 ? 'discrepancies' : 'invoices'}>
        <TabsList>
          <TabsTrigger value="invoices">
            Invoices <Count n={invoices.length} />
          </TabsTrigger>
          <TabsTrigger value="discrepancies">
            Discrepancies <Count n={open.length} />
          </TabsTrigger>
          <TabsTrigger value="payments">
            Payments <Count n={payments.length} />
          </TabsTrigger>
          <TabsTrigger value="sync">
            Sync log <Count n={mappings.length} />
          </TabsTrigger>
          <TabsTrigger value="events">
            Stripe events <Count n={events.length} />
          </TabsTrigger>
          {books.length > 0 ? (
            <TabsTrigger value="books">
              Books (simulated) <Count n={books.length} />
            </TabsTrigger>
          ) : null}
        </TabsList>

        <TabsContent value="invoices">
          <InvoiceIntegrityTable rows={invoices} focus={focusedInvoiceId} />
        </TabsContent>

        <TabsContent value="discrepancies">
          <DiscrepancyList rows={discrepancies} />
        </TabsContent>

        <TabsContent value="payments">
          <div className="overflow-x-auto rounded-md border">
            <table className="w-full text-[13px]">
              <thead className="bg-muted/60 text-left text-[11px] uppercase tracking-wider text-muted-foreground">
                <tr>
                  <th className="px-3 py-2 font-medium">Payment</th>
                  <th className="px-3 py-2 font-medium">Invoice</th>
                  <th className="px-3 py-2 font-medium">Customer</th>
                  <th className="px-3 py-2 font-medium">Method</th>
                  <th className="px-3 py-2 font-medium">Status</th>
                  <th className="px-3 py-2 text-right font-medium">Amount</th>
                  <th className="px-3 py-2 font-medium">Received</th>
                  <th className="px-3 py-2 font-medium">Stripe</th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {payments.map((p) => (
                  <tr
                    key={p.id}
                    className={`h-9 hover:bg-muted/40 ${focus === p.id || focus === p.invoiceId ? 'bg-brand-tint' : ''}`}
                    id={p.id}
                  >
                    <td className="code px-3 py-1.5">{p.id}</td>
                    <td className="code px-3 py-1.5">{p.invoiceId ?? '—'}</td>
                    <td className="px-3 py-1.5">{p.customer?.displayName ?? p.customerId}</td>
                    <td className="px-3 py-1.5 text-muted-foreground">{label(p.method)}</td>
                    <td className="px-3 py-1.5">
                      <StatusPill tone={toneForStatus(p.status)}>{label(p.status)}</StatusPill>
                      {p.failureReason ? (
                        <span className="ml-2 text-[11px] text-muted-foreground">{p.failureReason}</span>
                      ) : null}
                    </td>
                    <td className="money px-3 py-1.5 text-right">
                      {usd(p.amountCents)}
                      {p.refundedCents > 0 ? (
                        <span className="block text-[11px] text-muted-foreground">
                          −{usd(p.refundedCents)} refunded
                        </span>
                      ) : null}
                    </td>
                    <td className="px-3 py-1.5 text-muted-foreground">{dateTime(p.receivedAt)}</td>
                    <td className="code px-3 py-1.5 text-[11px] text-muted-foreground">
                      {p.stripePaymentIntentId ?? '—'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </TabsContent>

        <TabsContent value="sync">
          <div className="overflow-x-auto rounded-md border">
            <table className="w-full text-[13px]">
              <thead className="bg-muted/60 text-left text-[11px] uppercase tracking-wider text-muted-foreground">
                <tr>
                  <th className="px-3 py-2 font-medium">Entity</th>
                  <th className="px-3 py-2 font-medium">Status</th>
                  <th className="px-3 py-2 font-medium">Books id</th>
                  <th className="px-3 py-2 text-right font-medium">Attempts</th>
                  <th className="px-3 py-2 font-medium">Last error</th>
                  <th className="px-3 py-2 font-medium">Last synced</th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {mappings.map((m) => (
                  <tr key={m.id} className={`h-9 hover:bg-muted/40 ${focus === m.entityId ? 'bg-brand-tint' : ''}`}>
                    <td className="code px-3 py-1.5">
                      {m.entityType.toLowerCase()} · {m.entityId}
                    </td>
                    <td className="px-3 py-1.5">
                      <StatusPill tone={toneForStatus(m.status)}>{label(m.status)}</StatusPill>
                    </td>
                    <td className="code px-3 py-1.5 text-muted-foreground">
                      {m.externalId ?? '—'}
                      {m.syncToken ? ` · v${m.syncToken}` : ''}
                    </td>
                    <td className="px-3 py-1.5 text-right tabular-nums">{m.attempts}</td>
                    <td
                      className="max-w-[320px] truncate px-3 py-1.5 text-[12px] text-muted-foreground"
                      title={m.lastError ?? ''}
                    >
                      {m.lastError ?? '—'}
                      {m.syncAttempts?.[0]?.remoteRequestId ? (
                        <span className="code ml-1">tid {m.syncAttempts[0].remoteRequestId}</span>
                      ) : null}
                    </td>
                    <td className="px-3 py-1.5 text-muted-foreground">
                      {m.lastSyncedAt ? dateTime(m.lastSyncedAt) : '—'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </TabsContent>

        <TabsContent value="events">
          <p className="mb-2 text-[12px] text-muted-foreground">
            Write-once inbox: a redelivery counts, never applies.
          </p>
          <div className="overflow-x-auto rounded-md border">
            <table className="w-full text-[13px]">
              <thead className="bg-muted/60 text-left text-[11px] uppercase tracking-wider text-muted-foreground">
                <tr>
                  <th className="px-3 py-2 font-medium">Event</th>
                  <th className="px-3 py-2 font-medium">Type</th>
                  <th className="px-3 py-2 font-medium">Status</th>
                  <th className="px-3 py-2 font-medium">Received</th>
                  <th className="px-3 py-2 font-medium">Processed</th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {events.map((e) => (
                  <tr key={e.id} className="h-9 hover:bg-muted/40">
                    <td className="code px-3 py-1.5">
                      {e.externalId}
                      {e.payload?.simulated ? (
                        <span className="ml-1 text-[10px] uppercase text-muted-foreground">sim</span>
                      ) : null}
                    </td>
                    <td className="code px-3 py-1.5 text-muted-foreground">{e.type}</td>
                    <td className="px-3 py-1.5">
                      <StatusPill tone={toneForStatus(e.status)}>{label(e.status)}</StatusPill>
                      {e.error ? <span className="ml-2 text-[11px] text-critical">{e.error}</span> : null}
                    </td>
                    <td className="px-3 py-1.5 text-muted-foreground">{dateTime(e.receivedAt)}</td>
                    <td className="px-3 py-1.5 text-muted-foreground">
                      {e.processedAt ? dateTime(e.processedAt) : '—'}
                    </td>
                  </tr>
                ))}
                {events.length === 0 ? (
                  <tr>
                    <td colSpan={5} className="px-3 py-6 text-center text-muted-foreground">
                      No events yet. Simulate a payment on any open invoice.
                    </td>
                  </tr>
                ) : null}
              </tbody>
            </table>
          </div>
        </TabsContent>

        {books.length > 0 ? (
          <TabsContent value="books">
            <p className="mb-2 text-[12px] text-muted-foreground">What the simulated books hold.</p>
            <div className="overflow-x-auto rounded-md border">
              <table className="w-full text-[13px]">
                <thead className="bg-muted/60 text-left text-[11px] uppercase tracking-wider text-muted-foreground">
                  <tr>
                    <th className="px-3 py-2 font-medium">Type</th>
                    <th className="px-3 py-2 font-medium">Books id</th>
                    <th className="px-3 py-2 font-medium">Doc / ref</th>
                    <th className="px-3 py-2 font-medium">Data</th>
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {books.map((b) => (
                    <tr key={b.id} className="h-9">
                      <td className="px-3 py-1.5 text-muted-foreground">{b.entityType.toLowerCase()}</td>
                      <td className="code px-3 py-1.5">{b.externalId}</td>
                      <td className="code px-3 py-1.5">{b.docNumber ?? '—'}</td>
                      <td className="code max-w-[520px] truncate px-3 py-1.5 text-[11px] text-muted-foreground">
                        {JSON.stringify(b.data)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </TabsContent>
        ) : null}
      </Tabs>
    </div>
  );
}

/** One number in a line of numbers: no card, the label first, the detail dim. */
function Stat({ label: text, value, sub, tone }: { label: string; value: string; sub?: string; tone?: 'ok' | 'warn' }) {
  return (
    <div className="flex items-baseline gap-1.5">
      <dt className="text-muted-foreground">{text}</dt>
      <dd className={`font-medium tabular-nums ${tone === 'warn' ? 'text-warn' : tone === 'ok' ? 'text-ok' : ''}`}>
        {value}
      </dd>
      {sub ? <dd className="text-[11px] text-muted-foreground">{sub}</dd> : null}
    </div>
  );
}

function Count({ n }: { n: number }) {
  return <span className="ml-1.5 rounded-sm bg-muted px-1.5 text-[11px] tabular-nums text-muted-foreground">{n}</span>;
}
