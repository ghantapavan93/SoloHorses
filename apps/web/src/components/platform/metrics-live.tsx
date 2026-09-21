'use client';

import { useLiveRefresh } from '@/components/platform/use-platform-stream';

/** Refreshes the server-rendered metrics when a job, breaker, event or exception moves. */
export function MetricsLive() {
  const { connected } = useLiveRefresh(
    (s) =>
      s.kind === 'job' ||
      s.kind === 'breaker' ||
      s.kind === 'exception' ||
      (s.kind === 'event' && s.stage === 'consumed'),
    1_500,
  );
  return (
    <span className={connected ? 'text-ok' : 'text-muted-foreground'}>{connected ? 'live' : 'reconnecting…'}</span>
  );
}
