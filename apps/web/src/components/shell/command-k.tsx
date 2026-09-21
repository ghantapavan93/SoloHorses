'use client';

import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { ArrowLeft, Sparkles } from 'lucide-react';
import { AskPanel } from '@/components/ask/ask-panel';
import {
  Command,
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from '@/components/ui/command';
import { hrefFor } from '@/lib/format';
import type { AskStatus, SearchHit } from '@/lib/types';

export type CommandView = 'search' | 'ask';

/**
 * One surface for ⌘K: type a code or a name and jump to the record, or type a question and
 * ask. The assistant lives inside the same palette — it appears when it is useful and goes
 * away with Escape — rather than as a screen of its own. Results come from the API's search
 * (RBAC-scoped) through a route handler, so the browser never holds an API token.
 */
export function CommandK({
  open,
  view,
  onOpenChange,
  onViewChange,
  askStatus,
  suggestions,
  initialQuestion = null,
  onAsk,
}: {
  open: boolean;
  view: CommandView;
  onOpenChange: (open: boolean) => void;
  onViewChange: (view: CommandView) => void;
  askStatus: AskStatus | null;
  suggestions: string[];
  initialQuestion?: string | null;
  /** When the page has a place for the conversation (the shell's dock), a question goes there and the palette closes. */ onAsk?: (
    question: string,
  ) => void;
}) {
  const router = useRouter();
  const [query, setQuery] = useState('');
  const [hits, setHits] = useState<SearchHit[]>([]);
  const [loading, setLoading] = useState(false);
  const [asked, setQuestion] = useState<string | null>(null);
  // A question handed in from outside the palette (a signal's "Ask about this") is the question until one is typed here.
  const question = asked ?? (open ? initialQuestion : null);

  const term = query.trim();
  const visible = term.length >= 2 ? hits : [];
  const looksLikeQuestion = term.length >= 3 && (/\s/.test(term) || term.endsWith('?'));

  useEffect(() => {
    if (!open || view !== 'search' || term.length < 2) return;
    const controller = new AbortController();
    const timer = setTimeout(async () => {
      setLoading(true);
      try {
        const res = await fetch(`/api/search?q=${encodeURIComponent(term)}`, { signal: controller.signal });
        if (res.ok) setHits((await res.json()) as SearchHit[]);
      } catch {
        /* aborted */
      } finally {
        setLoading(false);
      }
    }, 120);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [term, open, view]);

  const close = (nextOpen: boolean) => {
    if (!nextOpen) {
      setQuery('');
      setQuestion(null);
    }
    onOpenChange(nextOpen);
  };

  const ask = (text: string | null) => {
    if (onAsk && text) {
      close(false);
      onAsk(text);
      return;
    }
    setQuestion(text);
    onViewChange('ask');
  };

  const groups = ['embryo', 'horse', 'contract', 'customer'] as const;
  const titles = { embryo: 'Embryos', horse: 'Horses', contract: 'Contracts', customer: 'Customers' };

  return (
    <CommandDialog
      open={open}
      onOpenChange={close}
      title={view === 'ask' ? 'Ask' : 'Search or ask'}
      description="Find a record by code or name, or ask a question about the records"
      className={view === 'ask' ? 'top-[6vh] sm:max-w-[680px]' : 'sm:max-w-[640px]'}
    >
      {view === 'ask' ? (
        <div className="flex h-[80vh] max-h-[720px] flex-col">
          <div className="flex items-center gap-2 border-b px-3 py-2 text-[12px] text-muted-foreground">
            <button
              type="button"
              onClick={() => onViewChange('search')}
              className="inline-flex items-center gap-1 rounded-sm px-1 py-0.5 hover:bg-muted hover:text-foreground"
            >
              <ArrowLeft className="size-3.5" /> Search
            </button>
            <span className="ml-auto flex items-center gap-1.5">
              <Sparkles className="size-3.5" /> Ask · answers only from records, with the codes that support each line
              {askStatus ? (
                askStatus.live ? (
                  <span className="text-foreground">· {askStatus.model}</span>
                ) : (
                  <span className="text-warn">· offline, deterministic</span>
                )
              ) : null}
            </span>
          </div>
          <AskPanel
            key={question ?? 'blank'}
            suggestions={suggestions}
            status={askStatus}
            autoFocus
            initialQuestion={question ?? undefined}
            className="flex-1"
            onAnswered={() => router.refresh()}
          />
        </div>
      ) : (
        // The API already filtered; cmdk must not filter again or the Ask row disappears.
        <Command shouldFilter={false} className="rounded-xl!">
          <CommandInput
            placeholder="E-26-2041, Recip #347, Jane Alder… or ask a question"
            value={query}
            onValueChange={setQuery}
          />
          <CommandList className="max-h-[420px]">
            <CommandEmpty>{loading ? 'Searching…' : 'Type a code, a name, or a question.'}</CommandEmpty>
            {groups.map((g) => {
              const rows = visible.filter((h) => h.type === g);
              if (rows.length === 0) return null;
              return (
                <CommandGroup key={g} heading={titles[g]}>
                  {rows.map((h) => (
                    <CommandItem
                      key={h.id}
                      value={`${h.title} ${h.subtitle} ${h.id}`}
                      onSelect={() => {
                        const href = hrefFor(h.id);
                        close(false);
                        if (href) router.push(href);
                      }}
                    >
                      <span className="code mr-2 text-muted-foreground">{h.id}</span>
                      <span className="truncate">{h.title}</span>
                      <span className="ml-auto truncate pl-3 text-[11px] text-muted-foreground">{h.subtitle}</span>
                    </CommandItem>
                  ))}
                </CommandGroup>
              );
            })}
            {term.length >= 3 ? (
              <CommandGroup heading="Ask">
                <CommandItem
                  value={`ask ${term}`}
                  onSelect={() => ask(term)}
                  className={looksLikeQuestion ? 'font-medium' : ''}
                >
                  <Sparkles className="mr-2 size-3.5 text-brand" />
                  <span className="truncate">Ask: “{term}”</span>
                  <span className="ml-auto pl-3 text-[11px] text-muted-foreground">
                    cites records · never changes them
                  </span>
                </CommandItem>
              </CommandGroup>
            ) : null}
            {term.length < 2 ? (
              <CommandGroup heading="Try">
                {suggestions.slice(0, 3).map((s) => (
                  <CommandItem key={s} value={`try ${s}`} onSelect={() => ask(s)}>
                    <Sparkles className="mr-2 size-3.5 text-muted-foreground" />
                    <span className="truncate">{s}</span>
                  </CommandItem>
                ))}
              </CommandGroup>
            ) : null}
          </CommandList>
          <div className="flex items-center gap-3 border-t px-3 py-1.5 text-[10px] text-muted-foreground">
            <span>
              <kbd className="rounded border px-1 font-mono">↑↓</kbd> move
            </span>
            <span>
              <kbd className="rounded border px-1 font-mono">↵</kbd> open or ask
            </span>
            <span>
              <kbd className="rounded border px-1 font-mono">esc</kbd> close
            </span>
            <span className="ml-auto">⌘J opens Ask directly</span>
          </div>
        </Command>
      )}
    </CommandDialog>
  );
}
