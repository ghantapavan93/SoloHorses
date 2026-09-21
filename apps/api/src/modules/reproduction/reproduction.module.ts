import { Module } from '@nestjs/common';
import { DaysheetController } from './api/daysheet.controller';
import { IntakeController } from './api/intake.controller';
import { RecordsController } from './api/records.controller';
import { StoryController } from './api/story.controller';
import { DaysheetService } from './application/daysheet.service';
import { IntakeService } from './application/intake.service';
import { RecordsService } from './application/records.service';
import { ReproductionConsumers } from './application/reproduction.consumers';
import { StoryService } from './application/story.service';
import { TransfersService } from './application/transfers.service';

/**
 * Reproduction: embryos, transfers, recips, contracts and semen orders, the Day Sheet that
 * projects them, and intake by text. Reacts to billing's facts (a settled balance makes a
 * contract shippable) without billing knowing it exists.
 */
@Module({
  controllers: [RecordsController, DaysheetController, IntakeController, StoryController],
  providers: [RecordsService, DaysheetService, IntakeService, TransfersService, StoryService, ReproductionConsumers],
  exports: [RecordsService, DaysheetService, IntakeService, TransfersService, StoryService],
})
export class ReproductionModule {}
