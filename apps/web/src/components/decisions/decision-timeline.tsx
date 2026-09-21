'use client';

import Link from 'next/link';
import { useState } from 'react';
import { Code } from '@/components/record/timeline';
import { dateTime, label } from '@/lib/format';
import type { DecisionLedger, LedgerEvent } from '@/lib/types';
import { cn } from '@/lib/utils';

/**
 * One decision, read down the page: what happened, who did it, when, with what result — the
 * provenance (records, fingerprints, the rule, the correlation id) behind a click on the event.
 * Four different facts stay four: prepared, approved, executed, and the outcome, which is
 * awaited until the signal this began with closes.
 */
const RESULT_TONE: Record<LedgerEvent['result'], string> = {
  open: 'text-warn',
  read: 'text-muted-foreground',
  prepared: 'text-foreground',
  approved: 'text-ok',
  declined: 'text-critical',
  stale: 'text-warn',
  refused: 'text-critical',
  executed: 'text-ok',
  done: 'text-ok',
  resolved: 'text-ok',
  awaiting: 'text-warn',
};

/** The results worth a word on the row; the rest read from the label ("Approved" says approved). */
const NOTABLE: ReadonlySet<LedgerEvent['result']> = new Set(['stale', 'refused', 'declined', 'awaiting', 'open']);
/** Who did it, by kind, when the row carries no name. */
const ACTOR: Partial<Record<LedgerEvent['kind'], string>> = {
  investigated: 'Ask',
  prepared: 'Ask',
  executed: 'the rule',
};

function refHref(ref: string | null): string | null {
  if (!ref) return null;
  if (/^OX-/.test(ref)) return `/signals/${ref}`;
  if (/^ask_/.test(ref)) return `/runs/${ref}`;
  if (/^RQ-\d{2}-\d{4,}$/.test(ref)) return '/operations?tab=requests';
  return null;
}

