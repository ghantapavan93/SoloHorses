import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { LoggerModule } from 'nestjs-pino';
import { AccountingModule } from './modules/accounting/accounting.module';
import { AskModule } from './modules/ask/ask.module';
import { EvalsModule } from './modules/ask/evals/evals.module';
import { BillingModule } from './modules/billing/billing.module';
import { LabModule } from './modules/lab/lab.module';
import { OperationsModule } from './modules/operations/operations.module';
import { ReproductionModule } from './modules/reproduction/reproduction.module';
import { VeterinaryModule } from './modules/veterinary/veterinary.module';
import { AuditModule } from './platform/audit/audit.module';
import { CacheModule } from './platform/cache/cache.module';
import { ClockModule } from './platform/clock/clock.module';
import { CodesModule } from './platform/codes/codes.module';
import { EnvModule } from './platform/config/env.module';
import { EventsModule } from './platform/events/events.module';
import { MessagingModule } from './platform/messaging/messaging.module';
import { currentCorrelationId } from './platform/observability/correlation';
import { ObservabilityModule } from './platform/observability/observability.module';
import { PrismaModule } from './platform/persistence/prisma.module';
import { JobsModule } from './platform/queue/jobs.module';
import { ResilienceModule } from './platform/resilience/resilience.module';
import { AuthModule } from './platform/security/auth.module';
import { JwtAuthGuard } from './platform/security/jwt-auth.guard';
import { PermissionGuard } from './platform/security/permission.guard';

/**
 * A modular monolith. `platform/` is what every context stands on — config, persistence,
 * security, audit, codes, clock, events/outbox, queue, cache, resilience, observability,
 * messaging. `modules/` are the bounded contexts in the operation's own language:
 * reproduction, veterinary, billing, accounting, operations, ask. Contexts talk through
 * domain events; none imports another's services except through its public module.
 */
@Module({
  imports: [
    LoggerModule.forRoot({
      pinoHttp: {
        level: process.env.NODE_ENV === 'test' ? 'silent' : 'info',
        transport:
          process.env.NODE_ENV === 'development'
            ? { target: 'pino-pretty', options: { singleLine: true, translateTime: 'HH:MM:ss' } }
            : undefined,
        // Never log bodies or auth headers: they carry passwords, tokens, and customer data.
        redact: {
          paths: ['req.headers.authorization', 'req.headers["x-service-secret"]', 'req.headers.cookie', 'req.body'],
          remove: true,
        },
        autoLogging: { ignore: (req) => req.url === '/health' || (req.url ?? '').startsWith('/platform/stream') },
        // The correlation id on every line is what makes a job's log findable from a request's.
        customProps: () => ({ correlationId: currentCorrelationId() }),
      },
    }),
    // platform
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
    AuthModule,
    // bounded contexts
    ReproductionModule,
    VeterinaryModule,
    BillingModule,
    AccountingModule,
    OperationsModule,
    AskModule,
    EvalsModule,
    LabModule,
  ],
  providers: [
    { provide: APP_GUARD, useClass: JwtAuthGuard },
    { provide: APP_GUARD, useClass: PermissionGuard },
  ],
})
export class AppModule {}
