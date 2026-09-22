'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import {
  Activity,
  ArrowRight,
  Blocks,
  BookOpenCheck,
  BookmarkCheck,
  FileScan,
  Ghost,
  Languages,
  ListChecks,
  Mic,
  MoonStar,
  Plug,
  Route,
  Scan,
  ScanSearch,
  ShieldCheck,
  Split,
  UserCheck,
  Zap,
  type LucideIcon,
} from 'lucide-react';
import { AgentMembrane } from '@/components/ask/agent-membrane';
import { AskPanel } from '@/components/ask/ask-panel';
import { Reveal, Stagger, StaggerItem } from '@/components/motion/reveal';
import { TraceDrawer } from '@/components/platform/trace-drawer';
import { AutonomyLadder } from '@/components/vision/autonomy-ladder';
import { ago } from '@/lib/format';
import { foldEvent, runFromLast, type MembraneRun } from '@/lib/membrane';
import type {
  AskAuthority,
  AskLastRun,
  AskStatus,
  BuildHealth,
  DigestPreview,
  SettlementScene,
  Story,
} from '@/lib/types';
import { cn } from '@/lib/utils';

/**
 * The continuum: what runs in this build, what has to be measured with the operation before
 * the next rung is allowed, and what lies past that. Three labels used honestly — built is
 * tested here; validation is a question only real weeks can answer; horizon is written down.
 */
const CONTINUUM: {
  key: string;
  label: string;
  tone: 'built' | 'validation' | 'horizon';
  lead: string;
  items: { key: string; icon: LucideIcon; title: string; line: string; href?: string }[];
}[] = [
  {
    key: 'built',
    label: 'Built now',
    tone: 'built',
    lead: 'Runs in this build, on synthetic records, with tests.',
    items: [
      {
        key: 'ask-view-act',
        icon: Route,
        title: 'Ask → View → Act',
        line: 'A question answered from typed tools; the workspace opens where the problem is; one act prepared, never taken.',
        href: '/today',
      },
      {
        key: 'xray',
        icon: Scan,
        title: 'The x-ray',
        line: 'Every record about one mare, the rules that read them, the causal path lit, the person it waits for.',
        href: '/story#why',
      },
      {
        key: 'approval',
        icon: UserCheck,
        title: 'Human approval',
        line: 'A proposal as a diff — before, after, what it will never do — executed by the same rule-checked service the screen calls, refused if the records moved.',
        href: '/decisions',
      },
      {
        key: 'ledger',
        icon: BookOpenCheck,
        title: 'The decision ledger',
        line: 'Prepared, decided, executed, and the outcome — awaited until the signal closes; a name on every judgment.',
        href: '/decisions',
      },
      {
        key: 'recorder',
        icon: Activity,
        title: 'The flight recorder',
        line: 'Every run on one axis: the gate, the tools, the model, the verifier, what came back — never a thought, only what ran.',
        href: '/runs',
      },
      {
        key: 'gate',
        icon: ShieldCheck,
        title: 'A gate before the model, a verifier after',
        line: 'Refusals decided in code; every claim checked against the ids the tools returned; evals grade the boundary each run.',
        href: '/build',
      },
    ],
  },
  {
    key: 'validation',
    label: 'Next validation',
    tone: 'validation',
    lead: 'Hypotheses. Each is a question only weeks beside the people who run the estate can answer.',
    items: [
      {
        key: 'shadow',
        icon: Ghost,
        title: 'Shadow mode',
        line: 'What the team decided against what Ask would have prepared, per decision kind, measured over real weeks — not asserted.',
      },
      {
        key: 'voice',
        icon: Mic,
        title: 'Ranch voice capture',
        line: 'A voice note from the barn becomes a typed intake row a person confirms — the same inbox, the same rules.',
      },
      {
        key: 'paperwork',
        icon: FileScan,
        title: 'Multimodal paperwork',
        line: 'A photographed form or a scanned registration read into typed fields, cited to the image, confirmed by a person.',
      },
      {
        key: 'memory',
        icon: BookmarkCheck,
        title: 'Scoped preference memory',
        line: 'Stated preferences shape how answers are presented — per person, per role — never what a rule decides.',
      },
      {
        key: 'words',
        icon: Languages,
        title: 'The words the barn uses',
        line: 'Flush, OPU, the 14-day check, Coggins, settlement by Monday: where a term is used the way the barn does not, the product is wrong first.',
      },
    ],
  },
  {
    key: 'horizon',
    label: 'Horizon',
    tone: 'horizon',
    lead: 'Written down. None of it is built, and nothing here has a date.',
    items: [
      {
        key: 'skills',
        icon: Blocks,
        title: 'Ask skills across the applications',
        line: 'The same typed tools over the operation’s own platform, books and portal, behind the same policy layer, once the boundaries are agreed.',
      },
      {
        key: 'coordination',
        icon: ListChecks,
        title: 'Approved coordination',
        line: 'A prepared sequence — request, reschedule, notify — approved once as a whole, executed step by step, each step a row.',
      },
      {
        key: 'routing',
        icon: Split,
        title: 'Model routing',
        line: 'A local model for the routine, a larger one for the hard question, chosen per question by the eval scores.',
      },
      {
        key: 'interop',
        icon: Plug,
        title: 'Open tool interoperability',
        line: 'The typed tools exposed over an open protocol, so another assistant reads the estate through the same gate.',
      },
      {
        key: 'overnight',
        icon: MoonStar,
        title: 'A proactive overnight operator',
        line: 'The brief written at 5 a.m. from the snapshot, with the night’s changes and the day’s blocked items, waiting on the board.',
      },
      {
        key: 'execute',
        icon: Zap,
        title: 'Execute, one narrow kind',
        line: 'A step taken without waiting — only a kind whose shadow agreement and eval scores cross a threshold the operation sets; never a clinical result, money, or a customer message.',
      },
    ],
  },
];

