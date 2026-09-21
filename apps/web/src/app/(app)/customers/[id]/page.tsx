import Link from 'next/link';
import { notFound } from 'next/navigation';
import { DigestPanel } from '@/components/intake/digest-panel';
import { StatusPill, toneForStatus } from '@/components/ui/status-pill';
import { apiFetchOrNull } from '@/lib/api';
import { auth } from '@/lib/auth';
import { day, label, usd } from '@/lib/format';
import type { CustomerPage, DigestPreview } from '@/lib/types';

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return { title: id };
}

export default async function CustomerDetail({ params }: { params: Promise<{ id: string }> }) {
  const [{ id }, session] = await Promise.all([params, auth()]);
  const customer = await apiFetchOrNull<CustomerPage>(`/customers/${encodeURIComponent(id)}`);
  if (!customer) notFound();
  const role = session?.user.role ?? 'CUSTOMER';
  const digest = await apiFetchOrNull<DigestPreview>(`/digests/${encodeURIComponent(id)}/preview`);
  const openBalance = customer.invoices.filter((i) => i.status === 'OPEN').reduce((s, i) => s + i.amountCents, 0);

  return (
    <div className="space-y-6">
      <header>
        <p className="eyebrow">Customer</p>
        <h1 className="text-2xl font-bold">{customer.displayName}</h1>
        <p className="mt-1 text-[13px] text-muted-foreground">
          <span className="code">{customer.id}</span>
          {role !== 'CUSTOMER' && customer.phone
            ? ` · ${customer.phone}${customer.smsOptedOut ? ' (opted out of texts)' : ''}`
            : ''}
          {role !== 'CUSTOMER' && customer.email ? ` · ${customer.email}` : ''}
          {customer.notes ? ` · ${customer.notes}` : ''}
        </p>
      </header>

      <div className="grid gap-6 lg:grid-cols-[1fr_380px]">
        <div className="space-y-6">
          <section className="space-y-2">
            <h2 className="text-[13px] font-semibold">Embryos</h2>
            <ul className="divide-y rounded-md border text-[13px]">
              {customer.embryos.map((e) => {
                const t = e.transfers[0];
                const c = t?.checks[0];
                return (
                  <li key={e.id} className="flex flex-wrap items-center justify-between gap-2 px-3 py-2">
                    <span>
                      <Link className="code hover:underline" href={`/embryos/${e.id}`}>
                        {e.id}
                      </Link>
                      <span className="text-muted-foreground">
                        {' '}
                        · {t ? `Recip #${t.recipient.recipNumber ?? '?'}` : 'no recip'}
                        {c ? ` · day ${c.dayNumber} ${label(c.result)} on ${day(c.performedOn)}` : ''}
                      </span>
                    </span>
                    <StatusPill tone={toneForStatus(e.status)}>{label(e.status)}</StatusPill>
                  </li>
                );
              })}
              {customer.embryos.length === 0 ? <li className="px-3 py-3 text-muted-foreground">No embryos.</li> : null}
            </ul>
          </section>

          <section className="space-y-2">
            <h2 className="text-[13px] font-semibold">Contracts</h2>
            <ul className="divide-y rounded-md border text-[13px]">
              {customer.contracts.map((c) => (
                <li key={c.id} className="flex flex-wrap items-center justify-between gap-2 px-3 py-2">
                  <span>
                    <Link className="code hover:underline" href={`/contracts/${c.id}`}>
                      {c.id}
                    </Link>
                    <span className="text-muted-foreground">
                      {' '}
                      · {c.stallion.name} · {label(c.type)}
                    </span>
                  </span>
                  <StatusPill tone={toneForStatus(c.status)}>{label(c.status)}</StatusPill>
                </li>
              ))}
              {customer.contracts.length === 0 ? (
                <li className="px-3 py-3 text-muted-foreground">No contracts.</li>
              ) : null}
            </ul>
          </section>

          {customer.invoices.length > 0 ? (
            <section className="space-y-2">
              <h2 className="text-[13px] font-semibold">
                Invoices{' '}
                {openBalance > 0 ? <span className="ml-1 font-normal text-warn">· {usd(openBalance)} open</span> : null}
              </h2>
              <ul className="divide-y rounded-md border text-[13px]">
                {customer.invoices.map((i) => (
                  <li key={i.id} className="flex flex-wrap items-center justify-between gap-2 px-3 py-2">
                    <span>
                      <span className="code">{i.id}</span>
                      <span className="text-muted-foreground">
                        {' '}
                        · {label(i.kind)} · due {day(i.dueOn)}
                      </span>
                    </span>
                    <span className="flex items-center gap-2">
                      <span className="money">{usd(i.amountCents)}</span>
                      <StatusPill tone={toneForStatus(i.status)}>{label(i.status)}</StatusPill>
                    </span>
                  </li>
                ))}
              </ul>
            </section>
          ) : null}

          {customer.horses.length > 0 ? (
            <section className="space-y-2">
              <h2 className="text-[13px] font-semibold">Horses</h2>
              <ul className="flex flex-wrap gap-1.5">
                {customer.horses.map((h) => (
                  <li key={h.id}>
                    <Link
                      className="inline-flex items-center gap-1.5 rounded-sm border px-2 py-1 text-[12px] hover:bg-muted"
                      href={`/horses/${h.id}`}
                    >
                      <span className="horse-name text-[13px]">{h.name}</span>
                      <span className="text-muted-foreground">{label(h.kind)}</span>
                    </Link>
                  </li>
                ))}
              </ul>
            </section>
          ) : null}
        </div>

        <aside>{digest ? <DigestPanel preview={digest} canSend={role !== 'CUSTOMER'} /> : null}</aside>
      </div>
    </div>
  );
}
