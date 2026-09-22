import { Injectable, Logger } from '@nestjs/common';
import { AuditService } from '../audit/audit.service';
import { OutboxService } from '../events/outbox.service';
import { PrismaService } from '../persistence/prisma.service';
import { UnrecoverableJobError } from '../queue/jobs.service';
import { MessagingService } from './messaging.provider';

/** Email subject for anything the operation sends about embryos; the body says the rest. */
const EMAIL_SUBJECT = 'Embryo update';

/** The event the operations context turns into an exception a person owns. */
export const MESSAGE_DELIVERY_UNKNOWN = 'MessageDeliveryUnknown';

/**
 * What a failed send means, which is not one thing. The provider said no (a bad number, a
 * rejected body): final, nothing was sent. The provider was not there (a 5xx before it took the
 * request): nothing was sent, try again. The request went out and no answer came back (a
 * timeout, a dropped connection): the provider may well have sent it, and sending again would
 * send twice. A timeout is never treated as a failure.
 */
export type SendOutcome = 'rejected' | 'unaccepted' | 'unknown';

const UNKNOWN_NAMES = new Set(['TimeoutError', 'AbortError']);
const UNKNOWN_CODES = new Set([
  'ECONNRESET',
  'ETIMEDOUT',
  'EAI_AGAIN',
  'EPIPE',
  'UND_ERR_SOCKET',
  'UND_ERR_HEADERS_TIMEOUT',
]);

export function classifySendError(error: unknown): SendOutcome {
  const e = error as { name?: string; code?: string | number; status?: number; statusCode?: number; cause?: unknown };
  const status = typeof e.status === 'number' ? e.status : typeof e.statusCode === 'number' ? e.statusCode : null;
  if (status !== null) return status >= 500 ? 'unaccepted' : 'rejected';
  const code =
    typeof e.code === 'string'
      ? e.code
      : typeof (e.cause as { code?: string } | undefined)?.code === 'string'
        ? (e.cause as { code: string }).code
        : null;
  if (code !== null)
    return code === 'ECONNREFUSED' || code === 'ENOTFOUND'
      ? 'unaccepted'
      : UNKNOWN_CODES.has(code)
        ? 'unknown'
        : 'unknown';
  if (e.name && UNKNOWN_NAMES.has(e.name)) return 'unknown';
  // A validation error thrown before any request is a rejection; anything else without a status is unknown.
  return 'unknown';
}

/**
 * Delivers one queued outbound Message through the provider and records the outcome.
 * Idempotent: a message already SENT is left alone, so a retried job never sends twice; a
 * message whose outcome is UNKNOWN is left alone too, until a person has reconciled it.
 */
@Injectable()
export class DeliveryService {
  private readonly logger = new Logger(DeliveryService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly messaging: MessagingService,
    private readonly audit: AuditService,
    private readonly outbox: OutboxService,
  ) {}

  async deliver(messageId: string): Promise<void> {
    const db = this.prisma.client;
    const message = await db.message.findUnique({ where: { id: messageId } });
    if (!message || message.direction !== 'OUT' || message.status === 'SENT' || message.status === 'UNKNOWN') return;
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
      const outcome = classifySendError(error);
      const reason = (error as Error).message ?? String(error);
      if (outcome === 'unknown') {
        // The request went out; whether it arrived is the provider's to say. Nothing is sent again by
        // a retry; a person reads the provider's log and decides, from the exception this opens.
        await db.$transaction(async (tx) => {
          await tx.message.update({ where: { id: messageId }, data: { status: 'UNKNOWN' } });
          await this.outbox.append(tx, {
            aggregateType: 'Message',
            aggregateId: messageId,
            type: MESSAGE_DELIVERY_UNKNOWN,
            payload: { messageId, channel: message.channel, error: reason },
          });
          await this.audit.record(
            {
              actor: null,
              source: 'JOB',
              action: 'message.delivery_unknown',
              entityType: 'Message',
              entityId: messageId,
              after: { channel: message.channel, error: reason },
            },
            tx,
          );
        });
        this.logger.warn(
          `message ${messageId}: no answer from the provider after the request went out — outcome unknown, not retried`,
        );
        return;
      }
      await db.message.update({ where: { id: messageId }, data: { status: 'FAILED' } });
      await this.audit.record({
        actor: null,
        source: 'JOB',
        action: 'message.failed',
        entityType: 'Message',
        entityId: messageId,
        after: { channel: message.channel, error: reason, outcome },
      });
      // Rejected: the provider said no, and would again. Unaccepted: it was not there; the attempt is retried.
      if (outcome === 'rejected') throw new UnrecoverableJobError(reason);
      throw error;
    }
  }
}
