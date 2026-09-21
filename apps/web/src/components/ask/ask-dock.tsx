'use client';

import { usePathname } from 'next/navigation';
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { Pin, PinOff, RotateCcw, Sparkles, X } from 'lucide-react';
import { AskPanel, type AskHandoff } from '@/components/ask/ask-panel';
import { ASK_EVENT } from '@/components/landing/landing-ask';
import type { AskStatus } from '@/lib/types';
import { cn } from '@/lib/utils';

/**
 * The assistant as a place, not a popup. Collapsed, it is a rail at the edge of a desktop;
 * once a question starts it opens beside the page and stays while the person moves through
 * the application; pinned, it starts open. On a phone it is a sheet from the bottom. It knows
 * the record on the page, so "why can't she leave?" needs no id, and it keeps the conversation
 * across pages in this tab. ⌘K remains the fast way in.
 */
interface AskDockApi {
  open: boolean;
  show(): void;
  hide(): void;
  toggle(): void;
  /** Hands a question in: the dock opens and asks it. */
  ask(question: string): void;
}

interface AskDockState extends AskDockApi {
  handoff: AskHandoff | null;
}

const AskDockContext = createContext<AskDockState | null>(null);
const PIN_KEY = 'daysheet:ask:pinned';

/** Null outside the shell (the public pages have no dock). */
export function useAskDock(): AskDockApi | null {
  return useContext(AskDockContext);
}

/** The record on the page, from its address: what "she", "it" or "this" means when the person asks. */
export function contextFor(pathname: string): { path: string; entityId: string | null } {
  const match = /^\/(horses|embryos|contracts|customers)\/([A-Z]{1,3}-(?:\d{2}-)?\d{4,6})/.exec(pathname);
  return { path: pathname, entityId: match?.[2] ?? null };
}

function readPinned(): boolean {
  try {
    return localStorage.getItem(PIN_KEY) === '1';
  } catch {
    return false;
  }
}

export function AskDockProvider({ children }: { children: ReactNode }) {
  const [open, setOpen] = useState(false);
  const [handoff, setHandoff] = useState<AskHandoff | null>(null);
  const ask = useCallback((question: string) => {
    const q = question.trim().slice(0, 300);
    if (!q) return;
    setHandoff({ id: Date.now(), question: q });
    setOpen(true);
  }, []);
  const value = useMemo<AskDockState>(
    () => ({
      open,
      handoff,
      ask,
      show: () => setOpen(true),
      hide: () => setOpen(false),
      toggle: () => setOpen((v) => !v),
    }),
    [open, handoff, ask],
  );

  // Pinned, the dock starts open — after hydration, so the server's collapsed markup is what the client first sees.
  useEffect(() => {
    if (!readPinned()) return;
    const timer = setTimeout(() => setOpen(true), 0);
    return () => clearTimeout(timer);
  }, []);
  useEffect(() => {
    if (open) document.documentElement.dataset['askDock'] = 'open';
    else delete document.documentElement.dataset['askDock'];
    return () => {
      delete document.documentElement.dataset['askDock'];
    };
  }, [open]);

  // Any component can hand the dock a question with one event — the same one the landing's palette listens for.
  useEffect(() => {
    const onAsk = (e: Event) => {
      const question = (e as CustomEvent<{ question: string }>).detail?.question;
      if (question) ask(question);
    };
    window.addEventListener(ASK_EVENT, onAsk);
    document.documentElement.dataset['askReady'] = '1';
    return () => {
      window.removeEventListener(ASK_EVENT, onAsk);
      delete document.documentElement.dataset['askReady'];
    };
  }, [ask]);

  return <AskDockContext.Provider value={value}>{children}</AskDockContext.Provider>;
}

