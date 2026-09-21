import Link from 'next/link';
import { Code } from '@/components/record/timeline';
import { StatusPill } from '@/components/ui/status-pill';
import { apiFetch } from '@/lib/api';
import { dateTime, label } from '@/lib/format';
import type { TeamRequest } from '@/lib/types';

export const metadata = { title: 'Requests' };

export default async function RequestsPage() {
  const rows = await apiFetch<TeamRequest[]>('/requests');
  return (
    <div className="space-y-4">
      <div>
        <p className="eyebrow">Human handoff</p>
        <h1 className="text-2xl font-bold">Requests</h1>
        <p className="mt-1 text-[13px] text-muted-foreground">
          What Ask could not or should not answer, sent to a person with the records attached. The assistant never acts;
          people do.
        </p>
      </div>
      <ul className="space-y-2">
        {rows.map((r) => (
          <li key={r.id} className="rounded-md border p-3 text-[13px]">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <span className="font-medium">{r.subject}</span>
              <span className="flex items-center gap-2 text-[11px] text-muted-foreground">
                {r.createdBy ? `${r.createdBy.name} · ${label(r.createdBy.role)} · ` : ''}
                {dateTime(r.createdAt)}{' '}
                <StatusPill tone={r.status === 'OPEN' ? 'warn' : 'neutral'}>{label(r.status)}</StatusPill>
              </span>
            </div>
            <p className="mt-1 whitespace-pre-wrap text-muted-foreground">{r.body}</p>
            {r.evidenceIds.length > 0 ? (
              <div className="mt-2 flex flex-wrap gap-1">
                {r.evidenceIds.map((id) => (
                  <Code key={id} id={id} />
                ))}
              </div>
            ) : null}
          </li>
        ))}
        {rows.length === 0 ? (
          <li className="rounded-md border border-dashed px-3 py-8 text-center text-[13px] text-muted-foreground">
            No requests yet. Open{' '}
            <Link href="?" className="underline">
              Ask
            </Link>{' '}
            and use “Send to team”.
          </li>
        ) : null}
      </ul>
    </div>
  );
}
