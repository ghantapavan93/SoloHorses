'use client';

import { useEffect, useState, type ReactNode } from 'react';
import { useLiveRefresh } from '@/components/platform/use-platform-stream';
import type { PlatformSignalEnvelope } from '@/lib/types';
import { cn } from '@/lib/utils';

/**
 * A section the assistant sent the person to: scrolled into view and lit on arrival, and kept
 * live — when a decision about this record is made or a request is sent, the page re-reads
 * itself and says so for a moment. Push from the platform bus, no reload, no polling.
 */
export function FocusLive({
  id,
  focused,
  announce = true,
  about,
  children,
  className,
}: {
  id: string;
  focused: boolean;
  /** Whether this section says "updated just now" — one section speaks, not every one on the page. */ announce?: boolean;
  /** The record codes a change must mention to be about this section. */ about: string[];
  children: ReactNode;
  className?: string;
}) {
  const [updatedAt, setUpdatedAt] = useState<number | null>(null);
  useLiveRefresh((signal: PlatformSignalEnvelope) => {
    const hit =
      (signal.kind === 'event' &&
        /^(ProposalDecided|CheckRecorded|ClearanceRecorded|HorseUpdated|PlannedRecipientAssigned)$/.test(
          signal.type,
        )) ||
      (signal.kind === 'exception' && about.some((code) => signal.title.includes(code)));
    if (hit) setUpdatedAt(Date.now());
    return hit;
  });

  useEffect(() => {
    if (!focused) return;
    const el = document.getElementById(id);
    el?.scrollIntoView({ block: 'start', behavior: 'smooth' });
  }, [id, focused]);

  useEffect(() => {
    if (updatedAt === null) return;
    const timer = setTimeout(() => setUpdatedAt(null), 6_000);
    return () => clearTimeout(timer);
  }, [updatedAt]);

  return (
    <section
      id={id}
      className={cn(
        'relative scroll-mt-16 rounded-md transition-[box-shadow,background-color] duration-[var(--dur-base)] ease-[var(--ease-out)]',
        focused && 'bg-brand-tint/20 ring-1 ring-brand/50',
        className,
      )}
      data-testid={`focus-${id}`}
      data-focused={focused ? 'true' : undefined}
    >
      {updatedAt !== null && announce ? (
        <span
          className="absolute right-2 top-2 rounded-sm bg-ok/15 px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wider text-ok"
          data-testid="updated-just-now"
        >
          Updated just now
        </span>
      ) : null}
      {children}
    </section>
  );
}
