import Link from 'next/link';
import { notFound } from 'next/navigation';
import { AuditList } from '@/components/record/audit-list';
import { Timeline } from '@/components/record/timeline';
import { RecordCheckDialog } from '@/components/record/check-dialog';
import { StatusPill, toneForStatus } from '@/components/ui/status-pill';
import { InvoiceActions } from '@/components/money/invoice-actions';
import { apiFetchOrNull } from '@/lib/api';
import { auth } from '@/lib/auth';
import { day, label, usd } from '@/lib/format';
import type { AuditRow, EmbryoPage, Health } from '@/lib/types';

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return { title: id };
}

export default async function EmbryoDetail({ params }: { params: Promise<{ id: string }> }) {
  const [{ id }, session] = await Promise.all([params, auth()]);
  const [page, health] = await Promise.all([
    apiFetchOrNull<EmbryoPage>(`/embryos/${encodeURIComponent(id)}`),
    apiFetchOrNull<Health>('/health'),
  ]);
  if (!page) notFound();
  const { embryo, timeline } = page;
  const role = session?.user.role ?? 'CUSTOMER';
  const audit =
    role === 'ADMIN' || role === 'BILLING'
      ? ((await apiFetchOrNull<AuditRow[]>(`/audit?entityType=Embryo&entityId=${encodeURIComponent(id)}`)) ?? [])
      : [];
  const latestTransfer = embryo.transfers[embryo.transfers.length - 1];
  const canRecordChecks =
    (role === 'VET' || role === 'ADMIN') && latestTransfer && ['TRANSFERRED', 'PREGNANT'].includes(embryo.status);
  // Gestation counts from the barn's "today" (which may be the demo clock), plus the embryo's age at transfer.
  const todayMs = new Date(`${health?.today ?? new Date().toISOString().slice(0, 10)}T12:00:00Z`).getTime();
  const gestationDay = latestTransfer
    ? Math.round((todayMs - new Date(latestTransfer.performedOn).getTime()) / 86_400_000) + 7
    : 0;

  return (
    <div className="space-y-6">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="eyebrow">Embryo</p>
          <h1 className="code text-2xl font-bold">{embryo.id}</h1>
          <p className="mt-1 text-[14px]">
            {embryo.sire ? (
              <Link className="hover:underline" href={`/horses/${embryo.sire.id}`}>
                {embryo.sire.name}
              </Link>
            ) : (
              (embryo.sireName ?? '?')
            )}{' '}
            x{' '}
            {embryo.dam ? (
              <Link className="hover:underline" href={`/horses/${embryo.dam.id}`}>
                {embryo.dam.name}
              </Link>
            ) : (
              (embryo.damName ?? '?')
            )}
            <span className="text-muted-foreground">
              {' '}
              · {label(embryo.source)} · owner{' '}
              <Link className="hover:underline" href={`/customers/${embryo.customerId}`}>
                {embryo.customer.displayName}
              </Link>
            </span>
          </p>
        </div>
        <div className="flex items-center gap-2">
          <StatusPill tone={toneForStatus(embryo.status)}>{label(embryo.status)}</StatusPill>
          {canRecordChecks && latestTransfer ? (
            <RecordCheckDialog
              transferId={latestTransfer.id}
              embryoId={embryo.id}
              gestationDay={gestationDay}
              recipLabel={`Recip #${latestTransfer.recipient.recipNumber ?? '?'}`}
            />
          ) : null}
        </div>
      </header>

      <div className="grid gap-6 lg:grid-cols-[1fr_320px]">
        <section className="space-y-3">
          <h2 className="text-[13px] font-semibold">Timeline</h2>
          <Timeline events={timeline} />
        </section>

        <aside className="space-y-5">
          <Facts
            rows={[
              [
                'Contract',
                embryo.contract ? (
                  <Link className="code hover:underline" href={`/contracts/${embryo.contract.id}`}>
                    {embryo.contract.id}
                  </Link>
                ) : (
                  '—'
                ),
              ],
              ['Stallion contract type', embryo.contract ? label(embryo.contract.type) : '—'],
              [
                'Recip',
                latestTransfer ? (
                  <Link className="hover:underline" href={`/horses/${latestTransfer.recipientId}`}>
                    Recip #{latestTransfer.recipient.recipNumber ?? '?'}
                  </Link>
                ) : (
                  'not assigned'
                ),
              ],
              ['Transferred', latestTransfer ? day(latestTransfer.performedOn) : '—'],
              ['Storage', embryo.storageTank ? `tank ${embryo.storageTank} · slot ${embryo.storageSlot ?? '?'}` : '—'],
              ['Expected', embryo.expectedOn ? day(embryo.expectedOn) : '—'],
              ['Sending vet', embryo.sendingVet ?? '—'],
              [
                'Aspiration',
                embryo.aspiration
                  ? `${embryo.aspiration.id} · ${embryo.aspiration.oocyteCount} oocytes · ${day(embryo.aspiration.performedOn)}`
                  : '—',
              ],
              [
                'Lab',
                embryo.aspiration?.labBatch
                  ? `${embryo.aspiration.labBatch.id} · ${label(embryo.aspiration.labBatch.status)}${embryo.aspiration.labBatch.embryoCount !== null ? ` · ${embryo.aspiration.labBatch.embryoCount} embryos` : ''}`
                  : '—',
              ],
            ]}
          />

          {embryo.invoices.length > 0 ? (
            <div className="space-y-2">
              <h2 className="text-[13px] font-semibold">Invoices</h2>
              <ul className="divide-y rounded-md border">
                {embryo.invoices.map((inv) => (
                  <li key={inv.id} className="space-y-1 px-3 py-2 text-[13px]">
                    <div className="flex items-center justify-between gap-2">
                      <span className="code">{inv.id}</span>
                      <StatusPill tone={toneForStatus(inv.status)}>{label(inv.status)}</StatusPill>
                    </div>
                    <div className="flex items-center justify-between gap-2 text-muted-foreground">
                      <span>
                        {label(inv.kind)}
                        {inv.triggeredByCheckId ? ` · from ${inv.triggeredByCheckId}` : ''}
                      </span>
                      <span className="money text-foreground">{usd(inv.amountCents)}</span>
                    </div>
                    {inv.status === 'OPEN' ? (
                      <InvoiceActions
                        invoiceId={inv.id}
                        amountCents={inv.amountCents}
                        role={role}
                        revalidate={[`/embryos/${embryo.id}`]}
                      />
                    ) : null}
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
        </aside>
      </div>

      {audit.length > 0 ? (
        <section className="space-y-2">
          <h2 className="text-[13px] font-semibold">Audit trail</h2>
          <AuditList rows={audit} />
        </section>
      ) : null}
    </div>
  );
}

function Facts({ rows }: { rows: [string, React.ReactNode][] }) {
  return (
    <dl className="divide-y rounded-md border text-[13px]">
      {rows.map(([k, v]) => (
        <div key={k} className="grid grid-cols-[120px_1fr] gap-2 px-3 py-1.5">
          <dt className="text-muted-foreground">{k}</dt>
          <dd className="min-w-0 truncate">{v}</dd>
        </div>
      ))}
    </dl>
  );
}
