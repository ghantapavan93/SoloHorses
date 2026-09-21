import { dateTime } from '@/lib/format';
import type { AuditRow } from '@/lib/types';

/** The append-only trail, as stored. Shown raw on purpose: this is what a reviewer wants to see. */
export function AuditList({ rows }: { rows: AuditRow[] }) {
  if (rows.length === 0) return <p className="text-[13px] text-muted-foreground">No audit rows.</p>;
  return (
    <ul className="divide-y rounded-md border text-[12px]">
      {rows.map((r) => (
        <li key={r.id} className="grid gap-x-3 gap-y-0.5 px-3 py-2 md:grid-cols-[150px_1fr_auto]">
          <span className="text-muted-foreground">{dateTime(r.at)}</span>
          <span>
            <span className="code">{r.action}</span>
            {r.after ? <span className="ml-2 text-muted-foreground">{compact(r.after)}</span> : null}
          </span>
          <span className="text-muted-foreground">
            {r.source}
            {r.actorRole ? ` · ${r.actorRole.toLowerCase().replace(/_/g, ' ')}` : ''}
          </span>
        </li>
      ))}
    </ul>
  );
}

function compact(value: unknown): string {
  const text = JSON.stringify(value);
  return text.length > 160 ? `${text.slice(0, 157)}…` : text;
}
