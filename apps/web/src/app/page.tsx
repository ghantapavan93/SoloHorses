import Link from 'next/link';
import { redirect } from 'next/navigation';
import { ArrowDown, ArrowRight } from 'lucide-react';
import { AgentMembrane } from '@/components/ask/agent-membrane';
import { DecisionTimeline } from '@/components/decisions/decision-timeline';
import { LandingAsk } from '@/components/landing/landing-ask';
import { Reveal, Stagger, StaggerItem } from '@/components/motion/reveal';
import { PanelBoundary } from '@/components/platform/panel-boundary';
import { FlightWaterfall } from '@/components/runs/flight-waterfall';
import { FilmPlayer } from '@/components/story/film-player';
import { SceneConverge } from '@/components/story/scene-converge';
import { SceneRanchLoader } from '@/components/story/scene-ranch-loader';
import { StoryNav } from '@/components/story/story-nav';
import { StoryProduct } from '@/components/story/story-product';
import { apiFetchOrNull } from '@/lib/api';
import { auth } from '@/lib/auth';
import { readFilm } from '@/lib/film';
import { dateTime } from '@/lib/format';
import { runFromLast } from '@/lib/membrane';
import type {
  AskAuthority,
  AskLastRun,
  AskRunSummary,
  AskStatus,
  BuildHealth,
  DecisionLedger,
  DecisionRow,
  FlightRecord,
  Health,
  LabStatus,
  OperationsSummary,
  Signal,
  Story,
  Xray,
} from '@/lib/types';
import { cn } from '@/lib/utils';

export const metadata = { title: 'Daysheet — what matters, why, and who decides' };

const PROOFS = ['Synthetic records', 'Rules in code', 'A person approves'];

/** The doors past the story: the pages that go deeper, in the order a reviewer tends to take them. */
const DEEPER = [
  {
    href: '/story',
    label: 'See one mare’s story',
    detail: 'every handoff of one recipient mare’s season, with the three things that went wrong',
  },
  {
    href: '/settlement',
    label: 'Run a sale settlement',
    detail: 'an ACH that holds the papers, a settlement that frees them, a person who releases them',
  },
  {
    href: '/login?next=/lab',
    label: 'Break the system',
    detail: 'duplicate webhooks, a dead accounting system, a poisoned job — and the recovery paths',
  },
  {
    href: '/build',
    label: 'What is built, what is a prototype, what is a guess',
    detail: 'the honesty page: verification as it last ran, and every assumption named',
  },
  {
    href: '/vision',
    label: 'Ask earns autonomy',
    detail: 'the ladder from explaining to acting, one rung built, the rest labelled',
  },
];

const ms = (n: number) => (n >= 1000 ? `${(n / 1000).toFixed(2)} s` : `${Math.round(n)} ms`);
const STATE_TONE: Record<LabStatus['services'][number]['state'], string> = {
  HEALTHY: 'bg-ok',
  DEGRADED: 'bg-warn',
  PAUSED: 'bg-warn',
  DOWN: 'bg-critical',
};

/**
 * The front door, always dark: five scenes in the order a day runs them. The records already
 * exist and their signals converge on one number; a question asked of the real assistant; the
 * x-ray of the mare it read; the decision it prepared, approved here by the reviewer; then the
 * proof — the film of this build driving itself, verification as it last ran, the runtime as
 * it stands, and the boundary the assistant never crosses. Nothing on this page is written in
 * advance; a panel with nothing behind it says so.
 */
