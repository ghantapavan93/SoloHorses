'use client';

import Link from 'next/link';
import { ArrowRight, Sparkles } from 'lucide-react';
import { label } from '@/lib/format';
import type { Investigation } from '@/lib/types';
import { cn } from '@/lib/utils';

/**
 * An investigation, typed: the conclusion in the leading signal's own words, the rules that ran
 * with their verdicts, the person the chain waits for and why, and the doors — the X-ray, the
 * signal, the next step the assistant may prepare. Rendered from the x-ray tool's result, so
 * nothing here is the model's paraphrase; the prose answer sits beneath it for the detail.
 */
export function InvestigationResult({
  investigation,
  onAsk,
}: {
  investigation: Investigation;
  onAsk?: (question: string) => void;
}) {
  const blocked = investigation.rulesApplied.filter((r) => r.verdict === 'blocked');
  return (
    <section
      className="rounded-md border border-brand/30 bg-brand-tint/30 px-3 py-2 text-[13px]"
      data-testid="investigation"
      aria-label={`Investigation of ${investigation.subject}`}
    >
      <p className="flex flex-wrap items-baseline gap-x-2">
        <span className="eyebrow">Investigation</span>
        <span className="code text-muted-foreground">{investigation.subject}</span>
      </p>
      <p className="mt-1 font-medium leading-snug" data-testid="investigation-conclusion">
        {investigation.conclusion}
      </p>

      <dl className="mt-2 grid grid-cols-[auto_minmax(0,1fr)] gap-x-3 gap-y-1 text-[12px]">
        <dt className="readout text-muted-foreground">rules</dt>
        <dd className="flex flex-wrap gap-1">
          {investigation.rulesApplied.length === 0 ? <span className="text-muted-foreground">none ran</span> : null}
          {investigation.rulesApplied.map((rule) => (
            <span
              key={rule.code}
              className={cn(
                'inline-flex items-baseline gap-1 rounded-sm border px-1.5 py-0.5',
                rule.verdict === 'blocked' ? 'border-warn/50' : 'border-ok/40',
              )}
              title={rule.reason ?? rule.label}
            >
              <span className="code">{rule.code}</span>
              <span className={cn('readout', rule.verdict === 'blocked' ? 'text-warn' : 'text-ok')}>
                {rule.verdict}
              </span>
            </span>
          ))}
        </dd>
        {investigation.authority ? (
          <>
            <dt className="readout text-muted-foreground">waits for</dt>
            <dd>
              <span className="font-medium">{label(investigation.authority.owner)}</span> ·{' '}
              {investigation.authority.next.toLowerCase()}
              <span className="block text-muted-foreground">{investigation.authority.reason}</span>
            </dd>
          </>
        ) : (
          <>
            <dt className="readout text-muted-foreground">waits for</dt>
            <dd className="text-ok">nobody · nothing about her is open</dd>
          </>
        )}
      </dl>

      {investigation.availableActions.length > 0 ? (
        <div className="mt-2 flex flex-wrap gap-1.5" data-testid="investigation-actions">
          {investigation.availableActions.map((action) =>
            action.href ? (
              <Link
                key={action.label}
                href={action.href}
                className="inline-flex h-7 items-center gap-1 rounded-md border px-2.5 text-[12px] hover:bg-muted"
              >
                {action.label} <ArrowRight className="size-3" />
              </Link>
            ) : action.question && onAsk ? (
              <button
                key={action.label}
                type="button"
                className="inline-flex h-7 items-center gap-1 rounded-md bg-foreground px-2.5 text-[12px] font-medium text-background hover:opacity-90"
                onClick={() => onAsk(action.question ?? '')}
              >
                <Sparkles className="size-3" /> {action.label}
              </button>
            ) : null,
          )}
        </div>
      ) : null}
      <p className="mt-1.5 text-[10px] text-muted-foreground">
        {blocked.length} rule{blocked.length === 1 ? '' : 's'} blocking · state {investigation.stateHash}
      </p>
    </section>
  );
}
