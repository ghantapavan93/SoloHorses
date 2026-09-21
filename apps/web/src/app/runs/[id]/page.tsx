import Link from 'next/link';
import { notFound } from 'next/navigation';
import { FlightWaterfall } from '@/components/runs/flight-waterfall';
import { Code } from '@/components/record/timeline';
import { ThemeToggle } from '@/components/shell/theme-toggle';
import { apiFetchOrNull } from '@/lib/api';
import { auth } from '@/lib/auth';
import { ago, dateTime, label } from '@/lib/format';
import { currentTheme } from '@/lib/theme';
import type { FlightRecord } from '@/lib/types';
import { cn } from '@/lib/utils';

export const dynamic = 'force-dynamic';

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return { title: `Run ${id.slice(0, 12)}` };
}

const ms = (n: number) => (n >= 1000 ? `${(n / 1000).toFixed(2)} s` : `${Math.round(n)} ms`);
const STATUS_WORD: Record<FlightRecord['status'], string> = {
  ok: 'answered',
  refused: 'refused at the gate',
  waiting: 'waiting on a person',
  resumed: 'decided',
  failed: 'failed',
};

/**
 * One run, readable in ten seconds: what was asked, by whom, how long it took, what answered
 * (a model, or code), then every step on one axis — the gate, the authorization, each tool,
 * the composer, the verifier, the response, the pause for a person. Nothing here is a thought:
 * the record holds what ran, for how long, with what came back, masked where a string must
 * not travel.
 */
export default async function RunPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!/^[a-z0-9_]{6,60}$/i.test(id)) notFound();
  const [session, run, theme] = await Promise.all([
    auth(),
    apiFetchOrNull<FlightRecord>(`/ask/runs/${encodeURIComponent(id)}/flight`, { allowReviewer: true }),
    currentTheme(),
  ]);
  if (!run) notFound();
  const signedIn = Boolean(session?.user);
  const tools = run.steps.filter((s) => s.kind === 'tool');
  const failed = tools.filter((s) => s.status === 'failed').length;
  const gate = (path: string) => (signedIn ? path : `/login?next=${encodeURIComponent(path)}`);

  return (
    <main className="mx-auto max-w-3xl px-4 py-6 md:py-8">
      <nav
        aria-label="Where this run lives"
        className="mb-5 flex flex-wrap items-center justify-between gap-2 text-[12px] text-muted-foreground"
      >
        <span>
          <Link href="/" className="font-heading font-bold uppercase tracking-[0.18em] text-foreground">
            Daysheet
          </Link>{' '}
          · run · synthetic data
        </span>
        <span className="flex items-center gap-3">
          <Link href={gate('/runs')} className="underline">
            all runs
          </Link>
          <ThemeToggle theme={theme} />
        </span>
      </nav>

      <header className="mb-4">
        <p className="eyebrow">
          Run ·{' '}
          {run.provider.kind === 'deterministic'
            ? 'deterministic provider'
            : run.provider.kind === 'cache'
              ? 'answer cache'
              : run.provider.model}{' '}
          · {STATUS_WORD[run.status]} · {ago(run.finishedAt)}
        </p>
        <h1 className="mt-1 text-2xl font-bold tracking-tight" data-testid="run-question">
          “{run.question}”
        </h1>
        <p
          className="mt-1 flex flex-wrap items-baseline gap-x-3 gap-y-1 text-[12px] text-muted-foreground"
          data-testid="run-summary"
        >
          <span>
            <span className="tabular-nums font-medium text-foreground">{ms(run.durationMs)}</span> end to end
          </span>
          <span>{run.actor ? `${label(run.actor.role)}` : 'unknown actor'}</span>
          <span>
            {tools.length} tool{tools.length === 1 ? '' : 's'}
            {failed ? <span className="text-critical"> · {failed} failed</span> : ''}
          </span>
          {run.result ? (
            <span>
              verifier{' '}
              {run.result.verified === false ? (
                <span className="text-warn">removed {run.result.rejected}</span>
              ) : (
                'passed'
              )}
            </span>
          ) : null}
          {run.stateHash ? (
            <span>
              state <span className="code">{run.stateHash}</span>
            </span>
          ) : null}
          {run.redactions > 0 ? <span className="text-warn">{run.redactions} masked</span> : null}
          <span>{dateTime(run.finishedAt)}</span>
        </p>
      </header>

      <FlightWaterfall record={run} />

      <section className="mt-3 rounded-md border px-3 py-2 text-[12px]">
        <h2 className="eyebrow mb-1">Result</h2>
        {run.result ? (
          <>
            <p>{run.result.summary}</p>
            <p className="mt-1 text-muted-foreground">
              {run.result.statements} statement{run.result.statements === 1 ? '' : 's'} ·{' '}
              {run.result.abstentions.length} abstention{run.result.abstentions.length === 1 ? '' : 's'}
              {run.result.abstentions.length ? ` (${run.result.abstentions.join(', ')})` : ''} · {run.result.conflicts}{' '}
              conflict{run.result.conflicts === 1 ? '' : 's'}
            </p>
          </>
        ) : (
          <p className="text-muted-foreground">No structured answer stored.</p>
        )}
        {run.decisionRefs.length > 0 ? (
          <p className="mt-2">
            <span className="readout text-muted-foreground">prepared</span>{' '}
            {run.decisionRefs.map((p) => (
              <Link
                key={p.id}
                href={`/decisions/${p.id}`}
                className={cn('mr-2 underline underline-offset-2', p.status === 'PROPOSED' && 'text-warn')}
                data-testid="run-decision-link"
              >
                {p.kind.toLowerCase().replace(/_/g, ' ')} · {p.status.toLowerCase()}
              </Link>
            ))}
          </p>
        ) : null}
        <p className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px]">
          <Link href={gate(run.links.question)} className="underline underline-offset-2" data-testid="run-ask-again">
            ask it again
          </Link>
          {run.links.xray ? (
            <Link href={run.links.xray} className="underline underline-offset-2" data-testid="run-xray-link">
              the x-ray it read
            </Link>
          ) : null}
          <span className="text-muted-foreground">
            prompt {run.promptVersion ?? '—'} · run <Code id={run.runId} />
          </span>
        </p>
      </section>
    </main>
  );
}
