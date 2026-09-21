'use client';

import Link from 'next/link';
import { useState } from 'react';
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { Code } from '@/components/record/timeline';
import type { FlightRecord, FlightStep } from '@/lib/types';
import { cn } from '@/lib/utils';

const ms = (n: number) =>
  n >= 60_000 ? `${(n / 60_000).toFixed(1)} min` : n >= 1000 ? `${(n / 1000).toFixed(2)} s` : `${Math.round(n)} ms`;

const GLYPH: Record<FlightStep['status'], { mark: string; tone: string }> = {
  ok: { mark: '✓', tone: 'text-ok' },
  failed: { mark: '✗', tone: 'text-critical' },
  refused: { mark: '⊘', tone: 'text-warn' },
  waiting: { mark: '⏸', tone: 'text-warn' },
  resumed: { mark: '▶', tone: 'text-ok' },
};

const BAR: Record<FlightStep['kind'], string> = {
  policy: 'bg-muted-foreground/50',
  authorize: 'bg-muted-foreground/50',
  tool: 'bg-brand/70',
  model: 'bg-brand',
  compose: 'bg-muted-foreground/40',
  cache: 'bg-muted-foreground/40',
  verifier: 'bg-ok/70',
  response: 'bg-muted-foreground/50',
  pause: 'bg-warn/70',
  record: 'bg-ok/70',
};

/**
 * One run as a waterfall: a line per step — the mark, the name, the duration — and a bar on
 * one axis for where it sat in the run. A click opens the step's provenance: what went in,
 * what came out, the records, the fingerprint, the rule or tool, the masks, the error. The
 * pause for a person sits on the same axis, open until the click.
 */
export function FlightWaterfall({ record }: { record: FlightRecord }) {
  const [open, setOpen] = useState<FlightStep | null>(null);
  const t0 = Date.parse(record.startedAt);
  // The axis is the run's own duration; the pause for a person and the record after it sit past
  // the right edge as a nub, their length in the number beside them (minutes, not milliseconds).
  const span = Math.max(1, record.durationMs);
  return (
    <section className="rounded-md border" data-testid="flight-waterfall" aria-label="Steps">
      <ol className="divide-y text-[12px]">
        {record.steps.map((step) => {
          const offAxis = Date.parse(step.startedAt) - t0 >= span;
          const left = offAxis ? 98 : Math.max(0, Math.min(100, ((Date.parse(step.startedAt) - t0) / span) * 100));
          const width = offAxis ? 2 : Math.max(0.6, Math.min(100 - left, (step.durationMs / span) * 100));
          const glyph = GLYPH[step.status];
          return (
            <li key={step.seq}>
              <button
                type="button"
                onClick={() => setOpen(step)}
                className="grid w-full grid-cols-[16px_minmax(0,1fr)_72px] items-center gap-x-2 px-3 py-1.5 text-left hover:bg-muted/40 md:grid-cols-[16px_220px_minmax(0,1fr)_72px]"
                data-testid={`flight-step-${step.kind}`}
                aria-label={`${step.name} · ${ms(step.durationMs)} · ${step.status}`}
              >
                <span className={cn('font-mono text-[13px] leading-none', glyph.tone)} aria-hidden>
                  {glyph.mark}
                </span>
                <span className="min-w-0 truncate">
                  <span
                    className={cn(
                      step.kind === 'tool' || step.kind === 'model' ? 'code' : 'font-medium',
                      step.status === 'failed' && 'text-critical',
                    )}
                  >
                    {step.name}
                  </span>
                  {step.redactions > 0 ? (
                    <span className="ml-1.5 readout text-muted-foreground">{step.redactions} masked</span>
                  ) : null}
                  {step.status === 'waiting' ? <span className="ml-1.5 readout text-warn">waiting</span> : null}
                </span>
                <span className="relative hidden h-2 md:block" aria-hidden>
                  <span
                    className={cn(
                      'absolute top-0 h-2 rounded-sm',
                      BAR[step.kind],
                      step.status === 'failed' && 'bg-critical/70',
                    )}
                    style={{ left: `${left}%`, width: `${width}%` }}
                  />
                </span>
                <span className="tabular-nums text-right text-muted-foreground">{ms(step.durationMs)}</span>
              </button>
            </li>
          );
        })}
      </ol>
      <StepDrawer step={open} record={record} onClose={() => setOpen(null)} />
    </section>
  );
}

