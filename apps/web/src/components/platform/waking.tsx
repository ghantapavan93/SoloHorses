'use client';

import { useEffect, useRef, useSyncExternalStore } from 'react';
import { useDeferredRefresh } from '@/components/platform/use-platform-stream';
import { cn } from '@/lib/utils';

/**
 * Free hosting sleeps after a quiet quarter hour and takes most of a minute to wake. The first
 * person through the door in the morning must not meet an error page for it. One poller asks
 * the web whether the estate is awake; while it is not, a notice says so and keeps asking; the
 * moment it is, the page reads the records again by itself. A page that has its own words for
 * the wait (the error boundary) claims the notice, so it is said once.
 *
 * The state lives outside React on purpose. The notice sits beside the page in the root layout,
 * never above it: a state update in an ancestor of a page that is still streaming makes React
 * give up on the server's HTML for that page and render it again on the client — and the
 * server's copy stays behind, hidden, so every element on the page exists twice.
 */
export type Awake = 'unknown' | 'yes' | 'no';

const POLL_MS = 3_000;
/** An API that answered this recently is not asked again on every page: one probe a session, not one a click. */
const REMEMBER_MS = 10 * 60_000;
const REMEMBER_KEY = 'daysheet.awake';

const remembered = (): boolean => {
  try {
    return Date.now() - Number(sessionStorage.getItem(REMEMBER_KEY) ?? 0) < REMEMBER_MS;
  } catch {
    return false;
  }
};
const remember = (): void => {
  try {
    sessionStorage.setItem(REMEMBER_KEY, String(Date.now()));
  } catch {
    /* private mode or storage denied: the probe simply runs again next time */
  }
};

interface Store {
  awake: Awake;
  claimed: boolean;
  polling: boolean;
  listeners: Set<() => void>;
}

const store: Store = { awake: 'unknown', claimed: false, polling: false, listeners: new Set() };

function set(patch: Partial<Pick<Store, 'awake' | 'claimed'>>): void {
  Object.assign(store, patch);
  for (const listener of store.listeners) listener();
}

async function probe(): Promise<boolean> {
  try {
    const response = await fetch('/api/health', { cache: 'no-store' });
    return ((await response.json()) as { ok?: boolean }).ok === true;
  } catch {
    return false;
  }
}

/** Starts the poll once per page load; a remembered answer skips it. */
function ensurePolling(): void {
  if (store.polling) return;
  store.polling = true;
  if (remembered()) {
    set({ awake: 'yes' });
    return;
  }
  const ask = async () => {
    const ok = await probe();
    if (ok) remember();
    set({ awake: ok ? 'yes' : 'no' });
    if (!ok) setTimeout(ask, POLL_MS);
  };
  void ask();
}

function subscribe(listener: () => void): () => void {
  store.listeners.add(listener);
  ensurePolling();
  return () => {
    store.listeners.delete(listener);
  };
}

const awakeSnapshot = () => store.awake;
const awakeOnServer = (): Awake => 'unknown';
const claimedSnapshot = () => store.claimed;
const claimedOnServer = () => false;

export function useAwake(): Awake {
  return useSyncExternalStore(subscribe, awakeSnapshot, awakeOnServer);
}

/** A page that says "waking" in its own words takes the notice over while it is mounted. */
export function useClaimWakingNotice(): void {
  useEffect(() => {
    set({ claimed: true });
    return () => set({ claimed: false });
  }, []);
}

export function WakingCopy() {
  return (
    <>
      <p className="font-medium">Waking the estate.</p>
      <p className="mt-0.5 text-muted-foreground">
        Free hosting sleeps after fifteen quiet minutes. The records are back in about a minute; this page will read
        them again by itself.
      </p>
      <span className="mt-2 block h-0.5 w-full overflow-hidden rounded-full bg-muted" aria-hidden>
        <span className="block h-full w-1/3 rounded-full bg-copper-2 motion-safe:animate-[waking_1.6s_ease-in-out_infinite]" />
      </span>
    </>
  );
}

/**
 * The notice, docked low, while the estate is asleep — and the refresh once it wakes, for the
 * pages that rendered without it. Mounted beside the page, never around it.
 */
export function WakingNotice({ className }: { className?: string }) {
  const awake = useAwake();
  const claimed = useSyncExternalStore(subscribe, claimedSnapshot, claimedOnServer);
  const refresh = useDeferredRefresh();
  const wasAsleep = useRef(false);

  useEffect(() => {
    if (awake === 'no') wasAsleep.current = true;
    // Asleep when the page was read, answering now: read the records again, once. A page that
    // claimed the notice reads them again itself.
    if (awake === 'yes' && wasAsleep.current) {
      wasAsleep.current = false;
      if (!claimed) refresh(0);
    }
  }, [awake, claimed, refresh]);

  if (awake !== 'no' || claimed) return null;
  return (
    <div
      role="status"
      aria-live="polite"
      data-testid="waking"
      className={cn(
        'fixed inset-x-4 bottom-4 z-50 mx-auto max-w-md rounded-lg border bg-card/95 px-4 py-3 text-[13px] shadow-lg backdrop-blur',
        className,
      )}
    >
      <WakingCopy />
    </div>
  );
}
