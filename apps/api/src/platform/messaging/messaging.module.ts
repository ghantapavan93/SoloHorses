import { Global, Module } from '@nestjs/common';
import { DeliveryService } from './delivery.service';
import { MessagingProcessor } from './messaging.processor';
import { MessagingService } from './messaging.provider';

/** The outbound text/email port (Twilio, Resend, or logged) and the job that drains it. */
@Global()
@Module({
  providers: [MessagingService, DeliveryService, MessagingProcessor],
  exports: [MessagingService, DeliveryService],
})
export class MessagingModule {}
