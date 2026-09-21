import { Body, Controller, Get, Param, Post } from '@nestjs/common';
import type { Actor } from '@daysheet/domain';
import { z } from 'zod';
import { ZodBodyPipe } from '../../../platform/http/zod-body.pipe';
import { CurrentActor } from '../../../platform/security/actor';
import { Requires } from '../../../platform/security/permission.guard';
import { StoryService } from '../application/story.service';
import { TransfersService } from '../application/transfers.service';

const TransferSchema = z.object({
  embryoId: z.string(),
  recipientId: z.string(),
  notes: z.string().max(300).nullable().optional(),
});
const PlanSchema = z.object({ recipientId: z.string() });

/** The front door's data, and the two mutations the rules guard: hold a recip, record a transfer. */
@Controller()
export class StoryController {
  constructor(
    private readonly stories: StoryService,
    private readonly transfers: TransfersService,
  ) {}

  @Get('story')
  @Requires('read', 'embryo')
  async story(@CurrentActor() actor: Actor) {
    return this.stories.build(actor, await this.stories.storyRecipId());
  }

  @Get('story/:recipId')
  @Requires('read', 'embryo')
  storyFor(@CurrentActor() actor: Actor, @Param('recipId') recipId: string) {
    return this.stories.build(actor, recipId);
  }

  @Get('recips/:id/clearance')
  @Requires('read', 'horse')
  clearance(@Param('id') id: string) {
    return this.transfers.clearanceFor(id);
  }

  @Post('embryos/:id/planned-recipient')
  @Requires('write', 'embryo')
  plan(
    @CurrentActor() actor: Actor,
    @Param('id') id: string,
    @Body(new ZodBodyPipe(PlanSchema)) body: z.infer<typeof PlanSchema>,
  ) {
    return this.transfers.assignPlannedRecipient(actor, id, body.recipientId);
  }

  @Post('transfers')
  @Requires('write', 'transfer')
  record(@CurrentActor() actor: Actor, @Body(new ZodBodyPipe(TransferSchema)) body: z.infer<typeof TransferSchema>) {
    return this.transfers.record(actor, {
      embryoId: body.embryoId,
      recipientId: body.recipientId,
      notes: body.notes ?? null,
    });
  }
}
