'use client';

import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';
import { toast } from 'sonner';
import { Check, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Code } from '@/components/record/timeline';
import { approveProposalAction, declineProposalAction } from '@/lib/actions';
import { label } from '@/lib/format';
import type { DecisionDiff } from '@/lib/types';
import { cn } from '@/lib/utils';

/**
 * The decision, short enough to read before the click: what it is, how many rows a yes
 * changes and which, what it will never do, the rule's word as it stands, who may say yes —
 * then the two verbs. Every fact is a read the proposal's fingerprint binds; when they move,
 * the diff says stale before anyone clicks, and the click is refused anyway. The full table of
 * what the rule read is one click down. Yes and no are the same calls the card makes.
 */
export function DecisionDiffPanel({
  diff,
  canDecide,
  className,
}: {
  diff: DecisionDiff;
  canDecide: boolean;
  className?: string;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [declining, setDeclining] = useState(false);
  const [note, setNote] = useState('');
  const waiting = diff.status === 'PROPOSED';
  const changes = diff.lines.filter((l) => l.changes);
  const facts = diff.lines.filter((l) => !l.changes);

  const approve = () =>
    start(async () => {
      const res = await approveProposalAction(diff.proposalId);
      if (!res.ok) return void toast.error(res.error);
      if (res.data.status === 'APPROVED') toast.success('Approved. It ran under your name.');
      else if (res.data.code === 'PROPOSAL_STALE')
        toast.error('The records changed since this was prepared. Nothing ran.');
      else toast.error(`You approved; the rule refused: ${res.data.reason ?? ''}`);
      router.refresh();
    });
  const decline = () =>
    start(async () => {
      const res = await declineProposalAction(diff.proposalId, note.trim() || 'Declined');
      if (!res.ok) return void toast.error(res.error);
      toast.success('Declined. Nothing ran.');
      setDeclining(false);
      router.refresh();
    });

  return (
    <section
      className={cn('rounded-md border', className)}
      data-testid="decision-diff"
      aria-labelledby="decision-diff-heading"
    >
      <header className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 border-b px-3 py-2">
        <p id="decision-diff-heading" className="eyebrow">
          Proposed change · {diff.subject}
        </p>
        <p className="text-[11px] text-muted-foreground">
          {diff.stale ? (
            <span className="text-warn" data-testid="decision-diff-stale">
              stale · the records moved since this was prepared; a yes is refused
            </span>
          ) : waiting ? (
            <span>
              bound to the records as they stand · <span className="code">{diff.stateHashNow}</span>
            </span>
          ) : (
            <span>{diff.status.toLowerCase()} · as the records stood at the click</span>
          )}
        </p>
      </header>

      <div className="space-y-2 px-3 py-2.5 text-[12.5px]">
        <p className="text-[14px] font-medium">
          {diff.label}{' '}
          <span className="text-[12px] font-normal text-muted-foreground">
            · {changes.length} change{changes.length === 1 ? '' : 's'}
          </span>
        </p>
        <ul className="space-y-1" aria-label="What a yes changes">
          {changes.map((line, i) => (
            <li key={i} className="flex flex-wrap items-baseline gap-x-2" data-testid="diff-change">
              <span className="code text-ok">+</span>
              <Code id={line.record} />
              <span className="readout text-muted-foreground">{line.field}</span>
              <span className="text-muted-foreground">{line.before}</span>
              <span aria-hidden>→</span>
              <span className="font-medium">{line.after}</span>
            </li>
          ))}
          {changes.length === 0 ? (
            <li className="text-muted-foreground">Nothing a yes would change is on the record.</li>
          ) : null}
        </ul>
        <p className="text-muted-foreground">
          <span className="readout">does not</span> {diff.willNot.join(' · ')}
        </p>
        <p className="flex flex-wrap items-baseline gap-x-3 gap-y-0.5">
          <span>
            <span className="readout text-muted-foreground">the rule, as it stands</span>{' '}
            {diff.rule ? (
              <>
                <span className="code">{diff.rule.code}</span>{' '}
                <span className={cn('readout', diff.rule.verdict === 'ok' ? 'text-ok' : 'text-warn')}>
                  {diff.rule.verdict}
                </span>
                {diff.rule.reason ? <span className="text-muted-foreground"> · {diff.rule.reason}</span> : null}
              </>
            ) : (
              <span className="text-muted-foreground">no rule reads this yet</span>
            )}
          </span>
          <span>
            <span className="readout text-muted-foreground">who may say yes</span>{' '}
            {diff.authority.roles.map(label).join(', ')}
          </span>
        </p>
      </div>

      {waiting && canDecide ? (
        <div className="flex flex-wrap items-center gap-2 border-t bg-muted/30 px-3 py-2">
          {declining ? (
            <>
              <input
                value={note}
                onChange={(e) => setNote(e.target.value)}
                placeholder="Why not (optional)"
                className="h-7 min-w-0 flex-1 rounded-md border bg-background px-2 text-[12px]"
                aria-label="Reason"
              />
              <Button
                size="sm"
                variant="outline"
                className="h-7 text-[12px]"
                disabled={pending}
                onClick={decline}
                data-testid="diff-decline-confirm"
              >
                Decline
              </Button>
              <Button
                size="sm"
                variant="ghost"
                className="h-7 text-[12px]"
                disabled={pending}
                onClick={() => setDeclining(false)}
              >
                Back
              </Button>
            </>
          ) : (
            <>
              <Button
                size="sm"
                variant="outline"
                className="h-7 text-[12px]"
                disabled={pending}
                onClick={() => setDeclining(true)}
                data-testid="diff-decline"
              >
                <X className="mr-1 size-3" /> Decline
              </Button>
              <Button
                size="sm"
                className="h-7 text-[12px]"
                disabled={pending || diff.stale}
                onClick={approve}
                data-testid="diff-approve"
              >
                <Check className="mr-1 size-3" /> Approve
              </Button>
              <span className="text-[11px] text-muted-foreground">
                {diff.stale
                  ? 'Stale: ask again from the current records.'
                  : 'Runs under your name; the rule runs again at the click.'}
              </span>
            </>
          )}
        </div>
      ) : null}

      <details className="border-t text-[12px]">
        <summary className="cursor-pointer list-none px-3 py-1.5 text-[11px] text-muted-foreground hover:text-foreground">
          the records the rule read · {diff.lines.length} row{diff.lines.length === 1 ? '' : 's'} · fingerprint{' '}
          <span className="code">{diff.stateHashAtProposal ?? '—'}</span>
        </summary>
        <table className="w-full border-t text-[12px]" aria-label="Before and after">
          <thead className="text-left text-[10px] uppercase tracking-[0.14em] text-muted-foreground">
            <tr>
              <th className="px-3 py-1.5 font-medium">record</th>
              <th className="px-3 py-1.5 font-medium">before</th>
              <th className="px-3 py-1.5 font-medium">after</th>
            </tr>
          </thead>
          <tbody className="divide-y">
            {[...changes, ...facts].map((line, i) => (
              <tr
                key={i}
                className={cn(line.changes ? 'bg-brand-tint/60' : 'text-muted-foreground')}
                data-testid={line.changes ? 'diff-change-row' : 'diff-fact'}
              >
                <td className="px-3 py-1.5 align-top">
                  <span className="flex flex-wrap items-baseline gap-x-2">
                    <Code id={line.record} />
                    <span className="readout text-muted-foreground">{line.field}</span>
                  </span>
                </td>
                <td className="px-3 py-1.5 align-top">{line.before}</td>
                <td className={cn('px-3 py-1.5 align-top', line.changes && 'font-medium text-foreground')}>
                  {line.changes ? line.after : <span className="text-muted-foreground/70">unchanged</span>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </details>
    </section>
  );
}
