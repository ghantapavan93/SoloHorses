import type Anthropic from '@anthropic-ai/sdk';
import { zodOutputFormat } from '@anthropic-ai/sdk/helpers/zod';
import { AskAnswerSchema, askAnswerJsonSchema, normalizeAnswerCandidate, type AskAnswer } from '@daysheet/domain';

/**
 * The model behind Ask is a vendor behind a port, the way Stripe and QuickBooks are. The
 * compose loop speaks one neutral shape — text turns, tool calls, tool results — and an
 * adapter translates it: the Anthropic SDK with its content blocks and cached system prompt,
 * or a local Ollama server over its chat API, which costs nothing and runs on the laptop's
 * GPU. Both end in the same validated `AskAnswer`; the policy gate before them and the
 * evidence verifier after them are the same code, so the guarantees do not depend on which.
 */

export type ChatMessage =
  | { role: 'user'; text: string }
  | { role: 'assistant'; text: string }
  /** The model asked for tools. `raw` keeps the provider's own content so it replays verbatim next round. */
  | { role: 'assistant_tool_calls'; text: string | null; calls: ToolCall[]; raw: unknown }
  | { role: 'tool_results'; results: ToolResult[] };

export interface ToolCall {
  id: string;
  name: string;
  input: unknown;
}

export interface ToolResult {
  callId: string;
  name: string;
  content: string;
  isError: boolean;
}

export interface ModelUsage {
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
}

export interface ModelTurn {
  stop: 'tool_use' | 'end' | 'refusal' | 'max_tokens';
  text: string | null;
  toolCalls: ToolCall[];
  /** The answer in its schema, when the turn produced one; null means the service abstains. */
  parsed: AskAnswer | null;
  usage: ModelUsage;
  raw: unknown;
}

export interface ModelRequest {
  system: string;
  messages: ChatMessage[];
  tools: Anthropic.Tool[];
}

export interface ModelPort {
  readonly provider: 'anthropic' | 'ollama' | 'openai';
  /** Stored on every answer. A local model carries its provider in the name so the spend cap can tell it costs nothing. */
  readonly model: string;
  readonly costsMoney: boolean;
  turn(request: ModelRequest): Promise<ModelTurn>;
}

/** The slice of the SDK the Anthropic adapter uses; tests provide a scripted implementation. */
export type ModelClient = Pick<Anthropic, 'messages'>;

const MAX_OUTPUT_TOKENS = 4_000;

export const addUsage = (a: ModelUsage, b: ModelUsage): ModelUsage => ({
  inputTokens: a.inputTokens + b.inputTokens,
  outputTokens: a.outputTokens + b.outputTokens,
  cacheReadTokens: a.cacheReadTokens + b.cacheReadTokens,
});

// ───────────────────────────── Anthropic ─────────────────────────────

export class AnthropicModel implements ModelPort {
  readonly provider = 'anthropic' as const;
  readonly costsMoney = true;

  constructor(
    private readonly client: ModelClient,
    readonly model: string,
  ) {}

  async turn(request: ModelRequest): Promise<ModelTurn> {
    const response = await this.client.messages.parse({
      model: this.model,
      max_tokens: MAX_OUTPUT_TOKENS,
      system: [{ type: 'text', text: request.system, cache_control: { type: 'ephemeral' } }],
      tools: request.tools,
      messages: request.messages.map(toAnthropicMessage),
      thinking: { type: 'adaptive' },
      output_config: { effort: 'medium', format: zodOutputFormat(AskAnswerSchema) },
    });
    const usage: ModelUsage = {
      inputTokens: response.usage.input_tokens,
      outputTokens: response.usage.output_tokens,
      cacheReadTokens: response.usage.cache_read_input_tokens ?? 0,
    };
    if (response.stop_reason === 'refusal')
      return { stop: 'refusal', text: null, toolCalls: [], parsed: null, usage, raw: response.content };
    const toolUses = response.content.filter((b): b is Anthropic.ToolUseBlock => b.type === 'tool_use');
    if (response.stop_reason === 'tool_use' && toolUses.length > 0) {
      return {
        stop: 'tool_use',
        text: null,
        toolCalls: toolUses.map((u) => ({ id: u.id, name: u.name, input: u.input })),
        parsed: null,
        usage,
        raw: response.content,
      };
    }
    const text =
      response.content
        .filter((b): b is Anthropic.TextBlock => b.type === 'text')
        .map((b) => b.text)
        .join('\n')
        .trim() || null;
    return {
      stop: response.stop_reason === 'max_tokens' ? 'max_tokens' : 'end',
      text,
      toolCalls: [],
      parsed: response.parsed_output ?? parseAnswer(text),
      usage,
      raw: response.content,
    };
  }
}

