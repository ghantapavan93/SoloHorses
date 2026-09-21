import { Injectable } from '@nestjs/common';
import type { Actor } from '@daysheet/domain';
import type { AuditSource, Prisma } from '@daysheet/db';
import { currentCorrelationId } from '../observability/correlation';
import { PrismaService } from '../persistence/prisma.service';

export interface AuditInput {
  actor: Actor | null;
  source: AuditSource;
  action: string;
  entityType: string;
  entityId: string;
  before?: unknown;
  after?: unknown;
  correlationId?: string;
}

/**
 * Every consequential mutation writes one of these. The table is append-only at the
 * database level (see migrations), so this service only ever inserts.
 *
 * Pass `tx` to write inside the same transaction as the change it describes — an audit row
 * must never exist for a change that rolled back, and vice versa. The correlation id comes
 * from the ambient context (request, job or event) unless the caller knows better.
 */
@Injectable()
export class AuditService {
  constructor(private readonly prisma: PrismaService) {}

  async record(input: AuditInput, tx?: Prisma.TransactionClient): Promise<void> {
    const client = tx ?? this.prisma.client;
    await client.auditEvent.create({
      data: {
        actorId: input.actor?.userId ?? null,
        actorRole: input.actor?.role ?? null,
        source: input.source,
        action: input.action,
        entityType: input.entityType,
        entityId: input.entityId,
        before: toJson(input.before),
        after: toJson(input.after),
        correlationId: input.correlationId ?? currentCorrelationId(),
      },
    });
  }

  async forEntity(entityType: string, entityId: string, limit = 50) {
    return this.prisma.client.auditEvent.findMany({
      where: { entityType, entityId },
      orderBy: { at: 'desc' },
      take: limit,
    });
  }
}

function toJson(value: unknown): Prisma.InputJsonValue | undefined {
  if (value === undefined || value === null) return undefined;
  return JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
}
