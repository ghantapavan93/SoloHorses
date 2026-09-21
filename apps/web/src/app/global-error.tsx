'use client';

import * as Sentry from '@sentry/nextjs';
import { useEffect } from 'react';

/** Last-resort error boundary; reports to Sentry when configured, otherwise just says so. */
export default function GlobalError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    Sentry.captureException(error);
  }, [error]);
  return (
    <html lang="en">
      <body className="flex min-h-dvh items-center justify-center p-6 font-sans">
        <div className="max-w-md space-y-3 text-[13px]">
          <h1 className="text-lg font-semibold">Something broke on our side.</h1>
          <p className="text-neutral-600">
            The error has been recorded{error.digest ? ` (ref ${error.digest})` : ''}. Nothing you entered was lost on
            the server.
          </p>
          <button onClick={reset} className="rounded-md border px-3 py-1.5">
            Try again
          </button>
        </div>
      </body>
    </html>
  );
}
