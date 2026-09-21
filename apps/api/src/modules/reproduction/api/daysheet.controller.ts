import { Controller, Get, Query } from '@nestjs/common';
import type { Actor } from '@daysheet/domain';
import { CurrentActor } from '../../../platform/security/actor';
import { DaysheetService } from '../application/daysheet.service';

@Controller('daysheet')
export class DaysheetController {
  constructor(private readonly daysheet: DaysheetService) {}

  @Get()
  build(@CurrentActor() actor: Actor, @Query('date') date?: string) {
    return this.daysheet.build(actor, date);
  }
}
