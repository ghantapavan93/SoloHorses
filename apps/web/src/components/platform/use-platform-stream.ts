'use client';

import { usePathname, useRouter } from 'next/navigation';
import { useCallback, useEffect, useRef, useState } from 'react';
import type { PlatformSignalEnvelope } from '@/lib/types';

/**
 * The browser's view of the platform bus, over server-sent events through the web app
 * (the browser never holds an API token). Push is for the time-sensitive things — a job
 * moving, a breaker opening, an exception being raised; plain polling stays fine for the
 * rest. Reconnects with EventSource's own back-off.
 */
export function usePlatformStream(
  options: {
    replay?: number;
    onSignal?: (signal: PlatformSignalEnvelope) => void;
    /** The stream came back after a drop: whatever was pushed meanwhile was missed. */ onReconnect?: () => void;
    enabled?: boolean;
  } = {},
) {
  const { replay = 0, onSignal, onReconnect, enabled = true } = options;
  const [signals, setSignals] = useState<PlatformSignalEnvelope[]>([]);
  const [connected, setConnected] = useState(false);
  const handler = useRef(onSignal);
  const reconnected = useRef(onReconnect);
  useEffect(() => {
    handler.current = onSignal;
    reconnected.current = onReconnect;
  });

  useEffect(() => {
    if (!enabled) return;
    const source = new EventSource(`/api/platform/stream?replay=${replay}`);
    // The bus does not replay what a dropped client missed: an open after a drop is the moment to
    // read again. Only a connection that was once open counts as dropped — a slow first connect is not.
    let opened = false;
    let dropped = false;
    source.onopen = () => {
      setConnected(true);
      if (opened && dropped) reconnected.current?.();
      opened = true;
      dropped = false;
    };
    source.onerror = () => {
      setConnected(false);
      dropped = true;
    };
    source.onmessage = (message: MessageEvent<string>) => {
      const signal = JSON.parse(message.data) as PlatformSignalEnvelope;
      if (signal.kind === 'hello') return;
      setSignals((prev) => [...prev.slice(-399), signal]);
      handler.current?.(signal);
    };
    return () => source.close();
  }, [replay, enabled]);

  return { signals, connected };
}

/**
 * A refresh that lands while a navigation is in flight can take the navigation with it: the
 * page re-reads itself and the click goes nowhere. The router does not say when it is busy, so
 * the last click on a link or a button marks a grace period during which a refresh waits its
 * turn; a pathname change ends the period early. One listener for the whole document.
 */
const NAVIGATION_GRACE_MS = 4_000;
let navigationStartedAt = 0;

export function noteNavigationIntent(): void {
  navigationStartedAt = Date.now();
}

function navigating(): boolean {
  return Date.now() < navigationStartedAt + NAVIGATION_GRACE_MS;
}

if (typeof window !== 'undefined') {
  window.addEventListener(
    'click',
    (event) => {
      const target = event.target instanceof Element ? event.target : null;
      if (target?.closest('a[href], button')) noteNavigationIntent();
    },
    true,
  );
}

/** Refreshes now, or as soon as no navigation is in flight; a burst collapses into one refresh. */
export function useDeferredRefresh(): (afterMs?: number) => void {
  const router = useRouter();
  const pathname = usePathname();
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    // The pathname changed: whatever navigation was pending has landed.
    navigationStartedAt = 0;
  }, [pathname]);
  useEffect(() => () => clearTimeout(timer.current ?? undefined), []);
  return useCallback(
    (afterMs = 0) => {
      const attempt = () => {
        if (navigating()) timer.current = setTimeout(attempt, 250);
        else router.refresh();
      };
      if (timer.current) clearTimeout(timer.current);
      timer.current = setTimeout(attempt, afterMs);
    },
    [router],
  );
}

/**
 * Refreshes the current server-rendered page when a matching signal arrives — the
 * "domain event → push → invalidate" pattern, debounced so a burst of job transitions
 * becomes one refresh, and deferred while a navigation is in flight.
 */
export function useLiveRefresh(matches: (signal: PlatformSignalEnvelope) => boolean, debounceMs = 500) {
  const refresh = useDeferredRefresh();
  const matcher = useRef(matches);
  useEffect(() => {
    matcher.current = matches;
  });
  return usePlatformStream({
    onSignal: (signal) => {
      if (!matcher.current(signal)) return;
      refresh(debounceMs);
    },
    // A missed event is a missed refresh: the page reads the server again once the stream is back.
    onReconnect: () => refresh(0),
  });
}
