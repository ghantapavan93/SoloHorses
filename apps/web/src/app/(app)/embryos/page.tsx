import Link from 'next/link';
import { StatusPill, toneForStatus } from '@/components/ui/status-pill';
import { apiFetch } from '@/lib/api';
import { day, label } from '@/lib/format';
import type { EmbryoListItem } from '@/lib/types';

export const metadata = { title: 'Embryos' };

const STATUSES = ['', 'EXPECTED', 'ARRIVED', 'FROZEN', 'TRANSFERRED', 'PREGNANT', 'OPEN', 'LOST'];

export default async function EmbryosPage({ searchParams }: { searchParams: Promise<{ status?: string }> }) {
  const { status = '' } = await searchParams;
  const rows = await apiFetch<EmbryoListItem[]>(`/embryos${status ? `?status=${status}` : ''}`);
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="eyebrow">Records</p>
          <h1 className="text-2xl font-bold">Embryos</h1>
        </div>
        <nav className="flex flex-wrap gap-1" aria-label="Filter by status">
          {STATUSES.map((s) => (
            <Link
              key={s}
              href={s ? `/embryos?status=${s}` : '/embryos'}
              className={`rounded-md border px-2 py-1 text-[12px] ${status === s ? 'bg-foreground text-background' : 'hover:bg-muted'}`}
            >
              {s ? label(s) : 'all'}
            </Link>
          ))}
        </nav>
      </div>
      <div className="overflow-x-auto rounded-md border">
        <table className="w-full text-[13px]">
          <thead className="bg-muted/60 text-left text-[11px] uppercase tracking-wider text-muted-foreground">
            <tr>
              <th className="px-3 py-2 font-medium">Embryo</th>
              <th className="px-3 py-2 font-medium">Cross</th>
              <th className="px-3 py-2 font-medium">Owner</th>
              <th className="px-3 py-2 font-medium">Status</th>
              <th className="px-3 py-2 font-medium">Recip</th>
              <th className="px-3 py-2 font-medium">Last check</th>
            </tr>
          </thead>
          <tbody className="divide-y">
            {rows.map((e) => {
              const t = e.transfers[0];
              const c = t?.checks[0];
              return (
                <tr key={e.id} className="h-9 hover:bg-muted/40">
                  <td className="code px-3 py-1.5">
                    <Link className="hover:underline" href={`/embryos/${e.id}`}>
                      {e.id}
                    </Link>
                  </td>
                  <td className="px-3 py-1.5">
                    {e.sire?.name ?? e.sireName ?? '?'} x {e.dam?.name ?? e.damName ?? '?'}
                  </td>
                  <td className="px-3 py-1.5">
                    <Link className="hover:underline" href={`/customers/${e.customer.id}`}>
                      {e.customer.displayName}
                    </Link>
                  </td>
                  <td className="px-3 py-1.5">
                    <StatusPill tone={toneForStatus(e.status)}>{label(e.status)}</StatusPill>
                  </td>
                  <td className="px-3 py-1.5">
                    {t ? (
                      <Link className="hover:underline" href={`/horses/${t.recipient.id}`}>
                        Recip #{t.recipient.recipNumber ?? '?'}
                      </Link>
                    ) : (
                      <span className="text-muted-foreground">—</span>
                    )}
                  </td>
                  <td className="px-3 py-1.5 text-muted-foreground">
                    {c ? `day ${c.dayNumber} · ${label(c.result)} · ${day(c.performedOn)}` : '—'}
                  </td>
                </tr>
              );
            })}
            {rows.length === 0 ? (
              <tr>
                <td colSpan={6} className="px-3 py-8 text-center text-muted-foreground">
                  No embryos.
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>
    </div>
  );
}
