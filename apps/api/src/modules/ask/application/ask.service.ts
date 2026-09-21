import {
  BadRequestException,
  ForbiddenException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
  Optional,
  UnauthorizedException,
  type OnModuleInit,
} from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import Anthropic from '@anthropic-ai/sdk';
import { can, citedIds, screenMemory, verifyEvidence, type Actor, type AskAnswer } from '@daysheet/domain';
import type { Prisma } from '@daysheet/db';
import { AuditService } from '../../../platform/audit/audit.service';
import { EventDispatcher } from '../../../platform/events/event-dispatcher';
import { type DomainEventRecord } from '../../../platform/events/domain-event';
import { OperationsEvents, type ProposalDecidedPayload } from '../../operations/domain/events';
import { ClockService } from '../../../platform/clock/clock.service';
import { PrismaService } from '../../../platform/persistence/prisma.service';
import { EnvService } from '../../../platform/config/env.module';
import { CacheService } from '../../../platform/cache/cache.service';
import { ProposalsService } from '../../operations/application/proposals.service';
import { RequestsService } from '../../operations/application/requests.service';
import { LOCAL_INSTRUCTIONS, PROMPT_VERSION, STABLE_INSTRUCTIONS, turnPreamble } from './ask.prompt';
import {
  AskTools,
  TOOL_DEFINITIONS,
  TOOL_VERSIONS,
  investigationOf,
  type Investigation,
  type ToolCallRecord,
} from './ask.tools';
import {
  addUsage,
  AnthropicModel,
  OllamaModel,
  OpenAiCompatibleModel,
  probeOllama,
  probeOpenAiCompatible,
  type ChatMessage,
  type ModelClient,
  type ModelPort,
  type ToolResult,
} from './model-port';
import { buildCard, type AnswerCard, type CardHints } from './card';
import { flightRecord, type FlightInput, type FlightRecord } from './flight';
import { OfflineAnswerer } from './offline-answerer';
import { refusedCapabilityFor, screenQuestion } from './policy';
import { combineVersions, hash } from './projection';
import {
  ExceptionReviewGraph,
  ReviewCheckpointer,
  type AskContext,
  type Composition,
  type ReviewChunk,
  type ReviewInput,
  type ReviewStages,
  type StageTimings,
} from './review-graph';

/**
 * One question → tools → a verified, structured answer.
 *
 * The loop is manual on purpose: it is short, every step is visible, and the approval
 * question never arises because nothing here can mutate anything. The model's JSON is
 * validated by Zod, then every cited code is checked against the codes the tools actually
 * returned; anything else is downgraded to an abstention before a person sees it.
 *
 * Order of operations for one question:
 *   authorization (the guard) → policy (deterministic abstentions, no tokens) → tools over
 *   projections → model → schema validation → evidence verification → policy again (the
 *   verifier) → the UI. Every answer records the prompt version, the tool versions and a
 *   hash of the state the tools saw, so "why did it say that yesterday" is answerable.
 *
 * Caching: the same question, role, model and prompt version is served from cache only
 * when replaying its tool calls yields the same state hash. New operational state means a
 * new answer, no matter how identical the prompt.
 */

const ANSWER_CACHE_TTL_MS = 60 * 60_000;

interface CachedAnswer {
  answer: AskAnswer;
  toolCalls: { name: string; input: unknown }[];
  contextVersion: string;
  messageId: string;
}

export type AskEvent =
  | { type: 'tool'; name: string; input: unknown; ok: boolean; idsReturned: string[]; durationMs: number }
  | {
      type: 'answer';
      messageId: string;
      conversationId: string;
      answer: AskAnswer;
      verification: { ok: boolean; rejected: number };
      usage: { inputTokens: number; outputTokens: number; cacheReadTokens: number; latencyMs: number; model: string };
      proposals: ProposalSummary[];
      investigation: Investigation | null;
      card: AnswerCard;
    }
  | { type: 'error'; message: string };

export interface ProposalSummary {
  id: string;
  kind: string;
  status: string;
  payload: Record<string, unknown>;
  rationale: string;
  evidenceIds: string[];
  /** The catalog's words for the kind: what a yes changes, and what it will never do. */
  spec: { label: string; before: string; after: string; willNot: string[]; riskClass: string; approver: string };
}

/** Injection token for a substitute model client (tests script the model's turns). */
export const ANTHROPIC_CLIENT = Symbol('ANTHROPIC_CLIENT');

export type { ModelClient } from './model-port';

const MAX_TOOL_ROUNDS = 6;

/** "hi", "ok", "thanks": a line back, no tools, no row. Anything with a record, a question mark or more than three words is a question. */
function smallTalkReply(question: string): string | null {
  const q = question
    .trim()
    .toLowerCase()
    .replace(/[!.]+$/g, '');
  if (/^(hi|hello|hey|yo|good (morning|afternoon|evening))( there)?( ask)?$/.test(q))
    return 'Ask about a mare, an embryo, a payment, a lot, or the day — "why can\'t R-0037 leave?", "what needs the vet?".';
  if (/^(ok|okay|k|thanks|thank you|thx|cool|great|got it|nice|👍)$/.test(q))
    return 'Anytime. Ask about the next thing when it comes up.';
  return null;
}

/** A record code, as the ids module spells them: the only thing a page's context may name. */
const ENTITY_CODE = /^(E|R|H|SS|INV|PAY|TR|CHK|C|OX|LOT|DOC|CLR|RQ)-(?:\d{2}-)?\d{4,6}$/;

// Approximate list prices for the spend cap. Cents per 1M tokens. A local model costs nothing.
const PRICE_PER_MILLION_CENTS: Record<string, { input: number; output: number }> = {
  'claude-opus-5': { input: 500, output: 2_500 },
  'claude-sonnet-5': { input: 200, output: 1_000 },
  'claude-haiku-4-5': { input: 100, output: 500 },
};
const FREE = { input: 0, output: 0 };
const priceOf = (model: string) =>
  PRICE_PER_MILLION_CENTS[model] ??
  (model.startsWith('ollama/') || model.startsWith('hosted/') ? FREE : PRICE_PER_MILLION_CENTS['claude-opus-5']!);

