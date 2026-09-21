'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useCallback, useRef, useState, type ReactNode, type Ref } from 'react';
import { ArrowDown, ArrowUp, CheckCircle2, CircleSlash, Loader2, Send, Sparkles } from 'lucide-react';
import { AnimatePresence, motion, useReducedMotion } from 'motion/react';
import { CardView } from '@/components/ask/ask-panel';
import { DecisionFrame } from '@/components/story/decision-frame';
import { XrayPanel } from '@/components/story/xray';
import { decisionDiffAction, xrayForRecipAction } from '@/lib/actions';
import { streamAsk } from '@/lib/ask-client';
import { PRESET } from '@/lib/motion';
import type {
  AnswerCard,
  AskAnswer,
  AskEvent,
  AskStatus,
  AskTarget,
  DecisionDiff,
  Investigation,
  ProposalSummary,
  Xray,
} from '@/lib/types';
import { cn } from '@/lib/utils';

interface Turn {
  id: string;
  question: string;
  /** Asked by the page after an approval, not by the person: the re-read that closes the loop. */
  auto: boolean;
  tools: Extract<AskEvent, { type: 'tool' }>[];
  answer: AskAnswer | null;
  card: AnswerCard | null;
  investigation: Investigation | null;
  proposals: ProposalSummary[];
  error: string | null;
  usage: { latencyMs: number; model: string } | null;
}

/** Where one decision stands, as the ladder draws it. `CREATED` and `WAITING` arrive together: the record exists, and it waits. */
type Rung = 'PREPARED' | 'APPROVED' | 'CREATED' | 'WAITING';
const RUNGS: { key: Rung; label: string; detail: string }[] = [
  { key: 'PREPARED', label: 'Prepared', detail: 'by Ask, from the records, bound to their state' },
  { key: 'APPROVED', label: 'Approved', detail: 'by a person, under their name' },
  { key: 'CREATED', label: 'Record created', detail: 'by the same rule-checked service the screen calls' },
  { key: 'WAITING', label: 'Waiting', detail: 'for the vet’s answer; the signal stays open until it lands' },
];

const PROVIDER: Record<NonNullable<AskStatus['provider']>, string> = {
  offline: 'deterministic answerer · no model, every answer from the tools',
  ollama: 'a local model on this machine',
  anthropic: 'a hosted model',
  openai: 'a hosted model',
};

/**
 * The three scenes in the middle of the front door, sharing one state: a question asked of the
 * real assistant, the mare's x-ray redrawn from what the answer read, and the decision the
 * answer prepared — approved here, by the reviewer, through the same service the application
 * calls, so the record it creates enters the graph above. Nothing is scripted: the prompts are
 * real questions, the answers stream from the API, and a world where the request is already
 * open says so instead of preparing it twice.
 */
