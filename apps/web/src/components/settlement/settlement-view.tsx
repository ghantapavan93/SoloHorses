'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';
import { toast } from 'sonner';
import {
  AlertTriangle,
  Check,
  CircleDashed,
  FileCheck2,
  HelpCircle,
  Landmark,
  RefreshCw,
  Repeat,
  ShieldAlert,
  Undo2,
  X,
} from 'lucide-react';
import { AskPanel, Chip } from '@/components/ask/ask-panel';
import { Explanation } from '@/components/operations/exception-board';
import { PanelBoundary } from '@/components/platform/panel-boundary';
import { ClearanceControl } from '@/components/record/clearance-control';
import { Input } from '@/components/ui/input';
import { TraceDrawer } from '@/components/platform/trace-drawer';
import { useLiveRefresh } from '@/components/platform/use-platform-stream';
import { StatusPill, type Tone } from '@/components/ui/status-pill';
import { Button } from '@/components/ui/button';
import {
  recordReturnAction,
  releaseDocumentAction,
  settlementConflictAction,
  settlementNewAction,
  settlementReplayAction,
  settlementSettleAchAction,
} from '@/lib/actions';
import { dateTime, day, label, usd } from '@/lib/format';
import type {
  AskStatus,
  IntegrityTimelineRow,
  InvoiceIntegrityRow,
  OperationalException,
  SettlementScene,
} from '@/lib/types';
import { cn } from '@/lib/utils';

type StepState = 'done' | 'current' | 'pending' | 'blocked';

/**
 * One sold lot from the hammer to the papers, as three systems see it. The sequence is the
 * sale's own: bid → invoice → ACH initiated → settlement pending → papers held → ACH cleared
 * → books → papers eligible → released by a person. Two controls are simulated and say so;
 * the release is real, audited, and never automatic.
 */
