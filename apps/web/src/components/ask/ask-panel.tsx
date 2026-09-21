'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  AlertTriangle,
  ArrowRight,
  ArrowUp,
  CheckCircle2,
  CircleSlash,
  Loader2,
  Send,
  Sparkles,
  ThumbsDown,
  ThumbsUp,
} from 'lucide-react';
import { motion } from 'motion/react';
import { toast } from 'sonner';
import { Chip } from '@/components/ask/chip';
import { DecisionCard } from '@/components/ask/decision-card';
import { XrayPanel } from '@/components/story/xray';
import { Button } from '@/components/ui/button';
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { Textarea } from '@/components/ui/textarea';
import { createRequestAction, feedbackAction, xrayForSignalAction } from '@/lib/actions';
import { streamAsk } from '@/lib/ask-client';
import type {
  AnswerCard,
  AskAnswer,
  AskEvent,
  AskStatus,
  AskTarget,
  Investigation,
  ProposalSummary,
  Xray,
} from '@/lib/types';
import { PRESET } from '@/lib/motion';
import { cn } from '@/lib/utils';

interface Turn {
  id: string;
  question: string;
  tools: Extract<AskEvent, { type: 'tool' }>[];
  answer: AskAnswer | null;
  card: AnswerCard | null;
  investigation: Investigation | null;
  messageId: string | null;
  verification: { ok: boolean; rejected: number } | null;
  usage: { latencyMs: number; model: string; cacheReadTokens: number } | null;
  proposals: ProposalSummary[];
  error: string | null;
  feedback: 'UP' | 'DOWN' | null;
  /** A line the application wrote, not the assistant: what a click actually did, in the API's words. */
  note: string | null;
}

/** Where the question is asked from: the page, and the record on it. "She", "it", "this" mean that record. */
export interface AskContext {
  path: string | null;
  entityId: string | null;
}

/** A question handed in from outside the panel; a new id asks again even for the same words. */
export interface AskHandoff {
  id: number;
  question: string;
}

const REASON_LABEL: Record<string, string> = {
  NO_RECORD: 'No record',
  FIELD_EMPTY: 'Not recorded',
  ACCESS_DENIED: 'Not visible to your role',
  VETERINARY_JUDGMENT: 'Ask the vet',
  FINANCIAL_ACTION: 'Ask billing',
  OUT_OF_SCOPE: 'Out of scope',
  UNVERIFIABLE: 'Could not verify',
  SENSITIVE_DATA: 'Not stored here',
  SOURCES_DISAGREE: 'Billing review required',
};

const STORAGE_VERSION = 2;

/**
 * The conversation, read the way a person reads it: the question, one sentence back, at most
 * three facts, the doors into the application and the acts a person may approve. The tools
 * that ran, the statements with their evidence and the summary sit behind a click. A door
 * opens the record at the part that matters, or peeks at the x-ray beside the conversation;
 * an approval runs the rule-checked service and the assistant then reads what actually stands.
 * Used inside the shell's dock, on the story page and on the landing; the wire format is one.
 */
