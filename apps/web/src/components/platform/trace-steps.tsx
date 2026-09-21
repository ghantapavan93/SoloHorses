import { TraceTimeline } from '@/components/platform/trace-timeline';
import { dateTime } from '@/lib/format';
import { KIND_LABEL } from '@/lib/trace-axis';
import type { TraceStep } from '@/lib/types';

/**
 * One correlation id, every row that shares it, in time order: the click, the inbox row, the
 * jobs, the domain events, the accounting attempts, the exception. Drawn on a time axis first,
 * then listed exactly. The same view in the drawer and on its own page, so a link to a trace
 * lands on the trace.
 */
export function TraceSteps({ steps }: { steps: TraceStep[] }) {
  if (steps.length === 0)
    return <p className="text-[12px] text-muted-foreground">Nothing recorded under this id yet.</p>;
  return (
    <div className="space-y-3">
      <TraceTimeline steps={steps} />
      <ol className="space-y-1.5 text-[12px]">
        {steps.map((s, i) => (
          <li
            key={`${s.at}-${s.kind}-${s.ref}-${i}`}
            className="grid grid-cols-[84px_64px_1fr] gap-x-2 border-b border-dashed pb-1.5 last:border-0"
          >
            <span className="tabular-nums text-muted-foreground">{dateTime(s.at).split(', ').pop()}</span>
            <span className="uppercase tracking-wider text-muted-foreground">{KIND_LABEL[s.kind]}</span>
            <span>
              <span className="font-medium">{s.label}</span> <span className="code text-muted-foreground">{s.ref}</span>
              {s.detail && typeof s.detail === 'object' && Object.keys(s.detail as object).length > 0 ? (
                <span className="mt-0.5 block break-all font-mono text-[11px] text-muted-foreground">
                  {JSON.stringify(s.detail).slice(0, 220)}
                </span>
              ) : null}
            </span>
          </li>
        ))}
      </ol>
    </div>
  );
}
