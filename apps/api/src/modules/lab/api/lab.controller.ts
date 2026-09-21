import { BadRequestException, Body, Controller, Get, Param, Post } from '@nestjs/common';
import type { Actor } from '@daysheet/domain';
import { z } from 'zod';
import { ZodBodyPipe } from '../../../platform/http/zod-body.pipe';
import { CurrentActor } from '../../../platform/security/actor';
import { Requires } from '../../../platform/security/permission.guard';
import { LabService, SCENARIOS, type Scenario } from '../application/lab.service';

const BooksSchema = z.object({ down: z.boolean() });
const LotSchema = z.object({
  lotId: z
    .string()
    .regex(/^LOT-\d{2}-\d{4,6}$/)
    .optional(),
});

/** Break the system on purpose. Admins only; simulators only; never in production. */
@Controller('lab')
export class LabController {
  constructor(private readonly lab: LabService) {}

  @Get('status')
  @Requires('read', 'platform')
  status() {
    return this.lab.status();
  }

  @Get('scenarios')
  @Requires('read', 'platform')
  scenarios() {
    return SCENARIOS;
  }

  @Post('run/:scenario')
  @Requires('write', 'platform')
  run(@CurrentActor() actor: Actor, @Param('scenario') scenario: Scenario) {
    if (!(scenario in SCENARIOS)) throw new BadRequestException(`unknown scenario ${scenario}`);
    return this.lab.run(actor, scenario);
  }

  @Post('restore-accounting')
  @Requires('write', 'platform')
  restore(@CurrentActor() actor: Actor) {
    return this.lab.restoreAccounting(actor);
  }

  @Post('resume-workers')
  @Requires('write', 'platform')
  resume(@CurrentActor() actor: Actor) {
    return this.lab.resumeWorkers(actor);
  }

  @Get('runs/:runId')
  @Requires('read', 'platform')
  history(@Param('runId') runId: string) {
    return this.lab.runHistory(runId);
  }

  /** The front door's two controls, in context: the same pipeline as the scenarios above. */
  @Post('story/redeliver-webhook')
  @Requires('write', 'platform')
  storyRedeliver(@CurrentActor() actor: Actor) {
    return this.lab.storyRedeliverWebhook(actor);
  }

  @Post('story/books')
  @Requires('write', 'platform')
  storyBooks(@CurrentActor() actor: Actor, @Body(new ZodBodyPipe(BooksSchema)) body: z.infer<typeof BooksSchema>) {
    return this.lab.storyBooks(actor, body.down);
  }

  /** The settlement page's simulated controls. Releasing the papers is not here: that is `POST /documents/:id/release`, a person's click. */
  @Post('settlement/new')
  @Requires('write', 'platform')
  settlementNew(@CurrentActor() actor: Actor) {
    return this.lab.settlementNew(actor);
  }

  /** Both act on the lot named in the body — the one on the person's screen — or, without one, on the current sale scene. */
  @Post('settlement/settle-ach')
  @Requires('write', 'platform')
  settlementSettleAch(@CurrentActor() actor: Actor, @Body(new ZodBodyPipe(LotSchema)) body: z.infer<typeof LotSchema>) {
    return this.lab.settlementSettleAch(actor, body.lotId);
  }

  @Post('settlement/conflict')
  @Requires('write', 'platform')
  settlementConflict(@CurrentActor() actor: Actor, @Body(new ZodBodyPipe(LotSchema)) body: z.infer<typeof LotSchema>) {
    return this.lab.settlementConflict(actor, body.lotId);
  }
}
