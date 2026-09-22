'use client';

import { useRef } from 'react';
import { motion, useInView } from 'motion/react';
import { ago } from '@/lib/format';
import type { AskStatus, BuildHealth, Health, LabStatus } from '@/lib/types';
import { cn } from '@/lib/utils';

/**
 * The estate, drawn from its own state: the systems that own the writes on the left, the
 * layer that reads them in the middle, the assistant and the person on the right. Every dot
 * and every small figure comes from the running API — which integration is live and which a
 * labelled simulator, the last event that left the outbox, how many jobs the ledger holds and
 * how many died, the last trace, who answers Ask. Nothing in the picture is asserted by hand;
 * where the API is not running, the picture says so instead of drawing a healthy estate.
 */
const W = 1010;
const H = 540;

type Mode = 'live' | 'simulated' | 'projection' | 'off';

interface Box {
  id: string;
  x: number;
  y: number;
  w: number;
  h: number;
  label: string;
  note: string;
  /** A second line, where the box is tall enough to carry one. */
  note2?: string;
  mode?: Mode;
}

/** "52 minutes ago" is too long for a small box; "52 min ago" says the same. */
const brief = (text: string) =>
  text
    .replace(/ seconds?/, ' s')
    .replace(/ minutes?/, ' min')
    .replace(/ hours?/, ' h')
    .replace(/ days?/, ' d')
    .replace(/ months?/, ' mo');

interface Edge {
  from: string;
  to: string;
  /** Where the line leaves and lands: the box's right/left middles by default. */
  dashed?: boolean;
}

const MODE_DOT: Record<Mode, string> = {
  live: 'fill-ok',
  simulated: 'fill-warn',
  projection: 'fill-copper-2',
  off: 'fill-muted-foreground',
};

function anchorRight(b: Box) {
  return { x: b.x + b.w, y: b.y + b.h / 2 };
}
function anchorLeft(b: Box) {
  return { x: b.x, y: b.y + b.h / 2 };
}
/** A gentle S from one box's right edge to the next box's left edge. */
function link(a: Box, b: Box): string {
  const p = anchorRight(a);
  const q = anchorLeft(b);
  const dx = Math.max(40, (q.x - p.x) / 2);
  return `M${p.x} ${p.y} C${p.x + dx} ${p.y}, ${q.x - dx} ${q.y}, ${q.x} ${q.y}`;
}

