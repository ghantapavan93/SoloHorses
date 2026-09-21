import { redirect } from 'next/navigation';
import { auth } from '@/lib/auth';
import { safeNext } from '@/lib/safe-next';
import { LoginForm, OneClick } from './login-form';

const DEMO_LOGINS = [
  { email: 'admin@daysheet.local', role: 'Admin', sees: 'everything' },
  { email: 'stallions@daysheet.local', role: 'Stallion office', sees: 'contracts, orders, intake' },
  { email: 'recips@daysheet.local', role: 'Recip farm', sees: 'embryos, transfers, intake' },
  { email: 'vet@daysheet.local', role: 'Vet', sees: 'checks — records ultrasounds' },
  { email: 'billing@daysheet.local', role: 'Billing', sees: 'money, books, discrepancies' },
  { email: 'customer@daysheet.local', role: 'Customer (Jane Alder)', sees: 'only her own records' },
];

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ next?: string }> }) {
  const { next } = await searchParams;
  const session = await auth();
  if (session?.user) redirect(safeNext(next));
  return (
    <main className="mx-auto flex min-h-dvh max-w-5xl flex-col justify-center gap-10 px-4 py-12 md:flex-row md:items-center md:gap-16">
      <section className="flex-1 space-y-6">
        <div>
          <p className="eyebrow">
            Unofficial candidate prototype · synthetic data · no production or customer systems accessed
          </p>
          <h1 className="mt-2 text-3xl font-bold tracking-tight">Daysheet</h1>
          <p className="mt-3 max-w-md text-[14px] leading-relaxed text-muted-foreground">
            A backend that writes down what the barn already does by text, ultrasound and deposit — once, audited, and
            answerable. Every horse, person, phone number and dollar here is synthetic.
          </p>
        </div>
        <LoginForm next={safeNext(next)} />
      </section>
      <aside className="flex-1 rounded-lg border bg-card p-5">
        <p className="eyebrow">
          Demo logins · password <span className="code normal-case tracking-normal">daysheet-demo</span>
        </p>
        <ul className="mt-3 divide-y">
          {DEMO_LOGINS.map((d) => (
            <li key={d.email} className="grid grid-cols-[1fr_auto] items-center gap-x-3 py-2 text-[13px]">
              <div>
                <div className="font-medium">
                  {d.role} <span className="ml-1 text-[12px] font-normal text-muted-foreground">· {d.sees}</span>
                </div>
                <div className="code text-[11px] text-muted-foreground">{d.email}</div>
              </div>
              <OneClick email={d.email} next={safeNext(next)} label={d.role} />
            </li>
          ))}
        </ul>
        <p className="mt-4 text-[12px] leading-relaxed text-muted-foreground">
          Not affiliated with any horse operation. Built from public sources only; no portal, login or customer data was
          accessed. Stripe runs in test mode; the accounting system, SMS and the ICSI lab are simulated unless keys are
          configured.
        </p>
      </aside>
    </main>
  );
}
