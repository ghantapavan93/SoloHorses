import { Body, Controller, Get, Param, Post, Query } from '@nestjs/common';
import type { Actor } from '@daysheet/domain';
import type { ProposalStatus } from '@daysheet/db';
import { z } from 'zod';
import { ZodBodyPipe } from '../../../platform/http/zod-body.pipe';
import { RateLimit } from '../../../platform/resilience/rate-limit';
import { CurrentActor } from '../../../platform/security/actor';
import { Requires } from '../../../platform/security/permission.guard';
import { ProposalsService } from '../application/proposals.service';

const DeclineSchema = z.object({ note: z.string().min(1).max(300) });
// A bare POST (no body at all) is the plain approval; edits and a note are optional.
const ApproveSchema = z
  .object({ body: z.string().max(2_000).optional(), note: z.string().max(300).optional() })
  .optional();
const STATUSES: (ProposalStatus | 'all')[] = ['PROPOSED', 'APPROVED', 'DECLINED', 'STALE', 'all'];

/** What the assistant proposed, waiting on a person; and the catalog of what it may propose at all. */
@Controller('proposals')
export class ProposalsController {
  constructor(private readonly proposals: ProposalsService) {}

  @Get()
  @Requires('read', 'operations')
  list(@Query('status') status?: string) {
    return this.proposals.list(STATUSES.find((s) => s === status) ?? 'PROPOSED');
  }

  @Get('kinds')
  @Requires('read', 'operations')
  kinds() {
    return this.proposals.kinds();
  }

  @Get(':id')
  @Requires('read', 'operations')
  get(@Param('id') id: string) {
    return this.proposals.get(id);
  }

  /** The decision as a diff: what a yes changes, what it reads, the rule as it stands, who may say yes. */
  @Get(':id/diff')
  @Requires('read', 'operations')
  diff(@CurrentActor() actor: Actor, @Param('id') id: string) {
    return this.proposals.diff(actor, id);
  }

  /** The decision ledger: the signal, the investigation, the proposal, the decision, what ran, what became of it. */
  @Get(':id/ledger')
  @Requires('read', 'operations')
  ledger(@CurrentActor() actor: Actor, @Param('id') id: string) {
    return this.proposals.ledger(actor, id);
  }

  /** Approval re-reads the records first; a proposal whose records moved is marked STALE and nothing runs. */
  @Post(':id/approve')
  @Requires('write', 'operations')
  @RateLimit({ name: 'decisions', points: 30, windowMs: 60_000, scope: 'user' })
  approve(
    @CurrentActor() actor: Actor,
    @Param('id') id: string,
    @Body(new ZodBodyPipe(ApproveSchema)) body: z.infer<typeof ApproveSchema>,
  ) {
    return this.proposals.approve(actor, id, body ?? {});
  }

  @Post(':id/decline')
  @Requires('write', 'operations')
  @RateLimit({ name: 'decisions', points: 30, windowMs: 60_000, scope: 'user' })
  decline(
    @CurrentActor() actor: Actor,
    @Param('id') id: string,
    @Body(new ZodBodyPipe(DeclineSchema)) body: z.infer<typeof DeclineSchema>,
  ) {
    return this.proposals.decline(actor, id, body.note);
  }
}
