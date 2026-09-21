import { Injectable } from '@nestjs/common';
import {
  addDays,
  barnLocalToUtc,
  can,
  contractBalanceCents,
  deriveContractStatus,
  evaluateSemenOrder,
  gestationDay,
  isCollectionDay,
  isMonday,
  nextCollectionDay,
  nextMilestoneDay,
  type Actor,
  type BarnDate,
  type SemenHoldReason,
} from '@daysheet/domain';
import { ClockService } from '../../../platform/clock/clock.service';
import { PrismaService } from '../../../platform/persistence/prisma.service';

/**
 * The Day Sheet is what the office prints at 6 AM: who ships today, what arrives today,
 * which mares are set up, which checks are due, and which pregnancies cross a billing
 * milestone. It is computed, never stored — the records are the truth.
 */

export interface CollectionRow {
  orderId: string;
  contractId: string;
  customer: string;
  customerId: string;
  mare: string;
  mareId: string;
  stallion: string;
  stallionId: string;
  shipTo: string;
  container: string;
  placedAt: string;
  status: string;
  disposition: 'SHIP' | 'HOLD' | 'CANCELLED';
  holds: SemenHoldReason[];
  balanceCents: number | null;
}

export interface TransferRow {
  embryoId: string;
  customer: string;
  customerId: string;
  cross: string;
  status: string;
  expectedOn: string | null;
  arrivedAt: string | null;
  source: string;
  storage: string | null;
}

export interface CheckDueRow {
  transferId: string;
  embryoId: string;
  recipId: string;
  recipNumber: number | null;
  customer: string;
  customerId: string;
  gestationDay: number;
  lastCheck: { day: number; result: string; on: string } | null;
  nextMilestone: number | null;
  crossesToday: 'HEARTBEAT' | 'ICSI_FEE_WINDOW' | 'PURCHASE_CONFIRM' | null;
}

export interface LabDueRow {
  labBatchId: string;
  aspirationId: string;
  donor: string;
  donorId: string;
  shippedOn: string;
  expectedResultOn: string;
  status: string;
  daysOut: number;
}

