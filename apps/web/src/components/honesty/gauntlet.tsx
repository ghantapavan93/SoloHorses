import { CountUp } from '@/components/motion/count-up';
import { Stagger, StaggerItem } from '@/components/motion/reveal';
import { ago } from '@/lib/format';
import type { BuildHealth, GauntletLine } from '@/lib/types';
import { cn } from '@/lib/utils';

/**
 * How the build was tried to be broken, as instruments: one dial per gate, the number that
 * matters large, the way it was run small, and when. Every figure is read from the last verify
 * report and the last graded eval run; a gate that has not run on this code shows "not run",
 * never a green badge. The report names its commit, and the strip says when the running code
 * is newer than what was verified.
 */
interface Instrument {
  key: string;
  label: string;
  /** The large figure, or null when the gate has not run. */
  figure: string | null;
  /** A number the figure can count up to, when it is one. */
  count?: number;
  suffix?: string;
  caption: string;
  status: GauntletLine['status'];
  at?: string;
  /** 0–1 for the arc; only where a proportion means something. */
  ratio?: number;
}

const leadingNumber = (text: string | undefined): number | null => {
  const m = text?.match(/(\d[\d,]*(?:\.\d+)?)/);
  return m ? Number(m[1]!.replace(/,/g, '')) : null;
};

function fromLine(
  key: string,
  label: string,
  how: string,
  line: GauntletLine | undefined,
  opts: { percent?: boolean } = {},
): Instrument {
  if (!line || line.status === 'NOT RUN')
    return { key, label, figure: null, caption: `${how} · not run on this code`, status: 'NOT RUN' };
  // "13 / 13 properties · 5,200 generated cases" reads as 13 of 13; "91 operations · …" as 91; "75.8% · …" as a share.
  const pair = line.detail.match(/^(\d[\d,]*)\s*\/\s*(\d[\d,]*)\s*/);
  const n = leadingNumber(line.detail);
  const total = pair ? Number(pair[2]!.replace(/,/g, '')) : null;
  const ratio =
    opts.percent && n !== null ? n / 100 : pair && total ? Number(pair[1]!.replace(/,/g, '')) / total : undefined;
  return {
    key,
    label,
    figure: n === null ? line.detail : opts.percent ? `${n}%` : n.toLocaleString('en-US'),
    count: n !== null && !opts.percent && Number.isInteger(n) ? n : undefined,
    suffix: pair ? ` / ${total?.toLocaleString('en-US')}` : undefined,
    caption: (pair ? line.detail.slice(pair[0].length) : line.detail.replace(/^[\d,.]+%?\s*·?\s*/, '')) || how,
    status: line.status,
    at: line.at,
    ratio,
  };
}

