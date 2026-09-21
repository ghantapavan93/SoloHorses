import Link from 'next/link';
import { can } from '@daysheet/domain';
import { NotForRole } from '@/components/shell/not-for-role';
import { Code } from '@/components/record/timeline';
import { StatusPill } from '@/components/ui/status-pill';
import { currentActor } from '@/lib/actor';
import { AskCta } from '@/components/ask/ask-buttons';
import { apiFetch, apiFetchOrNull } from '@/lib/api';
import { ago, dateTime } from '@/lib/format';
import type { DecisionRow, Story } from '@/lib/types';

export const metadata = { title: 'Decisions' };

const TONE: Record<DecisionRow['status'], 'warn' | 'ok' | 'critical' | 'neutral'> = {
  PROPOSED: 'warn',
  APPROVED: 'ok',
  DECLINED: 'critical',
  STALE: 'neutral',
};
const STATUS_WORD: Record<DecisionRow['status'], string> = {
  PROPOSED: 'waiting',
  APPROVED: 'approved',
  DECLINED: 'rejected',
  STALE: 'stale',
};

function subjectOf(row: DecisionRow): string[] {
  return ['recipId', 'embryoId', 'recipientId']
    .map((k) => row.payload[k])
    .filter((v): v is string => typeof v === 'string');
}

/**
 * The decision ledger: every act the assistant prepared, who decided it, and what became of
 * it. A row here is a judgment on the record — the assistant's proposal, a person's yes or no,
 * the rule's last word — never a change made quietly.
 */
export default async function DecisionsPage() {
  const actor = await currentActor();
  if (!can(actor, 'read', 'operations')) return <NotForRole page="Decisions" role={actor.role} />;
  const [rows, story] = await Promise.all([
    apiFetch<DecisionRow[]>('/proposals?status=all'),
    apiFetchOrNull<Story>('/story'),
  ]);
  const waiting = rows.filter((r) => r.status === 'PROPOSED');
  return (
    <div className="space-y-5">
      <div>
        <p className="eyebrow">Decision history</p>
        <h1 className="text-2xl font-bold">
          {waiting.length === 0
            ? 'Nothing needs approval right now'
            : `${waiting.length} decision${waiting.length === 1 ? '' : 's'} wait${waiting.length === 1 ? 's' : ''} on a person`}
        </h1>
        <p className="mt-1 text-[12px] text-muted-foreground">
          What the assistant prepared, who decided, what ran, and what became of it. Every line is a row with its time.
        </p>
      </div>
      {rows.length === 0 && story ? (
        <div
          className="flex flex-wrap items-center gap-3 rounded-md border border-dashed px-4 py-4 text-[12.5px]"
          data-testid="decisions-empty"
        >
          <span className="text-muted-foreground">Try one — the assistant prepares it, you decide:</span>
          <AskCta question={`Prepare the vet request for ${story.recip.id}`}>
            Prepare the vet request for {story.recip.id}
          </AskCta>
        </div>
      ) : null}
      <div className="overflow-x-auto rounded-md border">
        <table className="w-full text-[13px]">
          <thead className="bg-muted/60 text-left text-[11px] uppercase tracking-wider text-muted-foreground">
            <tr>
              <th className="px-3 py-2 font-medium">State</th>
              <th className="px-3 py-2 font-medium">Prepared</th>
              <th className="px-3 py-2 font-medium">About</th>
              <th className="px-3 py-2 font-medium">Decided</th>
              <th className="px-3 py-2 font-medium">When</th>
            </tr>
          </thead>
          <tbody className="divide-y">
            {rows.map((r) => (
              <tr key={r.id} className="h-9 hover:bg-muted/40" data-testid={`decision-row-${r.id}`}>
                <td className="px-3 py-1.5">
                  <StatusPill tone={TONE[r.status]}>{STATUS_WORD[r.status]}</StatusPill>
                </td>
                <td className="px-3 py-1.5">
                  {/^DEC-/.test(r.id) ? (
                    <span className="code mr-2 text-[11px] text-muted-foreground">{r.id}</span>
                  ) : null}
                  <Link href={`/decisions/${r.id}`} className="font-medium underline-offset-2 hover:underline">
                    {r.spec.label}
                  </Link>
                  <span className="ml-2 text-[11px] text-muted-foreground">
                    {r.spec.riskClass.toLowerCase()} risk · approved by {r.spec.approver}
                  </span>
                </td>
                <td className="px-3 py-1.5">
                  <span className="flex flex-wrap gap-1">
                    {subjectOf(r).map((id) => (
                      <Code key={id} id={id} />
                    ))}
                  </span>
                </td>
                <td className="px-3 py-1.5 text-muted-foreground">
                  {r.decidedAt ? (r.decision ?? '').slice(0, 80) : 'waiting'}
                </td>
                <td className="px-3 py-1.5 text-muted-foreground" title={dateTime(r.createdAt)}>
                  {ago(r.createdAt)}
                </td>
              </tr>
            ))}
            {rows.length === 0 ? (
              <tr>
                <td colSpan={5} className="px-3 py-8 text-center text-muted-foreground">
                  No decisions on record yet.
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>
    </div>
  );
}
