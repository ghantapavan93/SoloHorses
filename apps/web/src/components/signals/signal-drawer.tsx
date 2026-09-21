'use client';

import Link from 'next/link';
import { ArrowRight, Sparkles } from 'lucide-react';
import { CausalMap } from '@/components/signals/causal-map';
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { ago, label, usd } from '@/lib/format';
import { askForSignal, askHrefForSignal, hrefForSignal } from '@/lib/signals';
import type { Signal } from '@/lib/types';
import { cn } from '@/lib/utils';

/**
 * One signal, opened: the facts as the tables hold them, what it means to the person who
 * acts, who that is, and the one door to where they act. The same id and correlation id it
 * carries on the board, on the page and in the trace. The body is its own component so the
 * drawer and the signal's own page (/signals/:id) show one thing.
 */
export function SignalDetail({
  signal,
  signedIn,
  onAsk,
  onNavigate,
}: {
  signal: Signal;
  signedIn: boolean;
  onAsk?: (question: string) => void;
  onNavigate?: () => void;
}) {
  const surface = hrefForSignal(signal, signedIn);
  const askHref = askHrefForSignal(signal, signedIn);
  return (
    <div className="space-y-4 text-[13px]">
      <p className="font-medium leading-snug">{signal.title}</p>
      {signal.map ? (
        <div>
          <p className="eyebrow mb-1.5">Why this one</p>
          <CausalMap map={signal.map} />
        </div>
      ) : null}
      <div className="grid gap-3 rounded-md border bg-muted/30 px-3 py-2 md:grid-cols-[minmax(0,1fr)_minmax(0,1.2fr)]">
        <dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-3 gap-y-0.5 text-[11px]">
          {signal.state.map((s) => (
            <div key={s.key} className="contents">
              <dt className="readout text-muted-foreground">{s.key}</dt>
              <dd className="code break-words text-[11px]">{s.value}</dd>
            </div>
          ))}
        </dl>
        <p className="text-[12px] leading-relaxed">{signal.meaning}</p>
      </div>
      <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-[12px]">
        {signal.stake ? (
          <>
            <dt className="readout text-muted-foreground">at stake</dt>
            <dd>
              <span className="money font-semibold">{usd(signal.stake.amountCents)}</span>{' '}
              <span className="text-muted-foreground">· {signal.stake.label}</span>
            </dd>
          </>
        ) : null}
        <dt className="readout text-muted-foreground">severity</dt>
        <dd
          className={cn(
            signal.severity === 'CRITICAL' ? 'text-critical' : signal.severity === 'WARN' ? 'text-warn' : '',
          )}
        >
          {signal.severity.toLowerCase()}
        </dd>
        <dt className="readout text-muted-foreground">source</dt>
        <dd>{label(signal.source)}</dd>
        <dt className="readout text-muted-foreground">entity</dt>
        <dd className="code">{signal.entityId ?? '—'}</dd>
        <dt className="readout text-muted-foreground">owner</dt>
        <dd>{signal.ownerName ?? `${label(signal.owner)} · unassigned`}</dd>
        <dt className="readout text-muted-foreground">next</dt>
        <dd>{signal.next}</dd>
        <dt className="readout text-muted-foreground">trace</dt>
        <dd className="code">
          {signal.correlationId ? (
            <Link
              href={`/traces/${encodeURIComponent(signal.correlationId)}`}
              className="underline-offset-2 hover:underline"
            >
              {signal.correlationId}
            </Link>
          ) : (
            'raised by a sweep'
          )}
        </dd>
      </dl>
      <div className="flex flex-wrap items-center gap-2 border-t pt-3">
        <Link
          href={surface}
          className="inline-flex h-8 items-center gap-1.5 rounded-md bg-foreground px-3 text-[12px] font-medium text-background hover:opacity-90"
          onClick={onNavigate}
        >
          Open <ArrowRight className="size-3.5" />
        </Link>
        {onAsk ? (
          <button
            type="button"
            className="inline-flex h-8 items-center gap-1.5 rounded-md border px-3 text-[12px] hover:bg-muted"
            onClick={() => onAsk(askForSignal(signal))}
          >
            <Sparkles className="size-3.5" /> Ask about this
          </button>
        ) : (
          <Link
            href={askHref}
            className="inline-flex h-8 items-center gap-1.5 rounded-md border px-3 text-[12px] hover:bg-muted"
            onClick={onNavigate}
          >
            <Sparkles className="size-3.5" /> Ask about this
          </Link>
        )}
        <Link
          href={`/signals/${signal.id}`}
          className="ml-auto inline-flex h-8 items-center rounded-md px-2 text-[11px] text-muted-foreground hover:bg-muted"
          onClick={onNavigate}
        >
          permalink
        </Link>
      </div>
    </div>
  );
}

export function SignalDrawer({
  signal,
  signedIn,
  onClose,
  onAsk,
}: {
  signal: Signal | null;
  signedIn: boolean;
  onClose: () => void;
  onAsk?: (question: string) => void;
}) {
  return (
    <Sheet open={signal !== null} onOpenChange={(o) => (o ? undefined : onClose())}>
      <SheetContent side="right" className="flex w-full flex-col gap-0 p-0 sm:max-w-[520px]">
        <SheetHeader className="border-b px-4 py-3">
          <SheetTitle className="text-[14px]">{signal?.label ?? ''}</SheetTitle>
          <SheetDescription className="text-[12px]">
            {signal ? (
              <>
                {signal.channelLabel} · <span className="code">{signal.id}</span> · {ago(signal.createdAt)}
              </>
            ) : (
              ''
            )}
          </SheetDescription>
        </SheetHeader>
        {signal ? (
          <div className="flex-1 overflow-y-auto px-4 py-4">
            <SignalDetail signal={signal} signedIn={signedIn} onAsk={onAsk} onNavigate={onClose} />
          </div>
        ) : null}
      </SheetContent>
    </Sheet>
  );
}
