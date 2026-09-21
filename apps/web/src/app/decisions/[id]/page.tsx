import Link from 'next/link';
import { notFound } from 'next/navigation';
import { Code } from '@/components/record/timeline';
import { ThemeToggle } from '@/components/shell/theme-toggle';
import { DecisionDiffPanel } from '@/components/decisions/decision-diff';
import { DecisionTimeline } from '@/components/decisions/decision-timeline';
import { StatusPill } from '@/components/ui/status-pill';
import { apiFetchOrNull } from '@/lib/api';
import { auth } from '@/lib/auth';
import { ago, dateTime, label } from '@/lib/format';
import { currentTheme } from '@/lib/theme';
import type { DecisionDiff, DecisionLedger } from '@/lib/types';
import { cn } from '@/lib/utils';

export const dynamic = 'force-dynamic';

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return { title: `Decision ${id}` };
}

const TONE: Record<string, 'warn' | 'ok' | 'critical' | 'neutral'> = {
  PROPOSED: 'warn',
  APPROVED: 'ok',
  DECLINED: 'critical',
  STALE: 'neutral',
};
const STATUS_WORD: Record<string, string> = {
  PROPOSED: 'waiting on a person',
  APPROVED: 'approved',
  DECLINED: 'rejected',
  STALE: 'stale',
};

/**
 * One decision's ledger, addressable: the signal that started it, what the assistant looked at,
 * what it prepared, who decided, what ran, and what became of it. Every line is a row with its
 * time; a step without a row is absent, never filled in. The same five questions a reviewer
 * asks of any judgment: why, what did it know, what changed, who decided, what came of it.
 */