function toAnthropicMessage(message: ChatMessage): Anthropic.MessageParam {
  switch (message.role) {
    case 'user':
      return { role: 'user', content: message.text };
    case 'assistant':
      return { role: 'assistant', content: message.text };
    case 'assistant_tool_calls':
      return { role: 'assistant', content: message.raw as Anthropic.ContentBlock[] };
    case 'tool_results':
      return {
        role: 'user',
        content: message.results.map((r): Anthropic.ToolResultBlockParam => ({
          type: 'tool_result',
          tool_use_id: r.callId,
          content: r.content,
          is_error: r.isError,
        })),
      };
  }
}

// ───────────────────────────── Ollama (local, free) ─────────────────────────────

export interface OllamaOptions {
  url: string;
  model: string;
  /** Context window in tokens; 8k leaves room for the KV cache beside a 7B Q4 model on a 6 GB GPU. */
  numCtx: number;
  timeoutMs?: number;
  fetchImpl?: typeof fetch;
}

interface OllamaMessage {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string;
  tool_calls?: { function: { name: string; arguments: unknown } }[];
  tool_name?: string;
}

interface OllamaChatResponse {
  message: { role: string; content: string; tool_calls?: { function: { name: string; arguments: unknown } }[] };
  done_reason?: string;
  prompt_eval_count?: number;
  eval_count?: number;
}

/** What a small local model needs said plainly: tools first, prose second, the JSON in its own step. */
const OLLAMA_ADDENDUM = `

LOCAL MODEL PROCESS
You are a small local model. Work in two steps. Step one: call the tools you need to read the records (several calls in one turn are fine); when a tool result comes back, decide whether you need another lookup. Step two: when you have what you need, reply with exactly the word DONE and nothing else; the answer itself is requested separately afterwards. Never write the answer or JSON in step two.`;

const FINAL_JSON_INSTRUCTION = `Now write the final answer as JSON in the required shape and nothing else. "statements": what the records say, one sentence each, with "evidence" listing the record codes that support it — only codes that appeared in tool results in this conversation; a rule's verdict from a tool (cleared, not cleared, eligible, held) is a statement citing the codes the tool returned. "abstentions": what the records cannot establish or what you may not decide — each with "question", a "reason" from the allowed list and a short "detail" (a clinical decision is VETERINARY_JUDGMENT; a missing record is NO_RECORD; a forbidden one is ACCESS_DENIED). "conflicts": records that disagree, with both codes. "summary": two sentences restating the statements. If a tool returned ACCESS_DENIED, NO_RECORD or another error for what was asked, put that in abstentions and leave statements empty. Never invent a code.`;

/**
 * Ollama's chat API, two calls per answer. A 7B model cannot both call a tool and satisfy a
 * JSON schema in one reply, so the tool rounds run without a format and the final answer is
 * a separate call constrained to the answer's JSON schema (Ollama decodes against it). The
 * conversation shape is the same one the Anthropic adapter sees; only the wire format differs.
 */
export class OllamaModel implements ModelPort {
  readonly provider = 'ollama' as const;
  readonly costsMoney = false;
  readonly model: string;
  private readonly fetchImpl: typeof fetch;

  constructor(private readonly options: OllamaOptions) {
    this.model = `ollama/${options.model}`;
    this.fetchImpl = options.fetchImpl ?? fetch;
  }

