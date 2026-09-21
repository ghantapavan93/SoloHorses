'use client';

import { useState } from 'react';
import type { MembraneRun } from '@/lib/membrane';
import { useStillness } from '@/lib/use-stillness';
import type { AskAuthority } from '@/lib/types';
import { cn } from '@/lib/utils';

/**
 * The assistant, drawn as the thing it is.
 *
 * There is a boundary between the assistant and the operation's records, and every visual
 * decision here is anchored to it: the vertical line down the middle. A read-only tool's line
 * crosses it, solid. The one action the assistant may propose reaches a locked gate ON the
 * boundary and stops there until a person opens it. What it will never do is severed at the
 * boundary and never reaches the far side — the gap is the information, not the colour.
 *
 * Fed a run, it becomes live: every tool the assistant actually reached for lights along its
 * own path in sequence, a refusal lights the strand the boundary held on, and an approved
 * proposal turns the gate green. Nothing here is decoration; the states are the product's own
 * (brand = read, warn = waits for a person, ok = a person said yes, border = idle).
 *
 * Deliberately not: glow, gradients, particles, or a palette that says "AI".
 */

const W = 940;
const ROW = 26;
const AGENT_X = 118;
const MEMBRANE_X = 446;
const TOOL_X = 604;
const BAND_GAP = 44;
const TOP = 62;

type Band = 'read_only' | 'requires_approval' | 'refused';

const BAND_LABEL: Record<Band, string> = {
  read_only: 'Reads, freely',
  requires_approval: 'Through a person',
  refused: 'Never',
};
const BAND_CLASS: Record<Band, string> = {
  read_only: 'fill-brand',
  requires_approval: 'fill-warn',
  refused: 'fill-muted-foreground',
};

/** A cubic that leaves the core at one angle and arrives flat, so the eye reads the bundle first and the strand second. */
function pathTo(y: number, endX: number, midY: number): string {
  const midX = (AGENT_X + endX) / 2;
  return `M ${AGENT_X} ${midY} C ${midX} ${midY}, ${midX} ${y}, ${endX} ${y}`;
}

interface Row {
  key: string;
  label: string;
  band: Band;
  y: number;
  description: string;
}

