import Link from 'next/link';
import { hrefFor } from '@/lib/format';
import type { SignalMap } from '@/lib/types';
import { cn } from '@/lib/utils';

/**
 * Why this one, drawn: the record and the records it cites on the left, the facts as the tables
 * hold them, the rule that read them, the block — the thing missing or held, the only node in
 * the "waits for a person" colour — and the person who decides on the right. Positions come
 * from the API, so the page draws it at once and a phone reads the same nodes as a list in the
 * same order. Records are links. The one moving thing is a dot on the edge into the block,
 * and only for people who have not asked for stillness.
 */
export function CausalMap({ map, className }: { map: SignalMap; className?: string }) {
  const byId = new Map(map.nodes.map((n) => [n.id, n]));
  const ranked = [...map.nodes].sort((a, b) => a.x - b.x || a.y - b.y);
  const into = map.edges.find((e) => e.to === map.blockId);
  const path = (fromId: string, toId: string): string | null => {
    const a = byId.get(fromId);
    const b = byId.get(toId);
    if (!a || !b) return null;
    const x1 = a.x + a.w;
    const y1 = a.y + a.h / 2;
    const x2 = b.x;
    const y2 = b.y + b.h / 2;
    const mid = (x1 + x2) / 2;
    return `M ${x1} ${y1} C ${mid} ${y1}, ${mid} ${y2}, ${x2} ${y2}`;
  };
  const tone = (kind: SignalMap['nodes'][number]['kind']) =>
    kind === 'gap'
      ? 'stroke-warn'
      : kind === 'decision'
        ? 'stroke-warn'
        : kind === 'record'
          ? 'stroke-brand'
          : kind === 'rule'
            ? 'stroke-foreground'
            : 'stroke-border';
  const summary = `Why this signal: ${ranked.map((n) => `${n.sublabel ? `${n.sublabel}: ` : ''}${n.label}`).join(' → ')}.`;

  return (
    <figure className={cn('rounded-md border', className)} data-testid="causal-map">
      <svg
        viewBox={`0 0 ${map.width} ${map.height}`}
        className="hidden h-auto w-full md:block"
        role="group"
        aria-label={summary}
      >
        {map.edges.map((edge) => {
          const d = path(edge.from, edge.to);
          if (!d) return null;
          const toBlock = edge.to === map.blockId;
          return (
            <path
              key={edge.id}
              d={d}
              fill="none"
              className={toBlock ? 'stroke-warn' : 'stroke-border'}
              strokeWidth={toBlock ? 2 : 1.2}
            />
          );
        })}
        {into ? (
          <circle r={3.5} className="hidden fill-warn motion-safe:block">
            <animateMotion
              dur="1.6s"
              repeatCount="indefinite"
              calcMode="spline"
              keyPoints="0;1"
              keyTimes="0;1"
              keySplines="0.4 0 0.2 1"
              path={path(into.from, into.to) ?? ''}
            />
          </circle>
        ) : null}
        {map.nodes.map((node) => {
          const href = node.recordId ? hrefFor(node.recordId) : null;
          const isBlock = node.id === map.blockId;
          const body = (
            <g data-testid={isBlock ? 'map-block' : undefined}>
              <rect
                x={node.x}
                y={node.y}
                width={node.w}
                height={node.h}
                rx={6}
                className={cn('fill-background', tone(node.kind))}
                strokeWidth={isBlock ? 2.2 : 1.4}
                fillOpacity={isBlock ? 0.96 : 1}
              />
              {isBlock ? (
                <rect
                  x={node.x}
                  y={node.y}
                  width={node.w}
                  height={node.h}
                  rx={6}
                  className="fill-warn"
                  fillOpacity={0.08}
                />
              ) : null}
              <text
                x={node.x + 12}
                y={node.y + 19}
                className={cn(
                  'text-[12px]',
                  node.kind === 'fact' || node.kind === 'record' || node.kind === 'rule' ? 'font-mono' : 'font-medium',
                  isBlock ? 'fill-foreground' : 'fill-foreground',
                )}
              >
                {node.label.length > 26 ? `${node.label.slice(0, 25)}…` : node.label}
              </text>
              {node.sublabel ? (
                <text
                  x={node.x + 12}
                  y={node.y + 35}
                  className="fill-muted-foreground text-[10px] uppercase"
                  style={{ letterSpacing: '0.12em' }}
                >
                  {node.sublabel.length > 30 ? `${node.sublabel.slice(0, 29)}…` : node.sublabel}
                </text>
              ) : null}
            </g>
          );
          return href ? (
            <Link key={node.id} href={href} aria-label={`${node.label} · record page`}>
              {body}
            </Link>
          ) : (
            <g key={node.id}>{body}</g>
          );
        })}
      </svg>
      <ol className="space-y-1 px-3 py-2 text-[12px] md:hidden" aria-label={summary}>
        {ranked.map((node) => {
          const href = node.recordId ? hrefFor(node.recordId) : null;
          const isBlock = node.id === map.blockId;
          return (
            <li
              key={node.id}
              className={cn('flex flex-wrap items-baseline gap-x-2', isBlock && 'font-medium text-warn')}
              aria-current={isBlock ? 'step' : undefined}
            >
              <span className="readout w-[92px] shrink-0 text-muted-foreground">
                {node.kind === 'gap'
                  ? 'the block'
                  : node.kind === 'decision'
                    ? 'who decides'
                    : (node.sublabel ?? node.kind)}
              </span>
              {href ? (
                <Link href={href} className="code underline-offset-2 hover:underline">
                  {node.label}
                </Link>
              ) : (
                <span className={node.kind === 'fact' || node.kind === 'rule' ? 'code' : ''}>{node.label}</span>
              )}
            </li>
          );
        })}
      </ol>
    </figure>
  );
}