export function AskPanel({
  suggestions,
  status,
  autoFocus = false,
  className,
  onAnswered,
  onEvent,
  onProposal,
  initialQuestion,
  handoff,
  context,
  persistKey,
}: {
  suggestions: string[];
  status: AskStatus | null;
  autoFocus?: boolean;
  className?: string;
  onAnswered?: () => void;
  /** Every streamed event of a turn, and a 'start' when a question is sent — for a diagram that plays the run. */ onEvent?: (
    event: AskEvent | { type: 'start'; question: string },
  ) => void;
  onProposal?: (status: 'APPROVED' | 'DECLINED') => void;
  initialQuestion?: string;
  handoff?: AskHandoff | null;
  /** What "she" or "this" means: the record on the page. */ context?: AskContext | null;
  /** Keeps the conversation across pages in this browser tab. */ persistKey?: string;
}) {
  const router = useRouter();
  const [turns, setTurns] = useState<Turn[]>([]);
  const [question, setQuestion] = useState('');
  const [busy, setBusy] = useState(false);
  const [peek, setPeek] = useState<{ signalId: string; xray: Xray | null; error: string | null } | null>(null);
  const conversationRef = useRef<string | null>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const answered = useRef(onAnswered);
  const eventListener = useRef(onEvent);
  const proposalListener = useRef(onProposal);
  const contextRef = useRef(context ?? null);
  const asked = useRef<string | null>(null);
  const handled = useRef<number | null>(null);
  const restored = useRef(false);
  useEffect(() => {
    answered.current = onAnswered;
    eventListener.current = onEvent;
    proposalListener.current = onProposal;
    contextRef.current = context ?? null;
  });

  // The conversation survives a page change in this tab: the turns and the thread id, nothing more.
  useEffect(() => {
    if (!persistKey || restored.current) return;
    restored.current = true;
    try {
      const raw = sessionStorage.getItem(persistKey);
      const saved = raw ? (JSON.parse(raw) as { v: number; turns: Turn[]; conversationId: string | null }) : null;
      if (saved && saved.v === STORAGE_VERSION) {
        setTurns(saved.turns);
        conversationRef.current = saved.conversationId;
      }
    } catch {
      /* storage unavailable: the conversation lives as long as the page */
    }
  }, [persistKey]);
  useEffect(() => {
    if (!persistKey || !restored.current) return;
    try {
      sessionStorage.setItem(
        persistKey,
        JSON.stringify({ v: STORAGE_VERSION, turns: turns.slice(-12), conversationId: conversationRef.current }),
      );
    } catch {
      /* ignore */
    }
  }, [turns, persistKey]);

  const submit = useCallback(
    async (text: string) => {
      const q = text.trim();
      if (!q || busy) return;
      setQuestion('');
      setBusy(true);
      const id = `${Date.now()}`;
      setTurns((t) => [
        ...t,
        {
          id,
          question: q,
          tools: [],
          answer: null,
          card: null,
          investigation: null,
          messageId: null,
          verification: null,
          usage: null,
          proposals: [],
          error: null,
          feedback: null,
          note: null,
        },
      ]);
      eventListener.current?.({ type: 'start', question: q });
      try {
        await streamAsk(
          { question: q, conversationId: conversationRef.current, context: contextRef.current },
          (event) => {
            eventListener.current?.(event);
            setTurns((t) =>
              t.map((turn) => {
                if (turn.id !== id) return turn;
                if (event.type === 'tool') return { ...turn, tools: [...turn.tools, event] };
                if (event.type === 'answer') {
                  conversationRef.current = event.conversationId;
                  return {
                    ...turn,
                    answer: event.answer,
                    card: event.card ?? null,
                    investigation: event.investigation ?? null,
                    messageId: event.messageId,
                    verification: event.verification,
                    proposals: event.proposals ?? [],
                    usage: {
                      latencyMs: event.usage.latencyMs,
                      model: event.usage.model,
                      cacheReadTokens: event.usage.cacheReadTokens,
                    },
                  };
                }
                return { ...turn, error: event.message };
              }),
            );
            if (event.type === 'answer') answered.current?.();
            listRef.current?.scrollTo({ top: listRef.current.scrollHeight });
          },
        );
      } catch (error) {
        setTurns((t) => t.map((turn) => (turn.id === id ? { ...turn, error: (error as Error).message } : turn)));
      } finally {
        setBusy(false);
      }
    },
    [busy],
  );

  useEffect(() => {
    listRef.current?.scrollTo({ top: listRef.current.scrollHeight });
  }, [turns]);

  useEffect(() => {
    if (!initialQuestion || asked.current === initialQuestion) return;
    // Off the render path, and marked as asked only when the timer actually fires: React's
    // development double-mount cleans the first timer up before it runs.
    const timer = setTimeout(() => {
      asked.current = initialQuestion;
      void submit(initialQuestion);
    }, 0);
    return () => clearTimeout(timer);
  }, [initialQuestion, submit]);

  useEffect(() => {
    if (!handoff || handled.current === handoff.id) return;
    const timer = setTimeout(() => {
      handled.current = handoff.id;
      void submit(handoff.question);
    }, 0);
    return () => clearTimeout(timer);
  }, [handoff, submit]);

  const rate = async (turn: Turn, rating: 'UP' | 'DOWN') => {
    if (!turn.messageId) return;
    let correction: string | null = null;
    if (rating === 'DOWN')
      correction =
        window.prompt('What should the answer have said? (optional — this can become a regression test)') ?? null;
    const result = await feedbackAction(turn.messageId, rating, correction);
    if (result.ok) {
      setTurns((t) => t.map((x) => (x.id === turn.id ? { ...x, feedback: rating } : x)));
      toast.success(
        rating === 'UP' ? 'Thanks — recorded.' : 'Recorded. A staff member can turn this into an eval case.',
      );
    } else toast.error(result.error);
  };

  const sendToTeam = async (turn: Turn) => {
    const answer = turn.answer;
    const subject = answer?.suggestedRequest?.subject ?? turn.question.slice(0, 100);
    const body =
      answer?.suggestedRequest?.body ?? `Question: ${turn.question}\n\nAssistant summary: ${answer?.summary ?? ''}`;
    const evidence =
      answer?.suggestedRequest?.evidenceIds ?? Array.from(new Set(answer?.statements.flatMap((s) => s.evidence) ?? []));
    const result = await createRequestAction(subject, body, evidence);
    if (result.ok) toast.success('Sent to the team. It is on the Operations page under Requests.');
    else toast.error(result.error);
  };

  /**
   * The loop closes here: the click ran the rule-checked service, the page refreshes on the
   * event, the application says what it did in the API's own words, and the assistant reads
   * the records again — the request is on record, the mare is still blocked, or not.
   */
  const decideProposal = (
    turn: Turn,
    proposal: ProposalSummary,
    status: string,
    note?: string,
    result?: Record<string, unknown>,
  ) => {
    const subject =
      ['recipId', 'recipientId', 'embryoId']
        .map((k) => proposal.payload[k])
        .find((v): v is string => typeof v === 'string') ?? null;
    const requestId = typeof result?.['requestId'] === 'string' ? (result['requestId'] as string) : null;
    const line =
      status === 'APPROVED'
        ? requestId
          ? `Veterinary request created · ${requestId}`
          : `Approved · ${proposal.spec.label.toLowerCase()} ran`
        : status === 'STALE'
          ? 'Refused as stale · nothing ran'
          : `Declined · nothing ran`;
    setTurns((t) =>
      t.map((x) =>
        x.id === turn.id
          ? {
              ...x,
              note: line,
              proposals: x.proposals.map((p) =>
                p.id === proposal.id ? { ...p, status, rationale: note ?? p.rationale } : p,
              ),
            }
          : x,
      ),
    );
    if (status === 'APPROVED' || status === 'DECLINED') proposalListener.current?.(status);
    router.refresh();
    if (status === 'APPROVED' && subject) void submit(`Is ${subject} still blocked?`);
  };

  const openTarget = async (target: AskTarget) => {
    if (target.peek === 'xray') {
      setPeek({ signalId: target.entityId, xray: null, error: null });
      const result = await xrayForSignalAction(target.entityId);
      setPeek((current) =>
        current && current.signalId === target.entityId
          ? { ...current, xray: result.ok ? result.data : null, error: result.ok ? null : result.error }
          : current,
      );
      return;
    }
    router.push(target.href);
  };

  return (
    <div className={cn('flex min-h-0 flex-col', className)}>
      <div ref={listRef} className="flex-1 space-y-5 overflow-y-auto px-4 py-4">
        {turns.length === 0 ? (
          <div className="space-y-2">
            <p className="eyebrow">Try</p>
            {suggestions.map((s) => (
              <button
                key={s}
                onClick={() => void submit(s)}
                className="block w-full rounded-md border px-3 py-2 text-left text-[13px] hover:bg-muted"
              >
                {s}
              </button>
            ))}
          </div>
        ) : null}
        {turns.map((turn) => (
          <div key={turn.id} className="space-y-2" data-testid="ask-turn">
            <p className="rounded-md bg-muted px-3 py-2 text-[13px]">{turn.question}</p>
            {turn.tools.length > 0 && !turn.answer ? (
              <ul
                className="flex flex-wrap items-center gap-x-2 gap-y-0.5 pl-1 text-[11px] text-muted-foreground"
                aria-label="Tools that ran"
              >
                {turn.tools.map((t, i) => (
                  <motion.li
                    key={i}
                    className="flex items-center gap-1"
                    initial={{ opacity: 0, x: -4 }}
                    animate={{ opacity: 1, x: 0 }}
                    transition={PRESET.row}
                    title={summarizeInput(t.input)}
                  >
                    {t.ok ? <CheckCircle2 className="size-3 text-ok" /> : <CircleSlash className="size-3 text-warn" />}
                    <span className="code">{t.name}</span>
                    <span className="tabular-nums">{t.durationMs} ms</span>
                  </motion.li>
                ))}
              </ul>
            ) : null}
            {!turn.answer && !turn.error ? (
              <p className="flex items-center gap-2 text-[12px] text-muted-foreground">
                <Loader2 className="size-3 animate-spin" /> Looking things up…
                {status?.provider === 'ollama' ? ' (a local model on this machine; it can take a minute)' : ''}
              </p>
            ) : null}
            {turn.error ? <p className="text-[13px] text-critical">{turn.error}</p> : null}
            {turn.answer ? (
              <motion.div
                className="space-y-2"
                initial={{ opacity: 0, y: 6 }}
                animate={{ opacity: 1, y: 0 }}
                transition={PRESET.enter}
              >
                {turn.proposals.length > 0 ? (
                  <p className="text-[13px] leading-snug" data-testid="answer-sentence">
                    {turn.card?.answer || turn.answer.statements[0]?.text || turn.answer.summary}
                  </p>
                ) : (
                  <CardView
                    card={turn.card}
                    answer={turn.answer}
                    investigation={turn.investigation}
                    onAsk={(q) => void submit(q)}
                    onTarget={(t) => void openTarget(t)}
                  />
                )}
                {turn.answer.conflicts.map((c, i) => (
                  <div key={i} className="rounded-md border border-warn/40 bg-warn/5 px-3 py-2 text-[13px]">
                    <p className="flex items-center gap-1.5 font-medium text-warn">
                      <AlertTriangle className="size-3.5" /> Records disagree
                    </p>
                    <p className="mt-1">{c.description}</p>
                    <div className="mt-1 flex flex-wrap gap-1">
                      {c.ids.map((id) => (
                        <Chip key={id} id={id} highlight={c.preferredId === id} />
                      ))}
                    </div>
                  </div>
                ))}
                {turn.answer.abstentions.map((a, i) => (
                  <div key={i} className="rounded-md border border-dashed px-3 py-2 text-[12px] text-muted-foreground">
                    <span className="mr-2 rounded-sm bg-muted px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wider">
                      {REASON_LABEL[a.reason] ?? a.reason}
                    </span>
                    <span>{a.detail ?? a.question}</span>
                  </div>
                ))}
              </motion.div>
            ) : null}
            {turn.proposals.map((p) => (
              <DecisionCard
                key={p.id}
                proposal={p}
                onDecided={(status, note, result) => decideProposal(turn, p, status, note, result)}
                evidenceHref={
                  typeof p.payload['recipId'] === 'string'
                    ? `/horses/${p.payload['recipId'] as string}?focus=departure`
                    : null
                }
              />
            ))}
            {turn.note ? (
              <p
                className="flex items-center gap-1.5 rounded-md border border-ok/40 px-3 py-1.5 text-[12px]"
                data-testid="ask-note"
              >
                <CheckCircle2 className="size-3.5 text-ok" /> {turn.note}
              </p>
            ) : null}
            {turn.answer ? (
              <details className="group text-[12px]">
                <summary
                  className="flex cursor-pointer list-none flex-wrap items-center gap-x-2 text-[11px] text-muted-foreground hover:text-foreground"
                  aria-label="Details of this answer"
                >
                  <span className="underline underline-offset-2">details</span>
                  {turn.tools.map((t, i) => (
                    <span key={i} className="inline-flex items-center gap-1" title={summarizeInput(t.input)}>
                      {t.ok ? (
                        <CheckCircle2 className="size-3 text-ok" />
                      ) : (
                        <CircleSlash className="size-3 text-warn" />
                      )}
                      <span className="code">{t.name}</span>
                    </span>
                  ))}
                  {turn.usage ? (
                    <span>
                      · {(turn.usage.latencyMs / 1000).toFixed(1)} s · {turn.usage.model}
                      {turn.verification && !turn.verification.ok
                        ? ` · ${turn.verification.rejected} unverified claim(s) removed`
                        : ''}
                    </span>
                  ) : null}
                </summary>
                <div className="mt-2 space-y-2 border-l-2 border-border pl-3">
                  {turn.investigation ? (
                    <p className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[11px] text-muted-foreground">
                      {turn.investigation.rulesApplied.map((rule) => (
                        <span
                          key={rule.code}
                          className="inline-flex items-baseline gap-1"
                          title={rule.reason ?? rule.label}
                        >
                          <span className="code">{rule.code}</span>
                          <span className={cn('readout', rule.verdict === 'blocked' ? 'text-warn' : 'text-ok')}>
                            {rule.verdict}
                          </span>
                        </span>
                      ))}
                      <span className="code">· x-ray {turn.investigation.stateHash}</span>
                    </p>
                  ) : null}
                  <Statements answer={turn.answer} />
                  {turn.card?.stateId ? (
                    <p className="code text-[11px] text-muted-foreground">state {turn.card.stateId}</p>
                  ) : null}
                  <div className="flex flex-wrap items-center gap-1.5 pt-1">
                    <Button
                      variant="outline"
                      size="sm"
                      className="h-7 gap-1.5 text-[12px]"
                      onClick={() => void sendToTeam(turn)}
                    >
                      <Send className="size-3" /> Send to team
                    </Button>
                    <Button
                      variant={turn.feedback === 'UP' ? 'secondary' : 'ghost'}
                      size="icon"
                      className="size-7"
                      aria-label="Helpful"
                      onClick={() => void rate(turn, 'UP')}
                    >
                      <ThumbsUp className="size-3.5" />
                    </Button>
                    <Button
                      variant={turn.feedback === 'DOWN' ? 'secondary' : 'ghost'}
                      size="icon"
                      className="size-7"
                      aria-label="Not helpful"
                      onClick={() => void rate(turn, 'DOWN')}
                    >
                      <ThumbsDown className="size-3.5" />
                    </Button>
                    {turn.messageId ? (
                      <Link
                        href={`/runs/${turn.messageId}`}
                        className="ml-auto text-[11px] text-muted-foreground underline underline-offset-2"
                      >
                        the run
                      </Link>
                    ) : null}
                  </div>
                </div>
              </details>
            ) : null}
          </div>
        ))}
      </div>

      <form
        className="border-t p-3"
        onSubmit={(e) => {
          e.preventDefault();
          void submit(question);
        }}
      >
        <div className="flex items-end gap-2">
          <Textarea
            value={question}
            onChange={(e) => setQuestion(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                void submit(question);
              }
            }}
            placeholder="Ask about an embryo, a recip, a contract…"
            autoFocus={autoFocus}
            rows={2}
            className="min-h-0 resize-none text-[13px]"
            disabled={busy}
          />
          <Button type="submit" size="icon" disabled={busy || !question.trim()} aria-label="Ask">
            {busy ? <Loader2 className="size-4 animate-spin" /> : <ArrowUp className="size-4" />}
          </Button>
        </div>
      </form>

      <Sheet open={peek !== null} onOpenChange={(next) => (next ? undefined : setPeek(null))}>
        <SheetContent side="right" className="flex w-full flex-col gap-0 p-0 sm:max-w-[720px]" data-testid="ask-peek">
          <SheetHeader className="border-b px-4 py-3">
            <SheetTitle className="text-[14px]">Why · {peek?.xray?.subject ?? peek?.signalId ?? ''}</SheetTitle>
            <SheetDescription className="text-[12px]">
              The records, the rules that read them, the block, the person — as they stand now.
            </SheetDescription>
          </SheetHeader>
          <div className="flex-1 overflow-y-auto p-3">
            {peek?.xray ? (
              <XrayPanel xray={peek.xray} />
            ) : peek?.error ? (
              <p className="text-[12px] text-critical">{peek.error}</p>
            ) : (
              <p className="flex items-center gap-2 text-[12px] text-muted-foreground">
                <Loader2 className="size-3 animate-spin" /> Reading her records…
              </p>
            )}
            {peek ? (
              <p className="mt-2 text-[11px]">
                <Link href={`/signals/${peek.signalId}`} className="underline underline-offset-2">
                  Open {peek.signalId} on its own page
                </Link>
              </p>
            ) : null}
          </div>
        </SheetContent>
      </Sheet>
    </div>
  );
}

