'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { startTransition, useEffect, useRef } from 'react';
import { useWarmUp } from '@/components/platform/warm-up';

/**
 * A page failed; the layout, the dock and the navigation did not. Nothing entered was lost on
 * the server. One cause is not a failure at all: the API asleep on free hosting. The warm-up
 * overlay beside this page says so and re-reads the records when the estate answers; this
 * boundary then resets itself, so the page comes back without a click.
 */
export default function PageError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  const { phase } = useWarmUp();
  const router = useRouter();
  const waited = useRef(false);

  useEffect(() => {
    console.error('[page]', error.message);
  }, [error]);

  useEffect(() => {
    if (phase === 'connecting' || phase === 'waking' || phase === 'loading' || phase === 'refreshing')
      waited.current = true;
    // The estate was asleep when the page read it and has answered since: read again, then retry the render.
    if (phase === 'ready' && waited.current) {
      waited.current = false;
      startTransition(() => {
        router.refresh();
        reset();
      });
    }
  }, [phase, reset, router]);

  const waking = phase !== 'ready' && phase !== 'idle' && phase !== 'down';
  return (
    <main
      className="mx-auto flex min-h-[60vh] max-w-md flex-col justify-center gap-3 px-4 py-12 text-[13px]"
      role={waking ? 'status' : 'alert'}
      aria-live="polite"
      data-testid={waking ? 'waking-page' : 'error-page'}
    >
      <p className="eyebrow">{waking ? 'The estate' : 'This page'}</p>
      <h1 className="text-lg font-semibold">{waking ? 'Waking the ranch…' : 'Something broke on this page.'}</h1>
      <p className="text-muted-foreground">
        {waking
          ? 'This prototype runs entirely on free-tier infrastructure; the page reads its records again by itself once the backend is up.'
          : `It was recorded${error.digest ? ` (ref ${error.digest})` : ''}. Nothing you entered was lost on the server; the rest of the product is up.`}
      </p>
      {!waking ? (
        <div className="flex gap-2">
          <button type="button" onClick={reset} className="rounded-md border px-3 py-1.5 hover:bg-muted">
            Try again
          </button>
          <Link href="/" className="rounded-md border px-3 py-1.5 hover:bg-muted">
            Front door
          </Link>
        </div>
      ) : null}
    </main>
  );
}