export function StoryProduct({
  recipId,
  paymentId,
  initialXray,
  status,
}: {
  recipId: string;
  paymentId: string | null;
  initialXray: Xray | null;
  status: AskStatus | null;
}) {
  const router = useRouter();
  const reduce = useReducedMotion();
  const [turns, setTurns] = useState<Turn[]>([]);
  const [draft, setDraft] = useState('');
  const [busy, setBusy] = useState(false);
  const [xray, setXray] = useState<Xray | null>(initialXray);
  const [highlight, setHighlight] = useState<string | null>(null);
  const [diff, setDiff] = useState<DecisionDiff | null>(null);
  const [outcome, setOutcome] = useState<{ status: string; requestId: string | null; line: string } | null>(null);
  const conversationRef = useRef<string | null>(null);
  const xrayRef = useRef<HTMLDivElement | null>(null);
  const decisionRef = useRef<HTMLDivElement | null>(null);

  const prompts = [
    `What needs the vet today?`,
    `Why can't ${recipId} leave?`,
    ...(paymentId ? [`What happened with ${paymentId}?`] : []),
  ];
  const asked = [...turns].reverse().find((t) => !t.auto) ?? null;
  const reread = [...turns].reverse().find((t) => t.auto) ?? null;
  const proposal = [...turns].reverse().flatMap((t) => t.proposals)[0] ?? null;
  const openRequest = xray?.nodes.find((n) => n.type === 'record' && /^RQ-/.test(n.recordRef ?? '')) ?? null;

  const scrollTo = (ref: React.RefObject<HTMLDivElement | null>) =>
    ref.current?.scrollIntoView({ behavior: reduce ? 'auto' : 'smooth', block: 'start' });

  /**
   * `entered` names the node that just arrived and should be ringed; `undefined` keeps whatever ring
   * is on. A ring is only worth drawing on a graph that holds the node, so the read is repeated a few
   * times until it does — a record committed a moment ago is read again rather than assumed.
   */
  const redraw = useCallback(
    async (focus: string | null, entered: string | null | undefined) => {
      for (let attempt = 0; attempt < 4; attempt += 1) {
        const result = await xrayForRecipAction(recipId, focus);
        if (!result.ok) {
          // The graph keeps its last drawing; the console says why it could not be redrawn, with the id support would ask for.
          console.warn(
            `[story] the x-ray could not be redrawn: ${result.error} (${result.correlationId ?? 'no correlation id'})`,
          );
          return;
        }
        const holds = !entered || result.data.nodes.some((n) => n.id === entered);
        if (holds || attempt === 3) {
          setXray(result.data);
          if (entered !== undefined) setHighlight(holds ? entered : null);
          return;
        }
        await new Promise((resolve) => setTimeout(resolve, 500));
      }
    },
    [recipId],
  );

  const submit = useCallback(
    async (question: string, auto = false) => {
      const q = question.trim();
      if (!q || busy) return;
      const id = crypto.randomUUID();
      setTurns((t) => [
        ...t,
        {
          id,
          question: q,
          auto,
          tools: [],
          answer: null,
          card: null,
          investigation: null,
          proposals: [],
          error: null,
          usage: null,
        },
      ]);
      setDraft('');
      setBusy(true);
      try {
        await streamAsk(
          { question: q, conversationId: conversationRef.current, context: { path: '/', entityId: null } },
          (event) => {
            setTurns((t) =>
              t.map((turn) => {
                if (turn.id !== id) return turn;
                if (event.type === 'tool') return { ...turn, tools: [...turn.tools, event] };
                if (event.type === 'answer')
                  return {
                    ...turn,
                    answer: event.answer,
                    card: event.card ?? null,
                    investigation: event.investigation ?? null,
                    proposals: event.proposals ?? [],
                    usage: { latencyMs: event.usage.latencyMs, model: event.usage.model },
                  };
                return { ...turn, error: event.message };
              }),
            );
            if (event.type !== 'answer') return;
            conversationRef.current = event.conversationId;
            // The answer read her records: the graph is redrawn from the same read, lit at the block it named.
            // The page's own re-read after an approval keeps the ring on the record that just entered.
            if (event.investigation?.subject === recipId)
              void redraw(event.investigation.block?.signalId ?? null, auto ? undefined : null);
            const prepared = event.proposals?.[0];
            if (prepared) {
              setOutcome(null);
              void decisionDiffAction(prepared.id).then((r) => setDiff(r.ok ? r.data : null));
            }
          },
        );
      } catch (error) {
        setTurns((t) => t.map((turn) => (turn.id === id ? { ...turn, error: (error as Error).message } : turn)));
      } finally {
        setBusy(false);
      }
    },
    [busy, recipId, redraw],
  );

  const openTarget = (target: AskTarget) => {
    if (target.peek === 'xray') {
      void redraw(target.entityId, null);
      scrollTo(xrayRef);
      return;
    }
    router.push(target.href);
  };

  const decided = (p: ProposalSummary, status: string, note?: string, result?: Record<string, unknown>) => {
    const requestId = typeof result?.['requestId'] === 'string' ? (result['requestId'] as string) : null;
    const line =
      status === 'APPROVED'
        ? requestId
          ? `Veterinary request created · ${requestId}`
          : `Approved · ${p.spec.label.toLowerCase()} ran`
        : status === 'STALE'
          ? 'Refused as stale · nothing ran'
          : 'Declined · nothing ran';
    setOutcome({ status, requestId, line });
    setTurns((t) =>
      t.map((turn) => ({
        ...turn,
        proposals: turn.proposals.map((x) => (x.id === p.id ? { ...x, status, rationale: note ?? x.rationale } : x)),
      })),
    );
    void decisionDiffAction(p.id).then((r) => setDiff(r.ok ? r.data : null));
    if (status === 'APPROVED') {
      // The record the click created is a row; it enters the graph as one, and Ask reads her again.
      void redraw(null, requestId ? `record:${requestId}` : null);
      void submit(`Is ${recipId} still blocked?`, true);
    }
    router.refresh();
  };

  const rung: Rung | null =
    outcome?.status === 'APPROVED' ? 'WAITING' : proposal ? 'PREPARED' : openRequest ? 'WAITING' : null;
  const rungIndex = rung ? RUNGS.findIndex((r) => r.key === rung) : -1;
  // A request that was open before this page loaded: the page saw neither its preparation nor its approval, and says so.
  const unseen = !proposal && openRequest !== null;
  const decisionState = outcome?.status ?? proposal?.status ?? (openRequest ? 'APPROVED' : 'NONE');

  return (
    <>
      {/* ── scene 2 · ask the operation ── */}
      <Scene
        id="ask"
        n="02"
        kicker="Ask the operation"
        title="One question. The answer is a record."
        desc="The assistant reads the same tables the screens read, through typed tools, behind a policy gate. It answers in a sentence, cites the rows, and opens the door."
      >
        <div className="frame-story p-4 md:p-6" data-testid="story-ask">
          <form
            className="flex items-stretch gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              void submit(draft);
            }}
          >
            <label htmlFor="story-ask-input" className="sr-only">
              Ask
            </label>
            <input
              id="story-ask-input"
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              placeholder="Ask about a mare, a payment, or the day…"
              className="h-12 min-w-0 flex-1 rounded-xl border border-white/[0.14] bg-[rgb(9_7_6/0.8)] px-4 text-[15px] text-paper placeholder:text-muted-foreground focus:border-copper-2/70 focus:outline-none md:h-14 md:px-5 md:text-[17px]"
              disabled={busy}
              autoComplete="off"
            />
            <button
              type="submit"
              disabled={busy || draft.trim().length === 0}
              className="pressable inline-flex h-12 shrink-0 items-center gap-2 rounded-xl bg-paper px-4 text-[12px] font-bold uppercase tracking-[0.04em] text-[#0b0707] disabled:opacity-40 md:h-14 md:px-5"
              aria-label="Ask"
            >
              {busy ? <Loader2 className="size-4 animate-spin" /> : <Send className="size-4" />}
              <span className="hidden md:inline">Ask</span>
            </button>
          </form>
          <div className="mt-3 flex flex-wrap items-center gap-1.5" data-testid="story-prompts">
            {prompts.map((p) => (
              <button
                key={p}
                type="button"
                onClick={() => void submit(p)}
                disabled={busy}
                className="pressable rounded-full border border-white/[0.12] bg-white/[0.03] px-3 py-1.5 text-[12px] text-cream transition-colors hover:border-copper-2/60 hover:text-paper disabled:opacity-50"
              >
                {p}
              </button>
            ))}
            {status?.provider ? (
              <span className="ml-auto text-[10.5px] text-muted-foreground" data-testid="story-provider">
                {PROVIDER[status.provider]}
              </span>
            ) : null}
          </div>

          <AnimatePresence initial={false}>
            {asked ? (
              <motion.div
                key={asked.id}
                className="mt-5"
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                transition={PRESET.enter}
                data-testid="story-turn"
              >
                <p className="text-[11px] uppercase tracking-[0.16em] text-muted-foreground">“{asked.question}”</p>
                {asked.tools.length > 0 ? (
                  <ul
                    className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-muted-foreground"
                    aria-label="Tools that ran"
                  >
                    {asked.tools.map((t, i) => (
                      <motion.li
                        key={i}
                        className="flex items-center gap-1"
                        initial={{ opacity: 0, x: -4 }}
                        animate={{ opacity: 1, x: 0 }}
                        transition={PRESET.row}
                      >
                        {t.ok ? (
                          <CheckCircle2 className="size-3 text-ok" />
                        ) : (
                          <CircleSlash className="size-3 text-warn" />
                        )}
                        <span className="code">{t.name}</span>
                        <span className="tabular-nums">{t.durationMs} ms</span>
                      </motion.li>
                    ))}
                  </ul>
                ) : null}
                {!asked.answer && !asked.error ? (
                  <p className="mt-3 flex items-center gap-2 text-[12px] text-muted-foreground">
                    <Loader2 className="size-3 animate-spin" /> Reading the records…
                    {status?.provider === 'ollama' ? ' (a local model; it can take a minute)' : ''}
                  </p>
                ) : null}
                {asked.error ? <p className="mt-3 text-[13px] text-critical">{asked.error}</p> : null}
                {asked.answer ? (
                  <div className="dark mt-3 text-[13px] text-foreground [&_section]:border-white/[0.12] [&_section]:bg-[rgb(9_7_6/0.55)]">
                    {asked.proposals.length > 0 ? (
                      <p className="rounded-md border border-white/[0.12] bg-[rgb(9_7_6/0.55)] px-3 py-2.5 text-[13px] leading-snug">
                        {asked.card?.answer || asked.answer.statements[0]?.text || asked.answer.summary}{' '}
                        <button
                          type="button"
                          onClick={() => scrollTo(decisionRef)}
                          className="inline-flex items-center gap-1 text-cream underline underline-offset-4"
                        >
                          Decide below <ArrowDown className="size-3" />
                        </button>
                      </p>
                    ) : (
                      <CardView
                        card={asked.card}
                        answer={asked.answer}
                        investigation={asked.investigation}
                        onAsk={(q) => void submit(q)}
                        onTarget={openTarget}
                      />
                    )}
                    {asked.answer.abstentions.map((a, i) => (
                      <p
                        key={i}
                        className="mt-2 rounded-md border border-dashed border-white/[0.15] px-3 py-2 text-[12px] text-muted-foreground"
                      >
                        {a.detail ?? a.question}
                      </p>
                    ))}
                    {asked.usage ? (
                      <p className="mt-2 text-[10.5px] text-muted-foreground">
                        {(asked.usage.latencyMs / 1000).toFixed(1)} s · {asked.usage.model} · {asked.tools.length} tool
                        {asked.tools.length === 1 ? '' : 's'}
                        {asked.investigation ? (
                          <>
                            {' '}
                            · state <span className="code">{asked.investigation.stateHash}</span>
                          </>
                        ) : null}
                      </p>
                    ) : null}
                  </div>
                ) : null}
              </motion.div>
            ) : null}
          </AnimatePresence>
        </div>
      </Scene>

      {/* ── scene 3 · the x-ray ── */}
      <Scene
        id="xray"
        n="03"
        kicker="The x-ray"
        title="Ask doesn’t guess. It shows its work."
        desc="Every record about one mare, the rules that read them, what they found missing, and the person the chain waits for. Click a node for the row behind it."
        ref={xrayRef}
      >
        {xray ? (
          <div className="frame-evidence overflow-hidden p-2 md:p-3" data-testid="story-xray">
            <XrayPanel
              xray={xray}
              ask={{ kind: 'link', hrefs: { why: '#ask', prepare: null } }}
              reveal
              highlightId={highlight}
              className="border-white/[0.08]"
            />
          </div>
        ) : (
          <p className="frame-evidence px-4 py-10 text-center text-[12.5px] text-muted-foreground">
            The board is not reachable; there is no mare to x-ray.
          </p>
        )}
      </Scene>

      {/* ── scene 4 · the decision ── */}
      <Scene
        id="decide"
        n="04"
        kicker="The decision"
        title="Ask can prepare. A person decides."
        desc="What a yes changes, row by row, bound to the records it was read from. Approve it here and the same service the screens call creates the record — under the reviewer's name."
        ref={decisionRef}
      >
        <div className="grid gap-4 md:grid-cols-[minmax(0,1.3fr)_minmax(280px,0.7fr)]">
          <div
            className="frame-decision dark self-start bg-[rgb(9_7_6/0.55)] p-3 text-foreground md:p-4"
            data-state={decisionState}
            data-testid="story-decision"
          >
            {proposal ? (
              <div className="space-y-3">
                <DecisionFrame
                  proposal={proposal}
                  diff={diff}
                  onDecided={(s, note, result) => decided(proposal, s, note, result)}
                />
                <AnimatePresence>
                  {outcome ? (
                    <motion.p
                      key={outcome.line}
                      className={cn(
                        'flex flex-wrap items-center gap-1.5 rounded-md border px-3 py-2 text-[12.5px]',
                        outcome.status === 'APPROVED' ? 'border-ok/50' : 'border-white/[0.15] text-muted-foreground',
                      )}
                      initial={{ opacity: 0, y: 6 }}
                      animate={{ opacity: 1, y: 0 }}
                      transition={PRESET.enter}
                      data-testid="story-outcome"
                    >
                      {outcome.status === 'APPROVED' ? (
                        <CheckCircle2 className="size-3.5 text-ok" />
                      ) : (
                        <CircleSlash className="size-3.5" />
                      )}
                      {outcome.line}
                      {outcome.requestId ? (
                        <>
                          <span className="text-muted-foreground">·</span>
                          <button
                            type="button"
                            onClick={() => scrollTo(xrayRef)}
                            className="inline-flex items-center gap-1 underline underline-offset-4"
                          >
                            it entered the x-ray <ArrowUp className="size-3" />
                          </button>
                          <span className="text-muted-foreground">·</span>
                          <Link href="/operations?tab=requests" className="underline underline-offset-4">
                            the team’s requests
                          </Link>
                        </>
                      ) : null}
                    </motion.p>
                  ) : null}
                </AnimatePresence>
                {reread?.answer ? (
                  <div className="text-[12.5px]" data-testid="story-reread">
                    <p className="text-[10.5px] uppercase tracking-[0.16em] text-muted-foreground">Read again, now</p>
                    <p className="mt-1 leading-snug">
                      {reread.card?.answer || reread.answer.statements[0]?.text || reread.answer.summary}
                    </p>
                  </div>
                ) : reread ? (
                  <p className="flex items-center gap-2 text-[12px] text-muted-foreground">
                    <Loader2 className="size-3 animate-spin" /> Reading her records again…
                  </p>
                ) : null}
              </div>
            ) : openRequest ? (
              <div className="space-y-2 text-[13px]">
                <p className="font-medium">A request is already open about {recipId}.</p>
                <p className="text-[12.5px] text-muted-foreground">
                  <span className="code text-foreground">{openRequest.recordRef}</span> ·{' '}
                  {openRequest.facts.find((f) => f.key === 'subject')?.value ?? 'to the vet'} · since{' '}
                  {openRequest.facts.find((f) => f.key === 'since')?.value ?? '—'}. Ask will not prepare it twice; the
                  vet answers, the signal closes, and the record shows it.
                </p>
                <Link
                  href="/operations?tab=requests"
                  className="inline-flex items-center gap-1 text-[12px] text-cream underline underline-offset-4"
                >
                  the team’s requests
                </Link>
              </div>
            ) : (
              <div className="space-y-2 text-[13px]">
                <p className="font-medium">Nothing is prepared yet.</p>
                <p className="text-[12.5px] text-muted-foreground">
                  Ask why she can’t leave. If a rule allows a next step, the assistant prepares it here — and stops.
                </p>
                <button
                  type="button"
                  onClick={() => void submit(`Why can't ${recipId} leave?`)}
                  disabled={busy}
                  className="pressable inline-flex h-8 items-center gap-1.5 rounded-md border border-copper-2/60 px-3 text-[12px] text-cream hover:bg-white/[0.06] disabled:opacity-50"
                  data-testid="story-ask-why"
                >
                  <Sparkles className="size-3" /> Why can’t {recipId} leave?
                </button>
              </div>
            )}
          </div>

          <ol
            className="card-op self-start divide-y divide-white/[0.06] bg-[rgb(9_7_6/0.4)]"
            aria-label="Where this decision stands"
            data-testid="story-ladder"
          >
            {RUNGS.map((r, i) => {
              const skipped = unseen && i < 2;
              const done = !skipped && rungIndex > i;
              const current = rungIndex === i;
              const declined = outcome !== null && outcome.status !== 'APPROVED';
              return (
                <li
                  key={r.key}
                  className={cn(
                    'flex gap-3 px-3 py-2.5',
                    !done && !current && 'opacity-45',
                    declined && i > 0 && 'line-through opacity-40',
                  )}
                  aria-current={current ? 'step' : undefined}
                  data-state={skipped ? 'unseen' : done ? 'done' : current ? 'current' : 'ahead'}
                >
                  <span
                    className={cn(
                      'mt-1 size-2 shrink-0 rounded-full',
                      done ? 'bg-ok' : current ? 'bg-warn shadow-[0_0_0_4px_rgb(217_164_95/0.25)]' : 'bg-white/20',
                    )}
                    aria-hidden
                  />
                  <span className="min-w-0">
                    <span className="block text-[12px] font-medium text-paper">
                      {r.label}
                      {r.key === 'CREATED' && (outcome?.requestId || openRequest?.recordRef) ? (
                        <span className="code ml-2 text-[11px] text-cream">
                          {outcome?.requestId ?? openRequest?.recordRef}
                        </span>
                      ) : null}
                    </span>
                    <span className="block text-[11px] leading-snug text-muted-foreground">{r.detail}</span>
                  </span>
                </li>
              );
            })}
            {outcome && outcome.status !== 'APPROVED' ? (
              <li className="px-3 py-2 text-[11.5px] text-muted-foreground">
                {outcome.line}. The audit row says who and why.
              </li>
            ) : null}
            {unseen ? (
              <li className="px-3 py-2 text-[11.5px] leading-snug text-muted-foreground">
                Created before this page loaded. If Ask prepared it, its history is on the decision’s own page; if a
                person wrote it on Operations, the request is the record.
              </li>
            ) : null}
          </ol>
        </div>
      </Scene>
    </>
  );
}

