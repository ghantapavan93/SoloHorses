'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';
import { toast } from 'sonner';
import { AlertTriangle, Power, RefreshCw } from 'lucide-react';
import { AskPanel, Chip } from '@/components/ask/ask-panel';
import { CheckControl } from '@/components/record/check-control';
import { ClearanceControl } from '@/components/record/clearance-control';
import { MemoryStrip } from '@/components/story/memory-strip';
import { XrayPanel } from '@/components/story/xray';
import { PanelBoundary } from '@/components/platform/panel-boundary';
import { Rail } from '@/components/platform/rail';
import { useLiveRefresh } from '@/components/platform/use-platform-stream';
import { TraceDrawer } from '@/components/platform/trace-drawer';
import { StatusPill, type Tone } from '@/components/ui/status-pill';
import { Button } from '@/components/ui/button';
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { storyBooksAction, storyRedeliverWebhookAction, storyResolveExceptionAction } from '@/lib/actions';
import { day, dateTime, label, usd } from '@/lib/format';
import type { GestationRail } from '@/lib/gestation-rail';
import type { AskStatus, Memory, Story, StoryRow, Xray } from '@/lib/types';
import { cn } from '@/lib/utils';

const SOURCE_TONE: Record<string, string> = {
  'stallion office': 'bg-muted text-foreground',
  lab: 'bg-muted text-foreground',
  'recip farm': 'bg-muted text-foreground',
  vet: 'bg-muted text-foreground',
  text: 'bg-muted text-foreground',
  billing: 'bg-muted text-foreground',
  stripe: 'bg-[#635bff]/10 text-[#4b45c6] dark:text-[#a5a0ff]',
  quickbooks: 'bg-[#2ca01c]/10 text-[#1f7a13] dark:text-[#7fd36f]',
  board: 'bg-muted text-foreground',
};

const RULE_LABEL: Record<string, string> = {
  RECIPIENT_CARRYING: 'One mare carries one embryo',
  RECIPIENT_DOUBLE_BOOKED: 'One mare is held for one embryo',
  RECIPIENT_NOT_SET_UP: 'A transfer needs a set-up mare',
  CLEARANCE_PENDING: 'A transfer needs a clear pre-transfer exam',
  CLEARANCE_MISSING: 'A transfer needs a clear pre-transfer exam',
  CLEARANCE_ABNORMAL: 'A transfer needs a clear pre-transfer exam',
  CLEARANCE_EXPIRED: 'A transfer needs a current pre-transfer exam',
};

const KIND_RULE: Record<string, string> = {
  CHECK_OVERDUE: 'A milestone crossed with no check recorded starts an exception after three days',
  DEPARTURE_UNCONFIRMED: 'A leased mare is video-confirmed in foal within three days of leaving',
  RETURN_ASSESSMENT_MISSING: 'A recip sold in utero comes back open and in good health, on the vet’s record',
  RETURN_FEE_DECISION: 'The sale condition failed on the record; the $6,000 is a person’s decision, never the system’s',
  PAPERS_HELD: 'Registration papers wait for cleared funds',
  SETTLEMENT_CONFLICT: 'Two sources disagree about the same money; a person picks',
  RECONCILIATION_MISMATCH: 'The ledger is the truth; the books follow; a person settles a disagreement',
  RECIPIENT_CONFLICT: 'One mare carries one embryo',
  CLEARANCE_MISSING: 'A transfer needs a clear pre-transfer exam and a clean culture',
  RECIPIENT_MISSING: 'An embryo inside the transfer window needs a recip set aside',
  ACCOUNTING_SYNC_FAILED: 'Retries stop; the failure becomes a person’s problem, not a log line',
  INTEGRATION_DEGRADED: 'A dependency that keeps failing is fenced off until one probe succeeds',
};

/**
 * Screen A and Screen B: one mare's story across every system, the exceptions that touch
 * her, an evidence drawer, the two failure controls in context, and the assistant grounded
 * on the same records. Refreshes itself from the platform stream when a job, a breaker or
 * an exception moves.
 */