/** What a turn cost, in cents, from the model's list price; a local model costs nothing and says so. */
export function estimateCostCents(model: string, usage: { inputTokens: number; outputTokens: number }): number {
  const price = priceOf(model);
  return (usage.inputTokens * price.input + usage.outputTokens * price.output) / 1_000_000;
}

@Injectable()
export class AskService implements OnModuleInit {
  private readonly logger = new Logger(AskService.name);
  /** Who answers: the Anthropic API, a local Ollama model, or nobody (the deterministic offline answerer). Ollama is decided at boot. */
  private port: ModelPort | null;
  private graph: ExceptionReviewGraph | null = null;

  constructor(
    private readonly envService: EnvService,
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly clock: ClockService,
    private readonly tools: AskTools,
    private readonly cache: CacheService,
    private readonly proposals: ProposalsService,
    private readonly requests: RequestsService,
    private readonly checkpointer: ReviewCheckpointer,
    private readonly dispatcher: EventDispatcher,
    @Optional() @Inject(ANTHROPIC_CLIENT) injectedClient?: ModelClient,
  ) {
    const { ANTHROPIC_API_KEY: key, ANTHROPIC_MODEL: model, ASK_PROVIDER: provider } = envService.env;
    if (injectedClient) this.port = new AnthropicModel(injectedClient, model);
    else if (key.length > 0 && (provider === 'auto' || provider === 'anthropic'))
      this.port = new AnthropicModel(new Anthropic({ apiKey: key, maxRetries: 2, timeout: 90_000 }), model);
    else this.port = null;
  }

  private get db() {
    return this.prisma.client;
  }

  get live(): boolean {
    return this.port !== null;
  }

  get model(): string {
    return this.port?.model ?? 'offline';
  }

  get provider(): 'anthropic' | 'ollama' | 'openai' | 'offline' {
    return this.port?.provider ?? 'offline';
  }

  async onModuleInit(): Promise<void> {
    await this.connectRemote();
    // A person decided on a proposal: the paused review thread continues to its audit row.
    this.dispatcher.register({
      name: 'ask.review-resume',
      events: [OperationsEvents.ProposalDecided],
      handle: async (event: DomainEventRecord<ProposalDecidedPayload>) => {
        const { askMessageId, proposalId, status, decision, decidedBy } = event.payload;
        if (!askMessageId) return;
        const outcome = await (
          await this.reviewGraph()
        ).resume(askMessageId, { proposalId, status, decision, decidedBy });
        if (outcome === 'not_waiting')
          this.logger.log(`proposal ${proposalId}: review thread ${askMessageId} was not waiting; nothing to resume`);
      },
    });
  }

  /**
   * No Anthropic key: a hosted OpenAI-style endpoint with a key comes first (a free-tier 70B
   * answers better than a laptop's 4B), then a local Ollama server if it is there and its model
   * can call tools, else the deterministic offline answerer. Under test the offline answerer
   * stays the default, so a laptop with a model pulled does not change what a spec asserts.
   */
  private async connectRemote(): Promise<void> {
    const env = this.envService.env;
    const provider = env.ASK_PROVIDER;
    if (this.port || provider === 'offline' || provider === 'anthropic') {
      if (!this.port)
        this.logger.warn('Ask answers offline with the deterministic answerer (no key, or ASK_PROVIDER=offline).');
      return;
    }
    if (provider === 'auto' && env.NODE_ENV === 'test') return;

    const hosted = {
      baseUrl: env.OPENAI_COMPAT_BASE_URL,
      apiKey: env.OPENAI_COMPAT_API_KEY,
      model: env.OPENAI_COMPAT_MODEL,
    };
    if ((provider === 'openai' || provider === 'auto') && hosted.baseUrl && hosted.apiKey && hosted.model) {
      const probe = await probeOpenAiCompatible(hosted.baseUrl, hosted.apiKey);
      if (probe.ok) {
        this.port = new OpenAiCompatibleModel(hosted);
        this.logger.log(
          `Ask answers on a hosted model: ${hosted.model} at ${hosted.baseUrl} (tool calls, then a JSON answer).`,
        );
        return;
      }
      this.logger.warn(`Hosted model not used (${probe.reason}).`);
      if (provider === 'openai') return this.logger.warn('Ask answers offline with the deterministic answerer.');
    } else if (provider === 'openai') {
      return this.logger.warn(
        'ASK_PROVIDER=openai needs OPENAI_COMPAT_BASE_URL, OPENAI_COMPAT_API_KEY and OPENAI_COMPAT_MODEL — Ask answers offline.',
      );
    }

    const probe = await probeOllama(env.OLLAMA_URL, env.OLLAMA_MODEL);
    if (!probe.ok) {
      this.logger.warn(`Ollama not used (${probe.reason}) — Ask answers offline with the deterministic answerer.`);
      return;
    }
    this.port = new OllamaModel({ url: env.OLLAMA_URL, model: env.OLLAMA_MODEL, numCtx: env.OLLAMA_NUM_CTX });
    this.logger.log(
      `Ask answers on a local model: ${env.OLLAMA_MODEL} at ${env.OLLAMA_URL} (free; tool calls, then a schema-constrained answer).`,
    );
  }

  /** The graph orchestrates the stages below; every stage is the same code the specs cover. Built once the checkpointer is ready. */
  private async reviewGraph(): Promise<ExceptionReviewGraph> {
    this.graph ??= new ExceptionReviewGraph(this.stages(), await this.checkpointer.ready());
    return this.graph;
  }

  /** Whether the review graph survives a restart: Postgres checkpoints, or memory. */
  get durableReview(): boolean {
    return this.checkpointer.durable;
  }

