'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';
import { toast } from 'sonner';
import { Play, Repeat, ScanSearch } from 'lucide-react';
import { TraceDrawer } from '@/components/platform/trace-drawer';
import { Button } from '@/components/ui/button';
import { buildRunEvalsAction, settlementReplayAction } from '@/lib/actions';
import { ago, dateTime } from '@/lib/format';
import type { AskStatus, BuildHealth, GauntletLine, LabStatus } from '@/lib/types';
import { cn } from '@/lib/utils';

/**
 * The honesty page's readout: what is running, what the last verify run counted, the last
 * event and the last trace — every number a row, every button the real thing. Where a run has
 * not happened on this machine the line says so rather than showing a green badge.
 */
/**
 * How the build was tried to be broken, each line PASS, FAILED or NOT RUN from an artifact on
 * disk — never a badge. The mutation, fuzz and accessibility passes are separate commands and carry
 * their own dates; the adversarial line is the last eval run's red-team categories.
 */
function GauntletReadout({ verify, lastEval }: { verify: BuildHealth['verify']; lastEval: BuildHealth['lastEval'] }) {
  const g = verify?.gauntlet ?? {};
  const adversarial: GauntletLine | undefined = lastEval?.adversarial
    ? {
        status: lastEval.adversarial.passed === lastEval.adversarial.total ? 'PASS' : 'FAILED',
        detail: `${lastEval.adversarial.passed} / ${lastEval.adversarial.total} red-team cases · ${lastEval.model}`,
        at: lastEval.at,
      }
    : undefined;
  const lines: [string, string, GauntletLine | undefined][] = [
    ['architecture', 'dependency-cruiser, eight rules', g.architecture],
    ['properties', 'fast-check over the domain rules', g.properties],
    ['mutation', 'Stryker over the critical rules', g.mutation],
    ['api fuzz', 'Schemathesis against /docs-json', g.fuzz],
    ['adversarial', 'red-team evals through the same gate', adversarial],
    ['accessibility', 'axe, WCAG 2.1 AA, eight pages', g.accessibility],
  ];
  const tone = (status?: GauntletLine['status']) =>
    status === 'PASS' ? 'text-ok' : status === 'FAILED' ? 'text-critical' : 'text-muted-foreground';
  return (
    <div className="border-t px-4 py-3">
      <p className="eyebrow">How we tried to break it</p>
      <ul className="mt-2 divide-y">
        {lines.map(([name, how, line]) => (
          <li key={name} className="grid grid-cols-[110px_64px_minmax(0,1fr)] items-baseline gap-3 py-1 text-[12px]">
            <span className="readout text-muted-foreground">{name}</span>
            <span className={cn('readout', tone(line?.status))}>{(line?.status ?? 'NOT RUN').toLowerCase()}</span>
            <span className="min-w-0 truncate">
              {line ? line.detail : how}
              {line?.at ? <span className="text-muted-foreground"> · {ago(line.at)}</span> : null}
              {!line ? <span className="text-muted-foreground"> · not run on this machine</span> : null}
            </span>
          </li>
        ))}
      </ul>
      <p className="mt-2 text-[12px] text-muted-foreground">
        One real discovery so far: two veterinary results of one kind on the same day gave a verdict that depended on
        the order the rows came back in — in one order the mare was cleared for a transfer. Found by the property suite,
        fixed (<span className="code">newestFirst</span>, A18), pinned by two example tests.
      </p>
    </div>
  );
}

