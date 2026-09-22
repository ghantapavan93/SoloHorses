'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { startTransition, useEffect, useRef } from 'react';
import { WakingCopy, useAwake, useClaimWakingNotice } from '@/components/platform/waking';

/**
 * A page failed; the layout, the dock and the navigation did not. Nothing entered was lost on
 * the server. One cause deserves its own words: the API asleep on free hosting, which wakes in
 * about a minute — the page says so, and tries again by itself the moment the estate answers.
 */
export default function PageError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  const awake = useAwake();
  const router = useRouter();
  // This page says "waking" in its own words; the layout's notice stands down meanwhile.
  useClaimWakingNotice();

  useEffect(() => {
    console.error('[page]', error.message);
  }, [error]);

  // The estate was asleep when the page read it and has since answered: read again — only then,
  // or a page that is broken for its own reasons would be retried without end.
  // The error came from the server's read, so the records are read again before the boundary resets.
  const wasAsleep = useRef(false);
  useEffect(() => {
    if (awake === 'no') wasAsleep.current = true;
    if (awake === 'yes' && wasAsleep.current) {
      wasAsleep.current = false;
      startTransition(() => {
        router.refresh();
        reset();
      });
    }
  }, [awake, reset, router]);

  if (awake === 'no') {
    return (
      <main
        className="mx-auto flex min-h-[60vh] max-w-md flex-col justify-center gap-3 px-4 py-12 text-[13px]"
        role="status"
        aria-live="polite"
        data-testid="waking-page"
      >
        <p className="eyebrow">The estate</p>
        <WakingCopy />
      </main>
    );
  }

  return (
    <main
      className="mx-auto flex min-h-[60vh] max-w-md flex-col justify-center gap-3 px-4 py-12 text-[13px]"
      role="alert"
    >
      <p className="eyebrow">This page</p>
      <h1 className="text-lg font-semibold">Something broke on this page.</h1>
      <p className="text-muted-foreground">
        It was recorded{error.digest ? ` (ref ${error.digest})` : ''}. Nothing you entered was lost on the server; the
        rest of the product is up.
      </p>
      <div className="flex gap-2">
        <button type="button" onClick={reset} className="rounded-md border px-3 py-1.5 hover:bg-muted">
          Try again
        </button>
        <Link href="/" className="rounded-md border px-3 py-1.5 hover:bg-muted">
          Front door
        </Link>
      </div>
    </main>
  );
}
