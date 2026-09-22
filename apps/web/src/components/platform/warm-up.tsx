'use client';

import { useRouter } from 'next/navigation';
import { useEffect, useRef, useState, useSyncExternalStore, useTransition } from 'react';
import { animate, useMotionValue, useReducedMotion } from 'motion/react';
import { ContourField } from '@/components/landing/contour-field';
import { Horse } from '@/components/story/horse';
import { cn } from '@/lib/utils';

/**
 * The first visit of the day on free hosting: the API sleeps after a quiet quarter hour and
 * takes most of a minute to wake. That minute is not a defect to hide behind a spinner; it is
 * shown for what it is, with the estate's own drawing, and it ends the moment the API's own
 * readiness says it may. Every state below is a health answer, never a timer pretending:
 *
 *   connecting — the first probe is in flight
 *   waking     — /health/live does not answer yet: the instance is starting
 *   loading    — the process is up, /health/ready is not yet: the database, the schema, the world
 *   refreshing — ready: the page reads its records again before the overlay goes
 *   ready      — done; remembered for the session so the explanation is not shown twice
 *   down       — nothing for longer than is reasonable: an honest recovery state with a retry
 *
 * A page that arrived fine never sees any of this: the overlay appears only if readiness has
 * not come back within a moment. The state lives outside React and the overlay stands beside
 * the page in the root layout, never around it — a state update above a page still streaming
 * makes React render that page twice.
 */
export type WarmUpPhase = 'idle' | 'connecting' | 'waking' | 'loading' | 'refreshing' | 'ready' | 'down';

/** Readiness not back within this: the overlay shows. Long enough that a warm API never triggers it. */
const SHOW_AFTER_MS = 1_800;
/** Between probes, growing; a free instance takes 30–60 s, so nothing hammers it. */
const BACKOFF_MS = [1_000, 1_500, 2_000, 3_000, 5_000];
/** Past this the wait is not a cold start; the page says so and offers a retry. */
const CEILING_MS = 150_000;
/** A session that has seen the estate awake is not told the story again for a while. */
const REMEMBER_MS = 10 * 60_000;
const REMEMBER_KEY = 'daysheet.awake';

interface Store {
  phase: WarmUpPhase;
  /** The overlay is (or was) shown for this wait; a fast arrival never sets it. */
  shown: boolean;
  startedAt: number;
  attempts: number;
  /** Bumped on every change: what a subscriber compares, since the store itself is mutated in place. */
  version: number;
  listeners: Set<() => void>;
  timer: ReturnType<typeof setTimeout> | null;
}

const store: Store = {
  phase: 'idle',
  shown: false,
  startedAt: 0,
  attempts: 0,
  version: 0,
  listeners: new Set(),
  timer: null,
};

function set(patch: Partial<Pick<Store, 'phase' | 'shown' | 'startedAt' | 'attempts'>>): void {
  Object.assign(store, patch);
  store.version += 1;
  for (const listener of store.listeners) listener();
}

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

async function probe(): Promise<'waking' | 'loading' | 'ready'> {
  try {
    const response = await fetch('/api/health', { cache: 'no-store' });
    const body = (await response.json()) as { phase?: 'waking' | 'loading' | 'ready' };
    return body.phase === 'ready' || body.phase === 'loading' ? body.phase : 'waking';
  } catch {
    return 'waking';
  }
}

async function poll(): Promise<void> {
  const answer = await probe();
  if (store.phase === 'ready' || store.phase === 'down' || store.phase === 'idle') return;
  if (answer === 'ready') {
    // Shown, the overlay stays for the re-read of the records; not shown, nothing ever appears.
    set({ phase: store.shown ? 'refreshing' : 'ready' });
    if (!store.shown) remember();
    return;
  }
  if (Date.now() - store.startedAt > CEILING_MS) {
    set({ phase: 'down' });
    return;
  }
  set({ phase: answer, attempts: store.attempts + 1 });
  const wait = BACKOFF_MS[Math.min(store.attempts, BACKOFF_MS.length - 1)] ?? 5_000;
  store.timer = setTimeout(() => void poll(), wait);
}

