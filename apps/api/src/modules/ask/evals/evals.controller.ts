import { Body, Controller, Get, HttpCode, Param, Post } from '@nestjs/common';
import type { Actor } from '@daysheet/domain';
import { z } from 'zod';
import { CurrentActor } from '../../../platform/security/actor';
import { Requires } from '../../../platform/security/permission.guard';
import { ZodBodyPipe } from '../../../platform/http/zod-body.pipe';
import { EvalsService } from './evals.service';

const RunSchema = z.object({
  categories: z.array(z.string()).optional(),
  limit: z.number().int().min(1).max(200).optional(),
});

const ToggleSchema = z.object({ enabled: z.boolean() });

@Controller('evals')
export class EvalsController {
  constructor(private readonly evals: EvalsService) {}

  @Get('runs')
  @Requires('read', 'evals')
  runs() {
    return this.evals.listRuns();
  }

  @Get('runs/:id')
  @Requires('read', 'evals')
  run(@Param('id') id: string) {
    return this.evals.getRun(id);
  }

  @Get('cases')
  @Requires('read', 'evals')
  cases() {
    return this.evals.listCases();
  }

  @Post('cases/:id/toggle')
  @Requires('write', 'evals')
  toggle(@Param('id') id: string, @Body(new ZodBodyPipe(ToggleSchema)) body: z.infer<typeof ToggleSchema>) {
    return this.evals.toggleCase(id, body.enabled);
  }

  /** Starts the suite and answers at once with the run's id; `GET runs/:id` fills in as cases are graded. Spends money on a metered model; nothing on a local one. */
  @Post('run')
  @HttpCode(202)
  @Requires('write', 'evals')
  start(@CurrentActor() actor: Actor, @Body(new ZodBodyPipe(RunSchema)) body: z.infer<typeof RunSchema>) {
    return this.evals.start({ categories: body.categories, limit: body.limit, requestedBy: actor });
  }
}
