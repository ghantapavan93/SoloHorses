import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import {
  classifyInbound,
  formatIntakeConfirmation,
  formatIntakeQuestion,
  HELP_REPLY,
  parseIntakeMessage,
  resolveArrival,
  STOP_REPLY,
  type Actor,
  type IntakeParse,
} from '@daysheet/domain';
import type { Prisma } from '@daysheet/db';
import { AuditService } from '../../../platform/audit/audit.service';
import { CodesService } from '../../../platform/codes/codes.service';
import { ClockService } from '../../../platform/clock/clock.service';
import { PrismaService } from '../../../platform/persistence/prisma.service';
import { OutboxService } from '../../../platform/events/outbox.service';
import { JobsService } from '../../../platform/queue/jobs.service';
import { ReproductionEvents, type EmbryoExpectedPayload, type IntakeConfirmedPayload } from '../domain/events';
import { MessagingService } from '../../../platform/messaging/messaging.provider';

/**
 * Embryo intake by text. Inbound → parsed → a person confirms → records exist → reply.
 * "A text is not confirmed until we reply" is enforced by the state machine: nothing is
 * created before CONFIRMED, and CONFIRMED always sends the reply that carries the IDs.
 */
@Injectable()
export class IntakeService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly clock: ClockService,
    private readonly jobs: JobsService,
    private readonly messaging: MessagingService,
    private readonly codes: CodesService,
    private readonly events: OutboxService,
  ) {}

  private get db() {
    return this.prisma.client;
  }

  /** Called by the signed webhook or the simulator. Idempotent on the provider message id. */
  async receive(input: {
    from: string;
    to: string;
    body: string;
    providerMessageId: string | null;
    simulated: boolean;
  }) {
    if (input.providerMessageId) {
      const existing = await this.db.message.findUnique({ where: { providerMessageId: input.providerMessageId } });
      if (existing) return { messageId: existing.id, duplicate: true, classification: 'DUPLICATE' as const };
    }
    const customer = await this.db.customer.findFirst({ where: { phone: input.from } });
    const classification = classifyInbound(input.body);
    const parsed =
      classification === 'INTAKE'
        ? parseIntakeMessage(input.body, { referenceYear: Number(this.clock.today().slice(0, 4)) })
        : null;

    const message = await this.db.message.create({
      data: {
        direction: 'IN',
        channel: 'SMS',
        status: parsed ? 'PARSED' : 'RECEIVED',
        fromAddress: input.from,
        toAddress: input.to,
        body: input.body,
        parsed: parsed as unknown as Prisma.InputJsonValue,
        customerId: customer?.id ?? null,
        providerMessageId: input.providerMessageId,
      },
    });
    await this.audit.record({
      actor: null,
      source: 'WEBHOOK',
      action: 'message.received',
      entityType: 'Message',
      entityId: message.id,
      after: { from: input.from, classification, simulated: input.simulated, customerId: customer?.id ?? null },
    });

    // Carrier keywords are answered immediately and automatically — the only auto-replies.
    if (classification === 'STOP') {
      if (customer) await this.db.customer.update({ where: { id: customer.id }, data: { smsOptedOut: true } });
      await this.queueReply(message.id, input.from, STOP_REPLY, customer?.id ?? null, true);
    } else if (classification === 'HELP') {
      await this.queueReply(message.id, input.from, HELP_REPLY, customer?.id ?? null, true);
    }
    return { messageId: message.id, duplicate: false, classification };
  }

  async inbox(actor: Actor) {
    if (actor.role === 'CUSTOMER') throw new ForbiddenException();
    return this.db.message.findMany({
      where: { direction: 'IN' },
      orderBy: { createdAt: 'desc' },
      take: 100,
      include: { customer: true, embryos: { select: { id: true, status: true } } },
    });
  }

  async outbox(actor: Actor) {
    if (actor.role === 'CUSTOMER') throw new ForbiddenException();
    return this.db.message.findMany({
      where: { direction: 'OUT' },
      orderBy: { createdAt: 'desc' },
      take: 100,
      include: { customer: true },
    });
  }

  /**
   * A person confirms the reading, optionally correcting fields and choosing the customer and
   * the parents. Embryo records are created, the reply goes out, and the text is CONFIRMED.
   */
  async confirm(
    actor: Actor,
    messageId: string,
    corrections: Partial<IntakeParse> & {
      customerId?: string;
      sireId?: string | null;
      damId?: string | null;
      count?: number;
    },
  ) {
    const message = await this.db.message.findUnique({ where: { id: messageId } });
    if (!message || message.direction !== 'IN') throw new NotFoundException('message not found');
    if (message.status === 'CONFIRMED') throw new BadRequestException('already confirmed');
    const parsed = { ...((message.parsed as unknown as IntakeParse | null) ?? emptyParse()), ...corrections };
    const customerId = corrections.customerId ?? message.customerId;
    if (!customerId) throw new BadRequestException('choose the customer before confirming');
    const count = corrections.count ?? parsed.embryoCount ?? 1;
    if (count < 1 || count > 12) throw new BadRequestException('embryo count must be between 1 and 12');
    if (!parsed.sireName && !corrections.sireId) throw new BadRequestException('sire is required');
    if (!parsed.damName && !corrections.damId) throw new BadRequestException('dam is required');

    const today = this.clock.today();
    const season = Number(today.slice(0, 4));
    const expectedOn = resolveArrival(parsed.expectedArrival, today);
    const embryoIds = await this.db.$transaction(async (tx) => {
      const ids: string[] = [];
      for (let i = 0; i < count; i += 1) {
        const id = await this.codes.next('embryo', season, tx);
        ids.push(id);
        const source = parsed.kind === 'FLUSH' ? 'FLUSH' : 'SHIPPED_IN';
        await tx.embryo.create({
          data: {
            id,
            source,
            status: parsed.kind === 'THAWED' ? 'FROZEN' : 'EXPECTED',
            customerId,
            sireId: corrections.sireId ?? null,
            damId: corrections.damId ?? null,
            sireName: parsed.sireName,
            damName: parsed.damName,
            icsiOrOvulationOn: parsed.eventDate ? new Date(`${parsed.eventDate}T12:00:00Z`) : null,
            expectedOn: expectedOn ? new Date(`${expectedOn}T18:00:00Z`) : null,
            sendingVet: parsed.sendingVet,
            storageTank: parsed.kind === 'THAWED' ? parsed.storage : null,
            intakeMessageId: message.id,
          },
        });
        await this.audit.record(
          {
            actor,
            source: 'UI',
            action: 'embryo.created_from_intake',
            entityType: 'Embryo',
            entityId: id,
            after: {
              messageId: message.id,
              cross: `${parsed.sireName ?? '?'} x ${parsed.damName ?? '?'}`,
              kind: parsed.kind,
              expectedOn,
            },
          },
          tx,
        );
        const expected: EmbryoExpectedPayload = {
          embryoId: id,
          customerId,
          source,
          expectedOn,
          plannedRecipientId: null,
          intakeMessageId: message.id,
        };
        await this.events.append(tx, {
          aggregateType: 'Embryo',
          aggregateId: id,
          type: ReproductionEvents.EmbryoExpected,
          payload: expected,
        });
      }
      await tx.message.update({ where: { id: message.id }, data: { status: 'CONFIRMED', customerId, parsed: parsed } });
      await this.audit.record(
        {
          actor,
          source: 'UI',
          action: 'intake.confirmed',
          entityType: 'Message',
          entityId: message.id,
          after: { embryoIds: ids, corrections: Object.keys(corrections) },
        },
        tx,
      );
      const confirmed: IntakeConfirmedPayload = {
        messageId: message.id,
        customerId,
        embryoIds: ids,
        replyMessageId: null,
      };
      await this.events.append(tx, {
        aggregateType: 'Message',
        aggregateId: message.id,
        type: ReproductionEvents.IntakeConfirmed,
        payload: confirmed,
      });
      return ids;
    });

    const reply = formatIntakeConfirmation({ embryoIds, parse: parsed });
    await this.queueReply(message.id, message.fromAddress, reply, customerId, false);
    await this.events.flush();
    return { embryoIds, reply };
  }

  async askForMissing(actor: Actor, messageId: string) {
    const message = await this.db.message.findUnique({ where: { id: messageId } });
    if (!message) throw new NotFoundException('message not found');
    const parsed = (message.parsed as unknown as IntakeParse | null) ?? emptyParse();
    const reply = formatIntakeQuestion(parsed);
    await this.queueReply(message.id, message.fromAddress, reply, message.customerId, false);
    await this.audit.record({
      actor,
      source: 'UI',
      action: 'intake.asked_for_missing',
      entityType: 'Message',
      entityId: message.id,
      after: { missing: parsed.missing },
    });
    return { reply };
  }

  async reject(actor: Actor, messageId: string, reason: string) {
    const message = await this.db.message.findUnique({ where: { id: messageId } });
    if (!message) throw new NotFoundException('message not found');
    await this.db.message.update({ where: { id: messageId }, data: { status: 'REJECTED' } });
    await this.audit.record({
      actor,
      source: 'UI',
      action: 'intake.rejected',
      entityType: 'Message',
      entityId: messageId,
      after: { reason },
    });
    return { rejected: true };
  }

  private async queueReply(
    inReplyToId: string,
    to: string,
    body: string,
    customerId: string | null,
    automatic: boolean,
  ): Promise<void> {
    const customer = customerId ? await this.db.customer.findUnique({ where: { id: customerId } }) : null;
    if (customer?.smsOptedOut && !automatic) return; // never message an opted-out number, except the STOP acknowledgement itself
    // The row and the intent to send it commit together; the flush hands the job off.
    await this.db.$transaction(async (tx) => {
      const out = await tx.message.create({
        data: {
          direction: 'OUT',
          channel: 'SMS',
          status: 'QUEUED',
          fromAddress: this.messaging.intakeNumber,
          toAddress: to,
          body,
          customerId,
          inReplyToId,
        },
      });
      await this.jobs.enqueue('send-message', { messageId: out.id }, { jobId: `send_${out.id}`, tx });
    });
    await this.jobs.flushPending();
  }

  // ───────────────────────────── owner digest ─────────────────────────────

  async digestPreview(actor: Actor, customerId: string) {
    if (actor.role === 'CUSTOMER' && actor.customerId !== customerId) throw new ForbiddenException();
    const customer = await this.db.customer.findUnique({
      where: { id: customerId },
      include: {
        embryos: {
          where: { status: { in: ['EXPECTED', 'IN_TRANSIT', 'ARRIVED', 'FROZEN', 'TRANSFERRED', 'PREGNANT'] } },
          include: {
            sire: true,
            dam: true,
            transfers: {
              include: { recipient: true, checks: { orderBy: { performedOn: 'desc' }, take: 1 } },
              orderBy: { performedOn: 'desc' },
              take: 1,
            },
          },
          orderBy: { id: 'asc' },
        },
      },
    });
    if (!customer) throw new NotFoundException(`${customerId} not found`);
    const today = this.clock.today();
    const lines = customer.embryos.map((e) => {
      const t = e.transfers[0];
      const chk = t?.checks[0];
      const cross = `${e.sire?.name ?? e.sireName ?? '?'} x ${e.dam?.name ?? e.damName ?? '?'}`;
      if (!t)
        return `${e.id} · ${cross} · ${e.status.toLowerCase().replace(/_/g, ' ')}${e.storageTank ? ` (tank ${e.storageTank})` : ''}`;
      const day = Math.round((new Date(`${today}T12:00:00Z`).getTime() - t.performedOn.getTime()) / 86_400_000) + 7;
      const last = chk
        ? `last checked ${chk.performedOn.toISOString().slice(0, 10)} (day ${chk.dayNumber}, ${chk.result.toLowerCase()})`
        : 'not yet checked';
      return `${e.id} · ${cross} · Recip #${t.recipient.recipNumber ?? '?'} · ${e.status.toLowerCase()} · day ${day} · ${last}`;
    });
    const header = `${customer.displayName} — embryo update ${today}`;
    const sms = [
      header,
      ...lines.slice(0, 8),
      lines.length > 8 ? `…and ${lines.length - 8} more by email.` : null,
      'Reply with questions. Reply STOP to opt out.',
    ]
      .filter(Boolean)
      .join('\n');
    const email = [header, '', ...lines, '', 'Questions? Reply to this email or text the Recip Farm line.'].join('\n');
    return {
      customer: {
        id: customer.id,
        name: customer.displayName,
        phone: customer.phone,
        email: customer.email,
        smsOptedOut: customer.smsOptedOut,
      },
      lines,
      sms,
      email,
      today,
    };
  }

  async sendDigest(actor: Actor, customerId: string, channels: ('SMS' | 'EMAIL')[]) {
    if (actor.role === 'CUSTOMER') throw new ForbiddenException();
    const preview = await this.digestPreview(actor, customerId);
    const queued: string[] = [];
    for (const channel of channels) {
      const to = channel === 'SMS' ? preview.customer.phone : preview.customer.email;
      if (!to) continue;
      if (channel === 'SMS' && preview.customer.smsOptedOut) continue;
      const out = await this.db.message.create({
        data: {
          direction: 'OUT',
          channel,
          status: 'QUEUED',
          fromAddress: channel === 'SMS' ? this.messaging.intakeNumber : 'digest',
          toAddress: to,
          body: channel === 'SMS' ? preview.sms : preview.email,
          customerId,
        },
      });
      await this.jobs.enqueue('send-message', { messageId: out.id }, { jobId: `send_${out.id}` });
      queued.push(out.id);
    }
    await this.audit.record({
      actor,
      source: 'UI',
      action: 'digest.sent',
      entityType: 'Customer',
      entityId: customerId,
      after: { channels, queued, lines: preview.lines.length },
    });
    return {
      queued,
      skipped: channels.filter((c) =>
        c === 'SMS' ? !preview.customer.phone || preview.customer.smsOptedOut : !preview.customer.email,
      ),
    };
  }
}

function emptyParse(): IntakeParse {
  return {
    kind: 'UNKNOWN',
    stage: 'UNKNOWN',
    expectedFlushOn: null,
    sireName: null,
    damName: null,
    eventDate: null,
    embryoCount: null,
    storage: null,
    sendingVet: null,
    expectedArrival: null,
    missing: ['sireName', 'damName'],
    confidence: 0,
  };
}
