import { NotFoundException, Body, Controller, Get, Param, Post, Query } from '@nestjs/common';
import type { Actor } from '@daysheet/domain';
import type { ExceptionStatus } from '@daysheet/db';
import { z } from 'zod';
import { ZodBodyPipe } from '../../../platform/http/zod-body.pipe';
import { JobsService } from '../../../platform/queue/jobs.service';
import { CurrentActor } from '../../../platform/security/actor';
import { Requires } from '../../../platform/security/permission.guard';
import { EXCEPTIONS } from '../domain/exceptions';
import { BriefService } from '../application/brief.service';
import { DetectorsService } from '../application/detectors.service';
import { ExceptionsService } from '../application/exceptions.service';
import { XrayService } from '../application/xray.service';

const NoteSchema = z.object({ note: z.string().min(1).max(500) });
const AssignSchema = z.object({ ownerId: z.string().nullable() });

/** The board: every unresolved exception, whatever raised it, and what a person may do about it. */
@Controller('operations')
export class OperationsController {
  constructor(
    private readonly exceptions: ExceptionsService,
    private readonly detectors: DetectorsService,
    private readonly jobs: JobsService,
    private readonly briefs: BriefService,
    private readonly xrays: XrayService,
  ) {}

  /**
   * The operational X-ray of one mare: every record about her, the rules that read them, the block,
   * the person it waits for. `focus` lights one of her signals, by id or by kind, the way the
   * assistant's answer does.
   */
  @Get('xray/:recipId')
  @Requires('read', 'operations')
  xray(@CurrentActor() actor: Actor, @Param('recipId') recipId: string, @Query('focus') focus?: string) {
    return this.xrays.build(actor, recipId, focus?.trim() || null);
  }

  @Get('summary')
  @Requires('read', 'operations')
  summary() {
    return this.exceptions.summary();
  }

  /** The morning brief: what needs a person first, what changed since yesterday's snapshot, and the next two days as the rules see them. */
  @Get('brief')
  @Requires('read', 'operations')
  brief(@CurrentActor() actor: Actor) {
    return this.briefs.build(actor);
  }

  /** A decision's x-ray: the mare it is about, every record, the rules, the block, the person — lit at that decision. */
  @Get('signals/:id/xray')
  @Requires('read', 'operations')
  async signalXray(@CurrentActor() actor: Actor, @Param('id') id: string) {
    const xray = await this.xrays.forSignal(actor, id);
    if (!xray) throw new NotFoundException(`${id} has no mare behind it; the signal stands alone`);
    return xray;
  }

  /** The front door's five seconds: decisions waiting, the reader's, what moved, the dollars held up, the three to open first. */
  @Get('brief/morning')
  @Requires('read', 'operations')
  morning(@CurrentActor() actor: Actor) {
    return this.briefs.morning(actor);
  }

  @Get('kinds')
  @Requires('read', 'operations')
  kinds() {
    return EXCEPTIONS;
  }

  /** The front door's ring and dock: the open exceptions as signals, the sale's four channels first. */
  @Get('signals')
  @Requires('read', 'operations')
  async signals(@Query('limit') limit?: string, @Query('owner') owner?: string) {
    // One owner's share, read whole: a worklist is the board filtered, never the first dozen filtered.
    if (owner) return (await this.exceptions.signals(500)).filter((s) => s.owner === owner);
    return this.exceptions.signals(limit ? Math.min(Number(limit) || 12, 50) : 12);
  }

  @Get('signals/:id')
  @Requires('read', 'operations')
  async signal(@Param('id') id: string) {
    const signal = await this.exceptions.signal(id);
    if (!signal) throw new NotFoundException(`${id} not found`);
    return signal;
  }

  @Get('exceptions')
  @Requires('read', 'operations')
  list(@Query('status') status?: string) {
    const statuses = (status ? status.split(',') : ['OPEN', 'ACKNOWLEDGED']).filter((s): s is ExceptionStatus =>
      ['OPEN', 'ACKNOWLEDGED', 'RESOLVED', 'IGNORED'].includes(s),
    );
    return this.exceptions.list(statuses);
  }

  @Get('exceptions/:id')
  @Requires('read', 'operations')
  get(@Param('id') id: string) {
    return this.exceptions.get(id);
  }

  /** Runs every detector now and returns the board's new shape. */
  @Post('detect')
  @Requires('write', 'operations')
  async detect(@CurrentActor() actor: Actor) {
    if (this.jobs.mode === 'inline') return this.detectors.detectAll(actor.userId);
    await this.jobs.enqueue(
      'detect-exceptions',
      { requestedBy: actor.userId },
      { jobId: `detect_manual_${Date.now()}` },
    );
    return { queued: true };
  }

  @Post('exceptions/:id/acknowledge')
  @Requires('write', 'operations')
  acknowledge(@CurrentActor() actor: Actor, @Param('id') id: string) {
    return this.exceptions.acknowledge(actor, id);
  }

  @Post('exceptions/:id/assign')
  @Requires('write', 'operations')
  assign(
    @CurrentActor() actor: Actor,
    @Param('id') id: string,
    @Body(new ZodBodyPipe(AssignSchema)) body: z.infer<typeof AssignSchema>,
  ) {
    return this.exceptions.assign(actor, id, body.ownerId);
  }

  @Post('exceptions/:id/resolve')
  @Requires('write', 'operations')
  resolve(
    @CurrentActor() actor: Actor,
    @Param('id') id: string,
    @Body(new ZodBodyPipe(NoteSchema)) body: z.infer<typeof NoteSchema>,
  ) {
    return this.exceptions.resolve(actor, id, body.note);
  }

  @Post('exceptions/:id/ignore')
  @Requires('write', 'operations')
  ignore(
    @CurrentActor() actor: Actor,
    @Param('id') id: string,
    @Body(new ZodBodyPipe(NoteSchema)) body: z.infer<typeof NoteSchema>,
  ) {
    return this.exceptions.ignore(actor, id, body.note);
  }

  @Post('exceptions/:id/retry')
  @Requires('write', 'operations')
  retry(@CurrentActor() actor: Actor, @Param('id') id: string) {
    return this.exceptions.retry(actor, id);
  }
}
