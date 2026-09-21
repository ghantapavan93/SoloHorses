'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { ArrowRight, Sparkles } from 'lucide-react';
import { useAskDock } from '@/components/ask/ask-dock';
import { cn } from '@/lib/utils';

/**
 * The doors a record offers into the assistant: why it is blocked, the request the assistant
 * may prepare, the decision already on record. Inside the shell the questions go to the dock;
 * outside it (nowhere yet) they would ride on the address.
 */
export function AskButtons({
  subject,
  vet,
  decisionHref,
  decisionStatus,
  className,
}: {
  subject: string;
  vet: boolean;
  decisionHref: string | null;
  decisionStatus: string | null;
  className?: string;
}) {
  const dock = useAskDock();
  const router = useRouter();
  const ask = (question: string) => {
    if (dock) dock.ask(question);
    else router.push(`/today?ask=${encodeURIComponent(question)}`);
  };
  return (
    <div className={cn('flex flex-wrap items-center gap-1.5', className)} data-testid="ask-buttons">
      <button
        type="button"
        onClick={() => ask(`What is blocking ${subject}?`)}
        className="pressable inline-flex h-7 items-center gap-1 rounded-md border px-2.5 text-[12px] hover:bg-muted"
        data-testid="record-why"
      >
        <Sparkles className="size-3 text-brand" aria-hidden /> Why?
      </button>
      {vet ? (
        <button
          type="button"
          onClick={() => ask(`Prepare the vet request for ${subject}`)}
          className="pressable inline-flex h-7 items-center gap-1 rounded-md border border-brand/60 px-2.5 text-[12px] font-medium text-brand hover:bg-brand-tint"
          data-testid="record-prepare"
        >
          Prepare request
        </button>
      ) : null}
      {decisionHref ? (
        <Link
          href={decisionHref}
          className="inline-flex h-7 items-center gap-1 rounded-md border px-2.5 text-[12px] hover:bg-muted"
          data-testid="record-decision"
        >
          Decision {decisionStatus === 'PROPOSED' ? 'waiting' : 'history'} <ArrowRight className="size-3" aria-hidden />
        </Link>
      ) : null}
    </div>
  );
}

/** One question as a button, for an empty state that teaches the feature instead of announcing emptiness. */
export function AskCta({
  question,
  children,
  className,
}: {
  question: string;
  children: React.ReactNode;
  className?: string;
}) {
  const dock = useAskDock();
  const router = useRouter();
  const ask = () => {
    if (dock) dock.ask(question);
    else router.push(`/today?ask=${encodeURIComponent(question)}`);
  };
  return (
    <button
      type="button"
      onClick={ask}
      className={cn(
        'pressable inline-flex h-8 items-center gap-1.5 rounded-md border px-3 text-[12.5px] hover:bg-muted',
        className,
      )}
      data-testid="ask-cta"
    >
      <Sparkles className="size-3.5 text-brand" aria-hidden /> {children}
    </button>
  );
}
