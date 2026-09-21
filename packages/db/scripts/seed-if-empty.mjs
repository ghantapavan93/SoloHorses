#!/usr/bin/env node
// Seeds the synthetic world once, on an empty database, when SEED_ON_EMPTY=true. A database
// that already holds customers is left exactly as it is — a deploy never resets a demo
// someone is in the middle of.
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import pg from 'pg';

if (process.env.SEED_ON_EMPTY !== 'true') process.exit(0);
const url = process.env.DATABASE_URL;
if (!url) {
  console.error('seed-if-empty: DATABASE_URL is not set');
  process.exit(1);
}
const client = new pg.Client({ connectionString: url });
await client.connect();
const { rows } = await client.query('SELECT count(*)::int AS n FROM "Customer"');
await client.end();
if (rows[0].n > 0) {
  console.log(`seed-if-empty: ${rows[0].n} customers already; not seeding`);
  process.exit(0);
}
const here = dirname(fileURLToPath(import.meta.url));
const res = spawnSync(process.platform === 'win32' ? 'pnpm.cmd' : 'pnpm', ['exec', 'tsx', 'prisma/seed.ts'], {
  cwd: resolve(here, '..'),
  stdio: 'inherit',
  shell: process.platform === 'win32',
});
process.exit(res.status ?? 1);
