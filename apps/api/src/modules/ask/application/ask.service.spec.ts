/**
 * The assistant with a scripted model. Proves the properties that matter regardless of
 * which model is behind it: tools run through RBAC, invented evidence is stripped before a
 * person sees it, and the conversation is persisted with its tool trail.
 */
import { ForbiddenException } from '@nestjs/common';
import type Anthropic from '@anthropic-ai/sdk';
import { PrismaService } from '../../../platform/persistence/prisma.service';
import type { TestingModule } from '@nestjs/testing';
import { createTestModule } from '../../../test-support/module';
import { AccountingModule } from '../../accounting/accounting.module';
import { BillingModule } from '../../billing/billing.module';
import { OperationsModule } from '../../operations/operations.module';
import { ReproductionModule } from '../../reproduction/reproduction.module';
import { ANTHROPIC_CLIENT, AskService, type ModelClient } from './ask.service';
import { AskTools } from './ask.tools';
import { ReviewCheckpointer } from './review-graph';

/** A model that first looks up an embryo, then answers — citing one real code and one invented one. */
function scriptedClient(embryoId: string): ModelClient {
  let turn = 0;
  const parse = (): Promise<unknown> => {
    turn += 1;
    if (turn === 1) {
      return Promise.resolve({
        stop_reason: 'tool_use',
        content: [{ type: 'tool_use', id: 'toolu_1', name: 'getEmbryo', input: { id: embryoId } }],
        usage: { input_tokens: 100, output_tokens: 20, cache_read_input_tokens: 0 },
        parsed_output: null,
      });
    }
    return Promise.resolve({
      stop_reason: 'end_turn',
      content: [{ type: 'text', text: '{}' }],
      usage: { input_tokens: 200, output_tokens: 80, cache_read_input_tokens: 150 },
      parsed_output: {
        statements: [
          { text: `${embryoId} is in the records.`, evidence: [embryoId], confidence: 'HIGH' },
          { text: 'A second embryo E-26-9999 was also transferred.', evidence: ['E-26-9999'], confidence: 'MEDIUM' },
        ],
        abstentions: [],
        conflicts: [{ ids: [embryoId, 'CHK-26-9999'], description: 'Two checks disagree.' }],
        summary: 'One embryo found.',
      },
    });
  };
  return { messages: { parse } as unknown as Anthropic['messages'] };
}

