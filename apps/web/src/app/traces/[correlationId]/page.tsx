import Link from 'next/link';
import { notFound } from 'next/navigation';
import { TraceSteps } from '@/components/platform/trace-steps';
import { ThemeToggle } from '@/components/shell/theme-toggle';
import { apiFetchOrNull } from '@/lib/api';
import { auth } from '@/lib/auth';
import { currentTheme } from '@/lib/theme';
import type { TraceStep } from '@/lib/types';

export const dynamic = 'force-dynamic';

export async function generateMetadata({ params }: { params: Promise<{ correlationId: string }> }) {
  const { correlationId } = await params;
  return { title: `Trace ${correlationId}` };
}

/**
 * One correlation id, addressable: the click, the command, the inbox row, the event, the
 * job, the books' attempt, the audit line, the exception — in order. A link an engineer can
 * be sent instead of a screenshot.
 */
export default async function TracePage({ params }: { params: Promise<{ correlationId: string }> }) {
  const { correlationId } = await params;
  if (!/^[a-z0-9_:-]{4,80}$/i.test(correlationId)) notFound();
  const [session, trace, theme] = await Promise.all([
    auth(),
    apiFetchOrNull<{ correlationId: string; steps: TraceStep[] }>(
      `/platform/trace/${encodeURIComponent(correlationId)}`,
      { allowReviewer: true },
    ),
    currentTheme(),
  ]);
  if (!trace) notFound();
  const signedIn = Boolean(session?.user);
  return (
    <main className="mx-auto max-w-3xl px-4 py-6 md:py-8">
      <nav
        aria-label="Where this trace lives"
        className="mb-5 flex flex-wrap items-center justify-between gap-2 text-[12px] text-muted-foreground"
      >
        <span>
          <Link href="/" className="font-heading font-bold uppercase tracking-[0.18em] text-foreground">
            Daysheet
          </Link>{' '}
          · trace · synthetic data
        </span>
        <span className="flex items-center gap-3">
          <Link href={signedIn ? '/architecture' : '/login?next=/architecture'} className="underline">
            the architecture
          </Link>
          <ThemeToggle theme={theme} />
        </span>
      </nav>
      <header className="mb-4">
        <p className="eyebrow">
          Correlation · {trace.steps.length} step{trace.steps.length === 1 ? '' : 's'}
        </p>
        <h1 className="code mt-1 text-xl font-semibold tracking-tight">{trace.correlationId}</h1>
      </header>
      <article className="rounded-md border px-4 py-3">
        <TraceSteps steps={trace.steps} />
      </article>
    </main>
  );
}
