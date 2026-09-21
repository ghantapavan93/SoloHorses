import Link from 'next/link';
import { can } from '@daysheet/domain';
import { NotForRole } from '@/components/shell/not-for-role';
import { currentActor } from '@/lib/actor';
import { EvalControls } from '@/components/evals/eval-controls';
import { StatusPill } from '@/components/ui/status-pill';
import { apiFetch, apiFetchOrNull } from '@/lib/api';
import { dateTime, label, usd } from '@/lib/format';
import type { AskStatus, EvalCase, EvalRun, EvalRunDetail } from '@/lib/types';

export const metadata = { title: 'Evals' };

export default async function EvalsPage() {
  const actor = await currentActor();
  if (!can(actor, 'read', 'evals')) return <NotForRole page="Evals" role={actor.role} />;
  const [runs, cases, status] = await Promise.all([
    apiFetch<EvalRun[]>('/evals/runs'),
    apiFetch<EvalCase[]>('/evals/cases'),
    apiFetchOrNull<AskStatus>('/ask/status'),
  ]);
  const byCategory = cases.reduce<Record<string, EvalCase[]>>((acc, c) => {
    (acc[c.category] ??= []).push(c);
    return acc;
  }, {});
  const latest = runs[0];
  // The scorecard reads the latest finished run: per category, how many passed, and which failed and why.
  const finished = runs.find((r) => r.finishedAt);
  const detail = finished ? await apiFetchOrNull<EvalRunDetail>(`/evals/runs/${finished.id}`) : null;
  const scorecard = detail
    ? Object.entries(
        detail.results.reduce<
          Record<
            string,
            {
              passed: number;
              total: number;
              failed: { id: string; input: string; reason: string | null; messageId: string | null }[];
            }
          >
        >((acc, r) => {
          const row = (acc[r.case.category] ??= { passed: 0, total: 0, failed: [] });
          row.total += 1;
          if (r.passed) row.passed += 1;
          else
            row.failed.push({
              id: r.id,
              input: r.case.input,
              reason: r.reason,
              messageId:
                r.actual && 'messageId' in r.actual && typeof r.actual.messageId === 'string'
                  ? r.actual.messageId
                  : null,
            });
          return acc;
        }, {}),
      ).sort(([a], [b]) => a.localeCompare(b))
    : [];

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="eyebrow">Measuring Ask</p>
          <h1 className="text-2xl font-bold">Evals</h1>
          <p className="mt-1 text-[12px] text-muted-foreground">
            Real pipeline, deterministic grading, stored runs. A thumbs-down becomes a case.
          </p>
        </div>
        <EvalControls live={status?.live ?? false} cases={cases.filter((c) => c.enabled).length} />
      </div>

      {latest ? (
        <div className="grid gap-2 sm:grid-cols-4">
          <Stat
            label="Latest run"
            value={
              latest.finishedAt
                ? `${latest.passed} / ${latest.total}`
                : `${latest.graded ?? 0} of ${latest.total} graded`
            }
            sub={`${latest.finishedAt && latest.total > 0 ? `${Math.round((latest.passed / latest.total) * 100)}% · ` : ''}${latest.model}${latest.gitSha ? ` · ${latest.gitSha}` : ''}`}
          />
          <Stat
            label="When"
            value={dateTime(latest.startedAt)}
            sub={latest.finishedAt ? 'finished' : 'running · refresh to follow'}
          />
          <Stat
            label="Cost"
            value={latest.costCents !== null ? usd(latest.costCents) : '—'}
            sub="list price estimate"
          />
          <Stat
            label="Cases"
            value={String(cases.filter((c) => c.enabled).length)}
            sub={`${cases.filter((c) => c.source === 'FROM_FEEDBACK').length} from feedback`}
          />
        </div>
      ) : (
        <p className="rounded-md border border-dashed px-3 py-6 text-center text-[13px] text-muted-foreground">
          No runs yet.
          {status?.live
            ? ' Run the suite to see real results.'
            : ' Set ANTHROPIC_API_KEY on the API, or run a local Ollama model, to run the suite.'}
        </p>
      )}

      {detail && scorecard.length > 0 ? (
        <section className="rounded-md border" data-testid="eval-scorecard">
          <header className="flex flex-wrap items-baseline justify-between gap-2 border-b px-3 py-1.5">
            <h2 className="eyebrow">
              Scorecard · {detail.model} · {dateTime(detail.startedAt)}
            </h2>
            <span className="text-[11px] tabular-nums text-muted-foreground">
              {detail.passed} / {detail.total}
            </span>
          </header>
          <ul className="divide-y">
            {scorecard.map(([category, row]) => (
              <li key={category} className="px-3 py-1.5 text-[12px]">
                <div className="flex items-center gap-3">
                  <span className="w-[150px] shrink-0 font-medium">{label(category)}</span>
                  <span className="h-1.5 flex-1 overflow-hidden rounded-full bg-muted" aria-hidden>
                    <span
                      className={`block h-full ${row.passed === row.total ? 'bg-ok' : row.passed === 0 ? 'bg-critical' : 'bg-warn'}`}
                      style={{ width: `${Math.round((row.passed / row.total) * 100)}%` }}
                    />
                  </span>
                  <span
                    className={`w-[52px] shrink-0 text-right tabular-nums ${row.passed === row.total ? 'text-ok' : 'text-warn'}`}
                  >
                    {row.passed} / {row.total}
                  </span>
                </div>
                {row.failed.length > 0 ? (
                  <ul className="mt-1 space-y-0.5 pl-[162px] text-[11px]">
                    {row.failed.map((f) => (
                      <li key={f.id} className="text-muted-foreground">
                        <span className="text-foreground">“{f.input}”</span> — {f.reason ?? 'failed'}
                        {f.messageId ? (
                          <>
                            {' '}
                            ·{' '}
                            <Link href={`/runs/${f.messageId}`} className="underline underline-offset-2">
                              the run
                            </Link>
                          </>
                        ) : null}
                      </li>
                    ))}
                  </ul>
                ) : null}
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      <div className="grid gap-6 lg:grid-cols-[1fr_360px]">
        <section className="min-w-0 space-y-3">
          <h2 className="text-[13px] font-semibold">Cases</h2>
          {Object.entries(byCategory).map(([category, list]) => (
            <div key={category} className="space-y-1">
              <p className="eyebrow">{label(category)}</p>
              <ul className="divide-y rounded-md border">
                {list.map((c) => (
                  <li key={c.id} className={`px-3 py-2 text-[13px] ${c.enabled ? '' : 'opacity-50'}`}>
                    <div className="flex flex-wrap items-start justify-between gap-2">
                      <span>“{c.input}”</span>
                      <span className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
                        {label(c.actorRole)}
                        {c.source === 'FROM_FEEDBACK' ? <StatusPill tone="brand">from feedback</StatusPill> : null}
                      </span>
                    </div>
                    <p className="code mt-1 break-all text-[11px] text-muted-foreground">
                      {JSON.stringify(c.expected)}
                    </p>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </section>
        <aside className="space-y-2">
          <h2 className="text-[13px] font-semibold">Runs</h2>
          <ul className="divide-y rounded-md border text-[13px]">
            {runs.map((r) => (
              <li key={r.id}>
                <Link
                  href={`/evals/${r.id}`}
                  className="flex items-center justify-between gap-2 px-3 py-2 hover:bg-muted/60"
                >
                  <span>
                    <span className="tabular-nums">
                      {r.passed} / {r.total}
                    </span>
                    <span className="ml-2 text-muted-foreground">{dateTime(r.startedAt)}</span>
                  </span>
                  <StatusPill tone={r.total > 0 && r.passed === r.total ? 'ok' : r.finishedAt ? 'warn' : 'neutral'}>
                    {r.finishedAt ? `${r.total > 0 ? Math.round((r.passed / r.total) * 100) : 0}%` : 'running'}
                  </StatusPill>
                </Link>
              </li>
            ))}
            {runs.length === 0 ? <li className="px-3 py-3 text-muted-foreground">None yet.</li> : null}
          </ul>
        </aside>
      </div>
    </div>
  );
}

function Stat({ label: text, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="rounded-md border px-3 py-2">
      <p className="eyebrow">{text}</p>
      <p className="mt-1 text-[16px] font-semibold tabular-nums">{value}</p>
      {sub ? <p className="text-[11px] text-muted-foreground">{sub}</p> : null}
    </div>
  );
}
