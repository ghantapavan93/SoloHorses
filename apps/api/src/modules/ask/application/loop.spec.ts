/**
 * The closed loop, without a model: a question asked from the mare's own page, answered in one
 * sentence with three facts and typed doors; the follow-ups that lean on the conversation
 * ("who handles it", "prepare it"); the approval that sends the request; and the assistant's
 * read of what actually stands afterwards — the request is on record, the mare is still
 * blocked. Every door is one of the application's addresses, never a guess.
 */
import type { Actor, Role } from '@daysheet/domain';
import type { TestingModule } from '@nestjs/testing';
import { PrismaService } from '../../../platform/persistence/prisma.service';
import { createTestModule } from '../../../test-support/module';
import { AccountingModule } from '../../accounting/accounting.module';
import { BillingModule } from '../../billing/billing.module';
import { ProposalsService } from '../../operations/application/proposals.service';
import { OperationsModule } from '../../operations/operations.module';
import { ReproductionModule } from '../../reproduction/reproduction.module';
import { AskService, type AskEvent } from './ask.service';
import { AskTools } from './ask.tools';
import type { AskContext } from './review-graph';
import { ReviewCheckpointer } from './review-graph';

type Answer = Extract<AskEvent, { type: 'answer' }>;

describe('the closed loop: ask → open → prepare → approve → confirm (offline)', () => {
  let moduleRef: TestingModule;
  let prisma: PrismaService;
  let ask: AskService;
  let recipId: string;

  beforeAll(async () => {
    process.env.ANTHROPIC_API_KEY = '';
    moduleRef = await createTestModule({
      imports: [ReproductionModule, OperationsModule, BillingModule, AccountingModule],
      providers: [ReviewCheckpointer, AskTools, AskService],
    });
    prisma = moduleRef.get(PrismaService);
    ask = moduleRef.get(AskService);
    recipId = (
      (await prisma.client.setting.findUniqueOrThrow({ where: { key: 'story' } })).value as { recipId: string }
    ).recipId;
    // An earlier run may have sent her request already; the loop starts with none open.
    await prisma.client.request.updateMany({
      where: { status: 'OPEN', evidenceIds: { has: recipId } },
      data: { status: 'CLOSED' },
    });
  });

  afterAll(async () => {
    await moduleRef.close();
  });

  async function actorFor(role: Role): Promise<Actor> {
    const user = await prisma.client.user.findFirstOrThrow({ where: { role } });
    return { userId: user.id, role, customerId: user.customerId };
  }

  async function turn(
    actor: Actor,
    question: string,
    conversationId: string | null,
    context: AskContext | null,
  ): Promise<Answer> {
    let answer: Answer | null = null;
    for await (const event of ask.ask(actor, question, conversationId, context)) {
      if (event.type === 'answer') answer = event;
      if (event.type === 'error') throw new Error(event.message);
    }
    if (!answer) throw new Error('no answer');
    return answer;
  }

  it('from her page, "why can\'t she leave" is one sentence, three facts, and doors the application owns', async () => {
    const recips = await actorFor('RECIPS');
    const first = await turn(recips, "Why can't she leave?", null, { path: `/horses/${recipId}`, entityId: recipId });
    const { card } = first;
    expect(card.subject).toEqual({ entityType: 'recipient', entityId: recipId });
    expect(card.answer).toMatch(/no video confirmation/i);
    expect(card.answer).toMatch(/The vet owns the next step\.$/);
    expect(card.answer.split(/(?<=\.)\s+/).length).toBeLessThanOrEqual(2);
    expect(card.facts.length).toBeLessThanOrEqual(3);
    expect(card.facts.map((f) => f.label)).toContain('Leaves');
    expect(typeof card.stateId).toBe('string');

    // The workspace opens her record at the part that matters: the view, not merely a door among doors.
    expect(card.view).toMatchObject({
      kind: 'entity',
      entityId: recipId,
      focus: 'departure',
      href: `/horses/${recipId}?focus=departure`,
    });
    expect(card.targets.find((t) => t.label === `Open ${recipId}`)).toBeUndefined();
    const why = card.targets.find((t) => t.label === 'Show why');
    expect(why).toMatchObject({ entityType: 'signal', peek: 'xray' });
    expect(why?.href).toMatch(/^\/signals\/OX-\d{2}-\d{4,6}$/);
    for (const target of card.targets)
      expect(target.href).toMatch(
        /^\/(horses|embryos|signals|decisions|contracts|customers|money|settlement|operations)/,
      );
    expect(card.actions.map((a) => [a.label, a.action])).toEqual([['Prepare vet request', 'PREPARE_VET_REQUEST']]);
    expect(card.actions[0]?.question).toContain(recipId);
    // The full answer is still there, verified: the card is a reading of it, not a replacement.
    expect(first.answer.statements.length).toBeGreaterThan(0);
    expect(first.verification.ok).toBe(true);
  });

  it('"what needs the vet today" is a count, the sharpest deadline, one row per case, and the vet queue as the view', async () => {
    const answer = await turn(await actorFor('ADMIN'), 'What needs the vet today?', null, {
      path: '/today',
      entityId: null,
    });
    const { card } = answer;
    expect(card.answer).toMatch(/^\d+ cases? needs? veterinary action\./);
    expect(card.answer.split(/(?<=\.)\s+/).length).toBeLessThanOrEqual(2);
    expect(card.view).toMatchObject({ kind: 'worklist', owner: 'VET', href: '/operations?owner=VET' });
    expect(card.targets.length).toBeGreaterThan(0);
    expect(card.targets.length).toBeLessThanOrEqual(3);
    for (const row of card.targets) {
      expect(row.entityType).toBe('signal');
      expect(row.label).toMatch(/^(R|E|H)-\S+ · /);
      expect(row.detail).toMatch(/^(now|\d+[mhd])$/);
    }
  });

  it('"what happened with a payment" is three systems in one line, one fact per system, and the money trail as the view; a code that is not there is said plainly', async () => {
    const paid = await prisma.client.payment.findFirstOrThrow({
      where: { status: 'SUCCEEDED' },
      orderBy: { id: 'asc' },
    });
    const trail = await turn(await actorFor('ADMIN'), `What happened with ${paid.id}?`, null, {
      path: '/money',
      entityId: null,
    });
    expect(trail.card.answer).toMatch(/in the ledger; Stripe .*; the books/);
    expect(trail.card.facts.map((f) => f.label)).toEqual(['Ledger', 'Stripe', 'Books']);
    expect(trail.card.view).toMatchObject({ kind: 'money-trail', href: `/money?focus=${paid.id}` });

    const missing = await turn(await actorFor('ADMIN'), 'What happened with PAY-26-9999?', null, null);
    expect(missing.answer.abstentions[0]?.reason).toBe('NO_RECORD');
    expect(missing.answer.abstentions[0]?.detail).toMatch(/^I can't find PAY-26-9999/);
    expect(missing.card.targets.map((t) => [t.label, t.href])).toEqual([['Open Money', '/money?focus=PAY-26-9999']]);
  });

  it('a greeting gets a line back and leaves no run behind', async () => {
    const before = await prisma.client.askMessage.count();
    const hello = await turn(await actorFor('ADMIN'), 'Hello', null, null);
    expect(hello.card.answer).toMatch(/^Ask about a mare/);
    expect(hello.messageId).toBe('');
    expect(await prisma.client.askMessage.count()).toBe(before);
  });

  it('follows the conversation without the id: who handles it, prepare it, approve it, and what actually stands afterwards', async () => {
    const recips = await actorFor('RECIPS');
    const opened = await turn(recips, "Why can't she leave?", null, { path: `/horses/${recipId}`, entityId: recipId });
    const conversationId = opened.conversationId;

    const who = await turn(recips, 'Who needs to handle it?', conversationId, null);
    expect(who.card.answer).toMatch(/^The vet owns the next step/);
    expect(who.answer.statements[0]?.evidence).toContain(recipId);

    const prepared = await turn(recips, 'Prepare it.', conversationId, null);
    expect(prepared.proposals).toHaveLength(1);
    const proposal = prepared.proposals[0]!;
    expect(proposal).toMatchObject({
      kind: 'REQUEST_VETERINARY_CONFIRMATION',
      status: 'PROPOSED',
      payload: { recipId },
    });
    expect(prepared.card.answer).toMatch(/^Prepared, not sent/);
    expect(prepared.card.subject).toEqual({ entityType: 'recipient', entityId: recipId });
    // Nothing has been sent: no request about her yet.
    expect(await prisma.client.request.count({ where: { status: 'OPEN', evidenceIds: { has: recipId } } })).toBe(0);

    // A person approves on the page: the same rule-checked service, the request under their name.
    const outcome = await moduleRef.get(ProposalsService).approve(await actorFor('ADMIN'), proposal.id);
    expect(outcome.status).toBe('APPROVED');
    const requestId = (outcome as { result?: { requestId?: string } }).result?.requestId;
    expect(requestId).toMatch(/^RQ-\d{2}-\d{4,6}$/);

    // The assistant reads again, now: the request is on record, and she is still blocked — executed is not resolved.
    const after = await turn(recips, 'Is she still blocked?', conversationId, null);
    expect(after.card.answer).toMatch(/^Request RQ-\d{2}-\d{4,6} is open about/);
    expect(after.answer.statements[0]?.evidence).toContain(requestId);
    expect(after.card.answer).toMatch(new RegExp(`${recipId} remains blocked until the vet records the result`));
    expect(after.card.actions).toEqual([]);
    expect(after.card.facts[0]).toMatchObject({ label: 'Request open' });
    expect(after.investigation?.openRequests.map((r) => r.id)).toContain(requestId);
    expect(after.card.stateId).not.toBe(opened.card.stateId);
  });
});
