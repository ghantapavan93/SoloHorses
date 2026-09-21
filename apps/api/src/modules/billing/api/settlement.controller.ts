import { Body, Controller, Get, Param, Post } from '@nestjs/common';
import type { Actor } from '@daysheet/domain';
import { z } from 'zod';
import { ZodBodyPipe } from '../../../platform/http/zod-body.pipe';
import { RateLimit } from '../../../platform/resilience/rate-limit';
import { CurrentActor } from '../../../platform/security/actor';
import { Requires } from '../../../platform/security/permission.guard';
import { SettlementService } from '../application/settlement.service';
import { AuctionAdapter } from '../infrastructure/auction.adapter';

const ReleaseSchema = z.object({ note: z.string().max(200).nullable().default(null) });

/**
 * The sale's settlement, read and acted on. Reading is any staff with invoice rights (a
 * customer sees only their own lot); releasing papers is billing or an admin, and the rule
 * is asked again at the moment of the click.
 */
@Controller()
export class SettlementController {
  constructor(
    private readonly settlement: SettlementService,
    private readonly auction: AuctionAdapter,
  ) {}

  /**
   * The vendor's result, delivered. A real vendor would sign it and call it unauthenticated,
   * like Stripe; no vendor feed was accessed, so this one is a simulated delivery an admin
   * sends, and the row says `simulated`. Same inbox, same translation, same idempotency.
   */
  @Post('integrations/auction/results')
  @Requires('write', 'platform')
  auctionResult(@Body() body: unknown) {
    return this.auction.receive(body, true);
  }

  @Get('settlement')
  @Requires('read', 'invoice')
  async scene(@CurrentActor() actor: Actor) {
    return this.settlement.scene(actor, await this.settlement.lotIdForScene());
  }

  @Get('settlement/:lotId')
  @Requires('read', 'invoice')
  sceneFor(@CurrentActor() actor: Actor, @Param('lotId') lotId: string) {
    return this.settlement.scene(actor, lotId);
  }

  @Post('documents/:id/release')
  @RateLimit({ name: 'documents', points: 5, windowMs: 60_000, scope: 'user' })
  @Requires('write', 'invoice')
  release(
    @CurrentActor() actor: Actor,
    @Param('id') id: string,
    @Body(new ZodBodyPipe(ReleaseSchema)) body: z.infer<typeof ReleaseSchema>,
  ) {
    return this.settlement.release(actor, id, body.note);
  }
}