export function SettlementView({
  scene,
  books,
  timeline,
  exceptions,
  askStatus,
  signedIn,
  initialQuestion,
}: {
  scene: SettlementScene;
  books: InvoiceIntegrityRow['books'] | null;
  timeline: IntegrityTimelineRow[];
  exceptions: OperationalException[];
  askStatus: AskStatus | null;
  signedIn: boolean;
  initialQuestion?: string;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [trace, setTrace] = useState<string | null>(null);
  const [note, setNote] = useState('');
  // "Why?" hands the assistant the question about the state on screen; the panel asks it once.
  const [question, setQuestion] = useState<string | undefined>(initialQuestion);
  const [replay, setReplay] = useState<{ eventId: string; deliveries: number } | null>(null);
  const settledEvent = [...scene.stripe].reverse().find((e) => e.type === 'payment_intent.succeeded') ?? null;
  useLiveRefresh(
    (s) =>
      s.kind === 'exception' ||
      s.kind === 'lab' ||
      (s.kind === 'job' && (s.status === 'completed' || s.status === 'dead')),
    800,
  );

  const cleared = scene.funds === 'CLEARED';
  const returned = scene.funds === 'RETURNED';
  const documentStatus = scene.document?.status ?? null;
  const open = exceptions.filter((x) => x.status === 'OPEN' || x.status === 'ACKNOWLEDGED');
  const conflict = scene.conflict;
  const booksOk = books?.ok ?? null; // true synced · false failed or mismatched · null nothing yet

  const steps: { key: string; title: string; system: string; state: StepState; note: string }[] = [
    {
      key: 'bid',
      title: 'Winning bid',
      system: 'sale',
      state: 'done',
      note: `${usd(scene.lot.hammerCents)} · ${day(scene.lot.closedOn)}`,
    },
    {
      key: 'invoice',
      title: 'Invoice',
      system: 'ledger',
      state: scene.invoice ? 'done' : 'pending',
      note: scene.invoice ? `${scene.invoice.id} · due ${day(scene.invoice.dueOn)} ${scene.invoice.dueTime}` : 'none',
    },
    {
      key: 'initiated',
      title: 'ACH initiated',
      system: 'stripe',
      state: scene.payment ? 'done' : 'pending',
      note: scene.payment ? `${scene.payment.id} · ${dateTime(scene.payment.receivedAt)}` : 'nothing in flight',
    },
    {
      key: 'settling',
      title: 'Settlement pending',
      system: 'bank',
      state:
        cleared || returned
          ? 'done'
          : scene.funds === 'PROCESSING'
            ? 'current'
            : scene.funds === 'FAILED'
              ? 'blocked'
              : 'pending',
      note: cleared
        ? 'cleared'
        : returned
          ? 'cleared, then returned'
          : scene.funds === 'PROCESSING'
            ? 'initiated is not cleared'
            : scene.funds.toLowerCase(),
    },
    {
      key: 'held',
      title: 'Papers held',
      system: 'document',
      state: documentStatus === 'HELD' ? 'current' : documentStatus ? 'done' : 'pending',
      note:
        documentStatus === 'HELD'
          ? `${scene.document?.id} · ${scene.rule.policy}`
          : documentStatus
            ? 'no longer held'
            : 'no document',
    },
    {
      key: 'cleared',
      title: 'ACH cleared',
      system: 'stripe',
      state: cleared ? 'done' : returned ? 'blocked' : 'pending',
      note: cleared
        ? `${scene.payment?.status.toLowerCase()} · ${scene.payment?.id}`
        : returned
          ? `returned by the bank · ${scene.payment?.id}`
          : 'waiting on the bank',
    },
    {
      key: 'books',
      title: 'Accounting sync',
      system: 'quickbooks',
      state: booksOk === true ? 'done' : booksOk === false ? 'blocked' : cleared ? 'current' : 'pending',
      note: books
        ? [
            books.invoice ? `invoice ${books.invoice.toLowerCase()}` : null,
            books.payment ? `payment ${books.payment.toLowerCase()}` : null,
          ]
            .filter(Boolean)
            .join(' · ') || 'not yet synced'
        : 'not yet synced',
    },
    {
      key: 'eligible',
      title: 'Papers release eligible',
      system: 'rule',
      state:
        documentStatus === 'RELEASED'
          ? 'done'
          : documentStatus === 'ELIGIBLE'
            ? 'current'
            : returned
              ? 'blocked'
              : 'pending',
      note:
        documentStatus === 'ELIGIBLE'
          ? `${scene.document?.eligibleAt ? dateTime(scene.document.eligibleAt) : ''} · a person sends them`
          : documentStatus === 'RELEASED'
            ? 'eligible, then released'
            : (scene.rule.reason ?? ''),
    },
    {
      key: 'released',
      title: 'Papers released',
      system: 'person',
      state: documentStatus === 'RELEASED' ? 'done' : 'pending',
      note:
        documentStatus === 'RELEASED'
          ? `by ${scene.document?.releasedBy?.name ?? 'billing'} · ${scene.document?.releasedAt ? dateTime(scene.document.releasedAt) : ''}`
          : 'billing clicks; nothing here does',
    },
  ];

  const settle = () =>
    start(async () => {
      const res = await settlementSettleAchAction(scene.lot.id);
      if (res.ok)
        toast.success(
          `Stripe said payment_intent.succeeded (${res.data.eventId}). The rule ran again; the papers are eligible, not released.`,
        );
      else toast.error(`${res.error}${res.correlationId ? ` · trace ${res.correlationId}` : ''}`);
      router.refresh();
    });
  const makeConflict = () =>
    start(async () => {
      const res = await settlementConflictAction(scene.lot.id);
      if (res.ok)
        toast.success(
          'A late processing event landed after succeeded. The ledger held; the detector raised the disagreement; Ask will abstain.',
        );
      else toast.error(res.error);
      router.refresh();
    });
  const recordReturn = () => {
    if (!scene.payment) return;
    const paymentId = scene.payment.id;
    start(async () => {
      const res = await recordReturnAction(paymentId, 'R01 · insufficient funds (bank notice, recorded by billing)');
      if (res.ok) toast.success('Returned. The ledger moved one way; the rule ran again.');
      else toast.error(`${res.error}${res.correlationId ? ` · trace ${res.correlationId}` : ''}`);
      router.refresh();
    });
  };
  const replayWebhook = () => {
    if (!settledEvent) return;
    const eventId = settledEvent.eventId;
    start(async () => {
      const res = await settlementReplayAction(eventId);
      if (res.ok) {
        setReplay({ eventId, deliveries: res.data.deliveries });
        toast.success(
          `Delivered again — rejected as a duplicate (${res.data.deliveries} deliveries). Still one payment, nothing moved.`,
        );
      } else toast.error(res.error);
      router.refresh();
    });
  };
  const fresh = () =>
    start(async () => {
      const res = await settlementNewAction();
      if (res.ok) toast.success(`New lot ${res.data.lotId}: ACH initiated, papers held.`);
      else toast.error(res.error);
      router.refresh();
    });
  const release = () => {
    if (!scene.document) return;
    const documentId = scene.document.id;
    start(async () => {
      const res = await releaseDocumentAction(documentId, note.trim() || null);
      if (res.ok) toast.success('Released, with your name on the audit row.');
      else toast.error(res.error);
      router.refresh();
    });
  };

  return (
    <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_400px]">
      <div className="min-w-0 space-y-5">
        <header className="space-y-1">
          <p className="eyebrow">
            Sale lot · {label(scene.lot.kind)} · closed {day(scene.lot.closedOn)} · barn date {day(scene.today)}
          </p>
          <h1 className="text-2xl font-bold">
            {scene.lot.title} <span className="code text-[14px] font-normal text-muted-foreground">{scene.lot.id}</span>
          </h1>
          <p className="text-[14px]">
            Hammer <span className="money">{usd(scene.lot.hammerCents)}</span> · buyer {scene.lot.buyer.name}{' '}
            <span className="code text-muted-foreground">{scene.lot.buyer.id}</span>
            {scene.invoice ? (
              <>
                {' '}
                · settlement due{' '}
                <b>
                  {day(scene.invoice.dueOn)} {scene.invoice.dueTime}
                </b>
              </>
            ) : null}
          </p>
          <p
            className={cn(
              'flex flex-wrap items-center gap-x-2 gap-y-1 text-[12px]',
              scene.rule.ok ? 'text-ok' : 'text-warn',
            )}
          >
            <span>
              {scene.rule.ok
                ? `Funds cleared; the papers may be released by a person (${scene.rule.policy})`
                : `Papers held — ${scene.rule.reason}`}
              {scene.rule.code ? (
                <span className="code ml-1.5 text-[10px] text-muted-foreground">{scene.rule.code}</span>
              ) : null}
            </span>
            <button
              type="button"
              className="inline-flex h-6 items-center gap-1 rounded-md border px-2 text-[11px] text-foreground hover:bg-muted"
              onClick={() =>
                setQuestion(
                  conflict
                    ? `Which source is right about the settlement of ${scene.lot.id}?`
                    : scene.rule.ok
                      ? `Can the papers for ${scene.lot.id} be released?`
                      : `Why are the papers for ${scene.lot.id} held?`,
                )
              }
              data-testid="why"
            >
              <HelpCircle className="size-3" /> Why?
            </button>
          </p>
        </header>

        {/* ── three systems, one money ── */}
        <div className="grid gap-2 sm:grid-cols-4">
          <Stat
            label="Ledger"
            value={
              scene.payment
                ? `${scene.payment.method.toLowerCase()} · ${scene.payment.status.toLowerCase()}`
                : 'no payment'
            }
            sub={scene.payment?.id ?? ''}
            tone={
              scene.funds === 'CLEARED'
                ? 'ok'
                : scene.funds === 'FAILED' || scene.funds === 'RETURNED'
                  ? 'critical'
                  : 'warn'
            }
          />
          <Stat
            label="Stripe · latest event"
            value={scene.sources.find((s) => s.system === 'stripe')?.state ?? '—'}
            sub={scene.sources.find((s) => s.system === 'stripe')?.note ?? ''}
            tone={conflict ? 'critical' : undefined}
          />
          <Stat
            label="Books"
            value={books ? books.status.toLowerCase() : 'not synced'}
            sub={books?.note ?? ''}
            tone={books?.ok === false ? 'critical' : books?.ok ? 'ok' : undefined}
          />
          <Stat
            label="Registration papers"
            value={documentStatus ? documentStatus.toLowerCase() : 'none'}
            sub={scene.document?.id ?? ''}
            tone={documentStatus === 'RELEASED' ? 'ok' : documentStatus === 'ELIGIBLE' ? 'ok' : 'warn'}
          />
        </div>

        {conflict ? (
          <div className="flex items-start gap-2 rounded-md border border-critical/40 bg-critical/5 px-3 py-2 text-[13px]">
            <ShieldAlert className="mt-0.5 size-4 shrink-0 text-critical" />
            <div>
              <p className="font-medium">The ledger and the payment provider disagree. {conflict.reason}</p>
              <p className="text-[12px] text-muted-foreground">
                Nothing here picks a winner. Ask abstains — billing review is required — and the papers stay where they
                are until a person decides on the board.
              </p>
            </div>
          </div>
        ) : null}

        {/* ── the sequence ── */}
        <section className="rounded-md border">
          <div className="flex flex-wrap items-center justify-between gap-2 border-b px-3 py-2">
            <p className="eyebrow">From the hammer to the papers</p>
            <p className="text-[11px] text-muted-foreground">the sale’s own order · {scene.rule.policy}</p>
          </div>
          <ol className="divide-y">
            {steps.map((s, i) => (
              <li
                key={s.key}
                className={cn(
                  'grid grid-cols-[28px_140px_1fr] items-start gap-3 px-3 py-2 text-[13px]',
                  s.state === 'current' && 'bg-warn/5',
                  s.state === 'blocked' && 'bg-critical/5',
                )}
              >
                <span className="mt-0.5">
                  {s.state === 'done' ? (
                    <Check className="size-4 text-ok" />
                  ) : s.state === 'blocked' ? (
                    <X className="size-4 text-critical" />
                  ) : s.state === 'current' ? (
                    <CircleDashed className="size-4 animate-[spin_6s_linear_infinite] text-warn" />
                  ) : (
                    <CircleDashed className="size-4 text-muted-foreground/50" />
                  )}
                </span>
                <span className="min-w-0">
                  <span className={cn('block font-medium', s.state === 'pending' && 'text-muted-foreground')}>
                    {String(i + 1).padStart(2, '0')} · {s.title}
                  </span>
                  <span className="readout block text-[10px] text-muted-foreground">{s.system}</span>
                </span>
                <span
                  className={cn(
                    'min-w-0 break-words text-[12px]',
                    s.state === 'pending' ? 'text-muted-foreground/70' : 'text-muted-foreground',
                  )}
                >
                  {s.note}
                </span>
              </li>
            ))}
          </ol>
          {/* the controls, in context */}
          <div className="flex flex-wrap items-center gap-2 border-t bg-muted/30 px-3 py-2 text-[12px]">
            {scene.funds === 'PROCESSING' ? (
              <Button
                size="sm"
                className="h-7 text-[12px]"
                disabled={pending}
                onClick={settle}
                data-testid="settle-ach"
              >
                <Landmark className="mr-1 size-3" /> Settle the ACH{' '}
                <span className="ml-1 rounded-sm border border-current/30 px-1 text-[9px] uppercase tracking-wider opacity-80">
                  simulated
                </span>
              </Button>
            ) : null}
            {documentStatus === 'ELIGIBLE' ? (
              <>
                <Input
                  aria-label="Release note"
                  placeholder="sent to whom? (audited with your name)"
                  value={note}
                  onChange={(e) => setNote(e.target.value)}
                  className="h-7 w-[220px] text-[12px]"
                  disabled={pending}
                  data-testid="release-note"
                />
                <Button
                  size="sm"
                  className="h-7 text-[12px]"
                  disabled={pending}
                  onClick={release}
                  data-testid="release-papers"
                >
                  <FileCheck2 className="mr-1 size-3" /> Release the papers{' '}
                  <span className="ml-1 rounded-sm border border-current/30 px-1 text-[9px] uppercase tracking-wider opacity-80">
                    a person
                  </span>
                </Button>
              </>
            ) : null}
            {settledEvent ? (
              <Button
                size="sm"
                variant="outline"
                className="h-7 text-[12px]"
                disabled={pending}
                onClick={replayWebhook}
                data-testid="replay-webhook"
              >
                <Repeat className="mr-1 size-3" /> Deliver the webhook again
              </Button>
            ) : null}
            {replay ? (
              <span className="tabular-nums text-muted-foreground">
                <span className="code">{replay.eventId}</span> · deliveries{' '}
                <b className="text-foreground">{replay.deliveries}</b> · payments for this invoice{' '}
                <b className="text-foreground">1</b>
              </span>
            ) : null}
            {scene.payment?.status === 'SUCCEEDED' ? (
              <Button
                size="sm"
                variant="outline"
                className="h-7 text-[12px]"
                disabled={pending}
                onClick={recordReturn}
                data-testid="record-return"
              >
                <Undo2 className="mr-1 size-3" /> Record an ACH return{' '}
                <span className="ml-1 rounded-sm border border-current/30 px-1 text-[9px] uppercase tracking-wider opacity-80">
                  a person
                </span>
              </Button>
            ) : null}
            {cleared && !conflict ? (
              <Button
                size="sm"
                variant="outline"
                className="h-7 text-[12px]"
                disabled={pending}
                onClick={makeConflict}
                data-testid="source-conflict"
              >
                <AlertTriangle className="mr-1 size-3" /> Deliver a late “processing” event{' '}
                <span className="ml-1 rounded-sm border border-current/30 px-1 text-[9px] uppercase tracking-wider opacity-80">
                  simulated
                </span>
              </Button>
            ) : null}
            <Button
              size="sm"
              variant="ghost"
              className="h-7 text-[12px] text-muted-foreground"
              disabled={pending}
              onClick={fresh}
              data-testid="new-sale"
            >
              <RefreshCw className="mr-1 size-3" /> Start a new sale
            </Button>
          </div>
        </section>

        {/* ── the sale's other condition: the mare that came back ── */}
        {scene.returns.length > 0 ? (
          <section className="rounded-md border">
            <div className="flex flex-wrap items-center justify-between gap-2 border-b px-3 py-2">
              <p className="eyebrow">Sold in utero · the mare comes back</p>
              <p className="text-[11px] text-muted-foreground">
                after weaning, open and in good health — or a person decides the $6,000
              </p>
            </div>
            <ul className="divide-y">
              {scene.returns.map((r) => (
                <li key={r.lot.id} className="space-y-1.5 px-3 py-2 text-[13px]">
                  <div className="min-w-0">
                    <p>
                      <span className="code">{r.recip.id}</span> · Recip #{r.recip.number ?? '?'} · {r.lot.title}{' '}
                      <span className="code text-muted-foreground">{r.lot.id}</span> · {usd(r.lot.hammerCents)} ·{' '}
                      {r.lot.buyer.name}
                    </p>
                    <p className="text-[12px] text-muted-foreground">
                      weaned {r.recip.weanedOn ? day(r.recip.weanedOn) : '—'} · returned{' '}
                      {r.recip.returnedOn ? day(r.recip.returnedOn) : 'not yet'} · assessment{' '}
                      {r.assessment
                        ? `${r.assessment.result.toLowerCase()} (${r.assessment.id}, ${day(r.assessment.performedOn)})`
                        : 'none on record'}
                    </p>
                    <p
                      className={cn(
                        'mt-0.5 text-[12px]',
                        r.decision === 'CONDITION_MET'
                          ? 'text-ok'
                          : r.decision === 'A_PERSON_DECIDES'
                            ? 'text-critical'
                            : 'text-warn',
                      )}
                    >
                      {r.decision === 'CONDITION_MET'
                        ? 'Condition met on the vet’s record · no recipient purchase fee'
                        : r.rule.ok
                          ? ''
                          : r.rule.reason}
                      {!r.rule.ok && r.rule.code ? (
                        <span className="code ml-1.5 text-[10px] text-muted-foreground">{r.rule.code}</span>
                      ) : null}
                    </p>
                  </div>
                  <div className="flex flex-wrap items-center gap-1.5">
                    {r.decision === 'WAITING_ON_VET' ? (
                      <ClearanceControl
                        horseId={r.recip.id}
                        kinds={['RETURN_ASSESSMENT']}
                        results={['CLEAR', 'ABNORMAL', 'PENDING']}
                        label="Record the assessment"
                        done="Return assessment recorded. The rule reads it; the fee, if any, is a person’s decision on the board."
                      />
                    ) : null}
                    {r.decision === 'A_PERSON_DECIDES' ? (
                      <>
                        <Link
                          href="/login?next=/operations"
                          className="inline-flex h-7 items-center rounded-md border px-2 text-[12px] hover:bg-muted"
                        >
                          Decide on the board
                        </Link>
                        <ClearanceControl
                          horseId={r.recip.id}
                          kinds={['RETURN_ASSESSMENT']}
                          results={['CLEAR', 'ABNORMAL']}
                          label="Record again"
                        />
                      </>
                    ) : null}
                    {r.decision === 'CONDITION_MET' ? (
                      <ClearanceControl
                        horseId={r.recip.id}
                        kinds={['RETURN_ASSESSMENT']}
                        results={['ABNORMAL', 'CLEAR']}
                        label="Record again"
                      />
                    ) : null}
                  </div>
                </li>
              ))}
            </ul>
          </section>
        ) : null}

        {/* ── what the board says about this lot ── */}
        {open.length > 0 ? (
          <section className="rounded-md border">
            <div className="flex items-center justify-between border-b px-3 py-2">
              <p className="eyebrow">Needs a person · {open.length}</p>
              <Link href="/login?next=/operations" className="text-[11px] text-muted-foreground underline">
                open the board
              </Link>
            </div>
            <ul className="divide-y">
              {open.map((x) => (
                <li key={x.id} className="px-3 py-2 text-[13px]">
                  <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                    <StatusPill
                      tone={x.severity === 'CRITICAL' ? 'critical' : x.severity === 'WARN' ? 'warn' : 'neutral'}
                    >
                      {label(x.kind)}
                    </StatusPill>
                    <span className="code text-[11px] text-muted-foreground">{x.id}</span>
                  </div>
                  <p className="mt-1 leading-snug">{x.title}</p>
                  {x.explanation ? <Explanation explanation={x.explanation} open /> : null}
                </li>
              ))}
            </ul>
          </section>
        ) : null}

        {/* ── the audit trail ── */}
        <section className="rounded-md border">
          <div className="flex items-center justify-between border-b px-3 py-2">
            <p className="eyebrow">Audit trail · every system, in order</p>
            <p className="text-[11px] text-muted-foreground">append-only</p>
          </div>
          <ol className="divide-y">
            {/* the audit rows come from the scene; the integrity timeline adds only what the inbox, the queue and the books recorded */}
            {[
              ...scene.audit.map((a) => ({
                at: a.at,
                source: a.source.toLowerCase(),
                title: a.action.replace(/[._]/g, ' '),
                detail: summarize(a.after),
                actor: a.actor,
                correlationId: a.correlationId,
              })),
              ...timeline
                .filter(
                  (t) =>
                    t.source === 'quickbooks' ||
                    t.source === 'queue' ||
                    (t.source === 'stripe' && /received|applied|set aside/.test(t.title)),
                )
                .map((t) => ({
                  at: t.at,
                  source: t.source,
                  title: t.title,
                  detail: t.detail,
                  actor: null,
                  correlationId: t.correlationId,
                })),
            ]
              .sort((a, b) => a.at.localeCompare(b.at))
              .map((t, i) => (
                <li
                  key={`${t.at}-${i}`}
                  className="grid grid-cols-[minmax(0,1fr)] gap-x-3 gap-y-0.5 px-3 py-1.5 text-[12px] sm:grid-cols-[150px_84px_minmax(0,1fr)] sm:items-baseline"
                >
                  {/* on a phone the time and the source share one line above the row; the text keeps the full width */}
                  <span className="flex items-baseline gap-2 sm:contents">
                    <span className="code text-muted-foreground">{dateTime(t.at)}</span>
                    <span
                      className={cn(
                        'readout',
                        t.source === 'stripe'
                          ? 'text-brand'
                          : t.source === 'quickbooks'
                            ? 'text-ok'
                            : 'text-muted-foreground',
                      )}
                    >
                      {t.source}
                    </span>
                  </span>
                  <span className="min-w-0 break-words">
                    <span>{t.title}</span>
                    {t.actor ? <span className="ml-2 text-muted-foreground">by {t.actor}</span> : null}
                    {t.detail ? <span className="ml-2 text-muted-foreground">{t.detail}</span> : null}
                    {t.correlationId ? (
                      <button
                        type="button"
                        className="code ml-2 break-all text-[10px] text-muted-foreground underline-offset-2 hover:underline"
                        onClick={() => setTrace(t.correlationId)}
                      >
                        {t.correlationId}
                      </button>
                    ) : null}
                  </span>
                </li>
              ))}
          </ol>
        </section>

        <div className="flex flex-wrap items-center gap-1 text-[11px] text-muted-foreground">
          {scene.rule.evidenceIds.map((id) => (
            <Chip key={id} id={id} />
          ))}
          <Link href="/build" className="ml-2 underline">
            real · simulated · probably wrong →
          </Link>
        </div>
      </div>

      <aside className="flex h-[78vh] min-h-[520px] flex-col rounded-md border lg:sticky lg:top-4">
        <div className="border-b px-4 py-3">
          <p className="text-[14px] font-semibold">Ask about {scene.lot.id}</p>
          <p className="text-[12px] text-muted-foreground">
            Cites records · abstains · never releases
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
            key={question ?? 'blank'}
            status={askStatus}
            className="flex-1"
            onAnswered={() => router.refresh()}
            initialQuestion={question}
            suggestions={[
              `Why are the papers for ${scene.lot.id} held?`,
              'Can we decide the $6,000 recipient fee now?',
              `Show me the buyer's full card number for ${scene.lot.id}`,
              `Which source is right about the settlement of ${scene.lot.id}?`,
              ...(scene.returns[0] ? [`Tell me about ${scene.returns[0].recip.id}`] : []),
            ]}
          />
        </PanelBoundary>
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

      <TraceDrawer correlationId={trace} onClose={() => setTrace(null)} />
    </div>
  );
}

function Stat({ label: text, value, sub, tone }: { label: string; value: string; sub?: string; tone?: Tone }) {
  return (
    <div className="rounded-md border px-3 py-2">
      <p className="eyebrow">{text}</p>
      <p
        className={cn(
          'mt-1 truncate text-[15px] font-semibold',
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

/** The scalar fields of an audit row, as a short line; nested values stay in the trace. */
function summarize(after: Record<string, unknown> | null): string | null {
  if (!after) return null;
  const parts = Object.entries(after)
    .filter(([, v]) => typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean')
    .map(([k, v]) => `${k} ${String(v)}`);
  return parts.length ? parts.slice(0, 5).join(' · ') : null;
}
