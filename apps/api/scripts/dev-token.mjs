// Mint a short-lived API token for a seeded demo user — the same token the web app mints per request.
// Usage: node scripts/dev-token.mjs [role] [email]   (role defaults to ADMIN; email picks one user, e.g. reviewer@daysheet.local)
import { createHmac } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import pg from 'pg';

const env = Object.fromEntries(
  readFileSync(resolve(import.meta.dirname, '../../../.env'), 'utf8')
    .split('\n')
    .filter((l) => l.includes('=') && !l.startsWith('#'))
    .map((l) => {
      const i = l.indexOf('=');
      return [l.slice(0, i).trim(), l.slice(i + 1).trim()];
    }),
);
const role = (process.argv[2] ?? 'ADMIN').toUpperCase();
const email = process.argv[3] ?? null;
const client = new pg.Client({ connectionString: env.DATABASE_URL });
await client.connect();
const { rows } = email
  ? await client.query('SELECT id, role, "customerId" FROM "User" WHERE email = $1 LIMIT 1', [email])
  : await client.query('SELECT id, role, "customerId" FROM "User" WHERE role = $1 ORDER BY email LIMIT 1', [role]);
await client.end();
if (!rows[0]) {
  console.error(email ? `no seeded user ${email}` : `no seeded user with role ${role}`);
  process.exit(1);
}
const b64 = (v) => Buffer.from(v).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const now = Math.floor(Date.now() / 1000);
const header = b64(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
const payload = b64(
  JSON.stringify({
    sub: rows[0].id,
    role: rows[0].role,
    customerId: rows[0].customerId,
    iss: 'daysheet-web',
    aud: 'daysheet-api',
    iat: now,
    exp: now + 3600,
  }),
);
const signature = b64(createHmac('sha256', env.AUTH_SECRET).update(`${header}.${payload}`).digest());
process.stdout.write(`${header}.${payload}.${signature}`);