/** What a built tile can say from the live page: one figure, from the same data the page already has. */
function figureFor(
  key: string,
  ctx: {
    story: Story | null;
    lastRun: AskLastRun | null;
    decisions: { total: number; approved: number; stale: number };
  },
): string | null {
  const { story, lastRun, decisions } = ctx;
  switch (key) {
    case 'ask-view-act':
      return lastRun
        ? `${lastRun.steps.length} tool${lastRun.steps.length === 1 ? '' : 's'} · last run ${ago(lastRun.at)}`
        : null;
    case 'xray':
      return story ? `${story.rows.length} rows about ${story.recip.id}` : null;
    case 'approval':
      return decisions.total > 0 ? `${decisions.approved} of ${decisions.total} approved by a person` : null;
    case 'ledger':
      return decisions.total > 0
        ? `${decisions.total} decision${decisions.total === 1 ? '' : 's'} · ${decisions.stale} stale`
        : null;
    case 'recorder':
      return lastRun
        ? `${lastRun.model ?? 'offline'}${lastRun.latencyMs !== null ? ` · ${lastRun.latencyMs} ms` : ''}`
        : null;
    case 'gate':
      return lastRun ? (lastRun.refused ? `last run refused · ${lastRun.refused}` : 'last run passed the gate') : null;
    default:
      return null;
  }
}

const TONE: Record<'built' | 'validation' | 'horizon', { dot: string; label: string; badge: string }> = {
  built: { dot: 'bg-ok', label: 'text-ok', badge: 'built' },
  validation: { dot: 'bg-warn', label: 'text-warn', badge: 'hypothesis' },
  horizon: { dot: 'border border-muted-foreground/60', label: 'text-muted-foreground', badge: 'future' },
};

/**
 * The vision page: the ladder the assistant climbs, the continuum from what runs to what is
 * only written down, then three ideas each an extension of what already runs — the running
 * part live, the missing part named in one line. No roadmap.
 */
