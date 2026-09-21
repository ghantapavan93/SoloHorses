import Link from 'next/link';
import { apiFetchOrNull } from '@/lib/api';
import type { Health } from '@/lib/types';

export const metadata = { title: 'About this prototype' };

const FACTS = [
  [
    'Three sites: a main office with a stallion station, a breeding & foaling facility, and a recipient-mare farm.',
    'public facilities page',
  ],
  [
    'Semen orders by call or text by 5 PM the day before a collection; cancellations by 8 AM the day of; collections every other day February–July.',
    'public stallion page',
  ],
  ['Deposit, stud fee and chute fee must all be paid before semen ships.', 'public podcast transcript'],
  ['Embryos are announced by text; “a text is not confirmed until we reply.”', 'public recipient-mare page'],
  [
    'ICSI fertilisation happens at an outside laboratory; aspirations are on Mondays and counts return in seven to ten days.',
    'public ICSI page + podcast',
  ],
  [
    'Lease fee due at the day-24 heartbeat check ($5,000 flush/thawed, $6,500 fresh ICSI); board $22/day from then; ICSI stallion fee at 45–60 days; purchased embryo confirmed at 55 days.',
    'public price sheets',
  ],
  ['Recip mares return by December 1 or a $6,000 purchase fee applies.', 'public conditions of sale'],
];

const ASSUMPTIONS = [
  'The accounting system is QuickBooks Online and card processing is Stripe. Neither is stated publicly; both are named in the role.',
  'Pregnancy checks are recorded by the vet team at each site and are the source of billing milestones.',
  'One recipient-mare contract per client per season covers all transfers; one stallion contract per mare slot.',
  'Owner status updates go out by text first, email second.',
  'The auction platform and e-signature provider are vendors; this prototype simulates both.',
];

const UNKNOWN = [
  'What the existing internal assistant does today.',
  'Buyer’s premium, commission and payout timing on the sale platform.',
  'Exact live-foal-guarantee terms per program.',
  'Which barn hosts donor aspirations on a given week.',
  'Board rates for donor and foaling mares; the vet price list.',
];

export default async function AboutPage() {
  const health = await apiFetchOrNull<Health>('/health');
  const modes = health?.integrations;
  return (
    <div className="mx-auto max-w-3xl space-y-8 text-[13px] leading-relaxed">
      <div>
        <p className="eyebrow">About</p>
        <h1 className="text-2xl font-bold">What this is, and is not</h1>
        <p className="mt-2">
          This is an unsolicited prototype built by one job candidate from a horse operation’s public website, podcast
          transcripts and job postings. It is not affiliated with, endorsed by, or connected to any company. Every
          horse, person, contract, phone number and dollar figure is synthetic. Stripe runs in test mode; SMS, email,
          the accounting system, the ICSI laboratory, the auction platform and e-signature are simulated adapters unless
          keys are configured. No portal, login, admin page or customer data was accessed. The workflows are one
          reader’s understanding of public material, labeled below. Many assumptions are probably wrong; the build
          exists to be corrected by the people who do the work.
        </p>
      </div>

      {modes ? (
        <section>
          <h2 className="text-[14px] font-semibold">Right now, in this environment</h2>
          <ul className="mt-2 grid gap-1 sm:grid-cols-2">
            {Object.entries(modes).map(([k, v]) => (
              <li key={k} className="flex items-center justify-between rounded-md border px-3 py-1.5">
                <span className="capitalize">{k}</span>
                <span className={v === 'live' ? 'text-ok' : 'text-muted-foreground'}>
                  {v === 'live' ? (k === 'stripe' ? 'live (test mode)' : 'live') : 'simulated'}
                </span>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      <section>
        <h2 className="text-[14px] font-semibold">Facts the rules are built on</h2>
        <ul className="mt-2 divide-y rounded-md border">
          {FACTS.map(([f, src]) => (
            <li key={f} className="grid gap-1 px-3 py-2 sm:grid-cols-[1fr_180px]">
              <span>{f}</span>
              <span className="text-[11px] text-muted-foreground sm:text-right">{src}</span>
            </li>
          ))}
        </ul>
      </section>

      <section>
        <h2 className="text-[14px] font-semibold">Assumptions made to build it</h2>
        <ul className="mt-2 list-disc space-y-1 pl-5">
          {ASSUMPTIONS.map((a) => (
            <li key={a}>{a}</li>
          ))}
        </ul>
      </section>

      <section>
        <h2 className="text-[14px] font-semibold">Deliberately not claimed</h2>
        <ul className="mt-2 list-disc space-y-1 pl-5">
          {UNKNOWN.map((u) => (
            <li key={u}>{u}</li>
          ))}
        </ul>
      </section>

      <section>
        <h2 className="text-[14px] font-semibold">What I would do next</h2>
        <p className="mt-2">
          Spend a morning with the people using the current systems. Watch where information gets retyped, where
          somebody opens a second application to verify the first, what gets looked up by phone, and where customers
          call because they cannot see status. Then delete whatever parts of this prototype were built on the wrong
          assumptions.
        </p>
      </section>

      <p className="text-muted-foreground">
        Source, architecture notes and the assumption ledger live in the repository’s{' '}
        <span className="code">docs/</span> folder. Back to the{' '}
        <Link href="/" className="underline">
          Day Sheet
        </Link>
        .
      </p>
    </div>
  );
}