/** Starts the wait once per page load; a remembered answer skips it entirely. */
function begin(): void {
  if (store.phase !== 'idle') return;
  if (remembered()) {
    set({ phase: 'ready' });
    return;
  }
  set({ phase: 'connecting', startedAt: Date.now(), attempts: 0, shown: false });
  // Not shown until a moment has passed with no readiness: a warm API answers in tens of milliseconds.
  setTimeout(() => {
    if (store.phase !== 'ready' && store.phase !== 'idle') set({ shown: true });
  }, SHOW_AFTER_MS);
  void poll();
}

/** The person's own retry, from the recovery state: the wait starts over. */
export function retryWarmUp(): void {
  if (store.timer) clearTimeout(store.timer);
  set({ phase: 'connecting', startedAt: Date.now(), attempts: 0, shown: true });
  void poll();
}

/** The re-read is done: the overlay may go, and the session remembers. */
function settle(): void {
  remember();
  set({ phase: 'ready' });
}

function subscribe(listener: () => void): () => void {
  store.listeners.add(listener);
  begin();
  return () => {
    store.listeners.delete(listener);
  };
}

const version = () => store.version;
const serverVersion = () => 0;

export function useWarmUp(): { phase: WarmUpPhase; shown: boolean } {
  useSyncExternalStore(subscribe, version, serverVersion);
  return { phase: store.phase, shown: store.shown };
}

const STEPS: { key: string; label: string }[] = [
  { key: 'connecting', label: 'Connecting' },
  { key: 'waking', label: 'API waking' },
  { key: 'loading', label: 'Loading operational state' },
  { key: 'ready', label: 'Ready' },
];

const STEP_INDEX: Record<WarmUpPhase, number> = {
  idle: 0,
  connecting: 0,
  waking: 1,
  loading: 2,
  refreshing: 2,
  ready: 3,
  down: 1,
};

const PROGRESS: Record<WarmUpPhase, number> = {
  idle: 0,
  connecting: 0.08,
  waking: 0.3,
  loading: 0.66,
  refreshing: 0.88,
  ready: 1,
  down: 0.3,
};

/**
 * The overlay: the field and the mare, the words, the four states, one line of progress. It
 * mounts only once the wait is real, re-reads the page when the API is ready, and dissolves.
 */
export function WarmUp() {
  const { phase, shown } = useWarmUp();
  const router = useRouter();
  const [pending, start] = useTransition();
  const [leaving, setLeaving] = useState(false);
  const refreshed = useRef(false);
  const sawPending = useRef(false);

  // Ready: read the records again (the page rendered without them), and let the overlay go once
  // that read has landed — the transition reports it — so nothing stale shows through the fade.
  useEffect(() => {
    if (phase !== 'refreshing') return;
    if (!refreshed.current) {
      refreshed.current = true;
      start(() => router.refresh());
      return;
    }
    if (pending) {
      sawPending.current = true;
      return;
    }
    if (!sawPending.current) return;
    setLeaving(true);
    const timer = setTimeout(settle, 600);
    return () => clearTimeout(timer);
  }, [phase, pending, router]);
  // A refresh too quick to be seen pending still ends: after a moment the overlay goes regardless.
  useEffect(() => {
    if (phase !== 'refreshing') return;
    const timer = setTimeout(() => {
      setLeaving(true);
      setTimeout(settle, 600);
    }, 4_000);
    return () => clearTimeout(timer);
  }, [phase]);

  if (!shown || phase === 'ready' || phase === 'idle') return null;
  return <WarmUpScene phase={phase} leaving={leaving} onRetry={retryWarmUp} />;
}

