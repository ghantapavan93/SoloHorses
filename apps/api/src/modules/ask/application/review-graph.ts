import { Injectable, Logger, type OnModuleDestroy, type OnModuleInit } from '@nestjs/common';
import {
  Annotation,
  Command,
  END,
  MemorySaver,
  START,
  StateGraph,
  getWriter,
  interrupt,
  type BaseCheckpointSaver,
} from '@langchain/langgraph';
import { PostgresSaver } from '@langchain/langgraph-checkpoint-postgres';
import type { Actor, AskAnswer } from '@daysheet/domain';
import { EnvService } from '../../../platform/config/env.module';
import type { Investigation } from './ask.tools';
import type { AnswerCard, CardHints } from './card';
import type { PolicyDecision } from './policy';

/**
 * ExceptionReviewGraph — one graph, not a swarm.
 *
 * It orchestrates the review of a question: gate → authorize → evidence and explanation →
 * validate → persist → (if a consequential action was proposed) pause for a person → record
 * the decision → audit. The graph is durable: the pause is a checkpoint in Postgres, and the
 * person's decision resumes it hours later, on any worker.
 *
 * What it does not do: decide. The policy gate is a function; the release rule, the transfer
 * rule and the clearance rule are functions; the domain command a proposal turns into is the
 * same rule-checked service the UI calls (ADR-017). The graph moves state between those and
 * writes down that it did. If LangGraph disappeared tomorrow the rules would not notice.
 */
/** Where the person is asking from: the page, and the record on it. "She", "it", "this" mean that record. */
export interface AskContext {
  path: string | null;
  entityId: string | null;
}

export interface ReviewInput {
  threadId: string;
  actor: Actor;
  actorName: string;
  question: string;
  conversationId: string;
  context: AskContext | null;
  /** The record the question is about when it does not say: the page's, else the conversation's last. */
  subjectId: string | null;
}

export interface Composition {
  answer: AskAnswer;
  toolCalls: {
    name: string;
    input: unknown;
    ok: boolean;
    idsReturned: string[];
    durationMs: number;
    contextVersion: string | null;
  }[];
  seenIds: string[];
  proposalIds: string[];
  usage: { inputTokens: number; outputTokens: number; cacheReadTokens: number };
  model: string;
  contextVersion: string | null;
  servedFromCache: boolean;
  /** Where compose's time went: the tools' round trips and the model's turns. */
  phases: { toolsMs: number; modelMs: number };
  /** The typed result of an x-ray read during composition, when there was one. */
  investigation: Investigation | null;
  /** What the composer knows for the card that the tools' records do not say: a sentence, facts, rows, the view. */
  hints: CardHints | null;
}

/** Milliseconds per stage, as the graph measured them; the flight recorder reads these. */
export type StageTimings = Record<string, number>;

export interface Persisted {
  messageId: string;
  proposals: {
    id: string;
    kind: string;
    status: string;
    payload: Record<string, unknown>;
    rationale: string;
    evidenceIds: string[];
    spec: { label: string; before: string; after: string; willNot: string[]; riskClass: string; approver: string };
  }[];
  /** The answer as the person reads it: one sentence, three facts, the doors, the acts. */
  card: AnswerCard;
}

export interface HumanDecision {
  proposalId: string;
  status: 'APPROVED' | 'DECLINED' | 'STALE';
  decision: string;
  decidedBy: string;
}

/** The stages the graph runs, supplied by the Ask service. Each is plain code the tests already cover. */
export interface ReviewStages {
  gate(question: string): PolicyDecision;
  authorize(actor: Actor): Promise<void>;
  compose(input: ReviewInput, emit: (chunk: ReviewChunk) => void): Promise<Composition>;
  verify(composition: Composition): { answer: AskAnswer; ok: boolean; rejected: number };
  persist(
    input: ReviewInput,
    composition: Composition,
    verified: { answer: AskAnswer; ok: boolean; rejected: number },
    latencyMs: number,
    timings: StageTimings,
  ): Promise<Persisted>;
  recordDecision(input: ReviewInput, decision: HumanDecision, messageId: string): Promise<void>;
}

