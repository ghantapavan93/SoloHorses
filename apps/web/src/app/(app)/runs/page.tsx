import Link from 'next/link';
import { can } from '@daysheet/domain';
import { NotForRole } from '@/components/shell/not-for-role';
import { currentActor } from '@/lib/actor';
import { AskCta } from '@/components/ask/ask-buttons';
import { apiFetch, apiFetchOrNull } from '@/lib/api';
import { ago, dateTime } from '@/lib/format';
import type { AskRunSummary, Story } from '@/lib/types';
import { cn } from '@/lib/utils';

export const metadata = { title: 'Runs' };

/**
 * The flight recorder's index: every answer the assistant gave, newest first, with what it
 * cost in time and whether the verifier let it through. Open one for the stages and the tools.
 */
export default async function RunsPage() {
  const actor = await currentActor();
  if (!can(actor, 'read', 'platform')) return <NotForRole page="Runs" role={actor.role} />;
  const [runs, story] = await Promise.all([apiFetch<AskRunSummary[]>('/ask/runs'), apiFetchOrNull<Story>('/story')]);
  const example = `Why can't ${story?.recip.id ?? 'R-0037'} leave?`;
  return (
    <div className="space-y-5">
      <div>
        <p className="eyebrow">
          Runs <span className="normal-case tracking-normal text-muted-foreground/70">· flight recorder</span>
        </p>
        <h1 className="text-2xl font-bold">
          {runs.length === 0 ? 'No runs yet' : `${runs.length} recent run${runs.length === 1 ? '' : 's'}`}
        </h1>
        <p className="mt-1 text-[12px] text-muted-foreground">
          Every answer, with where its time went and what the verifier removed. Measured by the graph as it ran, stored
          with the answer.
        </p>
      </div>
      <div className="overflow-x-auto rounded-md border">
        <table className="w-full text-[13px]">
          <thead className="bg-muted/60 text-left text-[11px] uppercase tracking-wider text-muted-foreground">
            <tr>
              <th className="px-3 py-2 font-medium">Question</th>
              <th className="px-3 py-2 font-medium">Model</th>
              <th className="px-3 py-2 text-right font-medium">Tools</th>
              <th className="px-3 py-2 text-right font-medium">Time</th>
              <th className="px-3 py-2 font-medium">Verifier</th>
              <th className="px-3 py-2 font-medium">When</th>
            </tr>
          </thead>
          <tbody className="divide-y">
            {runs.map((r) => (
              <tr key={r.id} className="h-9 hover:bg-muted/40">
                <td className="max-w-[420px] truncate px-3 py-1.5">
                  <Link href={`/runs/${r.id}`} className="underline-offset-2 hover:underline">
                    {r.question || '—'}
                  </Link>
                </td>
                <td className="px-3 py-1.5 text-muted-foreground">
                  {r.model ?? '—'}
                  {r.servedFromCache ? ' · cached' : ''}
                </td>
                <td className={cn('px-3 py-1.5 text-right tabular-nums', r.failedTools > 0 && 'text-warn')}>
                  {r.tools}
                  {r.failedTools > 0 ? ` (${r.failedTools} failed)` : ''}
                </td>
                <td className="px-3 py-1.5 text-right tabular-nums">
                  {r.latencyMs === null
                    ? '—'
                    : r.latencyMs >= 1000
                      ? `${(r.latencyMs / 1000).toFixed(2)} s`
                      : `${r.latencyMs} ms`}
                </td>
                <td className={cn('px-3 py-1.5', r.verified === false ? 'text-warn' : 'text-muted-foreground')}>
                  {r.verified === null ? '—' : r.verified ? 'passed' : 'removed claims'}
                </td>
                <td className="px-3 py-1.5 text-muted-foreground" title={dateTime(r.at)}>
                  {ago(r.at)}
                </td>
              </tr>
            ))}
            {runs.length === 0 ? (
              <tr>
                <td colSpan={6} className="px-3 py-8 text-center text-muted-foreground">
                  <span className="mr-3">No runs yet.</span>
                  <AskCta question={example}>Ask “{example}” to create one</AskCta>
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>
    </div>
  );
}
