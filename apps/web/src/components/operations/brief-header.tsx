'use client';

import Link from 'next/link';
import type { ReactNode } from 'react';
import { CountUp } from '@/components/motion/count-up';
import { dateTime, day, hrefFor, label, usd } from '@/lib/format';
import type { Brief } from '@/lib/types';
import { cn } from '@/lib/utils';

/**
 * The morning brief, above the board: five numbers that arrive, then what needs a person
 * first, the next two days as the rules see them, and what the audit trail recorded since
 * yesterday's snapshot. Every figure is read from the tables now; the comparison is against a
 * row this app wrote, and when there is none yet the tile says so instead of inventing one.
 */
export function BriefHeader({ brief }: { brief: Brief }) {
  const raised = brief.sinceYesterday.raised.length;
  const resolved = brief.sinceYesterday.resolved.length;
  const blocked = brief.lookahead.filter((i) => i.state === 'blocked').length;
  const due = brief.lookahead.filter((i) => i.state === 'due').length;
  const since = brief.baseline ? `since ${dateTime(brief.baseline.takenAt)}` : 'in the last 24 hours';
  const openDelta = brief.baseline ? brief.open - brief.baseline.open : null;
  const stakeDelta = brief.baseline ? brief.atStakeCents - brief.baseline.atStakeCents : null;
  const signed = (n: number) => `${n > 0 ? '+' : '−'}${Math.abs(n)}`;
  const critical = (brief.bySeverity['CRITICAL'] ?? 0) > 0;
  const days = groupByDay(brief.lookahead);

  return (
    <section className="space-y-3" data-testid="brief" aria-label="Morning brief">
      <div className="grid grid-cols-2 gap-px overflow-hidden rounded-md border bg-border md:grid-cols-5">
        <Tile
          label="need a person"
          value={brief.open}
          tone={critical ? 'critical' : brief.open > 0 ? 'warn' : 'ok'}
          sub={
            openDelta === null
              ? 'first brief · no snapshot from yesterday yet'
              : openDelta === 0
                ? `no change ${since}`
                : `${signed(openDelta)} ${since}`
          }
          aside={<Sparkline points={brief.series.map((p) => p.open)} />}
        />
        <Tile
          label="need you"
          value={brief.viewer.forYou}
          tone={brief.viewer.forYou > 0 ? 'warn' : 'ok'}
          sub={
            brief.viewer.role === 'ADMIN'
              ? 'every decision is the founder’s'
              : `the next step is ${label(brief.viewer.role)}’s`
          }
          testid="brief-for-you"
        />
        <Tile
          label="waits on them"
          value={brief.atStakeCents}
          format="usd"
          sub={
            stakeDelta === null || stakeDelta === 0
              ? `${brief.withStake} row${brief.withStake === 1 ? '' : 's'} hold${brief.withStake === 1 ? 's' : ''} money`
              : `${stakeDelta > 0 ? '+' : '−'}${usd(Math.abs(stakeDelta))} ${since}`
          }
        />
        <Tile
          label="since yesterday"
          value={raised}
          format="signed"
          sub={`${resolved} resolved · ${brief.baseline ? 'against the snapshot' : 'no snapshot yet'}`}
        />
        <Tile
          label="next 48 hours"
          value={brief.lookahead.length}
          tone={blocked > 0 ? 'warn' : undefined}
          sub={brief.lookahead.length === 0 ? 'today and tomorrow' : `${blocked} blocked · ${due} due`}
        />
      </div>

      <div className="grid gap-3 lg:grid-cols-3">
        <Panel eyebrow="Needs you first" count={brief.needsYou.length} testid="brief-needs-you">
          {brief.needsYou.length === 0 ? (
            <Empty>Nothing needs a person. The detectors run every minute.</Empty>
          ) : (
            <ol className="divide-y">
              {brief.needsYou.map((row) => (
                <li key={row.id}>
                  <Link
                    href={`/signals/${row.id}`}
                    className="row pressable flex min-w-0 items-center gap-2 px-3 py-1.5 text-[12px] hover:bg-muted/40"
                  >
                    <span
                      className={cn(
                        'size-1.5 shrink-0 rounded-full',
                        row.severity === 'CRITICAL'
                          ? 'bg-critical'
                          : row.severity === 'WARN'
                            ? 'bg-warn'
                            : 'bg-muted-foreground',
                      )}
                      aria-hidden
                    />
                    <span className="min-w-0 flex-1 truncate">
                      {row.label}
                      {row.entityId ? <span className="code ml-1.5 text-muted-foreground">{row.entityId}</span> : null}
                    </span>
                    {row.stakeCents !== null ? (
                      <span className="money shrink-0 font-medium">{usd(row.stakeCents)}</span>
                    ) : null}
                    <span className="readout shrink-0 text-muted-foreground">{label(row.owner)}</span>
                  </Link>
                </li>
              ))}
            </ol>
          )}
        </Panel>

        <Panel eyebrow="Next 48 hours" count={brief.lookahead.length} testid="brief-lookahead">
          {days.length === 0 ? (
            <Empty>Nothing scheduled for today or tomorrow.</Empty>
          ) : (
            days.map(([on, items]) => (
              <div key={on}>
                <p className="readout border-b bg-muted/40 px-3 py-1 text-muted-foreground">
                  {on === brief.barnDate ? 'Today' : 'Tomorrow'} · {day(`${on}T12:00:00Z`)}
                </p>
                <ul className="divide-y">
                  {items.map((item) => {
                    const href = item.entityId ? hrefFor(item.entityId) : null;
                    return (
                      <li
                        key={`${item.kind}:${item.label}`}
                        className="flex items-baseline gap-2 px-3 py-1.5 text-[12px]"
                      >
                        <span
                          className={cn(
                            'size-1.5 shrink-0 translate-y-[-1px] rounded-full',
                            item.state === 'blocked'
                              ? 'bg-warn'
                              : item.state === 'due'
                                ? 'bg-foreground'
                                : item.state === 'ready'
                                  ? 'bg-ok'
                                  : 'bg-muted-foreground',
                          )}
                          aria-hidden
                        />
                        <span className="min-w-0 flex-1">
                          {href ? (
                            <Link href={href} className="hover:underline">
                              {item.label}
                            </Link>
                          ) : (
                            item.label
                          )}
                          <span className="ml-1.5 text-muted-foreground">{item.note}</span>
                        </span>
                        {item.amountCents !== undefined ? (
                          <span className="money shrink-0">{usd(item.amountCents)}</span>
                        ) : null}
                        <span
                          className={cn(
                            'readout shrink-0',
                            item.state === 'blocked' ? 'text-warn' : 'text-muted-foreground',
                          )}
                        >
                          {item.state}
                        </span>
                      </li>
                    );
                  })}
                </ul>
              </div>
            ))
          )}
        </Panel>

        <Panel
          eyebrow="What changed"
          count={brief.sinceYesterday.changes.reduce((n, g) => n + g.count, 0)}
          testid="brief-changes"
        >
          {brief.sinceYesterday.changes.length === 0 ? (
            <Empty>Nothing recorded {since}.</Empty>
          ) : (
            <ul className="divide-y">
              {brief.sinceYesterday.changes.map((group) => (
                <li key={group.context} className="px-3 py-1.5 text-[12px]">
                  <div className="flex items-baseline justify-between gap-2">
                    <span className="eyebrow">{group.context}</span>
                    <span className="tabular-nums text-muted-foreground">{group.count}</span>
                  </div>
                  <p className="mt-0.5 text-muted-foreground">
                    {group.actions
                      .slice(0, 4)
                      .map((a) => `${a.label}${a.count > 1 ? ` ×${a.count}` : ''}`)
                      .join(' · ')}
                    {group.actions.length > 4 ? ` · +${group.actions.length - 4} more` : ''}
                  </p>
                </li>
              ))}
            </ul>
          )}
        </Panel>
      </div>
    </section>
  );
}

