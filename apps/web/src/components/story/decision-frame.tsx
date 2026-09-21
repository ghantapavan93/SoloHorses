'use client';

import Link from 'next/link';
import { useState, useTransition } from 'react';
import { toast } from 'sonner';
import { Check, X } from 'lucide-react';
import { DecisionDiffPanel } from '@/components/decisions/decision-diff';
import { Button } from '@/components/ui/button';
import { approveProposalAction, declineProposalAction } from '@/lib/actions';
import { label } from '@/lib/format';
import type { DecisionDiff, ProposalSummary } from '@/lib/types';
import { cn } from '@/lib/utils';

/**
 * The decision, as three columns a person can read before the click: what stands now, what a
 * yes writes, and what it will never touch — then the two verbs. The words are the catalog's
 * and the diff's, never the model's; the yes and the no are the same calls every other screen
 * makes, and the rule runs again at the click. The full table of what the rule read waits
 * behind a disclosure.
 */
export function DecisionFrame({
  proposal,
  diff,
  onDecided,
}: {
  proposal: ProposalSummary;
  diff: DecisionDiff | null;
  onDecided: (status: string, note?: string, result?: Record<string, unknown>) => void;
}) {
  const [pending, start] = useTransition();
  const [declining, setDeclining] = useState(false);
  const [note, setNote] = useState('');
  const decided = proposal.status !== 'PROPOSED';
  const changes = diff?.lines.filter((l) => l.changes) ?? [];
  const stale = diff?.stale === true && proposal.status === 'PROPOSED';

  const approve = () =>
    start(async () => {
      const res = await approveProposalAction(proposal.id);
      if (!res.ok) return void toast.error(res.error);
      if (res.data.status === 'APPROVED') {
        toast.success('Approved. It ran under your name.');
        onDecided('APPROVED', undefined, res.data.result);
      } else if (res.data.code === 'PROPOSAL_STALE') {
        toast.error('The records changed since this was prepared. Nothing ran; review the current evidence.');
        onDecided('STALE', 'Refused as stale: the records changed after it was prepared');
      } else {
        toast.error(`You approved; the rule refused: ${res.data.reason ?? ''}`);
        onDecided('DECLINED', `Refused by the rule: ${res.data.reason ?? ''}`);
      }
    });
  const decline = () =>
    start(async () => {
      const res = await declineProposalAction(proposal.id, note.trim() || 'Declined');
      if (!res.ok) return void toast.error(res.error);
      toast.success('Declined. Nothing changed.');
      setDeclining(false);
      onDecided('DECLINED', note.trim() || 'Declined');
    });

  return (
    <div data-testid={`decision-${proposal.id}`} data-status={proposal.status}>
      <p className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <span className="text-[14px] font-medium text-paper">{proposal.spec.label}</span>
        <span className="code text-[11px] text-muted-foreground">{proposal.id}</span>
        <span
          className={cn(
            'readout text-[10px]',
            proposal.status === 'APPROVED'
              ? 'text-ok'
              : proposal.status === 'DECLINED'
                ? 'text-critical'
                : proposal.status === 'STALE' || stale
                  ? 'text-warn'
                  : 'text-muted-foreground',
          )}
          data-testid="decision-status"
        >
          {stale ? 'stale' : proposal.status.toLowerCase()}
        </span>
      </p>

      <div className="mt-3 grid gap-2 md:grid-cols-3">
        <div className="card-op px-3 py-2.5" data-testid="decision-before">
          <p className="readout text-[10px] text-muted-foreground">before</p>
          {changes.length > 0 ? (
            <ul className="mt-1 space-y-1 text-[12.5px]">
              {changes.map((l, i) => (
                <li key={i}>
                  <span className="code text-[11px] text-muted-foreground">
                    {l.record} · {l.field}
                  </span>
                  <span className="block text-paper">{l.before}</span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="mt-1 text-[12.5px] text-paper">{proposal.spec.before}</p>
          )}
        </div>
        <div className="card-op border-ok/40 px-3 py-2.5" data-testid="decision-after">
          <p className="readout text-[10px] text-ok">after a yes</p>
          {changes.length > 0 ? (
            <ul className="mt-1 space-y-1 text-[12.5px]">
              {changes.map((l, i) => (
                <li key={i}>
                  <span className="code text-[11px] text-muted-foreground">
                    {l.record} · {l.field}
                  </span>
                  <span className="block font-medium text-paper">{l.after}</span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="mt-1 text-[12.5px] font-medium text-paper">{proposal.spec.after}</p>
          )}
        </div>
        <div className="card-op px-3 py-2.5" data-testid="decision-does-not">
          <p className="readout text-[10px] text-muted-foreground">does not change</p>
          <ul className="mt-1 space-y-0.5 text-[12px] text-muted-foreground">
            {(diff?.willNot ?? proposal.spec.willNot).map((w) => (
              <li key={w} className="flex gap-1.5">
                <span aria-hidden>·</span>
                <span>{w}</span>
              </li>
            ))}
          </ul>
        </div>
      </div>

      <p className="mt-2 flex flex-wrap items-baseline gap-x-4 gap-y-0.5 text-[11.5px] text-muted-foreground">
        {diff?.rule ? (
          <span>
            <span className="readout">the rule, as it stands</span>{' '}
            <span className="code text-paper">{diff.rule.code}</span>{' '}
            <span className={cn('readout', diff.rule.verdict === 'ok' ? 'text-ok' : 'text-warn')}>
              {diff.rule.verdict}
            </span>
          </span>
        ) : null}
        <span>
          <span className="readout">who may say yes</span>{' '}
          {diff ? diff.authority.roles.map(label).join(', ') : proposal.spec.approver}
        </span>
        {diff ? (
          <span>
            <span className="readout">bound to</span> <span className="code">{diff.stateHashNow}</span>
          </span>
        ) : null}
      </p>

      {!decided ? (
        <div className="mt-3 flex flex-wrap items-center gap-2">
          {declining ? (
            <>
              <input
                value={note}
                onChange={(e) => setNote(e.target.value)}
                placeholder="Why not (goes in the audit trail)"
                className="h-8 min-w-0 flex-1 rounded-md border border-white/[0.14] bg-[rgb(9_7_6/0.6)] px-2 text-[12px]"
                aria-label="Reason"
              />
              <Button
                size="sm"
                variant="outline"
                className="h-8 text-[12px]"
                disabled={pending}
                onClick={decline}
                data-testid="decision-reject-confirm"
              >
                Decline
              </Button>
              <Button
                size="sm"
                variant="ghost"
                className="h-8 text-[12px]"
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
                className="h-8 text-[12px]"
                disabled={pending || stale}
                onClick={approve}
                data-testid="decision-approve"
              >
                <Check className="mr-1 size-3" /> Approve
              </Button>
              <Button
                size="sm"
                variant="outline"
                className="h-8 text-[12px]"
                disabled={pending}
                onClick={() => setDeclining(true)}
                data-testid="decision-reject"
              >
                <X className="mr-1 size-3" /> Decline
              </Button>
              <span className="text-[11px] text-muted-foreground">
                {stale
                  ? 'Stale: the records moved since this was prepared; ask again.'
                  : 'Runs under your name; the rule runs again at the click.'}
              </span>
            </>
          )}
        </div>
      ) : (
        <p className={cn('mt-3 text-[12px]', proposal.status === 'STALE' ? 'text-warn' : 'text-muted-foreground')}>
          {proposal.status === 'STALE' ? 'The records moved after this was prepared; nothing ran. ' : null}
          <Link
            href={`/decisions/${proposal.id}`}
            className="underline underline-offset-2"
            data-testid="decision-ledger-link"
          >
            The history
          </Link>
          : who decided, what ran, what became of it.
        </p>
      )}

      {diff ? (
        <details className="mt-3 text-[12px]">
          <summary className="cursor-pointer list-none text-[11px] text-muted-foreground underline underline-offset-2 hover:text-foreground">
            the records the rule read · {diff.lines.length} row{diff.lines.length === 1 ? '' : 's'} · why it was
            prepared
          </summary>
          <p className="mt-2 text-[12px] text-muted-foreground">{proposal.rationale}</p>
          <div className="mt-2">
            <DecisionDiffPanel diff={diff} canDecide={false} />
          </div>
        </details>
      ) : null}
    </div>
  );
}
