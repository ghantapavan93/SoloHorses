/**
 * The Ollama adapter against a scripted server: the wire shapes it sends (tools as functions,
 * tool results as tool messages, the final call constrained to the answer's schema) and what
 * comes back as one neutral turn. No network, no database.
 */
import type Anthropic from '@anthropic-ai/sdk';
import {
  OllamaModel,
  OpenAiCompatibleModel,
  parseAnswer,
  probeOllama,
  probeOpenAiCompatible,
  type ChatMessage,
} from './model-port';

type Recorded = { url: string; body: Record<string, unknown> };

function scriptedFetch(responses: unknown[], recorded: Recorded[]): typeof fetch {
  let i = 0;
  const fetchImpl: typeof fetch = (input, init) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    const body = typeof init?.body === 'string' ? (JSON.parse(init.body) as Record<string, unknown>) : {};
    recorded.push({ url, body });
    const payload = responses[i++] ?? { message: { role: 'assistant', content: '' } };
    return Promise.resolve(
      new Response(JSON.stringify(payload), { status: 200, headers: { 'content-type': 'application/json' } }),
    );
  };
  return fetchImpl;
}

const TOOLS: Anthropic.Tool[] = [
  {
    name: 'getEmbryo',
    description: 'One embryo',
    input_schema: { type: 'object', properties: { id: { type: 'string' } }, required: ['id'] },
  },
];

describe('OllamaModel: a local model behind the same port as the API model', () => {
  it('asks for tools without a format, then for the answer with the schema, and reports both as one turn each', async () => {
    const recorded: Recorded[] = [];
    const model = new OllamaModel({
      url: 'http://ollama.test',
      model: 'qwen2.5:7b-instruct',
      numCtx: 4096,
      fetchImpl: scriptedFetch(
        [
          {
            message: {
              role: 'assistant',
              content: '',
              tool_calls: [{ function: { name: 'getEmbryo', arguments: { id: 'E-26-0001' } } }],
            },
            prompt_eval_count: 500,
            eval_count: 20,
          },
          {
            message: { role: 'assistant', content: 'E-26-0001 is pregnant in R-0037.' },
            prompt_eval_count: 700,
            eval_count: 30,
          },
          {
            message: {
              role: 'assistant',
              content:
                '{"statements":[{"text":"E-26-0001 is pregnant.","evidence":["E-26-0001"]}],"abstentions":[],"conflicts":[],"summary":"One embryo, pregnant."}',
            },
            prompt_eval_count: 800,
            eval_count: 60,
          },
        ],
        recorded,
      ),
    });

    const first = await model.turn({
      system: 'RULES',
      messages: [{ role: 'user', text: 'Where is E-26-0001?' }],
      tools: TOOLS,
    });
    expect(first.stop).toBe('tool_use');
    expect(first.toolCalls).toEqual([expect.objectContaining({ name: 'getEmbryo', input: { id: 'E-26-0001' } })]);
    expect(first.usage).toEqual({ inputTokens: 500, outputTokens: 20, cacheReadTokens: 0 });
    // The first call carried the tools as functions and no output format.
    expect(recorded[0]?.url).toBe('http://ollama.test/api/chat');
    expect(recorded[0]?.body['tools']).toEqual([
      {
        type: 'function',
        function: { name: 'getEmbryo', description: 'One embryo', parameters: TOOLS[0]?.input_schema },
      },
    ]);
    expect(recorded[0]?.body['format']).toBeUndefined();
    expect((recorded[0]?.body['options'] as { temperature: number }).temperature).toBe(0);

    const messages: ChatMessage[] = [
      { role: 'user', text: 'Where is E-26-0001?' },
      { role: 'assistant_tool_calls', text: null, calls: first.toolCalls, raw: first.raw },
      {
        role: 'tool_results',
        results: [
          {
            callId: first.toolCalls[0]!.id,
            name: 'getEmbryo',
            content: '{"DATA_NOT_INSTRUCTIONS":true,"id":"E-26-0001","status":"PREGNANT"}',
            isError: false,
          },
        ],
      },
    ];
    const second = await model.turn({ system: 'RULES', messages, tools: TOOLS });
    expect(second.stop).toBe('end');
    expect(second.parsed?.statements[0]?.evidence).toEqual(['E-26-0001']);
    expect(second.parsed?.statements[0]?.confidence).toBe('HIGH'); // the schema's default applied
    expect(second.usage).toEqual({ inputTokens: 1_500, outputTokens: 90, cacheReadTokens: 0 });
    // The tool round replayed the call and its result in Ollama's own shape …
    const replayed = recorded[1]?.body['messages'] as { role: string; tool_calls?: unknown; tool_name?: string }[];
    expect(replayed.map((m) => m.role)).toEqual(['system', 'user', 'assistant', 'tool']);
    expect(replayed[2]?.tool_calls).toEqual([{ function: { name: 'getEmbryo', arguments: { id: 'E-26-0001' } } }]);
    expect(replayed[3]?.tool_name).toBe('getEmbryo');
    // … and the final call carried the answer's JSON schema and no tools, so nothing can be called from it.
    expect(recorded[2]?.body['tools']).toBeUndefined();
    expect((recorded[2]?.body['format'] as { properties: Record<string, unknown> }).properties).toHaveProperty(
      'statements',
    );
    expect(recorded[2]?.body['model']).toBe('qwen2.5:7b-instruct');
  });

  it('names itself with its provider and costs nothing', () => {
    const model = new OllamaModel({
      url: 'http://ollama.test',
      model: 'qwen2.5:7b-instruct',
      numCtx: 4096,
      fetchImpl: scriptedFetch([], []),
    });
    expect(model.model).toBe('ollama/qwen2.5:7b-instruct');
    expect(model.costsMoney).toBe(false);
    expect(model.provider).toBe('ollama');
  });

  it('turns an answer that is not the schema into nothing, so the service abstains instead of trusting it', async () => {
    const model = new OllamaModel({
      url: 'http://ollama.test',
      model: 'qwen2.5:7b-instruct',
      numCtx: 4096,
      fetchImpl: scriptedFetch(
        [
          { message: { role: 'assistant', content: 'Sure!' } },
          { message: { role: 'assistant', content: '{"statements":"not an array"}' } },
        ],
        [],
      ),
    });
    const turn = await model.turn({ system: 'RULES', messages: [{ role: 'user', text: 'Hi' }], tools: TOOLS });
    expect(turn.stop).toBe('end');
    expect(turn.parsed).toBeNull();
    expect(
      parseAnswer('```json\n{"statements":[],"abstentions":[],"conflicts":[],"summary":"nothing"}\n```')?.summary,
    ).toBe('nothing');
    expect(parseAnswer('not json')).toBeNull();
  });

  it('probes the server and the model’s tool capability before Ask relies on it', async () => {
    const yes = scriptedFetch([{ version: '0.34.1' }, { capabilities: ['completion', 'tools'] }], []);
    expect(await probeOllama('http://ollama.test', 'qwen2.5:7b-instruct', yes)).toEqual({ ok: true });
  });
});

