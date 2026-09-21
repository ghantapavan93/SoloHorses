import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from './generated/prisma/client';

export * from './generated/prisma/client';

export interface CreatePrismaClientOptions {
  connectionString: string;
  /** Log SQL to stdout. Off by default; noisy under Jest. */
  logQueries?: boolean;
}

/**
 * Prisma 7 requires a driver adapter; there is no bundled query engine.
 * One pool per process. Callers own `$disconnect()`.
 */
export function createPrismaClient(options: CreatePrismaClientOptions): PrismaClient {
  const adapter = new PrismaPg({ connectionString: options.connectionString });
  return new PrismaClient({
    adapter,
    log: options.logQueries ? ['query', 'warn', 'error'] : ['warn', 'error'],
  });
}