/** The scene itself, exported so a test can draw any phase of it. */
export function WarmUpScene({
  phase,
  leaving = false,
  onRetry,
  className,
}: {
  phase: WarmUpPhase;
  leaving?: boolean;
  onRetry: () => void;
  className?: string;
}) {
  const still = useReducedMotion();
  const gait = useMotionValue(0);
  const erase = useMotionValue(0);
  const step = STEP_INDEX[phase];
  const down = phase === 'down';

  // A slow walk while the estate wakes; she stands when the wait has stalled, and for a person who asked for stillness.
  useEffect(() => {
    if (still || down) {
      gait.set(0);
      return;
    }
    const controls = animate(gait, [0, Math.PI * 2], { duration: 2.6, repeat: Infinity, ease: 'linear' });
    return () => controls.stop();
  }, [gait, still, down]);

  return (
    <div
      role="status"
      aria-live="polite"
      data-testid="warm-up"
      data-phase={phase}
      className={cn(
        'fixed inset-0 z-[60] isolate overflow-hidden bg-[#100c0a] text-paper',
        'bg-[radial-gradient(120%_80%_at_80%_20%,rgb(212_138_96/0.22),transparent_55%),radial-gradient(90%_70%_at_20%_100%,rgb(126_78_49/0.25),transparent_60%)]',
        'transition-opacity duration-500 ease-out motion-reduce:transition-none',
        leaving ? 'pointer-events-none opacity-0' : 'opacity-100',
        className,
      )}
    >
      <ContourField sites={false} />
      <div className="absolute bottom-[8%] right-[-4%] w-[70%] max-w-[640px] opacity-90 md:right-[4%] md:w-[46%]">
        <Horse phase={gait} erase={erase} className="h-auto w-full" />
      </div>
      <div className="relative flex h-full flex-col justify-center px-6 py-10 md:px-[8vw]">
        <div className="max-w-[560px]">
          <p className="text-[10px] uppercase tracking-[0.18em] text-copper-2">
            {down ? 'The demo environment' : 'Free-tier infrastructure'}
          </p>
          <h1 className="display mt-3 text-[clamp(30px,5vw,56px)] leading-[1] tracking-[-0.03em] text-paper">
            {down ? 'Taking longer than expected.' : 'Waking the ranch…'}
          </h1>
          <p className="mt-4 max-w-[460px] text-[14px] leading-relaxed text-paper/75 md:text-[15px]">
            {down
              ? 'The demo environment is taking longer than expected to answer. It runs on free-tier infrastructure; a retry usually finds it awake.'
              : 'This prototype runs entirely on free-tier infrastructure, so the first visit can take a moment while the backend wakes up.'}
          </p>
          {!down ? (
            <p className="mt-2 text-[12px] uppercase tracking-[0.14em] text-paper/50">Built lean on purpose.</p>
          ) : null}

          <ol
            className="mt-8 flex max-w-[460px] flex-wrap gap-x-5 gap-y-2 text-[12px]"
            aria-label="Where the estate is"
          >
            {STEPS.map((s, i) => {
              const state = down
                ? i < step
                  ? 'done'
                  : i === step
                    ? 'stalled'
                    : 'pending'
                : i < step
                  ? 'done'
                  : i === step
                    ? 'current'
                    : 'pending';
              return (
                <li key={s.key} className="flex items-center gap-2" data-state={state}>
                  <span
                    className={cn(
                      'relative inline-flex size-2 rounded-full',
                      state === 'done' && 'bg-ok',
                      state === 'current' && 'bg-copper-2',
                      state === 'stalled' && 'bg-warn',
                      state === 'pending' && 'border border-paper/30',
                    )}
                    aria-hidden
                  >
                    {state === 'current' ? (
                      <span className="absolute -inset-1 rounded-full border border-copper-2/50 motion-safe:animate-ping [animation-duration:2.4s]" />
                    ) : null}
                  </span>
                  <span
                    className={cn(
                      state === 'pending' ? 'text-paper/40' : state === 'stalled' ? 'text-warn' : 'text-paper/85',
                    )}
                  >
                    {s.label}
                  </span>
                </li>
              );
            })}
          </ol>

          <div className="mt-5 h-px w-full max-w-[460px] overflow-hidden rounded-full bg-white/10" aria-hidden>
            <div
              className={cn(
                'relative h-full rounded-full transition-[width] duration-700 ease-out motion-reduce:transition-none',
                down ? 'bg-warn' : 'bg-copper-2',
              )}
              style={{ width: `${PROGRESS[phase] * 100}%` }}
            >
              {!down ? (
                <span className="absolute inset-y-0 right-0 w-10 bg-gradient-to-r from-transparent to-paper/70 motion-safe:animate-[waking_1.6s_ease-in-out_infinite]" />
              ) : null}
            </div>
          </div>

          {down ? (
            <button
              type="button"
              onClick={onRetry}
              className="mt-6 inline-flex h-9 items-center rounded-md border border-paper/25 px-4 text-[13px] text-paper hover:bg-white/5"
            >
              Retry connection
            </button>
          ) : null}
        </div>
      </div>
    </div>
  );
}
