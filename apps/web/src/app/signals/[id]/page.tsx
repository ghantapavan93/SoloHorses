import Link from 'next/link';
import { notFound } from 'next/navigation';
import { SignalDetail } from '@/components/signals/signal-drawer';
import { XrayPanel } from '@/components/story/xray';
import { ThemeToggle } from '@/components/shell/theme-toggle';
import { apiFetchOrNull } from '@/lib/api';
import { auth } from '@/lib/auth';
import { ago, label, usd } from '@/lib/format';
import { currentTheme } from '@/lib/theme';
import type { DecisionRow, Signal, Xray } from '@/lib/types';

export const dynamic = 'force-dynamic';

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return { title: `Signal ${id}` };
}

/**
 * A signal's own address. Shared, it lands another person on the same facts, the same
 * meaning and the same door — open or already resolved. The drawer on the landing shows the
 * same component; nothing essential lives only inside it.
 */
export default async function SignalPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!/^OX-\d{2}-\d{4,6}$/.test(id)) notFound();
  const [session, signal, xray, proposals, theme] = await Promise.all([
    auth(),
    apiFetchOrNull<Signal>(`/operations/signals/${id}`, { allowReviewer: true }),
    // A customer's token is refused by the board's line and the graph stays hidden; the page still shows the signal she may see.
    apiFetchOrNull<Xray>(`/operations/signals/${id}/xray`, { allowReviewer: true }),
    apiFetchOrNull<DecisionRow[]>('/proposals?status=all', { allowReviewer: true }),
    currentTheme(),
  ]);
  if (!signal) notFound();
  const signedIn = Boolean(session?.user);
  // The decision this signal led to, when the assistant prepared one about its record: waiting first, else the latest decided.
  const about = new Set([signal.entityId, xray?.subject].filter((v): v is string => Boolean(v)));
  const decisions = (proposals ?? []).filter((row) =>
    ['recipId', 'embryoId', 'recipientId'].some(
      (key) => typeof row.payload[key] === 'string' && about.has(row.payload[key] as string),
    ),
  );
  const decision = decisions.find((row) => row.status === 'PROPOSED') ?? decisions[0] ?? null;
  // A question from here goes to Today, where the assistant's dock lives — behind the one-click login when nobody is signed in.
  const hrefFor = (question: string) => {
    const path = `/today?ask=${encodeURIComponent(question)}`;
    return signedIn ? path : `/login?next=${encodeURIComponent(path)}`;
  };
  const askHrefs = xray
    ? {
        why: hrefFor(`What is blocking ${xray.subject}?`),
        prepare:
          xray.unresolvedBoundary?.owner === 'VET' ? hrefFor(`Prepare the vet request for ${xray.subject}`) : null,
      }
    : null;
  return (
    <main className={`mx-auto px-4 py-6 md:py-8 ${xray ? 'max-w-[1180px]' : 'max-w-3xl'}`}>
      <nav
        aria-label="Where this signal lives"
        className="mb-5 flex flex-wrap items-center justify-between gap-2 text-[12px] text-muted-foreground"
      >
        <span>
          <Link href="/" className="font-heading font-bold uppercase tracking-[0.18em] text-foreground">
            Daysheet
          </Link>{' '}
          · signal · synthetic data
        </span>
        <span className="flex items-center gap-3">
          <Link href={signedIn ? '/operations' : '/login?next=/operations'} className="underline">
            the board
          </Link>
          <ThemeToggle theme={theme} />
        </span>
      </nav>
      <header className="mb-4 flex flex-wrap items-end justify-between gap-x-6 gap-y-2">
        <div>
          <p className="eyebrow">
            {signal.channelLabel} · {signal.status.toLowerCase()} · {ago(signal.createdAt)}
          </p>
          <h1 className="mt-1 text-2xl font-bold tracking-tight md:text-3xl">
            {signal.label} <span className="code text-[14px] font-normal text-muted-foreground">{signal.id}</span>
          </h1>
        </div>
        <dl className="flex flex-wrap items-baseline gap-x-5 gap-y-1 text-[12px]">
          {signal.stake ? (
            <div>
              <dt className="readout text-muted-foreground">at stake</dt>
              <dd className="money text-[15px] font-semibold">{usd(signal.stake.amountCents)}</dd>
            </div>
          ) : null}
          <div>
            <dt className="readout text-muted-foreground">owner</dt>
            <dd className="font-medium">{label(signal.owner)}</dd>
          </div>
          <div>
            <dt className="readout text-muted-foreground">next</dt>
            <dd className="font-medium">{signal.next}</dd>
          </div>
        </dl>
      </header>
      {xray && askHrefs ? (
        <div className="frame-evidence mb-4 overflow-hidden p-1.5 md:p-2">
          <XrayPanel xray={xray} ask={{ kind: 'link', hrefs: askHrefs }} className="border-transparent" />
        </div>
      ) : null}
      {decision ? (
        <p
          className="mb-4 flex flex-wrap items-baseline gap-x-2 rounded-md border px-3 py-2 text-[12px]"
          data-testid="signal-decision"
        >
          <span className="readout text-muted-foreground">decision</span>
          <span>{decision.spec.label}</span>
          <span className={decision.status === 'PROPOSED' ? 'readout text-warn' : 'readout text-muted-foreground'}>
            {decision.status === 'PROPOSED' ? 'waiting on a person' : decision.status.toLowerCase()}
          </span>
          <Link href={`/decisions/${decision.id}`} className="underline underline-offset-2">
            open the decision
          </Link>
        </p>
      ) : null}
      <article className="rounded-md border p-4">
        <SignalDetail signal={signal} signedIn={signedIn} />
      </article>
    </main>
  );
}
