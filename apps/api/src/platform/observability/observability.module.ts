import { Global, Module } from '@nestjs/common';
import { HealthController } from './health.controller';
import { MetricsService } from './metrics.service';
import { PlatformBus } from './platform-bus';
import { PlatformController } from './platform.controller';
import { StreamController } from './stream.controller';

/** The bus and the counters are global; the controllers read from every other platform module. */
@Global()
@Module({
  controllers: [HealthController, StreamController, PlatformController],
  providers: [PlatformBus, MetricsService],
  exports: [PlatformBus, MetricsService],
})
export class ObservabilityModule {}
