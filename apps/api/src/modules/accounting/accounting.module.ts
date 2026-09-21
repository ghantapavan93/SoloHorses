import { Module } from '@nestjs/common';
import { EnvService } from '../../platform/config/env.module';
import { PrismaService } from '../../platform/persistence/prisma.service';
import { AccountingController } from './api/accounting.controller';
import { AccountingConsumers } from './application/accounting.consumers';
import { AccountingService } from './application/accounting.service';
import { IntegrityService } from './application/integrity.service';
import { AccountingProcessor } from './infrastructure/accounting.processor';
import { ACCOUNTING_PROVIDER } from './infrastructure/accounting.provider';
import { QboAdapter } from './infrastructure/qbo.adapter';
import { QboSimulator } from './infrastructure/qbo.simulator';

/**
 * The provider is chosen once at boot: a real sandbox adapter when credentials exist,
 * otherwise the durable simulator. Everything downstream depends on the port only.
 */
@Module({
  controllers: [AccountingController],
  providers: [
    AccountingService,
    IntegrityService,
    AccountingProcessor,
    AccountingConsumers,
    {
      provide: ACCOUNTING_PROVIDER,
      inject: [EnvService, PrismaService],
      useFactory: (envService: EnvService, prisma: PrismaService) =>
        envService.env.QBO_CLIENT_ID.length > 0
          ? new QboAdapter(envService, prisma)
          : new QboSimulator(prisma, envService),
    },
  ],
  exports: [AccountingService, IntegrityService, ACCOUNTING_PROVIDER],
})
export class AccountingModule {}
