import { Module } from '@nestjs/common';
import { AccountingModule } from '../accounting/accounting.module';
import { AskModule } from '../ask/ask.module';
import { BillingModule } from '../billing/billing.module';
import { OperationsModule } from '../operations/operations.module';
import { ReproductionModule } from '../reproduction/reproduction.module';
import { VeterinaryModule } from '../veterinary/veterinary.module';
import { LabController } from './api/lab.controller';
import { LabService } from './application/lab.service';

/**
 * The Reliability Lab is a surface, not a context: it drives the real modules through their
 * public services and reads the platform's own tables to report what happened.
 */
@Module({
  imports: [BillingModule, AccountingModule, ReproductionModule, VeterinaryModule, OperationsModule, AskModule],
  controllers: [LabController],
  providers: [LabService],
})
export class LabModule {}
