import Link from 'next/link';
import { notFound } from 'next/navigation';
import { AuditList } from '@/components/record/audit-list';
import { InvoiceActions } from '@/components/money/invoice-actions';
import { StatusPill, toneForStatus } from '@/components/ui/status-pill';
import { apiFetchOrNull } from '@/lib/api';
import { auth } from '@/lib/auth';
import { day, dateTime, label, usd } from '@/lib/format';
import type { AuditRow, ContractPage } from '@/lib/types';

const STEPS = ['RESERVED', 'DEPOSIT_PAID', 'SIGNED', 'PAID_IN_FULL', 'SHIPPABLE'];

function plainLanguage(status: string, balance: string): string {
  switch (status) {
    case 'SHIPPABLE':
      return 'Paid in full and signed. Semen can ship on the next collection day you order for.';
    case 'PAID_IN_FULL':
      return 'Paid in full, but the contract is not signed yet. Semen cannot ship until it is.';
    case 'SIGNED':
      return `Signed. ${balance} is still due before semen can ship.`;
    case 'DEPOSIT_PAID':
      return `Deposit received. Signature and ${balance} are still needed before semen can ship.`;
    case 'RESERVED':
      return 'Slot reserved. Nothing has been paid or signed yet.';
    default:
      return 'This contract is no longer active.';
  }
}

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return { title: id };
}

