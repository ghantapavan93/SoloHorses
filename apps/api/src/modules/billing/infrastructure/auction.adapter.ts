import { BadRequestException, Injectable, Logger, type OnModuleInit } from '@nestjs/common';
import { z } from 'zod';
import { JobsService, UnrecoverableJobError } from '../../../platform/queue/jobs.service';
import { PrismaService } from '../../../platform/persistence/prisma.service';
import { SettlementService, type AuctionResult } from '../application/settlement.service';
import { IntegrationEventsService } from './integration-events.service';

/**
 * The anti-corruption layer around the auction vendor. The sale runs on a vendor's platform
 * (FACT: the public sale site says so); what that platform would hand the office after the
 * gavel is a result in the vendor's words — a lot number, a hammer price, a buyer, a payment
 * the buyer started. It enters through the same write-once inbox as Stripe, is translated
 * here into the sale's own language (a SaleLot, a settlement invoice, a certificate to hold),
 * and nothing downstream ever sees the vendor's field names.
 *
 * ASSUMPTION (A16): the shape below is invented for the simulation; no vendor API or feed was
 * accessed. A real integration would replace `VendorResultSchema` and nothing else.
 */
const VendorResultSchema = z.object({
  event_id: z.string().min(1),
  sale_code: z.string().min(1),
  lot_number: z.number().int().positive(),
  lot_title: z.string().min(1).max(120),
  lot_type: z.enum(['horse', 'in_utero']),
  closed_at: z.string().min(10),
  hammer_price_cents: z.number().int().positive(),
  buyer: z.object({ reference: z.string().min(1), display_name: z.string().min(1) }),
  payment: z.object({
    method: z.enum(['ach', 'card', 'check', 'cash']),
    status: z.enum(['initiated', 'cleared', 'none']),
    provider_reference: z.string().nullable(),
  }),
  horse_reference: z.string().nullable().optional(),
  recipient_reference: z.string().nullable().optional(),
});
export type VendorResult = z.infer<typeof VendorResultSchema>;

@Injectable()
export class AuctionAdapter implements OnModuleInit {
  private readonly logger = new Logger(AuctionAdapter.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly events: IntegrationEventsService,
    private readonly jobs: JobsService,
    private readonly settlement: SettlementService,
  ) {}

  onModuleInit(): void {
    this.jobs.register('auction-result', ({ integrationEventId }) => this.process(integrationEventId));
  }

  /** Vendor → inbox → job. Duplicates are counted and never processed twice, like any other provider. */
  async receive(
    raw: unknown,
    simulated: boolean,
  ): Promise<{ received: true; duplicate: boolean; eventId: string; mode: string }> {
    const parsed = VendorResultSchema.safeParse(raw);
    // A delivery the schema refuses is the vendor's problem to fix, answered 400 at the door: a 500 would
    // have it redelivered forever, and nothing about a retry changes the payload.
    if (!parsed.success)
      throw new BadRequestException(
        `auction result rejected: ${parsed.error.issues.map((i) => `${i.path.join('.')} ${i.message}`).join('; ')}`,
      );
    const result = await this.events.ingest('AUCTION', parsed.data.event_id, 'auction.lot_closed', {
      ...parsed.data,
      simulated,
    });
    if (result.duplicate) return { received: true, duplicate: true, eventId: parsed.data.event_id, mode: 'inbox' };
    const { mode } = await this.jobs.enqueue(
      'auction-result',
      { integrationEventId: result.id },
      { jobId: `auction_${parsed.data.event_id}` },
    );
    return { received: true, duplicate: false, eventId: parsed.data.event_id, mode };
  }

  /** Job handler: re-reads the inbox row, translates, hands the sale's own words to billing. */
  async process(integrationEventId: string): Promise<void> {
    const row = await this.prisma.client.integrationEvent.findUnique({ where: { id: integrationEventId } });
    if (!row) throw new UnrecoverableJobError(`auction event ${integrationEventId} vanished`);
    if (row.status === 'PROCESSED' || row.status === 'IGNORED') return;
    const parsed = VendorResultSchema.safeParse(row.payload);
    if (!parsed.success) {
      await this.events.markIgnored(row.id, 'payload no longer parses');
      return;
    }
    try {
      const outcome = await this.settlement.recordAuctionResult(
        translate(parsed.data),
        Boolean((row.payload as { simulated?: boolean }).simulated),
        row.correlationId,
      );
      await this.events.markProcessed(row.id);
      this.logger.log(
        `auction ${parsed.data.event_id} → ${outcome.lotId} (${outcome.created ? 'created' : 'already on record'})`,
      );
    } catch (error) {
      await this.events.markFailed(row.id, (error as Error).message);
      throw error;
    }
  }
}

/** The vendor's words become the sale's. This is the whole of the boundary. */
export function translate(v: VendorResult): AuctionResult {
  return {
    externalId: v.event_id,
    saleCode: v.sale_code,
    lotNumber: v.lot_number,
    title: v.lot_title,
    kind: v.lot_type === 'in_utero' ? 'IN_UTERO' : 'HORSE',
    closedOn: v.closed_at.slice(0, 10),
    hammerCents: v.hammer_price_cents,
    buyer: { reference: v.buyer.reference, name: v.buyer.display_name },
    payment: {
      method:
        v.payment.method === 'ach'
          ? 'ACH'
          : v.payment.method === 'card'
            ? 'CARD'
            : v.payment.method === 'check'
              ? 'CHECK'
              : 'CASH',
      state: v.payment.status === 'cleared' ? 'CLEARED' : v.payment.status === 'initiated' ? 'INITIATED' : 'NONE',
      providerReference: v.payment.provider_reference ?? null,
    },
    horseId: v.horse_reference ?? null,
    recipId: v.recipient_reference ?? null,
  };
}
