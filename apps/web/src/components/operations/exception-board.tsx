'use client';

import Link from 'next/link';
import { Fragment, useState, useTransition } from 'react';
import { toast } from 'sonner';
import { ChevronRight, RefreshCw, RotateCcw } from 'lucide-react';
import { StatusPill, type Tone } from '@/components/ui/status-pill';
import { useLiveRefresh } from '@/components/platform/use-platform-stream';
import { TraceDrawer } from '@/components/platform/trace-drawer';
import { Button } from '@/components/ui/button';
import {
  acknowledgeExceptionAction,
  detectExceptionsAction,
  ignoreExceptionAction,
  resolveExceptionAction,
  retryExceptionAction,
} from '@/lib/actions';
import { ago, hrefFor, label, usd } from '@/lib/format';
import type { ExceptionDefinition, ExceptionExplanation, ExceptionKind, OperationalException } from '@/lib/types';
import { cn } from '@/lib/utils';

const SEVERITY_TONE: Record<string, Tone> = { CRITICAL: 'critical', WARN: 'warn', INFO: 'neutral' };

/**
 * The board. Every open exception, whatever raised it, with what a person may do about it.
 * Live: a detector raising or resolving something refreshes the page through the platform
 * stream; nothing here polls.
 */
export function ExceptionBoard({
  rows,
  kinds,
  canAct,
}: {
  rows: OperationalException[];
  kinds: Record<ExceptionKind, ExceptionDefinition>;
  canAct: boolean;
}) {
  const [pending, start] = useTransition();
  const [trace, setTrace] = useState<string | null>(null);
  useLiveRefresh(
    (s) => s.kind === 'exception' || (s.kind === 'job' && (s.status === 'dead' || s.status === 'completed')),
  );

  const act = (fn: () => Promise<{ ok: boolean; error?: string; correlationId?: string | null }>, done: string) =>
    start(async () => {
      const res = await fn();
      if (res.ok) toast.success(done);
      else toast.error(`${res.error ?? 'failed'}${res.correlationId ? ` · trace ${res.correlationId}` : ''}`);
    });

  const withNote = (
    prompt: string,
    fn: (note: string) => Promise<{ ok: boolean; error?: string; correlationId?: string | null }>,
    done: string,
  ) => {
    const note = window.prompt(prompt);
    if (!note) return;
    act(() => fn(note), done);
  };

  const bySeverity = ['CRITICAL', 'WARN', 'INFO']
    .map((severity) => ({ severity, items: rows.filter((r) => r.severity === severity) }))
    .filter((g) => g.items.length > 0);

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-[13px] text-muted-foreground">
          {rows.length === 0
            ? 'Nothing needs a person right now.'
            : 'Detectors run every minute and after every change.'}
        </p>
        {canAct ? (
          <Button
            size="sm"
            variant="outline"
            className="h-8 text-[12px]"
            disabled={pending}
            onClick={() => act(() => detectExceptionsAction(), 'Detectors ran.')}
          >
            <RefreshCw className="mr-1.5 size-3.5" /> Run detectors now
          </Button>
        ) : null}
      </div>

      {rows.length === 0 ? (
        <p className="rounded-md border border-dashed px-3 py-8 text-center text-[13px] text-muted-foreground">
          Clear board. The lab can break something on purpose.
        </p>
      ) : null}

      {/* A list, not a stack of cards: one row per exception, the rule on the left, what a person may do on the right. */}
      {bySeverity.map(({ severity, items }) => (
        <section key={severity} className="rounded-md border">
          <h2 className="eyebrow flex items-center gap-2 border-b px-3 py-2">
            <span
              className={cn(
                'size-1.5 rounded-full',
                severity === 'CRITICAL' ? 'bg-critical' : severity === 'WARN' ? 'bg-warn' : 'bg-muted-foreground',
              )}
              aria-hidden
            />
            {severity.toLowerCase()} · {items.length}
          </h2>
          <ul className="divide-y">
            {items.map((x) => {
              const definition = kinds[x.kind];
              const entityHref = x.entityId ? hrefFor(x.entityId) : null;
              const jobBacked = Boolean((x.detail as { jobId?: string } | null)?.jobId);
              return (
                <li
                  key={x.id}
                  className="row grid gap-x-3 gap-y-1 px-3 py-2 text-[13px] md:grid-cols-[minmax(0,1fr)_auto]"
                >
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                      <StatusPill tone={SEVERITY_TONE[x.severity] ?? 'neutral'}>{definition.label}</StatusPill>
                      <span className="code text-[11px] text-muted-foreground">{x.id}</span>
                      {x.stake ? (
                        <span className="money text-[12px] font-semibold" title={x.stake.label}>
                          {usd(x.stake.amountCents)}
                        </span>
                      ) : null}
                      <span className="text-[11px] text-muted-foreground">
                        {label(x.source)} · {ago(x.createdAt)}
                        {x.status === 'ACKNOWLEDGED' ? ` · acknowledged${x.owner ? ` by ${x.owner.name}` : ''}` : ''}
                      </span>
                    </div>
                    <p className="mt-1 leading-snug">{x.title}</p>
                    {x.explanation ? <Explanation explanation={x.explanation} /> : null}
                  </div>
                  <div className="flex flex-wrap items-center gap-1 md:justify-end">
                    {entityHref ? (
                      <Link
                        href={entityHref}
                        className="code inline-flex h-6 items-center rounded-sm border px-1.5 text-[11px] text-muted-foreground hover:bg-muted hover:text-foreground"
                      >
                        {x.entityId} <ChevronRight className="ml-0.5 size-3" />
                      </Link>
                    ) : null}
                    {x.correlationId ? (
                      <Button
                        size="sm"
                        variant="ghost"
                        className="h-6 px-1.5 text-[11px] text-muted-foreground"
                        onClick={() => setTrace(x.correlationId)}
                      >
                        Trace
                      </Button>
                    ) : null}
                    {canAct && jobBacked && definition.actions.includes('retry') ? (
                      <Button
                        size="sm"
                        variant="outline"
                        className="h-6 px-1.5 text-[11px]"
                        disabled={pending}
                        onClick={() =>
                          act(() => retryExceptionAction(x.id), 'Job re-armed. The exception closes when it completes.')
                        }
                      >
                        <RotateCcw className="mr-1 size-3" /> Retry
                      </Button>
                    ) : null}
                    {canAct && x.status === 'OPEN' ? (
                      <Button
                        size="sm"
                        variant="ghost"
                        className="h-6 px-1.5 text-[11px]"
                        disabled={pending}
                        onClick={() => act(() => acknowledgeExceptionAction(x.id), 'Acknowledged — it is yours.')}
                      >
                        Acknowledge
                      </Button>
                    ) : null}
                    {canAct && definition.actions.includes('resolve') ? (
                      <Button
                        size="sm"
                        variant="outline"
                        className="h-6 px-1.5 text-[11px]"
                        disabled={pending}
                        onClick={() =>
                          withNote(
                            'What was done? (goes in the audit trail)',
                            (note) => resolveExceptionAction(x.id, note),
                            'Resolved.',
                          )
                        }
                      >
                        Resolve
                      </Button>
                    ) : null}
                    {canAct && definition.actions.includes('ignore') ? (
                      <Button
                        size="sm"
                        variant="ghost"
                        className="h-6 px-1.5 text-[11px] text-muted-foreground"
                        disabled={pending}
                        onClick={() =>
                          withNote(
                            'Why is this acceptable? (goes in the audit trail)',
                            (note) => ignoreExceptionAction(x.id, note),
                            'Ignored.',
                          )
                        }
                      >
                        Ignore
                      </Button>
                    ) : null}
                  </div>
                </li>
              );
            })}
          </ul>
        </section>
      ))}

      <TraceDrawer correlationId={trace} onClose={() => setTrace(null)} />
    </div>
  );
}

