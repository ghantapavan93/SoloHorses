import { Body, Controller, Param, Post } from '@nestjs/common';
import type { Actor } from '@daysheet/domain';
import { z } from 'zod';
import { CurrentActor } from '../../../platform/security/actor';
import { Requires } from '../../../platform/security/permission.guard';
import { ZodBodyPipe } from '../../../platform/http/zod-body.pipe';
import { ChecksService } from '../application/checks.service';

const RecordCheckSchema = z.object({
  result: z.enum(['HEARTBEAT', 'PREGNANT', 'OPEN', 'LOST', 'UNCLEAR']),
  dayNumber: z.number().int().min(1).max(400).optional(),
  notes: z.string().max(500).nullable().optional(),
});

@Controller('transfers')
export class ChecksController {
  constructor(private readonly checks: ChecksService) {}

  @Post(':id/checks')
  @Requires('write', 'check')
  record(
    @CurrentActor() actor: Actor,
    @Param('id') transferId: string,
    @Body(new ZodBodyPipe(RecordCheckSchema)) body: z.infer<typeof RecordCheckSchema>,
  ) {
    return this.checks.record(actor, {
      transferId,
      result: body.result,
      dayNumber: body.dayNumber,
      notes: body.notes ?? null,
    });
  }
}
