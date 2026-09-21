import Link from 'next/link';
import { ArrowRight } from 'lucide-react';
import { Stagger, StaggerItem } from '@/components/motion/reveal';
import type { OperationsSummary, Xray } from '@/lib/types';
import { cn } from '@/lib/utils';

/** The estate's five contexts, and which of the board's sources each one owns. */
const CHANNELS: { key: string; label: string; sources: string[] }[] = [
  { key: 'reproduction', label: 'Reproduction', sources: ['REPRODUCTION', 'INTAKE'] },
  { key: 'veterinary', label: 'Veterinary', sources: ['VETERINARY'] },
  { key: 'billing', label: 'Billing', sources: ['BILLING', 'STRIPE'] },
  { key: 'accounting', label: 'Accounting', sources: ['RECONCILIATION', 'QBO'] },
  { key: 'operations', label: 'Operations', sources: ['QUEUE', 'INTEGRATION', 'SYSTEM'] },
];

/**
 * The thesis in one strip, from live rows: five contexts with what each holds open, the
 * assistant between them, and the one decision they currently add up to for the story mare —
 * her leading signal's own words, and the door to the X-ray that shows why. The context that
 * raised it is the one that pulses.
 */
export function DecisionStrip({
  summary,
  xray,
  recipId,
  href = '/story#why',
}: {
  summary: OperationsSummary | null;
  xray: Xray | null;
  recipId: string | null;
  href?: string;
}) {
  const counted = new Set(CHANNELS.flatMap((c) => c.sources));
  const count = (channel: (typeof CHANNELS)[number]) =>
    Object.entries(summary?.bySource ?? {}).reduce(
      (n, [source, v]) =>
        n + (channel.sources.includes(source) || (channel.key === 'operations' && !counted.has(source)) ? v : 0),
      0,
    );
  const leading = xray?.unresolvedBoundary?.source ?? null;
  const leadingChannel = CHANNELS.find((c) => c.sources.includes(leading ?? '')) ?? (leading ? CHANNELS[4] : null);
  const block = xray?.blockId ? xray.nodes.find((n) => n.id === xray.blockId) : null;

  return (
    <div className="mt-8 grid items-center gap-3 md:grid-cols-[auto_auto_minmax(0,1fr)]" data-testid="decision-strip">
      <Stagger
        as="ul"
        className="flex min-w-0 flex-wrap gap-x-4 gap-y-1.5 md:grid md:grid-cols-1 md:gap-1.5"
        delay={0.5}
        step={0.07}
      >
        {CHANNELS.map((channel) => {
          const n = count(channel);
          const lit = channel.key === leadingChannel?.key;
          return (
            <StaggerItem
              as="li"
              key={channel.key}
              className="flex min-w-0 items-center gap-2 text-[10px] uppercase tracking-[0.14em] text-muted-foreground"
            >
              <span
                className={cn(
                  'relative size-1.5 shrink-0 rounded-full',
                  lit ? 'bg-warn' : n > 0 ? 'bg-copper-2/70' : 'bg-white/20',
                )}
                aria-hidden
              >
                {lit ? <span className="absolute inset-0 rounded-full bg-warn motion-safe:animate-ping" /> : null}
              </span>
              <span className={cn('min-w-0 truncate', lit && 'text-paper')}>{channel.label}</span>
              <span className="tabular-nums md:ml-auto">{n}</span>
            </StaggerItem>
          );
        })}
      </Stagger>
      <div className="hidden items-center gap-2 md:flex" aria-hidden>
        <span className="h-px w-8 bg-white/20" />
        <span className="rounded-full border border-copper-2/60 px-3 py-1 font-heading text-[10px] font-bold uppercase tracking-[0.2em] text-cream">
          Ask
        </span>
        <span className="h-px w-8 bg-white/20" />
      </div>
      {xray && recipId ? (
        <Link
          href={href}
          className="group pressable rounded-xl border border-white/[0.09] bg-[#11100f] px-4 py-3 lift hover:border-copper-2/60"
          data-testid="decision-strip-decision"
        >
          <p className="flex flex-wrap items-baseline gap-x-2 text-[10px] uppercase tracking-[0.16em] text-muted-foreground">
            <span className="code normal-case tracking-normal text-paper">{recipId}</span>
            {block ? (
              <span className="text-warn">{block.label}</span>
            ) : (
              <span className="text-ok">nothing waits on a person</span>
            )}
          </p>
          <p className="mt-1.5 text-[14px] leading-snug text-paper">{xray.conclusion}</p>
          {xray.unresolvedBoundary ? (
            <p className="mt-1 text-[11px] text-muted-foreground">
              waits for {xray.unresolvedBoundary.owner.toLowerCase().replace(/_/g, ' ')} ·{' '}
              {xray.unresolvedBoundary.next.toLowerCase()}
            </p>
          ) : null}
          <span className="mt-2 inline-flex items-center gap-1 text-[11px] font-bold uppercase tracking-[0.14em] text-cream">
            See why <ArrowRight className="size-3 transition-transform group-hover:translate-x-0.5" />
          </span>
        </Link>
      ) : (
        <p className="rounded-xl border border-dashed border-white/15 px-4 py-3 text-[12px] text-muted-foreground">
          The board is not reachable; nothing to decide here yet.
        </p>
      )}
    </div>
  );
}
