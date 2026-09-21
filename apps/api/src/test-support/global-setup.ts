import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { config as loadEnv } from 'dotenv';
import { createPrismaClient } from '@daysheet/db';

/**
 * Jest global setup: point the integration tests at their own database.
 *
 * The specs write real rows (fixtures in season 99, payments, audit events). Running them
 * against the demo database left test contracts on the Contracts page, so they get a sibling
 * database — `<name>_test` next to DATABASE_URL, or TEST_DATABASE_URL when set — which is
 * created if missing, migrated, and seeded afresh for every run (the specs need the seeded
 * users and a few seeded records). Every run, not only when the seed changes: the specs never
 * clean up after themselves, and a database that kept every run's scenes, jobs and audit rows
 * grew until the detectors and the outbox took longer than a test's budget — the suite went
 * red for no reason in the code. The seed takes seconds; the review graph's own schema goes
 * with it, so its checkpoints start empty too.
 *
 * The suite runs one spec at a time (`maxWorkers: 1` in package.json). Every spec builds a
 * partial application over the same database and the same outbox; a second worker's flush
 * would publish this worker's pending events to a consumer set that does not include the
 * consumer under test, and the event would be gone. Production processes all carry the full
 * set, so this is a property of the test harness, not of the outbox.
 */
const ROOT = path.resolve(__dirname, '../../../..');
const DB_PACKAGE = path.join(ROOT, 'packages/db');
const PRISMA_CLI = path.join(DB_PACKAGE, 'node_modules/prisma/build/index.js');
const TSX_CLI = path.join(DB_PACKAGE, 'node_modules/tsx/dist/cli.mjs');

export default async function globalSetup(): Promise<void> {
  loadEnv({ path: path.join(ROOT, '.env'), quiet: true });
  const base = process.env.DATABASE_URL;
  if (!base) throw new Error('DATABASE_URL is not set; the integration tests need PostgreSQL');
  const testUrl = process.env.TEST_DATABASE_URL ?? siblingDatabase(base, '_test');
  if (testUrl === base) throw new Error('TEST_DATABASE_URL must differ from DATABASE_URL');

  await ensureDatabase(testUrl);
  const env = { ...process.env, DATABASE_URL: testUrl };
  execFileSync(process.execPath, [PRISMA_CLI, 'migrate', 'deploy'], { cwd: DB_PACKAGE, env, stdio: 'pipe' });
  execFileSync(process.execPath, [TSX_CLI, 'prisma/seed.ts'], { cwd: DB_PACKAGE, env, stdio: 'pipe' });
  await dropReviewGraph(testUrl);

  await alignSeasonCounters(testUrl);

  // Workers fork after this hook, so the test modules read the test database from here on.
  process.env.TEST_DATABASE_URL = testUrl;
  process.env.DATABASE_URL = testUrl;
}

/** `postgresql://…/daysheet?schema=public` → `postgresql://…/daysheet_test?schema=public`. */
function siblingDatabase(url: string, suffix: string): string {
  const parsed = new URL(url);
  const name = parsed.pathname.replace(/^\//, '');
  if (!name) throw new Error(`DATABASE_URL has no database name: ${url}`);
  parsed.pathname = `/${name}${suffix}`;
  return parsed.toString();
}

async function ensureDatabase(url: string): Promise<void> {
  const parsed = new URL(url);
  const name = parsed.pathname.replace(/^\//, '');
  if (!/^[a-z0-9_]+$/i.test(name)) throw new Error(`refusing to create a database named "${name}"`);
  const admin = new URL(url);
  admin.pathname = '/postgres';
  admin.search = '';
  const client = createPrismaClient({ connectionString: admin.toString() });
  try {
    const rows = await client.$queryRaw<
      { exists: boolean }[]
    >`SELECT EXISTS (SELECT 1 FROM pg_database WHERE datname = ${name}) AS "exists"`;
    if (!rows[0]?.exists) await client.$executeRawUnsafe(`CREATE DATABASE "${name}"`);
  } finally {
    await client.$disconnect();
  }
}

/** The review graph keeps its checkpoints in a schema of its own, outside the seed's reach; the checkpointer recreates it on first use. */
async function dropReviewGraph(url: string): Promise<void> {
  const client = createPrismaClient({ connectionString: url });
  try {
    await client.$executeRawUnsafe('DROP SCHEMA IF EXISTS "ask_graph" CASCADE');
  } finally {
    await client.$disconnect();
  }
}

/**
 * A counter is never behind the rows. Fixtures once minted season-99 payment and invoice ids
 * from their own counter while the API minted the same prefix from `Sequence`; the two crossed
 * and a fixture's id collided with the API's. The fixtures now share the API's counters, and
 * this brings a database that predates the fix up to its own rows.
 */
async function alignSeasonCounters(url: string): Promise<void> {
  const client = createPrismaClient({ connectionString: url });
  try {
    for (const [prefix, table] of [
      ['PAY-99', 'Payment'],
      ['INV-99', 'Invoice'],
      ['REF-99', 'Refund'],
    ] as const) {
      await client.$executeRawUnsafe(`
        INSERT INTO "Sequence" ("key", "value")
        SELECT '${prefix}', COALESCE(MAX(NULLIF(regexp_replace("id", '^${prefix}-', ''), '')::int), 0) FROM "${table}" WHERE "id" LIKE '${prefix}-%'
        ON CONFLICT ("key") DO UPDATE SET "value" = GREATEST("Sequence"."value", EXCLUDED."value")`);
    }
  } finally {
    await client.$disconnect();
  }
}