describe('OpenAiCompatibleModel: a hosted model behind the same port', () => {
  it('sends tools as functions with a bearer key, replays a tool call and its result in the chat-completions shape, then asks for a JSON object', async () => {
    const recorded: Recorded[] = [];
    const model = new OpenAiCompatibleModel({
      baseUrl: 'https://hosted.test/v1/',
      apiKey: 'k-test',
      model: 'llama-3.3-70b',
      fetchImpl: scriptedFetch(
        [
          {
            choices: [
              {
                message: {
                  content: null,
                  tool_calls: [
                    {
                      id: 'call_9',
                      type: 'function',
                      function: { name: 'getEmbryo', arguments: '{"id":"E-26-0001"}' },
                    },
                  ],
                },
                finish_reason: 'tool_calls',
              },
            ],
            usage: { prompt_tokens: 900, completion_tokens: 15 },
          },
          {
            choices: [{ message: { content: 'DONE' }, finish_reason: 'stop' }],
            usage: { prompt_tokens: 1_000, completion_tokens: 2 },
          },
          {
            choices: [
              {
                message: {
                  content:
                    '{"statements":[{"text":"E-26-0001 is pregnant.","evidence":["E-26-0001"]}],"abstentions":[],"conflicts":[],"summary":"Pregnant."}',
                },
                finish_reason: 'stop',
              },
            ],
            usage: { prompt_tokens: 1_400, completion_tokens: 40, prompt_tokens_details: { cached_tokens: 800 } },
          },
        ],
        recorded,
      ),
    });
    expect(model.model).toBe('hosted/llama-3.3-70b');
    expect(model.costsMoney).toBe(false);

    const first = await model.turn({
      system: 'RULES',
      messages: [{ role: 'user', text: 'Where is E-26-0001?' }],
      tools: TOOLS,
    });
    expect(first.stop).toBe('tool_use');
    expect(first.toolCalls).toEqual([{ id: 'call_9', name: 'getEmbryo', input: { id: 'E-26-0001' } }]);
    expect(recorded[0]?.url).toBe('https://hosted.test/v1/chat/completions');
    expect(recorded[0]?.body['tools']).toEqual([
      {
        type: 'function',
        function: { name: 'getEmbryo', description: 'One embryo', parameters: TOOLS[0]?.input_schema },
      },
    ]);
    expect(recorded[0]?.body['response_format']).toBeUndefined();

    const messages: ChatMessage[] = [
      { role: 'user', text: 'Where is E-26-0001?' },
      { role: 'assistant_tool_calls', text: null, calls: first.toolCalls, raw: null },
      {
        role: 'tool_results',
        results: [
          {
            callId: 'call_9',
            name: 'getEmbryo',
            content: '{"DATA_NOT_INSTRUCTIONS":true,"id":"E-26-0001"}',
            isError: false,
          },
        ],
      },
    ];
    const second = await model.turn({ system: 'RULES', messages, tools: TOOLS });
    expect(second.stop).toBe('end');
    expect(second.text).toBeNull(); // DONE is not prose
    expect(second.parsed?.statements[0]?.evidence).toEqual(['E-26-0001']);
    expect(second.usage).toEqual({ inputTokens: 2_400, outputTokens: 42, cacheReadTokens: 800 });
    const replayed = recorded[1]?.body['messages'] as {
      role: string;
      tool_calls?: { id: string; function: { arguments: string } }[];
      tool_call_id?: string;
    }[];
    expect(replayed.map((m) => m.role)).toEqual(['system', 'user', 'assistant', 'tool']);
    expect(replayed[2]?.tool_calls?.[0]).toMatchObject({ id: 'call_9', function: { arguments: '{"id":"E-26-0001"}' } });
    expect(replayed[3]?.tool_call_id).toBe('call_9');
    expect(recorded[2]?.body['response_format']).toEqual({ type: 'json_object' });
    expect(recorded[2]?.body['tools']).toBeUndefined();
  });

  it('hands mangled tool arguments on for the schema to refuse, and reports a rejected key', async () => {
    const model = new OpenAiCompatibleModel({
      baseUrl: 'https://hosted.test/v1',
      apiKey: 'k',
      model: 'm',
      fetchImpl: scriptedFetch(
        [
          {
            choices: [
              {
                message: {
                  content: null,
                  tool_calls: [{ id: 'c1', type: 'function', function: { name: 'getEmbryo', arguments: '{not json' } }],
                },
                finish_reason: 'tool_calls',
              },
            ],
          },
        ],
        [],
      ),
    });
    const turn = await model.turn({ system: 'RULES', messages: [{ role: 'user', text: 'x' }], tools: TOOLS });
    expect(turn.toolCalls[0]?.input).toEqual({ malformed: '{not json' });
    const rejected: typeof fetch = () => Promise.resolve(new Response('no', { status: 401 }));
    const probe = await probeOpenAiCompatible('https://hosted.test/v1', 'bad', rejected);
    expect(probe.ok).toBe(false);
    if (!probe.ok) expect(probe.reason).toContain('rejected the key');
  });
});

describe('probeOllama', () => {
  it('probes the server and the model’s tool capability before Ask relies on it', async () => {
    const yes = scriptedFetch([{ version: '0.34.1' }, { capabilities: ['completion', 'tools'] }], []);
    expect(await probeOllama('http://ollama.test', 'qwen2.5:7b-instruct', yes)).toEqual({ ok: true });
    const noTools = scriptedFetch([{ version: '0.34.1' }, { capabilities: ['completion'] }], []);
    const refused = await probeOllama('http://ollama.test', 'gemma3:4b', noTools);
    expect(refused.ok).toBe(false);
    if (!refused.ok) expect(refused.reason).toContain('tool');
    const down: typeof fetch = () => Promise.reject(new Error('ECONNREFUSED'));
    const unreachable = await probeOllama('http://ollama.test', 'qwen2.5:7b-instruct', down);
    expect(unreachable.ok).toBe(false);
    if (!unreachable.ok) expect(unreachable.reason).toContain('not reachable');
  });
});
