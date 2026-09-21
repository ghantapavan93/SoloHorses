import { Injectable, NotFoundException } from '@nestjs/common';
import type { Actor } from '@daysheet/domain';
import type { Prisma } from '@daysheet/db';
import { AuditService } from '../../../platform/audit/audit.service';
import { ClockService } from '../../../platform/clock/clock.service';
import { CodesService } from '../../../platform/codes/codes.service';
import { PrismaService } from '../../../platform/persistence/prisma.service';

/**
 * A request to the team: a subject, a body, the records it cites, and the person who sent it.
 * "Send to team" on an answer writes one; an approved veterinary-confirmation proposal writes
 * the same row through the same call, with the approver's name on it. Never the assistant's.
 */
@Injectable()
export class RequestsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly codes: CodesService,
    private readonly clock: ClockService,
  ) {}

  async create(
    actor: Actor,
    input: { subject: string; body: string; evidenceIds: string[] },
    source: 'UI' | 'AI' = 'UI',
    tx?: Prisma.TransactionClient,
  ) {
    const client = tx ?? this.prisma.client;
    // A code like every record a person cites (RQ-26-0041), from the atomic sequence, never a row count.
    const id = await this.codes.next('request', Number(this.clock.today().slice(0, 4)), tx);
    const row = await client.request.create({
      data: {
        id,
        createdById: actor.userId,
        subject: input.subject.slice(0, 200),
        body: input.body.slice(0, 2_000),
        evidenceIds: input.evidenceIds,
      },
    });
    await this.audit.record(
      {
        actor,
        source,
        action: 'request.created',
        entityType: 'Request',
        entityId: row.id,
        after: { subject: row.subject, evidenceIds: input.evidenceIds },
      },
      tx,
    );
    return row;
  }

  /** A person marks the request done; the row keeps its words, the audit line keeps who and why. */
  async close(actor: Actor, id: string, note: string | null) {
    const row = await this.prisma.client.request.findUnique({ where: { id } });
    if (!row) throw new NotFoundException(`request ${id} not found`);
    if (row.status === 'CLOSED') return row;
    const closed = await this.prisma.client.request.update({ where: { id }, data: { status: 'CLOSED' } });
    await this.audit.record({
      actor,
      source: 'UI',
      action: 'request.closed',
      entityType: 'Request',
      entityId: id,
      before: { status: row.status },
      after: { status: 'CLOSED', note },
    });
    return closed;
  }

  /** The queue as a person sees it: a customer's own requests, everyone's for the team. */
  async list(actor: Actor) {
    return this.prisma.client.request.findMany({
      where: actor.role === 'CUSTOMER' ? { createdById: actor.userId } : {},
      orderBy: { createdAt: 'desc' },
      take: 100,
      include: { createdBy: { select: { name: true, role: true } } },
    });
  }

  /** Open requests that name a record: what a proposal's state includes, so the same request is not sent twice. */
  async openAbout(recordId: string): Promise<{ id: string; subject: string; createdAt: Date }[]> {
    return this.prisma.client.request.findMany({
      where: { status: 'OPEN', evidenceIds: { has: recordId } },
      select: { id: true, subject: true, createdAt: true },
      orderBy: { createdAt: 'asc' },
    });
  }
}