export function VisionView({
  story,
  sale,
  digest,
  lastTrace,
  askStatus,
  authority,
  lastRun,
  signedIn,
  decisions,
}: {
  story: Story | null;
  sale: SettlementScene | null;
  digest: DigestPreview | null;
  lastTrace: BuildHealth['lastTrace'];
  askStatus: AskStatus | null;
  authority: AskAuthority | null;
  lastRun: AskLastRun | null;
  signedIn: boolean;
  decisions: { total: number; approved: number; stale: number };
}) {
  const router = useRouter();
  const [trace, setTrace] = useState<string | null>(null);
  // The boundary diagram starts on the last real run and then plays the question asked here, event by event.
  const [run, setRun] = useState<MembraneRun | null>(() => runFromLast(lastRun));
  const returned = sale?.returns[0] ?? null;
  const suggestions = [
    ...(returned ? [`Tell me about ${returned.recip.id}`] : []),
    ...(sale?.payment ? [`What happened with ${sale.payment.id}?`] : []),
    ...(story ? [`What could derail ${story.recip.id}'s cycle right now?`] : []),
    'Is the QuickBooks sync working?',
  ];
  return (
    <div className="space-y-8">
      <header className="max-w-3xl">
        <p className="flex items-center gap-2.5 text-[10px] uppercase tracking-[0.17em] text-muted-foreground">
          <span className="h-px w-8 bg-copper-2" aria-hidden /> Vision · synthetic data
        </p>
        <h1 className="display mt-4 text-[clamp(36px,5vw,72px)] leading-[0.96] tracking-[-0.045em] text-paper">
          Ask earns autonomy. It is not given it.
        </h1>
        <p className="mt-4 max-w-[640px] text-[14px] leading-relaxed text-muted-foreground">
          Three labels, used honestly: <span className="readout text-ok">built</span> runs in this build and is tested;{' '}
          <span className="readout text-warn">interactive concept</span> runs here on synthetic records to show the
          shape of an idea; <span className="readout">future</span> is written down and not built.
        </p>
      </header>

      <Reveal>
        <AutonomyLadder decisions={decisions} />
      </Reveal>

      {/* ── the continuum ── */}
      <section aria-labelledby="continuum-title" data-testid="continuum">
        <Reveal className="mb-4">
          <p className="text-[10px] font-bold uppercase tracking-[0.2em] text-copper-2">The continuum</p>
          <h2
            id="continuum-title"
            className="display mt-2 text-[clamp(26px,3vw,40px)] leading-[1] tracking-[-0.035em] text-paper"
          >
            Built now → next validation → horizon
          </h2>
        </Reveal>
        <div className="relative grid gap-3 md:grid-cols-3">
          {/* The line the three columns sit on: from what runs to what is only written down. */}
          <div
            className="pointer-events-none absolute inset-x-0 top-[22px] hidden h-px bg-gradient-to-r from-ok/70 via-warn/60 to-white/15 md:block"
            aria-hidden
          />
          {CONTINUUM.map((column, i) => (
            <Stagger key={column.key} as="div" className="frame-story relative p-4 md:p-5" delay={i * 0.12} step={0.05}>
              <StaggerItem>
                <p className="flex items-center gap-2 text-[10px] font-bold uppercase tracking-[0.18em]">
                  <span className={cn('size-2 rounded-full', TONE[column.tone].dot)} aria-hidden />
                  <span className={TONE[column.tone].label}>{column.label}</span>
                  <span className="readout ml-auto text-[9px] text-muted-foreground">{TONE[column.tone].badge}</span>
                </p>
                <p className="mt-2 text-[12.5px] leading-relaxed text-muted-foreground">{column.lead}</p>
              </StaggerItem>
              <ul className="mt-4 space-y-2.5">
                {column.items.map((item) => (
                  <StaggerItem as="li" key={item.key} className="card-op flex gap-3 px-3 py-2.5">
                    <item.icon
                      className={cn(
                        'mt-0.5 size-4 shrink-0',
                        column.tone === 'built'
                          ? 'text-copper-2'
                          : column.tone === 'validation'
                            ? 'text-warn'
                            : 'text-muted-foreground',
                      )}
                      strokeWidth={1.75}
                      aria-hidden
                    />
                    <div className="min-w-0 flex-1">
                      <p className="flex items-baseline justify-between gap-2 text-[12.5px] font-medium text-paper">
                        {item.href ? (
                          <Link
                            href={
                              signedIn || item.href.startsWith('/story') || item.href.startsWith('/build')
                                ? item.href
                                : `/login?next=${encodeURIComponent(item.href)}`
                            }
                            className="inline-flex items-center gap-1 underline-offset-4 hover:underline"
                          >
                            {item.title} <ArrowRight className="size-3 text-muted-foreground" />
                          </Link>
                        ) : (
                          item.title
                        )}
                      </p>
                      {column.tone === 'built' ? (
                        <Figure text={figureFor(item.key, { story, lastRun, decisions })} />
                      ) : null}
                      <p className="mt-1 text-[11.5px] leading-snug text-muted-foreground">{item.line}</p>
                    </div>
                  </StaggerItem>
                ))}
              </ul>
            </Stagger>
          ))}
        </div>
      </section>

      {/* 01 · ask across the estate */}
      <Idea
        n="01"
        title="Ask across the estate"
        now="One question; the ledger, Stripe, the books, the vet's record and the sale answer it together, each row cited. The boundary above it lights along the tools the question really reached for."
        next="The auction feed and the vet application as live sources behind the same adapters."
      >
        {authority ? <AgentMembrane catalog={authority} run={run} className="mb-3" /> : null}
        <div className="flex h-[420px] flex-col rounded-md border">
          <AskPanel
            status={askStatus}
            className="flex-1"
            suggestions={suggestions}
            onAnswered={() => router.refresh()}
            onEvent={(event) => authority && setRun((current) => foldEvent(current, event, authority))}
            onProposal={(status) => setRun((current) => (current ? { ...current, proposal: status } : current))}
          />
        </div>
      </Idea>

      {/* 02 · customer update */}
      <Idea
        n="02"
        title="Customer update"
        now="A draft from verified records, the consent check on the row, and a person's finger on Send."
        next="Ask proposes the wording; the records stay the source; nothing goes out by itself."
      >
        {digest ? (
          <div className="grid gap-3 md:grid-cols-[minmax(0,1fr)_220px]">
            <pre
              className="max-h-56 overflow-auto whitespace-pre-wrap rounded-sm bg-muted p-3 font-mono text-[11px] leading-relaxed"
              tabIndex={0}
              aria-label="The digest as it would be texted"
            >
              {digest.sms}
            </pre>
            <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 self-start text-[12px]">
              <dt className="readout text-muted-foreground">from</dt>
              <dd>
                {digest.lines.length} verified record{digest.lines.length === 1 ? '' : 's'}
              </dd>
              <dt className="readout text-muted-foreground">sms consent</dt>
              <dd className={cn(digest.customer.smsOptedOut ? 'text-critical' : 'text-ok')}>
                {digest.customer.smsOptedOut ? 'opted out · no text' : digest.customer.phone ? 'yes' : 'no number'}
              </dd>
              <dt className="readout text-muted-foreground">email</dt>
              <dd>{digest.customer.email ? 'on file' : 'none'}</dd>
              <dt className="readout text-muted-foreground">send</dt>
              <dd>
                <Link
                  href={signedIn ? '/intake' : '/login?next=/intake'}
                  className="inline-flex h-7 items-center gap-1 rounded-md border px-2 text-[12px] hover:bg-muted"
                >
                  a person, on Intake <ArrowRight className="size-3" />
                </Link>
              </dd>
            </dl>
          </div>
        ) : (
          <p className="text-[12px] text-muted-foreground">The API is not running; nothing to draft.</p>
        )}
      </Idea>

      {/* 03 · replay */}
      <Idea
        n="03"
        title="Replay"
        now="Any incident: one correlation id, from the click to the books — every audit row, job, delivery and sync attempt in order."
        next="Replay the same events against a fresh copy of the state and diff the outcome."
      >
        <div className="flex flex-wrap items-center gap-2 text-[12px]">
          {lastTrace?.correlationId ? (
            <button
              type="button"
              className="inline-flex h-8 items-center gap-1.5 rounded-md border px-3 hover:bg-muted"
              onClick={() => setTrace(lastTrace.correlationId)}
            >
              <ScanSearch className="size-3.5" /> Open the last trace{' '}
              <span className="code text-[10px] text-muted-foreground">{lastTrace.correlationId}</span>
            </button>
          ) : (
            <span className="text-muted-foreground">
              No traced action yet; settle the ACH on the sale page and come back.
            </span>
          )}
          <Link href="/settlement" className="text-muted-foreground underline">
            the sale’s trail →
          </Link>
          <Link href={signedIn ? '/lab' : '/login?next=/lab'} className="text-muted-foreground underline">
            the lab’s runs →
          </Link>
        </div>
      </Idea>
      <TraceDrawer correlationId={trace} onClose={() => setTrace(null)} />
    </div>
  );
}

/** The live figure under a built tile; nothing when the API is away, never a placeholder. */
function Figure({ text }: { text: string | null }) {
  if (!text) return null;
  return <p className="readout mt-1 text-[9.5px] text-ok">{text}</p>;
}

function Idea({
  n,
  title,
  now,
  next,
  children,
}: {
  n: string;
  title: string;
  now: string;
  next: string;
  children: React.ReactNode;
}) {
  return (
    <Reveal as="section" className="frame-story">
      <div className="grid gap-2 border-b border-white/[0.08] px-4 py-3 md:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
        <div>
          <p className="eyebrow">
            {n} · <span className="text-warn">interactive concept</span>
          </p>
          <h2 className="mt-1 text-[16px] font-semibold text-paper">{title}</h2>
        </div>
        <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-[12px]">
          <dt className="readout text-ok">runs</dt>
          <dd>{now}</dd>
          <dt className="readout text-muted-foreground">next</dt>
          <dd className="text-muted-foreground">{next}</dd>
        </dl>
      </div>
      <div className="px-4 py-3">{children}</div>
    </Reveal>
  );
}
