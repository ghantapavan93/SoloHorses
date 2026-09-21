'use client';

import { useState } from 'react';
import { cn } from '@/lib/utils';

/**
 * How the assistant earns autonomy: five stages, each a promise about what it may do, and
 * the one this build sits on. The count under the lit stage is real — decisions a person
 * made on something the assistant prepared. Everything to the right is a hypothesis and
 * says so; nothing here is a roadmap with dates.
 */
export interface Stage {
  key: 'observe' | 'shadow' | 'assist' | 'propose' | 'execute';
  label: string;
  promise: string;
  /** What has to be measured and true before the next stage is allowed. */
  gate: string;
  state: 'built' | 'current' | 'hypothesis';
}

const STAGES: Stage[] = [
  {
    key: 'observe',
    label: 'Observe',
    promise: 'Reads the estate through typed tools and says what it sees, with the records cited.',
    gate: 'Every answer verified against the ids the tools returned; refusals decided in code before a model runs.',
    state: 'built',
  },
  {
    key: 'shadow',
    label: 'Shadow',
    promise:
      'Prepares what it would recommend and compares it with what the team actually decided, without influencing the decision.',
    gate: 'Agreement rate per decision kind, measured over real weeks — not asserted.',
    state: 'hypothesis',
  },
  {
    key: 'assist',
    label: 'Assist',
    promise:
      'Prepares information and drafts on request: the brief, the X-ray, a customer update from verified records.',
    gate: 'A person reads before anything leaves; the eval suite grades the boundaries every run.',
    state: 'built',
  },
  {
    key: 'propose',
    label: 'Propose',
    promise:
      'Prepares one act as a diff — before, after, what it will never do — and waits. Approval re-reads the records and refuses if they moved.',
    gate: 'One kind per catalog entry; the same rule-checked service the UI calls; a decision ledger with a name on every judgment.',
    state: 'current',
  },
  {
    key: 'execute',
    label: 'Execute',
    promise: 'Takes a step without waiting, for one narrow kind at a time.',
    gate: 'Only a kind whose shadow agreement and eval scores cross a threshold the operation sets — and never a clinical result, money, or a customer message.',
    state: 'hypothesis',
  },
];

export function AutonomyLadder({ decisions }: { decisions: { total: number; approved: number; stale: number } }) {
  const [open, setOpen] = useState<Stage['key']>('propose');
  const stage = STAGES.find((s) => s.key === open) ?? STAGES[3]!;
  return (
    <section className="rounded-md border" data-testid="autonomy-ladder">
      <div className="border-b px-4 py-3">
        <p className="eyebrow">How it earns autonomy</p>
        <h2 className="mt-1 text-[16px] font-semibold">Observe → Shadow → Assist → Propose → Execute</h2>
        <p className="mt-1 text-[12px] text-muted-foreground">
          This build sits on Propose, for one controlled kind. Each stage to the right is future: a gate to pass, not a
          date.
        </p>
      </div>
      <ol className="grid grid-cols-5 divide-x border-b" role="tablist" aria-label="Stages of autonomy">
        {STAGES.map((s) => (
          <li key={s.key} role="presentation">
            <button
              type="button"
              role="tab"
              id={`stage-tab-${s.key}`}
              aria-selected={open === s.key}
              aria-controls="stage-panel"
              className={cn(
                'flex w-full flex-col items-start gap-1 px-3 py-2.5 text-left transition-colors hover:bg-muted/50',
                open === s.key && 'bg-muted/60',
              )}
              onClick={() => setOpen(s.key)}
              data-testid={`stage-${s.key}`}
            >
              <span className="flex items-center gap-1.5">
                <span
                  className={cn(
                    'size-2 rounded-full',
                    s.state === 'current'
                      ? 'bg-warn ring-4 ring-warn/20'
                      : s.state === 'built'
                        ? 'bg-ok'
                        : 'border border-muted-foreground/60',
                  )}
                  aria-hidden
                />
                <span className={cn('text-[12px] font-medium', s.state === 'hypothesis' && 'text-muted-foreground')}>
                  {s.label}
                </span>
              </span>
              <span
                className={cn('readout text-[9px]', s.state === 'hypothesis' ? 'text-muted-foreground' : 'text-ok')}
              >
                {s.state === 'current' ? 'built · here' : s.state === 'built' ? 'built' : 'future'}
              </span>
            </button>
          </li>
        ))}
      </ol>
      <div
        className="grid gap-3 px-4 py-3 text-[12px] md:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]"
        role="tabpanel"
        id="stage-panel"
        aria-labelledby={`stage-tab-${open}`}
      >
        <div>
          <p className="eyebrow">
            {stage.label} ·{' '}
            {stage.state === 'current'
              ? 'built · where this build stands'
              : stage.state === 'built'
                ? 'built'
                : 'future'}
          </p>
          <p className="mt-1 leading-relaxed">{stage.promise}</p>
        </div>
        <div>
          <p className="eyebrow">the gate</p>
          <p className="mt-1 leading-relaxed text-muted-foreground">{stage.gate}</p>
          {stage.key === 'propose' ? (
            <p className="mt-2 tabular-nums" data-testid="ladder-count">
              <span className="font-medium">{decisions.total}</span> prepared ·{' '}
              <span className="font-medium">{decisions.approved}</span> approved by a person ·{' '}
              <span className="font-medium">{decisions.stale}</span> refused as stale
            </p>
          ) : null}
        </div>
      </div>
    </section>
  );
}

/** What comes after the ladder, each an idea about the same architecture; none of it is built. */
export const FUTURE_CARDS: { title: string; line: string }[] = [
  {
    title: 'Ranch capture',
    line: 'A photo or a voice note from the barn becomes a typed intake row a person confirms — the same inbox, the same rules.',
  },
  {
    title: 'Overnight operator',
    line: 'The brief written at 5 a.m. from the snapshot, with the night’s changes and the day’s blocked items, waiting on the board.',
  },
  {
    title: 'Preference memory',
    line: 'Stated preferences shape how answers are presented — never what a rule decides.',
  },
  {
    title: 'Model routing',
    line: 'A local model for the routine, a larger one for the hard question, chosen per question by the eval scores.',
  },
  {
    title: 'Shadow evaluation',
    line: 'Every decision the team makes, compared with what the assistant would have prepared, per kind, over weeks.',
  },
  {
    title: 'Estate adapters',
    line: 'The same typed tools over the operation’s own platform and books, behind the same policy layer, once the boundaries are agreed.',
  },
];
