'use client';

import { useRef } from 'react';
import { motion, useInView, useReducedMotion } from 'motion/react';
import { EASE, SEC } from '@/lib/motion';
import { cn } from '@/lib/utils';

/**
 * A rail: one line, the stations on it, and where things stand. The story draws a mare's cycle
 * on it — the transfer, the checks, the fees, the check that is missing, the day she leaves,
 * foaling. Every station is a record or a rule's verdict — done, current, waiting, blocked, or
 * only planned — never a decoration. Positions are proportional to time; a break glyph marks
 * where the scale changes so the far end can sit on the same line. Labels take the nearest
 * free row above or below the line, so neighbours never sit on each other. The line draws
 * itself once, when it comes into view; a person who asked for stillness sees it whole.
 */
export type RailState = 'done' | 'current' | 'pending' | 'blocked' | 'planned';

export interface RailNode {
  key: string;
  /** Position along the rail, 0 to 1. */
  at: number;
  label: string;
  sub?: string;
  state: RailState;
}

export interface RailProps {
  nodes: RailNode[];
  /** Where "now" sits on the rail, 0 to 1; the line is solid up to here and dashed beyond. */
  now?: number;
  nowLabel?: string;
  /** Positions, 0 to 1, where the time scale changes. */
  breaks?: number[];
  /** What the rail is, for assistive technology. */
  label: string;
  className?: string;
}

const W = 1000;
const X0 = 24;
const X1 = W - 24;
const LABEL_PX = 13;
const SUB_PX = 11;
/** Average glyph width as a share of the font size, for the sans in use; generous so rows never touch. */
const GLYPH = 0.64;
/** The now label is uppercase and tracked wide. */
const GLYPH_CAPS = 0.9;
const GAP = 24;

const DOT: Record<RailState, { r: number; className: string }> = {
  done: { r: 6, className: 'fill-ok stroke-ok' },
  current: { r: 7, className: 'fill-copper-2 stroke-copper-2' },
  pending: { r: 6, className: 'fill-background stroke-muted-foreground' },
  blocked: { r: 7, className: 'fill-warn stroke-warn' },
  planned: { r: 6, className: 'fill-background stroke-muted-foreground' },
};

/**
 * Four rows for text: near above, near below, far above, far below. Offsets are from the
 * line; a far row gets a leader from its station so the eye never has to guess.
 */
const ROWS = [
  { label: -28, sub: -14, leaderTo: null },
  { label: 30, sub: 45, leaderTo: null },
  { label: -66, sub: -52, leaderTo: -44 },
  { label: 68, sub: 83, leaderTo: 52 },
] as const;

interface Entry {
  key: string;
  cx: number;
  anchor: 'start' | 'middle' | 'end';
  label: string;
  sub?: string;
  node?: RailNode;
}

interface Placed extends Entry {
  row: number;
}

function widthOf(e: Entry): number {
  const label = e.node ? e.label.length * LABEL_PX * GLYPH : e.label.length * SUB_PX * GLYPH_CAPS;
  return Math.max(label, (e.sub?.length ?? 0) * SUB_PX * GLYPH);
}

function extent(e: Entry): [number, number] {
  const w = widthOf(e);
  const left = e.anchor === 'start' ? e.cx : e.anchor === 'end' ? e.cx - w : e.cx - w / 2;
  return [left, left + w];
}

/** Greedy, left to right: the nearest row the label fits in, above and below in turn. */
function layout(entries: Entry[]): Placed[] {
  const lastRight = ROWS.map(() => Number.NEGATIVE_INFINITY);
  return [...entries]
    .sort((a, b) => a.cx - b.cx)
    .map((e, i) => {
      const [left, right] = extent(e);
      const preference = i % 2 === 0 ? [0, 1, 2, 3] : [1, 0, 3, 2];
      const row = preference.find((r) => lastRight[r]! + GAP <= left) ?? preference[0]!;
      lastRight[row] = Math.max(lastRight[row]!, right);
      return { ...e, row };
    });
}

