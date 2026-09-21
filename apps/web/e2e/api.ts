import { createHmac } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

/**
 * The API as the demo reviewer, for the few journey steps a page has no control for (closing a
 * team request before the next run prepares it again). The token is the one the web app mints
 * per request — same secret, same claims, same fixed reviewer identity — read from the root .env.
 */
const REVIEWER_USER_ID = 'usr_demo_reviewer';

function rootEnv(): Record<string, string> {
  const text = readFileSync(resolve(__dirname, '../../../.env'), 'utf8');
  return Object.fromEntries(
    text
      .split('\n')
      .filter((line) => line.includes('=') && !line.trim().startsWith('#'))
      .map((line) => {
        const i = line.indexOf('=');
        return [line.slice(0, i).trim(), line.slice(i + 1).trim()];
      }),
  );
}

function reviewerToken(): string {
  const secret = process.env.AUTH_SECRET ?? rootEnv()['AUTH_SECRET'] ?? '';
  const b64 = (v: string | Buffer) =>
    Buffer.from(v).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  const now = Math.floor(Date.now() / 1000);
  const header = b64(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
  const payload = b64(
    JSON.stringify({
      sub: REVIEWER_USER_ID,
      role: 'ADMIN',
      customerId: null,
      iss: 'daysheet-web',
      aud: 'daysheet-api',
      iat: now,
      exp: now + 300,
    }),
  );
  const signature = b64(createHmac('sha256', secret).update(`${header}.${payload}`).digest());
  return `${header}.${payload}.${signature}`;
}

export async function reviewerApi<T>(path: string, init: { method?: string; json?: unknown } = {}): Promise<T> {
  const base = process.env.API_URL ?? 'http://localhost:3101';
  const response = await fetch(`${base}${path}`, {
    method: init.method ?? 'GET',
    headers: { Authorization: `Bearer ${reviewerToken()}`, 'Content-Type': 'application/json' },
    body: init.json !== undefined ? JSON.stringify(init.json) : undefined,
  });
  if (!response.ok) throw new Error(`${init.method ?? 'GET'} ${path} → ${response.status}`);
  const text = await response.text();
  return (text.length === 0 ? null : (JSON.parse(text) as unknown)) as T;
}

/** Closes every open team request that cites the record, so the next journey can prepare a fresh one. */
export async function closeOpenRequestsAbout(recordId: string): Promise<number> {
  const rows = await reviewerApi<{ id: string; status: string; evidenceIds: string[] }[]>('/requests');
  const open = rows.filter((r) => r.status === 'OPEN' && r.evidenceIds.includes(recordId));
  for (const row of open)
    await reviewerApi(`/requests/${row.id}/close`, {
      method: 'POST',
      json: { note: 'closed by the journey before the next run' },
    });
  return open.length;
}