@Injectable()
export class DaysheetService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly clock: ClockService,
  ) {}

  async build(actor: Actor, dateParam?: string) {
    const today = dateParam && /^\d{4}-\d{2}-\d{2}$/.test(dateParam) ? dateParam : this.clock.today();
    const collectionDay = isCollectionDay(today) ? today : nextCollectionDay(today);
    const showMoney = can(actor, 'read', 'invoice');
    const scope = actor.role === 'CUSTOMER' ? { customerId: actor.customerId ?? '__none__' } : {};

    const [collection, transfers, checksDue, labDue, counters] = await Promise.all([
      can(actor, 'read', 'semenOrder') && collectionDay
        ? this.collectionRows(collectionDay, showMoney)
        : Promise.resolve([]),
      this.transferRows(today, scope),
      this.checksDue(today, scope),
      can(actor, 'read', 'embryo') && actor.role !== 'CUSTOMER' ? this.labDue(today) : Promise.resolve([]),
      this.siteCounters(today),
    ]);

    return {
      today,
      isCollectionDay: isCollectionDay(today),
      isAspirationDay: isMonday(today),
      collectionDay,
      demoClock: this.clock.isFrozen(),
      collection,
      transfers,
      checksDue,
      labDue,
      counters,
    };
  }

  private async collectionRows(collectionDay: BarnDate, showMoney: boolean): Promise<CollectionRow[]> {
    const dayStart = barnLocalToUtc(collectionDay, 0);
    const dayEnd = barnLocalToUtc(addDays(collectionDay, 1), 0);
    const orders = await this.prisma.client.semenOrder.findMany({
      where: { requestedFor: { gte: dayStart, lt: dayEnd } },
      include: {
        mare: true,
        contract: { include: { customer: true, stallion: true, invoices: { include: { payments: true } } } },
      },
      orderBy: [{ status: 'asc' }, { placedAt: 'asc' }],
    });

    return orders.map((order) => {
      const c = order.contract;
      const paidCents = c.invoices
        .flatMap((i) => i.payments)
        .filter((p) => p.status === 'SUCCEEDED' || p.status === 'PARTIALLY_REFUNDED')
        .reduce((s, p) => s + p.amountCents - p.refundedCents, 0);
      const facts = {
        status: c.status,
        depositCents: c.depositCents,
        studFeeCents: c.studFeeCents,
        chuteFeeCents: c.chuteFeeCents,
        paidCents,
        signed: c.signedAt !== null,
      };
      const derived = deriveContractStatus(facts);
      const evaluation = evaluateSemenOrder({
        contractStatus: derived,
        placedAt: order.placedAt,
        requestedFor: collectionDay,
        cancelledAt: order.cancelledAt,
      });
      return {
        orderId: order.id,
        contractId: c.id,
        customer: c.customer.displayName,
        customerId: c.customerId,
        mare: order.mare.name,
        mareId: order.mareId,
        stallion: c.stallion.name,
        stallionId: c.stallionId,
        shipTo: `${order.shipToVet} · ${order.shipToCity}`,
        container: order.container,
        placedAt: order.placedAt.toISOString(),
        status: order.status,
        disposition: order.cancelledAt ? 'CANCELLED' : evaluation.canShip ? 'SHIP' : 'HOLD',
        holds: evaluation.holds,
        balanceCents: showMoney ? contractBalanceCents(facts) : null,
      };
    });
  }

  private async transferRows(today: BarnDate, scope: { customerId?: string }): Promise<TransferRow[]> {
    const windowEnd = barnLocalToUtc(addDays(today, 2), 0);
    const embryos = await this.prisma.client.embryo.findMany({
      where: {
        ...scope,
        OR: [
          { status: { in: ['EXPECTED', 'IN_TRANSIT'] }, expectedOn: { lt: windowEnd } },
          { status: 'ARRIVED', transfers: { none: {} } },
        ],
      },
      include: { customer: true, sire: true, dam: true },
      orderBy: [{ expectedOn: 'asc' }],
    });
    return embryos.map((e) => ({
      embryoId: e.id,
      customer: e.customer.displayName,
      customerId: e.customerId,
      cross: `${e.sire?.name ?? e.sireName ?? '?'} x ${e.dam?.name ?? e.damName ?? '?'}`,
      status: e.status,
      expectedOn: e.expectedOn?.toISOString() ?? null,
      arrivedAt: e.arrivedAt?.toISOString() ?? null,
      source: e.source,
      storage: e.storageTank ? `T${e.storageTank.replace(/^T/, '')}/${e.storageSlot ?? '?'}` : null,
    }));
  }

  private async checksDue(today: BarnDate, scope: { customerId?: string }): Promise<CheckDueRow[]> {
    const transfers = await this.prisma.client.transfer.findMany({
      where: { embryo: { ...scope, status: { in: ['TRANSFERRED', 'PREGNANT'] } } },
      include: {
        embryo: { include: { customer: true } },
        recipient: true,
        checks: { orderBy: { performedOn: 'desc' }, take: 1 },
      },
    });
    const rows: CheckDueRow[] = [];
    for (const t of transfers) {
      const day = gestationDay(t.performedOn.toISOString().slice(0, 10), today);
      const last = t.checks[0] ?? null;
      const lastDay = last?.dayNumber ?? 0;
      const next = nextMilestoneDay(lastDay);
      const due = next !== null && day >= next;
      if (!due) continue;
      const crossesToday =
        day === 24 ? 'HEARTBEAT' : day === 45 ? 'ICSI_FEE_WINDOW' : day === 55 ? 'PURCHASE_CONFIRM' : null;
      rows.push({
        transferId: t.id,
        embryoId: t.embryoId,
        recipId: t.recipientId,
        recipNumber: t.recipient.recipNumber,
        customer: t.embryo.customer.displayName,
        customerId: t.embryo.customerId,
        gestationDay: day,
        lastCheck: last
          ? { day: last.dayNumber, result: last.result, on: last.performedOn.toISOString().slice(0, 10) }
          : null,
        nextMilestone: next,
        crossesToday,
      });
    }
    return rows.sort(
      (a, b) => (a.crossesToday ? -1 : 0) - (b.crossesToday ? -1 : 0) || a.gestationDay - b.gestationDay,
    );
  }

  private async labDue(today: BarnDate): Promise<LabDueRow[]> {
    const batches = await this.prisma.client.labBatch.findMany({
      where: { status: { in: ['SHIPPED', 'IN_PROGRESS'] } },
      include: { aspirations: { include: { donorMare: true } } },
      orderBy: { expectedResultOn: 'asc' },
    });
    return batches.map((b) => {
      const asp = b.aspirations[0];
      const shipped = b.shippedOn.toISOString().slice(0, 10);
      return {
        labBatchId: b.id,
        aspirationId: asp?.id ?? '',
        donor: asp?.donorMare.name ?? '?',
        donorId: asp?.donorMareId ?? '',
        shippedOn: shipped,
        expectedResultOn: b.expectedResultOn.toISOString().slice(0, 10),
        status: b.status,
        daysOut: Math.max(0, Math.round((barnLocalToUtc(today, 12).getTime() - b.shippedOn.getTime()) / 86_400_000)),
      };
    });
  }

  /** The three sites as counters — this replaces any map. */
  private async siteCounters(today: BarnDate) {
    const db = this.prisma.client;
    const [setUp, carrying, expectedEmbryos, openLab, holds, stallions] = await Promise.all([
      db.horse.count({ where: { kind: 'RECIPIENT', recipStatus: 'SET_UP' } }),
      db.horse.count({ where: { kind: 'RECIPIENT', recipStatus: 'CARRYING' } }),
      db.embryo.count({ where: { status: { in: ['EXPECTED', 'IN_TRANSIT'] } } }),
      db.labBatch.count({ where: { status: { in: ['SHIPPED', 'IN_PROGRESS'] } } }),
      db.semenOrder.count({ where: { status: 'HOLD_UNPAID', requestedFor: { gte: barnLocalToUtc(today, 0) } } }),
      db.horse.count({ where: { kind: 'STALLION' } }),
    ]);
    return {
      south: { label: 'South · stallion station', stallions, ordersOnHold: holds, labBatchesOut: openLab },
      north: {
        label: 'North · mares & foaling',
        donorsOnSite: await db.horse.count({ where: { kind: 'DONOR', site: 'NORTH' } }),
      },
      recipFarm: { label: 'Recip Farm', setUp, carrying, embryosExpected: expectedEmbryos },
    };
  }
}