export default async function ContractDetail({ params }: { params: Promise<{ id: string }> }) {
  const [{ id }, session] = await Promise.all([params, auth()]);
  const page = await apiFetchOrNull<ContractPage>(`/contracts/${encodeURIComponent(id)}`);
  if (!page) notFound();
  const { contract, paidCents, totalCents, balanceCents } = page;
  const role = session?.user.role ?? 'CUSTOMER';
  const canSeeAudit = role === 'ADMIN' || role === 'BILLING' || role === 'STALLION_OFFICE';
  const audit = canSeeAudit
    ? ((await apiFetchOrNull<AuditRow[]>(`/audit?entityType=Contract&entityId=${encodeURIComponent(id)}`)) ?? [])
    : [];
  const stepIndex = STEPS.indexOf(contract.status);

  return (
    <div className="space-y-6">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="eyebrow">Breeding contract · {contract.season}</p>
          <h1 className="code text-2xl font-bold">{contract.id}</h1>
          <p className="mt-1 text-[14px]">
            <Link className="horse-name hover:underline" href={`/horses/${contract.stallion.id}`}>
              {contract.stallion.name}
            </Link>
            <span className="text-muted-foreground"> · {label(contract.type)} · </span>
            {contract.mare ? (
              <Link className="hover:underline" href={`/horses/${contract.mare.id}`}>
                {contract.mare.name}
              </Link>
            ) : (
              <span className="text-muted-foreground">no mare attached yet</span>
            )}
            <span className="text-muted-foreground"> · </span>
            <Link className="hover:underline" href={`/customers/${contract.customerId}`}>
              {contract.customer.displayName}
            </Link>
          </p>
        </div>
        <StatusPill tone={toneForStatus(contract.status)}>{label(contract.status)}</StatusPill>
      </header>

      <ol className="flex flex-wrap gap-1 text-[12px]" aria-label="Contract progress">
        {STEPS.map((s, i) => (
          <li
            key={s}
            className={`rounded-sm border px-2 py-1 ${i <= stepIndex ? 'border-foreground bg-foreground text-background' : 'text-muted-foreground'}`}
          >
            {label(s)}
          </li>
        ))}
      </ol>

      <div className="grid gap-6 lg:grid-cols-[1fr_360px]">
        <section className="space-y-4">
          <div className="rounded-md border p-3 text-[13px]">
            <h2 className="font-semibold">In plain language</h2>
            <p className="mt-1 text-muted-foreground">{plainLanguage(contract.status, usd(balanceCents))}</p>
            <dl className="mt-3 grid grid-cols-2 gap-x-4 gap-y-2 md:grid-cols-4">
              <Fact k="Deposit" v={usd(contract.depositCents)} />
              <Fact k="Stud fee" v={usd(contract.studFeeCents)} />
              <Fact k="Chute fee" v={usd(contract.chuteFeeCents)} />
              <Fact k="Total" v={usd(totalCents)} />
              <Fact k="Paid" v={usd(paidCents)} />
              <Fact k="Balance" v={balanceCents > 0 ? <span className="text-warn">{usd(balanceCents)}</span> : '—'} />
              <Fact
                k="Signed"
                v={contract.signedAt ? `${day(contract.signedAt)} · ${contract.esignEnvelopeId ?? ''}` : 'not yet'}
              />
              <Fact k="Embryos" v={String(contract.embryos?.length ?? 0)} />
            </dl>
          </div>

          <div className="space-y-2">
            <h2 className="text-[13px] font-semibold">Invoices</h2>
            <ul className="divide-y rounded-md border">
              {contract.invoices.map((inv) => (
                <li key={inv.id} className="space-y-1 px-3 py-2 text-[13px]">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <span>
                      <span className="code">{inv.id}</span>
                      <span className="ml-2 text-muted-foreground">
                        {label(inv.kind)} · issued {day(inv.issuedOn)} · due {day(inv.dueOn)}
                      </span>
                    </span>
                    <span className="flex items-center gap-2">
                      <span className="money">{usd(inv.amountCents)}</span>
                      <StatusPill tone={toneForStatus(inv.status)}>{label(inv.status)}</StatusPill>
                    </span>
                  </div>
                  {(inv.payments ?? []).map((p) => (
                    <div
                      key={p.id}
                      className="flex flex-wrap items-center justify-between gap-2 pl-3 text-[12px] text-muted-foreground"
                    >
                      <span>
                        <span className="code">{p.id}</span> · {label(p.method)} · {dateTime(p.receivedAt)}
                        {p.failureReason ? ` · ${p.failureReason}` : ''}
                      </span>
                      <span className="flex items-center gap-2">
                        <span className="money">{usd(p.amountCents)}</span>
                        <StatusPill tone={toneForStatus(p.status)}>{label(p.status)}</StatusPill>
                      </span>
                    </div>
                  ))}
                  {inv.status === 'OPEN' ? (
                    <InvoiceActions
                      invoiceId={inv.id}
                      amountCents={inv.amountCents}
                      role={role}
                      revalidate={[`/contracts/${contract.id}`]}
                    />
                  ) : null}
                </li>
              ))}
              {contract.invoices.length === 0 ? (
                <li className="px-3 py-4 text-[13px] text-muted-foreground">No invoices yet.</li>
              ) : null}
            </ul>
          </div>
        </section>

        <aside className="space-y-2">
          <h2 className="text-[13px] font-semibold">Semen orders</h2>
          <ul className="divide-y rounded-md border text-[13px]">
            {(contract.semenOrders ?? []).map((o) => (
              <li key={o.id} className="flex items-center justify-between gap-2 px-3 py-2">
                <span>
                  <span className="code">{o.id}</span>
                  <span className="text-muted-foreground">
                    {' '}
                    · {day(o.requestedFor)} · {o.shipToVet}, {o.shipToCity}
                  </span>
                </span>
                <StatusPill tone={toneForStatus(o.status)}>{label(o.status)}</StatusPill>
              </li>
            ))}
            {(contract.semenOrders ?? []).length === 0 ? (
              <li className="px-3 py-3 text-muted-foreground">No orders.</li>
            ) : null}
          </ul>
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

function Fact({ k, v }: { k: string; v: React.ReactNode }) {
  return (
    <div>
      <dt className="text-[11px] uppercase tracking-wider text-muted-foreground">{k}</dt>
      <dd className="money text-[13px]">{v}</dd>
    </div>
  );
}
