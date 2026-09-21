'use client';

import Link from 'next/link';
import { useEffect } from 'react';

/** A page failed; the layout, the dock and the navigation did not. Nothing entered was lost on the server. */
export default function PageError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    console.error('[page]', error.message);
  }, [error]);
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
