import { Injectable, type OnModuleDestroy, type OnModuleInit } from '@nestjs/common';
import { createPrismaClient, type PrismaClient } from '@daysheet/db';
import { EnvService } from '../config/env.module';

/**
 * One Prisma client per process. Services inject this rather than the raw client so the
 * connection lifecycle is owned in exactly one place.
 */
@Injectable()
export class PrismaService implements OnModuleInit, OnModuleDestroy {
  readonly client: PrismaClient;

  constructor(envService: EnvService) {
    this.client = createPrismaClient({ connectionString: envService.env.DATABASE_URL, logQueries: false });
  }

  async onModuleInit(): Promise<void> {
    await this.client.$connect();
  }

  async onModuleDestroy(): Promise<void> {
    await this.client.$disconnect();
  }
}