  /** Where a review thread stands (the assistant message id is the thread id). */
  async reviewState(messageId: string) {
    return (await this.reviewGraph()).state(messageId);
  }

  /** Streams progress events, then the final verified answer. `context` is the page the question comes from. */
  async *ask(
    actor: Actor,
    question: string,
    conversationId: string | null,
    context: AskContext | null = null,
  ): AsyncGenerator<AskEvent> {
    // A greeting or an "ok" is not a question: it gets a line back and leaves no run behind.
    const smallTalk = smallTalkReply(question);
    if (smallTalk) {
      const answer: AskAnswer = { statements: [], abstentions: [], conflicts: [], summary: smallTalk };
      yield {
        type: 'answer',
        messageId: '',
        conversationId: conversationId ?? '',
        answer,
        verification: { ok: true, rejected: 0 },
        usage: { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, latencyMs: 0, model: 'none' },
        proposals: [],
        investigation: null,
        card: { answer: smallTalk, facts: [], targets: [], actions: [], view: null, stateId: null, subject: null },
      };
      return;
    }
    const user = await this.db.user.findUnique({ where: { id: actor.userId } });
    // A valid token for a user that no longer exists: the world was reseeded under a live session.
    if (!user) throw new UnauthorizedException('this session refers to a user that no longer exists; sign in again');
    const conversation = conversationId
      ? await this.db.askConversation.findFirst({
          where: { id: conversationId, userId: actor.userId },
          select: { id: true },
        })
      : null;
    if (conversationId && !conversation) throw new ForbiddenException('conversation not found for this user');
    const conv =
      conversation ?? (await this.db.askConversation.create({ data: { userId: actor.userId }, select: { id: true } }));
    // What "she", "it" or "this" means: the record on the page, else the one the conversation was last about.
    const subjectId =
      (context?.entityId && ENTITY_CODE.test(context.entityId) ? context.entityId : null) ??
      (conversation ? await this.lastSubject(conv.id) : null);
    await this.db.askMessage.create({ data: { conversationId: conv.id, role: 'USER', content: question } });
    const graph = await this.reviewGraph();
    // The thread id is the assistant message's id: a proposal points at the message, and the message names the thread.
    const input: ReviewInput = {
      threadId: `ask_${randomUUID().replace(/-/g, '').slice(0, 20)}`,
      actor,
      actorName: user.name,
      question,
      conversationId: conv.id,
      context,
      subjectId,
    };
    for await (const chunk of graph.run(input)) yield chunk;
  }

  /**
   * The record the conversation was last about: the one the latest answer's tools were called
   * with. Kept at the conversation, never in memory — the records stay the source of truth.
   */
  private async lastSubject(conversationId: string): Promise<string | null> {
    const last = await this.db.askMessage.findFirst({
      where: { conversationId, role: 'ASSISTANT' },
      orderBy: { createdAt: 'desc' },
      select: { toolCalls: true, evidenceIds: true },
    });
    if (!last) return null;
    const calls = Array.isArray(last.toolCalls) ? (last.toolCalls as { input?: unknown }[]) : [];
    for (const call of calls) {
      const input = call.input as Record<string, unknown> | null | undefined;
      for (const key of ['recipId', 'recipientId', 'id', 'embryoId', 'lotId', 'entityId']) {
        const value = input?.[key];
        if (typeof value === 'string' && ENTITY_CODE.test(value)) return value;
      }
    }
    return last.evidenceIds.find((id) => ENTITY_CODE.test(id)) ?? null;
  }

  // ───────────────────────────── the graph's stages ─────────────────────────────

  private stages(): ReviewStages {
    return {
      gate: (question) => screenQuestion(question),
      authorize: (actor) => {
        if (!actor.userId) throw new UnauthorizedException('no actor');
        return Promise.resolve();
      },
      compose: (input, emit) => this.compose(input, emit),
      verify: (composition) => {
        const verification = verifyEvidence(composition.answer, new Set(composition.seenIds));
        if (!verification.ok)
          this.logger.warn(
            `verifier rejected ${verification.rejectedStatements.length} statement(s) and ${verification.rejectedConflicts} conflict(s)`,
          );
        return {
          answer: verification.answer,
          ok: verification.ok,
          rejected: verification.rejectedStatements.length + verification.rejectedConflicts,
        };
      },
      persist: (input, composition, verified, latencyMs, timings) =>
        this.persist(input, composition, verified, latencyMs, timings),
      recordDecision: async (input, decision, messageId) => {
        await this.audit.record({
          actor: null,
          source: 'AI',
          action: 'ask.review.decided',
          entityType: 'AskMessage',
          entityId: messageId,
          after: {
            proposalId: decision.proposalId,
            status: decision.status,
            decision: decision.decision,
            decidedBy: decision.decidedBy,
            question: input.question.slice(0, 200),
          },
        });
      },
    };
  }

