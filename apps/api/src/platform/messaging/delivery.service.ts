import { Injectable } from '@nestjs/common';
import { AuditService } from '../audit/audit.service';
import { PrismaService } from '../persistence/prisma.service';
import { MessagingService } from './messaging.provider';

/** Email subject for anything the operation sends about embryos; the body says the rest. */
const EMAIL_SUBJECT = 'Embryo update';

/**
 * Delivers one queued outbound Message through the provider and records the outcome.
 * Idempotent: a message already SENT is left alone, so a retried job never sends twice.
 */
@Injectable()
export class DeliveryService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly messaging: MessagingService,
    private readonly audit: AuditService,
  ) {}

  async deliver(messageId: string): Promise<void> {
    const db = this.prisma.client;
    const message = await db.message.findUnique({ where: { id: messageId } });
    if (!message || message.direction !== 'OUT' || message.status === 'SENT') return;
    try {
      const result =
        message.channel === 'SMS'
          ? await this.messaging.sendSms(message.toAddress, message.body)
          : await this.messaging.sendEmail(message.toAddress, EMAIL_SUBJECT, message.body);
      await db.message.update({
        where: { id: messageId },
        data: { status: 'SENT', sentAt: new Date(), providerMessageId: result.providerMessageId ?? undefined },
      });
      await this.audit.record({
        actor: null,
        source: 'JOB',
        action: 'message.sent',
        entityType: 'Message',
        entityId: messageId,
        after: { channel: message.channel, simulated: result.simulated },
      });
    } catch (error) {
      await db.message.update({ where: { id: messageId }, data: { status: 'FAILED' } });
      await this.audit.record({
        actor: null,
        source: 'JOB',
        action: 'message.failed',
        entityType: 'Message',
        entityId: messageId,
        after: { error: (error as Error).message },
      });
      throw error;
    }
  }
}
