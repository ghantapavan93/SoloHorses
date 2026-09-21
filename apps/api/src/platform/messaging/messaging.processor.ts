import { Injectable, type OnModuleInit } from '@nestjs/common';
import { JobsService } from '../queue/jobs.service';
import { DeliveryService } from './delivery.service';

/** Binds the `send-message` job to delivery. */
@Injectable()
export class MessagingProcessor implements OnModuleInit {
  constructor(
    private readonly jobs: JobsService,
    private readonly delivery: DeliveryService,
  ) {}

  onModuleInit(): void {
    this.jobs.register('send-message', async ({ messageId }) => {
      await this.delivery.deliver(messageId);
    });
  }
}
