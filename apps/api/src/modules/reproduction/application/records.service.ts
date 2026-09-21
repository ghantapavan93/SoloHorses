import { ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { can, canSeeRecord, formatUsd, type Actor } from '@daysheet/domain';
import type { Prisma } from '@daysheet/db';
import { EmbryoStatus } from '@daysheet/db';
import { z } from 'zod';
import { AuditService } from '../../../platform/audit/audit.service';
import { CacheService } from '../../../platform/cache/cache.service';
import { OutboxService } from '../../../platform/events/outbox.service';
import { PrismaService } from '../../../platform/persistence/prisma.service';
import { ReproductionEvents, type HorseUpdatedPayload } from '../domain/events';

// Found by API fuzzing: a status the enum does not know reached Prisma and came back as a 500.
const EmbryoStatusFilter = z.enum(EmbryoStatus);

/** One row on a record's timeline. `id` is the entity code the row is about — it doubles as evidence. */
export interface TimelineEvent {
  id: string;
  at: string;
  kind: string;
  title: string;
  detail?: string;
  actor?: string | null;
  amountCents?: number;
  links: string[];
}

const embryoInclude = {
  customer: true,
  contract: { include: { stallion: true } },
  aspiration: { include: { donorMare: true, labBatch: true } },
  sire: true,
  dam: true,
  intakeMessage: true,
  transfers: {
    include: {
      recipient: true,
      checks: {
        include: { recordedBy: true, triggeredInvoices: { include: { payments: true } } },
        orderBy: { performedOn: 'asc' },
      },
    },
    orderBy: { performedOn: 'asc' },
  },
  invoices: { include: { payments: true }, orderBy: { issuedOn: 'asc' } },
} satisfies Prisma.EmbryoInclude;

export type EmbryoRecord = Prisma.EmbryoGetPayload<{ include: typeof embryoInclude }>;

/** A horse page is read far more often than a horse changes; the summary is cached until a HorseUpdated event says otherwise. */
export const HORSE_CACHE_TTL_MS = 5 * 60_000;
export const horseCacheKey = (id: string): string => `horse:${id}`;

@Injectable()
export class RecordsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly cache: CacheService,
    private readonly audit: AuditService,
    private readonly outbox: OutboxService,
  ) {}

  private get db() {
    return this.prisma.client;
  }

  /** Customers only ever see their own rows; staff see by department. */
  private customerScope(actor: Actor): { customerId: string } | Record<string, never> {
    return actor.role === 'CUSTOMER' ? { customerId: actor.customerId ?? '__none__' } : {};
  }

  async getEmbryo(actor: Actor, id: string) {
    const embryo = await this.db.embryo.findUnique({ where: { id }, include: embryoInclude });
    if (!embryo) throw new NotFoundException(`${id} not found`);
    if (!canSeeRecord(actor, 'embryo', embryo)) throw new ForbiddenException();
    const showMoney = can(actor, 'read', 'invoice');
    return { embryo: this.redactEmbryo(embryo, showMoney), timeline: this.embryoTimeline(embryo, showMoney) };
  }

  private redactEmbryo(embryo: EmbryoRecord, showMoney: boolean) {
    if (showMoney) return embryo;
    return {
      ...embryo,
      invoices: [],
      transfers: embryo.transfers.map((t) => ({
        ...t,
        checks: t.checks.map((c) => ({ ...c, triggeredInvoices: [] })),
      })),
    };
  }

  embryoTimeline(embryo: EmbryoRecord, showMoney: boolean): TimelineEvent[] {
    const events: TimelineEvent[] = [];

    if (embryo.intakeMessage) {
      events.push({
        id: embryo.id,
        at: embryo.intakeMessage.createdAt.toISOString(),
        kind: 'intake',
        title:
          embryo.intakeMessage.status === 'CONFIRMED'
            ? 'Announced by text and confirmed'
            : 'Announced by text — awaiting confirmation',
        detail: embryo.intakeMessage.body,
        links: [],
      });
    }

    if (embryo.aspiration) {
      const asp = embryo.aspiration;
      events.push({
        id: asp.id,
        at: asp.performedOn.toISOString(),
        kind: 'aspiration',
        title: `Aspirated from ${asp.donorMare.name}`,
        detail: `${asp.oocyteCount} oocytes`,
        links: [asp.donorMareId],
      });
      if (asp.labBatch) {
        const lab = asp.labBatch;
        events.push({
          id: lab.id,
          at: lab.shippedOn.toISOString(),
          kind: 'lab',
          title: 'Oocytes shipped to the ICSI lab',
          detail: `Results expected ${lab.expectedResultOn.toISOString().slice(0, 10)}`,
          links: [asp.id],
        });
        if (lab.resultReceivedOn) {
          events.push({
            id: lab.id,
            at: lab.resultReceivedOn.toISOString(),
            kind: 'lab',
            title: `Lab result: ${lab.embryoCount ?? 0} embryo${lab.embryoCount === 1 ? '' : 's'}`,
            links: [asp.id],
          });
        }
      }
    }

    if (embryo.arrivedAt) {
      events.push({
        id: embryo.id,
        at: embryo.arrivedAt.toISOString(),
        kind: 'arrival',
        title: embryo.storageTank
          ? `Vitrified — tank ${embryo.storageTank}, slot ${embryo.storageSlot ?? '?'}`
          : 'Arrived at the Recip Farm',
        links: [],
      });
    }

    for (const transfer of embryo.transfers) {
      events.push({
        id: transfer.id,
        at: transfer.performedOn.toISOString(),
        kind: 'transfer',
        title: `Transferred into Recip #${transfer.recipient.recipNumber ?? '?'}`,
        links: [transfer.recipientId],
      });
      for (const check of transfer.checks) {
        const invoiceNote =
          showMoney && check.triggeredInvoices.length > 0
            ? ` → ${check.triggeredInvoices.map((i) => `${i.id} ${formatUsd(i.amountCents)}`).join(', ')}`
            : '';
        events.push({
          id: check.id,
          at: check.performedOn.toISOString(),
          kind: 'check',
          title: `Day ${check.dayNumber} check: ${check.result.toLowerCase()}`,
          detail: (check.notes ?? '') + invoiceNote,
          actor: check.recordedBy.name,
          links: [transfer.id, ...(showMoney ? check.triggeredInvoices.map((i) => i.id) : [])],
        });
      }
    }

    if (showMoney) {
      for (const invoice of embryo.invoices) {
        events.push({
          id: invoice.id,
          at: invoice.issuedOn.toISOString(),
          kind: 'invoice',
          title: `${invoice.kind.replace(/_/g, ' ').toLowerCase()} invoiced — ${invoice.status.toLowerCase()}`,
          detail: invoice.description,
          amountCents: invoice.amountCents,
          links: invoice.triggeredByCheckId ? [invoice.triggeredByCheckId] : [],
        });
        for (const payment of invoice.payments) {
          events.push({
            id: payment.id,
            at: payment.receivedAt.toISOString(),
            kind: 'payment',
            title: `Payment ${payment.status.toLowerCase()} by ${payment.method.toLowerCase()}`,
            amountCents: payment.amountCents,
            links: [invoice.id],
          });
        }
      }
    }

    return events.sort((a, b) => (a.at < b.at ? 1 : a.at > b.at ? -1 : 0));
  }

  async getContract(actor: Actor, id: string) {
    const contract = await this.db.contract.findUnique({
      where: { id },
      include: {
        customer: true,
        stallion: true,
        mare: true,
        semenOrders: { orderBy: { requestedFor: 'desc' } },
        invoices: { include: { payments: true }, orderBy: { issuedOn: 'asc' } },
        embryos: true,
      },
    });
    if (!contract) throw new NotFoundException(`${id} not found`);
    if (!canSeeRecord(actor, 'contract', contract)) throw new ForbiddenException();
    const paidCents = contract.invoices
      .flatMap((i) => i.payments)
      .filter((p) => p.status === 'SUCCEEDED' || p.status === 'PARTIALLY_REFUNDED')
      .reduce((sum, p) => sum + p.amountCents - p.refundedCents, 0);
    const totalCents = contract.depositCents + contract.studFeeCents + contract.chuteFeeCents;
    return { contract, paidCents, totalCents, balanceCents: Math.max(0, totalCents - paidCents) };
  }

  async getHorse(actor: Actor, id: string) {
    // Cached as loaded, before any per-actor redaction, so one entry serves every role safely.
    const {
      value: horse,
      cached,
      entry,
    } = await this.cache.wrap(horseCacheKey(id), HORSE_CACHE_TTL_MS, () => this.loadHorse(id));
    if (!horse) throw new NotFoundException(`${id} not found`);
    if (!canSeeRecord(actor, 'horse', { customerId: horse.ownerId })) {
      // Recips are shared infrastructure; a customer may see a recip carrying their embryo.
      const carriesTheirs =
        horse.kind === 'RECIPIENT' && horse.transfers.some((t) => t.embryo.customerId === actor.customerId);
      if (!carriesTheirs) throw new ForbiddenException();
    }
    const cache = { hit: cached, storedAt: entry.storedAt, expiresAt: entry.expiresAt, version: entry.version };
    if (actor.role === 'CUSTOMER') {
      // A stallion's book is private to its owner: customers see the horse, not its contracts or other people's transfers.
      return {
        ...horse,
        contractsAsStallion: [],
        transfers: horse.transfers.filter((t) => t.embryo.customerId === actor.customerId),
        cache,
      };
    }
    return { ...horse, cache };
  }

  private loadHorse(id: string) {
    return this.db.horse.findUnique({
      where: { id },
      include: {
        owner: true,
        transfers: {
          include: { embryo: true, checks: { orderBy: { performedOn: 'desc' } } },
          orderBy: { performedOn: 'desc' },
        },
        contractsAsStallion: { include: { customer: true }, orderBy: { createdAt: 'desc' } },
        embryosAsDam: true,
        clearances: { orderBy: { performedOn: 'desc' } },
      },
    });
  }

  /** The one horse mutation the prototype offers; it exists so cache invalidation has a real cause. */
  async updateHorseNotes(actor: Actor, id: string, notes: string | null) {
    const horse = await this.db.horse.findUnique({ where: { id } });
    if (!horse) throw new NotFoundException(`${id} not found`);
    await this.db.$transaction(async (tx) => {
      await tx.horse.update({ where: { id }, data: { notes } });
      await this.audit.record(
        {
          actor,
          source: 'UI',
          action: 'horse.notes',
          entityType: 'Horse',
          entityId: id,
          before: { notes: horse.notes },
          after: { notes },
        },
        tx,
      );
      const payload: HorseUpdatedPayload = { horseId: id, fields: ['notes'] };
      await this.outbox.append(tx, {
        aggregateType: 'Horse',
        aggregateId: id,
        type: ReproductionEvents.HorseUpdated,
        payload,
      });
    });
    await this.outbox.flush();
    return { id, notes };
  }

  async getCustomer(actor: Actor, id: string) {
    if (actor.role === 'CUSTOMER' && actor.customerId !== id) throw new ForbiddenException();
    const customer = await this.db.customer.findUnique({
      where: { id },
      include: {
        horses: true,
        contracts: { include: { stallion: true } },
        embryos: {
          include: {
            transfers: {
              include: { recipient: true, checks: { orderBy: { performedOn: 'desc' }, take: 1 } },
              orderBy: { performedOn: 'desc' },
              take: 1,
            },
          },
        },
        invoices: { include: { payments: true } },
      },
    });
    if (!customer) throw new NotFoundException(`${id} not found`);
    return can(actor, 'read', 'invoice') ? customer : { ...customer, invoices: [] };
  }

  async listCustomers(actor: Actor) {
    if (actor.role === 'CUSTOMER') throw new ForbiddenException();
    return this.db.customer.findMany({
      select: { id: true, displayName: true, phone: true, email: true, smsOptedOut: true },
      orderBy: { displayName: 'asc' },
    });
  }

  async listEmbryos(actor: Actor, filter: { status?: string; customerId?: string } = {}) {
    return this.db.embryo.findMany({
      where: {
        ...this.customerScope(actor),
        ...(filter.customerId ? { customerId: filter.customerId } : {}),
        ...(filter.status ? { status: EmbryoStatusFilter.parse(filter.status) } : {}),
      },
      include: {
        customer: true,
        sire: true,
        dam: true,
        transfers: {
          include: { recipient: true, checks: { orderBy: { performedOn: 'desc' }, take: 1 } },
          orderBy: { performedOn: 'desc' },
          take: 1,
        },
      },
      orderBy: { updatedAt: 'desc' },
      take: 200,
    });
  }

  async listContracts(actor: Actor) {
    if (!can(actor, 'read', 'contract')) throw new ForbiddenException();
    return this.db.contract.findMany({
      where: this.customerScope(actor),
      include: { customer: true, stallion: true, mare: true, invoices: { include: { payments: true } } },
      orderBy: { createdAt: 'desc' },
      take: 200,
    });
  }

  /** ⌘K search across codes and names. Cheap ILIKE; the dataset is small by design. */
  async search(actor: Actor, q: string) {
    const term = q.trim();
    if (term.length < 2) return [];
    const scope = this.customerScope(actor);
    const [embryos, horses, contracts, customers] = await Promise.all([
      this.db.embryo.findMany({
        where: {
          ...scope,
          OR: [
            { id: { contains: term, mode: 'insensitive' } },
            { sireName: { contains: term, mode: 'insensitive' } },
            { damName: { contains: term, mode: 'insensitive' } },
          ],
        },
        take: 8,
        include: { sire: true, dam: true },
      }),
      this.db.horse.findMany({
        where: {
          ...(actor.role === 'CUSTOMER'
            ? { OR: [{ ownerId: actor.customerId ?? '__none__' }, { kind: 'RECIPIENT' }] }
            : {}),
          AND: [
            {
              OR: [{ id: { contains: term, mode: 'insensitive' } }, { name: { contains: term, mode: 'insensitive' } }],
            },
          ],
        },
        take: 8,
      }),
      can(actor, 'read', 'contract')
        ? this.db.contract.findMany({
            where: { ...scope, id: { contains: term, mode: 'insensitive' } },
            take: 6,
            include: { stallion: true },
          })
        : Promise.resolve([]),
      actor.role === 'CUSTOMER'
        ? Promise.resolve([])
        : this.db.customer.findMany({
            where: {
              OR: [
                { id: { contains: term, mode: 'insensitive' } },
                { displayName: { contains: term, mode: 'insensitive' } },
              ],
            },
            take: 6,
          }),
    ]);
    return [
      ...embryos.map((e) => ({
        id: e.id,
        type: 'embryo' as const,
        title: e.id,
        subtitle: `${e.sire?.name ?? e.sireName ?? '?'} x ${e.dam?.name ?? e.damName ?? '?'} · ${e.status.toLowerCase()}`,
      })),
      ...horses.map((h) => ({
        id: h.id,
        type: 'horse' as const,
        title: h.name,
        subtitle: `${h.id} · ${h.kind.toLowerCase()}`,
      })),
      ...contracts.map((c) => ({
        id: c.id,
        type: 'contract' as const,
        title: c.id,
        subtitle: `${c.stallion.name} · ${c.status.toLowerCase().replace(/_/g, ' ')}`,
      })),
      ...customers.map((c) => ({ id: c.id, type: 'customer' as const, title: c.displayName, subtitle: c.id })),
    ];
  }
}
