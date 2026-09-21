import {
  Body,
  Controller,
  Get,
  Headers,
  HttpCode,
  Param,
  Post,
  Req,
  ServiceUnavailableException,
  UnauthorizedException,
} from '@nestjs/common';
import type { Actor } from '@daysheet/domain';
import type { Request } from 'express';
import { z } from 'zod';
import { CurrentActor } from '../../../platform/security/actor';
import { Public } from '../../../platform/security/jwt-auth.guard';
import { Requires } from '../../../platform/security/permission.guard';
import { ZodBodyPipe } from '../../../platform/http/zod-body.pipe';
import { EnvService } from '../../../platform/config/env.module';
import { IntakeService } from '../application/intake.service';
import { MessagingService } from '../../../platform/messaging/messaging.provider';

const SimulateInboundSchema = z.object({
  from: z.string().regex(/^\+1\d{10}$/, 'E.164 US number'),
  body: z.string().min(1).max(1_000),
});

const ConfirmSchema = z.object({
  customerId: z.string().optional(),
  sireName: z.string().max(80).nullable().optional(),
  damName: z.string().max(80).nullable().optional(),
  sireId: z.string().nullable().optional(),
  damId: z.string().nullable().optional(),
  eventDate: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .nullable()
    .optional(),
  count: z.number().int().min(1).max(12).optional(),
  kind: z.enum(['ICSI', 'FLUSH', 'THAWED', 'UNKNOWN']).optional(),
  sendingVet: z.string().max(80).nullable().optional(),
  storage: z.string().max(80).nullable().optional(),
  expectedArrival: z.string().max(80).nullable().optional(),
});

const RejectSchema = z.object({ reason: z.string().min(1).max(200) });
const DigestSchema = z.object({ channels: z.array(z.enum(['SMS', 'EMAIL'])).min(1) });

@Controller()
export class IntakeController {
  constructor(
    private readonly intake: IntakeService,
    private readonly messaging: MessagingService,
    private readonly envService: EnvService,
  ) {}

  /** Twilio → us. Form-encoded body; signature over the exact public URL + params. */
  @Post('integrations/twilio/inbound')
  @Public()
  @HttpCode(200)
  async twilioInbound(@Req() req: Request, @Headers('x-twilio-signature') signature: string | undefined) {
    if (this.messaging.smsMode !== 'live')
      throw new ServiceUnavailableException('Twilio is not configured; use POST /intake/simulate-inbound');
    const params = req.body as Record<string, string>;
    const publicUrl = `${this.envService.env.API_URL_PUBLIC ?? ''}${req.originalUrl}`;
    if (!this.messaging.verifyInbound(signature, publicUrl, params))
      throw new UnauthorizedException('bad Twilio signature');
    await this.intake.receive({
      from: params['From'] ?? '',
      to: params['To'] ?? '',
      body: params['Body'] ?? '',
      providerMessageId: params['MessageSid'] ?? null,
      simulated: false,
    });
    // Twilio expects TwiML; an empty response means "no auto-reply from this webhook".
    return '<?xml version="1.0" encoding="UTF-8"?><Response></Response>';
  }

  /** Same pipeline, no carrier: staff paste what a vet would text. */
  @Post('intake/simulate-inbound')
  @Requires('write', 'intake')
  simulate(@Body(new ZodBodyPipe(SimulateInboundSchema)) body: z.infer<typeof SimulateInboundSchema>) {
    return this.intake.receive({
      from: body.from,
      to: this.messaging.intakeNumber,
      body: body.body,
      providerMessageId: `SM_sim_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`,
      simulated: true,
    });
  }

  @Get('intake')
  @Requires('read', 'intake')
  inbox(@CurrentActor() actor: Actor) {
    return this.intake.inbox(actor);
  }

  @Get('intake/outbox')
  @Requires('read', 'intake')
  outbox(@CurrentActor() actor: Actor) {
    return this.intake.outbox(actor);
  }

  @Post('intake/:id/confirm')
  @Requires('write', 'intake')
  confirm(
    @CurrentActor() actor: Actor,
    @Param('id') id: string,
    @Body(new ZodBodyPipe(ConfirmSchema)) body: z.infer<typeof ConfirmSchema>,
  ) {
    return this.intake.confirm(actor, id, body);
  }

  @Post('intake/:id/ask-missing')
  @Requires('write', 'intake')
  askMissing(@CurrentActor() actor: Actor, @Param('id') id: string) {
    return this.intake.askForMissing(actor, id);
  }

  @Post('intake/:id/reject')
  @Requires('write', 'intake')
  reject(
    @CurrentActor() actor: Actor,
    @Param('id') id: string,
    @Body(new ZodBodyPipe(RejectSchema)) body: z.infer<typeof RejectSchema>,
  ) {
    return this.intake.reject(actor, id, body.reason);
  }

  @Get('digests/:customerId/preview')
  @Requires('read', 'embryo')
  digestPreview(@CurrentActor() actor: Actor, @Param('customerId') customerId: string) {
    return this.intake.digestPreview(actor, customerId);
  }

  @Post('digests/:customerId/send')
  @Requires('write', 'intake')
  sendDigest(
    @CurrentActor() actor: Actor,
    @Param('customerId') customerId: string,
    @Body(new ZodBodyPipe(DigestSchema)) body: z.infer<typeof DigestSchema>,
  ) {
    return this.intake.sendDigest(actor, customerId, body.channels);
  }

  @Get('integrations/messaging/status')
  status() {
    return { sms: this.messaging.smsMode, email: this.messaging.emailMode, intakeNumber: this.messaging.intakeNumber };
  }
}
