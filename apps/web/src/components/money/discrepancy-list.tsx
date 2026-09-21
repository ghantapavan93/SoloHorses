'use client';

import { useTransition } from 'react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { StatusPill } from '@/components/ui/status-pill';
import { resolveDiscrepancyAction } from '@/lib/actions';
import { dateTime, label, usd } from '@/lib/format';
import type { Discrepancy } from '@/lib/types';

const KIND_TEXT: Record<string, string> = {
  AMOUNT_MISMATCH: 'The amount in the books differs from ours.',
  CUSTOMER_MISMATCH: 'Filed under a different customer in the books.',
  MISSING_REMOTE: 'We have it; the books do not.',
  MISSING_LOCAL: 'The books have it; we do not.',
  UNLINKED_PAYMENT: 'The payment is in the books but not applied to its invoice.',
  SYNC_FAILED: 'The accounting system rejected the push.',
};

const RESOLUTIONS: { value: string; label: string; hint: string; for: string[] }[] = [
  {
    value: 'REPUSH_LOCAL',
    label: 'Re-push ours',
    hint: 'Our ledger is right; update the books.',
    for: ['AMOUNT_MISMATCH', 'CUSTOMER_MISMATCH', 'MISSING_REMOTE', 'UNLINKED_PAYMENT', 'SYNC_FAILED'],
  },
  {
    value: 'ACCEPT_REMOTE',
    label: 'Accept the books',
    hint: 'The books are right; update our invoice amount.',
    for: ['AMOUNT_MISMATCH'],
  },
  {
    value: 'RETRY',
    label: 'Retry',
    hint: 'Transient failure; try the sync again.',
    for: ['SYNC_FAILED', 'MISSING_REMOTE'],
  },
  {
    value: 'IGNORE',
    label: 'Ignore',
    hint: 'Known and acceptable; stop flagging it.',
    for: ['AMOUNT_MISMATCH', 'CUSTOMER_MISMATCH', 'MISSING_REMOTE', 'MISSING_LOCAL', 'UNLINKED_PAYMENT', 'SYNC_FAILED'],
  },
];

function money(v: Record<string, unknown> | null): string {
  if (!v) return '—';
  const cents = (v['amountCents'] ?? v['totalCents'] ?? v['netCents']) as number | undefined;
  if (typeof cents === 'number') return usd(cents);
  return JSON.stringify(v);
}

/** Two systems disagree about money. A person decides, with a reason, and it is audited. */
export function DiscrepancyList({ rows }: { rows: Discrepancy[] }) {
  const [pending, start] = useTransition();
  const resolve = (id: string, resolution: string) =>
    start(async () => {
      const note = window.prompt(`Note for the audit trail (optional) — ${label(resolution)}`) ?? null;
      const res = await resolveDiscrepancyAction(id, resolution, note || null);
      if (!res.ok) return void toast.error(res.error);
      toast.success(`Resolved · ${label(resolution)}`);
    });

  const open = rows.filter((r) => !r.resolvedAt);
  const closed = rows.filter((r) => r.resolvedAt);

  return (
    <div className="space-y-4">
      {open.length === 0 ? (
        <p className="rounded-md border border-dashed px-3 py-6 text-center text-[13px] text-muted-foreground">
          No open discrepancies. Run a reconcile to check again.
        </p>
      ) : null}
      <ul className="space-y-2">
        {open.map((d) => (
          <li key={d.id} className="rounded-md border p-3 text-[13px]">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <span className="flex items-center gap-2">
                <StatusPill tone="warn">{label(d.kind)}</StatusPill>
                <span className="code">
                  {d.entityType.toLowerCase()} · {d.entityId}
                </span>
              </span>
              <span className="text-[11px] text-muted-foreground">detected {dateTime(d.detectedAt)}</span>
            </div>
            <p className="mt-1 text-muted-foreground">{KIND_TEXT[d.kind] ?? ''}</p>
            <div className="mt-2 grid grid-cols-2 gap-2 text-[12px]">
              <div className="rounded-sm bg-muted px-2 py-1">
                <span className="text-muted-foreground">Ours </span>
                <span className="money break-all">{money(d.localValue)}</span>
              </div>
              <div className="rounded-sm bg-muted px-2 py-1">
                <span className="text-muted-foreground">Books </span>
                <span className="money break-all">{money(d.remoteValue)}</span>
              </div>
            </div>
            <div className="mt-2 flex flex-wrap gap-1.5">
              {RESOLUTIONS.filter((r) => r.for.includes(d.kind)).map((r) => (
                <Button
                  key={r.value}
                  size="sm"
                  variant={r.value === 'REPUSH_LOCAL' ? 'default' : 'outline'}
                  className="h-7 text-[12px]"
                  disabled={pending}
                  onClick={() => resolve(d.id, r.value)}
                  title={r.hint}
                >
                  {r.label}
                </Button>
              ))}
            </div>
          </li>
        ))}
      </ul>
      {closed.length > 0 ? (
        <details className="text-[12px]">
          <summary className="cursor-pointer text-muted-foreground">{closed.length} resolved</summary>
          <ul className="mt-2 divide-y rounded-md border">
            {closed.map((d) => (
              <li key={d.id} className="flex flex-wrap items-center justify-between gap-2 px-3 py-1.5">
                <span>
                  <span className="code">{d.entityId}</span> · {label(d.kind)} → <strong>{label(d.resolution)}</strong>
                  {d.note ? ` — ${d.note}` : ''}
                </span>
                <span className="text-muted-foreground">
                  {d.resolvedBy?.name ?? ''} · {dateTime(d.resolvedAt)}
                </span>
              </li>
            ))}
          </ul>
        </details>
      ) : null}
    </div>
  );
}
