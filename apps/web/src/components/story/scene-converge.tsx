'use client';

import Link from 'next/link';
import { motion } from 'motion/react';
import { CountUp } from '@/components/motion/count-up';
import { usd } from '@/lib/format';
import { EASE, PRESET } from '@/lib/motion';
import type { OperationsSummary, Signal } from '@/lib/types';
import { cn } from '@/lib/utils';

const CHANNEL_ORDER = ['SALE', 'RECIPIENT', 'REPRODUCTION', 'ACCOUNTING'] as const;

/**
 * The board's argument, drawn from live rows: four of its signals dealt onto the table one by
 * one, and the lines from each converging on the one number the estate adds up to today. Nothing here is an illustration — every card is
 * a row with its own page, the count is the board's count, and the same page without a running
 * API shows the words alone.
 */
export function SceneConverge({ signals, summary }: { signals: Signal[]; summary: OperationsSummary | null }) {
  const cards = CHANNEL_ORDER.map((channel) => signals.find((s) => s.channel === channel) ?? null).filter(
    (s): s is Signal => s !== null,
  );
  const total = summary?.open ?? signals.length;
  // Cards sit on a 4-column line; every line runs to the count below. Percentages so the SVG scales with the frame.
  const slots = cards.map((_, i) => 12.5 + (i * 75) / Math.max(1, cards.length - 1));

  return (
    <div
      className="frame-story relative overflow-hidden px-5 pb-6 pt-5 md:px-8"
      data-testid="converge"
      aria-label={`${total} active signals across the estate`}
    >
      <p className="text-[10px] uppercase tracking-[0.16em] text-muted-foreground">
        The board, as it stands · every card a row with its own page
      </p>

      {/* One set of cards for both compositions: dealt across a line on a desk, stacked on a phone. The lines run from each card's foot to the count, drawn after the cards land. */}
      <div className="relative mt-3 space-y-2 md:mt-4 md:h-[264px] md:space-y-0">
        <svg
          className="absolute inset-0 hidden h-full w-full md:block"
          viewBox="0 0 100 100"
          preserveAspectRatio="none"
          aria-hidden
        >
          {slots.map((x, i) => (
            <motion.path
              key={cards[i]?.id ?? i}
              d={`M ${x} 38 C ${x} 64, 50 60, 50 80`}
              fill="none"
              stroke="rgb(212 138 96 / 0.55)"
              strokeWidth={0.35}
              vectorEffect="non-scaling-stroke"
              initial={{ pathLength: 0, opacity: 0 }}
              animate={{ pathLength: 1, opacity: 1 }}
              transition={{ duration: 1.1, ease: EASE.outQuart, delay: 0.9 + i * 0.12 }}
            />
          ))}
        </svg>
        {cards.map((s, i) => (
          <motion.div
            key={s.id}
            className="md:absolute md:top-0 md:w-[200px] md:-translate-x-1/2"
            style={{ left: `${slots[i]}%` }}
            initial={{ opacity: 0, y: -18, rotate: i % 2 === 0 ? -2 : 2 }}
            animate={{ opacity: 1, y: 0, rotate: i % 2 === 0 ? -1 : 1 }}
            transition={{ ...PRESET.reveal, delay: 0.5 + i * 0.14 }}
          >
            <SignalCard signal={s} />
          </motion.div>
        ))}
        <motion.div
          className="pt-2 text-center md:absolute md:bottom-0 md:left-1/2 md:-translate-x-1/2 md:pt-0"
          initial={{ opacity: 0, scale: 0.96 }}
          animate={{ opacity: 1, scale: 1 }}
          transition={{ ...PRESET.reveal, delay: 1.6 }}
        >
          <Count total={total} atStakeCents={summary?.atStakeCents ?? 0} />
        </motion.div>
      </div>
    </div>
  );
}

function Count({ total, atStakeCents }: { total: number; atStakeCents: number }) {
  return (
    <div
      className="inline-flex flex-col items-center rounded-2xl border border-copper-2/40 bg-[rgb(11_7_7/0.85)] px-6 py-3 shadow-[0_0_0_10px_rgb(212_138_96/0.05)]"
      data-testid="converge-count"
    >
      <span className="display text-[40px] leading-none text-paper">
        <CountUp value={total} />{' '}
        <span className="text-[16px] tracking-tight text-cream">decision{total === 1 ? '' : 's'} need attention</span>
      </span>
      <span className="mt-1.5 text-[9.5px] uppercase tracking-[0.16em] text-muted-foreground">
        {total} active signals
        {atStakeCents > 0 ? (
          <>
            {' '}
            · <span className="money text-cream">{usd(atStakeCents)}</span> at stake
          </>
        ) : null}
      </span>
    </div>
  );
}

function SignalCard({ signal: s }: { signal: Signal }) {
  return (
    <Link
      href={`/signals/${s.id}`}
      className="card-op block p-3 text-left transition-colors hover:border-white/25 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-copper-2"
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
      <p className="mt-1 text-[11.5px] leading-snug text-paper">{s.label}</p>
      <p className="mt-1.5 truncate text-[10px] text-muted-foreground">
        {s.stake ? (
          <span className="money mr-1 text-[11px] font-semibold text-paper">{usd(s.stake.amountCents)}</span>
        ) : null}
        {s.next}
        {s.stake ? '' : ` · ${s.entityId ?? s.id}`}
      </p>
    </Link>
  );
}