export function Gauntlet({ health }: { health: BuildHealth | null }) {
  const verify = health?.verify ?? null;
  const suites = verify?.suites ?? {};
  const g = verify?.gauntlet ?? {};
  const unit = ['domain', 'db', 'web', 'api']
    .map((s) => suites[s])
    .filter((s): s is NonNullable<typeof s> => Boolean(s));
  const unitPassed = unit.reduce((n, s) => n + s.passed, 0);
  const unitTotal = unit.reduce((n, s) => n + s.total, 0);
  const e2e = suites['e2e'];
  const lastEval = health?.lastEval ?? null;

  const instruments: Instrument[] = [
    verify && unit.length > 0
      ? {
          key: 'tests',
          label: 'Unit and integration',
          figure: unitPassed.toLocaleString('en-US'),
          count: unitPassed,
          suffix: ` / ${unitTotal.toLocaleString('en-US')}`,
          caption: unit.map((s) => `${s.passed}`).join(' · ') + ' — domain · db · web · api',
          status: unit.every((s) => s.ok) ? 'PASS' : 'FAILED',
          at: verify.finishedAt,
          ratio: unitTotal ? unitPassed / unitTotal : undefined,
        }
      : {
          key: 'tests',
          label: 'Unit and integration',
          figure: null,
          caption: 'vitest and jest, every package · not run on this code',
          status: 'NOT RUN',
        },
    verify && e2e
      ? {
          key: 'journeys',
          label: 'Journeys',
          figure: String(e2e.passed),
          count: e2e.passed,
          suffix: ` / ${e2e.total}`,
          caption: 'Playwright: the story, the loop, every role, desktop and phone',
          status: e2e.ok ? 'PASS' : 'FAILED',
          at: verify.finishedAt,
          ratio: e2e.total ? e2e.passed / e2e.total : undefined,
        }
      : {
          key: 'journeys',
          label: 'Journeys',
          figure: null,
          caption: 'Playwright, desktop and phone · not run on this code',
          status: 'NOT RUN',
        },
    fromLine('mutation', 'Mutation', 'Stryker over the critical rules', g.mutation, { percent: true }),
    fromLine('properties', 'Properties', 'fast-check over the domain rules', g.properties),
    fromLine('fuzz', 'API fuzz', 'Schemathesis against the API schema', g.fuzz),
    fromLine('accessibility', 'Accessibility', 'axe, WCAG 2.1 AA', g.accessibility),
    lastEval?.adversarial
      ? {
          key: 'adversarial',
          label: 'Adversarial evals',
          figure: String(lastEval.adversarial.passed),
          count: lastEval.adversarial.passed,
          suffix: ` / ${lastEval.adversarial.total}`,
          caption: `red-team cases through the same gate · ${lastEval.model}`,
          status: lastEval.adversarial.passed === lastEval.adversarial.total ? 'PASS' : 'FAILED',
          at: lastEval.at,
          ratio: lastEval.adversarial.total ? lastEval.adversarial.passed / lastEval.adversarial.total : undefined,
        }
      : {
          key: 'adversarial',
          label: 'Adversarial evals',
          figure: null,
          caption: 'red-team cases through the same gate · no graded run here',
          status: 'NOT RUN',
        },
    fromLine('architecture', 'Architecture', 'dependency-cruiser, the context rules', g.architecture),
  ];

  const tone = (s: GauntletLine['status']) =>
    s === 'PASS' ? 'text-ok' : s === 'FAILED' ? 'text-critical' : 'text-muted-foreground';
  const stroke = (s: GauntletLine['status']) =>
    s === 'PASS' ? 'stroke-ok' : s === 'FAILED' ? 'stroke-critical' : 'stroke-muted-foreground';
  const newer = verify?.commit && health?.head && verify.commit !== health.head;

  return (
    <section aria-label="How we tried to break it">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="text-[14px] font-semibold">How we tried to break it</h2>
        <p className="text-[12px] text-muted-foreground">
          {verify
            ? `verify run ${ago(verify.finishedAt)}${verify.commit ? ` at ${verify.commit}` : ''}${verify.dirty ? ' · with uncommitted changes' : ''}`
            : 'no verify run recorded for this code'}
          {newer ? <span> · this build is {health.head}</span> : null}
        </p>
      </div>
      <Stagger className="mt-3 grid grid-cols-2 gap-3 md:grid-cols-4">
        {instruments.map((it) => (
          <StaggerItem key={it.key}>
            <div className="card-op h-full p-3" data-testid={`gauntlet-${it.key}`}>
              <div className="flex items-start justify-between gap-2">
                <p className="eyebrow">{it.label}</p>
                {it.ratio !== undefined ? <Arc ratio={it.ratio} className={stroke(it.status)} /> : null}
              </div>
              <p
                className={cn(
                  'mt-2 font-heading text-[30px] leading-none tracking-tight tabular-nums',
                  tone(it.status),
                )}
              >
                {it.figure === null ? (
                  <span className="text-[16px] font-normal text-muted-foreground">not run</span>
                ) : it.count !== undefined ? (
                  <>
                    <CountUp value={it.count} />
                    {it.suffix ? <span className="text-[14px] text-muted-foreground">{it.suffix}</span> : null}
                  </>
                ) : (
                  it.figure
                )}
              </p>
              <p className="mt-2 line-clamp-2 text-[11px] leading-snug text-muted-foreground">{it.caption}</p>
              <p className="mt-1 text-[10.5px] uppercase tracking-[0.12em] text-muted-foreground">
                {it.status === 'NOT RUN' ? 'not run' : `${it.status.toLowerCase()}${it.at ? ` · ${ago(it.at)}` : ''}`}
              </p>
            </div>
          </StaggerItem>
        ))}
      </Stagger>
      <p className="mt-3 text-[12px] leading-relaxed text-muted-foreground">
        One real discovery so far: two veterinary results of one kind on the same day gave a verdict that depended on
        the order the rows came back in — in one order the mare was cleared for a transfer. Found by the property suite,
        fixed (<span className="code">newestFirst</span>, A18), pinned by two example tests.
      </p>
    </section>
  );
}

/** A small arc: the share of the gate that passed. */
function Arc({ ratio, className }: { ratio: number; className: string }) {
  const r = 11;
  const c = 2 * Math.PI * r;
  const filled = Math.max(0, Math.min(1, ratio)) * c;
  return (
    <svg viewBox="0 0 28 28" className="size-7 shrink-0" aria-hidden>
      <circle cx={14} cy={14} r={r} className="stroke-border" strokeWidth={2.5} fill="none" />
      <circle
        cx={14}
        cy={14}
        r={r}
        className={className}
        strokeWidth={2.5}
        fill="none"
        strokeLinecap="round"
        strokeDasharray={`${filled} ${c - filled}`}
        transform="rotate(-90 14 14)"
      />
    </svg>
  );
}
