/**
 * The flight record of one run: the graph's stages, every tool it reached for, the model or the
 * deterministic composer, the verifier, the pause for a person — as spans on one axis, from the
 * measurements stored with the answer. Nothing here is a thought: only what ran, for how long,
 * with what came back. Sensitive strings in what was asked or passed to a tool are masked, and
 * the count of masks is on the step.
 */
export type StepKind =
  'policy' | 'authorize' | 'tool' | 'model' | 'compose' | 'cache' | 'verifier' | 'response' | 'pause' | 'record';
export type StepStatus = 'ok' | 'failed' | 'refused' | 'waiting' | 'resumed';

export interface FlightStep {
  seq: number;
  name: string;
  kind: StepKind;
  /** Reconstructed: the run's start plus the stages before it; the graph timed stages, not clocks. */
  startedAt: string;
  durationMs: number;
  status: StepStatus;
  summary: string;
  provenance: {
    tool: string | null;
    toolVersion: string | null;
    input: string | null;
    output: string | null;
    records: string[];
    stateHash: string | null;
    rule: string | null;
    error: string | null;
    attempt: number | null;
    ref: string | null;
  };
  redactions: number;
}

export interface FlightRecord {
  runId: string;
  question: string;
  actor: { userId: string; role: string } | null;
  startedAt: string;
  finishedAt: string;
  durationMs: number;
  status: 'ok' | 'refused' | 'waiting' | 'resumed' | 'failed';
  stateHash: string | null;
  /** 'deterministic' when no model was called; otherwise the provider's name for it. */
  provider: { kind: 'deterministic' | 'model' | 'cache'; model: string | null };
  promptVersion: string | null;
  tokens: { input: number | null; output: number | null };
  steps: FlightStep[];
  result: {
    statements: number;
    abstentions: string[];
    conflicts: number;
    summary: string;
    verified: boolean | null;
    rejected: number;
  } | null;
  decisionRefs: { id: string; kind: string; status: string }[];
  links: { question: string; xray: string | null; decisions: string[] };
  redactions: number;
}

export interface FlightInput {
  id: string;
  createdAt: string;
  question: string;
  actor: { userId: string; role: string } | null;
  model: string | null;
  latencyMs: number | null;
  servedFromCache: boolean;
  promptVersion: string | null;
  contextVersion: string | null;
  tokens: { input: number | null; output: number | null };
  phases: Record<string, number | boolean> | null;
  toolCalls: {
    name: string;
    input: unknown;
    ok: boolean;
    idsReturned: string[];
    error?: string;
    durationMs: number;
    contextVersion: string | null;
    toolVersion?: string;
  }[];
  answer: { statements: number; abstentions: string[]; conflicts: number; summary: string } | null;
  proposals: { id: string; kind: string; status: string; decidedAt: string | null }[];
  decisionRecordedAt: string | null;
  evidenceIds: string[];
  storyRecipId: string | null;
  now: string;
}

const CARD_OR_ACCOUNT = /\b\d(?:[ -]?\d){11,18}\b/g;
const SSN = /\b\d{3}-\d{2}-\d{4}\b/g;
const EMAIL = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi;
const PHONE = /(?:\+?1[ .-]?)?\(?\d{3}\)?[ .-]?\d{3}[ .-]?\d{4}\b/g;

/** Masks what a trace must never carry: card and account numbers, SSNs, e-mails, phone numbers. */
export function redact(text: string): { text: string; count: number } {
  let count = 0;
  const mask = (pattern: RegExp, word: string) => (value: string) =>
    value.replace(pattern, () => {
      count += 1;
      return `[${word}]`;
    });
  const out = [mask(SSN, 'ssn'), mask(CARD_OR_ACCOUNT, 'number'), mask(EMAIL, 'email'), mask(PHONE, 'phone')].reduce(
    (value, fn) => fn(value),
    text,
  );
  return { text: out, count };
}

const number = (phases: FlightInput['phases'], key: string): number | null => {
  const value = phases?.[key];
  return typeof value === 'number' ? value : null;
};
const flag = (phases: FlightInput['phases'], key: string): boolean | null => {
  const value = phases?.[key];
  return typeof value === 'boolean' ? value : null;
};
const PROVIDER_DETERMINISTIC = new Set(['offline', 'offline-deterministic', 'capped', 'cache']);