/**
 * The card: the sentence, the facts, the doors, the acts. An investigation's card carries the
 * rules and the person as one quiet line; the graph itself is a click away.
 */
export function CardView({
  card,
  answer,
  investigation,
  onAsk,
  onTarget,
}: {
  card: AnswerCard | null;
  answer: AskAnswer;
  investigation: Investigation | null;
  onAsk: (question: string) => void;
  onTarget: (target: AskTarget) => void;
}) {
  const sentence = card?.answer || answer.statements[0]?.text || answer.summary || '';
  const facts = card?.facts ?? [];
  const targets = card?.targets ?? [];
  const actions = card?.actions ?? [];
  const listed = targets.filter((t) => t.detail !== null);
  const doors = targets.filter((t) => t.detail === null);
  if (!sentence && facts.length === 0 && targets.length === 0 && !card?.view) return null;
  return (
    <section
      className="rounded-md border bg-muted/20 px-3 py-2.5"
      data-testid={investigation ? 'investigation' : 'answer-card'}
      aria-label={investigation ? `Investigation of ${investigation.subject}` : 'Answer'}
    >
      {sentence ? (
        <p
          className="text-[13px] font-medium leading-snug"
          data-testid={investigation ? 'investigation-conclusion' : 'answer-sentence'}
        >
          {sentence}
        </p>
      ) : null}
      {facts.length > 0 ? (
        <dl
          className="mt-2 grid grid-cols-[auto_minmax(0,1fr)] gap-x-4 gap-y-0.5 text-[12px]"
          data-testid="answer-facts"
        >
          {facts.map((f) => (
            <div key={f.label} className="contents">
              <dt className="readout text-muted-foreground">{f.label}</dt>
              <dd className="min-w-0 truncate" title={f.ref ? `${f.value} · ${f.ref}` : f.value}>
                {f.value}
              </dd>
            </div>
          ))}
        </dl>
      ) : null}
      {listed.length > 0 ? (
        <ul className="mt-2 divide-y rounded-md border text-[12px]" data-testid="answer-rows">
          {listed.map((t) => (
            <li key={t.entityId}>
              <button
                type="button"
                onClick={() => onTarget(t)}
                className="flex w-full items-center gap-3 px-2.5 py-1.5 text-left hover:bg-muted"
              >
                <span className="min-w-0 flex-1 truncate">{t.label}</span>
                {t.detail ? (
                  <span
                    className={cn(
                      'shrink-0 tabular-nums text-muted-foreground',
                      t.detail.startsWith('$') && 'money text-foreground',
                    )}
                  >
                    {t.detail}
                  </span>
                ) : null}
                <ArrowRight className="size-3 shrink-0 text-muted-foreground" aria-hidden />
              </button>
            </li>
          ))}
        </ul>
      ) : null}
      {card?.view || doors.length > 0 || actions.length > 0 ? (
        <div className="mt-2 flex flex-wrap gap-1.5" data-testid="investigation-actions">
          {card?.view ? (
            <Link
              href={card.view.href}
              className="inline-flex h-7 items-center gap-1 rounded-md bg-foreground px-2.5 text-[12px] font-medium text-background hover:opacity-90"
              data-testid={`answer-view-${card.view.kind}`}
            >
              {card.view.label} <ArrowRight className="size-3" />
            </Link>
          ) : null}
          {doors.map((t) =>
            t.peek ? (
              <button
                key={`${t.entityId}:${t.label}`}
                type="button"
                onClick={() => onTarget(t)}
                className="inline-flex h-7 items-center gap-1 rounded-md border px-2.5 text-[12px] hover:bg-muted"
                data-testid="answer-peek"
              >
                {t.label}
              </button>
            ) : (
              <Link
                key={`${t.entityId}:${t.label}`}
                href={t.href}
                className="inline-flex h-7 items-center gap-1 rounded-md border px-2.5 text-[12px] hover:bg-muted"
                data-testid="answer-open"
              >
                {t.label} <ArrowRight className="size-3" />
              </Link>
            ),
          )}
          {actions.map((a) => (
            <button
              key={a.action}
              type="button"
              className="inline-flex h-7 items-center gap-1 rounded-md border border-brand/60 px-2.5 text-[12px] font-medium text-brand hover:bg-brand-tint"
              onClick={() => onAsk(a.question)}
              data-testid={`answer-action-${a.action.toLowerCase()}`}
            >
              <Sparkles className="size-3" /> {a.label}
            </button>
          ))}
        </div>
      ) : null}
      {investigation ? (
        <p className="mt-2 text-[10.5px] text-muted-foreground">
          {investigation.rulesApplied.filter((r) => r.verdict === 'blocked').length} of{' '}
          {investigation.rulesApplied.length} rules blocked · waits for{' '}
          {investigation.authority ? investigation.authority.owner.toLowerCase().replace(/_/g, ' ') : 'nobody'}
        </p>
      ) : null}
    </section>
  );
}

function Statements({ answer }: { answer: AskAnswer }) {
  return (
    <div className="space-y-2 text-[12px]">
      {answer.statements.length > 0 ? (
        <ol className="space-y-1.5">
          {answer.statements.map((s, i) => (
            <li key={i}>
              <p className={cn(s.confidence === 'LOW' && 'text-muted-foreground')}>{s.text}</p>
              <div className="mt-0.5 flex flex-wrap gap-1">
                {s.evidence.map((id) => (
                  <Chip key={id} id={id} />
                ))}
                {s.confidence !== 'HIGH' ? (
                  <span className="text-[10px] uppercase tracking-wider text-muted-foreground">
                    {s.confidence.toLowerCase()} confidence
                  </span>
                ) : null}
              </div>
            </li>
          ))}
        </ol>
      ) : null}
      {answer.summary ? <p className="text-muted-foreground">{answer.summary}</p> : null}
    </div>
  );
}

export { Chip };

function summarizeInput(input: unknown): string {
  if (!input || typeof input !== 'object') return '';
  return Object.values(input as Record<string, unknown>)
    .map(String)
    .join(' ');
}
