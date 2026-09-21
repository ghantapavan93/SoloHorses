import Link from 'next/link';
import { notFound } from 'next/navigation';
import { StatusPill } from '@/components/ui/status-pill';
import { apiFetchOrNull } from '@/lib/api';
import { dateTime, label, usd } from '@/lib/format';
import type { EvalRunDetail } from '@/lib/types';

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return { title: `Eval run ${id.slice(0, 8)}` };
}

export default async function EvalRunPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const run = await apiFetchOrNull<EvalRunDetail>(`/evals/runs/${encodeURIComponent(id)}`);
  if (!run) notFound();
  return (
    <div className="space-y-5">
      <div>
        <p className="eyebrow">
          <Link href="/evals" className="hover:underline">
            Evals
          </Link>{' '}
          · run
        </p>
        <h1 className="text-2xl font-bold">
          {run.passed} / {run.total} passed
        </h1>
        <p className="mt-1 text-[13px] text-muted-foreground">
          {run.model}
          {run.gitSha ? ` · ${run.gitSha}` : ''} · {dateTime(run.startedAt)}
          {run.costCents !== null ? ` · ${usd(run.costCents)}` : ''}
        </p>
      </div>
      <div className="flex flex-wrap gap-2">
        {Object.entries(run.byCategory).map(([cat, v]) => (
          <div key={cat} className="rounded-md border px-3 py-1.5 text-[12px]">
            <span className="eyebrow mr-2">{label(cat)}</span>
            <span className="tabular-nums">
              {v.passed}/{v.total}
            </span>
          </div>
        ))}
      </div>
      <ul className="space-y-2">
        {run.results.map((r) => (
          <li key={r.id} className="rounded-md border p-3 text-[13px]">
            <div className="flex flex-wrap items-start justify-between gap-2">
              <span>
                <StatusPill tone={r.passed ? 'ok' : 'critical'}>{r.passed ? 'pass' : 'fail'}</StatusPill>
                <span className="ml-2 eyebrow">{label(r.case.category)}</span>
                <span className="ml-2 text-muted-foreground">{label(r.case.actorRole)}</span>
              </span>
              <span className="text-[11px] text-muted-foreground">
                {r.latencyMs ? `${(r.latencyMs / 1000).toFixed(1)}s` : ''}
                {r.score !== null ? ` · score ${r.score.toFixed(2)}` : ''}
              </span>
            </div>
            <p className="mt-1">“{r.case.input}”</p>
            {r.reason ? <p className="mt-1 text-[12px] text-critical">{r.reason}</p> : null}
            {r.actual && 'messageId' in r.actual && typeof r.actual.messageId === 'string' ? (
              <p className="mt-1 text-[11px]">
                <Link href={`/runs/${r.actual.messageId}`} className="underline underline-offset-2">
                  the run
                </Link>{' '}
                — every stage and tool, with its time
              </p>
            ) : null}
            <details className="mt-1 text-[11px]">
              <summary className="cursor-pointer text-muted-foreground">expected · actual</summary>
              <pre className="mt-1 max-h-64 overflow-auto whitespace-pre-wrap rounded-sm bg-muted p-2 font-mono">
                {JSON.stringify({ expected: r.case.expected, actual: r.actual }, null, 2)}
              </pre>
            </details>
          </li>
        ))}
      </ul>
    </div>
  );
}
