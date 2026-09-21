import { axisFor, formatOffset, KIND_LABEL, type AxisRow } from '@/lib/trace-axis';
import type { TraceStep } from '@/lib/types';
import { cn } from '@/lib/utils';

const WIDTH = 720;
const LABEL_WIDTH = 168;
const RIGHT_PAD = 10;
const TOP = 20;
const ROW_HEIGHT = 16;

/**
 * The trace, drawn on time: every row placed by when it happened and how long it took. A bar
 * is a span (a job from creation to finish, an event from commit to publish, a books call), a
 * dot an instant (an audit line), a dashed bar a span still open. Failures are the only red.
 * Pure SVG from the trace's own timestamps; the list below it stays the exact record.
 */
export function TraceTimeline({ steps }: { steps: TraceStep[] }) {
  const axis = axisFor(steps);
  if (!axis) return null;
  const plotWidth = WIDTH - LABEL_WIDTH - RIGHT_PAD;
  const x = (t: number) => LABEL_WIDTH + ((t - axis.t0) / axis.spanMs) * plotWidth;
  const height = TOP + axis.rows.length * ROW_HEIGHT + 6;
  const failures = axis.rows.filter((r) => r.ok === false).length;
  const summary = `${axis.rows.length} rows over ${formatOffset(axis.spanMs).slice(1)}${failures ? `, ${failures} failed` : ''}; first ${KIND_LABEL[axis.rows[0]!.kind]} ${axis.rows[0]!.label}, last ${KIND_LABEL[axis.rows[axis.rows.length - 1]!.kind]} ${axis.rows[axis.rows.length - 1]!.label}.`;

  return (
    <figure className="hidden md:block" data-testid="trace-timeline">
      <svg viewBox={`0 0 ${WIDTH} ${height}`} className="h-auto w-full" role="img" aria-label={summary}>
        {axis.ticks.map((tick, i) => (
          <g key={tick.at}>
            <line
              x1={x(tick.at)}
              x2={x(tick.at)}
              y1={TOP - 6}
              y2={height - 4}
              className="stroke-border"
              strokeDasharray="2 3"
            />
            <text
              x={x(tick.at)}
              y={10}
              textAnchor={i === 0 ? 'start' : i === axis.ticks.length - 1 ? 'end' : 'middle'}
              className="fill-muted-foreground text-[9px]"
            >
              {tick.label}
            </text>
          </g>
        ))}
        {axis.rows.map((row, i) => {
          const y = TOP + i * ROW_HEIGHT + ROW_HEIGHT / 2;
          const x1 = x(row.start);
          const x2 = row.end !== null ? Math.max(x(row.end), x1 + 2) : row.open ? x(axis.t1) : x1;
          const label = `${KIND_LABEL[row.kind]} · ${row.label}`;
          return (
            <g key={`${row.start}-${row.kind}-${row.ref}-${i}`}>
              <text
                x={LABEL_WIDTH - 8}
                y={y + 3}
                textAnchor="end"
                className={cn('text-[9.5px]', row.ok === false ? 'fill-critical' : 'fill-muted-foreground')}
              >
                {label.length > 30 ? `${label.slice(0, 29)}…` : label}
              </text>
              {row.end !== null || row.open ? (
                <rect
                  x={x1}
                  y={y - 4}
                  width={x2 - x1}
                  height={8}
                  rx={2}
                  className={tone(row)}
                  fillOpacity={row.open ? 0.35 : 0.85}
                  strokeDasharray={row.open ? '3 2' : undefined}
                  strokeWidth={row.open ? 1 : 0}
                />
              ) : (
                <circle cx={x1} cy={y} r={3} className={tone(row)} />
              )}
            </g>
          );
        })}
      </svg>
      <figcaption className="mt-1 text-[11px] text-muted-foreground">
        Time runs left to right from the first row: a bar is a span, a dot an instant, a dashed bar is still open.{' '}
        {formatOffset(axis.spanMs).slice(1)} end to end.
      </figcaption>
    </figure>
  );
}

/** Failures are the only red; the rest reads by kind, in the product's own states. */
function tone(row: AxisRow): string {
  if (row.ok === false) return 'fill-critical stroke-critical';
  switch (row.kind) {
    case 'event':
      return 'fill-brand stroke-brand';
    case 'exception':
      return row.open ? 'fill-warn stroke-warn' : 'fill-muted-foreground stroke-muted-foreground';
    case 'integration':
      return 'fill-ok stroke-ok';
    case 'job':
      return 'fill-muted-foreground stroke-muted-foreground';
    default:
      return 'fill-foreground stroke-foreground';
  }
}
