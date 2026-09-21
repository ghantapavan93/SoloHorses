'use client';

import Link from 'next/link';
import { useState, useTransition } from 'react';
import { toast } from 'sonner';
import { Check, Pencil, X } from 'lucide-react';
import { Chip } from '@/components/ask/chip';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { approveProposalAction, declineProposalAction } from '@/lib/actions';
import type { ProposalSummary } from '@/lib/types';
import { cn } from '@/lib/utils';

/**
 * The decision, short enough to read at a glance: what a yes does, in one line, what it will
 * never do, and the two verbs. The words come from the API's catalog, not from the model.
 * Nothing changes until someone clicks; approval re-reads the records first and refuses if
 * they moved (STALE), and the rule can still say no. Why it was prepared and what it read sit
 * behind a click.
 */
export function DecisionCard({
  proposal,
  onDecided,
  evidenceHref,
}: {
  proposal: ProposalSummary;
  onDecided: (status: string, note?: string, result?: Record<string, unknown>) => void;
  evidenceHref?: string | null;
}) {
  const [pending, start] = useTransition();
  const [editing, setEditing] = useState(false);
  const [body, setBody] = useState(
    typeof proposal.payload['body'] === 'string' ? (proposal.payload['body'] as string) : '',
  );
  const decided = proposal.status !== 'PROPOSED';
  const editable = typeof proposal.payload['body'] === 'string';

  const approve = (edits: { body?: string; note?: string } = {}) =>
    start(async () => {
      const res = await approveProposalAction(proposal.id, edits);
      if (!res.ok) return void toast.error(res.error);
      if (res.data.status === 'APPROVED') {
        toast.success(
          edits.body ? 'Approved with your edit. It ran under your name.' : 'Approved. It ran under your name.',
        );
        onDecided('APPROVED', edits.note, res.data.result);
      } else if (res.data.code === 'PROPOSAL_STALE') {
        toast.error('The records changed since this was prepared. Nothing ran; review the current evidence.');
        onDecided('STALE', 'Refused as stale: the records changed after it was prepared');
      } else {
        toast.error(`You approved; the rule refused: ${res.data.reason ?? ''}`);
        onDecided('DECLINED', `Refused by the rule: ${res.data.reason ?? ''}`);
      }
    });

  return (
    <div
      className={cn(
        'rounded-md border px-3 py-2 text-[13px] transition-[border-color,background-color] duration-[var(--dur-base)] ease-[var(--ease-out)]',
        proposal.status === 'PROPOSED'
          ? 'border-brand/40 bg-brand-tint/40'
          : proposal.status === 'APPROVED'
            ? 'border-ok/40'
            : proposal.status === 'STALE'
              ? 'border-warn/50'
              : 'border-border',
      )}
      data-testid={`decision-${proposal.id}`}
      data-status={proposal.status}
    >
      <p className="flex items-baseline gap-2 font-medium">
        <span className="min-w-0 flex-1">{proposal.spec.label}</span>
        <span
          className={cn(
            'shrink-0 text-[10px] uppercase tracking-wider',
            proposal.status === 'APPROVED'
              ? 'text-ok'
              : proposal.status === 'DECLINED'
                ? 'text-critical'
                : proposal.status === 'STALE'
                  ? 'text-warn'
                  : 'text-muted-foreground',
          )}
          data-testid="decision-status"
        >
          {proposal.status.toLowerCase()}
        </span>
      </p>
      <p
        className={cn(
          'mt-1.5 flex gap-2 text-[12.5px]',
          decided && proposal.status !== 'APPROVED' && 'text-muted-foreground line-through',
        )}
      >
        <span className="code shrink-0 text-ok">+</span>
        <span>{proposal.spec.after}</span>
      </p>
      <p className="mt-1 text-[12px] text-muted-foreground">
        <span className="readout">does not</span> {proposal.spec.willNot.join(' · ')}
      </p>

      {editing && !decided ? (
        <div className="mt-2 space-y-1.5">
          <Textarea
            value={body}
            onChange={(e) => setBody(e.target.value)}
            rows={4}
            className="text-[12px]"
            aria-label="The request, as you want it sent"
          />
          <p className="text-[11px] text-muted-foreground">
            Only the words change; the subject and the mare stay as prepared.
          </p>
        </div>
      ) : null}

      {!decided ? (
        <div className="mt-2 flex flex-wrap items-center gap-1.5">
          <Button
            size="sm"
            className="h-7 text-[12px]"
            disabled={pending || (editing && body.trim().length < 3)}
            onClick={() => approve(editing ? { body: body.trim() } : {})}
            data-testid="decision-approve"
          >
            <Check className="mr-1 size-3" /> {editing ? 'Approve with edit' : 'Approve'}
          </Button>
          {editable ? (
            <Button
              size="sm"
              variant="outline"
              className="h-7 text-[12px]"
              disabled={pending}
              onClick={() => setEditing((e) => !e)}
              data-testid="decision-edit"
            >
              <Pencil className="mr-1 size-3" /> {editing ? 'Keep as prepared' : 'Edit'}
            </Button>
          ) : null}
          <Button
            size="sm"
            variant="outline"
            className="h-7 text-[12px]"
            disabled={pending}
            data-testid="decision-reject"
            onClick={() =>
              start(async () => {
                const note = window.prompt('Why not? (goes in the audit trail)') ?? '';
                if (!note) return;
                const res = await declineProposalAction(proposal.id, note);
                if (res.ok) {
                  toast.success('Declined. Nothing changed.');
                  onDecided('DECLINED', note);
                } else toast.error(res.error);
              })
            }
          >
            <X className="mr-1 size-3" /> Decline
          </Button>
          <span className="self-center text-[11px] text-muted-foreground">under your name</span>
        </div>
      ) : (
        <p className={cn('mt-2 text-[12px]', proposal.status === 'STALE' ? 'text-warn' : 'text-muted-foreground')}>
          {proposal.status === 'STALE' ? (
            <>
              The records moved after this was prepared; nothing ran.{' '}
              {evidenceHref ? (
                <>
                  <Link href={evidenceHref} className="underline underline-offset-2">
                    Review the current evidence
                  </Link>{' '}
                  and ask again.{' '}
                </>
              ) : null}
            </>
          ) : null}
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

      <details className="mt-1 text-[11px] text-muted-foreground">
        <summary className="cursor-pointer list-none underline underline-offset-2 hover:text-foreground">
          why, and what it read
        </summary>
        <p className="mt-1">{proposal.rationale}</p>
        <dl className="mt-1 grid grid-cols-[auto_minmax(0,1fr)] gap-x-3 gap-y-0.5">
          <dt className="readout">before</dt>
          <dd>{proposal.spec.before}</dd>
          <dt className="readout">after</dt>
          <dd>{proposal.spec.after}</dd>
          <dt className="readout">approver</dt>
          <dd>
            {proposal.spec.approver} · risk {proposal.spec.riskClass.toLowerCase()}
          </dd>
        </dl>
        <div className="mt-1 flex flex-wrap gap-1">
          {proposal.evidenceIds.map((id) => (
            <Chip key={id} id={id} />
          ))}
        </div>
      </details>
    </div>
  );
}
