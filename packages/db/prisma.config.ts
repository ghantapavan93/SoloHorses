import { config as loadEnv } from 'dotenv';
import path from 'node:path';

// One .env at the repo root serves every workspace package.
loadEnv({ path: path.resolve(__dirname, '../../.env') });
import { defineConfig } from 'prisma/config';

// Prisma 7: the datasource URL lives here, not in schema.prisma.
// `prisma generate` must work without a database, so an unset DATABASE_URL falls back to a
// placeholder — one that names the problem, so a migration run against it says
// "database-url-not-set" rather than pointing at a localhost that happens not to answer.
export default defineConfig({
  schema: 'prisma/schema.prisma',
  migrations: {
    path: 'prisma/migrations',
    seed: 'tsx prisma/seed.ts',
  },
  datasource: {
    url: process.env.DATABASE_URL || 'postgresql://unset:unset@database-url-not-set.invalid:5432/unset',
  },
});
