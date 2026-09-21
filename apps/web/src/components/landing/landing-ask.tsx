'use client';

import { useEffect, useState } from 'react';
import { Sparkles } from 'lucide-react';
import { CommandK, type CommandView } from '@/components/shell/command-k';
import type { AskStatus } from '@/lib/types';

/**
 * The prototype floated a scripted assistant over its dashboard. This is the real one: the
 * same ⌘K surface the application uses, answering as the demo reviewer from the same records,
 * with the same policy gate and verifier. Nothing it says is written in advance.
 */
/** Any component on the page can hand the palette a question: `window.dispatchEvent(new CustomEvent('daysheet:ask', { detail: { question } }))`. */
export const ASK_EVENT = 'daysheet:ask';

export function askFromAnywhere(question: string): void {
  window.dispatchEvent(new CustomEvent(ASK_EVENT, { detail: { question } }));
}

/** A question as a button: anywhere on a page that mounts `LandingAsk`, the palette opens on it. */
export function AskButton({
  question,
  className,
  children,
}: {
  question: string;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <button type="button" onClick={() => askFromAnywhere(question)} className={className}>
      {children}
    </button>
  );
}

/** `pill` is the top bar's compact door to the same palette; `field` is the full-width one a panel holds. */
export function LandingAsk({
  status,
  suggestions,
  variant = 'field',
}: {
  status: AskStatus | null;
  suggestions: string[];
  variant?: 'field' | 'pill';
}) {
  const [open, setOpen] = useState(false);
  const [view, setView] = useState<CommandView>('ask');
  const [handoff, setHandoff] = useState<string | null>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!(e.metaKey || e.ctrlKey)) return;
      const key = e.key.toLowerCase();
      if (key === 'k' || key === 'j') {
        e.preventDefault();
        setView(key === 'k' ? 'search' : 'ask');
        setOpen(true);
      }
    };
    const onAsk = (e: Event) => {
      const question = (e as CustomEvent<{ question: string }>).detail?.question;
      if (!question) return;
      setHandoff(question);
      setView('ask');
      setOpen(true);
    };
    window.addEventListener('keydown', onKey);
    window.addEventListener(ASK_EVENT, onAsk);
    document.documentElement.dataset['askReady'] = '1';
    return () => {
      window.removeEventListener('keydown', onKey);
      window.removeEventListener(ASK_EVENT, onAsk);
      delete document.documentElement.dataset['askReady'];
    };
  }, []);

  return (
    <>
      <button
        type="button"
        onClick={() => {
          setView('ask');
          setOpen(true);
        }}
        aria-label="Ask about the operation…"
        className={
          variant === 'pill'
            ? 'flex h-9 items-center gap-2 rounded-full border border-white/[0.13] bg-[rgb(21_18_17/0.8)] px-3 text-left text-[12px] text-muted-foreground transition-colors hover:border-white/25 hover:text-paper'
            : 'flex h-11 w-full items-center gap-3 rounded-xl border border-white/[0.13] bg-[rgb(21_18_17/0.93)] px-4 text-left text-[12px] text-muted-foreground shadow-[0_12px_28px_rgb(0_0_0/0.25)] backdrop-blur-md transition-colors hover:border-white/25 hover:text-paper'
        }
      >
        <Sparkles className="size-3.5 text-cream" />{' '}
        <span className={variant === 'pill' ? 'hidden sm:inline' : undefined}>Ask about the operation…</span>
        <kbd
          className={
            variant === 'pill'
              ? 'hidden rounded-md border border-white/10 bg-[#0d0b0b] px-1.5 py-0.5 font-mono text-[9px] md:inline'
              : 'ml-auto rounded-md border border-white/10 bg-[#0d0b0b] px-2 py-1 font-mono text-[9px]'
          }
        >
          ⌘ K
        </kbd>
      </button>
      <CommandK
        open={open}
        view={view}
        onOpenChange={(o) => {
          setOpen(o);
          if (!o) setHandoff(null);
        }}
        onViewChange={setView}
        askStatus={status}
        suggestions={suggestions}
        initialQuestion={handoff}
      />
    </>
  );
}
