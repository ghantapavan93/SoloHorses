import Link from 'next/link';
import { SettlementView } from '@/components/settlement/settlement-view';
import { ThemeToggle } from '@/components/shell/theme-toggle';
import { apiFetch, apiFetchOrNull } from '@/lib/api';
import { auth } from '@/lib/auth';
import { currentTheme } from '@/lib/theme';
import type {
  AskStatus,
  IntegrityTimelineRow,
  InvoiceIntegrityRow,
  OperationalException,
  SettlementScene,
} from '@/lib/types';

export const metadata = { title: 'A sale settlement, end to end' };
export const dynamic = 'force-dynamic';

/**
 * The second front door: one sold lot from the hammer to the papers. No sign-in needed; a
 * visitor reads as the demo reviewer. The published rule — settlement before papers, an
 * initiated ACH is not cleared funds — runs on real rows; the one simulated step is the
 * bank finishing the debit, and the release is a person's click.
 */
export default async function SettlementPage({ searchParams }: { searchParams: Promise<{ ask?: string }> }) {
  const { ask } = await searchParams;
  const reviewer = { allowReviewer: true } as const;
  const [session, scene, askStatus, exceptions, theme] = await Promise.all([
    auth(),
    apiFetch<SettlementScene>('/settlement', reviewer),
    apiFetchOrNull<AskStatus>('/ask/status', reviewer),
    apiFetchOrNull<OperationalException[]>('/operations/exceptions', reviewer),
    currentTheme(),
  ]);
  const integrity = scene.invoice
    ? await apiFetchOrNull<{ row: InvoiceIntegrityRow; timeline: IntegrityTimelineRow[] }>(
        `/money/integrity/${scene.invoice.id}`,
        reviewer,
      )
    : null;
  const ids = new Set(
    [
      scene.lot.id,
      scene.invoice?.id,
      scene.payment?.id,
      scene.document?.id,
      ...scene.returns.flatMap((r) => [r.lot.id, r.recip.id]),
    ].filter((x): x is string => Boolean(x)),
  );
  const related = (exceptions ?? []).filter(
    (x) => ids.has(x.entityId ?? '') || ids.has((x.detail as { lotId?: string } | null)?.lotId ?? ''),
  );
  return (
    <main className="mx-auto max-w-6xl px-4 py-6 md:py-8">
      <div className="mb-5 flex flex-wrap items-center justify-between gap-2 text-[12px] text-muted-foreground">
        <span>
          <Link href="/" className="font-heading font-bold uppercase tracking-[0.18em] text-foreground">
            Daysheet
          </Link>{' '}
          · a sale settlement, end to end · synthetic · live
        </span>
        <span className="flex items-center gap-3">
          <Link href="/story" className="underline">
            One mare’s story
          </Link>
          <Link href="/build" className="underline">
            Real · simulated · probably wrong
          </Link>
          {session?.user ? (
            <Link href="/today" className="underline">
              Open the app
            </Link>
          ) : (
            <Link href="/login?next=/settlement" className="underline">
              Sign in as a role
            </Link>
          )}
          <ThemeToggle theme={theme} />
        </span>
      </div>
      <SettlementView
        scene={scene}
        books={integrity?.row.books ?? null}
        timeline={integrity?.timeline ?? []}
        exceptions={related}
        askStatus={askStatus}
        signedIn={Boolean(session?.user)}
        initialQuestion={typeof ask === 'string' && ask.length > 2 ? ask.slice(0, 300) : undefined}
      />
    </main>
  );
}