export default async function DecisionPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!/^(DEC-\d{2}-\d{4,6}|[a-z0-9]{10,40})$/i.test(id)) notFound();
  const [session, ledger, diff, theme] = await Promise.all([
    auth(),
    apiFetchOrNull<DecisionLedger>(`/proposals/${id}/ledger`, { allowReviewer: true }),
    apiFetchOrNull<DecisionDiff>(`/proposals/${id}/diff`, { allowReviewer: true }),
    currentTheme(),
  ]);
  if (!ledger) notFound();
  const signedIn = Boolean(session?.user);
  const { proposal, people, investigation, evidence, request } = ledger;
  const subject = ['recipId', 'embryoId', 'recipientId']
    .map((k) => proposal.payload[k])
    .filter((v): v is string => typeof v === 'string');

  return (
    <main className="mx-auto max-w-3xl px-4 py-6 md:py-8">
      <nav
        aria-label="Where this decision lives"
        className="mb-5 flex flex-wrap items-center justify-between gap-2 text-[12px] text-muted-foreground"
      >
        <span>
          <Link href="/" className="font-heading font-bold uppercase tracking-[0.18em] text-foreground">
            Daysheet
          </Link>{' '}
          · decision · synthetic data
        </span>
        <span className="flex items-center gap-3">
          <Link href={signedIn ? '/decisions' : '/login?next=/decisions'} className="underline">
            the ledger
          </Link>
          <ThemeToggle theme={theme} />
        </span>
      </nav>

      <header className="mb-4">
        <p className="eyebrow">
          {proposal.spec.label} · {STATUS_WORD[proposal.status] ?? proposal.status.toLowerCase()} · prepared{' '}
          {ago(proposal.createdAt)}
        </p>
        <h1 className="mt-1 text-2xl font-bold tracking-tight" data-testid="decision-title">
          {proposal.spec.after}
        </h1>
        <p className="mt-1 flex flex-wrap items-center gap-2 text-[12px] text-muted-foreground">
          <StatusPill tone={TONE[proposal.status] ?? 'neutral'}>
            {STATUS_WORD[proposal.status] ?? proposal.status}
          </StatusPill>
          <span>outcome: {ledger.outcome.label}</span>
          {subject.map((s) => (
            <Code key={s} id={s} />
          ))}
        </p>
      </header>

      {diff ? (
        <div
          className="frame-decision mb-4 overflow-hidden"
          data-state={diff.stale && diff.status === 'PROPOSED' ? 'STALE' : diff.status}
        >
          <DecisionDiffPanel diff={diff} canDecide={signedIn} className="rounded-none border-0" />
        </div>
      ) : null}
      <DecisionTimeline ledger={ledger} />

      <div className="mt-4 grid gap-3 md:grid-cols-2">
        <Panel title="Why?">
          {ledger.signals.length > 0 ? (
            <ul className="space-y-1">
              {ledger.signals.slice(0, 3).map((s) => (
                <li key={s.id} className="flex flex-wrap items-baseline gap-x-2">
                  <Link href={`/signals/${s.id}`} className="code underline-offset-2 hover:underline">
                    {s.id}
                  </Link>
                  <span className="text-muted-foreground">{s.title}</span>
                  <span className="readout text-muted-foreground">{s.status.toLowerCase()}</span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-muted-foreground">
              No signal on record about {subject.join(', ') || 'the subject'} at the time.
            </p>
          )}
          <p className="mt-2">{proposal.rationale}</p>
          {/* The diff above already shows before, after and will-not row by row; the words repeat only when there is no diff to read. */}
          {diff ? null : (
            <dl className="mt-2 grid grid-cols-[auto_minmax(0,1fr)] gap-x-3 gap-y-0.5">
              <dt className="readout text-muted-foreground">before</dt>
              <dd>{proposal.spec.before}</dd>
              <dt className="readout text-muted-foreground">after</dt>
              <dd>{proposal.spec.after}</dd>
              <dt className="readout text-muted-foreground">will not</dt>
              <dd className="text-muted-foreground">{proposal.spec.willNot.join(' · ')}</dd>
            </dl>
          )}
        </Panel>

        <Panel title="What did it know?">
          {investigation ? (
            <>
              {ledger.question ? <p className="rounded-md bg-muted px-2 py-1">“{ledger.question}”</p> : null}
              <ul className="mt-2 space-y-0.5 text-[11px]">
                {investigation.toolCalls.map((c, i) => (
                  <li key={i} className="flex items-center gap-2">
                    <span className={cn('size-1.5 rounded-full', c.ok ? 'bg-ok' : 'bg-warn')} aria-hidden />
                    <span className="code">{c.name}</span>
                    <span className="text-muted-foreground">
                      {c.records} record{c.records === 1 ? '' : 's'}
                    </span>
                    <span className="ml-auto tabular-nums text-muted-foreground">{c.durationMs} ms</span>
                  </li>
                ))}
              </ul>
              <div className="mt-2 flex flex-wrap gap-1">
                {investigation.evidenceIds.map((e) => (
                  <Code key={e} id={e} />
                ))}
              </div>
              <p className="mt-2 text-[11px] text-muted-foreground">
                {investigation.model ?? 'no model'} ·{' '}
                {investigation.latencyMs ? `${(investigation.latencyMs / 1000).toFixed(1)} s` : ''} ·{' '}
                <Link href={`/runs/${investigation.messageId}`} className="underline underline-offset-2">
                  the run
                </Link>
              </p>
            </>
          ) : (
            <p className="text-muted-foreground">Prepared without an Ask run on record.</p>
          )}
        </Panel>

        <Panel title="What changed?">
          <dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-3 gap-y-0.5">
            <dt className="readout text-muted-foreground">state then</dt>
            <dd className="code">{evidence.stateHashAtProposal ?? '—'}</dd>
            <dt className="readout text-muted-foreground">state now</dt>
            <dd className="code">{evidence.stateHashNow ?? '—'}</dd>
          </dl>
          <p
            className={cn('mt-2', evidence.moved ? 'text-warn' : 'text-muted-foreground')}
            data-testid="decision-moved"
          >
            {proposal.status === 'STALE'
              ? 'The records this was made from moved between the proposal and the click. The approval was refused for that reason; nothing ran.'
              : proposal.status === 'APPROVED'
                ? 'Unchanged at approval: the records were as shown when the person clicked; what it sent is the only change since.'
                : evidence.moved
                  ? 'The records this was made from have moved since; approving it now would be refused as stale.'
                  : 'The records this was made from are unchanged.'}
          </p>
          <div className="mt-2 flex flex-wrap gap-1">
            {evidence.ids.map((e) => (
              <Code key={e} id={e} />
            ))}
          </div>
        </Panel>

        <Panel title="Who decided?">
          {people.decidedBy ? (
            <p>
              <span className="font-medium">{people.decidedBy.name}</span> · {label(people.decidedBy.role)}
              {proposal.decidedAt ? (
                <span className="text-muted-foreground"> · {dateTime(proposal.decidedAt)}</span>
              ) : null}
            </p>
          ) : (
            <p className="text-muted-foreground">No one yet. A person with {proposal.spec.approver} rights decides.</p>
          )}
          {proposal.decision ? <p className="mt-1 text-muted-foreground">{proposal.decision}</p> : null}
          <p className="mt-2 text-[11px] text-muted-foreground">
            Prepared by{' '}
            {people.proposedBy ? `${people.proposedBy.name} (${label(people.proposedBy.role)})` : 'the assistant'} on
            the assistant’s behalf; executes through {proposal.spec.executes}.
          </p>
        </Panel>

        <Panel title="Outcome" className="md:col-span-2">
          <p
            className={ledger.outcome.state === 'awaiting' ? 'font-medium text-warn' : 'font-medium'}
            data-testid="decision-outcome"
          >
            {ledger.outcome.label}
          </p>
          {request ? (
            <div className="mt-2 rounded-md border px-3 py-2">
              <p className="flex flex-wrap items-center justify-between gap-2">
                <span className="font-medium">{request.subject}</span>
                <StatusPill tone={request.status === 'OPEN' ? 'warn' : 'neutral'}>{label(request.status)}</StatusPill>
              </p>
              <p className="mt-1 whitespace-pre-wrap text-muted-foreground">{request.body}</p>
            </div>
          ) : null}
          {ledger.signals[0] ? (
            <p className="mt-2 text-[11px] text-muted-foreground">
              The records as they stand now:{' '}
              <Link href={`/signals/${ledger.signals[0].id}`} className="underline underline-offset-2">
                the signal’s x-ray
              </Link>
              .
            </p>
          ) : null}
        </Panel>
      </div>
    </main>
  );
}

function Panel({ title, children, className }: { title: string; children: React.ReactNode; className?: string }) {
  return (
    <section className={cn('rounded-md border px-3 py-2 text-[12px]', className)}>
      <h2 className="eyebrow mb-1.5">{title}</h2>
      {children}
    </section>
  );
}
