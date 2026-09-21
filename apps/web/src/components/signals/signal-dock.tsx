'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { ArrowRight, Radio } from 'lucide-react';
import { useLiveRefresh } from '@/components/platform/use-platform-stream';
import { usd } from '@/lib/format';
import type { Signal } from '@/lib/types';
import { cn } from '@/lib/utils';

/**
 * The corner that follows a reviewer everywhere: the board's open signals, the same ids on
 * every page. Open one and it is the same drawer the landing's ring opens; the door inside it
 * goes to the page where a person acts. It refreshes itself when the board moves.
 */
export function SignalDock({ signals, total }: { signals: Signal[]; total: number }) {
  const [open, setOpen] = useState(false);
  useLiveRefresh((s) => s.kind === 'exception', 800);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false);
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open]);

  const critical = signals.filter((s) => s.severity === 'CRITICAL').length;
  return (
    <div className="fixed bottom-4 right-4 z-40 flex flex-col items-end gap-2 print:hidden" data-testid="signal-dock">
      {open ? (
        <nav
          aria-label="Active signals"
          className="w-[320px] max-w-[calc(100vw-2rem)] overflow-hidden rounded-2xl border bg-background/95 shadow-[0_24px_60px_rgb(0_0_0/0.35)] backdrop-blur-md"
        >
          <div className="flex items-center justify-between border-b px-3 py-2">
            <span className="text-[10px] font-bold uppercase tracking-[0.14em]">Active signals</span>
            <span className="tabular-nums text-[11px] text-muted-foreground">
              {total > signals.length ? `${signals.length} of ${total}` : total}
            </span>
          </div>
          <ul className="max-h-[52vh] divide-y overflow-y-auto">
            {signals.map((s) => (
              <li key={s.id}>
                <Link
                  href={`/signals/${s.id}`}
                  className="row grid w-full grid-cols-[8px_minmax(0,1fr)_auto] items-center gap-2.5 px-3 py-2 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  onClick={() => setOpen(false)}
                  data-testid={`dock-${s.id}`}
                >
                  <span
                    className={cn(
                      'size-2 rounded-full',
                      s.severity === 'CRITICAL'
                        ? 'bg-critical'
                        : s.severity === 'WARN'
                          ? 'bg-warn'
                          : 'bg-muted-foreground',
                    )}
                    aria-hidden
                  />
                  <span className="min-w-0">
                    <span className="block truncate text-[12px] font-medium">{s.label}</span>
                    <span className="block truncate text-[10px] text-muted-foreground">
                      {s.stake ? (
                        <span className="money mr-1 font-semibold text-foreground">{usd(s.stake.amountCents)}</span>
                      ) : null}
                      {s.channelLabel} · {s.entityId ?? s.id} · {s.next}
                    </span>
                  </span>
                  <span className="text-[10px] text-muted-foreground">Open →</span>
                </Link>
              </li>
            ))}
            {signals.length === 0 ? (
              <li className="px-3 py-4 text-center text-[12px] text-muted-foreground">
                Nothing needs a person right now.
              </li>
            ) : null}
          </ul>
        </nav>
      ) : null}
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-label={`${total} active signals`}
        aria-expanded={open}
        className={cn(
          'flex h-12 items-center gap-2 rounded-full border bg-background/95 pl-3 pr-4 text-[12px] shadow-[0_16px_40px_rgb(0_0_0/0.3)] backdrop-blur-md transition-colors hover:bg-muted',
          critical > 0 ? 'border-critical/50' : 'border-warn/40',
        )}
        data-testid="signal-dock-button"
      >
        <Radio className={cn('size-4', critical > 0 ? 'text-critical' : 'text-warn')} />
        <span className="text-[16px] font-semibold tabular-nums">{total}</span>
        <span className="text-[10px] uppercase tracking-[0.12em] text-muted-foreground">signals</span>
        <ArrowRight
          className={cn(
            'size-3.5 text-muted-foreground transition-transform motion-reduce:transition-none',
            open && 'rotate-90',
          )}
        />
      </button>
    </div>
  );
}