export function DecisionTimeline({ ledger }: { ledger: DecisionLedger }) {
  const [open, setOpen] = useState<number | null>(null);
  const events = ledger.timeline;
  const outcome = ledger.outcome;
  return (
    <section className="rounded-md border" data-testid="decision-ledger" aria-labelledby="decision-ledger-heading">
      <header className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 border-b px-3 py-2">
        <p id="decision-ledger-heading" className="eyebrow">
          Decision history
        </p>
        <p className="text-[11px] text-muted-foreground">
          click a line for its provenance · fingerprint{' '}
          <span className="code">{ledger.summary.evidenceFingerprint ?? '—'}</span>
        </p>
      </header>
      <ol className="px-3 py-2">
        {events.map((e, i) => {
          const expanded = open === i;
          const href = refHref(e.ref);
          return (
            <li
              key={`${e.kind}-${i}`}
              className="grid grid-cols-[14px_minmax(0,1fr)] gap-x-3"
              data-testid={`ledger-${e.kind}`}
            >
              <span className="flex flex-col items-center">
                <span
                  className={cn(
                    'mt-[7px] size-2 shrink-0 rounded-full border',
                    e.result === 'approved' || e.result === 'executed' || e.result === 'resolved' || e.result === 'done'
                      ? 'border-ok bg-ok'
                      : e.result === 'declined' || e.result === 'refused'
                        ? 'border-critical bg-critical'
                        : e.result === 'stale' || e.result === 'open'
                          ? 'border-warn bg-warn'
                          : 'border-muted-foreground/60 bg-background',
                  )}
                  aria-hidden
                />
                {i < events.length - 1 || outcome.state !== 'verified' ? (
                  <span className="my-0.5 w-px flex-1 bg-border" aria-hidden />
                ) : null}
              </span>
              <div className="pb-2">
                <button
                  type="button"
                  onClick={() => setOpen(expanded ? null : i)}
                  aria-expanded={expanded}
                  className="grid w-full grid-cols-[auto_minmax(0,1fr)] items-baseline gap-x-3 rounded-sm py-0.5 text-left text-[12px] hover:bg-muted/40 md:grid-cols-[130px_minmax(0,1fr)]"
                  data-testid="ledger-event"
                >
                  <span className="tabular-nums text-muted-foreground" title={e.at}>
                    {dateTime(e.at)}
                  </span>
                  <span className="min-w-0">
                    <span className="font-medium">{e.label}</span>
                    <span className="text-muted-foreground">
                      {' '}
                      · {e.by ? e.by.name : (ACTOR[e.kind] ?? label(e.kind))}
                    </span>
                    {NOTABLE.has(e.result) ? (
                      <span className={cn('ml-2 readout', RESULT_TONE[e.result])}>{e.result}</span>
                    ) : null}
                  </span>
                </button>
                {expanded ? (
                  <dl
                    className="mt-1 grid grid-cols-[auto_minmax(0,1fr)] gap-x-3 gap-y-0.5 rounded-md bg-muted/40 px-2 py-1.5 text-[11px]"
                    data-testid="ledger-provenance"
                  >
                    <dt className="readout text-muted-foreground">detail</dt>
                    <dd className="text-[12px]">{e.detail || '—'}</dd>
                    {e.provenance.evidenceIds.length > 0 ? (
                      <>
                        <dt className="readout text-muted-foreground">records</dt>
                        <dd className="flex flex-wrap gap-1">
                          {e.provenance.evidenceIds.map((id) => (
                            <Code key={id} id={id} />
                          ))}
                        </dd>
                      </>
                    ) : null}
                    {e.provenance.stateHash ? (
                      <>
                        <dt className="readout text-muted-foreground">state</dt>
                        <dd className="code">{e.provenance.stateHash}</dd>
                      </>
                    ) : null}
                    {e.provenance.rule ? (
                      <>
                        <dt className="readout text-muted-foreground">rule</dt>
                        <dd className="code break-all">{e.provenance.rule}</dd>
                      </>
                    ) : null}
                    {e.provenance.executionRef ? (
                      <>
                        <dt className="readout text-muted-foreground">ran</dt>
                        <dd>
                          <Code id={e.provenance.executionRef} />
                        </dd>
                      </>
                    ) : null}
                    {e.provenance.correlationId ? (
                      <>
                        <dt className="readout text-muted-foreground">trace</dt>
                        <dd className="code">{e.provenance.correlationId}</dd>
                      </>
                    ) : null}
                    {e.provenance.auditId ? (
                      <>
                        <dt className="readout text-muted-foreground">audit row</dt>
                        <dd className="code">{e.provenance.auditId}</dd>
                      </>
                    ) : null}
                    {e.ref ? (
                      <>
                        <dt className="readout text-muted-foreground">row</dt>
                        <dd>
                          {href ? (
                            <Link href={href} className="code underline-offset-2 hover:underline">
                              {e.ref}
                            </Link>
                          ) : (
                            <Code id={e.ref} />
                          )}
                        </dd>
                      </>
                    ) : null}
                  </dl>
                ) : null}
              </div>
            </li>
          );
        })}
        {outcome.state !== 'verified' ? (
          <li className="grid grid-cols-[14px_minmax(0,1fr)] gap-x-3" data-testid="ledger-outcome-pending">
            <span className="flex flex-col items-center">
              <span
                className={cn(
                  'mt-[7px] size-2 rounded-full border',
                  outcome.state === 'awaiting' ? 'border-warn' : 'border-muted-foreground/60',
                )}
                aria-hidden
              />
            </span>
            <p className="grid grid-cols-[auto_minmax(0,1fr)] items-baseline gap-x-3 py-0.5 text-[12px] md:grid-cols-[130px_minmax(0,1fr)]">
              <span className="readout text-muted-foreground">now</span>
              <span>
                <span className="readout text-muted-foreground">outcome</span>{' '}
                <span className={cn(outcome.state === 'awaiting' ? 'text-warn' : 'text-muted-foreground')}>
                  {outcome.label}
                </span>
                {outcome.ref ? (
                  <>
                    {' '}
                    <Link href={`/signals/${outcome.ref}`} className="code underline-offset-2 hover:underline">
                      {outcome.ref}
                    </Link>
                  </>
                ) : null}
              </span>
            </p>
          </li>
        ) : null}
      </ol>
    </section>
  );
}
