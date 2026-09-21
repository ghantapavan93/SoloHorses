'use client';

import { useRouter } from 'next/navigation';
import { useEffect, useRef, useState, useTransition } from 'react';
import { toast } from 'sonner';
import { Play, Power, RotateCcw } from 'lucide-react';
import { usePlatformStream } from '@/components/platform/use-platform-stream';
import { TraceDrawer } from '@/components/platform/trace-drawer';
import { Button } from '@/components/ui/button';
import { restoreAccountingAction, resumeWorkersAction, runScenarioAction } from '@/lib/actions';
import type { LabRun, LabScenario, LabScenarioInfo, LabStatus, PlatformSignalEnvelope } from '@/lib/types';
import { cn } from '@/lib/utils';

/** The four the sale's own workflow exercises first, then the platform's own failure modes. */
const ORDER: LabScenario[] = [
  'duplicate-webhook',
  'ach-settlement',
  'qbo-429',
  'source-conflict',
  'qbo-outage',
  'worker-crash',
  'stale-cache',
  'conflicting-record',
];

/**
 * Break the system, watch it recover. Every control drives the real pipeline; the log on
 * the right is the platform bus, unfiltered except by relevance. Nothing here is a
 * recording of a success.
 */
export function ReliabilityLab({
  status,
  scenarios,
}: {
  status: LabStatus;
  scenarios: Record<LabScenario, LabScenarioInfo>;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [active, setActive] = useState<LabScenario | null>(null);
  const [runs, setRuns] = useState<LabRun[]>([]);
  const [trace, setTrace] = useState<string | null>(null);
  const [log, setLog] = useState<PlatformSignalEnvelope[]>([]);
  const refreshTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const { connected } = usePlatformStream({
    onSignal: (signal) => {
      if (signal.kind === 'cache' && signal.op === 'hit') return; // too chatty to be useful here
      if (signal.kind === 'rate-limit') return;
      setLog((prev) => [...prev.slice(-299), signal]);
      if (signal.kind === 'breaker' || signal.kind === 'job' || signal.kind === 'exception') {
        if (refreshTimer.current) clearTimeout(refreshTimer.current);
        refreshTimer.current = setTimeout(() => router.refresh(), 600);
      }
    },
  });
  const logEnd = useRef<HTMLDivElement>(null);
  useEffect(() => {
    logEnd.current?.scrollIntoView({ block: 'end' });
  }, [log.length]);

  const run = (scenario: LabScenario) =>
    start(async () => {
      setActive(scenario);
      const res = await runScenarioAction(scenario);
      if (res.ok) {
        setRuns((prev) => [res.data, ...prev].slice(0, 12));
        toast.success(`${scenarios[scenario].title} — started`);
      } else toast.error(`${res.error}${res.correlationId ? ` · trace ${res.correlationId}` : ''}`);
      setActive(null);
    });

  const breakerOpen = status.breaker?.state === 'open' || status.breaker?.state === 'half-open';
  const outageArmed = status.faults.some((f) => f.kind === 'outage');

  return (
    <div className="grid gap-5 lg:grid-cols-[1fr_420px]">
      <div className="space-y-5">
        <section className="rounded-md border">
          <div className="flex flex-wrap items-center justify-between gap-2 border-b px-3 py-2">
            <p className="eyebrow">System health · from the platform’s own tables</p>
            <span className="readout text-muted-foreground">
              queue {status.jobs.mode} · {status.jobs.paused ? 'paused' : 'running'}
            </span>
          </div>
          {/* the readout: a name, a state, nothing decorative — what an operator scans in three seconds */}
          <div className="grid gap-0 md:grid-cols-[1fr_260px]">
            <ul className="divide-y">
              {status.services.map((s) => (
                <li key={s.name} className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-3 px-3 py-1.5">
                  <span className="min-w-0 truncate">
                    <span className="readout text-foreground">{s.name}</span>
                    <span className="ml-2 text-[11px] text-muted-foreground">{s.note}</span>
                  </span>
                  <span
                    className={cn(
                      'readout flex items-center gap-1.5',
                      s.state === 'HEALTHY' ? 'text-ok' : s.state === 'DOWN' ? 'text-critical' : 'text-warn',
                    )}
                  >
                    <span
                      className={cn(
                        'size-1.5 rounded-full',
                        s.state === 'HEALTHY' ? 'bg-ok' : s.state === 'DOWN' ? 'bg-critical' : 'bg-warn',
                      )}
                      aria-hidden
                    />
                    {s.state}
                  </span>
                </li>
              ))}
            </ul>
            <dl className="grid grid-cols-2 divide-x border-t md:grid-cols-1 md:divide-x-0 md:divide-y md:border-t-0 md:border-l">
              <div className="px-3 py-3">
                <dd className="text-[26px] font-semibold leading-none tabular-nums">
                  {(status.jobs.byStatus.QUEUED ?? 0) +
                    (status.jobs.byStatus.RETRYING ?? 0) +
                    (status.jobs.byStatus.ACTIVE ?? 0)}
                </dd>
                <dt className="readout mt-1.5 text-muted-foreground">jobs in flight</dt>
                <p className="mt-0.5 text-[11px] text-muted-foreground">
                  {status.jobs.byStatus.QUEUED ?? 0} queued · {status.jobs.byStatus.RETRYING ?? 0} retrying ·{' '}
                  {status.jobs.byStatus.DEAD ?? 0} dead-lettered
                </p>
              </div>
              <div className="px-3 py-3">
                <dd
                  className={cn(
                    'text-[26px] font-semibold leading-none tabular-nums',
                    status.lost === 0 ? 'text-ok' : 'text-critical',
                  )}
                >
                  {status.lost}
                </dd>
                <dt className="readout mt-1.5 text-muted-foreground">data lost</dt>
                <p className="mt-0.5 text-[11px] text-muted-foreground">
                  every job is a ledger row; a job that dies becomes an exception
                </p>
              </div>
            </dl>
          </div>
          {(breakerOpen || outageArmed || status.jobs.paused) && (
            <div className="flex flex-wrap items-center gap-2 border-t bg-muted/40 px-3 py-2 text-[12px]">
              {outageArmed ? (
                <Button
                  size="sm"
                  className="h-7 text-[12px]"
                  disabled={pending}
                  onClick={() =>
                    start(async () => {
                      const r = await restoreAccountingAction();
                      if (r.ok)
                        toast.success(
                          'QuickBooks restored. The circuit closes after its cooldown and one successful probe.',
                        );
                      else toast.error(r.error);
                    })
                  }
                >
                  <Power className="mr-1 size-3" /> Restore QuickBooks
                </Button>
              ) : null}
              {breakerOpen && status.breaker ? (
                <span className="text-muted-foreground">
                  circuit {status.breaker.state}
                  {status.breaker.retryAfterMs ? ` · probe in ${Math.ceil(status.breaker.retryAfterMs / 1000)}s` : ''}
                </span>
              ) : null}
              {status.jobs.paused ? (
                <Button
                  size="sm"
                  className="h-7 text-[12px]"
                  disabled={pending}
                  onClick={() =>
                    start(async () => {
                      const r = await resumeWorkersAction();
                      if (r.ok) toast.success('Worker online. The ledger drains.');
                      else toast.error(r.error);
                    })
                  }
                >
                  <RotateCcw className="mr-1 size-3" /> Restart the worker
                </Button>
              ) : null}
            </div>
          )}
        </section>

        <section className="rounded-md border">
          <div className="border-b px-3 py-2">
            <p className="eyebrow">Inject a failure · each one runs the real pipeline</p>
          </div>
          <ul className="divide-y">
            {ORDER.map((key, i) => {
              const s = scenarios[key];
              const disabled =
                pending ||
                !status.enabled ||
                (key !== 'worker-crash' && status.jobs.paused) ||
                (key === 'qbo-outage' && (outageArmed || breakerOpen));
              return (
                <li
                  key={key}
                  className={cn(
                    'row grid grid-cols-[28px_minmax(0,1fr)_auto] items-start gap-3 px-3 py-2.5',
                    active === key && 'bg-brand-tint',
                  )}
                >
                  <span className="code pt-0.5 text-muted-foreground">{String(i + 1).padStart(2, '0')}</span>
                  <span className="min-w-0">
                    <span className="block text-[13px] font-medium leading-snug">{s.title}</span>
                    <span className="mt-0.5 block text-[12px] text-muted-foreground">{s.claim}</span>
                    <span className="mt-0.5 block text-[11px] text-muted-foreground">
                      Simulated: {s.simulated.join('; ')}
                    </span>
                  </span>
                  <Button
                    size="sm"
                    variant="outline"
                    className="h-7 text-[12px]"
                    disabled={disabled}
                    onClick={() => run(key)}
                  >
                    <Play className="mr-1 size-3" /> Break it
                  </Button>
                </li>
              );
            })}
          </ul>
        </section>

        {runs.length > 0 ? (
          <section className="space-y-2">
            <p className="eyebrow">Runs</p>
            {runs.map((r) => (
              <div key={r.runId} className="rounded-md border p-3 text-[12px]">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="font-medium">{scenarios[r.scenario].title}</span>
                  <button
                    type="button"
                    className="code text-[11px] text-muted-foreground underline-offset-2 hover:underline"
                    onClick={() => setTrace(r.correlationId)}
                  >
                    trace {r.correlationId}
                  </button>
                </div>
                <ol className="mt-1.5 space-y-1">
                  {r.steps.map((step, i) => (
                    <li key={i} className="grid grid-cols-[14px_1fr] gap-1">
                      <span className="text-muted-foreground">{i + 1}.</span>
                      <span>
                        {step.step}
                        {step.detail && Object.keys(step.detail).length > 0 ? (
                          <span className="mt-0.5 block break-all font-mono text-[11px] text-muted-foreground">
                            {JSON.stringify(step.detail)}
                          </span>
                        ) : null}
                      </span>
                    </li>
                  ))}
                </ol>
              </div>
            ))}
          </section>
        ) : null}
      </div>

      <aside className="flex h-[70vh] min-h-[420px] flex-col rounded-md border lg:sticky lg:top-4">
        <div className="flex items-center justify-between border-b px-3 py-2">
          <p className="eyebrow">Live · platform bus</p>
          <span className={cn('text-[11px]', connected ? 'text-ok' : 'text-muted-foreground')}>
            {connected ? 'connected' : 'reconnecting…'}
          </span>
        </div>
        <ol className="flex-1 overflow-y-auto px-3 py-2 font-mono text-[11px] leading-relaxed">
          {log.length === 0 ? (
            <li className="text-muted-foreground">Waiting for something to happen. Break something.</li>
          ) : null}
          {log.map((s) => (
            <li key={s.seq} className="grid grid-cols-[62px_1fr] gap-2 border-b border-dashed py-0.5 last:border-0">
              <span className="text-muted-foreground">{s.at.slice(11, 19)}</span>
              <span className={cn(describeTone(s))}>{describe(s)}</span>
            </li>
          ))}
          <div ref={logEnd} />
        </ol>
      </aside>

      <TraceDrawer correlationId={trace} onClose={() => setTrace(null)} />
    </div>
  );
}

function describe(s: PlatformSignalEnvelope): string {
  switch (s.kind) {
    case 'job':
      return `job ${s.queue} ${s.status}${s.attempt ? ` #${s.attempt}` : ''} ${shorten(s.jobId)}${s.error ? ` — ${s.error.slice(0, 80)}` : ''}`;
    case 'event':
      return `event ${s.type} ${s.stage}${s.consumer ? ` → ${s.consumer}` : ''}${s.error ? ` — ${s.error.slice(0, 60)}` : ''}`;
    case 'breaker':
      return `circuit ${s.dependency} ${s.state.toUpperCase()} (failures ${s.failures})`;
    case 'cache':
      return `cache ${s.op} ${s.key}`;
    case 'exception':
      return `exception ${s.status} ${s.exceptionId} — ${s.title.slice(0, 90)}`;
    case 'integration':
      return `${s.dependency} ${s.op} → ${s.outcome.toUpperCase()}${s.httpStatus ? ` ${s.httpStatus}` : ''}${s.attempt ? ` (attempt ${s.attempt})` : ''}${s.retryAfterMs ? ` retry in ${s.retryAfterMs}ms` : ''}`;
    case 'lab':
      return `lab ${s.scenario}: ${s.step}`;
    case 'rate-limit':
      return `rate-limit ${s.route} ${s.outcome}`;
    default:
      return '';
  }
}

function describeTone(s: PlatformSignalEnvelope): string {
  if (s.kind === 'breaker') return s.state === 'closed' ? 'text-ok' : 'text-warn';
  if (s.kind === 'job')
    return s.status === 'dead'
      ? 'text-critical'
      : s.status === 'retrying'
        ? 'text-warn'
        : s.status === 'completed'
          ? 'text-ok'
          : '';
  if (s.kind === 'integration') return s.outcome === 'ok' ? 'text-ok' : 'text-warn';
  if (s.kind === 'exception') return s.status === 'opened' ? 'text-critical' : 'text-ok';
  if (s.kind === 'lab') return 'font-semibold';
  if (s.kind === 'cache') return s.op === 'poison' ? 'text-critical' : 'text-muted-foreground';
  return '';
}

function shorten(id: string): string {
  return id.length > 44 ? `${id.slice(0, 41)}…` : id;
}
