'use client';

import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import { useDeferredRefresh } from '@/components/platform/use-platform-stream';
import { cn } from '@/lib/utils';

/**
 * Free hosting sleeps after a quiet quarter hour and takes most of a minute to wake. The first
 * person through the door in the morning must not meet an error page for it. One poller, in
 * the root layout, asks the web whether the estate is awake; while it is not, a notice says so
 * and keeps asking; the moment it is, the page reads the records again by itself. A page that
 * has its own words for the wait (the error boundary) claims the notice, so it is said once.
 * When the API is up nothing here renders.
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

interface AwakeState {
  awake: Awake;
  /** A page that shows its own waking copy takes the notice over while it is mounted. */
  claim: (on: boolean) => void;
}

const AwakeContext = createContext<AwakeState>({ awake: 'unknown', claim: () => undefined });

function usePoll(): Awake {
  const [awake, setAwake] = useState<Awake>('unknown');
  useEffect(() => {
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const ask = async () => {
      let ok = false;
      try {
        const response = await fetch('/api/health', { cache: 'no-store' });
        ok = ((await response.json()) as { ok?: boolean }).ok === true;
      } catch {
        ok = false;
      }
      if (cancelled) return;
      if (ok) remember();
      setAwake(ok ? 'yes' : 'no');
      if (!ok) timer = setTimeout(ask, POLL_MS);
    };
    // A remembered answer still arrives from outside React's render, the way a probe's would.
    if (remembered()) timer = setTimeout(() => setAwake('yes'), 0);
    else void ask();
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
  }, []);
  return awake;
}

export function WakingProvider({ children }: { children: ReactNode }) {
  const awake = usePoll();
  const refresh = useDeferredRefresh();
  const [claimed, setClaimed] = useState(false);
  const wasAsleep = useRef(false);
  const claim = useCallback((on: boolean) => setClaimed(on), []);

  useEffect(() => {
    if (awake === 'no') wasAsleep.current = true;
    // Asleep when the page was read, answering now: read the records again, once.
    if (awake === 'yes' && wasAsleep.current) {
      wasAsleep.current = false;
      refresh(0);
    }
  }, [awake, refresh]);

  return (
    <AwakeContext value={{ awake, claim }}>
      {children}
      {awake === 'no' && !claimed ? <WakingNotice /> : null}
    </AwakeContext>
  );
}

export function useAwake(): AwakeState {
  return useContext(AwakeContext);
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

/** The notice, docked low, while the estate is asleep. */
function WakingNotice({ className }: { className?: string }) {
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
