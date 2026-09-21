import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { addDays, evaluateCheck, gestationDay, type Actor, type CheckResult } from '@daysheet/domain';
import { AuditService } from '../../../platform/audit/audit.service';
import { CodesService } from '../../../platform/codes/codes.service';
import { ClockService } from '../../../platform/clock/clock.service';
import { OutboxService } from '../../../platform/events/outbox.service';
import { PrismaService } from '../../../platform/persistence/prisma.service';
import { VeterinaryEvents, type CheckRecordedPayload, type MilestoneInvoicedPayload } from '../domain/events';

export interface RecordCheckInput {
  transferId: string;
  result: CheckResult;
  dayNumber?: number;
  notes?: string | null;
}

/**
 * A vet records what the ultrasound showed. The domain engine decides what that means for
 * money and status; this service writes it all in one transaction and one audit trail, so
 * "which ultrasound created which invoice" is always answerable.
 */
@Injectable()
export class ChecksService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly clock: ClockService,
    private readonly codes: CodesService,
    private readonly outbox: OutboxService,
  ) {}

  async record(actor: Actor, input: RecordCheckInput) {
    if (actor.role !== 'VET' && actor.role !== 'ADMIN')
      throw new ForbiddenException('only the vet team records checks');
    const db = this.prisma.client;
    const transfer = await db.transfer.findUnique({
      where: { id: input.transferId },
      include: {
        embryo: { include: { contract: true, aspiration: true } },
        recipient: true,
        checks: true,
        invoices: true,
      },
    });
    if (!transfer) throw new NotFoundException(`${input.transferId} not found`);
    if (transfer.embryo.status === 'OPEN' || transfer.embryo.status === 'LOST' || transfer.embryo.status === 'FOALED') {
      throw new BadRequestException(
        `${transfer.embryoId} is ${transfer.embryo.status.toLowerCase()}; nothing to check`,
      );
    }

    const today = this.clock.today();
    const dayNumber = input.dayNumber ?? gestationDay(transfer.performedOn.toISOString().slice(0, 10), today);
    const alreadyIssued = new Set(
      transfer.invoices
        .map((i) => i.kind)
        .filter((k): k is 'LEASE_FEE' | 'ICSI_STALLION_FEE' => k === 'LEASE_FEE' || k === 'ICSI_STALLION_FEE'),
    );
    const season = Number(today.slice(0, 4));
    const checkId = await this.codes.next('check', season);

    const outcome = evaluateCheck({
      checkId,
      transferId: transfer.id,
      embryoId: transfer.embryoId,
      customerId: transfer.embryo.customerId,
      contractId: transfer.embryo.contractId,
      contractType: transfer.embryo.contract?.type ?? null,
      contractStudFeeCents: transfer.embryo.contract?.studFeeCents ?? null,
      embryoSource: transfer.embryo.source,
      embryoWasFrozen: transfer.embryo.storageTank !== null,
      purchasedEmbryo: transfer.embryo.source === 'ICSI' && transfer.embryo.contractId === null,
      dayNumber,
      result: input.result,
      performedOn: today,
      alreadyIssued,
    });

    const created = await db.$transaction(async (tx) => {
      // The barn date, like the clearances and the invoice the rule issues: under the demo clock a
      // check recorded "today" must not carry the real calendar's date onto an April board.
      await tx.pregnancyCheck.create({
        data: {
          id: checkId,
          transferId: transfer.id,
          dayNumber,
          performedOn: new Date(`${today}T15:00:00Z`),
          result: input.result,
          recordedById: actor.userId,
          notes: input.notes ?? null,
        },
      });
      await this.audit.record(
        {
          actor,
          source: 'UI',
          action: 'check.recorded',
          entityType: 'PregnancyCheck',
          entityId: checkId,
          after: { transferId: transfer.id, dayNumber, result: input.result, notes: outcome.notes },
        },
        tx,
      );

      const invoiceIds: string[] = [];
      for (const intent of outcome.invoices) {
        const id = await this.codes.next('invoice', season, tx);
        await tx.invoice.create({
          data: {
            id,
            kind: intent.kind,
            status: 'OPEN',
            customerId: intent.customerId,
            contractId: intent.contractId,
            embryoId: intent.embryoId,
            transferId: intent.transferId,
            triggeredByCheckId: checkId,
            amountCents: intent.amountCents,
            description: intent.description,
            issuedOn: new Date(`${intent.issuedOn}T12:00:00Z`),
            dueOn: new Date(`${intent.dueOn}T12:00:00Z`),
          },
        });
        await this.audit.record(
          {
            actor,
            source: 'UI',
            action: 'invoice.created',
            entityType: 'Invoice',
            entityId: id,
            after: {
              kind: intent.kind,
              amountCents: intent.amountCents,
              triggeredByCheckId: checkId,
              idempotencyKey: intent.idempotencyKey,
            },
          },
          tx,
        );
        const invoiced: MilestoneInvoicedPayload = {
          invoiceId: id,
          kind: intent.kind,
          amountCents: intent.amountCents,
          customerId: intent.customerId,
          contractId: intent.contractId,
          embryoId: intent.embryoId,
          triggeredByCheckId: checkId,
        };
        await this.outbox.append(tx, {
          aggregateType: 'Invoice',
          aggregateId: id,
          type: VeterinaryEvents.MilestoneInvoiced,
          payload: invoiced,
        });
        invoiceIds.push(id);
      }

      let embryoStatus = transfer.embryo.status;
      let recipStatus = transfer.recipient.recipStatus;
      for (const status of outcome.statuses) {
        if (status.kind === 'EMBRYO_OPEN') {
          embryoStatus = 'OPEN';
          recipStatus = 'OPEN';
        }
        if (status.kind === 'PREGNANCY_LOST') {
          embryoStatus = 'LOST';
          recipStatus = 'OPEN';
        }
        if (status.kind === 'BOARD_STARTS') {
          embryoStatus = 'PREGNANT';
          recipStatus = 'CARRYING';
        }
        if (status.kind === 'EMBRYO_CONFIRMED') {
          embryoStatus = 'PREGNANT';
        }
      }
      if ((input.result === 'PREGNANT' || input.result === 'HEARTBEAT') && embryoStatus === 'TRANSFERRED')
        embryoStatus = 'PREGNANT';
      if (embryoStatus !== transfer.embryo.status) {
        await tx.embryo.update({ where: { id: transfer.embryoId }, data: { status: embryoStatus } });
        await this.audit.record(
          {
            actor,
            source: 'UI',
            action: 'embryo.status',
            entityType: 'Embryo',
            entityId: transfer.embryoId,
            before: { status: transfer.embryo.status },
            after: { status: embryoStatus, checkId },
          },
          tx,
        );
      }
      if (recipStatus !== transfer.recipient.recipStatus) {
        await tx.horse.update({ where: { id: transfer.recipientId }, data: { recipStatus } });
      }
      const recorded: CheckRecordedPayload = {
        checkId,
        transferId: transfer.id,
        embryoId: transfer.embryoId,
        recipientId: transfer.recipientId,
        customerId: transfer.embryo.customerId,
        dayNumber,
        result: input.result,
        embryoStatus,
        performedOn: today,
      };
      await this.outbox.append(tx, {
        aggregateType: 'PregnancyCheck',
        aggregateId: checkId,
        type: VeterinaryEvents.CheckRecorded,
        payload: recorded,
      });
      return { invoiceIds, embryoStatus };
    });
    await this.outbox.flush();

    return {
      checkId,
      dayNumber,
      result: input.result,
      invoices: created.invoiceIds,
      statuses: outcome.statuses,
      notes: outcome.notes,
      embryoStatus: created.embryoStatus,
      boardStartsOn: outcome.statuses.some((s) => s.kind === 'BOARD_STARTS') ? today : null,
      nextCheckSuggested: addDays(today, 21),
    };
  }
}
