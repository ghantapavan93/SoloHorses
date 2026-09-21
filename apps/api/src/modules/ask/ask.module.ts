import { Module } from '@nestjs/common';
import { AccountingModule } from '../accounting/accounting.module';
import { BillingModule } from '../billing/billing.module';
import { OperationsModule } from '../operations/operations.module';
import { ReproductionModule } from '../reproduction/reproduction.module';
import { AskController } from './api/ask.controller';
import { AskService } from './application/ask.service';
import { AskTools } from './application/ask.tools';
import { ReviewCheckpointer } from './application/review-graph';

@Module({
  imports: [ReproductionModule, OperationsModule, BillingModule, AccountingModule],
  controllers: [AskController],
  providers: [ReviewCheckpointer, AskTools, AskService],
  exports: [AskService],
})
export class AskModule {}