export function Rail({ nodes, now, nowLabel, breaks = [], label, className }: RailProps) {
  const ref = useRef<HTMLDivElement | null>(null);
  const inView = useInView(ref, { once: true, margin: '-10% 0px' });
  const still = useReducedMotion();
  const shown = inView || still;
  const x = (at: number) => X0 + Math.max(0, Math.min(1, at)) * (X1 - X0);
  // Labels near an end hang inward from it, so nothing runs off the edge of the drawing.
  const anchorFor = (at: number): Entry['anchor'] => (at < 0.08 ? 'start' : at > 0.92 ? 'end' : 'middle');
  const nowX = now === undefined ? null : x(now);

  const entries: Entry[] = nodes.map((n) => ({
    key: n.key,
    cx: x(n.at),
    anchor: anchorFor(n.at),
    label: n.label,
    sub: n.sub,
    node: n,
  }));
  if (nowX !== null && nowLabel) entries.push({ key: '__now', cx: nowX, anchor: anchorFor(now!), label: nowLabel });
  const placed = layout(entries);

  const usesRow = (r: number) => placed.some((p) => p.row === r);
  const Y = usesRow(2) ? 82 : 44;
  const H = Y + (usesRow(3) ? 94 : 56);
  const enter = (i: number) => ({
    initial: { opacity: 0 },
    animate: shown ? { opacity: 1 } : { opacity: 0 },
    transition: { duration: SEC.reveal, delay: still ? 0 : 0.2 + i * 0.05, ease: EASE.outQuart },
  });

  return (
    <div ref={ref} className={cn('w-full', className)}>
      <svg viewBox={`0 0 ${W} ${H}`} className="h-auto w-full" role="img" aria-label={label}>
        {/* The rail: solid where it has happened, dashed where it has not. */}
        <motion.line
          x1={X0}
          y1={Y}
          x2={nowX ?? X1}
          y2={Y}
          className="stroke-copper-2"
          strokeWidth={1.5}
          initial={{ pathLength: 0 }}
          animate={{ pathLength: shown ? 1 : 0 }}
          transition={{ duration: still ? 0 : 0.9, ease: EASE.outQuart }}
        />
        {nowX !== null ? (
          <motion.line
            x1={nowX}
            y1={Y}
            x2={X1}
            y2={Y}
            className="stroke-muted-foreground"
            strokeWidth={1.2}
            strokeDasharray="3 5"
            {...enter(6)}
          />
        ) : null}
        {breaks.map((b) => {
          const bx = x(b);
          return (
            <g key={`break-${b}`}>
              <rect x={bx - 7} y={Y - 8} width={14} height={16} className="fill-card" />
              <path
                d={`M${bx - 5} ${Y + 7} l4 -14 M${bx + 1} ${Y + 7} l4 -14`}
                className="stroke-muted-foreground"
                strokeWidth={1.2}
                fill="none"
              />
            </g>
          );
        })}
        {nowX !== null ? (
          <motion.line
            x1={nowX}
            y1={Y - 9}
            x2={nowX}
            y2={Y + 9}
            className="stroke-copper-2"
            strokeWidth={2}
            strokeLinecap="round"
            {...enter(4)}
          />
        ) : null}
        {placed.map((p, i) => {
          const row = ROWS[p.row]!;
          const n = p.node;
          const dot = n ? DOT[n.state] : null;
          const r = dot?.r ?? 9;
          const muted = !n || n.state === 'planned' || n.state === 'pending';
          return (
            <motion.g key={p.key} {...enter(i)}>
              {row.leaderTo !== null ? (
                <line
                  x1={p.cx}
                  y1={row.leaderTo < 0 ? Y - r - 3 : Y + r + 3}
                  x2={p.cx}
                  y2={Y + row.leaderTo}
                  className="stroke-border"
                  strokeWidth={1}
                />
              ) : null}
              {n && dot ? (
                <>
                  {n.state === 'current' ? <circle cx={p.cx} cy={Y} r={14} className="fill-copper-2/15" /> : null}
                  <circle
                    cx={p.cx}
                    cy={Y}
                    r={dot.r}
                    className={dot.className}
                    strokeWidth={1.5}
                    strokeDasharray={n.state === 'planned' ? '2 2' : undefined}
                  />
                  {n.state === 'done' ? (
                    <path
                      d={`M${p.cx - 3} ${Y} l2 2 l4 -4`}
                      className="stroke-background"
                      strokeWidth={1.6}
                      fill="none"
                      strokeLinecap="round"
                    />
                  ) : null}
                  {n.state === 'blocked' ? (
                    <path
                      d={`M${p.cx} ${Y - 3.5} v4 M${p.cx} ${Y + 2.5} v0.6`}
                      className="stroke-background"
                      strokeWidth={1.6}
                      fill="none"
                      strokeLinecap="round"
                    />
                  ) : null}
                </>
              ) : null}
              <text
                x={p.cx}
                y={Y + row.label}
                textAnchor={p.anchor}
                className={cn(
                  n ? 'font-medium' : 'uppercase tracking-[0.16em]',
                  n?.state === 'blocked'
                    ? 'fill-warn'
                    : !n
                      ? 'fill-copper-2'
                      : muted
                        ? 'fill-muted-foreground'
                        : 'fill-foreground',
                )}
                style={{ fontSize: n ? LABEL_PX : SUB_PX }}
              >
                {p.label}
              </text>
              {p.sub ? (
                <text
                  x={p.cx}
                  y={Y + row.sub}
                  textAnchor={p.anchor}
                  className="fill-muted-foreground"
                  style={{ fontSize: SUB_PX }}
                >
                  {p.sub}
                </text>
              ) : null}
            </motion.g>
          );
        })}
      </svg>
    </div>
  );
}
