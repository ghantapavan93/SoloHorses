import type { TraceStep } from '@/lib/types';

/**
 * A trace on a time axis: the rows that share one correlation id, placed by when they happened
 * and how long they took, so the eye reads where the time went — the job that waited on a
 * breaker, the books call that took a second, the event published a beat after its commit.
 * Pure arithmetic over the trace's own timestamps; the SVG only draws what this returns.
 */
export const KIND_LABEL: Record<TraceStep['kind'], string> = {
  audit: 'audit',
  event: 'event',
  job: 'job',
  webhook: 'webhook',
  integration: 'books',
  exception: 'exception',
};

export interface AxisRow {
  kind: TraceStep['kind'];
  label: string;
  ref: string;
  /** Epoch ms. */
  start: number;
  /** Epoch ms, or null for an instant or a span still open. */
  end: number | null;
  /** A span whose end has not come: an open exception, a job still queued or running. */
  open: boolean;
  ok: boolean | null;
}

export interface TraceAxis {
  t0: number;
  t1: number;
  spanMs: number;
  rows: AxisRow[];
  ticks: { at: number; label: string }[];
}

/** A row whose end is unrecorded but whose status says it is still going. */
export function isOpen(step: Pick<TraceStep, 'kind' | 'label' | 'until'>): boolean {
  if (step.until !== null) return false;
  if (step.kind === 'exception') return /\b(open|acknowledged)\b/.test(step.label);
  if (step.kind === 'job') return /\b(queued|active|retrying)\b/.test(step.label);
  return false;
}

/** `+340 ms`, `+2.1 s`, `+3 min 12 s`, `+1 h 05 min`: an offset from the first row, in the unit a reader would pick. */
export function formatOffset(ms: number): string {
  const rounded = Math.max(0, Math.round(ms));
  if (rounded < 1_000) return `+${rounded} ms`;
  if (rounded < 60_000) return `+${(rounded / 1_000).toFixed(1)} s`;
  if (rounded < 3_600_000)
    return `+${Math.floor(rounded / 60_000)} min ${String(Math.round((rounded % 60_000) / 1_000)).padStart(2, '0')} s`;
  return `+${Math.floor(rounded / 3_600_000)} h ${String(Math.floor((rounded % 3_600_000) / 60_000)).padStart(2, '0')} min`;
}

/** Null when there is nothing to lay out: fewer than two rows, or timestamps that do not parse. */
export function axisFor(steps: TraceStep[]): TraceAxis | null {
  if (steps.length < 2) return null;
  const rows: AxisRow[] = [];
  for (const step of steps) {
    const start = Date.parse(step.at);
    if (Number.isNaN(start)) continue;
    const parsedEnd = step.until ? Date.parse(step.until) : NaN;
    const end = Number.isNaN(parsedEnd) ? null : Math.max(parsedEnd, start);
    rows.push({ kind: step.kind, label: step.label, ref: step.ref, start, end, open: isOpen(step), ok: step.ok });
  }
  if (rows.length < 2) return null;
  rows.sort((a, b) => a.start - b.start);
  const t0 = rows[0]?.start ?? 0;
  const t1 = Math.max(...rows.map((r) => r.end ?? r.start));
  // A trace whose rows share one instant still needs a scale to sit on; a second is a readable one.
  const spanMs = Math.max(t1 - t0, 1_000);
  const ticks = [0, 1 / 3, 2 / 3, 1].map((f) => ({ at: t0 + f * spanMs, label: formatOffset(f * spanMs) }));
  return { t0, t1: t0 + spanMs, spanMs, rows, ticks };
}
