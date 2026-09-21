import { Injectable, type OnModuleInit } from '@nestjs/common';
import { JobsService } from '../../../platform/queue/jobs.service';
import { AccountingService } from '../application/accounting.service';

/** Binds `qbo-sync` and `reconcile` jobs to the accounting service. */
@Injectable()
export class AccountingProcessor implements OnModuleInit {
  constructor(
    private readonly jobs: JobsService,
    private readonly accounting: AccountingService,
  ) {}

  onModuleInit(): void {
    this.jobs.register('qbo-sync', async (payload, job) => {
      await this.accounting.sync(payload.entityType, payload.entityId, job);
    });
    this.jobs.register('reconcile', async (payload) => {
      await this.accounting.reconcileNow(payload.requestedBy);
    });
  }
}