export function BuildHealthPanel({
  health,
  lab,
  ask,
  signedIn,
}: {
  health: BuildHealth | null;
  lab: LabStatus | null;
  ask: AskStatus | null;
  signedIn: boolean;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [trace, setTrace] = useState<string | null>(null);
  const verify = health?.verify ?? null;
  const suites = verify?.suites ?? {};
  const services = [
    ...(lab?.services ?? [])
      .filter((s) => ['Equine API', 'PostgreSQL', 'Redis', 'BullMQ', 'Stripe', 'QuickBooks'].includes(s.name))
      .map((s) => ({ name: s.name, state: s.state, note: s.note })),
    {
      name: 'Review graph',
      state: ask?.review ? 'HEALTHY' : 'DOWN',
      note: ask?.review
        ? `${ask.review.graph} · ${ask.review.durable ? 'checkpoints in Postgres' : 'checkpoints in memory'}`
        : 'not reachable',
    },
  ];
  const mark = (state: string) => (state === 'HEALTHY' ? 'text-ok' : state === 'DOWN' ? 'text-critical' : 'text-warn');

  const replay = () => {
    if (!health?.lastStripeEvent) return;
    const eventId = health.lastStripeEvent.eventId;
    start(async () => {
      const res = await settlementReplayAction(eventId);
      if (res.ok)
        toast.success(
          `${eventId} delivered again: rejected as a duplicate (${res.data.deliveries} deliveries). Nothing moved.`,
        );
      else toast.error(res.error);
      router.refresh();
    });
  };
  const runEvals = () =>
    start(async () => {
      const res = await buildRunEvalsAction();
      if (res.ok)
        toast.success(
          `Evals started: ${res.data.total} cases on ${res.data.model}. The Evals page fills in as they are graded.`,
        );
      else toast.error(res.error);
      router.refresh();
    });

  return (
    <section className="rounded-md border">
      <div className="grid gap-0 md:grid-cols-[minmax(0,1.1fr)_minmax(0,1fr)]">
        <div className="border-b px-4 py-3 md:border-b-0 md:border-r">
          <p className="eyebrow">Build health · live</p>
          <ul className="mt-2 divide-y">
            {services.map((s) => (
              <li
                key={s.name}
                className="grid grid-cols-[110px_auto_minmax(0,1fr)] items-baseline gap-3 py-1 text-[12px]"
              >
                <span className="readout text-muted-foreground">{s.name}</span>
                <span className={cn('readout', mark(s.state))}>{s.state.toLowerCase()}</span>
                <span className="truncate text-[11px] text-muted-foreground">{s.note}</span>
              </li>
            ))}
            {services.length === 1 ? (
              <li className="py-2 text-[12px] text-muted-foreground">The API is not running; nothing to read.</li>
            ) : null}
          </ul>
        </div>
        <div className="px-4 py-3">
          <p className="eyebrow">
            Last verify run
            {verify
              ? ` · ${ago(verify.finishedAt)}${verify.commit ? ` · ${verify.commit}` : ''}${verify.dirty ? ' · with uncommitted changes' : ''}`
              : ''}
            {/* The proof must name the code it proves: when the process runs a later commit, the readout says so instead of letting the hash pass. */}
            {verify?.commit && health?.head && verify.commit !== health.head ? (
              <span className="text-warn"> · running {health.head}, not yet verified</span>
            ) : null}
          </p>
          {verify ? (
            <ul className="mt-2 divide-y">
              {[
                ['lint', verify.gates.lint],
                ['typecheck', verify.gates.typecheck],
                ['build', verify.gates.build],
              ].map(([name, gate]) => (
                <li key={String(name)} className="grid grid-cols-[110px_1fr] items-baseline gap-3 py-1 text-[12px]">
                  <span className="readout text-muted-foreground">{String(name)}</span>
                  <span
                    className={cn('readout', (gate as { ok: boolean } | undefined)?.ok ? 'text-ok' : 'text-critical')}
                  >
                    {(gate as { ok: boolean } | undefined)?.ok ? 'pass' : 'fail'}
                  </span>
                </li>
              ))}
              {Object.entries(suites).map(([name, suite]) => (
                <li key={name} className="grid grid-cols-[110px_1fr] items-baseline gap-3 py-1 text-[12px]">
                  <span className="readout text-muted-foreground">
                    {name === 'e2e' ? 'playwright' : `tests · ${name}`}
                  </span>
                  <span className={cn('tabular-nums', suite.ok ? 'text-ok' : 'text-critical')}>
                    {suite.passed} / {suite.total}
                  </span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="mt-2 text-[12px] text-muted-foreground">
              No verify run recorded on this machine. <span className="code">pnpm verify:report</span> writes one;
              nothing is shown that did not run.
            </p>
          )}
          {health?.lastEval ? (
            <p className="mt-2 text-[12px]">
              <span className="readout text-muted-foreground">evals</span>{' '}
              <span className="tabular-nums">
                {health.lastEval.passed} / {health.lastEval.total}
              </span>{' '}
              <span className="text-muted-foreground">
                · {health.lastEval.model} · {ago(health.lastEval.at)}
              </span>
            </p>
          ) : (
            <p className="mt-2 text-[12px] text-muted-foreground">
              <span className="readout">evals</span> no graded run in this environment yet
            </p>
          )}
        </div>
      </div>
      <GauntletReadout verify={verify} lastEval={health?.lastEval ?? null} />
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2 border-t px-4 py-2 text-[12px]">
        <span className="min-w-0">
          <span className="readout text-muted-foreground">last event</span>{' '}
          {health?.lastEvent ? (
            <>
              <span className="code">{health.lastEvent.type}</span>{' '}
              <span className="text-muted-foreground">
                {health.lastEvent.aggregateId} · {dateTime(health.lastEvent.at)}
              </span>
            </>
          ) : (
            <span className="text-muted-foreground">—</span>
          )}
        </span>
        <span className="min-w-0">
          <span className="readout text-muted-foreground">last trace</span>{' '}
          {health?.lastTrace?.correlationId ? (
            <button
              type="button"
              className="code underline-offset-2 hover:underline"
              onClick={() => setTrace(health.lastTrace?.correlationId ?? null)}
            >
              {health.lastTrace.correlationId}
            </button>
          ) : (
            <span className="text-muted-foreground">—</span>
          )}
        </span>
      </div>
      <div className="flex flex-wrap items-center gap-2 border-t bg-muted/30 px-4 py-2">
        <Button
          size="sm"
          variant="outline"
          className="h-7 text-[12px]"
          disabled={!health?.lastTrace?.correlationId}
          onClick={() => setTrace(health?.lastTrace?.correlationId ?? null)}
        >
          <ScanSearch className="mr-1 size-3" /> Open trace
        </Button>
        <Button
          size="sm"
          variant="outline"
          className="h-7 text-[12px]"
          disabled={pending || !health?.lastStripeEvent}
          onClick={replay}
        >
          <Repeat className="mr-1 size-3" /> Replay event{' '}
          {health?.lastStripeEvent ? (
            <span className="code ml-1 text-[10px] text-muted-foreground">{health.lastStripeEvent.eventId}</span>
          ) : null}
        </Button>
        {signedIn ? (
          <Button size="sm" variant="outline" className="h-7 text-[12px]" disabled={pending} onClick={runEvals}>
            <Play className="mr-1 size-3" /> Run evals
          </Button>
        ) : (
          <Link
            href="/login?next=/build"
            className="inline-flex h-7 items-center rounded-md border px-2 text-[12px] hover:bg-muted"
          >
            <Play className="mr-1 size-3" /> Run evals · sign in
          </Link>
        )}
      </div>
      <TraceDrawer correlationId={trace} onClose={() => setTrace(null)} />
    </section>
  );
}
