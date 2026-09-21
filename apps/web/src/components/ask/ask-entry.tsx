'use client';

import { useRouter, usePathname } from 'next/navigation';
import { useState, type FormEvent } from 'react';
import { ArrowRight } from 'lucide-react';
import { useAskDock } from '@/components/ask/ask-dock';
import { cn } from '@/lib/utils';

/**
 * One line to ask from, and the three questions the board suggests this morning. Inside the
 * shell the question goes straight to the dock, which knows the page; elsewhere it rides on
 * the address (`?ask=`) the way a signal's "Ask about this" hands one in. Nothing here talks
 * to the model; the assistant does, once, with the same gate every question passes.
 */
export function AskEntry({
  placeholder = 'Ask anything about today’s operation…',
  className,
  prompts = [],
}: {
  placeholder?: string;
  className?: string;
  prompts?: string[];
}) {
  const router = useRouter();
  const pathname = usePathname();
  const dock = useAskDock();
  const [question, setQuestion] = useState('');

  const ask = (text: string) => {
    const q = text.trim().slice(0, 300);
    if (!q) return;
    if (dock) dock.ask(q);
    else router.push(`${pathname}?ask=${encodeURIComponent(q)}`);
  };

  const submit = (event: FormEvent) => {
    event.preventDefault();
    ask(question);
    setQuestion('');
  };

  return (
    <form onSubmit={submit} className={cn('space-y-1.5', className)} role="search" aria-label="Ask the assistant">
      <label htmlFor="ask-entry" className="sr-only">
        Ask
      </label>
      <div className="flex items-center gap-2 rounded-md border bg-background px-3 py-1.5 focus-within:border-brand/60">
        <span className="readout text-muted-foreground">ask</span>
        <input
          id="ask-entry"
          value={question}
          onChange={(e) => setQuestion(e.target.value)}
          placeholder={placeholder}
          maxLength={300}
          autoComplete="off"
          className="min-w-0 flex-1 bg-transparent text-[13px] outline-none placeholder:text-muted-foreground"
        />
        <button
          type="submit"
          className="pressable inline-flex size-6 items-center justify-center rounded-sm text-muted-foreground hover:text-foreground"
          aria-label="Ask this"
        >
          <ArrowRight className="size-3.5" />
        </button>
      </div>
      {prompts.length > 0 ? (
        <div className="flex flex-wrap gap-1.5" data-testid="ask-prompts">
          {prompts.map((p) => (
            <button
              key={p}
              type="button"
              onClick={() => ask(p)}
              className="pressable rounded-full border px-2.5 py-0.5 text-[11.5px] text-muted-foreground hover:bg-muted hover:text-foreground"
            >
              {p}
            </button>
          ))}
        </div>
      ) : null}
    </form>
  );
}