export function EstateMap({
  health,
  build,
  lab,
  ask,
}: {
  health: Health | null;
  build: BuildHealth | null;
  lab: LabStatus | null;
  ask: AskStatus | null;
}) {
  const ref = useRef<HTMLDivElement | null>(null);
  const inView = useInView(ref, { once: true, margin: '-10% 0px' });
  const up = Boolean(health?.ok);
  const modes = health?.integrations;
  const mode = (key: keyof NonNullable<Health['integrations']>): Mode =>
    !up ? 'off' : modes?.[key] === 'live' ? 'live' : 'simulated';
  const jobs = lab?.jobs;
  const dead = jobs?.byStatus?.['DEAD'] ?? 0;
  const retrying = jobs?.byStatus?.['RETRYING'] ?? 0;
  const done = jobs?.byStatus?.['COMPLETED'] ?? 0;
  const answerer = !up
    ? 'not reachable'
    : ask?.provider === 'offline' || !ask?.provider
      ? 'deterministic offline answerer'
      : `${ask.model} · ${ask.provider}`;

  const boxes: Box[] = [
    // The systems the operation already has. Daysheet never writes to them; it reads projections.
    {
      id: 'equine',
      x: 30,
      y: 60,
      w: 230,
      h: 44,
      label: 'Equine records',
      note: 'synthetic projection',
      mode: up ? 'projection' : 'off',
    },
    {
      id: 'vet',
      x: 30,
      y: 124,
      w: 230,
      h: 44,
      label: 'Veterinary',
      note: 'checks, milestones, clearances',
      mode: up ? 'projection' : 'off',
    },
    {
      id: 'stripe',
      x: 30,
      y: 188,
      w: 230,
      h: 44,
      label: 'Billing · Stripe',
      note: modes?.stripe === 'live' ? 'test mode' : 'simulated, labelled',
      mode: mode('stripe'),
    },
    {
      id: 'qbo',
      x: 30,
      y: 252,
      w: 230,
      h: 44,
      label: 'QuickBooks',
      note: modes?.qbo === 'live' ? 'sandbox' : 'simulated, labelled',
      mode: mode('qbo'),
    },
    {
      id: 'sale',
      x: 30,
      y: 316,
      w: 230,
      h: 44,
      label: 'Sale platform',
      note: 'vendor boundary · synthetic',
      mode: up ? 'projection' : 'off',
    },
    {
      id: 'text',
      x: 30,
      y: 380,
      w: 230,
      h: 44,
      label: 'Text intake',
      note: modes?.twilio === 'live' ? 'Twilio' : 'simulated, labelled',
      mode: mode('twilio'),
    },
    // Daysheet: what it does with what it reads.
    {
      id: 'proj',
      x: 330,
      y: 60,
      w: 310,
      h: 52,
      label: 'Projections',
      note: 'read-only · cached · invalidated by events',
    },
    {
      id: 'rules',
      x: 330,
      y: 150,
      w: 310,
      h: 52,
      label: 'Rules in code · detectors · exceptions',
      note: 'deterministic, deduplicated, self-resolving',
    },
    {
      id: 'outbox',
      x: 330,
      y: 250,
      w: 145,
      h: 44,
      label: 'Outbox',
      note: build?.lastEvent ? `${build.lastEvent.type} · ${brief(ago(build.lastEvent.at))}` : 'no event yet',
    },
    { id: 'consumers', x: 495, y: 250, w: 145, h: 44, label: 'Consumers', note: 'idempotent · re-read state' },
    {
      id: 'ledger',
      x: 330,
      y: 320,
      w: 145,
      h: 44,
      label: 'Job ledger',
      note: jobs ? `${done} done · ${retrying} retrying` : 'not reachable',
    },
    {
      id: 'dead',
      x: 495,
      y: 320,
      w: 145,
      h: 44,
      label: 'Dead letters',
      note: jobs ? `${dead} · become exceptions` : 'not reachable',
    },
    {
      id: 'audit',
      x: 330,
      y: 400,
      w: 310,
      h: 44,
      label: 'Audit · append-only',
      note: build?.lastTrace?.correlationId
        ? `last trace ${build.lastTrace.correlationId.slice(0, 18)}…`
        : 'same transaction as the write',
    },
    // The assistant, and the person.
    {
      id: 'ask',
      x: 720,
      y: 90,
      w: 270,
      h: 60,
      label: 'Ask',
      note: 'policy gate → typed tools → verifier',
      note2: answerer,
    },
    { id: 'proposal', x: 720, y: 210, w: 270, h: 44, label: 'Proposal', note: 'a row, not a mutation' },
    { id: 'person', x: 720, y: 300, w: 270, h: 44, label: 'A person approves', note: 'under their own name' },
    {
      id: 'service',
      x: 720,
      y: 390,
      w: 270,
      h: 44,
      label: 'The same service the UI calls',
      note: 'rule-checked, audited',
    },
  ];
  const byId = Object.fromEntries(boxes.map((b) => [b.id, b])) as Record<string, Box>;
  const edges: Edge[] = [
    { from: 'equine', to: 'proj' },
    { from: 'vet', to: 'proj' },
    { from: 'stripe', to: 'proj', dashed: mode('stripe') !== 'live' },
    { from: 'qbo', to: 'proj', dashed: mode('qbo') !== 'live' },
    { from: 'sale', to: 'proj' },
    { from: 'text', to: 'proj', dashed: mode('twilio') !== 'live' },
    { from: 'outbox', to: 'consumers' },
    { from: 'proj', to: 'ask' },
  ];
  // Vertical links inside a column: drawn straight, top to bottom.
  const down = (a: string, b: string) => {
    const p = byId[a]!;
    const q = byId[b]!;
    return `M${p.x + p.w / 2} ${p.y + p.h} L${q.x + q.w / 2} ${q.y}`;
  };
  const verticals = [
    down('proj', 'rules'),
    down('rules', 'outbox'),
    down('consumers', 'dead'),
    down('outbox', 'ledger'),
    down('ask', 'proposal'),
    down('proposal', 'person'),
    down('person', 'service'),
  ];
  const consumersToAudit = `M${byId['consumers']!.x + byId['consumers']!.w / 2} ${byId['consumers']!.y + byId['consumers']!.h} L${byId['consumers']!.x + byId['consumers']!.w / 2} ${byId['audit']!.y}`;
  // The person's decision goes back into the same rules and the same audit: the loop closes on the left.
  const serviceBack = `M${byId['service']!.x} ${byId['service']!.y + 22} C${byId['service']!.x - 80} ${byId['service']!.y + 22}, ${byId['audit']!.x + byId['audit']!.w + 60} ${byId['audit']!.y + 22}, ${byId['audit']!.x + byId['audit']!.w} ${byId['audit']!.y + 22}`;

  const draw = (delay: number) => ({
    initial: { pathLength: 0, opacity: 0 },
    animate: inView ? { pathLength: 1, opacity: 1 } : { pathLength: 0, opacity: 0 },
    transition: { duration: 0.9, delay, ease: [0.22, 1, 0.36, 1] as const },
  });

  return (
    <div ref={ref} data-testid="estate-map">
      <svg
        viewBox={`0 0 ${W} ${H}`}
        className="hidden h-auto w-full md:block"
        role="img"
        aria-label="The estate: the systems that own the writes, the layer that reads them, the assistant and the person"
      >
        <defs>
          <marker
            id="estate-arrow"
            viewBox="0 0 8 8"
            refX="7"
            refY="4"
            markerWidth="6"
            markerHeight="6"
            orient="auto-start-reverse"
          >
            <path d="M0 0 L8 4 L0 8 z" className="fill-copper-2" />
          </marker>
        </defs>
        {/* Column captions */}
        {[
          { x: 30, text: 'Systems that own the writes' },
          { x: 330, text: 'Daysheet reads them' },
          { x: 720, text: 'The assistant, and the person' },
        ].map((c) => (
          <text key={c.text} x={c.x} y={36} className="fill-muted-foreground text-[11px] uppercase tracking-[0.16em]">
            {c.text}
          </text>
        ))}
        {/* Edges, drawn as they come into view */}
        {edges.map((e, i) => (
          <motion.path
            key={`${e.from}-${e.to}`}
            d={link(byId[e.from]!, byId[e.to]!)}
            fill="none"
            className={cn('stroke-copper-2', e.dashed && 'opacity-60')}
            strokeWidth={1.2}
            strokeDasharray={e.dashed ? '4 4' : undefined}
            markerEnd="url(#estate-arrow)"
            {...draw(0.15 + i * 0.06)}
          />
        ))}
        {[...verticals, consumersToAudit].map((d, i) => (
          <motion.path
            key={d}
            d={d}
            fill="none"
            className="stroke-copper-2"
            strokeWidth={1.2}
            markerEnd="url(#estate-arrow)"
            {...draw(0.5 + i * 0.05)}
          />
        ))}
        <motion.path
          d={serviceBack}
          fill="none"
          className="stroke-copper-2 opacity-70"
          strokeWidth={1.2}
          strokeDasharray="2 5"
          markerEnd="url(#estate-arrow)"
          {...draw(1)}
        />
        {/* Boxes */}
        {boxes.map((b, i) => (
          <motion.g
            key={b.id}
            initial={{ opacity: 0, y: 8 }}
            animate={inView ? { opacity: 1, y: 0 } : { opacity: 0, y: 8 }}
            transition={{ duration: 0.5, delay: 0.05 + i * 0.04, ease: [0.22, 1, 0.36, 1] }}
          >
            <rect x={b.x} y={b.y} width={b.w} height={b.h} rx={6} className="fill-card stroke-border" strokeWidth={1} />
            {b.mode ? <circle cx={b.x + 14} cy={b.y + b.h / 2} r={3.5} className={MODE_DOT[b.mode]} /> : null}
            <text
              x={b.x + (b.mode ? 26 : 12)}
              y={b.y + (b.note ? 19 : b.h / 2 + 4)}
              className="fill-foreground text-[15px] font-medium"
            >
              {b.label}
            </text>
            {b.note ? (
              <text x={b.x + (b.mode ? 26 : 12)} y={b.y + 35} className="fill-muted-foreground text-[11.5px]">
                {b.note.length > 42 ? `${b.note.slice(0, 41)}…` : b.note}
              </text>
            ) : null}
            {b.note2 ? (
              <text x={b.x + 12} y={b.y + 50} className="fill-muted-foreground text-[11.5px]">
                {b.note2.length > 42 ? `${b.note2.slice(0, 41)}…` : b.note2}
              </text>
            ) : null}
          </motion.g>
        ))}
        {/* Legend */}
        {(
          [
            ['live', 'live (test mode / sandbox)'],
            ['simulated', 'simulated, labelled on every screen'],
            ['projection', 'synthetic projection'],
          ] as [Mode, string][]
        ).map(([m, text], i) => (
          <g key={m} transform={`translate(${30 + i * 300}, ${H - 26})`}>
            <circle cx={4} cy={-3} r={3.5} className={MODE_DOT[m]} />
            <text x={14} className="fill-muted-foreground text-[11.5px]">
              {text}
            </text>
          </g>
        ))}
        {!up ? (
          <text x={W / 2} y={H / 2} textAnchor="middle" className="fill-warn text-[13px]">
            The API is not reachable from this page; the estate cannot be read, so it is not drawn as healthy.
          </text>
        ) : null}
      </svg>
      {/* A phone reads the same estate as a list. */}
      <ol className="space-y-1 text-[12px] md:hidden" aria-label="The estate as a list">
        {boxes.map((b) => (
          <li key={b.id} className="flex items-baseline gap-2">
            {b.mode ? (
              <span
                className={cn('mt-1 size-2 shrink-0 rounded-full', MODE_DOT[b.mode].replace('fill-', 'bg-'))}
                aria-hidden
              />
            ) : (
              <span className="mt-1 size-2 shrink-0 rounded-full bg-border" aria-hidden />
            )}
            <span className="font-medium">{b.label}</span>
            <span className="text-muted-foreground">
              · {b.note}
              {b.note2 ? ` · ${b.note2}` : ''}
            </span>
          </li>
        ))}
      </ol>
    </div>
  );
}
