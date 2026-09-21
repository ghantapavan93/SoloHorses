import type { ModuleMetadata } from '@nestjs/common';
import { Test, type TestingModule } from '@nestjs/testing';
import { config as loadEnv } from 'dotenv';
import path from 'node:path';
import { AuditModule } from '../platform/audit/audit.module';
import { CacheModule } from '../platform/cache/cache.module';
import { ClockModule } from '../platform/clock/clock.module';
import { CodesModule } from '../platform/codes/codes.module';
import { EnvModule } from '../platform/config/env.module';
import { EventsModule } from '../platform/events/events.module';
import { MessagingModule } from '../platform/messaging/messaging.module';
import { ObservabilityModule } from '../platform/observability/observability.module';
import { PrismaModule } from '../platform/persistence/prisma.module';
import { JobsModule } from '../platform/queue/jobs.module';
import { ResilienceModule } from '../platform/resilience/resilience.module';

loadEnv({ path: path.resolve(__dirname, '../../../../.env'), quiet: true });
process.env.NODE_ENV = 'test';
// The global setup (global-setup.ts) prepares a sibling test database and names it here;
// the demo database is never written by a spec.
if (process.env.TEST_DATABASE_URL) process.env.DATABASE_URL = process.env.TEST_DATABASE_URL;

/**
 * A testing module with the same global providers the real app has. Jobs run inline
 * (NODE_ENV=test skips the Redis probe), so a test sees the whole pipeline synchronously.
 */
export async function createTestModule(
  metadata: ModuleMetadata,
  options: { overrides?: { provide: unknown; useValue: unknown }[] } = {},
): Promise<TestingModule> {
  let builder = Test.createTestingModule({
    ...metadata,
    imports: [
      EnvModule,
      PrismaModule,
      ClockModule,
      CodesModule,
      ObservabilityModule,
      AuditModule,
      JobsModule,
      EventsModule,
      ResilienceModule,
      CacheModule,
      MessagingModule,
      ...(metadata.imports ?? []),
    ],
  });
  // A fake for an outside system (Stripe as it would answer) without touching the network.
  for (const override of options.overrides ?? [])
    builder = builder.overrideProvider(override.provide).useValue(override.useValue);
  const moduleRef = await builder.compile();
  await moduleRef.init();
  return moduleRef;
}
