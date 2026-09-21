import { BadRequestException, Body, Controller, Get, Headers, HttpCode, Param, Post, Query, Req } from '@nestjs/common';
import type { Actor } from '@daysheet/domain';
import type { Request } from 'express';
import { z } from 'zod';
import { CurrentActor } from '../../../platform/security/actor';
import { Public } from '../../../platform/security/jwt-auth.guard';
import { Requires } from '../../../platform/security/permission.guard';
import { RateLimit } from '../../../platform/resilience/rate-limit';
import { ZodBodyPipe } from '../../../platform/http/zod-body.pipe';
import { IntegrationEventsService } from '../infrastructure/integration-events.service';
import { PaymentsService } from '../application/payments.service';
import { StripeService } from '../infrastructure/stripe.service';

const SimulateSchema = z.object({
  invoiceId: z.string(),
  outcome: z.enum(['succeeded', 'processing', 'failed']),
  method: z.enum(['CARD', 'ACH']).default('CARD'),
});

const ManualPaymentSchema = z.object({
  method: z.enum(['CHECK', 'CASH']),
  amountCents: z.number().int().positive(),
  note: z.string().max(200).nullable().default(null),
});

const ReturnSchema = z.object({ reason: z.string().min(1).max(200) });

const RefundSchema = z.object({
  amountCents: z.number().int().positive(),
  reason: z.string().min(1).max(200),
});

@Controller()
export class PaymentsController {
  constructor(
    private readonly payments: PaymentsService,
    private readonly stripe: StripeService,
    private readonly events: IntegrationEventsService,
  ) {}

  /**
   * Stripe → us. Verifies the signature against the raw bytes, drops the event in the inbox,
   * and answers 200 immediately; processing happens in a job. Stripe retries on anything else.
   */
  @Post('integrations/stripe/webhook')
  @Public()
  @HttpCode(200)
  async stripeWebhook(
    @Req() req: Request & { rawBody?: Buffer },
    @Headers('stripe-signature') signature: string | undefined,
  ) {
    if (!signature || !req.rawBody) throw new BadRequestException('missing stripe-signature or raw body');
    const event = this.stripe.constructEvent(req.rawBody, signature);
    return this.payments.ingestStripeEvent(
      { id: event.id, type: event.type, data: { object: event.data.object as unknown as Record<string, unknown> } },
      false,
    );
  }

  @Get('payments')
  @Requires('read', 'payment')
  list(@CurrentActor() actor: Actor) {
    return this.payments.listPayments(actor);
  }

  @Get('integrations/events')
  @Requires('read', 'accounting')
  recentEvents(@Query('provider') provider?: 'STRIPE' | 'QBO' | 'TWILIO') {
    return this.events.recent(provider);
  }

  @Post('invoices/:id/hosted-link')
  @Requires('read', 'invoice')
  hostedLink(@CurrentActor() actor: Actor, @Param('id') id: string) {
    return this.payments.hostedLink(actor, id);
  }

  @Post('invoices/:id/manual-payment')
  @RateLimit({ name: 'payments', points: 5, windowMs: 60_000, scope: 'user' })
  @Requires('write', 'payment')
  manual(
    @CurrentActor() actor: Actor,
    @Param('id') id: string,
    @Body(new ZodBodyPipe(ManualPaymentSchema)) body: z.infer<typeof ManualPaymentSchema>,
  ) {
    return this.payments.recordManualPayment(actor, id, body.method, body.amountCents, body.note);
  }

  @Post('payments/:id/refund')
  @RateLimit({ name: 'payments', points: 5, windowMs: 60_000, scope: 'user' })
  @Requires('write', 'payment')
  refund(
    @CurrentActor() actor: Actor,
    @Param('id') id: string,
    @Body(new ZodBodyPipe(RefundSchema)) body: z.infer<typeof RefundSchema>,
  ) {
    return this.payments.refund(actor, id, body.amountCents, body.reason);
  }

  /** The bank returned a settled ACH debit; billing records it. The ledger moves one way, and 409 says so if it cannot. */
  @Post('payments/:id/return')
  @RateLimit({ name: 'payments', points: 5, windowMs: 60_000, scope: 'user' })
  @Requires('write', 'payment')
  recordReturn(
    @CurrentActor() actor: Actor,
    @Param('id') id: string,
    @Body(new ZodBodyPipe(ReturnSchema)) body: z.infer<typeof ReturnSchema>,
  ) {
    return this.payments.recordReturn(actor, id, body.reason);
  }

  /** Simulator: the same pipeline, minus Stripe. Available to billing/admin in any mode. */
  @Post('payments/simulate')
  @Requires('write', 'payment')
  simulate(@CurrentActor() actor: Actor, @Body(new ZodBodyPipe(SimulateSchema)) body: z.infer<typeof SimulateSchema>) {
    return this.payments.simulate(actor, body.invoiceId, body.outcome, body.method);
  }

  /** Replay a received event to prove duplicate delivery is harmless. */
  @Post('payments/replay/:eventId')
  @Requires('write', 'payment')
  replay(@Param('eventId') eventId: string) {
    return this.payments.replay(eventId);
  }
}
