import { Injectable, Logger } from '@nestjs/common';
import { Resend } from 'resend';
import twilio from 'twilio';
import { EnvService } from '../config/env.module';

/**
 * Outbound messaging port. SMS through Twilio and email through Resend when keys are
 * present; otherwise a labeled simulator that records what *would* have been sent.
 * Inbound SMS arrives as a signed webhook (see the controller); the simulator has a form.
 */

export interface SendResult {
  providerMessageId: string | null;
  simulated: boolean;
}

export interface MessagingProvider {
  readonly smsMode: 'live' | 'simulated';
  readonly emailMode: 'live' | 'simulated';
  readonly intakeNumber: string;
  sendSms(to: string, body: string): Promise<SendResult>;
  sendEmail(to: string, subject: string, text: string): Promise<SendResult>;
  /** Verify an inbound Twilio request. Always false in simulated mode — use the simulator form instead. */
  verifyInbound(signature: string | undefined, url: string, params: Record<string, string>): boolean;
}

@Injectable()
export class MessagingService implements MessagingProvider {
  readonly smsMode: 'live' | 'simulated';
  readonly emailMode: 'live' | 'simulated';
  readonly intakeNumber: string;
  private readonly logger = new Logger(MessagingService.name);
  private readonly twilioClient: ReturnType<typeof twilio> | null;
  private readonly resend: Resend | null;
  private readonly fromNumber: string;
  private readonly authToken: string;
  private readonly fromEmail: string;

  constructor(envService: EnvService) {
    const { env } = envService;
    this.smsMode = env.TWILIO_ACCOUNT_SID && env.TWILIO_AUTH_TOKEN && env.TWILIO_FROM_NUMBER ? 'live' : 'simulated';
    this.emailMode = env.RESEND_API_KEY ? 'live' : 'simulated';
    this.intakeNumber = env.TWILIO_INTAKE_NUMBER || env.TWILIO_FROM_NUMBER || '+15550100200';
    this.fromNumber = env.TWILIO_FROM_NUMBER || '+15550100200';
    this.authToken = env.TWILIO_AUTH_TOKEN;
    this.fromEmail = env.DIGEST_FROM_EMAIL;
    this.twilioClient = this.smsMode === 'live' ? twilio(env.TWILIO_ACCOUNT_SID, env.TWILIO_AUTH_TOKEN) : null;
    this.resend = this.emailMode === 'live' ? new Resend(env.RESEND_API_KEY) : null;
    if (this.smsMode === 'simulated')
      this.logger.warn('Twilio credentials absent — SMS is simulated (logged, not sent).');
    if (this.emailMode === 'simulated') this.logger.warn('Resend key absent — email is simulated (logged, not sent).');
  }

  async sendSms(to: string, body: string): Promise<SendResult> {
    if (!this.twilioClient) {
      this.logger.log(`[sim sms] to=${to} body=${JSON.stringify(body)}`);
      return { providerMessageId: `SM_sim_${Date.now().toString(36)}`, simulated: true };
    }
    const message = await this.twilioClient.messages.create({ to, from: this.fromNumber, body });
    return { providerMessageId: message.sid, simulated: false };
  }

  async sendEmail(to: string, subject: string, text: string): Promise<SendResult> {
    if (!this.resend) {
      this.logger.log(`[sim email] to=${to} subject=${JSON.stringify(subject)}`);
      return { providerMessageId: `em_sim_${Date.now().toString(36)}`, simulated: true };
    }
    const result = await this.resend.emails.send({ from: this.fromEmail, to, subject, text });
    if (result.error) throw new Error(`Resend: ${result.error.message}`);
    return { providerMessageId: result.data?.id ?? null, simulated: false };
  }

  verifyInbound(signature: string | undefined, url: string, params: Record<string, string>): boolean {
    if (this.smsMode !== 'live' || !signature) return false;
    return twilio.validateRequest(this.authToken, signature, url, params);
  }
}
