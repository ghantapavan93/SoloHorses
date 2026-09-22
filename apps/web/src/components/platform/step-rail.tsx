'use client';

import { Check, X } from 'lucide-react';
import { Stagger, StaggerItem } from '@/components/motion/reveal';
import { cn } from '@/lib/utils';

/**
 * A sequence as a rail: the steps a thing must pass in its own order, each one done, current,
 * blocked or still to come, with the record or the rule's words under it. Wide, it is one line
 * read left to right, solid as far as things have got and dashed past that; narrow, the same
 * list stands on its side. One markup, so what a test or a reader finds is the same on a phone
 * and a desk. Every step is a record's state or a rule's verdict; nothing here is a picture.
 */
export type StepState = 'done' | 'current' | 'pending' | 'blocked';

export interface Step {
  key: string;
  title: string;
  /** Which system owns the step: the sale, the ledger, Stripe, the bank, a person. */
  system: string;
  state: StepState;
  note: string;
}

export function StepRail({ steps, label, className }: { steps: Step[]; label: string; className?: string }) {
  const n = steps.length;
  // The line runs from the first dot's centre to the last; the columns are equal, so a half column each side.
  const inset = `calc(50% / ${n})`;
  const reached = steps.reduce(
    (last, s, i) => (s.state === 'done' || s.state === 'current' || s.state === 'blocked' ? i : last),
    -1,
  );
  const solidShare = n > 1 ? Math.max(0, reached) / (n - 1) : 0;

  return (
    <Stagger
      as="ol"
      className={cn('relative ml-[9px] border-l md:ml-0 md:grid md:gap-x-2 md:border-l-0', className)}
      style={{ gridTemplateColumns: `repeat(${n}, minmax(0, 1fr))` }}
      label={label}
      step={0.06}
    >
      <span className="absolute top-[9px] hidden h-px md:block" style={{ left: inset, right: inset }} aria-hidden>
        <span className="absolute inset-y-0 left-0 bg-copper-2" style={{ width: `${solidShare * 100}%` }} />
        <span
          className="absolute inset-y-0 right-0 border-t border-dashed border-muted-foreground/60"
          style={{ width: `${(1 - solidShare) * 100}%` }}
        />
      </span>
      {steps.map((s, i) => (
        <StaggerItem
          key={s.key}
          as="li"
          className={cn(
            'relative pb-4 pl-6 last:pb-0 md:flex md:flex-col md:items-center md:pb-0 md:pl-0 md:pt-7 md:text-center',
            s.state === 'pending' && 'text-muted-foreground',
          )}
        >
          <span
            className={cn(
              'absolute -left-[9px] top-0.5 flex size-[18px] items-center justify-center rounded-full border-[1.5px] bg-background md:left-1/2 md:top-0 md:-translate-x-1/2',
              s.state === 'done' && 'border-ok bg-ok text-ok-foreground',
              s.state === 'current' && 'border-copper-2 bg-copper-2',
              s.state === 'blocked' && 'border-critical bg-critical text-critical-foreground',
              s.state === 'pending' && 'border-muted-foreground/60',
            )}
            aria-hidden
          >
            {s.state === 'current' ? (
              <span className="absolute -inset-1.5 rounded-full border border-copper-2/50 motion-safe:animate-ping [animation-duration:2.4s]" />
            ) : null}
            {s.state === 'done' ? <Check className="size-3" strokeWidth={3} /> : null}
            {s.state === 'blocked' ? <X className="size-3" strokeWidth={3} /> : null}
          </span>
          <span className="block w-full min-w-0 text-[12.5px] font-medium leading-tight">
            <span className="readout mr-1 text-[10px] text-muted-foreground">{String(i + 1).padStart(2, '0')}</span>
            {s.title}
          </span>
          <span className="readout mt-0.5 block w-full min-w-0 text-[10px] text-muted-foreground">{s.system}</span>
          <span
            className={cn(
              'mt-1 block w-full min-w-0 text-[11.5px] leading-snug [overflow-wrap:anywhere]',
              s.state === 'pending'
                ? 'text-muted-foreground/70'
                : s.state === 'blocked'
                  ? 'text-critical'
                  : 'text-muted-foreground',
            )}
          >
            {s.note}
          </span>
        </StaggerItem>
      ))}
    </Stagger>
  );
}
