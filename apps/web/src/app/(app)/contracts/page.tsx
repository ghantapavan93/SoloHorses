import Link from 'next/link';
import { can } from '@daysheet/domain';
import { NotForRole } from '@/components/shell/not-for-role';
import { currentActor } from '@/lib/actor';
import { StatusPill, toneForStatus } from '@/components/ui/status-pill';
import { apiFetch } from '@/lib/api';
import { day, label, usd } from '@/lib/format';
import type { Contract } from '@/lib/types';

export const metadata = { title: 'Contracts' };

export default async function ContractsPage() {
  const actor = await currentActor();
  if (!can(actor, 'read', 'contract')) return <NotForRole page="Contracts" role={actor.role} />;
  const rows = await apiFetch<Contract[]>('/contracts');
  return (
    <div className="space-y-4">
      <div>
        <p className="eyebrow">Stallion office</p>
        <h1 className="text-2xl font-bold">Contracts</h1>
        <p className="mt-1 text-[13px] text-muted-foreground">
          Reserve → deposit → signed → paid in full → shippable. Semen ships only from shippable.
        </p>
      </div>
      <div className="overflow-x-auto rounded-md border">
        <table className="w-full text-[13px]">
          <thead className="bg-muted/60 text-left text-[11px] uppercase tracking-wider text-muted-foreground">
            <tr>
              <th className="px-3 py-2 font-medium">Contract</th>
              <th className="px-3 py-2 font-medium">Customer</th>
              <th className="px-3 py-2 font-medium">Stallion</th>
              <th className="px-3 py-2 font-medium">Mare</th>
              <th className="px-3 py-2 font-medium">Type</th>
              <th className="px-3 py-2 font-medium">Status</th>
              <th className="px-3 py-2 text-right font-medium">Paid</th>
              <th className="px-3 py-2 text-right font-medium">Balance</th>
            </tr>
          </thead>
          <tbody className="divide-y">
            {rows.map((c) => {
              const total = c.depositCents + c.studFeeCents + c.chuteFeeCents;
              const paid = c.invoices
                .flatMap((i) => i.payments ?? [])
                .filter((p) => p.status === 'SUCCEEDED' || p.status === 'PARTIALLY_REFUNDED')
                .reduce((s, p) => s + p.amountCents - p.refundedCents, 0);
              return (
                <tr key={c.id} className="h-9 hover:bg-muted/40">
                  <td className="code px-3 py-1.5">
                    <Link className="hover:underline" href={`/contracts/${c.id}`}>
                      {c.id}
                    </Link>
                  </td>
                  <td className="px-3 py-1.5">
                    <Link className="hover:underline" href={`/customers/${c.customerId}`}>
                      {c.customer.displayName}
                    </Link>
                  </td>
                  <td className="px-3 py-1.5">
                    <Link className="horse-name hover:underline" href={`/horses/${c.stallion.id}`}>
                      {c.stallion.name}
                    </Link>
                  </td>
                  <td className="px-3 py-1.5">
                    {c.mare ? (
                      <Link className="hover:underline" href={`/horses/${c.mare.id}`}>
                        {c.mare.name}
                      </Link>
                    ) : (
                      <span className="text-muted-foreground">no mare yet</span>
                    )}
                  </td>
                  <td className="px-3 py-1.5 text-muted-foreground">{label(c.type)}</td>
                  <td className="px-3 py-1.5">
                    <StatusPill tone={toneForStatus(c.status)}>{label(c.status)}</StatusPill>
                    {c.signedAt ? (
                      <span className="ml-2 text-[11px] text-muted-foreground">signed {day(c.signedAt)}</span>
                    ) : null}
                  </td>
                  <td className="money px-3 py-1.5 text-right">{usd(paid)}</td>
                  <td className="money px-3 py-1.5 text-right">
                    {total - paid > 0 ? <span className="text-warn">{usd(total - paid)}</span> : '—'}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