export type ReviewChunk =
  | { type: 'tool'; name: string; input: unknown; ok: boolean; idsReturned: string[]; durationMs: number }
  | {
      type: 'answer';
      messageId: string;
      conversationId: string;
      answer: AskAnswer;
      verification: { ok: boolean; rejected: number };
      usage: { inputTokens: number; outputTokens: number; cacheReadTokens: number; latencyMs: number; model: string };
      proposals: Persisted['proposals'];
      investigation: Investigation | null;
      card: AnswerCard;
    };

const ReviewState = Annotation.Root({
  input: Annotation<ReviewInput>,
  startedAt: Annotation<number>,
  stage: Annotation<string>,
  policy: Annotation<PolicyDecision | null>,
  composition: Annotation<Composition | null>,
  verified: Annotation<{ answer: AskAnswer; ok: boolean; rejected: number } | null>,
  persisted: Annotation<Persisted | null>,
  needsHuman: Annotation<boolean>,
  decision: Annotation<HumanDecision | null>,
  timings: Annotation<StageTimings>,
});
type ReviewStateType = typeof ReviewState.State;

/** One checkpointer for the process: Postgres in its own schema, memory when there is no database at all. */
@Injectable()
export class ReviewCheckpointer implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(ReviewCheckpointer.name);
  private saver: Promise<BaseCheckpointSaver> | null = null;
  private postgres: PostgresSaver | null = null;

  constructor(private readonly envService: EnvService) {}

  onModuleInit(): void {
    void this.ready();
  }

  async onModuleDestroy(): Promise<void> {
    await this.postgres?.end().catch(() => undefined);
  }

  /** Idempotent: the first caller sets the tables up, later callers share the promise. */
  ready(): Promise<BaseCheckpointSaver> {
    this.saver ??= this.open();
    return this.saver;
  }

  private async open(): Promise<BaseCheckpointSaver> {
    const url = this.envService.env.DATABASE_URL;
    if (!url) return Promise.resolve(new MemorySaver());
    try {
      // Its own schema: the checkpoint tables are the graph's, and Prisma's migration history stays the application's.
      const postgres = PostgresSaver.fromConnString(url, { schema: 'ask_graph' });
      await postgres.setup();
      this.postgres = postgres;
      return postgres;
    } catch (error) {
      this.logger.warn(
        `Postgres checkpointer unavailable (${(error as Error).message}); review threads will not survive a restart`,
      );
      return new MemorySaver();
    }
  }

  get durable(): boolean {
    return this.postgres !== null;
  }
}

export class ExceptionReviewGraph {
  private readonly graph;

