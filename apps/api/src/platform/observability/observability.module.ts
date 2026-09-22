import { Global, Module } from '@nestjs/common';
import { HealthController } from './health.controller';
import { HealthRegistry } from './health.registry';
import { MetricsService } from './metrics.service';
import { PlatformBus } from './platform-bus';
import { PlatformController } from './platform.controller';
import { StreamController } from './stream.controller';

/** The bus and the counters are global; the controllers read from every other platform module. */
@Global()
@Module({
  controllers: [HealthController, StreamController, PlatformController],
  providers: [PlatformBus, MetricsService, HealthRegistry],
  exports: [PlatformBus, MetricsService, HealthRegistry],
})
export class ObservabilityModule {}