describe('AskService with a scripted model', () => {
  const modules: TestingModule[] = [];
  let prisma: PrismaService;
  let ask: AskService;
  let tools: AskTools;
  let recipsActor: { userId: string; role: 'RECIPS'; customerId: null };
  let embryoId: string;

  beforeAll(async () => {
    const probe = await tracked(createTestModule({ imports: [ReproductionModule] }));
    prisma = probe.get(PrismaService);
    const recipUser = await prisma.client.user.findFirstOrThrow({ where: { role: 'RECIPS' } });
    recipsActor = { userId: recipUser.id, role: 'RECIPS', customerId: null };
    embryoId = (await prisma.client.embryo.findFirstOrThrow({ where: { source: 'ICSI' } })).id;
    const moduleRef = await tracked(
      createTestModule({
        imports: [ReproductionModule, OperationsModule, BillingModule, AccountingModule],
        providers: [
          ReviewCheckpointer,
          AskTools,
          AskService,
          { provide: ANTHROPIC_CLIENT, useValue: scriptedClient(embryoId) },
        ],
      }),
    );
    ask = moduleRef.get(AskService);
    tools = moduleRef.get(AskTools);
  });

  afterAll(async () => {
    await Promise.all(modules.map((m) => m.close()));
  });

  async function tracked(pending: Promise<TestingModule>): Promise<TestingModule> {
    const m = await pending;
    modules.push(m);
    return m;
  }

  it('strips statements and conflicts that cite records the tools never returned', async () => {
    const { answer, toolCalls, messageId } = await ask.askOnce(recipsActor, `Where is ${embryoId}?`);
    expect(toolCalls).toEqual(['getEmbryo']);
    expect(answer.statements).toHaveLength(1);
    expect(answer.statements[0]?.evidence).toEqual([embryoId]);
    expect(answer.conflicts).toHaveLength(0);
    expect(answer.abstentions).toHaveLength(1);
    expect(answer.abstentions[0]?.reason).toBe('UNVERIFIABLE');
    expect(answer.abstentions[0]?.detail).toContain('E-26-9999');

    const saved = await prisma.client.askMessage.findUniqueOrThrow({ where: { id: messageId } });
    expect(saved.evidenceIds).toEqual([embryoId]);
    expect(saved.inputTokens).toBe(300);
    expect(Array.isArray(saved.toolCalls)).toBe(true);
  });

  it('turns a forbidden lookup into an ACCESS_DENIED tool result, never a leak', async () => {
    const customerUser = await prisma.client.user.findFirstOrThrow({ where: { role: 'CUSTOMER' } });
    const foreign = await prisma.client.embryo.findFirstOrThrow({
      where: { customerId: { not: customerUser.customerId ?? '' } },
    });
    const { result, record } = await tools.execute(
      { userId: customerUser.id, role: 'CUSTOMER', customerId: customerUser.customerId },
      'getEmbryo',
      { id: foreign.id },
    );
    const { error } = result as { error: string };
    expect(error).toBe('ACCESS_DENIED');
    expect(record.ok).toBe(false);
    expect(record.idsReturned).toEqual([]);
    // Nor a flight record: a run's trace is the platform's, and the platform is staff's.
    const anyRun = await prisma.client.askMessage.findFirst({ where: { role: 'ASSISTANT' }, select: { id: true } });
    if (anyRun)
      await expect(
        ask.flight({ userId: customerUser.id, role: 'CUSTOMER', customerId: customerUser.customerId }, anyRun.id),
      ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('rejects malformed tool input before touching the database', async () => {
    const { result, record } = await tools.execute(recipsActor, 'getDaySheet', { date: 'not-a-date' });
    expect(record.ok).toBe(false);
    expect(result).toMatchObject({ error: 'INVALID_INPUT' });
  });
});

/** A model that is away: every turn times out, the way a hosted provider does when the network is not there. */
function absentClient(): ModelClient {
  const parse = (): Promise<unknown> => {
    const error = new Error('The operation was aborted due to timeout');
    error.name = 'TimeoutError';
    return Promise.reject(error);
  };
  return { messages: { parse } as unknown as Anthropic['messages'] };
}

describe('AskService when the model is away', () => {
  const modules: TestingModule[] = [];
  let prisma: PrismaService;
  let ask: AskService;
  let admin: { userId: string; role: 'ADMIN'; customerId: null };
  let recipId: string;

  beforeAll(async () => {
    const probe = await tracked(createTestModule({ imports: [ReproductionModule] }));
    prisma = probe.get(PrismaService);
    const adminUser = await prisma.client.user.findFirstOrThrow({ where: { role: 'ADMIN' } });
    admin = { userId: adminUser.id, role: 'ADMIN', customerId: null };
    recipId =
      ((await prisma.client.setting.findUnique({ where: { key: 'story' } }))?.value as { recipId?: string } | null)
        ?.recipId ?? (await prisma.client.horse.findFirstOrThrow({ where: { kind: 'RECIPIENT' } })).id;
    const moduleRef = await tracked(
      createTestModule({
        imports: [ReproductionModule, OperationsModule, BillingModule, AccountingModule],
        providers: [ReviewCheckpointer, AskTools, AskService, { provide: ANTHROPIC_CLIENT, useValue: absentClient() }],
      }),
    );
    ask = moduleRef.get(AskService);
  });

  afterAll(async () => {
    await Promise.all(modules.map((m) => m.close()));
  });

  async function tracked(pending: Promise<TestingModule>): Promise<TestingModule> {
    const m = await pending;
    modules.push(m);
    return m;
  }

  it('answers from the deterministic composer, verified, and the run says which model was tried and why it did not answer', async () => {
    const { answer, messageId } = await ask.askOnce(admin, `Why can't ${recipId} leave?`);
    // A valid answer in the same shape: statements or abstentions, never an error.
    expect(answer.statements.length + answer.abstentions.length).toBeGreaterThan(0);

    const saved = await prisma.client.askMessage.findUniqueOrThrow({ where: { id: messageId } });
    expect(saved.model).toMatch(/^offline/);
    const phases = saved.phases as Record<string, unknown>;
    expect(phases['fallbackFrom']).toBe('claude-opus-5');
    expect(phases['fallbackReason']).toBe('timeout');

    const record = await ask.flight(admin, messageId);
    const names = record?.steps.map((s) => `${s.name}:${s.status}`) ?? [];
    expect(names).toContain('model explanation:failed');
    expect(names.indexOf('model explanation:failed')).toBeLessThan(names.indexOf('deterministic composer:ok'));
    expect(record?.steps.find((s) => s.name === 'verifier')?.status).toBe('ok');
  });
});
