import { Body, Controller, Param, Post } from '@nestjs/common';
import { ClearanceKindSchema, ClearanceResultSchema, type Actor } from '@daysheet/domain';
import { z } from 'zod';
import { CurrentActor } from '../../../platform/security/actor';
import { Requires } from '../../../platform/security/permission.guard';
import { ZodBodyPipe } from '../../../platform/http/zod-body.pipe';
import { ClearancesService } from '../application/clearances.service';

const RecordClearanceSchema = z.object({
  kind: ClearanceKindSchema,
  result: ClearanceResultSchema,
  note: z.string().max(300).nullable().optional(),
});

@Controller('horses')
export class ClearancesController {
  constructor(private readonly clearances: ClearancesService) {}

  /** The vet's word on a mare. The rules read it on the next sweep; nothing is decided here. */
  @Post(':id/clearances')
  @Requires('write', 'check')
  record(
    @CurrentActor() actor: Actor,
    @Param('id') horseId: string,
    @Body(new ZodBodyPipe(RecordClearanceSchema)) body: z.infer<typeof RecordClearanceSchema>,
  ) {
    return this.clearances.record(actor, { horseId, kind: body.kind, result: body.result, note: body.note ?? null });
  }
}