export function StoryView({
  story,
  rail,
  xray = null,
  askStatus,
  memory,
  signedIn,
  initialQuestion,
}: {
  story: Story;
  rail: GestationRail;
  xray?: Xray | null;
  askStatus: AskStatus | null;
  memory: Memory[];
  signedIn: boolean;
  initialQuestion?: string;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [selected, setSelected] = useState<StoryRow | null>(null);
  const [trace, setTrace] = useState<string | null>(null);
  const [redelivery, setRedelivery] = useState<{
    eventId: string;
    deliveries: number;
    duplicatesRejected: number;
    paymentsForInvoice: number;
  } | null>(
    story.money.stripe
      ? {
          eventId: story.money.stripe.eventId,
          deliveries: story.money.stripe.deliveries,
          duplicatesRejected: story.money.stripe.duplicatesRejected,
          paymentsForInvoice: story.money.stripe.paymentsForInvoice,
        }
      : null,
  );
  useLiveRefresh(
    (s) =>
      s.kind === 'exception' ||
      s.kind === 'breaker' ||
      (s.kind === 'job' && (s.status === 'completed' || s.status === 'retrying' || s.status === 'dead')),
    800,
  );

  const open = story.exceptions.filter((x) => x.status === 'OPEN' || x.status === 'ACKNOWLEDGED');
  const booksDown =
    story.money.jobs.some((j) => j.status === 'RETRYING' && /circuit open|not responding/i.test(j.lastError ?? '')) ||
    story.money.books.some((b) => b.recentAttempts[0]?.httpStatus === 503);
  // The lease fee is the story's money: the two failure controls sit on its rows, not on the deposit's.
  const paidInvoice =
    story.money.invoices.find((i) => i.kind === 'LEASE_FEE' && i.payments.some((p) => p.status === 'SUCCEEDED')) ??
    story.money.invoices.find((i) => i.payments.some((p) => p.status === 'SUCCEEDED')) ??
    null;
  const storyPaymentId = paidInvoice?.payments.find((p) => p.status === 'SUCCEEDED')?.id ?? null;
  const paymentBooks =
    story.money.books.find(
      (b) => b.entityType === 'PAYMENT' && (storyPaymentId ? b.entityId === storyPaymentId : true),
    ) ?? story.money.books.find((b) => b.entityType === 'PAYMENT');

  const redeliver = () =>
    start(async () => {
      const res = await storyRedeliverWebhookAction();
      if (res.ok) {
        setRedelivery(res.data);
        toast.success(
          res.data.deliveries === 1
            ? 'Delivered. The inbox recorded it once.'
            : `Delivered again — rejected as a duplicate (${res.data.duplicatesRejected} so far). Still one payment.`,
        );
      } else toast.error(`${res.error}${res.correlationId ? ` · trace ${res.correlationId}` : ''}`);
    });

  const books = (down: boolean) =>
    start(async () => {
      const res = await storyBooksAction(down);
      if (res.ok)
        toast.success(
          down
            ? 'QuickBooks is down for this story. Watch the sync park; nothing is lost. It restores itself in a minute.'
            : 'QuickBooks restored. After the cooldown, one probe closes the circuit and the sync drains.',
        );
      else toast.error(res.error);
      router.refresh();
    });

  return (
    <div className="space-y-6">
      {/* ── the mare ── */}
      <header className="space-y-1">
        <p className="eyebrow">
          Recipient mare · {story.recip.status ? label(story.recip.status) : '—'} · barn date {day(story.today)}
        </p>
        <h1 className="text-2xl font-bold">
          {story.recip.name}{' '}
          <span className="code text-[14px] font-normal text-muted-foreground">{story.recip.id}</span>
        </h1>
        <p className="text-[14px]">
          Carrying{' '}
          <Link href={`/embryos/${story.embryo.id}`} className="code underline-offset-2 hover:underline">
            {story.embryo.id}
          </Link>{' '}
          · {story.embryo.cross} · {label(story.embryo.source)} · owner {story.embryo.customer.name}
          {story.embryo.contract ? (
            <>
              {' '}
              · contract <span className="code">{story.embryo.contract.id}</span> ({label(story.embryo.contract.status)}
              )
            </>
          ) : null}
        </p>
        {/* The rule's own verdict on another transfer — the block a person would otherwise find at the chute — and the vet's way through it. */}
        <p
          className={cn(
            'flex flex-wrap items-center gap-x-2 gap-y-1 text-[12px]',
            story.recip.clearance.ok ? 'text-muted-foreground' : 'text-warn',
          )}
        >
          <span>
            {story.recip.clearance.ok
              ? 'Cleared for a transfer on the records'
              : `Not cleared for another transfer — ${story.recip.clearance.reason ?? ''}`}
            {story.recip.clearance.code ? (
              <span className="code ml-1.5 text-[10px] text-muted-foreground">{story.recip.clearance.code}</span>
            ) : null}
            {story.recip.heldFor.length > 0 ? (
              <span className="ml-1.5 text-muted-foreground">
                · held for {story.recip.heldFor.map((e) => e.id).join(', ')}
              </span>
            ) : null}
          </span>
          <ClearanceControl
            horseId={story.recip.id}
            kinds={['PRE_TRANSFER_EXAM', 'UTERINE_CULTURE', 'COGGINS']}
            results={['CLEAR', 'ABNORMAL', 'PENDING']}
          />
        </p>
        {story.recip.departure ? (
          <p
            className={cn(
              'flex flex-wrap items-center gap-x-2 gap-y-1 text-[12px]',
              story.recip.departure.rule.ok ? 'text-muted-foreground' : 'text-critical',
            )}
          >
            <span>
              Leaves with her client {day(story.recip.departure.scheduledDepartureOn)} —{' '}
              {story.recip.departure.rule.ok
                ? 'video-confirmed in foal on record'
                : (story.recip.departure.rule.reason ?? '')}
              {story.recip.departure.rule.code ? (
                <span className="code ml-1.5 text-[10px] text-muted-foreground">{story.recip.departure.rule.code}</span>
              ) : null}
            </span>
            {!story.recip.departure.rule.ok ? (
              <ClearanceControl
                horseId={story.recip.id}
                kinds={['VIDEO_IN_FOAL']}
                results={['CLEAR', 'ABNORMAL']}
                label="Record the video"
                done="Video confirmation recorded. The departure rule reads it on the next sweep; the exception closes itself."
              />
            ) : null}
          </p>
        ) : null}
      </header>
      {/* ── her cycle on one line: the checks, the fees, the check missing, the day she leaves ── */}
      <section className="hidden rounded-md border px-3 pb-1 pt-2 md:block" data-testid="story-rail">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="eyebrow">Her cycle, so far</p>
          <p className="text-[11px] text-muted-foreground">
            day {story.pregnancy.gestationDay} · solid is on the record · dashed is not yet
          </p>
        </div>
        <Rail {...rail} className="mt-1" />
      </section>

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_400px]">
        <div className="min-w-0 space-y-5">
          {/* ── status strip ── */}
          <div className="grid gap-2 sm:grid-cols-4">
            <Stat
              label="Gestation"
              value={`day ${story.pregnancy.gestationDay}`}
              sub={`transferred ${day(story.pregnancy.transferredOn)}`}
            />
            <Stat
              label="Last check"
              value={
                story.pregnancy.lastCheck
                  ? `day ${story.pregnancy.lastCheck.day} · ${story.pregnancy.lastCheck.result.toLowerCase()}`
                  : 'none'
              }
              sub={
                story.pregnancy.lastCheck
                  ? `${story.pregnancy.lastCheck.id} · ${day(story.pregnancy.lastCheck.on)}`
                  : ''
              }
              tone={
                story.pregnancy.nextMilestone !== null &&
                story.pregnancy.gestationDay >= story.pregnancy.nextMilestone + 3
                  ? 'warn'
                  : undefined
              }
            />
            <Stat
              label="Money"
              value={paidInvoice ? `${usd(paidInvoice.amountCents)} ${label(paidInvoice.status)}` : 'nothing billed'}
              sub={paymentBooks ? `books: ${label(paymentBooks.status)}` : ''}
              tone={paymentBooks?.status === 'MISMATCH' ? 'warn' : undefined}
            />
            <Stat
              label="Needs a person"
              value={String(open.length)}
              sub={open.length === 0 ? 'nothing open' : open.map((x) => label(x.kind)).join(' · ')}
              tone={open.some((x) => x.severity === 'CRITICAL') ? 'critical' : open.length > 0 ? 'warn' : 'ok'}
            />
          </div>

          {/* ── the x-ray: why she cannot leave, as one evidence graph ── */}
          {xray ? <XrayPanel xray={xray} /> : null}

          {/* ── timeline ── */}
          <section className="rounded-md border">
            <div className="flex flex-wrap items-center justify-between gap-2 border-b px-3 py-2">
              <p className="eyebrow">Every handoff · every system</p>
              <p className="text-[11px] text-muted-foreground">click a row for the evidence</p>
            </div>
            <ol className="divide-y">
              {story.rows.map((row) => (
                <li key={`${row.kind}-${row.id}-${row.at}`}>
                  <button
                    type="button"
                    onClick={() => setSelected(row)}
                    className={cn(
                      'grid w-full grid-cols-[92px_96px_1fr] items-start gap-2 px-3 py-2 text-left text-[13px] hover:bg-muted/40',
                      row.kind === 'exception' && 'bg-warn/5',
                      row.kind === 'planned' && 'opacity-70',
                    )}
                  >
                    <span className="tabular-nums text-muted-foreground">
                      {row.kind === 'planned' ? `~${day(row.at)}` : day(row.at)}
                    </span>
                    <span
                      className={cn(
                        'inline-flex h-5 w-fit items-center rounded-sm px-1.5 text-[10px] font-semibold uppercase tracking-wider',
                        SOURCE_TONE[row.source] ?? 'bg-muted',
                      )}
                    >
                      {row.source}
                    </span>
                    <span className="min-w-0">
                      <span className={cn('flex items-start gap-1.5', row.kind === 'exception' && 'font-medium')}>
                        {row.kind === 'exception' ? (
                          <AlertTriangle
                            className={cn(
                              'mt-0.5 size-3.5 shrink-0',
                              row.exception?.severity === 'CRITICAL' ? 'text-critical' : 'text-warn',
                            )}
                          />
                        ) : null}
                        <span>
                          {row.title}
                          {row.amountCents !== undefined ? (
                            <span className="money ml-2 text-[12px]">{usd(row.amountCents)}</span>
                          ) : null}
                          {row.kind === 'planned' ? (
                            <span className="ml-2 rounded-sm border px-1 text-[9px] uppercase tracking-wider text-muted-foreground">
                              planned · assumption
                            </span>
                          ) : null}
                        </span>
                      </span>
                      {row.detail ? (
                        <span className="block text-[12px] text-muted-foreground">{row.detail}</span>
                      ) : null}
                      <span className="mt-1 flex flex-wrap items-center gap-1">
                        {row.evidenceIds.slice(0, 5).map((id) => (
                          <span key={id} className="code rounded-sm border px-1 text-[10px] text-muted-foreground">
                            {id}
                          </span>
                        ))}
                        {row.correlationId ? (
                          <span className="code text-[10px] text-muted-foreground">· {row.correlationId}</span>
                        ) : null}
                      </span>
                    </span>
                  </button>
                  {/* the two controls, in context */}
                  {row.kind === 'event' && row.source === 'stripe' && row.id === storyPaymentId ? (
                    <div className="flex flex-wrap items-center gap-2 bg-muted/30 px-3 py-2 pl-3 text-[12px] md:pl-[204px]">
                      <Button
                        size="sm"
                        variant="outline"
                        className="h-7 text-[12px]"
                        disabled={pending}
                        onClick={redeliver}
                      >
                        <RefreshCw className="mr-1 size-3" /> Deliver the webhook again
                      </Button>
                      {redelivery ? (
                        <span className="tabular-nums text-muted-foreground">
                          <span className="code">{redelivery.eventId}</span> · deliveries{' '}
                          <b className="text-foreground">{redelivery.deliveries}</b> · rejected as duplicate{' '}
                          <b className="text-foreground">{redelivery.duplicatesRejected}</b> · payments for this invoice{' '}
                          <b className="text-foreground">{redelivery.paymentsForInvoice}</b>
                        </span>
                      ) : (
                        <span className="text-muted-foreground">write-once inbox · the job id is the event id</span>
                      )}
                    </div>
                  ) : null}
                  {row.kind === 'exception' &&
                  row.exception?.kindName === 'CHECK_OVERDUE' &&
                  (row.exception.status === 'OPEN' || row.exception.status === 'ACKNOWLEDGED') ? (
                    <div className="flex flex-wrap items-center gap-2 bg-muted/30 px-3 py-2 pl-3 text-[12px] md:pl-[204px]">
                      <CheckControl
                        transferId={story.pregnancy.transferId}
                        embryoId={story.embryo.id}
                        gestationDay={story.pregnancy.gestationDay}
                      />
                      <span className="text-muted-foreground">
                        the rule reads the result · a fee follows only at the milestones that carry one
                      </span>
                    </div>
                  ) : null}
                  {row.kind === 'exception' &&
                  row.exception?.kindName === 'DEPARTURE_UNCONFIRMED' &&
                  (row.exception.status === 'OPEN' || row.exception.status === 'ACKNOWLEDGED') ? (
                    <div className="flex flex-wrap items-center gap-2 bg-muted/30 px-3 py-2 pl-3 text-[12px] md:pl-[204px]">
                      <ClearanceControl
                        horseId={story.recip.id}
                        kinds={['VIDEO_IN_FOAL']}
                        results={['CLEAR', 'ABNORMAL']}
                        label="Record the video"
                        done="Video confirmation recorded. The departure rule reads it on the next sweep; the exception closes itself."
                      />
                      <span className="text-muted-foreground">
                        the vet’s record is what the rule reads · nothing here lets her leave
                      </span>
                    </div>
                  ) : null}
                  {row.kind === 'event' && row.source === 'billing' && row.id === paidInvoice?.id && paymentBooks ? (
                    <div className="flex flex-wrap items-center gap-2 bg-muted/30 px-3 py-2 pl-3 text-[12px] md:pl-[204px]">
                      <span
                        className={cn(
                          'inline-flex h-5 items-center rounded-sm px-1.5 text-[10px] font-semibold uppercase tracking-wider',
                          SOURCE_TONE['quickbooks'],
                        )}
                      >
                        quickbooks
                      </span>
                      <span className="text-muted-foreground">
                        invoice{' '}
                        {label(
                          story.money.books.find((b) => b.entityType === 'INVOICE' && b.entityId === paidInvoice?.id)
                            ?.status ?? 'pending',
                        )}{' '}
                        · payment {label(paymentBooks.status)}
                        {story.money.jobs[0]
                          ? ` · last sync job ${story.money.jobs[0].status.toLowerCase()} (${story.money.jobs[0].attempts}/${story.money.jobs[0].maxAttempts})`
                          : ''}
                      </span>
                      {booksDown ? (
                        <Button size="sm" className="h-7 text-[12px]" disabled={pending} onClick={() => books(false)}>
                          <Power className="mr-1 size-3" /> Restore QuickBooks
                        </Button>
                      ) : (
                        <Button
                          size="sm"
                          variant="outline"
                          className="h-7 text-[12px]"
                          disabled={pending}
                          onClick={() => books(true)}
                        >
                          <Power className="mr-1 size-3" /> Make QuickBooks unavailable
                        </Button>
                      )}
                      {story.money.jobs.filter((j) => j.status === 'RETRYING' || j.status === 'QUEUED').length > 0 ? (
                        <span className="text-warn">
                          {story.money.jobs.filter((j) => j.status === 'RETRYING' || j.status === 'QUEUED').length} sync
                          job(s) parked · lost 0
                        </span>
                      ) : null}
                    </div>
                  ) : null}
                </li>
              ))}
            </ol>
          </section>

          <p className="text-[11px] text-muted-foreground">
            Synthetic mare, synthetic money, real pipeline. Stripe and QuickBooks are simulators with the real error
            shapes; the inbox, outbox, ledger, breaker and detectors are the real code.{' '}
            <Link href="/build" className="underline">
              What is real, what is simulated, what is probably wrong →
            </Link>
          </p>
        </div>

        {/* ── Screen B: the assistant, grounded on this mare ── */}
        <aside className="flex h-[78vh] min-h-[520px] flex-col rounded-md border lg:sticky lg:top-4">
          <div className="border-b px-4 py-3">
            <p className="text-[14px] font-semibold">Ask about {story.recip.name}</p>
            <p className="text-[12px] text-muted-foreground">
              Cites records · abstains · proposes, never acts
              {askStatus ? (
                askStatus.live ? (
                  <> · {askStatus.model}</>
                ) : (
                  <span className="text-warn"> · offline, deterministic</span>
                )
              ) : null}
            </p>
          </div>
          <PanelBoundary name="Ask" className="flex-1 px-4 py-4 text-[12px] text-muted-foreground">
            <AskPanel
              status={askStatus}
              className="flex-1"
              onAnswered={() => router.refresh()}
              initialQuestion={initialQuestion}
              suggestions={[
                `What could derail ${story.recip.id}'s cycle right now?`,
                `Is ${story.recip.id} cleared for a transfer?`,
                `Just bill the lease fee now for ${story.recip.id}`,
                ...(story.recip.heldFor[0] && story.freeRecip
                  ? [`Hold ${story.freeRecip.id} for ${story.recip.heldFor[0].id} instead`]
                  : []),
              ]}
            />
          </PanelBoundary>
          <MemoryStrip rows={memory} signedIn={signedIn} />
          {!signedIn ? (
            <p className="border-t px-4 py-2 text-[11px] text-muted-foreground">
              Reading as the demo reviewer ·{' '}
              <Link href="/login" className="underline">
                sign in
              </Link>{' '}
              as a role
            </p>
          ) : null}
        </aside>

        {/* ── evidence drawer ── */}
        <Sheet open={selected !== null} onOpenChange={(o) => (o ? undefined : setSelected(null))}>
          <SheetContent side="right" className="flex w-full flex-col gap-0 p-0 sm:max-w-[560px]">
            <SheetHeader className="border-b px-4 py-3">
              <SheetTitle className="text-[14px]">
                {selected?.kind === 'exception' ? 'Exception' : 'Evidence'}
              </SheetTitle>
              <SheetDescription className="text-[12px]">
                {selected ? `${selected.source} · ${dateTime(selected.at)}` : ''}
              </SheetDescription>
            </SheetHeader>
            {selected ? (
              <div className="flex-1 space-y-4 overflow-y-auto px-4 py-4 text-[13px]">
                <p className="font-medium">{selected.title}</p>
                {selected.exception ? (
                  <div className="rounded-md border px-3 py-2">
                    <p className="eyebrow">The rule that fired</p>
                    <p className="mt-1">
                      {(selected.exception.rule && RULE_LABEL[selected.exception.rule]) ??
                        KIND_RULE[selected.exception.kindName] ??
                        label(selected.exception.kindName)}
                    </p>
                    <p className="mt-1 text-[11px] text-muted-foreground">
                      {selected.exception.exceptionId} · {label(selected.exception.kindName)} ·{' '}
                      {selected.exception.severity.toLowerCase()} · {selected.exception.status.toLowerCase()}
                      {selected.exception.rule ? ` · code ${selected.exception.rule}` : ''}
                    </p>
                  </div>
                ) : null}
                <div>
                  <p className="eyebrow">Source records</p>
                  <div className="mt-1 flex flex-wrap gap-1">
                    {selected.evidenceIds.map((id) => (
                      <Chip key={id} id={id} />
                    ))}
                  </div>
                </div>
                {selected.correlationId ? (
                  <div>
                    <p className="eyebrow">Correlation</p>
                    <button
                      type="button"
                      className="code mt-1 text-[12px] underline-offset-2 hover:underline"
                      onClick={() => setTrace(selected.correlationId)}
                    >
                      {selected.correlationId} · open the trace
                    </button>
                  </div>
                ) : (
                  <p className="text-[11px] text-muted-foreground">
                    Seeded rows carry no correlation id; anything the pipeline produces from here on does.
                  </p>
                )}
                {selected.exception &&
                (selected.exception.status === 'OPEN' || selected.exception.status === 'ACKNOWLEDGED') ? (
                  <div className="flex flex-wrap gap-1.5 border-t pt-3">
                    <Button
                      size="sm"
                      className="h-7 text-[12px]"
                      disabled={pending}
                      onClick={() => {
                        const note = window.prompt('What was done? (goes in the audit trail)');
                        if (!note || !selected.exception) return;
                        const id = selected.exception.exceptionId;
                        start(async () => {
                          const res = await storyResolveExceptionAction(id, note);
                          if (res.ok) {
                            toast.success('Resolved, with your note on the record.');
                            setSelected(null);
                            router.refresh();
                          } else toast.error(res.error);
                        });
                      }}
                    >
                      Resolve with a note
                    </Button>
                    <Link
                      href="/operations"
                      className="inline-flex h-7 items-center rounded-md border px-2 text-[12px] hover:bg-muted"
                    >
                      Open the board
                    </Link>
                  </div>
                ) : null}
              </div>
            ) : null}
          </SheetContent>
        </Sheet>
        <TraceDrawer correlationId={trace} onClose={() => setTrace(null)} />
      </div>
    </div>
  );
}

function Stat({ label: text, value, sub, tone }: { label: string; value: string; sub?: string; tone?: Tone }) {
  return (
    <div className="rounded-md border px-3 py-2">
      <p className="eyebrow">{text}</p>
      <p
        className={cn(
          'mt-1 text-[15px] font-semibold',
          tone === 'warn' && 'text-warn',
          tone === 'critical' && 'text-critical',
          tone === 'ok' && 'text-ok',
        )}
      >
        {value}
      </p>
      {sub ? <p className="truncate text-[11px] text-muted-foreground">{sub}</p> : null}
    </div>
  );
}

export function SeverityPill({ severity }: { severity: string }) {
  return (
    <StatusPill tone={severity === 'CRITICAL' ? 'critical' : severity === 'WARN' ? 'warn' : 'neutral'}>
      {severity.toLowerCase()}
    </StatusPill>
  );
}
