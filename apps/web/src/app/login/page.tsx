import Link from 'next/link';
import { redirect } from 'next/navigation';
import { apiFetchOrNull } from '@/lib/api';
import { auth } from '@/lib/auth';
import { usd } from '@/lib/format';
import { safeNext } from '@/lib/safe-next';
import type { OperationsSummary, Story } from '@/lib/types';
import { LoginForm, OneClick } from './login-form';
import { LoginScene, type SceneCard } from './login-scene';

const DEMO_LOGINS = [
  { email: 'admin@daysheet.local', role: 'Admin', sees: 'everything' },
  { email: 'stallions@daysheet.local', role: 'Stallion office', sees: 'contracts, orders, intake' },
  { email: 'recips@daysheet.local', role: 'Recip farm', sees: 'embryos, transfers, intake' },
  { email: 'vet@daysheet.local', role: 'Vet', sees: 'checks — records ultrasounds' },
  { email: 'billing@daysheet.local', role: 'Billing', sees: 'money, books, discrepancies' },
  { email: 'customer@daysheet.local', role: 'Customer (Jane Alder)', sees: 'only her own records' },
];

/** What the day holds, one true sentence per role, read from the seeded world; nothing when the API is away. */
function cardsFrom(summary: OperationsSummary | null, story: Story | null): SceneCard[] {
  const cards: SceneCard[] = [];
  if (summary) {
    cards.push({
      role: 'Admin',
      line: `${summary.open} decisions need attention this morning.`,
      detail: `${usd(summary.atStakeCents)} held up by open rows · every one a record with its own page`,
    });
  }
  if (story) {
    const held = story.recip.departure && !story.recip.departure.rule.ok;
    cards.push({
      role: 'Recip farm',
      line: held
        ? `${story.recip.id} is due to leave and cannot yet: ${story.recip.departure?.rule.reason ?? 'a clearance is missing'}.`
        : `${story.recip.id} carries ${story.embryo.id}, day ${story.pregnancy.gestationDay}.`,
      detail: held
        ? 'The vet’s record is what the rule reads; nothing here lets her leave.'
        : 'The next milestone carries a fee only if the rule says so.',
    });
  }
  if (summary) {
    const papers = summary.byKind['PAPERS_HELD'] ?? 0;
    const checks = summary.byKind['CHECK_OVERDUE'] ?? 0;
    cards.push({
      role: papers > 0 ? 'Billing' : 'Vet',
      line:
        papers > 0
          ? `${papers} set${papers === 1 ? '' : 's'} of registration papers wait for cleared funds.`
          : `${checks} pregnancy check${checks === 1 ? ' is' : 's are'} overdue.`,
      detail:
        papers > 0
          ? 'Eligible when the bank clears; released by a person, under their name.'
          : 'A fee follows only at the milestones that carry one.',
    });
  }
  return cards;
}

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ next?: string }> }) {
  const { next } = await searchParams;
  const session = await auth();
  if (session?.user) redirect(safeNext(next));
  const reviewer = { allowReviewer: true } as const;
  const [summary, story] = await Promise.all([
    apiFetchOrNull<OperationsSummary>('/operations/summary', reviewer),
    apiFetchOrNull<Story>('/story', reviewer),
  ]);
  const cards = cardsFrom(summary, story);
  const target = safeNext(next);

  return (
    <main className="min-h-dvh md:grid md:grid-cols-[minmax(0,5fr)_minmax(0,6fr)]">
      <section className="flex flex-col justify-center px-6 py-10 md:px-12 lg:px-16">
        <div className="mx-auto w-full max-w-[440px]">
          <Link href="/" className="font-heading text-[12px] font-bold uppercase tracking-[0.18em] text-foreground">
            Daysheet
          </Link>
          <p className="eyebrow mt-6">Unofficial candidate prototype · synthetic data</p>
          <h1 className="display mt-2 text-[clamp(34px,4.2vw,48px)] leading-[1] tracking-[-0.03em]">Sign in</h1>
          <p className="mt-3 text-[14px] leading-relaxed text-muted-foreground">
            One mare’s day, across five systems. Pick a role — the password is the seed’s — or use the form.
          </p>

          <ul className="mt-6 divide-y rounded-lg border" aria-label="Demo roles">
            {DEMO_LOGINS.map((d) => (
              <li key={d.email} className="grid grid-cols-[1fr_auto] items-center gap-x-3 px-3 py-2 text-[13px]">
                <div className="min-w-0">
                  <div className="font-medium">
                    {d.role} <span className="ml-1 text-[12px] font-normal text-muted-foreground">· {d.sees}</span>
                  </div>
                  <div className="code truncate text-[11px] text-muted-foreground">{d.email}</div>
                </div>
                <OneClick email={d.email} next={target} label={d.role} />
              </li>
            ))}
          </ul>

          <div className="my-6 flex items-center gap-3 text-[11px] uppercase tracking-[0.14em] text-muted-foreground">
            <span className="h-px flex-1 bg-border" aria-hidden />
            or with the form
            <span className="h-px flex-1 bg-border" aria-hidden />
          </div>
          <LoginForm next={target} />

          <p className="mt-8 text-[11.5px] leading-relaxed text-muted-foreground">
            Password for every role: <span className="code">daysheet-demo</span>. Not affiliated with any horse
            operation; built from public sources only; no portal, login or customer data was accessed. Stripe runs in
            test mode; the accounting system, SMS and the ICSI lab are simulated unless keys are configured.
          </p>
        </div>
      </section>
      <aside className="hidden p-4 md:block md:p-5">
        <LoginScene cards={cards} className="h-full min-h-[560px]" />
      </aside>
    </main>
  );
}