  async turn(request: ModelRequest): Promise<ModelTurn> {
    const messages: OllamaMessage[] = [
      { role: 'system', content: `${request.system}${OLLAMA_ADDENDUM}` },
      ...request.messages.flatMap(toOllamaMessages),
    ];
    const first = await this.chat({ messages, tools: request.tools.map(toOllamaTool) });
    const usage = usageOf(first);
    const calls = first.message.tool_calls ?? [];
    if (calls.length > 0) {
      const stamp = Date.now().toString(36);
      const toolCalls = calls.map((c, i) => ({
        id: `ollama_${stamp}_${i}`,
        name: c.function.name,
        input: c.function.arguments,
      }));
      // Whatever prose came with the tool calls is a small model thinking aloud; replaying it would only cost tokens next round.
      return { stop: 'tool_use', text: null, toolCalls, parsed: null, usage, raw: null };
    }
    // The model says DONE (or, ignoring that, some prose); either way the answer is the next, schema-constrained call.
    const prose = first.message.content?.trim() ?? '';
    const spoke = prose.length > 0 && prose.toUpperCase() !== 'DONE';
    const second = await this.chat({
      messages: [
        ...messages,
        ...(spoke ? [{ role: 'assistant' as const, content: prose }] : []),
        { role: 'user' as const, content: FINAL_JSON_INSTRUCTION },
      ],
      format: askAnswerJsonSchema(),
    });
    // `raw` carries the final call's content so the service can say what a non-answer looked like.
    return {
      stop: second.done_reason === 'length' ? 'max_tokens' : 'end',
      text: spoke ? prose : null,
      toolCalls: [],
      parsed: parseAnswer(second.message.content),
      usage: addUsage(usage, usageOf(second)),
      raw: second.message.content,
    };
  }

  private async chat(body: Record<string, unknown>): Promise<OllamaChatResponse> {
    const response = await this.fetchImpl(`${this.options.url}/api/chat`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      // No `think` flag: a reasoning model (qwen3) then keeps its thought in the separate `thinking` field, which is
      // ignored here; with `think: false` it reasons anyway and leaks it into the content, which costs twice.
      body: JSON.stringify({
        model: this.options.model,
        stream: false,
        keep_alive: '10m',
        options: { temperature: 0, num_ctx: this.options.numCtx },
        ...body,
      }),
      signal: AbortSignal.timeout(this.options.timeoutMs ?? 180_000),
    });
    if (!response.ok) throw new Error(`ollama ${response.status}: ${(await response.text()).slice(0, 200)}`);
    return (await response.json()) as OllamaChatResponse;
  }
}

function toOllamaMessages(message: ChatMessage): OllamaMessage[] {
  switch (message.role) {
    case 'user':
      return [{ role: 'user', content: message.text }];
    case 'assistant':
      return [{ role: 'assistant', content: message.text }];
    case 'assistant_tool_calls':
      return [
        {
          role: 'assistant',
          content: message.text ?? '',
          tool_calls: message.calls.map((c) => ({ function: { name: c.name, arguments: c.input } })),
        },
      ];
    case 'tool_results':
      return message.results.map((r): OllamaMessage => ({ role: 'tool', content: r.content, tool_name: r.name }));
  }
}

function toOllamaTool(tool: Anthropic.Tool): {
  type: 'function';
  function: { name: string; description: string; parameters: unknown };
} {
  return {
    type: 'function',
    function: { name: tool.name, description: tool.description ?? '', parameters: tool.input_schema },
  };
}

function usageOf(response: OllamaChatResponse): ModelUsage {
  return { inputTokens: response.prompt_eval_count ?? 0, outputTokens: response.eval_count ?? 0, cacheReadTokens: 0 };
}

/**
 * Whether a local server is there and the model can call tools. Asked once at boot; the
 * answer decides whether Ask is live on Ollama or answers offline, and the status page says which.
 */
export async function probeOllama(
  url: string,
  model: string,
  fetchImpl: typeof fetch = fetch,
): Promise<{ ok: true } | { ok: false; reason: string }> {
  try {
    const version = await fetchImpl(`${url}/api/version`, { signal: AbortSignal.timeout(2_000) });
    if (!version.ok) return { ok: false, reason: `${url} answered ${version.status}` };
    const show = await fetchImpl(`${url}/api/show`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ model }),
      signal: AbortSignal.timeout(5_000),
    });
    if (!show.ok) return { ok: false, reason: `model ${model} is not pulled (ollama pull ${model})` };
    const info = (await show.json()) as { capabilities?: string[] };
    if (!info.capabilities?.includes('tools'))
      return { ok: false, reason: `model ${model} does not support tool calling` };
    return { ok: true };
  } catch (error) {
    return { ok: false, reason: `${url} not reachable: ${(error as Error).message}` };
  }
}

