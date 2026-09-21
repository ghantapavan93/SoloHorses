import { Global, Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { CircuitBreakerRegistry } from './circuit-breaker';
import { RateLimitGuard, RateLimiter } from './rate-limit';

@Global()
@Module({
  providers: [CircuitBreakerRegistry, RateLimiter, { provide: APP_GUARD, useClass: RateLimitGuard }],
  exports: [CircuitBreakerRegistry, RateLimiter],
})
export class ResilienceModule {}
