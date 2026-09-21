import { config as loadEnv } from 'dotenv';
import path from 'node:path';

// One .env at the repo root serves every workspace package.
loadEnv({ path: path.resolve(__dirname, '../../.env') });
import { defineConfig } from 'prisma/config';

// Prisma 7: the datasource URL lives here, not in schema.prisma.
// `prisma generate` must work without a database, so we fall back to a placeholder.
export default defineConfig({
  schema: 'prisma/schema.prisma',
  migrations: {
    path: 'prisma/migrations',
    seed: 'tsx prisma/seed.ts',
  },
  datasource: {
    url: process.env.DATABASE_URL ?? 'postgresql://postgres:postgres@127.0.0.1:5432/daysheet?schema=public',
  },
});
