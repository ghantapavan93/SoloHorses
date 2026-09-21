import { Injectable, type OnModuleInit } from '@nestjs/common';
import { JobsService } from '../../../platform/queue/jobs.service';
import { PaymentsService } from '../application/payments.service';

/** Binds the `stripe-event` job to the payments service. Thin on purpose. */
@Injectable()
export class StripeEventsProcessor implements OnModuleInit {
  constructor(
    private readonly jobs: JobsService,
    private readonly payments: PaymentsService,
  ) {}

  onModuleInit(): void {
    this.jobs.register('stripe-event', async ({ integrationEventId }) => {
      await this.payments.processIntegrationEvent(integrationEventId);
    });
  }
}
