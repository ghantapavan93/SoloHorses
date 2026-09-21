import { flightRecord, redact, type FlightInput } from './flight';

/** A run as the answer row stores it: the graph's timings, the tools with theirs, the answer, the proposals it left. */
const base: FlightInput = {
  id: 'ask_run1',
  createdAt: '2026-04-20T15:00:10.000Z',
  question: 'Why can’t R-0037 leave?',
  actor: { userId: 'usr_admin', role: 'ADMIN' },
  model: 'offline-deterministic',
  latencyMs: 1_000,
  servedFromCache: false,
  promptVersion: 'p3',
  contextVersion: 'ctx-1',
  tokens: { input: null, output: null },
  phases: {
    gate: 4,
    authorize: 8,
    compose: 900,
    tools: 60,
    model: 0,
    composeOther: 840,
    verify: 31,
    overhead: 57,
    total: 1_000,
    verified: true,
    rejected: 0,
  },
  toolCalls: [
    {
      name: 'getHorse',
      input: { id: 'R-0037' },
      ok: true,
      idsReturned: ['R-0037'],
      durationMs: 24,
      contextVersion: 'h1',
      toolVersion: '1',
    },
    {
      name: 'getXray',
      input: { recipId: 'R-0037' },
      ok: true,
      idsReturned: ['R-0037', 'E-26-0009', 'OX-26-0006'],
      durationMs: 36,
      contextVersion: 'x1',
      toolVersion: '1',
    },
  ],
  answer: { statements: 3, abstentions: [], conflicts: 0, summary: 'She cannot leave: the video is missing.' },
  proposals: [],
  decisionRecordedAt: null,
  evidenceIds: ['R-0037', 'OX-26-0006'],
  storyRecipId: 'R-0037',
  now: '2026-04-20T15:05:00.000Z',
};

describe('the flight record', () => {
  it('lays the stages end to end from the run’s start, in the order the graph ran them, with the durations it measured', () => {
    const record = flightRecord(base);
    expect(record.startedAt).toBe('2026-04-20T15:00:09.000Z');
    expect(record.durationMs).toBe(1_000);
    expect(record.steps.map((s) => s.kind)).toEqual([
      'policy',
      'authorize',
      'tool',
      'tool',
      'model',
      'compose',
      'verifier',
      'response',
    ]);
    expect(record.steps.map((s) => s.durationMs)).toEqual([4, 8, 24, 36, 0, 840, 31, 57]);
    const starts = record.steps.map((s) => s.startedAt);
    expect([...starts].sort()).toEqual(starts);
    expect(record.steps.map((s) => s.seq)).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
    expect(record.steps.every((s) => s.status === 'ok')).toBe(true);
    // No model ran: the record says so, in those words, rather than naming one.
    expect(record.provider).toEqual({ kind: 'deterministic', model: null });
    expect(record.steps.find((s) => s.kind === 'model')?.name).toBe('deterministic composer');
    expect(record.links).toEqual({
      question: `/today?ask=${encodeURIComponent(base.question)}`,
      xray: '/story#why',
      decisions: [],
    });
    expect(record.status).toBe('ok');
  });

  it('shows both attempts when a tool failed and ran again, and names the failure', () => {
    const record = flightRecord({
      ...base,
      toolCalls: [
        {
          name: 'getHorse',
          input: { id: 'R-0037' },
          ok: false,
          idsReturned: [],
          error: 'circuit open: equine api',
          durationMs: 12,
          contextVersion: null,
        },
        {
          name: 'getHorse',
          input: { id: 'R-0037' },
          ok: true,
          idsReturned: ['R-0037'],
          durationMs: 20,
          contextVersion: 'h1',
        },
      ],
    });
    const tools = record.steps.filter((s) => s.kind === 'tool');
    expect(tools.map((s) => [s.name, s.status, s.provenance.attempt])).toEqual([
      ['getHorse', 'failed', 1],
      ['getHorse · retry 1', 'ok', 2],
    ]);
    expect(tools[0]?.provenance.error).toBe('circuit open: equine api');
    expect(tools[0]?.summary).toContain('circuit open');
    expect(record.status).toBe('ok');
  });

  it('masks what a trace must never carry — in the question, in a tool’s input, in the link back to the question — and counts the masks', () => {
    const record = flightRecord({
      ...base,
      question: 'Charge 4242 4242 4242 4242 for jane@example.com, call 555-123-4567, ssn 123-45-6789',
      toolCalls: [
        {
          name: 'getCustomer',
          input: { email: 'jane@example.com' },
          ok: true,
          idsReturned: ['C-0001'],
          durationMs: 5,
          contextVersion: null,
        },
      ],
    });
    expect(record.question).toBe('Charge [number] for [email], call [phone], ssn [ssn]');
    expect(record.steps[0]?.redactions).toBe(4);
    expect(record.steps.find((s) => s.kind === 'tool')?.provenance.input).toBe('{"email":"[email]"}');
    expect(record.links.question).not.toContain('example.com');
    expect(record.redactions).toBe(5);
    expect(redact('R-0037 leaves 2026-04-22; invoice INV-26-0077').text).toBe(
      'R-0037 leaves 2026-04-22; invoice INV-26-0077',
    ); // ids and dates are not secrets
  });

  it('a refusal at the gate is a first step and the last: nothing else ran', () => {
    const record = flightRecord({
      ...base,
      phases: { gate: 2, verify: 1, overhead: 3, total: 6, verified: true, rejected: 0 },
      toolCalls: [],
      answer: { statements: 0, abstentions: ['SENSITIVE_DATA'], conflicts: 0, summary: 'refused' },
    });
    expect(record.steps.map((s) => [s.kind, s.status])).toEqual([
      ['policy', 'refused'],
      ['verifier', 'ok'],
      ['response', 'ok'],
    ]);
    expect(record.steps[0]?.summary).toContain('SENSITIVE_DATA');
    expect(record.status).toBe('refused');
  });

  it('a proposal pauses the run for a person: waiting until the click, then resumed, and the decision recorded', () => {
    const waiting = flightRecord({
      ...base,
      proposals: [{ id: 'prop1', kind: 'REQUEST_VETERINARY_CONFIRMATION', status: 'PROPOSED', decidedAt: null }],
    });
    const pause = waiting.steps.find((s) => s.kind === 'pause');
    expect(pause).toMatchObject({
      status: 'waiting',
      startedAt: base.createdAt,
      durationMs: 290_000,
      provenance: { ref: 'prop1', rule: 'interrupt(await_human)' },
    });
    expect(waiting.status).toBe('waiting');
    expect(waiting.links.decisions).toEqual(['/decisions/prop1']);

    const resumed = flightRecord({
      ...base,
      proposals: [
        {
          id: 'prop1',
          kind: 'REQUEST_VETERINARY_CONFIRMATION',
          status: 'APPROVED',
          decidedAt: '2026-04-20T15:02:10.000Z',
        },
      ],
      decisionRecordedAt: '2026-04-20T15:02:10.500Z',
    });
    const paused = resumed.steps.find((s) => s.kind === 'pause');
    expect(paused).toMatchObject({ status: 'resumed', durationMs: 120_000 });
    expect(resumed.steps.at(-1)).toMatchObject({ kind: 'record', startedAt: '2026-04-20T15:02:10.500Z' });
    expect(resumed.status).toBe('resumed');
    // The pause is the last thing on the axis before the record; the run's own steps come first.
    const kinds = resumed.steps.map((s) => s.kind);
    expect(kinds.indexOf('pause')).toBeGreaterThan(kinds.indexOf('response'));
  });
});