  /** Offline, capped, cached or the model: one composition, the tools' evidence attached. */
  private async compose(input: ReviewInput, emit: (chunk: ReviewChunk) => void): Promise<Composition> {
    const { actor, question } = input;
    const none = { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0 };
    const toRecords = (calls: ToolCallRecord[]) =>
      calls.map((t) => ({
        name: t.name,
        input: t.input,
        ok: t.ok,
        idsReturned: t.idsReturned,
        durationMs: t.durationMs,
        contextVersion: t.contextVersion,
      }));

    if (!this.port) {
      // No model: the same tools, a deterministic composer, the same answer shape — and the same verifier.
      const storyRecipId =
        ((await this.db.setting.findUnique({ where: { key: 'story' } }))?.value as { recipId?: string } | null)
          ?.recipId ?? null;
      const offline = await new OfflineAnswerer(this.tools).answer(actor, question, {
        storyRecipId,
        subjectId: input.subjectId,
      });
      for (const record of offline.toolCalls)
        emit({
          type: 'tool',
          name: record.name,
          input: record.input,
          ok: record.ok,
          idsReturned: record.idsReturned,
          durationMs: record.durationMs,
        });
      const toolsMs = offline.toolCalls.reduce((sum, t) => sum + t.durationMs, 0);
      return {
        answer: offline.answer,
        toolCalls: toRecords(offline.toolCalls),
        seenIds: offline.toolCalls.flatMap((t) => t.idsReturned),
        proposalIds: offline.proposalIds,
        usage: none,
        phases: { toolsMs, modelMs: 0 },
        investigation: offline.investigation ?? null,
        hints: offline.hints ?? null,
        model: offline.handled ? 'offline-deterministic' : 'offline',
        contextVersion: combineVersions(offline.toolCalls.map((t) => t.contextVersion ?? 'error')),
        servedFromCache: false,
      };
    }

    if (this.port.costsMoney) {
      const cap = await this.checkSpendCap();
      if (!cap.ok) {
        const capped = this.cappedAnswer(cap.spentCents, cap.capCents);
        return {
          answer: capped,
          toolCalls: [],
          seenIds: [],
          proposalIds: [],
          usage: none,
          phases: { toolsMs: 0, modelMs: 0 },
          investigation: null,
          hints: null,
          model: 'capped',
          contextVersion: null,
          servedFromCache: false,
        };
      }
    }

    const conv = await this.db.askConversation.findUniqueOrThrow({
      where: { id: input.conversationId },
      include: { messages: { orderBy: { createdAt: 'asc' }, take: 20 } },
    });

    // Same question, same role, same prompt: reuse the answer only if the records it read are unchanged.
    const cacheKey = `ask:answer:${hash([actor.role, actor.customerId ?? '', this.model, PROMPT_VERSION, question.trim().toLowerCase()].join('|'))}`;
    if (conv.messages.length <= 1) {
      const hit = await this.cache.get<CachedAnswer>(cacheKey);
      const cached = hit?.value ?? null;
      if (cached) {
        const replayed: string[] = [];
        const seen: string[] = [];
        for (const call of cached.toolCalls) {
          const { record } = await this.tools.execute(actor, call.name, call.input);
          replayed.push(record.contextVersion ?? 'error');
          seen.push(...record.idsReturned);
        }
        if (combineVersions(replayed) === cached.contextVersion) {
          return {
            answer: cached.answer,
            toolCalls: [],
            seenIds: [...seen, ...citedIds(cached.answer)],
            proposalIds: [],
            usage: none,
            phases: { toolsMs: 0, modelMs: 0 },
            investigation: null,
            hints: null,
            model: this.model,
            contextVersion: cached.contextVersion,
            servedFromCache: true,
          };
        }
        await this.cache.invalidate(cacheKey); // the world moved on; the old answer must not be served again
      }
    }

    const [memories, corrections] = await Promise.all([
      this.db.askMemory.findMany({
        where: {
          OR: [{ scope: 'ORG' }, { scope: 'USER', userId: actor.userId }],
          AND: [{ OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }] }],
        },
        orderBy: { updatedAt: 'desc' },
        take: 12,
      }),
      this.db.askFeedback.findMany({
        where: { rating: 'DOWN', correction: { not: null }, promotedToEvalCaseId: { not: null } },
        orderBy: { createdAt: 'desc' },
        take: 6,
      }),
    ]);

    const preamble = turnPreamble({
      actor,
      actorName: input.actorName,
      today: this.clock.today(),
      page: input.context?.path ?? null,
      subjectId: input.subjectId,
      memories: memories.map((m) => ({ key: m.key, value: m.value, scope: m.scope })),
      corrections: corrections.map((c) => c.correction ?? '').filter(Boolean),
    });

    // Prior turns of this conversation, as plain text (tool traffic is not replayed); the just-saved USER row is the question itself.
    const messages: ChatMessage[] = conv.messages
      .slice(0, -1)
      .map((m): ChatMessage =>
        m.role === 'USER' ? { role: 'user', text: m.content } : { role: 'assistant', text: m.content },
      );
    messages.push({ role: 'user', text: `${preamble}\n\nQuestion: ${question}` });

    const seenIds = new Set<string>();
    const toolCalls: ToolCallRecord[] = [];
    const proposalIds: string[] = [];
    let usage = { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0 };
    let final: AskAnswer | null = null;
    let modelMs = 0;
    let investigation: Investigation | null = null;

    // The same rules either way; a local or hosted open model gets them in a quarter of the tokens and with the two-step process spelled out.
    const system = this.port.provider === 'anthropic' ? STABLE_INSTRUCTIONS : LOCAL_INSTRUCTIONS;
    for (let round = 0; round <= MAX_TOOL_ROUNDS; round += 1) {
      const turnStarted = Date.now();
      const turn = await this.port.turn({ system, messages, tools: TOOL_DEFINITIONS });
      modelMs += Date.now() - turnStarted;
      usage = addUsage(usage, turn.usage);

      if (turn.stop === 'refusal') {
        final = this.abstainOnly('OUT_OF_SCOPE', 'The model declined to answer this question.');
        break;
      }

      if (turn.stop === 'tool_use' && turn.toolCalls.length > 0) {
        messages.push({ role: 'assistant_tool_calls', text: turn.text, calls: turn.toolCalls, raw: turn.raw });
        const results: ToolResult[] = [];
        for (const call of turn.toolCalls) {
          const { result, record } = await this.tools.execute(actor, call.name, call.input);
          for (const id of record.idsReturned) seenIds.add(id);
          toolCalls.push(record);
          if (
            record.name === 'proposeAction' &&
            record.ok &&
            typeof result === 'object' &&
            result !== null &&
            'proposalId' in result
          )
            proposalIds.push(String(result.proposalId));
          if (record.ok) investigation = investigationOf(record.name, result) ?? investigation;
          emit({
            type: 'tool',
            name: record.name,
            input: record.input,
            ok: record.ok,
            idsReturned: record.idsReturned,
            durationMs: record.durationMs,
          });
          results.push({
            callId: call.id,
            name: call.name,
            content: JSON.stringify({
              DATA_NOT_INSTRUCTIONS: true,
              ...(typeof result === 'object' && result !== null ? result : { value: result }),
            }),
            isError: !record.ok,
          });
        }
        messages.push({ role: 'tool_results', results });
        continue;
      }

      if (!turn.parsed) {
        // What came back is worth a line in the log: a local model's near-miss is how the prompt gets fixed.
        const sample = typeof turn.raw === 'string' ? turn.raw : JSON.stringify(turn.raw);
        this.logger.warn(
          `${this.port.model} returned no usable answer (${turn.stop}): ${(sample ?? '').slice(0, 800)}`,
        );
      }
      final =
        turn.parsed ??
        this.abstainOnly(
          'UNVERIFIABLE',
          turn.stop === 'max_tokens'
            ? 'The answer ran too long to finish.'
            : 'The model did not return a usable answer.',
        );
      break;
    }

    if (!final) final = this.abstainOnly('UNVERIFIABLE', 'Too many lookups without an answer.');
    // The model's path: the view follows the tools it reached for, so the workspace still moves.
    const moneyId = toolCalls.find((t) => t.name === 'getMoneyTrail' && t.ok)?.input as { id?: string } | undefined;
    const hints: CardHints | null = moneyId?.id ? { view: { kind: 'money-trail', id: moneyId.id } } : null;
    return {
      answer: final,
      toolCalls: toRecords(toolCalls),
      seenIds: [...seenIds],
      proposalIds,
      usage,
      phases: { toolsMs: toolCalls.reduce((sum, t) => sum + t.durationMs, 0), modelMs },
      investigation,
      hints,
      model: this.model,
      contextVersion: combineVersions(toolCalls.map((t) => t.contextVersion ?? 'error')),
      servedFromCache: false,
    };
  }

  /** The assistant message, the cache entry and the proposals' stamp — the thread id is the message id. */
  private async persist(
    input: ReviewInput,
    composition: Composition,
    verified: { answer: AskAnswer; ok: boolean; rejected: number },
    latencyMs: number,
    timings: StageTimings,
  ) {
    const measured = Object.values(timings).reduce((sum, ms) => sum + ms, 0);
    // The card is built before the row so the row carries it: what the person read is what was stored.
    const proposalRows = await this.proposalSummaries(composition.proposalIds);
    const card = buildCard({
      question: input.question,
      answer: verified.answer,
      investigation: composition.investigation,
      toolCalls: composition.toolCalls,
      proposals: proposalRows,
      actor: input.actor,
      subjectId: input.subjectId,
      stateId: composition.contextVersion,
      hints: composition.hints,
    });
    // Compose is the tools, the model and what is left (the prompt, the composer, the cache); the rest of the run is the graph's own stages.
    const phases = {
      ...timings,
      tools: composition.phases.toolsMs,
      model: composition.phases.modelMs,
      composeOther: Math.max(0, (timings['compose'] ?? 0) - composition.phases.toolsMs - composition.phases.modelMs),
      overhead: Math.max(0, latencyMs - measured),
      total: latencyMs,
      verified: verified.ok,
      rejected: verified.rejected,
    };
    const saved = await this.db.askMessage.create({
      data: {
        id: input.threadId,
        conversationId: input.conversationId,
        role: 'ASSISTANT',
        content: renderPlainText(verified.answer),
        structured: { ...verified.answer, card } as unknown as Prisma.InputJsonValue,
        evidenceIds: citedIds(verified.answer),
        toolCalls: composition.toolCalls as unknown as Prisma.InputJsonValue,
        model: composition.model,
        inputTokens: composition.usage.inputTokens,
        outputTokens: composition.usage.outputTokens,
        latencyMs,
        promptVersion: PROMPT_VERSION,
        toolVersions: TOOL_VERSIONS,
        contextVersion: composition.contextVersion,
        servedFromCache: composition.servedFromCache,
        phases,
      },
    });
    // An answer that created a proposal is never served from cache: proposing twice is a second row.
    const firstTurn = (await this.db.askMessage.count({ where: { conversationId: input.conversationId } })) <= 2;
    if (
      this.port &&
      firstTurn &&
      composition.toolCalls.length > 0 &&
      verified.ok &&
      composition.proposalIds.length === 0 &&
      !composition.servedFromCache &&
      composition.contextVersion
    ) {
      const cacheKey = `ask:answer:${hash([input.actor.role, input.actor.customerId ?? '', this.model, PROMPT_VERSION, input.question.trim().toLowerCase()].join('|'))}`;
      const entry: CachedAnswer = {
        answer: verified.answer,
        toolCalls: composition.toolCalls.map((t) => ({ name: t.name, input: t.input })),
        contextVersion: composition.contextVersion,
        messageId: saved.id,
      };
      await this.cache.set(cacheKey, entry, ANSWER_CACHE_TTL_MS, composition.contextVersion);
    }
    await this.proposals.stamp(composition.proposalIds, saved.id);
    return { messageId: saved.id, proposals: proposalRows, card };
  }

  private async proposalSummaries(ids: string[]): Promise<ProposalSummary[]> {
    const rows = await this.proposals.byIds(ids);
    return rows.map((r) => ({
      id: r.id,
      kind: r.kind,
      status: r.status,
      payload: r.payload as Record<string, unknown>,
      rationale: r.rationale,
      evidenceIds: r.evidenceIds,
      spec: {
        label: r.spec.label,
        before: r.spec.before,
        after: r.spec.after,
        willNot: r.spec.willNot,
        riskClass: r.spec.riskClass,
        approver: r.spec.approver,
      },
    }));
  }

  /** The non-streaming form used by the eval runner. */
  async askOnce(
    actor: Actor,
    question: string,
  ): Promise<{
    answer: AskAnswer;
    toolCalls: string[];
    usage: { inputTokens: number; outputTokens: number; latencyMs: number };
    messageId: string;
  }> {
    let answer: AskAnswer | null = null;
    const toolCalls: string[] = [];
    let usage = { inputTokens: 0, outputTokens: 0, latencyMs: 0 };
    let messageId = '';
    for await (const event of this.ask(actor, question, null)) {
      if (event.type === 'tool') toolCalls.push(event.name);
      if (event.type === 'answer') {
        answer = event.answer;
        usage = {
          inputTokens: event.usage.inputTokens,
          outputTokens: event.usage.outputTokens,
          latencyMs: event.usage.latencyMs,
        };
        messageId = event.messageId;
      }
      if (event.type === 'error') throw new Error(event.message);
    }
    if (!answer) throw new Error('no answer produced');
    return { answer, toolCalls, usage, messageId };
  }

  // ───────────────────────────── persistence ─────────────────────────────

  async conversation(actor: Actor, id: string) {
    const conv = await this.db.askConversation.findFirst({
      where: { id, userId: actor.userId },
      include: { messages: { orderBy: { createdAt: 'asc' }, include: { feedback: true } } },
    });
    if (!conv) throw new NotFoundException('conversation not found');
    return conv;
  }

  /**
   * The newest answer, reduced to what a diagram of the boundary needs: the tools it reached
   * for in order, whether the gate refused it and on which strand, and whether it proposed.
   * Anyone may see it — it names tools and a question, never a record's contents.
   */
  async lastRun() {
    const row = await this.db.askMessage.findFirst({
      where: { role: 'ASSISTANT' },
      orderBy: { createdAt: 'desc' },
      include: {
        conversation: { include: { messages: { where: { role: 'USER' }, orderBy: { createdAt: 'desc' }, take: 1 } } },
      },
    });
    if (!row) return null;
    const calls = (Array.isArray(row.toolCalls) ? row.toolCalls : []) as {
      name: string;
      ok: boolean;
      durationMs: number;
    }[];
    const answer = row.structured as AskAnswer | null;
    const refused = answer?.abstentions.map((a) => refusedCapabilityFor(a.detail)).find((k) => k !== null) ?? null;
    const proposal = (await this.proposals.forMessage(row.id)).at(-1);
    return {
      question: row.conversation.messages[0]?.content.slice(0, 160) ?? '',
      at: row.createdAt.toISOString(),
      model: row.model,
      latencyMs: row.latencyMs,
      steps: calls.map((c, i) => ({ seq: i + 1, tool: c.name, ok: c.ok, durationMs: c.durationMs })),
      refused,
      proposal: proposal?.status ?? 'NONE',
    };
  }

  /** One answer as a flight record: the question, every stage's time, every tool's time, what came back. */
  async run(id: string) {
    const row = await this.db.askMessage.findUnique({
      where: { id },
      include: {
        conversation: {
          include: {
            messages: {
              where: { role: 'USER', createdAt: { lte: new Date(8_640_000_000_000_000) } },
              orderBy: { createdAt: 'desc' },
              take: 1,
            },
          },
        },
      },
    });
    if (!row || row.role !== 'ASSISTANT') return null;
    const question =
      row.conversation.messages.find((m) => m.createdAt <= row.createdAt)?.content ??
      row.conversation.messages[0]?.content ??
      '';
    const calls = (Array.isArray(row.toolCalls) ? row.toolCalls : []) as {
      name: string;
      input: unknown;
      ok: boolean;
      idsReturned: string[];
      durationMs: number;
      contextVersion: string | null;
    }[];
    const proposals = await this.proposals.forMessage(row.id);
    const answer = row.structured as AskAnswer | null;
    return {
      id: row.id,
      conversationId: row.conversationId,
      at: row.createdAt.toISOString(),
      question: question.slice(0, 500),
      model: row.model,
      latencyMs: row.latencyMs,
      servedFromCache: row.servedFromCache,
      promptVersion: row.promptVersion,
      contextVersion: row.contextVersion,
      tokens: { input: row.inputTokens, output: row.outputTokens },
      phases: (row.phases ?? null) as Record<string, number | boolean> | null,
      toolCalls: calls.map((c, i) => ({
        seq: i + 1,
        name: c.name,
        input: c.input,
        ok: c.ok,
        idsReturned: c.idsReturned,
        durationMs: c.durationMs,
        contextVersion: c.contextVersion,
      })),
      answer: answer
        ? {
            statements: answer.statements.length,
            abstentions: answer.abstentions.map((a) => a.reason),
            conflicts: answer.conflicts.length,
            summary: answer.summary,
          }
        : null,
      evidenceIds: row.evidenceIds,
      proposals,
    };
  }

  /**
   * One run as a flight record, for staff who read the platform: what ran, for how long, what came
   * back, masked where a string must not travel — never a thought. The board's line applies.
   */
  async flight(actor: Actor, id: string): Promise<FlightRecord | null> {
    if (!can(actor, 'read', 'platform')) throw new ForbiddenException('a run is read by staff');
    const row = await this.db.askMessage.findUnique({
      where: { id },
      include: {
        conversation: {
          include: {
            user: { select: { id: true, role: true } },
            messages: {
              where: { role: 'USER' },
              orderBy: { createdAt: 'desc' },
              take: 20,
              select: { content: true, createdAt: true },
            },
          },
        },
      },
    });
    if (!row || row.role !== 'ASSISTANT') return null;
    const question =
      row.conversation.messages.find((m) => m.createdAt <= row.createdAt)?.content ??
      row.conversation.messages[0]?.content ??
      '';
    const [proposals, recorded, story] = await Promise.all([
      this.proposals.forMessage(row.id),
      this.db.auditEvent.findFirst({
        where: { entityType: 'AskMessage', entityId: row.id, action: 'ask.review.decided' },
        orderBy: { at: 'desc' },
        select: { at: true },
      }),
      this.db.setting.findUnique({ where: { key: 'story' } }),
    ]);
    const calls = (Array.isArray(row.toolCalls) ? row.toolCalls : []) as FlightInput['toolCalls'];
    const answer = row.structured as AskAnswer | null;
    return flightRecord({
      id: row.id,
      createdAt: row.createdAt.toISOString(),
      question,
      actor: row.conversation.user ? { userId: row.conversation.user.id, role: row.conversation.user.role } : null,
      model: row.model,
      latencyMs: row.latencyMs,
      servedFromCache: row.servedFromCache,
      promptVersion: row.promptVersion,
      contextVersion: row.contextVersion,
      tokens: { input: row.inputTokens, output: row.outputTokens },
      phases: (row.phases ?? null) as Record<string, number | boolean> | null,
      toolCalls: calls,
      answer: answer
        ? {
            statements: answer.statements.length,
            abstentions: answer.abstentions.map((a) => a.reason),
            conflicts: answer.conflicts.length,
            summary: answer.summary,
          }
        : null,
      proposals: proposals.map((p) => ({
        id: p.id,
        kind: p.kind,
        status: p.status,
        decidedAt: p.decidedAt?.toISOString() ?? null,
      })),
      decisionRecordedAt: recorded?.at.toISOString() ?? null,
      evidenceIds: row.evidenceIds,
      storyRecipId: (story?.value as { recipId?: string } | null)?.recipId ?? null,
      now: this.clock.now().toISOString(),
    });
  }

  /** The latest answers, newest first: the flight recorder's index. */
  async recentRuns(limit = 30) {
    const rows = await this.db.askMessage.findMany({
      where: { role: 'ASSISTANT' },
      orderBy: { createdAt: 'desc' },
      take: limit,
      include: {
        conversation: {
          include: {
            messages: {
              where: { role: 'USER' },
              orderBy: { createdAt: 'asc' },
              select: { content: true, createdAt: true },
            },
          },
        },
      },
    });
    return rows.map((row) => {
      const calls = (Array.isArray(row.toolCalls) ? row.toolCalls : []) as { name: string; ok: boolean }[];
      const phases = (row.phases ?? null) as Record<string, number | boolean> | null;
      // The question is the last thing the person said before this answer, not the conversation's latest word.
      const asked =
        [...row.conversation.messages].reverse().find((m) => m.createdAt <= row.createdAt) ??
        row.conversation.messages[0];
      return {
        id: row.id,
        at: row.createdAt.toISOString(),
        question: asked?.content.slice(0, 160) ?? '',
        model: row.model,
        latencyMs: row.latencyMs,
        tools: calls.length,
        failedTools: calls.filter((c) => !c.ok).length,
        verified: typeof phases?.['verified'] === 'boolean' ? phases['verified'] : null,
        servedFromCache: row.servedFromCache,
      };
    });
  }

  async recentConversations(actor: Actor) {
    return this.db.askConversation.findMany({
      where: { userId: actor.userId },
      orderBy: { createdAt: 'desc' },
      take: 20,
      include: { messages: { orderBy: { createdAt: 'asc' }, take: 1 } },
    });
  }

  // ───────────────────────────── feedback, memory, requests ─────────────────────────────

  async feedback(actor: Actor, messageId: string, rating: 'UP' | 'DOWN', correction: string | null) {
    const message = await this.db.askMessage.findUnique({ where: { id: messageId }, include: { conversation: true } });
    if (!message || message.conversation.userId !== actor.userId) throw new NotFoundException('message not found');
    const row = await this.db.askFeedback.create({ data: { messageId, userId: actor.userId, rating, correction } });
    await this.audit.record({
      actor,
      source: 'UI',
      action: 'ask.feedback',
      entityType: 'AskMessage',
      entityId: messageId,
      after: { rating, correction },
    });
    return row;
  }

  /** A person turns a correction into a regression test. The model never does this itself. */
  async promoteFeedback(
    actor: Actor,
    feedbackId: string,
    expected: unknown,
    category: string,
    alsoRemember: { scope: 'USER' | 'ORG'; key: string; value: string } | null,
  ) {
    const fb = await this.db.askFeedback.findUnique({
      where: { id: feedbackId },
      include: { message: { include: { conversation: { include: { messages: { orderBy: { createdAt: 'asc' } } } } } } },
    });
    if (!fb) throw new NotFoundException('feedback not found');
    if (fb.promotedToEvalCaseId) return { evalCaseId: fb.promotedToEvalCaseId, alreadyPromoted: true };
    const msgs = fb.message.conversation.messages;
    const index = msgs.findIndex((m) => m.id === fb.messageId);
    const question = [...msgs.slice(0, index)].reverse().find((m) => m.role === 'USER')?.content ?? '';
    const author = await this.db.user.findUnique({ where: { id: fb.userId } });
    const evalCase = await this.db.evalCase.create({
      data: {
        category: category as never,
        actorRole: author?.role ?? 'ADMIN',
        actorCustomerId: author?.customerId ?? null,
        input: question,
        expected: expected as Prisma.InputJsonValue,
        source: 'FROM_FEEDBACK',
      },
    });
    await this.db.askFeedback.update({ where: { id: feedbackId }, data: { promotedToEvalCaseId: evalCase.id } });
    if (alsoRemember) {
      await this.db.askMemory
        .upsert({
          where: {
            scope_userId_key: {
              scope: alsoRemember.scope,
              userId: alsoRemember.scope === 'USER' ? fb.userId : (null as unknown as string),
              key: alsoRemember.key,
            },
          },
          create: {
            scope: alsoRemember.scope,
            userId: alsoRemember.scope === 'USER' ? fb.userId : null,
            key: alsoRemember.key,
            value: alsoRemember.value,
            source: 'CORRECTED',
          },
          update: { value: alsoRemember.value, source: 'CORRECTED' },
        })
        .catch(async () => {
          // ORG-scope rows have a null userId, which the compound unique cannot address in `where`; fall back to find-then-write.
          const existing = await this.db.askMemory.findFirst({
            where: {
              scope: alsoRemember.scope,
              userId: alsoRemember.scope === 'USER' ? fb.userId : null,
              key: alsoRemember.key,
            },
          });
          if (existing)
            await this.db.askMemory.update({
              where: { id: existing.id },
              data: { value: alsoRemember.value, source: 'CORRECTED' },
            });
          else
            await this.db.askMemory.create({
              data: {
                scope: alsoRemember.scope,
                userId: alsoRemember.scope === 'USER' ? fb.userId : null,
                key: alsoRemember.key,
                value: alsoRemember.value,
                source: 'CORRECTED',
              },
            });
        });
    }
    await this.audit.record({
      actor,
      source: 'UI',
      action: 'ask.feedback_promoted',
      entityType: 'EvalCase',
      entityId: evalCase.id,
      after: { feedbackId, category, alsoRemember },
    });
    return { evalCaseId: evalCase.id, alreadyPromoted: false };
  }

  async listMemory(actor: Actor) {
    return this.db.askMemory.findMany({
      where: { OR: [{ scope: 'ORG' }, { scope: 'USER', userId: actor.userId }] },
      orderBy: [{ scope: 'asc' }, { updatedAt: 'desc' }],
    });
  }

  async remember(actor: Actor, scope: 'USER' | 'ORG', key: string, value: string) {
    // Preferences only: a record, an amount or a rule of thumb is refused here, before it can outlive its evidence.
    const screened = screenMemory(key, value);
    if (!screened.ok) throw new BadRequestException({ code: screened.code, message: screened.reason });
    if (scope === 'ORG' && actor.role === 'CUSTOMER')
      throw new ForbiddenException('customers may only set their own preferences');
    const userId = scope === 'USER' ? actor.userId : null;
    const existing = await this.db.askMemory.findFirst({ where: { scope, userId, key } });
    const row = existing
      ? await this.db.askMemory.update({ where: { id: existing.id }, data: { value, source: 'USER_STATED' } })
      : await this.db.askMemory.create({ data: { scope, userId, key, value, source: 'USER_STATED' } });
    await this.audit.record({
      actor,
      source: 'UI',
      action: 'ask.memory_set',
      entityType: 'AskMemory',
      entityId: row.id,
      before: existing ? { value: existing.value } : undefined,
      after: { scope, key, value },
    });
    return row;
  }

  async forget(actor: Actor, id: string) {
    const row = await this.db.askMemory.findUnique({ where: { id } });
    if (!row) throw new NotFoundException('memory not found');
    if (row.scope === 'USER' && row.userId !== actor.userId) throw new ForbiddenException();
    if (row.scope === 'ORG' && actor.role === 'CUSTOMER') throw new ForbiddenException();
    await this.db.askMemory.delete({ where: { id } });
    await this.audit.record({
      actor,
      source: 'UI',
      action: 'ask.memory_deleted',
      entityType: 'AskMemory',
      entityId: id,
      before: { key: row.key, value: row.value },
    });
    return { deleted: true };
  }

  /** "Send to team": the same row an approved proposal writes, through the same service. */
  createRequest(actor: Actor, subject: string, body: string, evidenceIds: string[]) {
    return this.requests.create(actor, { subject, body, evidenceIds }, 'UI');
  }

  closeRequest(actor: Actor, id: string, note: string | null) {
    return this.requests.close(actor, id, note);
  }

  listRequests(actor: Actor) {
    return this.requests.list(actor);
  }

  // ───────────────────────────── spend cap ─────────────────────────────

  async checkSpendCap(): Promise<{ ok: boolean; spentCents: number; capCents: number }> {
    const capCents = this.envService.env.ASK_MONTHLY_SPEND_CAP_CENTS;
    const monthStart = new Date();
    monthStart.setUTCDate(1);
    monthStart.setUTCHours(0, 0, 0, 0);
    const rows = await this.db.askMessage.findMany({
      where: { role: 'ASSISTANT', createdAt: { gte: monthStart }, model: { not: 'offline' } },
      select: { model: true, inputTokens: true, outputTokens: true },
    });
    const spentCents = rows.reduce(
      (sum, r) =>
        sum + estimateCostCents(r.model ?? '', { inputTokens: r.inputTokens ?? 0, outputTokens: r.outputTokens ?? 0 }),
      0,
    );
    return { ok: capCents === 0 || spentCents < capCents, spentCents: Math.round(spentCents), capCents };
  }

  // ───────────────────────────── canned answers ─────────────────────────────

  private cappedAnswer(spentCents: number, capCents: number): AskAnswer {
    return {
      statements: [],
      abstentions: [
        {
          question: 'Ask is paused',
          reason: 'OUT_OF_SCOPE',
          detail: `This month's model spend (${(spentCents / 100).toFixed(2)} USD) reached the cap (${(capCents / 100).toFixed(2)} USD).`,
        },
      ],
      conflicts: [],
      summary: 'Ask is paused until the monthly spend cap resets or is raised.',
    };
  }

  private abstainOnly(reason: AskAnswer['abstentions'][number]['reason'], detail: string): AskAnswer {
    return {
      statements: [],
      abstentions: [{ question: 'This question', reason, detail }],
      conflicts: [],
      summary: detail,
    };
  }
}

/** What gets stored as plain text and replayed as conversation history. */
function renderPlainText(answer: AskAnswer): string {
  const parts: string[] = [];
  for (const s of answer.statements) parts.push(`${s.text} [${s.evidence.join(', ')}]`);
  for (const a of answer.abstentions)
    parts.push(`Cannot answer "${a.question}" (${a.reason})${a.detail ? `: ${a.detail}` : ''}`);
  for (const c of answer.conflicts) parts.push(`Conflict between ${c.ids.join(' and ')}: ${c.description}`);
  if (answer.summary) parts.push(answer.summary);
  return parts.join('\n');
}