// ───────────────────────────── OpenAI-compatible (a hosted model, free tiers included) ─────────────────────────────

export interface OpenAiCompatibleOptions {
  /** The provider's OpenAI-style base, e.g. `https://api.groq.com/openai/v1`, or Ollama's own `http://127.0.0.1:11434/v1`. */
  baseUrl: string;
  apiKey: string;
  model: string;
  timeoutMs?: number;
  fetchImpl?: typeof fetch;
}

interface OaiToolCall {
  id: string;
  type: 'function';
  function: { name: string; arguments: string };
}

interface OaiMessage {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string | null;
  tool_calls?: OaiToolCall[];
  tool_call_id?: string;
}

interface OaiResponse {
  choices?: { message?: { content?: string | null; tool_calls?: OaiToolCall[] }; finish_reason?: string }[];
  usage?: { prompt_tokens?: number; completion_tokens?: number; prompt_tokens_details?: { cached_tokens?: number } };
}

/**
 * The chat-completions dialect most hosted providers speak (Groq, OpenRouter, Google's
 * compatibility endpoint, Mistral, Cloudflare, Ollama's own `/v1`). Two calls per answer like
 * the local adapter: tool rounds, then one call asking for a JSON object; the answer's schema
 * travels in the instruction and the normaliser and the Zod schema judge what comes back.
 * A key is a secret only the operator pastes; a rate limit is waited out once, then surfaced.
 */
export class OpenAiCompatibleModel implements ModelPort {
  readonly provider = 'openai' as const;
  /** Free tiers are the premise; a metered key is the operator's own budget, not this cap's. */
  readonly costsMoney = false;
  readonly model: string;
  private readonly fetchImpl: typeof fetch;

  constructor(private readonly options: OpenAiCompatibleOptions) {
    this.model = `hosted/${options.model}`;
    this.fetchImpl = options.fetchImpl ?? fetch;
  }

  async turn(request: ModelRequest): Promise<ModelTurn> {
    const messages: OaiMessage[] = [
      { role: 'system', content: `${request.system}${OLLAMA_ADDENDUM}` },
      ...request.messages.flatMap(toOaiMessages),
    ];
    const first = await this.chat({ messages, tools: request.tools.map(toOaiTool), tool_choice: 'auto' });
    const choice = first.choices?.[0];
    const usage = usageOfOai(first);
    const calls = choice?.message?.tool_calls ?? [];
    if (calls.length > 0) {
      const toolCalls = calls.map((c, i) => ({
        id: c.id || `call_${i}`,
        name: c.function.name,
        input: parseArguments(c.function.arguments),
      }));
      return { stop: 'tool_use', text: null, toolCalls, parsed: null, usage, raw: null };
    }
    if (choice?.finish_reason === 'content_filter')
      return { stop: 'refusal', text: null, toolCalls: [], parsed: null, usage, raw: null };
    const prose = choice?.message?.content?.trim() ?? '';
    const spoke = prose.length > 0 && prose.toUpperCase() !== 'DONE';
    const second = await this.chat({
      messages: [
        ...messages,
        ...(spoke ? [{ role: 'assistant' as const, content: prose }] : []),
        {
          role: 'user' as const,
          content: `${FINAL_JSON_INSTRUCTION}\n\nThe JSON schema of the answer:\n${JSON.stringify(askAnswerJsonSchema())}`,
        },
      ],
      response_format: { type: 'json_object' },
    });
    const content = second.choices?.[0]?.message?.content ?? null;
    return {
      stop: second.choices?.[0]?.finish_reason === 'length' ? 'max_tokens' : 'end',
      text: spoke ? prose : null,
      toolCalls: [],
      parsed: parseAnswer(content),
      usage: addUsage(usage, usageOfOai(second)),
      raw: content,
    };
  }