  constructor(
    private readonly stages: ReviewStages,
    private readonly saver: BaseCheckpointSaver,
  ) {
    const builder = new StateGraph(ReviewState)
      .addNode('gate', (state: ReviewStateType) => {
        const t0 = Date.now();
        const policy = this.stages.gate(state.input.question);
        return { stage: 'gate', policy, timings: { ...state.timings, gate: Date.now() - t0 } };
      })
      .addNode('authorize', async (state: ReviewStateType) => {
        const t0 = Date.now();
        await this.stages.authorize(state.input.actor);
        return { stage: 'authorize', timings: { ...state.timings, authorize: Date.now() - t0 } };
      })
      .addNode('compose', async (state: ReviewStateType) => {
        const t0 = Date.now();
        const writer = getWriter();
        const composition = await this.stages.compose(state.input, (chunk) => writer?.(chunk));
        return { stage: 'compose', composition, timings: { ...state.timings, compose: Date.now() - t0 } };
      })
      .addNode('verify', (state: ReviewStateType) => {
        const t0 = Date.now();
        const policy = state.policy;
        if (policy && !policy.allowed)
          return {
            stage: 'verify',
            verified: { answer: policy.answer, ok: true, rejected: 0 },
            composition: {
              answer: policy.answer,
              toolCalls: [],
              seenIds: [],
              proposalIds: [],
              usage: { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0 },
              model: 'policy',
              contextVersion: null,
              servedFromCache: false,
              phases: { toolsMs: 0, modelMs: 0 },
              investigation: null,
              hints: null,
            },
            timings: { ...state.timings, verify: Date.now() - t0 },
          };
        if (!state.composition) throw new Error('nothing to verify');
        const verified = this.stages.verify(state.composition);
        return { stage: 'verify', verified, timings: { ...state.timings, verify: Date.now() - t0 } };
      })
      .addNode('persist', async (state: ReviewStateType) => {
        if (!state.composition || !state.verified) throw new Error('nothing to persist');
        const latencyMs = Date.now() - state.startedAt;
        const persisted = await this.stages.persist(
          state.input,
          state.composition,
          state.verified,
          latencyMs,
          state.timings,
        );
        getWriter()?.({
          type: 'answer',
          messageId: persisted.messageId,
          conversationId: state.input.conversationId,
          answer: state.verified.answer,
          verification: { ok: state.verified.ok, rejected: state.verified.rejected },
          usage: {
            ...state.composition.usage,
            latencyMs,
            model: state.composition.servedFromCache ? `${state.composition.model} (cached)` : state.composition.model,
          },
          proposals: persisted.proposals,
          investigation: state.composition.investigation,
          card: persisted.card,
        } satisfies ReviewChunk);
        return { stage: 'persist', persisted, needsHuman: state.composition.proposalIds.length > 0 };
      })
      .addNode('await_human', (state: ReviewStateType) => {
        // The graph stops here, checkpointed. The person's decision — made on the page, executed by the
        // rule-checked service — resumes it with what they decided. Nothing runs until then.
        const decision = interrupt<{ proposalIds: string[]; messageId: string | null }, HumanDecision>({
          proposalIds: state.composition?.proposalIds ?? [],
          messageId: state.persisted?.messageId ?? null,
        });
        return { stage: 'await_human', decision };
      })
      .addNode('record', async (state: ReviewStateType) => {
        if (state.decision && state.persisted)
          await this.stages.recordDecision(state.input, state.decision, state.persisted.messageId);
        return { stage: 'record' };
      })
      .addEdge(START, 'gate')
      .addConditionalEdges(
        'gate',
        (state: ReviewStateType) => (state.policy && !state.policy.allowed ? 'verify' : 'authorize'),
        { verify: 'verify', authorize: 'authorize' },
      )
      .addEdge('authorize', 'compose')
      .addEdge('compose', 'verify')
      .addEdge('verify', 'persist')
      .addConditionalEdges('persist', (state: ReviewStateType) => (state.needsHuman ? 'await_human' : END), {
        await_human: 'await_human',
        [END]: END,
      })
      .addEdge('await_human', 'record')
      .addEdge('record', END);
    this.graph = builder.compile({ checkpointer: this.saver });
  }

  /** Runs a question through the graph, yielding tool chunks as they happen and the answer when it is persisted. */
  async *run(input: ReviewInput): AsyncGenerator<ReviewChunk> {
    const config = { configurable: { thread_id: input.threadId } };
    const stream = await this.graph.stream(
      {
        input,
        startedAt: Date.now(),
        stage: 'start',
        policy: null,
        composition: null,
        verified: null,
        persisted: null,
        needsHuman: false,
        decision: null,
        timings: {},
      },
      { ...config, streamMode: 'custom' },
    );
    for await (const chunk of stream) yield chunk as ReviewChunk;
  }

  /** A person decided; the paused thread continues to its audit row. Unknown or finished threads are ignored. */
  async resume(threadId: string, decision: HumanDecision): Promise<'resumed' | 'not_waiting'> {
    const config = { configurable: { thread_id: threadId } };
    const snapshot = await this.graph.getState(config);
    const waiting = snapshot.tasks.some((t) => (t.interrupts ?? []).length > 0);
    if (!waiting) return 'not_waiting';
    await this.graph.invoke(new Command({ resume: decision }), config);
    return 'resumed';
  }

  /** Where a thread stands, for the trace and the honesty page. */
  async state(threadId: string): Promise<{ stage: string; waiting: boolean; decision: HumanDecision | null } | null> {
    const snapshot = await this.graph.getState({ configurable: { thread_id: threadId } });
    const values = snapshot.values as Partial<ReviewStateType> | undefined;
    if (!values || Object.keys(values).length === 0) return null;
    return {
      stage: values.stage ?? 'start',
      waiting: snapshot.tasks.some((t) => (t.interrupts ?? []).length > 0),
      decision: values.decision ?? null,
    };
  }
}