export function AskDock({
  askStatus,
  suggestions,
  userKey,
}: {
  askStatus: AskStatus | null;
  suggestions: string[];
  userKey: string;
}) {
  const dock = useContext(AskDockContext);
  const pathname = usePathname();
  const [epoch, setEpoch] = useState(0);
  const [pinned, setPinned] = useState(false);
  useEffect(() => {
    const timer = setTimeout(() => setPinned(readPinned()), 0);
    return () => clearTimeout(timer);
  }, []);
  if (!dock) return null;
  const context = contextFor(pathname);
  const persistKey = `daysheet:ask:${userKey}`;
  const startOver = () => {
    try {
      sessionStorage.removeItem(persistKey);
    } catch {
      /* ignore */
    }
    setEpoch((e) => e + 1);
  };
  const togglePin = () => {
    const next = !pinned;
    setPinned(next);
    try {
      localStorage.setItem(PIN_KEY, next ? '1' : '0');
    } catch {
      /* ignore */
    }
  };

  return (
    <>
      {/* Collapsed: a rail at the edge of a desktop, one click from the conversation. */}
      <button
        type="button"
        onClick={dock.show}
        className={cn(
          'hidden w-11 shrink-0 flex-col items-center gap-2 border-l bg-background pt-3 text-muted-foreground hover:text-foreground md:sticky md:top-0 md:h-dvh',
          dock.open ? 'md:hidden' : 'md:flex',
        )}
        aria-label="Open Ask"
        title="Ask (⌘J)"
        data-testid="ask-rail"
      >
        <Sparkles className="size-4 text-brand" aria-hidden />
        <span className="text-[10px] font-medium [writing-mode:vertical-rl]">Ask</span>
        <kbd className="rounded border px-1 font-mono text-[9px]">⌘J</kbd>
      </button>

      <aside
        className={cn(
          'z-30 flex flex-col border-t bg-background shadow-[0_-12px_40px_rgb(0_0_0/0.35)] fixed inset-x-0 bottom-0 max-h-[72dvh] rounded-t-2xl',
          'md:sticky md:top-0 md:inset-x-auto md:bottom-auto md:h-dvh md:max-h-none md:w-[400px] md:shrink-0 md:rounded-none md:border-l md:border-t-0 md:shadow-none',
          !dock.open && 'hidden',
        )}
        data-testid="ask-dock"
        aria-label="Assistant"
        aria-hidden={!dock.open}
      >
        <header className="flex h-11 shrink-0 items-center gap-2 border-b px-3 text-[12px]">
          <Sparkles className="size-3.5 text-brand" aria-hidden />
          <span className="font-medium">Ask</span>
          {context.entityId ? (
            <span
              className="inline-flex items-center gap-1 rounded-sm border px-1.5 py-0.5 text-[11px] text-muted-foreground"
              data-testid="ask-context"
            >
              looking at <span className="code text-foreground">{context.entityId}</span>
            </span>
          ) : null}
          <span className="ml-auto" />
          {askStatus && !askStatus.live ? (
            <span
              className="rounded-sm border px-1.5 py-0.5 text-[10px] text-muted-foreground"
              title="Answers are composed in code from the same tools and rules; no model is configured. Each run says which provider answered."
              data-testid="ask-demo-mode"
            >
              Demo mode
            </span>
          ) : null}
          <button
            type="button"
            onClick={togglePin}
            className={cn(
              'rounded-sm p-1 hover:bg-muted hover:text-foreground',
              pinned ? 'text-foreground' : 'text-muted-foreground',
            )}
            aria-label={pinned ? 'Unpin Ask' : 'Pin Ask open'}
            aria-pressed={pinned}
            title={pinned ? 'Pinned: starts open' : 'Pin: start open'}
          >
            {pinned ? <Pin className="size-3.5" /> : <PinOff className="size-3.5" />}
          </button>
          <button
            type="button"
            onClick={startOver}
            className="rounded-sm p-1 text-muted-foreground hover:bg-muted hover:text-foreground"
            aria-label="Start a new conversation"
            title="New conversation"
          >
            <RotateCcw className="size-3.5" />
          </button>
          <button
            type="button"
            onClick={dock.hide}
            className="rounded-sm p-1 text-muted-foreground hover:bg-muted hover:text-foreground"
            aria-label="Close Ask"
            data-testid="ask-dock-close"
          >
            <X className="size-4" />
          </button>
        </header>
        <AskPanel
          key={epoch}
          suggestions={suggestions}
          status={askStatus}
          className="min-h-0 flex-1"
          handoff={dock.handoff}
          context={context}
          persistKey={persistKey}
        />
      </aside>
    </>
  );
}