function StepDrawer({ step, record, onClose }: { step: FlightStep | null; record: FlightRecord; onClose: () => void }) {
  return (
    <Sheet open={step !== null} onOpenChange={(next) => (next ? undefined : onClose())}>
      <SheetContent
        side="right"
        className="flex w-full flex-col gap-0 p-0 sm:max-w-[440px]"
        data-testid="flight-drawer"
      >
        <SheetHeader className="border-b px-4 py-3">
          <SheetTitle className="text-[14px]">{step?.name ?? ''}</SheetTitle>
          <SheetDescription className="text-[12px]">
            {step ? `${step.kind} · ${step.status} · ${ms(step.durationMs)}` : ''}
          </SheetDescription>
        </SheetHeader>
        {step ? (
          <div className="flex-1 space-y-3 overflow-y-auto px-4 py-4 text-[12px]">
            <p>{step.summary}</p>
            <dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-3 gap-y-1">
              {step.provenance.tool ? (
                <>
                  <dt className="readout text-muted-foreground">tool</dt>
                  <dd className="code">
                    {step.provenance.tool}
                    {step.provenance.toolVersion ? ` v${step.provenance.toolVersion}` : ''}
                  </dd>
                </>
              ) : null}
              {step.provenance.rule ? (
                <>
                  <dt className="readout text-muted-foreground">rule</dt>
                  <dd className="code break-all">{step.provenance.rule}</dd>
                </>
              ) : null}
              {step.provenance.input ? (
                <>
                  <dt className="readout text-muted-foreground">input</dt>
                  <dd className="font-mono break-all text-[11px]">{step.provenance.input}</dd>
                </>
              ) : null}
              {step.provenance.output ? (
                <>
                  <dt className="readout text-muted-foreground">output</dt>
                  <dd>{step.provenance.output}</dd>
                </>
              ) : null}
              {step.provenance.records.length > 0 ? (
                <>
                  <dt className="readout text-muted-foreground">records</dt>
                  <dd className="flex flex-wrap gap-1">
                    {step.provenance.records.map((r) => (
                      <Code key={r} id={r} />
                    ))}
                  </dd>
                </>
              ) : null}
              {step.provenance.stateHash ? (
                <>
                  <dt className="readout text-muted-foreground">state</dt>
                  <dd className="code">{step.provenance.stateHash}</dd>
                </>
              ) : null}
              {step.provenance.attempt && step.provenance.attempt > 1 ? (
                <>
                  <dt className="readout text-muted-foreground">attempt</dt>
                  <dd>{step.provenance.attempt} · after a failure</dd>
                </>
              ) : null}
              {step.provenance.error ? (
                <>
                  <dt className="readout text-warn">error</dt>
                  <dd className="text-critical">{step.provenance.error}</dd>
                </>
              ) : null}
              <dt className="readout text-muted-foreground">masked</dt>
              <dd>
                {step.redactions === 0
                  ? 'nothing sensitive in what travelled'
                  : `${step.redactions} sensitive field${step.redactions === 1 ? '' : 's'} masked before storing`}
              </dd>
              <dt className="readout text-muted-foreground">started</dt>
              <dd className="code">{step.startedAt.slice(11, 23)}</dd>
              {step.provenance.ref ? (
                <>
                  <dt className="readout text-muted-foreground">ref</dt>
                  <dd>
                    {step.kind === 'pause' ? (
                      <Link
                        href={`/decisions/${step.provenance.ref}`}
                        className="code underline-offset-2 hover:underline"
                      >
                        {step.provenance.ref}
                      </Link>
                    ) : (
                      <span className="code">{step.provenance.ref}</span>
                    )}
                  </dd>
                </>
              ) : null}
            </dl>
            {step.kind === 'model' ? (
              <p className="text-[11px] text-muted-foreground">
                {record.provider.kind === 'deterministic'
                  ? 'No model ran: the answer was composed in code from the tools above.'
                  : 'What the model was given and what it returned are the tools above and the answer below; no hidden reasoning is stored or shown.'}
              </p>
            ) : null}
          </div>
        ) : null}
      </SheetContent>
    </Sheet>
  );
}
