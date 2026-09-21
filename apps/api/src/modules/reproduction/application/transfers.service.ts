import { ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { createHash } from 'node:crypto';
import {
  evaluatePlannedRecipient,
  evaluateTransferClearance,
  implantFeeFor,
  type Actor,
  type ClearanceRecord,
  type RuleResult,
} from '@daysheet/domain';
import type { Prisma } from '@daysheet/db';
import { AuditService } from '../../../platform/audit/audit.service';
import { ClockService } from '../../../platform/clock/clock.service';
import { CodesService } from '../../../platform/codes/codes.service';
import { OutboxService } from '../../../platform/events/outbox.service';
import { PrismaService } from '../../../platform/persistence/prisma.service';
import {
  ReproductionEvents,
  type ImplantFeeInvoicedPayload,
  type PlannedRecipientAssignedPayload,
  type TransferRecordedPayload,
} from '../domain/events';

/**
 * Putting an embryo into a mare, and holding a mare for an embryo. Both go through the same
 * deterministic rules the detectors and the assistant read (`evaluateTransferClearance`,
 * `evaluatePlannedRecipient`); a refusal comes back as the rule's own verdict, with the
 * codes to cite, and is a 409, not a warning.
 */
/** The rows a planned-recipient proposal is bound to, as read for its fingerprint. */
export interface PlannedRecipientRead {
  embryo: { status: string; plannedRecipientId: string | null } | null;
  recip: { recipStatus: string | null; planned: string[]; carrying: string[] } | null;
}

/** The rows a veterinary-confirmation proposal is bound to, as read for its fingerprint. */
export type DepartureRead = {
  recipStatus: string | null;
  scheduledDepartureOn: string | null;
  clearances: string[];
} | null;

@Injectable()
export class TransfersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly codes: CodesService,
    private readonly clock: ClockService,
    private readonly outbox: OutboxService,
  ) {}

  private get db() {
    return this.prisma.client;
  }

  /** The recipient side of "may this embryo go into this mare today?", as data. */
  async clearanceFor(recipId: string): Promise<RuleResult & { recipId: string }> {
    const recip = await this.db.horse.findUnique({
      where: { id: recipId },
      include: { clearances: { orderBy: { performedOn: 'desc' } } },
    });
    if (!recip || recip.kind !== 'RECIPIENT') throw new NotFoundException(`${recipId} is not a recip`);
    return {
      recipId,
      ...evaluateTransferClearance({ id: recip.id, clearances: recip.clearances.map(toRecord) }, this.clock.today()),
    };
  }

  async plannedRecipientFor(
    embryoId: string,
    recipId: string,
    tx: Prisma.TransactionClient | null = null,
  ): Promise<RuleResult> {
    const client = tx ?? this.db;
    const recip = await client.horse.findUnique({
      where: { id: recipId },
      include: {
        plannedEmbryos: { select: { id: true } },
        transfers: {
          where: { embryo: { status: { in: ['TRANSFERRED', 'PREGNANT'] } } },
          select: { embryoId: true },
          take: 1,
        },
      },
    });
    if (!recip || recip.kind !== 'RECIPIENT') throw new NotFoundException(`${recipId} is not a recip`);
    return evaluatePlannedRecipient({
      recip: { id: recip.id, recipStatus: recip.recipStatus },
      embryoId,
      otherPlannedEmbryoIds: recip.plannedEmbryos.map((e) => e.id).filter((id) => id !== embryoId),
      carryingEmbryoId: recip.transfers[0]?.embryoId ?? null,
    });
  }

  /**
   * A fingerprint of everything the planned-recipient rule reads: the embryo's status and
   * current hold, the recip's status, what else is written down for her and what she carries.
   * A proposal records it when it is made; approval compares it first, so a person approves
   * what they were shown and not whatever the records have become since (ADR-017).
   */
  async plannedRecipientStateHash(embryoId: string, recipId: string): Promise<string> {
    return createHash('sha256')
      .update(JSON.stringify(await this.plannedRecipientRead(embryoId, recipId)))
      .digest('hex')
      .slice(0, 16);
  }

  /** Exactly what the fingerprint above is taken of — so a diff shows the state the proposal is bound to, nothing else. */
  async plannedRecipientRead(embryoId: string, recipId: string): Promise<PlannedRecipientRead> {
    const [embryo, recip] = await Promise.all([
      this.db.embryo.findUnique({ where: { id: embryoId }, select: { status: true, plannedRecipientId: true } }),
      this.db.horse.findUnique({
        where: { id: recipId },
        select: {
          recipStatus: true,
          plannedEmbryos: { select: { id: true } },
          transfers: { where: { embryo: { status: { in: ['TRANSFERRED', 'PREGNANT'] } } }, select: { embryoId: true } },
        },
      }),
    ]);
    return {
      embryo: embryo ? { status: embryo.status, plannedRecipientId: embryo.plannedRecipientId } : null,
      recip: recip
        ? {
            recipStatus: recip.recipStatus,
            planned: recip.plannedEmbryos.map((e) => e.id).sort(),
            carrying: recip.transfers.map((t) => t.embryoId).sort(),
          }
        : null,
    };
  }

  /**
   * What a veterinary-confirmation request is made from: the departure date, her status, and her
   * whole veterinary record — every clearance, whatever its kind. Anything the vet records after
   * the proposal changes the picture the request was written from, so approving it would be
   * approving something the person was not shown; the proposal is refused instead.
   */
  async departureStateHash(recipId: string): Promise<string> {
    return createHash('sha256')
      .update(JSON.stringify(await this.departureRead(recipId)))
      .digest('hex')
      .slice(0, 16);
  }

  /** Exactly what the departure fingerprint is taken of. */
  async departureRead(recipId: string): Promise<DepartureRead> {
    const recip = await this.db.horse.findUnique({
      where: { id: recipId },
      select: {
        recipStatus: true,
        scheduledDepartureOn: true,
        clearances: {
          select: { id: true, kind: true, result: true, performedOn: true },
          orderBy: [{ performedOn: 'asc' }, { id: 'asc' }],
        },
      },
    });
    return recip
      ? {
          recipStatus: recip.recipStatus,
          scheduledDepartureOn: recip.scheduledDepartureOn?.toISOString() ?? null,
          clearances: recip.clearances.map(
            (c) => `${c.id}:${c.kind}:${c.result}:${c.performedOn.toISOString().slice(0, 10)}`,
          ),
        }
      : null;
  }

  /** Holds a set-up recip for an arriving embryo. The rule decides; a refusal is a 409 with its evidence. */
  async assignPlannedRecipient(
    actor: Actor,
    embryoId: string,
    recipId: string,
    via: 'UI' | 'AI' = 'UI',
  ): Promise<{ embryoId: string; recipId: string; evidenceIds: string[] }> {
    if (actor.role !== 'RECIPS' && actor.role !== 'ADMIN' && actor.role !== 'STALLION_OFFICE')
      throw new ForbiddenException('only the recip farm or the stallion office assigns recips');
    const embryo = await this.db.embryo.findUnique({ where: { id: embryoId } });
    if (!embryo) throw new NotFoundException(`${embryoId} not found`);
    if (!['EXPECTED', 'IN_TRANSIT', 'ARRIVED', 'FROZEN'].includes(embryo.status))
      throw new ConflictException({
        code: 'EMBRYO_NOT_WAITING',
        message: `${embryoId} is ${embryo.status.toLowerCase()}; only a waiting embryo takes a planned recip`,
        evidenceIds: [embryoId],
      });
    const verdict = await this.plannedRecipientFor(embryoId, recipId);
    if (!verdict.ok)
      throw new ConflictException({ code: verdict.code, message: verdict.reason, evidenceIds: verdict.evidenceIds });
    await this.db.$transaction(async (tx) => {
      await tx.embryo.update({ where: { id: embryoId }, data: { plannedRecipientId: recipId } });
      await this.audit.record(
        {
          actor,
          source: via,
          action: 'embryo.planned_recipient',
          entityType: 'Embryo',
          entityId: embryoId,
          before: { plannedRecipientId: embryo.plannedRecipientId },
          after: { plannedRecipientId: recipId, rule: verdict },
        },
        tx,
      );
      const payload: PlannedRecipientAssignedPayload = {
        embryoId,
        recipId,
        previousRecipId: embryo.plannedRecipientId,
        evidenceIds: verdict.evidenceIds,
      };
      await this.outbox.append(tx, {
        aggregateType: 'Embryo',
        aggregateId: embryoId,
        type: ReproductionEvents.PlannedRecipientAssigned,
        payload,
      });
    });
    await this.outbox.flush();
    return { embryoId, recipId, evidenceIds: verdict.evidenceIds };
  }

  /** Records a transfer. Clearance and availability are rules, so a blocked transfer never becomes a row. */
  async record(actor: Actor, input: { embryoId: string; recipientId: string; notes?: string | null }) {
    if (actor.role !== 'RECIPS' && actor.role !== 'VET' && actor.role !== 'ADMIN')
      throw new ForbiddenException('only the recip farm or the vet records a transfer');
    const embryo = await this.db.embryo.findUnique({
      where: { id: input.embryoId },
      include: { transfers: { where: { embryo: { status: { in: ['TRANSFERRED', 'PREGNANT'] } } }, take: 1 } },
    });
    if (!embryo) throw new NotFoundException(`${input.embryoId} not found`);
    if (embryo.transfers.length > 0)
      throw new ConflictException({
        code: 'EMBRYO_ALREADY_TRANSFERRED',
        message: `${embryo.id} is already in ${embryo.transfers[0]?.recipientId ?? 'a recip'}`,
        evidenceIds: [embryo.id],
      });
    const clearance = await this.clearanceFor(input.recipientId);
    if (!clearance.ok)
      throw new ConflictException({
        code: clearance.code,
        message: clearance.reason,
        evidenceIds: clearance.evidenceIds,
      });
    const availability = await this.plannedRecipientFor(embryo.id, input.recipientId);
    // A recip held for this very embryo is the normal case; any other refusal stands.
    if (!availability.ok && availability.code !== 'RECIPIENT_DOUBLE_BOOKED')
      throw new ConflictException({
        code: availability.code,
        message: availability.reason,
        evidenceIds: availability.evidenceIds,
      });
    const today = this.clock.today();
    const season = Number(today.slice(0, 4));
    const id = await this.codes.next('transfer', season);
    // FACT (leasing page): a $1,000 implant fee per attempt; the first is covered by the deposit.
    // HYPOTHESIS: an attempt is counted per embryo — a second transfer of the same embryo is attempt 2.
    const attempt = (await this.db.transfer.count({ where: { embryoId: embryo.id } })) + 1;
    const fee = implantFeeFor(attempt);
    let implantInvoiceId: string | null = null;
    await this.db.$transaction(async (tx) => {
      await tx.transfer.create({
        data: {
          id,
          embryoId: embryo.id,
          recipientId: input.recipientId,
          performedOn: new Date(`${today}T15:00:00Z`),
          notes: input.notes ?? null,
        },
      });
      await tx.embryo.update({
        where: { id: embryo.id },
        data: { status: 'TRANSFERRED', plannedRecipientId: null, arrivedAt: embryo.arrivedAt ?? new Date() },
      });
      await tx.horse.update({ where: { id: input.recipientId }, data: { recipStatus: 'CARRYING' } });
      await this.audit.record(
        {
          actor,
          source: 'UI',
          action: 'transfer.recorded',
          entityType: 'Transfer',
          entityId: id,
          after: {
            embryoId: embryo.id,
            recipientId: input.recipientId,
            clearance: clearance.evidenceIds,
            attempt,
            implantFee: fee,
          },
        },
        tx,
      );
      const payload: TransferRecordedPayload = {
        transferId: id,
        embryoId: embryo.id,
        recipientId: input.recipientId,
        customerId: embryo.customerId,
        performedOn: today,
        clearanceEvidenceIds: clearance.evidenceIds,
      };
      await this.outbox.append(tx, {
        aggregateType: 'Transfer',
        aggregateId: id,
        type: ReproductionEvents.TransferRecorded,
        payload,
      });
      if (fee.coveredByDeposit) {
        // The first attempt is not free; it was paid at reservation. The row says so, so nobody bills it twice.
        await this.audit.record(
          {
            actor,
            source: 'UI',
            action: 'implant_fee.covered_by_deposit',
            entityType: 'Transfer',
            entityId: id,
            after: { embryoId: embryo.id, attempt, amountCents: 0, rule: 'implantFeeFor' },
          },
          tx,
        );
        return;
      }
      implantInvoiceId = await this.codes.next('invoice', season, tx);
      await tx.invoice.create({
        data: {
          id: implantInvoiceId,
          kind: 'IMPLANT_FEE',
          status: 'OPEN',
          customerId: embryo.customerId,
          contractId: embryo.contractId,
          embryoId: embryo.id,
          transferId: id,
          amountCents: fee.amountCents,
          description: `Implant fee, attempt ${attempt} for ${embryo.id}`,
          issuedOn: new Date(`${today}T12:00:00Z`),
          dueOn: new Date(`${today}T12:00:00Z`),
        },
      });
      await this.audit.record(
        {
          actor,
          source: 'UI',
          action: 'invoice.created',
          entityType: 'Invoice',
          entityId: implantInvoiceId,
          after: { kind: 'IMPLANT_FEE', amountCents: fee.amountCents, transferId: id, attempt, rule: 'implantFeeFor' },
        },
        tx,
      );
      const invoiced: ImplantFeeInvoicedPayload = {
        invoiceId: implantInvoiceId,
        transferId: id,
        embryoId: embryo.id,
        customerId: embryo.customerId,
        attempt,
        amountCents: fee.amountCents,
      };
      await this.outbox.append(tx, {
        aggregateType: 'Invoice',
        aggregateId: implantInvoiceId,
        type: ReproductionEvents.ImplantFeeInvoiced,
        payload: invoiced,
      });
    });
    await this.outbox.flush();
    return {
      transferId: id,
      embryoId: embryo.id,
      recipientId: input.recipientId,
      clearance: clearance.evidenceIds,
      attempt,
      implantFee: { ...fee, invoiceId: implantInvoiceId },
    };
  }
}

function toRecord(c: {
  id: string;
  kind: ClearanceRecord['kind'];
  result: ClearanceRecord['result'];
  performedOn: Date;
  expiresOn: Date | null;
}): ClearanceRecord {
  return {
    id: c.id,
    kind: c.kind,
    result: c.result,
    performedOn: c.performedOn.toISOString().slice(0, 10),
    expiresOn: c.expiresOn?.toISOString().slice(0, 10) ?? null,
  };
}
