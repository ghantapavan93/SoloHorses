import { Global, Module } from '@nestjs/common';
import { EventDispatcher } from './event-dispatcher';
import { OutboxService } from './outbox.service';

@Global()
@Module({ providers: [OutboxService, EventDispatcher], exports: [OutboxService, EventDispatcher] })
export class EventsModule {}
