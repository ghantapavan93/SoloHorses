import Link from 'next/link';
import { ArrowRight } from 'lucide-react';
import { AskEntry } from '@/components/ask/ask-entry';
import { ago, usd } from '@/lib/format';
import { cn } from '@/lib/utils';
import type { MorningBrief, MorningDecision } from '@/lib/types';

/** The barn's hour, for the one word the greeting changes. */
function greeting(generatedAt: string): string {
  const hour = Number(
    new Intl.DateTimeFormat('en-US', { hour: 'numeric', hour12: false, timeZone: 'America/Chicago' }).format(
      new Date(generatedAt),
    ),
  );
  return hour < 12 ? 'Good morning.' : hour < 17 ? 'Good afternoon.' : 'Good evening.';
}

const URGENCY: Record<MorningDecision['urgency'], string> = {
  now: 'bg-critical',
  today: 'bg-warn',
  watch: 'bg-muted-foreground/60',
};
const OWNER: Record<string, string> = {
  ADMIN: 'admin',
  STALLION_OFFICE: 'stallion office',
  RECIPS: 'recip farm',
  VET: 'vet',
  BILLING: 'billing',
};

/** "4 billing · 3 recip farm · 2 vet": the board by who takes the next step, largest first. */
function owners(byOwner: Record<string, number>): string {
  return Object.entries(byOwner)
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .map(([owner, n]) => `${n} ${OWNER[owner] ?? owner.toLowerCase()}`)
    .join(' · ');
}

/**
 * The front door's five seconds, with almost nothing to read: one sentence, one line of
 * numbers, one line to ask from with the three questions the board suggests, and the three
 * decisions to open first as rows — the record, the matter, who acts, the dollars. Every
 * figure is the board's own, read now; a row opens the signal it is.
 */
export function MorningBriefHero({
  brief,
  heading: Heading = 'h1',
  askEntry = true,
}: {
  brief: MorningBrief;
  heading?: 'h1' | 'h2' | 'h3';
  askEntry?: boolean;
}) {
  const n = brief.decisions;
  return (
    <section data-testid="morning-brief" aria-labelledby="morning-brief-heading" className="space-y-4">
      <div>
        <Heading id="morning-brief-heading" className="display text-[26px] leading-tight md:text-[30px]">
          {greeting(brief.generatedAt)}{' '}
          {n === 0
            ? 'Nothing needs a decision.'
            : `${n} decision${n === 1 ? '' : 's'} need${n === 1 ? 's' : ''} attention.`}
        </Heading>
        {/* Three facts, each its own container: who acts, what it holds up, what moved. */}
        <dl className="mt-3 grid gap-2 sm:grid-cols-3" data-testid="morning-brief-numbers">
          <div className="card-op px-3 py-2.5">
            <dt className="readout text-[10px] text-muted-foreground">
              {brief.viewer.role === 'ADMIN' ? 'by who acts next' : 'for you'}
            </dt>
            {brief.viewer.role === 'ADMIN' ? (
              // The founder owns every decision, so "need you" would repeat the headline; the split by who takes the next step says more.
              <dd className="mt-1 text-[13px] leading-snug text-foreground">{owners(brief.byOwner)}</dd>
            ) : (
              <dd className="mt-1 text-[13px] leading-snug">
                <span className="display text-[24px] leading-none tabular-nums text-foreground">{brief.needsYou}</span>{' '}
                <span className="text-muted-foreground">need{brief.needsYou === 1 ? 's' : ''} you</span>
              </dd>
            )}
          </div>
          <div className="card-op px-3 py-2.5">
            <dt className="readout text-[10px] text-muted-foreground">held up</dt>
            <dd className="mt-1 text-[13px] leading-snug">
              <span className="money text-[20px] font-semibold text-foreground">{usd(brief.atStakeCents)}</span>{' '}
              <span className="text-muted-foreground">at stake</span>
            </dd>
          </div>
          <div className="card-op px-3 py-2.5">
            <dt className="readout text-[10px] text-muted-foreground">
              {brief.snapshotId ? 'since yesterday' : 'in 24 h'}
            </dt>
            <dd className="mt-1 text-[13px] leading-snug">
              <span className="display text-[24px] leading-none tabular-nums text-foreground">
                {brief.changed.raised}
              </span>{' '}
              <span className="text-muted-foreground">raised · </span>
              <span className="display text-[24px] leading-none tabular-nums text-foreground">
                {brief.changed.resolved}
              </span>{' '}
              <span className="text-muted-foreground">resolved</span>
            </dd>
          </div>
        </dl>
      </div>

      {askEntry ? <AskEntry className="max-w-xl" prompts={brief.prompts} /> : null}

      {brief.top.length > 0 ? (
        <div>
          <p className="eyebrow mb-1">Needs you</p>
          <ol className="divide-y rounded-md border" aria-label="Open these first">
            {brief.top.map((d) => (
              <li key={d.id}>
                <Link
                  href={`/signals/${d.id}`}
                  data-testid="morning-decision"
                  className="row flex items-center gap-3 px-3 py-2 text-[13px] hover:bg-muted/40"
                >
                  <span className={cn('size-1.5 shrink-0 rounded-full', URGENCY[d.urgency])} aria-hidden />
                  <span className="code w-[92px] shrink-0 text-[12px]">{d.entityId ?? d.id}</span>
                  <span className="min-w-0 flex-1 truncate font-medium">{d.label}</span>
                  <span className="hidden readout text-muted-foreground sm:inline">
                    {OWNER[d.owner] ?? d.owner.toLowerCase()}
                  </span>
                  {d.stakeCents ? (
                    <span className="money hidden text-[12px] sm:inline">{usd(d.stakeCents)}</span>
                  ) : null}
                  <span className="hidden text-[11px] text-muted-foreground md:inline">{ago(d.createdAt)}</span>
                  <ArrowRight className="size-3.5 shrink-0 text-muted-foreground" aria-hidden />
                </Link>
              </li>
            ))}
          </ol>
        </div>
      ) : null}
    </section>
  );
}
