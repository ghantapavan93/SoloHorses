import { Injectable } from '@nestjs/common';
import { IntegrationProvider, type Prisma } from '@daysheet/db';
import { z } from 'zod';
import { currentCorrelationId } from '../../../platform/observability/correlation';
import { PrismaService } from '../../../platform/persistence/prisma.service';

export type IngestResult =
  { duplicate: false; id: string } | { duplicate: true; id: string; status: string; deliveries: number };

/**
 * The inbox for every inbound event. Insert-or-nothing on (provider, externalId): the
 * unique index is the real duplicate guard, so a redelivered webhook — Stripe retries for up
 * to three days — can never be processed twice, no matter how many workers are running.
 */
@Injectable()
export class IntegrationEventsService {
  constructor(private readonly prisma: PrismaService) {}

  async ingest(
    provider: IntegrationProvider,
    externalId: string,
    type: string,
    payload: unknown,
    correlationId?: string,
  ): Promise<IngestResult> {
    const db = this.prisma.client;
    // Cheap pre-check keeps the common redelivery case quiet; the unique index is still the guarantee.
    const seen = await db.integrationEvent.findUnique({ where: { provider_externalId: { provider, externalId } } });
    if (seen) return this.countDuplicate(seen.id, seen.status);
    try {
      const row = await db.integrationEvent.create({
        data: {
          provider,
          externalId,
          type,
          payload: payload as Prisma.InputJsonValue,
          correlationId: correlationId ?? currentCorrelationId(),
        },
      });
      return { duplicate: false, id: row.id };
    } catch (error) {
      if (isUniqueViolation(error)) {
        const existing = await db.integrationEvent.findUniqueOrThrow({
          where: { provider_externalId: { provider, externalId } },
        });
        return this.countDuplicate(existing.id, existing.status);
      }
      throw error;
    }
  }

  /** The redelivery is rejected, and counted, so the proof of it is a number on the row rather than a log line. */
  private async countDuplicate(id: string, status: string): Promise<IngestResult> {
    const updated = await this.prisma.client.integrationEvent.update({
      where: { id },
      data: { duplicateDeliveries: { increment: 1 } },
    });
    return { duplicate: true, id, status, deliveries: updated.duplicateDeliveries + 1 };
  }

  async markProcessed(id: string, tx?: Prisma.TransactionClient): Promise<void> {
    await (tx ?? this.prisma.client).integrationEvent.update({
      where: { id },
      data: { status: 'PROCESSED', processedAt: new Date(), error: null },
    });
  }

  async markFailed(id: string, error: string): Promise<void> {
    await this.prisma.client.integrationEvent.update({
      where: { id },
      data: { status: 'FAILED', error: error.slice(0, 1000) },
    });
  }

  async markIgnored(id: string, reason: string): Promise<void> {
    await this.prisma.client.integrationEvent.update({
      where: { id },
      data: { status: 'IGNORED', processedAt: new Date(), error: reason.slice(0, 1000) },
    });
  }

  async recent(provider?: string, limit = 50) {
    // Found by API fuzzing: a provider the enum does not know reached Prisma and came back as a 500.
    const filter = provider ? z.enum(IntegrationProvider).parse(provider) : undefined;
    return this.prisma.client.integrationEvent.findMany({
      where: filter ? { provider: filter } : {},
      orderBy: { receivedAt: 'desc' },
      take: limit,
    });
  }
}

function isUniqueViolation(error: unknown): boolean {
  return (
    typeof error === 'object' && error !== null && 'code' in error && (error as { code?: string }).code === 'P2002'
  );
}
