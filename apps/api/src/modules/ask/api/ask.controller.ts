import { Body, Controller, Delete, Get, NotFoundException, Param, Post, Res } from '@nestjs/common';
import type { Actor } from '@daysheet/domain';
import type { Response } from 'express';
import { z } from 'zod';
import { CurrentActor } from '../../../platform/security/actor';
import { Requires } from '../../../platform/security/permission.guard';
import { ZodBodyPipe } from '../../../platform/http/zod-body.pipe';
import { RateLimit } from '../../../platform/resilience/rate-limit';
import { AskService } from '../application/ask.service';
import { authorityCatalog } from '../application/authority';

const AskSchema = z.object({
  question: z.string().min(2).max(1_000),
  conversationId: z.string().nullable().default(null),
  // Where the question comes from: the page, and the record on it. Data about the asker's view, never an instruction.
  context: z
    .object({
      path: z.string().max(200).nullable().default(null),
      entityId: z.string().max(40).nullable().default(null),
    })
    .nullable()
    .default(null),
});

const FeedbackSchema = z.object({
  rating: z.enum(['UP', 'DOWN']),
  correction: z.string().max(600).nullable().default(null),
});

const PromoteSchema = z.object({
  category: z.enum([
    'GROUNDING',
    'ABSTAIN',
    'CONFLICT',
    'PERMISSION',
    'INJECTION',
    'VETERINARY_BOUNDARY',
    'FINANCIAL_BOUNDARY',
    'STRUCTURE',
    'TERMINOLOGY',
    'MEMORY',
  ]),
  expected: z.record(z.string(), z.unknown()),
  alsoRemember: z
    .object({ scope: z.enum(['USER', 'ORG']), key: z.string().min(1).max(60), value: z.string().min(1).max(300) })
    .nullable()
    .default(null),
});

const MemorySchema = z.object({
  scope: z.enum(['USER', 'ORG']).default('USER'),
  key: z.string().min(1).max(60),
  value: z.string().min(1).max(300),
});

const CloseRequestSchema = z.object({ note: z.string().max(300).nullable().optional() }).optional();
const RequestSchema = z.object({
  subject: z.string().min(1).max(120),
  body: z.string().min(1).max(2_000),
  evidenceIds: z.array(z.string()).max(12).default([]),
});

@Controller()
export class AskController {
  constructor(private readonly ask: AskService) {}

  /** Server-sent events: tool progress, then the verified answer. */
  @Post('ask')
  @RateLimit({ name: 'ask', points: 20, windowMs: 60_000, scope: 'user' })
  async askStream(
    @CurrentActor() actor: Actor,
    @Body(new ZodBodyPipe(AskSchema)) body: z.infer<typeof AskSchema>,
    @Res() res: Response,
  ): Promise<void> {
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache, no-transform');
    res.setHeader('Connection', 'keep-alive');
    res.flushHeaders();
    try {
      for await (const event of this.ask.ask(actor, body.question, body.conversationId, body.context)) {
        res.write(`event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`);
      }
    } catch (error) {
      res.write(`event: error\ndata: ${JSON.stringify({ type: 'error', message: (error as Error).message })}\n\n`);
    } finally {
      res.end();
    }
  }

  @Get('ask/status')
  async status() {
    const cap = await this.ask.checkSpendCap();
    return {
      live: this.ask.live,
      provider: this.ask.provider,
      model: this.ask.live ? this.ask.model : 'offline',
      spend: cap,
      review: { graph: 'ExceptionReviewGraph', durable: this.ask.durableReview },
    };
  }

  /** The authority boundary as data: read-only tools, the one gated action, the refused capabilities. */
  @Get('ask/authority')
  authority() {
    return authorityCatalog();
  }

  /** The last real run, for a diagram that shows what the assistant actually reached for. */
  @Get('ask/last-run')
  lastRun() {
    return this.ask.lastRun();
  }

  /** The flight recorder: recent answers, and one answer stage by stage. */
  @Get('ask/runs')
  @Requires('read', 'platform')
  runs() {
    return this.ask.recentRuns();
  }

  /** One run as a flight record: what ran, for how long, what came back — never a thought. */
  @Get('ask/runs/:id/flight')
  @Requires('read', 'platform')
  async flight(@CurrentActor() actor: Actor, @Param('id') id: string) {
    const record = await this.ask.flight(actor, id);
    if (!record) throw new NotFoundException(`run ${id} not found`);
    return record;
  }

  @Get('ask/runs/:id')
  @Requires('read', 'platform')
  async run(@Param('id') id: string) {
    const run = await this.ask.run(id);
    if (!run) throw new NotFoundException(`run ${id} not found`);
    return run;
  }

  @Get('ask/conversations')
  conversations(@CurrentActor() actor: Actor) {
    return this.ask.recentConversations(actor);
  }

  @Get('ask/conversations/:id')
  conversation(@CurrentActor() actor: Actor, @Param('id') id: string) {
    return this.ask.conversation(actor, id);
  }

  @Post('ask/messages/:id/feedback')
  feedback(
    @CurrentActor() actor: Actor,
    @Param('id') id: string,
    @Body(new ZodBodyPipe(FeedbackSchema)) body: z.infer<typeof FeedbackSchema>,
  ) {
    return this.ask.feedback(actor, id, body.rating, body.correction);
  }

  @Post('ask/feedback/:id/promote')
  @Requires('write', 'evals')
  promote(
    @CurrentActor() actor: Actor,
    @Param('id') id: string,
    @Body(new ZodBodyPipe(PromoteSchema)) body: z.infer<typeof PromoteSchema>,
  ) {
    return this.ask.promoteFeedback(actor, id, body.expected, body.category, body.alsoRemember);
  }

  @Get('ask/memory')
  @Requires('read', 'memory')
  memory(@CurrentActor() actor: Actor) {
    return this.ask.listMemory(actor);
  }

  @Post('ask/memory')
  @Requires('write', 'memory')
  remember(@CurrentActor() actor: Actor, @Body(new ZodBodyPipe(MemorySchema)) body: z.infer<typeof MemorySchema>) {
    return this.ask.remember(actor, body.scope, body.key, body.value);
  }

  @Delete('ask/memory/:id')
  @Requires('write', 'memory')
  forget(@CurrentActor() actor: Actor, @Param('id') id: string) {
    return this.ask.forget(actor, id);
  }

  @Post('requests')
  createRequest(
    @CurrentActor() actor: Actor,
    @Body(new ZodBodyPipe(RequestSchema)) body: z.infer<typeof RequestSchema>,
  ) {
    return this.ask.createRequest(actor, body.subject, body.body, body.evidenceIds);
  }

  @Get('requests')
  requests(@CurrentActor() actor: Actor) {
    return this.ask.listRequests(actor);
  }

  /** A person marks a request done; the row keeps its words, the audit line keeps who and why. */
  @Post('requests/:id/close')
  @Requires('write', 'operations')
  closeRequest(
    @CurrentActor() actor: Actor,
    @Param('id') id: string,
    @Body(new ZodBodyPipe(CloseRequestSchema)) body: z.infer<typeof CloseRequestSchema>,
  ) {
    return this.ask.closeRequest(actor, id, body?.note ?? null);
  }
}