export default async function LandingPage() {
  const session = await auth();
  if (session?.user) redirect('/today');
  const reviewer = { allowReviewer: true } as const;
  const [story, summary, signals, askStatus, authority, lastRun, runs, build, health, lab, proposals] =
    await Promise.all([
      apiFetchOrNull<Story>('/story', reviewer),
      apiFetchOrNull<OperationsSummary>('/operations/summary', reviewer),
      apiFetchOrNull<Signal[]>('/operations/signals', reviewer),
      apiFetchOrNull<AskStatus>('/ask/status', reviewer),
      apiFetchOrNull<AskAuthority>('/ask/authority', reviewer),
      apiFetchOrNull<AskLastRun>('/ask/last-run', reviewer),
      apiFetchOrNull<AskRunSummary[]>('/ask/runs', reviewer),
      apiFetchOrNull<BuildHealth>('/health/build', reviewer),
      apiFetchOrNull<Health>('/health', reviewer),
      apiFetchOrNull<LabStatus>('/lab/status', reviewer),
      apiFetchOrNull<DecisionRow[]>('/proposals?status=all', reviewer),
    ]);
  const apiDown = !summary && !story;
  // The latest decision on record, followed through its ledger: the proof that a click became rows.
  const latestDecision = [...(proposals ?? [])].sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0] ?? null;
  const recipId = story?.recip.id ?? null;
  const [xray, flight, ledger] = await Promise.all([
    recipId ? apiFetchOrNull<Xray>(`/operations/xray/${encodeURIComponent(recipId)}`, reviewer) : Promise.resolve(null),
    runs?.[0]
      ? apiFetchOrNull<FlightRecord>(`/ask/runs/${encodeURIComponent(runs[0].id)}/flight`, reviewer)
      : Promise.resolve(null),
    latestDecision
      ? apiFetchOrNull<DecisionLedger>(`/proposals/${encodeURIComponent(latestDecision.id)}/ledger`, reviewer)
      : Promise.resolve(null),
  ]);
  const paymentId = story?.money.invoices.flatMap((i) => i.payments)[0]?.id ?? null;
  const film = readFilm();

  const suggestions = [
    'What is at stake today?',
    'What changed since yesterday?',
    ...(recipId ? [`What is blocking ${recipId}?`, `Is ${recipId} cleared for a transfer?`] : []),
    ...(paymentId ? [`What happened with ${paymentId}?`] : []),
  ];
  const verify = build?.verify ?? null;
  const suites = verify ? Object.values(verify.suites) : [];
  const passed = suites.reduce((n, s) => n + s.passed, 0);
  const total = suites.reduce((n, s) => n + s.total, 0);
  const gauntlet = verify?.gauntlet
    ? Object.values(verify.gauntlet).filter((g): g is NonNullable<typeof g> => Boolean(g))
    : [];
  const toolSteps = flight ? flight.steps.filter((s) => s.kind === 'tool').length : 0;

  return (
    <div className="dark">
      <main className="story glow relative min-h-dvh overflow-x-clip text-foreground">
        <div className="grain" aria-hidden />
        <StoryNav current="/">
          <LandingAsk status={askStatus} suggestions={suggestions} variant="pill" />
        </StoryNav>

        {/* ── scene 1 · the records already exist ── */}
        <section className="relative" aria-labelledby="thesis">
          <SceneRanchLoader xray={xray} summary={summary} />
          <div className="relative z-10 px-[5vw] pb-10 pt-8 md:pt-10">
            <div className="flex flex-wrap items-center gap-x-8 gap-y-4">
              <div className="flex flex-wrap gap-2.5">
                <a
                  href="#ask"
                  className="inline-flex h-12 items-center gap-2 rounded-xl bg-paper px-5 text-[12px] font-bold uppercase tracking-[0.04em] text-[#0b0707] transition-opacity hover:opacity-90"
                >
                  Ask the operation <ArrowDown className="size-4" />
                </a>
                <Link
                  href="/login?next=/today"
                  className="inline-flex h-12 items-center gap-2 rounded-xl border border-copper-2/60 px-5 text-[12px] font-bold uppercase tracking-[0.04em] text-cream transition-colors hover:bg-white/[0.06]"
                >
                  Sign in as the operation <ArrowRight className="size-4" />
                </Link>
              </div>
              <ul className="flex flex-wrap gap-6">
                {PROOFS.map((p) => (
                  <li key={p} className="flex items-center gap-2 text-[11px] text-muted-foreground">
                    <span
                      className="size-1.5 rounded-full bg-ok shadow-[0_0_0_4px_rgb(143_183_154/0.18)]"
                      aria-hidden
                    />{' '}
                    {p}
                  </li>
                ))}
              </ul>
            </div>
            <p className="mt-6 max-w-[620px] text-[15px] leading-relaxed text-cream/85">
              Five systems each hold a piece of one mare’s day. Daysheet is the layer that reads them together, says
              what needs a person, prepares the next step — and stops there.
            </p>

            <div className="mt-10 md:mt-12">
              <h2 className="mb-3 flex items-center gap-2 text-[10px] font-bold uppercase tracking-[0.2em] text-copper-2">
                <span className="tabular-nums">01</span> · What needs a person today
              </h2>
              {signals && summary ? (
                <PanelBoundary name="The signals" className="frame-story px-4 py-6 text-[12px] text-muted-foreground">
                  <SceneConverge signals={signals} summary={summary} />
                </PanelBoundary>
              ) : (
                <p className="frame-story px-5 py-10 text-center text-[13px] text-muted-foreground">
                  {apiDown
                    ? 'The API is not running. Start it and this page fills with the operation as it stands.'
                    : 'The board is not reachable; there is nothing to show.'}
                </p>
              )}
            </div>
          </div>
        </section>

        {/* ── scenes 2–4 · ask, x-ray, decide ── */}
        {recipId ? (
          <StoryProduct recipId={recipId} paymentId={paymentId} initialXray={xray} status={askStatus} />
        ) : (
          <section className="px-[5vw] py-16">
            <p className="frame-story px-5 py-10 text-center text-[13px] text-muted-foreground">
              The story mare is not reachable, so there is nothing to ask about here yet.
            </p>
          </section>
        )}

        {/* ── scene 5 · now inspect the proof ── */}
        <section
          id="proof"
          className="relative scroll-mt-20 px-[5vw] py-[56px] md:py-[72px]"
          aria-labelledby="proof-title"
        >
          <Reveal className="mb-6 grid gap-3 md:grid-cols-2 md:items-end">
            <div>
              <p className="flex items-center gap-2 text-[10px] font-bold uppercase tracking-[0.2em] text-copper-2">
                <span className="tabular-nums">05</span> · The proof
              </p>
              <h2
                id="proof-title"
                className="display mt-3 text-[clamp(30px,3.6vw,50px)] leading-[0.98] tracking-[-0.04em] text-paper"
              >
                Now inspect the proof.
              </h2>
            </div>
            <p className="max-w-[440px] text-[13.5px] leading-relaxed text-muted-foreground md:justify-self-end">
              A film of this build driving itself, verification as it last ran, the runtime as it stands, and the
              boundary the assistant never crosses. Every number here is read, not written.
            </p>
          </Reveal>

          <Reveal className="frame-story p-4 md:p-6">
            <p className="eyebrow mb-3">The film · one question, one decision, one record</p>
            {film ? (
              <FilmPlayer film={film} />
            ) : (
              <p
                className="rounded-xl border border-dashed border-white/15 px-4 py-8 text-center text-[12.5px] text-muted-foreground"
                data-testid="film-missing"
              >
                No recording in this deploy. The film is a real screen recording of this build’s own journey, made by{' '}
                <span className="code">scripts/film.mjs</span> against the running stack; it is never staged, so a
                deploy without one shows this line instead.
              </p>
            )}
          </Reveal>

          <Stagger className="mt-4 grid gap-3 md:grid-cols-3" step={0.08}>
            <StaggerItem className="frame-evidence flex flex-col p-4">
              <p className="eyebrow">Verification, as it last ran</p>
              {verify ? (
                <>
                  <p className="display mt-3 text-[40px] leading-none text-paper">
                    {passed}
                    <span className="text-[18px] text-muted-foreground">/{total}</span>
                  </p>
                  <p className="mt-1 text-[11px] text-muted-foreground">
                    tests passed · {Object.keys(verify.gates).length} gates{' '}
                    {verify.ok ? <span className="text-ok">green</span> : <span className="text-critical">red</span>}
                    {gauntlet.length > 0 ? (
                      <>
                        {' '}
                        · gauntlet {gauntlet.filter((g) => g.status === 'PASS').length}/{gauntlet.length}
                      </>
                    ) : null}
                  </p>
                  <p className="mt-2 text-[11px] text-muted-foreground">
                    {dateTime(verify.finishedAt)}
                    {verify.commit ? (
                      <>
                        {' '}
                        · <span className="code">{verify.commit.slice(0, 7)}</span>
                        {verify.dirty ? ' · dirty' : ''}
                      </>
                    ) : null}
                  </p>
                  {verify.gauntlet ? (
                    <details className="mt-2 text-[11px]">
                      <summary className="cursor-pointer list-none text-muted-foreground underline underline-offset-2 hover:text-paper">
                        the engineering gauntlet
                      </summary>
                      <ul className="mt-1.5 space-y-0.5" data-testid="gauntlet">
                        {Object.entries(verify.gauntlet).map(([name, line]) =>
                          line ? (
                            <li key={name} className="flex gap-2">
                              <span
                                className={
                                  line.status === 'PASS'
                                    ? 'readout text-ok'
                                    : line.status === 'FAILED'
                                      ? 'readout text-critical'
                                      : 'readout text-muted-foreground'
                                }
                              >
                                {line.status.toLowerCase()}
                              </span>
                              <span className="text-paper">{name}</span>
                              <span className="min-w-0 truncate text-muted-foreground" title={line.detail}>
                                {line.detail}
                              </span>
                            </li>
                          ) : null,
                        )}
                      </ul>
                    </details>
                  ) : null}
                </>
              ) : (
                <p className="mt-3 text-[12.5px] text-muted-foreground">No verification report in this deploy.</p>
              )}
              <Link
                href="/build"
                className="mt-auto inline-flex items-center gap-1 pt-4 text-[11px] font-bold uppercase tracking-[0.14em] text-cream hover:underline"
              >
                The honesty page <ArrowRight className="size-3" />
              </Link>
            </StaggerItem>

            <StaggerItem className="frame-evidence flex flex-col p-4">
              <p className="eyebrow">The last run, stage by stage</p>
              {flight ? (
                <>
                  <p className="mt-3 text-[13px] leading-snug text-paper" data-testid="landing-run-summary">
                    “{flight.question}”
                  </p>
                  <p className="mt-2 text-[11px] text-muted-foreground">
                    <span className="tabular-nums text-paper">{ms(flight.durationMs)}</span> end to end ·{' '}
                    {flight.provider.kind === 'deterministic'
                      ? 'deterministic'
                      : flight.provider.kind === 'cache'
                        ? 'answer cache'
                        : flight.provider.model}{' '}
                    · {toolSteps} tool{toolSteps === 1 ? '' : 's'}
                    {flight.result ? (
                      <>
                        {' '}
                        · verifier{' '}
                        {flight.result.verified === false ? (
                          <span className="text-warn">removed {flight.result.rejected}</span>
                        ) : (
                          <span className="text-ok">passed</span>
                        )}
                      </>
                    ) : null}
                  </p>
                  <ol className="mt-2 flex flex-wrap gap-1" aria-label="Stages">
                    {flight.steps.slice(0, 8).map((s, i) => (
                      <li
                        key={i}
                        className="code rounded-sm border border-white/[0.1] px-1.5 py-0.5 text-[10px] text-muted-foreground"
                      >
                        {s.kind === 'tool' ? (s.provenance.tool ?? s.name) : s.kind}
                      </li>
                    ))}
                  </ol>
                  <details className="mt-2 text-[11px]">
                    <summary className="cursor-pointer list-none text-muted-foreground underline underline-offset-2 hover:text-paper">
                      the flight recorder
                    </summary>
                    <div className="mt-2 rounded-md border border-white/[0.08] bg-[rgb(9_7_6/0.5)] p-2">
                      <FlightWaterfall record={flight} />
                    </div>
                  </details>
                </>
              ) : (
                <p className="mt-3 text-[12.5px] text-muted-foreground">
                  No run on record yet. The first question asked here leaves one.
                </p>
              )}
              <Link
                href={flight ? `/runs/${flight.runId}` : '/runs'}
                className="mt-auto inline-flex items-center gap-1 pt-4 text-[11px] font-bold uppercase tracking-[0.14em] text-cream hover:underline"
              >
                {flight ? 'Open this run' : 'The runs'} <ArrowRight className="size-3" />
              </Link>
            </StaggerItem>

            <StaggerItem className="frame-evidence flex flex-col p-4" data-testid="runtime">
              <p className="eyebrow">Runtime, right now</p>
              {lab && health ? (
                <ul className="mt-3 space-y-1 text-[11.5px]">
                  {lab.services.map((s) => (
                    <li key={s.name} className="flex items-baseline gap-2">
                      <span
                        className={cn('mt-[1px] size-1.5 shrink-0 self-center rounded-full', STATE_TONE[s.state])}
                        aria-hidden
                      />
                      <span className="w-[76px] shrink-0 text-paper">{s.name}</span>
                      <span className="min-w-0 truncate text-muted-foreground" title={s.note}>
                        {s.note}
                      </span>
                    </li>
                  ))}
                  <li className="pt-1 text-[10.5px] text-muted-foreground">
                    {health.demoClock ? 'demo clock' : 'real clock'} · {health.today}
                    {health.seededAt ? <> · seeded {dateTime(health.seededAt)}</> : null}
                    {build?.head ? (
                      <>
                        {' '}
                        · <span className="code">{build.head.slice(0, 7)}</span>
                      </>
                    ) : null}
                  </li>
                </ul>
              ) : (
                <p className="mt-3 text-[12.5px] text-muted-foreground">The API is not reachable; nothing to report.</p>
              )}
              <span className="mt-auto flex flex-wrap gap-x-3 pt-4">
                <Link
                  href="/build"
                  className="inline-flex items-center gap-1 text-[11px] font-bold uppercase tracking-[0.14em] text-cream hover:underline"
                >
                  Real · simulated <ArrowRight className="size-3" />
                </Link>
                <Link
                  href="/login?next=/lab"
                  className="inline-flex items-center gap-1 text-[11px] font-bold uppercase tracking-[0.14em] text-cream hover:underline"
                >
                  Break it in the lab <ArrowRight className="size-3" />
                </Link>
              </span>
            </StaggerItem>
          </Stagger>

          <Reveal className="frame-evidence mt-4 p-4" delay={0.06}>
            <p className="eyebrow">Decision history · the last decision on record</p>
            {ledger && latestDecision ? (
              <>
                <p className="mt-2 flex flex-wrap items-baseline gap-x-3 gap-y-1 text-[12.5px]">
                  <span className="code text-muted-foreground">{latestDecision.id}</span>
                  <span className="text-paper">{ledger.proposal.spec.label}</span>
                  <span className="readout text-muted-foreground">{ledger.summary.status.toLowerCase()}</span>
                  <span className="text-muted-foreground">outcome: {ledger.outcome.label}</span>
                  {ledger.people.decidedBy ? (
                    <span className="text-muted-foreground">decided by {ledger.people.decidedBy.name}</span>
                  ) : null}
                </p>
                <details className="mt-2 text-[12px]">
                  <summary className="cursor-pointer list-none text-[11px] text-muted-foreground underline underline-offset-2 hover:text-paper">
                    every step, as a row
                  </summary>
                  <div className="mt-2">
                    <DecisionTimeline ledger={ledger} />
                  </div>
                </details>
                <Link
                  href={`/decisions/${latestDecision.id}`}
                  className="mt-3 inline-flex items-center gap-1 text-[11px] font-bold uppercase tracking-[0.14em] text-cream hover:underline"
                >
                  Open the decision <ArrowRight className="size-3" />
                </Link>
              </>
            ) : (
              <p className="mt-2 text-[12.5px] text-muted-foreground">
                No decision on record yet. Approve one above and its history appears here.
              </p>
            )}
          </Reveal>

          <Reveal className="frame-story mt-4 p-4 md:p-6" delay={0.1}>
            <p className="eyebrow mb-3">The boundary</p>
            {authority ? (
              <PanelBoundary name="The assistant">
                <div>
                  <AgentMembrane catalog={authority} run={runFromLast(lastRun)} />
                  {lastRun ? (
                    <p className="mt-2 text-[12px] text-muted-foreground">
                      Last question: <span className="text-paper">“{lastRun.question}”</span> · {lastRun.steps.length}{' '}
                      tool{lastRun.steps.length === 1 ? '' : 's'}
                      {lastRun.latencyMs ? ` · answered in ${(lastRun.latencyMs / 1000).toFixed(1)} s` : ''}
                      {lastRun.model ? ` · ${lastRun.model.replace(/^(ollama|hosted)\//, '')}` : ''}
                    </p>
                  ) : null}
                </div>
              </PanelBoundary>
            ) : (
              <p className="rounded-xl border border-dashed border-white/15 px-4 py-6 text-center text-[12.5px] text-muted-foreground">
                The assistant’s authority is not reachable.
              </p>
            )}
          </Reveal>
        </section>

        {/* ── deeper ── */}
        <section className="px-[5vw] pb-[70px] pt-2">
          <Reveal>
            <p className="text-[10px] font-bold uppercase tracking-[0.2em] text-copper-2">Go deeper</p>
            <ul className="mt-4 grid gap-2 md:grid-cols-2 lg:grid-cols-5">
              {DEEPER.map((d) => (
                <li key={d.href}>
                  <Link href={d.href} className="group card-op block h-full px-4 py-3 lift hover:border-copper-2/60">
                    <span className="inline-flex items-center gap-1 text-[12px] font-bold text-paper">
                      {d.label} <ArrowRight className="size-3 transition-transform group-hover:translate-x-0.5" />
                    </span>
                    <span className="mt-1 block text-[11.5px] leading-snug text-muted-foreground">{d.detail}</span>
                  </Link>
                </li>
              ))}
            </ul>
          </Reveal>
        </section>

        <footer className="flex flex-wrap items-center justify-between gap-3 border-t border-white/[0.06] px-[5vw] py-6 text-[11px] text-muted-foreground">
          <span>
            <strong className="text-paper">DAYSHEET</strong> · unofficial candidate prototype for a performance-horse
            breeding operation
          </span>
          <span>synthetic data · no production or customer systems accessed · public sources only</span>
          <span className="basis-full text-cream/80">
            What I’d do next: sit beside the people using the current systems, find where these assumptions are wrong,
            and change the product accordingly.
          </span>
        </footer>
      </main>
    </div>
  );
}
