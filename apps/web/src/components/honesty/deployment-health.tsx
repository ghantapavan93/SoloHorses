import { ago } from '@/lib/format';
import type { DependencyReadout } from '@/lib/types';
import { cn } from '@/lib/utils';

/**
 * What the deployment is leaning on, right now: one row per dependency, each from the service
 * that owns it, asked at the moment of the request. Collapsed by default — the page is a proof,
 * not a monitoring wall — and never green by hand: a row the API cannot vouch for says so.
 */
const TONE: Record<DependencyReadout['rows'][number]['state'], string> = {
  HEALTHY: 'text-ok',
  DEGRADED: 'text-warn',
  DOWN: 'text-critical',
  NONE: 'text-muted-foreground',
};

const DOT: Record<DependencyReadout['rows'][number]['state'], string> = {
  HEALTHY: 'bg-ok',
  DEGRADED: 'bg-warn',
  DOWN: 'bg-critical',
  NONE: 'border border-muted-foreground/60',
};

export function DeploymentHealth({
  readout,
  frontend,
}: {
  readout: DependencyReadout | null;
  /** The web's own row: which commit it runs and where; the API cannot know. */
  frontend: { note: string; state: 'HEALTHY' | 'NONE' };
}) {
  const rows = readout?.rows ?? [];
  const worst = rows.some((r) => r.state === 'DOWN')
    ? 'DOWN'
    : rows.some((r) => r.state === 'DEGRADED')
      ? 'DEGRADED'
      : 'HEALTHY';
  return (
    <details className="card-op group px-4 py-3" data-testid="deployment-health">
      <summary className="flex cursor-pointer list-none flex-wrap items-baseline justify-between gap-2 text-[13px] font-medium">
        <span className="flex items-center gap-2">
          <span className={cn('size-2 rounded-full', readout ? DOT[worst] : 'bg-critical')} aria-hidden />
          Deployment health
        </span>
        <span className="text-[11px] font-normal text-muted-foreground">
          {readout ? `${rows.length + 1} dependencies · asked ${ago(readout.at)}` : 'the API did not answer'}
        </span>
      </summary>
      <dl className="mt-3 grid grid-cols-[minmax(0,120px)_minmax(0,1fr)] gap-x-4 gap-y-1.5 text-[12px] md:grid-cols-[minmax(0,140px)_minmax(0,1fr)]">
        <dt className="readout text-muted-foreground">Frontend</dt>
        <dd className={cn('min-w-0 break-words', TONE[frontend.state])}>{frontend.note}</dd>
        {rows.map((r) => (
          <Row key={r.name} name={r.name} state={r.state} note={r.note} />
        ))}
        {!readout ? (
          <>
            <dt className="readout text-muted-foreground">API</dt>
            <dd className="text-critical">not answering from here</dd>
          </>
        ) : null}
      </dl>
    </details>
  );
}

function Row({ name, state, note }: DependencyReadout['rows'][number]) {
  return (
    <>
      <dt className="readout text-muted-foreground">{name}</dt>
      <dd className={cn('min-w-0 break-words', TONE[state])}>
        <span className="text-[10px] uppercase tracking-[0.12em]">
          {state === 'NONE' ? '' : `${state.toLowerCase()} · `}
        </span>
        <span className="text-foreground/90">{note}</span>
      </dd>
    </>
  );
}
