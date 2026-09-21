import { Module } from '@nestjs/common';
import { ReproductionModule } from '../reproduction/reproduction.module';
import { OperationsController } from './api/operations.controller';
import { ProposalsController } from './api/proposals.controller';
import { BriefService } from './application/brief.service';
import { DetectorsService } from './application/detectors.service';
import { ExceptionsService } from './application/exceptions.service';
import { OperationsConsumers } from './application/operations.consumers';
import { ProposalsService } from './application/proposals.service';
import { RequestsService } from './application/requests.service';
import { XrayService } from './application/xray.service';

/**
 * Operational coordination: the one place every source's "needs a human" lands.
 * Deterministic detectors and event consumers raise; people resolve; the board is the projection.
 */
@Module({
  imports: [ReproductionModule],
  controllers: [OperationsController, ProposalsController],
  providers: [
    ExceptionsService,
    DetectorsService,
    OperationsConsumers,
    ProposalsService,
    BriefService,
    XrayService,
    RequestsService,
  ],
  exports: [ExceptionsService, DetectorsService, ProposalsService, BriefService, XrayService, RequestsService],
})
export class OperationsModule {}