/** One scene of the story: a number, a kicker, a headline, one sentence — and the frame it contains. */
function Scene({
  id,
  n,
  kicker,
  title,
  desc,
  children,
  ref,
}: {
  id: string;
  n: string;
  kicker: string;
  title: string;
  desc: string;
  children: ReactNode;
  ref?: Ref<HTMLDivElement>;
}) {
  return (
    <section
      id={id}
      ref={ref}
      className="relative scroll-mt-20 px-[5vw] py-[56px] md:py-[72px]"
      aria-labelledby={`${id}-title`}
    >
      <motion.div
        className="mb-5 grid gap-3 md:grid-cols-2 md:items-end"
        initial={{ opacity: 0, y: 14 }}
        whileInView={{ opacity: 1, y: 0 }}
        viewport={{ once: true, margin: '-64px 0px' }}
        transition={PRESET.reveal}
      >
        <div>
          <p className="flex items-center gap-2 text-[10px] font-bold uppercase tracking-[0.2em] text-copper-2">
            <span className="tabular-nums">{n}</span> · {kicker}
          </p>
          <h2
            id={`${id}-title`}
            className="display mt-3 text-[clamp(30px,3.6vw,50px)] leading-[0.98] tracking-[-0.04em] text-paper"
          >
            {title}
          </h2>
        </div>
        <p className="max-w-[440px] text-[13.5px] leading-relaxed text-muted-foreground md:justify-self-end">{desc}</p>
      </motion.div>
      {children}
    </section>
  );
}
