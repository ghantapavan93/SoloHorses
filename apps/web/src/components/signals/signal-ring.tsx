'use client';

import Link from 'next/link';
import { usd } from '@/lib/format';
import type { Signal } from '@/lib/types';
import { cn } from '@/lib/utils';

const CHANNEL_ORDER = ['SALE', 'RECIPIENT', 'REPRODUCTION', 'ACCOUNTING'] as const;

/**
 * The hero's ring: not decoration. Four live signals from the board — the sale's settlement,
 * a recipient's return, a reproduction handoff, the books — each one a real row with its id,
 * each clickable into its evidence and the one door to where a person acts. The count in the
 * middle is the board's count.
 */
export function SignalRing({ signals, total }: { signals: Signal[]; total: number }) {
  const first = CHANNEL_ORDER.map((channel) => signals.find((s) => s.channel === channel) ?? null);
  const positions = [
    'left-[1%] top-[12%] -rotate-[4deg]',
    'right-[1%] top-[6%] rotate-[3deg]',
    'left-[4%] bottom-[9%] rotate-[2deg]',
    'right-[3%] bottom-[14%] -rotate-[3deg]',
  ];
  return (
    <div
      className="relative mx-auto aspect-square w-full max-w-[560px]"
      aria-label="Active signals: what needs a person right now, from the board"
    >
      <div className="absolute inset-0 -rotate-[5deg] rounded-[42%_58%_55%_45%/46%_44%_56%_54%] border border-white/[0.08] bg-[radial-gradient(circle_at_52%_44%,rgb(103_51_35/0.26),rgb(21_15_14/0.62)_45%,rgb(8_6_6/0.92))] shadow-[inset_0_0_60px_rgb(255_255_255/0.025),0_30px_100px_rgb(0_0_0/0.35)]" />
      <div className="absolute inset-[8%] rotate-[11deg] rounded-[50%_48%_54%_44%] border border-white/[0.07]" />
      <div className="absolute inset-[19%] -rotate-[16deg] rounded-[50%_48%_54%_44%] border border-white/[0.07]" />
      <div className="absolute left-1/2 top-1/2 flex size-[132px] -translate-x-1/2 -translate-y-1/2 flex-col items-center justify-center rounded-full border border-copper-2/40 bg-[rgb(11_7_7/0.85)] text-center shadow-[0_0_0_10px_rgb(212_138_96/0.06)]">
        <span className="text-[38px] font-semibold leading-none tabular-nums text-paper">{total}</span>
        <span className="mt-1 text-[9px] uppercase tracking-[0.16em] text-muted-foreground">active signals</span>
      </div>
      {first.map((s, i) =>
        s ? (
          <Link
            key={s.id}
            href={`/signals/${s.id}`}
            className={cn(
              'absolute block w-[168px] rounded-2xl border border-white/10 bg-[rgb(19_14_13/0.78)] p-3.5 text-left shadow-[0_18px_45px_rgb(0_0_0/0.4)] backdrop-blur-md transition-colors hover:border-white/25 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-copper-2',
              positions[i],
            )}
            data-testid={`signal-${s.channel.toLowerCase()}`}
            aria-label={`${s.channelLabel}: ${s.label}. ${s.stake ? `${usd(s.stake.amountCents)} ${s.stake.label}. ` : ''}${s.next}.`}
          >
            <p className="flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-[0.12em] text-paper">
              <span
                className={cn(
                  'size-1.5 rounded-full',
                  s.severity === 'CRITICAL'
                    ? 'bg-critical shadow-[0_0_0_4px_rgb(224_92_84/0.22)]'
                    : 'bg-warn shadow-[0_0_0_4px_rgb(217_164_95/0.25)]',
                )}
                aria-hidden
              />
              {s.channelLabel}
            </p>
            <p className="mt-1 text-[11px] leading-snug text-paper">{s.label}</p>
            {/* the money, when there is money; the id otherwise — the signal's page has both */}
            <p className="mt-1.5 truncate text-[10px] text-muted-foreground">
              {s.stake ? (
                <span className="money mr-1 text-[11px] font-semibold text-paper">{usd(s.stake.amountCents)}</span>
              ) : null}
              {s.next}
              {s.stake ? '' : ` · ${s.entityId ?? s.id}`}
            </p>
          </Link>
        ) : (
          <div
            key={CHANNEL_ORDER[i]}
            className={cn(
              'absolute w-[168px] rounded-2xl border border-dashed border-white/10 p-3.5 text-[10px] uppercase tracking-[0.12em] text-muted-foreground',
              positions[i],
            )}
          >
            {CHANNEL_ORDER[i].toLowerCase()} · quiet
          </div>
        ),
      )}
      <p className="absolute bottom-[1%] left-1/2 -translate-x-1/2 whitespace-nowrap rounded-full border border-white/10 bg-[rgb(11_7_7/0.7)] px-3 py-1.5 text-[9px] uppercase tracking-[0.08em] text-muted-foreground">
        click a signal → evidence → who acts
      </p>
    </div>
  );
}