function groupByDay(items: Brief['lookahead']): [string, Brief['lookahead']][] {
  const byDay = new Map<string, Brief['lookahead']>();
  for (const item of items) byDay.set(item.on, [...(byDay.get(item.on) ?? []), item]);
  return [...byDay.entries()].sort(([a], [b]) => a.localeCompare(b));
}

function Tile({
  label: text,
  value,
  format,
  sub,
  tone,
  aside,
  testid,
}: {
  label: string;
  value: number;
  format?: 'usd' | 'signed';
  sub: string;
  tone?: 'ok' | 'warn' | 'critical';
  aside?: ReactNode;
  testid?: string;
}) {
  return (
    <div className="bg-background px-3 py-2.5" data-testid={testid}>
      <div className="flex items-end justify-between gap-2">
        <p
          className={cn(
            'text-[26px] font-semibold leading-none tracking-tight',
            tone === 'warn' && 'text-warn',
            tone === 'critical' && 'text-critical',
            tone === 'ok' && 'text-ok',
          )}
        >
          <CountUp value={value} format={format} />
        </p>
        {aside}
      </div>
      <p className="eyebrow mt-1.5">{text}</p>
      <p className="mt-0.5 truncate text-[11px] text-muted-foreground">{sub}</p>
    </div>
  );
}

/** The board over the last snapshots, when there are enough of them to be a line. */
function Sparkline({ points }: { points: number[] }) {
  if (points.length < 4) return null;
  const width = 64;
  const height = 20;
  const max = Math.max(...points);
  const min = Math.min(...points);
  const y = (p: number) => height - 1 - ((p - min) / Math.max(1, max - min)) * (height - 2);
  const d = points
    .map((p, i) => `${i === 0 ? 'M' : 'L'} ${((i / (points.length - 1)) * width).toFixed(1)} ${y(p).toFixed(1)}`)
    .join(' ');
  const last = points[points.length - 1] ?? 0;
  return (
    <svg
      viewBox={`0 0 ${width} ${height}`}
      className="h-5 w-16 shrink-0 overflow-visible"
      role="img"
      aria-label={`open items over the last ${points.length} snapshots: ${points.join(', ')}`}
    >
      <path d={d} fill="none" className="stroke-muted-foreground" strokeWidth={1.2} />
      <circle cx={width} cy={y(last)} r={1.8} className="fill-warn" />
    </svg>
  );
}

function Panel({
  eyebrow,
  count,
  testid,
  children,
}: {
  eyebrow: string;
  count: number;
  testid: string;
  children: ReactNode;
}) {
  return (
    <section className="min-w-0 overflow-hidden rounded-md border" data-testid={testid}>
      <header className="flex items-baseline justify-between border-b px-3 py-1.5">
        <h2 className="eyebrow">{eyebrow}</h2>
        <span className="text-[11px] tabular-nums text-muted-foreground">{count}</span>
      </header>
      {children}
    </section>
  );
}

function Empty({ children }: { children: ReactNode }) {
  return <p className="px-3 py-4 text-center text-[12px] text-muted-foreground">{children}</p>;
}
