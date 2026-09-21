import { Body, Controller, Get, Param, Post, Query } from '@nestjs/common';
import type { Actor } from '@daysheet/domain';
import { z } from 'zod';
import { ZodBodyPipe } from '../../../platform/http/zod-body.pipe';
import { CurrentActor } from '../../../platform/security/actor';
import { Requires } from '../../../platform/security/permission.guard';
import { RateLimit } from '../../../platform/resilience/rate-limit';
import { RecordsService } from '../application/records.service';

const NotesSchema = z.object({ notes: z.string().max(500).nullable() });

@Controller()
export class RecordsController {
  constructor(private readonly records: RecordsService) {}

  @Get('embryos')
  @Requires('read', 'embryo')
  listEmbryos(
    @CurrentActor() actor: Actor,
    @Query('status') status?: string,
    @Query('customerId') customerId?: string,
  ) {
    return this.records.listEmbryos(actor, { status, customerId });
  }

  @Get('embryos/:id')
  @Requires('read', 'embryo')
  getEmbryo(@CurrentActor() actor: Actor, @Param('id') id: string) {
    return this.records.getEmbryo(actor, id);
  }

  @Get('contracts')
  @Requires('read', 'contract')
  listContracts(@CurrentActor() actor: Actor) {
    return this.records.listContracts(actor);
  }

  @Get('contracts/:id')
  @Requires('read', 'contract')
  getContract(@CurrentActor() actor: Actor, @Param('id') id: string) {
    return this.records.getContract(actor, id);
  }

  @Get('horses/:id')
  @Requires('read', 'horse')
  getHorse(@CurrentActor() actor: Actor, @Param('id') id: string) {
    return this.records.getHorse(actor, id);
  }

  @Post('horses/:id/notes')
  @Requires('write', 'horse')
  updateNotes(
    @CurrentActor() actor: Actor,
    @Param('id') id: string,
    @Body(new ZodBodyPipe(NotesSchema)) body: z.infer<typeof NotesSchema>,
  ) {
    return this.records.updateHorseNotes(actor, id, body.notes);
  }

  @Get('customers')
  @Requires('read', 'customer')
  listCustomers(@CurrentActor() actor: Actor) {
    return this.records.listCustomers(actor);
  }

  @Get('customers/:id')
  @Requires('read', 'customer')
  getCustomer(@CurrentActor() actor: Actor, @Param('id') id: string) {
    return this.records.getCustomer(actor, id);
  }

  @Get('search')
  @RateLimit({ name: 'search', points: 100, windowMs: 60_000, scope: 'user' })
  search(@CurrentActor() actor: Actor, @Query('q') q = '') {
    return this.records.search(actor, q);
  }
}