export function flightRecord(input: FlightInput): FlightRecord {
  const phases = input.phases;
  const total = input.latencyMs ?? number(phases, 'total') ?? input.toolCalls.reduce((sum, t) => sum + t.durationMs, 0);
  const finishedAt = Date.parse(input.createdAt);
  const startedAt = finishedAt - total;
  let cursor = startedAt;
  let seq = 0;
  let redactions = 0;
  const steps: FlightStep[] = [];
  const push = (step: Omit<FlightStep, 'seq' | 'startedAt'> & { at?: number }) => {
    const at = step.at ?? cursor;
    steps.push({ seq: ++seq, startedAt: new Date(at).toISOString(), ...step });
    if (step.at === undefined) cursor += step.durationMs;
    redactions += step.redactions;
  };
  const blank = (over: Partial<FlightStep['provenance']> = {}): FlightStep['provenance'] => ({
    tool: null,
    toolVersion: null,
    input: null,
    output: null,
    records: [],
    stateHash: null,
    rule: null,
    error: null,
    attempt: null,
    ref: null,
    ...over,
  });

  const question = redact(input.question);
  const gateRefused = phases !== null && number(phases, 'gate') !== null && number(phases, 'authorize') === null;

  if (number(phases, 'gate') !== null) {
    push({
      name: 'policy gate',
      kind: 'policy',
      durationMs: number(phases, 'gate') ?? 0,
      status: gateRefused ? 'refused' : 'ok',
      summary: gateRefused
        ? `refused before any tool ran: ${input.answer?.abstentions.join(', ') || 'abstained'}`
        : 'the question may be answered from records',
      provenance: blank({ rule: 'screenQuestion', input: question.text }),
      redactions: question.count,
    });
  }
  if (number(phases, 'authorize') !== null) {
    push({
      name: 'authorize',
      kind: 'authorize',
      durationMs: number(phases, 'authorize') ?? 0,
      status: 'ok',
      summary: input.actor
        ? `${input.actor.role.toLowerCase().replace(/_/g, ' ')} · rbac matrix`
        : 'the session is a user that exists',
      provenance: blank({ rule: 'can(actor, read, resource)' }),
      redactions: 0,
    });
  }
  // Tools in the order they ran; the same tool again after a failure is the retry, numbered.
  const attempts = new Map<string, number>();
  for (const call of input.toolCalls) {
    const attempt = (attempts.get(call.name) ?? 0) + 1;
    attempts.set(call.name, attempt);
    const shown = redact(JSON.stringify(call.input ?? null));
    const retried = attempt > 1;
    push({
      name: retried ? `${call.name} · retry ${attempt - 1}` : call.name,
      kind: 'tool',
      durationMs: call.durationMs,
      status: call.ok ? 'ok' : 'failed',
      summary: call.ok
        ? `${call.idsReturned.length} record${call.idsReturned.length === 1 ? '' : 's'}`
        : call.error
          ? redact(call.error).text
          : 'failed',
      provenance: blank({
        tool: call.name,
        toolVersion: call.toolVersion ?? null,
        input: shown.text,
        output: call.ok ? `${call.idsReturned.length} records` : null,
        records: call.idsReturned.slice(0, 40),
        stateHash: call.contextVersion,
        error: call.ok ? null : call.error ? redact(call.error).text : 'failed',
        attempt,
      }),
      redactions: shown.count,
    });
  }
  const modelMs = number(phases, 'model');
  const deterministic = !input.model || PROVIDER_DETERMINISTIC.has(input.model);
  if (input.servedFromCache) {
    push({
      name: 'answer cache',
      kind: 'cache',
      durationMs: 0,
      status: 'ok',
      summary: 'served against the same state: no model turn',
      provenance: blank({ stateHash: input.contextVersion }),
      redactions: 0,
    });
  } else if (modelMs !== null && modelMs > 0 && !deterministic) {
    push({
      name: 'model explanation',
      kind: 'model',
      durationMs: modelMs,
      status: 'ok',
      summary: `${input.model} · ${input.tokens.input ?? 0} in / ${input.tokens.output ?? 0} out`,
      provenance: blank({
        tool: input.model,
        rule: input.promptVersion ? `prompt ${input.promptVersion}` : null,
        stateHash: input.contextVersion,
      }),
      redactions: 0,
    });
  } else if (!gateRefused && phases !== null) {
    push({
      name: 'deterministic composer',
      kind: 'model',
      durationMs: Math.max(0, modelMs ?? 0),
      status: 'ok',
      summary: 'no model: the answer was composed from the tools in code',
      provenance: blank({ tool: 'OfflineAnswerer', stateHash: input.contextVersion }),
      redactions: 0,
    });
  }
  const composeOther = number(phases, 'composeOther');
  if (composeOther !== null && composeOther > 0)
    push({
      name: 'prompt & composer',
      kind: 'compose',
      durationMs: composeOther,
      status: 'ok',
      summary: 'the prompt, the composer, the cache lookup',
      provenance: blank(),
      redactions: 0,
    });
  if (number(phases, 'verify') !== null) {
    const verified = flag(phases, 'verified');
    const rejected = number(phases, 'rejected') ?? 0;
    push({
      name: 'verifier',
      kind: 'verifier',
      durationMs: number(phases, 'verify') ?? 0,
      status: 'ok',
      summary:
        verified === false
          ? `removed ${rejected} claim${rejected === 1 ? '' : 's'} that cited nothing retrieved`
          : 'every cited id was retrieved this turn',
      provenance: blank({
        rule: 'verifyEvidence',
        records: input.evidenceIds.slice(0, 40),
        output: verified === null ? null : verified ? 'passed' : `${rejected} rejected`,
      }),
      redactions: 0,
    });
  }
  if (number(phases, 'overhead') !== null) {
    push({
      name: 'response',
      kind: 'response',
      durationMs: number(phases, 'overhead') ?? 0,
      status: 'ok',
      summary: input.answer
        ? `${input.answer.statements} statement${input.answer.statements === 1 ? '' : 's'} · ${input.answer.abstentions.length} abstention${input.answer.abstentions.length === 1 ? '' : 's'} · ${input.answer.conflicts} conflict${input.answer.conflicts === 1 ? '' : 's'}`
        : 'no structured answer stored',
      provenance: blank({ ref: input.id, records: input.evidenceIds.slice(0, 40) }),
      redactions: 0,
    });
  }
  // A proposal pauses the thread for a person: a first-class event, open until the click, then resumed.
  const waiting = input.proposals.filter((p) => p.status === 'PROPOSED');
  if (input.proposals.length > 0) {
    const decidedAt =
      input.proposals
        .map((p) => p.decidedAt)
        .filter((d): d is string => d !== null)
        .sort()
        .at(-1) ?? null;
    const until = decidedAt ? Date.parse(decidedAt) : Date.parse(input.now);
    push({
      at: finishedAt,
      name: 'await human',
      kind: 'pause',
      durationMs: Math.max(0, until - finishedAt),
      status: waiting.length > 0 ? 'waiting' : 'resumed',
      summary:
        waiting.length > 0
          ? `${waiting.length} proposal${waiting.length === 1 ? '' : 's'} waiting for a person`
          : `decided: ${input.proposals.map((p) => `${p.kind.toLowerCase().replace(/_/g, ' ')} ${p.status.toLowerCase()}`).join(', ')}`,
      provenance: blank({
        rule: 'interrupt(await_human)',
        ref: input.proposals[0]?.id ?? null,
        records: input.proposals.map((p) => p.id),
      }),
      redactions: 0,
    });
  }
  if (input.decisionRecordedAt) {
    push({
      at: Date.parse(input.decisionRecordedAt),
      name: 'decision recorded',
      kind: 'record',
      durationMs: 0,
      status: 'ok',
      summary: 'the thread resumed and wrote its audit row',
      provenance: blank({ rule: 'ask.review.decided', ref: input.id }),
      redactions: 0,
    });
  }
  steps.sort((a, b) => a.startedAt.localeCompare(b.startedAt) || a.seq - b.seq);

  const failed = input.toolCalls.some((t) => !t.ok) && input.toolCalls.every((t) => !t.ok);
  const status: FlightRecord['status'] = gateRefused
    ? 'refused'
    : waiting.length > 0
      ? 'waiting'
      : input.proposals.length > 0
        ? 'resumed'
        : failed
          ? 'failed'
          : 'ok';
  const xrayCall = input.toolCalls.find((t) => t.name === 'getXray' && t.ok);
  const xrayRecip =
    xrayCall && typeof (xrayCall.input as { recipId?: unknown } | null)?.recipId === 'string'
      ? String((xrayCall.input as { recipId: string }).recipId)
      : null;
  const signal = input.evidenceIds.find((id) => /^OX-/.test(id)) ?? null;
  const xray = xrayRecip && xrayRecip === input.storyRecipId ? '/story#why' : signal ? `/signals/${signal}` : null;
  const verified = flag(phases, 'verified');
  return {
    runId: input.id,
    question: question.text,
    actor: input.actor,
    startedAt: new Date(startedAt).toISOString(),
    finishedAt: input.createdAt,
    durationMs: total,
    status,
    stateHash: input.contextVersion,
    provider: input.servedFromCache
      ? { kind: 'cache', model: input.model }
      : deterministic
        ? { kind: 'deterministic', model: null }
        : { kind: 'model', model: input.model },
    promptVersion: input.promptVersion,
    tokens: input.tokens,
    steps: steps.map((s, i) => ({ ...s, seq: i + 1 })),
    result: input.answer ? { ...input.answer, verified, rejected: number(phases, 'rejected') ?? 0 } : null,
    decisionRefs: input.proposals.map((p) => ({ id: p.id, kind: p.kind, status: p.status })),
    links: {
      question: `/today?ask=${encodeURIComponent(question.text.slice(0, 300))}`,
      xray,
      decisions: input.proposals.map((p) => `/decisions/${p.id}`),
    },
    redactions,
  };
}
