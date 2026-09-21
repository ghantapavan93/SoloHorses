import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import {
  CLEARANCE_LABELS,
  TRANSFER_CLEARANCES,
  addDays,
  type Actor,
  type ClearanceKind,
  type ClearanceResult,
} from '@daysheet/domain';
import { AuditService } from '../../../platform/audit/audit.service';
import { ClockService } from '../../../platform/clock/clock.service';
import { CodesService } from '../../../platform/codes/codes.service';
import { OutboxService } from '../../../platform/events/outbox.service';
import { PrismaService } from '../../../platform/persistence/prisma.service';
import { VeterinaryEvents, type ClearanceRecordedPayload } from '../domain/events';

export interface RecordClearanceInput {
  horseId: string;
  kind: ClearanceKind;
  result: ClearanceResult;
  note?: string | null;
}

/**
 * The vet's word on a mare, written down: a pre-transfer exam, a culture, the video that
 * says she is in foal before she leaves, the assessment when she comes back. The record is
 * the whole of it — every rule that cares (transfer clearance, departure, return) reads the
 * record and decides for itself on the next sweep. Nothing here charges a fee or clears a
 * transfer; it says what the vet found, and when.
 */
@Injectable()
export class ClearancesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly codes: CodesService,
    private readonly clock: ClockService,
    private readonly outbox: OutboxService,
  ) {}

  async record(
    actor: Actor,
    input: RecordClearanceInput,
  ): Promise<{
    clearanceId: string;
    horseId: string;
    kind: ClearanceKind;
    result: ClearanceResult;
    performedOn: string;
    expiresOn: string | null;
  }> {
    if (actor.role !== 'VET' && actor.role !== 'ADMIN')
      throw new ForbiddenException('only the vet team records a clearance');
    const horse = await this.prisma.client.horse.findUnique({
      where: { id: input.horseId },
      select: { id: true, kind: true, sex: true },
    });
    if (!horse) throw new NotFoundException(`${input.horseId} not found`);
    if (horse.sex !== 'MARE') throw new BadRequestException(`${input.horseId} is not a mare`);
    const today = this.clock.today();
    const season = Number(today.slice(0, 4));
    // A clearance with a published validity carries its own expiry; the others are read by date.
    const validDays =
      input.kind === 'PRE_TRANSFER_EXAM' || input.kind === 'UTERINE_CULTURE'
        ? TRANSFER_CLEARANCES[input.kind].validDays
        : null;
    const expiresOn = validDays ? addDays(today, validDays) : null;
    const id = await this.codes.next('clearance', season);
    await this.prisma.client.$transaction(async (tx) => {
      await tx.clearance.create({
        data: {
          id,
          horseId: horse.id,
          kind: input.kind,
          result: input.result,
          performedOn: new Date(`${today}T15:00:00Z`),
          expiresOn: expiresOn ? new Date(`${expiresOn}T15:00:00Z`) : null,
          recordedById: actor.userId,
          note: input.note ?? null,
        },
      });
      await this.audit.record(
        {
          actor,
          source: 'UI',
          action: 'clearance.recorded',
          entityType: 'Clearance',
          entityId: id,
          after: {
            horseId: horse.id,
            kind: input.kind,
            label: CLEARANCE_LABELS[input.kind],
            result: input.result,
            performedOn: today,
            expiresOn,
            note: input.note ?? null,
          },
        },
        tx,
      );
      const payload: ClearanceRecordedPayload = {
        clearanceId: id,
        horseId: horse.id,
        kind: input.kind,
        result: input.result,
        performedOn: today,
      };
      await this.outbox.append(tx, {
        aggregateType: 'Clearance',
        aggregateId: id,
        type: VeterinaryEvents.ClearanceRecorded,
        payload,
      });
    });
    await this.outbox.flush();
    return {
      clearanceId: id,
      horseId: horse.id,
      kind: input.kind,
      result: input.result,
      performedOn: today,
      expiresOn,
    };
  }
}