  private async chat(body: Record<string, unknown>, attempt = 1): Promise<OaiResponse> {
    const response = await this.fetchImpl(`${this.options.baseUrl.replace(/\/$/, '')}/chat/completions`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${this.options.apiKey}` },
      body: JSON.stringify({ model: this.options.model, temperature: 0, max_tokens: MAX_OUTPUT_TOKENS, ...body }),
      signal: AbortSignal.timeout(this.options.timeoutMs ?? 120_000),
    });
    if (response.status === 429 && attempt === 1) {
      // A free tier's rate limit: wait what it asks, once, then say so.
      const retryAfter = Number(response.headers.get('retry-after') ?? '0');
      if (retryAfter > 0 && retryAfter <= 20) {
        await new Promise((resolve) => setTimeout(resolve, retryAfter * 1_000));
        return this.chat(body, 2);
      }
    }
    if (!response.ok)
      throw new Error(
        `${this.options.model} at ${this.options.baseUrl}: HTTP ${response.status} ${(await response.text()).slice(0, 240)}`,
      );
    return (await response.json()) as OaiResponse;
  }
}

function toOaiMessages(message: ChatMessage): OaiMessage[] {
  switch (message.role) {
    case 'user':
      return [{ role: 'user', content: message.text }];
    case 'assistant':
      return [{ role: 'assistant', content: message.text }];
    case 'assistant_tool_calls':
      return [
        {
          role: 'assistant',
          content: message.text,
          tool_calls: message.calls.map((c) => ({
            id: c.id,
            type: 'function',
            function: { name: c.name, arguments: JSON.stringify(c.input ?? {}) },
          })),
        },
      ];
    case 'tool_results':
      return message.results.map((r): OaiMessage => ({ role: 'tool', tool_call_id: r.callId, content: r.content }));
  }
}

function toOaiTool(tool: Anthropic.Tool): {
  type: 'function';
  function: { name: string; description: string; parameters: unknown };
} {
  return {
    type: 'function',
    function: { name: tool.name, description: tool.description ?? '', parameters: tool.input_schema },
  };
}

/** Arguments arrive as a JSON string; a model that mangles it hands the raw text on, and the tool's schema refuses it with a reason. */
function parseArguments(text: string): unknown {
  try {
    return JSON.parse(text || '{}') as unknown;
  } catch {
    return { malformed: text };
  }
}

function usageOfOai(response: OaiResponse): ModelUsage {
  return {
    inputTokens: response.usage?.prompt_tokens ?? 0,
    outputTokens: response.usage?.completion_tokens ?? 0,
    cacheReadTokens: response.usage?.prompt_tokens_details?.cached_tokens ?? 0,
  };
}

/** Whether the hosted endpoint answers with this key: a network failure, a rejected key, or fine. */
export async function probeOpenAiCompatible(
  baseUrl: string,
  apiKey: string,
  fetchImpl: typeof fetch = fetch,
): Promise<{ ok: true } | { ok: false; reason: string }> {
  try {
    const response = await fetchImpl(`${baseUrl.replace(/\/$/, '')}/models`, {
      headers: { authorization: `Bearer ${apiKey}` },
      signal: AbortSignal.timeout(8_000),
    });
    if (response.status === 401 || response.status === 403)
      return { ok: false, reason: `${baseUrl} rejected the key (${response.status})` };
    return { ok: true };
  } catch (error) {
    return { ok: false, reason: `${baseUrl} not reachable: ${(error as Error).message}` };
  }
}

// ───────────────────────────── shared ─────────────────────────────

/**
 * JSON in a code fence or bare, normalised at the boundary (a rule code cited as evidence is
 * dropped, a claim without a record code becomes an abstention), then judged by the schema;
 * anything that is still not the answer's shape is nothing.
 */
export function parseAnswer(text: string | null): AskAnswer | null {
  if (!text) return null;
  try {
    const candidate = JSON.parse(text.trim().replace(/^```(?:json)?\n?|\n?```$/g, '')) as unknown;
    const result = AskAnswerSchema.safeParse(normalizeAnswerCandidate(candidate));
    return result.success ? result.data : null;
  } catch {
    return null;
  }
}