/** The engineer's column and the office's column, one click apart from the title. */
export function Explanation({ explanation, open = false }: { explanation: ExceptionExplanation; open?: boolean }) {
  return (
    <details className="mt-1.5 group/x" open={open}>
      <summary className="cursor-pointer list-none text-[11px] text-muted-foreground hover:text-foreground">
        <span className="readout">system state</span> · <span className="readout">what this means</span>{' '}
        <span className="inline-block transition-transform group-open/x:rotate-90">›</span>
      </summary>
      {/* Two columns only when this block is wide enough for both: a 400px side panel stacks them. Judged by the
          block's own width, not the viewport, in pixels rather than a rem step (the root is 13px, so `@lg` is 416px). */}
      <div className="@container">
        <div className="mt-2 grid gap-3 rounded-sm border bg-muted/30 px-3 py-2 @min-[560px]:grid-cols-[minmax(0,1fr)_minmax(0,1.3fr)]">
          <dl className="grid min-w-0 grid-cols-[auto_minmax(0,1fr)] gap-x-3 gap-y-0.5 text-[11px]">
            {explanation.systemState.map((s) => (
              <Fragment key={s.key}>
                <dt className="readout whitespace-nowrap text-muted-foreground">{s.key}</dt>
                <dd className="code break-words text-[11px]">{s.value}</dd>
              </Fragment>
            ))}
          </dl>
          <p className="text-[12px] leading-relaxed">{explanation.meaning}</p>
        </div>
      </div>
    </details>
  );
}