export function AgentMembrane({
  catalog,
  run,
  className,
}: {
  catalog: AskAuthority;
  run: MembraneRun | null;
  className?: string;
}) {
  const [hovered, setHovered] = useState<string | null>(null);
  const still = useStillness();

  const readOnly = catalog.tools.filter((t) => t.authority === 'read_only');
  const gated = catalog.tools.filter((t) => t.authority === 'requires_approval');
  const rows: Row[] = [];
  let y = TOP;
  for (const t of readOnly)
    rows.push({ key: t.name, label: t.name, band: 'read_only', y: (y += ROW) - ROW, description: t.description });
  y += BAND_GAP;
  for (const t of gated)
    rows.push({
      key: t.name,
      label: t.name,
      band: 'requires_approval',
      y: (y += ROW) - ROW,
      description: t.description,
    });
  y += BAND_GAP;
  for (const c of catalog.refused)
    rows.push({ key: c.key, label: c.name, band: 'refused', y: (y += ROW) - ROW, description: c.detail });
  const H = y + 24;
  const midY = H / 2;

  const stepFor = (name: string) => run?.steps.find((s) => s.tool === name) ?? null;
  const active = hovered ? (rows.find((r) => r.key === hovered) ?? null) : null;
  const bandTop = (band: Band) => rows.find((r) => r.band === band)?.y ?? 0;
  const litCount = run ? run.steps.length : 0;
  const summary = `The assistant's authority boundary: ${readOnly.length} read-only tools cross it, ${gated.length} crosses only through a person, ${catalog.refused.length} things it will never do are severed at it.${run ? ` This run reached for ${litCount} tool${litCount === 1 ? '' : 's'}${run.refused ? ' and was refused once' : ''}.` : ''}`;

  return (
    <figure className={cn('rounded-md border bg-background', className)} data-testid="membrane">
      <svg viewBox={`0 0 ${W} ${H}`} className="hidden h-auto w-full md:block" role="group" aria-label={summary}>
        {/* The boundary, drawn first so every strand sits on top of it: a line you can see through is a boundary; one drawn over the strands would read as a wall. */}
        <line x1={MEMBRANE_X} y1={22} x2={MEMBRANE_X} y2={H - 16} className="stroke-border" strokeWidth={2} />
        <text
          x={MEMBRANE_X}
          y={14}
          textAnchor="middle"
          className="fill-muted-foreground text-[10px] font-semibold uppercase"
          style={{ letterSpacing: '0.18em' }}
        >
          the boundary
        </text>

        {rows.map((row) => {
          const step = stepFor(row.key);
          const ran = step !== null;
          const dim = hovered !== null && hovered !== row.key;
          if (row.band === 'refused') {
            const refusedNow = run?.refused === row.key;
            const stroke = refusedNow ? 'stroke-warn' : 'stroke-border';
            const width = refusedNow ? 2.4 : 1.2;
            return (
              <g key={row.key} opacity={dim ? 0.25 : 1} style={{ transition: 'opacity 160ms ease-out' }}>
                <path d={pathTo(row.y, MEMBRANE_X - 26, midY)} fill="none" className={stroke} strokeWidth={width} />
                {/* The break mark, in the "waits for a person" colour when it held this run: a boundary holding, not a system failing. Red would be a lie. */}
                <line
                  x1={MEMBRANE_X - 11}
                  y1={row.y - 8}
                  x2={MEMBRANE_X + 11}
                  y2={row.y + 8}
                  className={stroke}
                  strokeWidth={width}
                />
                <line
                  x1={MEMBRANE_X - 11}
                  y1={row.y + 8}
                  x2={MEMBRANE_X + 11}
                  y2={row.y - 8}
                  className={stroke}
                  strokeWidth={width}
                />
                <line
                  x1={MEMBRANE_X + 28}
                  y1={row.y}
                  x2={TOOL_X - 14}
                  y2={row.y}
                  className="stroke-border"
                  strokeWidth={1.2}
                  strokeDasharray="3 5"
                />
              </g>
            );
          }
          const isGate = row.band === 'requires_approval';
          const approved = isGate && run?.proposal === 'APPROVED';
          const proposed = isGate && run !== null && run.proposal !== 'NONE';
          const stroke = isGate ? (approved ? 'stroke-ok' : 'stroke-warn') : ran ? 'stroke-brand' : 'stroke-border';
          const dotFill = isGate ? (approved ? 'fill-ok' : 'fill-warn') : 'fill-brand';
          return (
            <g key={row.key} opacity={dim ? 0.25 : 1} style={{ transition: 'opacity 160ms ease-out' }}>
              <path
                d={pathTo(row.y, TOOL_X - 14, midY)}
                fill="none"
                className={stroke}
                strokeWidth={ran || proposed ? 2.4 : 1.2}
                strokeDasharray={isGate && !approved ? '6 5' : undefined}
                opacity={ran || proposed || isGate ? 1 : 0.55}
              />
              {/* In transit: a travelling dot only on the paths this run really used. Never ambient. */}
              {ran && !still ? (
                <circle r={3.5} className={dotFill}>
                  <animateMotion
                    dur="1.4s"
                    begin={`${(step.seq - 1) * 0.18}s`}
                    repeatCount="indefinite"
                    calcMode="spline"
                    keyPoints="0;1"
                    keyTimes="0;1"
                    keySplines="0.4 0 0.2 1"
                    path={pathTo(row.y, TOOL_X - 14, midY)}
                  />
                </circle>
              ) : null}
              {isGate ? (
                <>
                  <rect
                    x={MEMBRANE_X - 11}
                    y={row.y - 11}
                    width={22}
                    height={22}
                    rx={4}
                    className={cn(approved ? 'fill-ok stroke-ok' : 'fill-background stroke-warn')}
                    strokeWidth={2}
                  />
                  {/* A shackle, so the node reads as locked without a legend. */}
                  <path
                    d={`M ${MEMBRANE_X - 5} ${row.y - 2} v -4 a 5 5 0 0 1 10 0 v 4`}
                    fill="none"
                    className={approved ? 'stroke-background' : 'stroke-warn'}
                    strokeWidth={2}
                  />
                </>
              ) : null}
            </g>
          );
        })}

        {/* The core: the pipeline the model sits inside, not the model. */}
        <circle cx={AGENT_X} cy={midY} r={42} className="fill-muted stroke-border" strokeWidth={2} />
        <circle cx={AGENT_X} cy={midY} r={8} className="fill-brand" />
        <text
          x={AGENT_X}
          y={midY + 62}
          textAnchor="middle"
          className="fill-foreground text-[12px] font-bold uppercase"
          style={{ letterSpacing: '0.14em' }}
        >
          Ask
        </text>
        <text x={AGENT_X} y={midY + 80} textAnchor="middle" className="fill-muted-foreground text-[11px]">
          gate · tools · verifier
        </text>

        {(['read_only', 'requires_approval', 'refused'] as Band[]).map((band) => (
          <g key={band}>
            <text
              x={TOOL_X}
              y={bandTop(band) - 18}
              className={cn('text-[10px] font-bold uppercase', BAND_CLASS[band])}
              style={{ letterSpacing: '0.18em' }}
            >
              {BAND_LABEL[band]}
            </text>
            {rows
              .filter((r) => r.band === band)
              .map((row) => {
                const step = stepFor(row.key);
                const lit =
                  step !== null ||
                  run?.refused === row.key ||
                  (row.band === 'requires_approval' && run !== null && run.proposal !== 'NONE');
                const dim = hovered !== null && hovered !== row.key;
                return (
                  <g
                    key={row.key}
                    opacity={dim ? 0.3 : 1}
                    style={{ transition: 'opacity 160ms ease-out', cursor: 'pointer' }}
                    onMouseEnter={() => setHovered(row.key)}
                    onMouseLeave={() => setHovered(null)}
                    onFocus={() => setHovered(row.key)}
                    onBlur={() => setHovered(null)}
                    tabIndex={0}
                    role="button"
                    aria-label={`${row.label} — ${BAND_LABEL[row.band]}`}
                    data-testid={lit ? `membrane-step-${row.key}` : undefined}
                  >
                    <circle
                      cx={TOOL_X - 4}
                      cy={row.y}
                      r={4}
                      className={cn(
                        BAND_CLASS[band].replace('fill-', 'stroke-'),
                        lit ? BAND_CLASS[band] : 'fill-transparent',
                      )}
                      strokeWidth={1.6}
                    />
                    <text
                      x={TOOL_X + 12}
                      y={row.y + 4}
                      className={cn(
                        row.band === 'refused' ? 'text-[12px]' : 'font-mono text-[12.5px]',
                        lit ? 'fill-foreground' : 'fill-muted-foreground',
                      )}
                    >
                      {row.label}
                      {step?.durationMs !== undefined ? ` · ${step.durationMs} ms` : ''}
                    </text>
                  </g>
                );
              })}
          </g>
        ))}
      </svg>

      {/* A phone gets the same facts as three lists: the diagram's states, without the diagram. */}
      <div className="space-y-3 px-4 py-3 md:hidden" aria-label={summary}>
        {(['read_only', 'requires_approval', 'refused'] as Band[]).map((band) => (
          <div key={band}>
            <p
              className={cn(
                'eyebrow',
                band === 'read_only'
                  ? 'text-brand'
                  : band === 'requires_approval'
                    ? 'text-warn'
                    : 'text-muted-foreground',
              )}
            >
              {BAND_LABEL[band]}
            </p>
            <ol className="mt-1 space-y-0.5 text-[12px]">
              {rows
                .filter((r) => r.band === band)
                .map((row) => {
                  const step = stepFor(row.key);
                  const lit = step !== null || run?.refused === row.key;
                  return (
                    <li
                      key={row.key}
                      className={cn(lit ? 'text-foreground' : 'text-muted-foreground', band !== 'refused' && 'code')}
                    >
                      {row.label}
                      {step ? ` · ran` : run?.refused === row.key ? ' · the boundary held' : ''}
                    </li>
                  );
                })}
            </ol>
          </div>
        ))}
      </div>

      {/* The inspector rail: a diagram that shows structure but withholds the reason is half a diagram. Fixed height so nothing jumps. */}
      <div className="hidden min-h-[76px] border-t px-4 py-3 md:block">
        {active ? (
          <>
            <div className="flex flex-wrap items-baseline gap-x-3">
              <span
                className={cn(
                  active.band === 'refused' ? 'text-[13px] font-semibold' : 'code text-[13px] font-semibold',
                )}
              >
                {active.label}
              </span>
              <span
                className={cn(
                  'text-[10px] font-bold uppercase tracking-[0.18em]',
                  active.band === 'read_only'
                    ? 'text-brand'
                    : active.band === 'requires_approval'
                      ? 'text-warn'
                      : 'text-muted-foreground',
                )}
              >
                {BAND_LABEL[active.band]}
              </span>
            </div>
            <p className="mt-1 max-w-3xl text-[12px] leading-relaxed text-muted-foreground">{active.description}</p>
          </>
        ) : (
          <p className="text-[12px] text-muted-foreground">
            Hover or tab through a strand to read what it returns, or why it never runs. Solid: read. Dashed: waits for
            a person. Severed: the boundary holding, not a failure.
          </p>
        )}
      </div>
    </figure>
  );
}
