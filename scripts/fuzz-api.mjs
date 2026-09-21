#!/usr/bin/env node
// `pnpm fuzz:api` — Schemathesis over the running API's OpenAPI document, looking for one thing: a
// 5xx. The document carries no body schemas (no DTO decorators), so schema conformance cannot be
// judged; malformed input reaching a query is what this finds. Reports land in reports/fuzz/ (git-
// ignored), where the honesty page reads them. Needs Python with `pip install schemathesis`.
//
// Excluded on purpose: /lab (arms simulator faults), /evals (starts runs), /ask (a model turn per
// request), /platform/stream (SSE never ends), /integrations/twilio/inbound (503 by design without
// Twilio, and Schemathesis counts a 503 as a server error).
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const apiUrl = (process.env.API_URL ?? 'http://127.0.0.1:3101').replace(/\/$/, '');
const out = resolve(root, 'reports/fuzz');
mkdirSync(out, { recursive: true });

const token = execFileSync(process.execPath, [resolve(root, 'apps/api/scripts/dev-token.mjs'), 'ADMIN'], {
  encoding: 'utf8',
}).trim();
const args = [
  'run',
  `${apiUrl}/docs-json`,
  '--header',
  `Authorization: Bearer ${token}`,
  '--checks',
  'not_a_server_error',
  '--exclude-path-regex',
  '^/(lab|evals|ask|platform/stream|integrations/twilio/inbound)',
  '--phases',
  'examples,fuzzing',
  '--max-examples',
  process.env.FUZZ_EXAMPLES ?? '25',
  '--workers',
  '2',
  '--request-timeout',
  '15',
  '--continue-on-failure',
  '--generation-deterministic',
  '--suppress-health-check',
  'all',
  '--report',
  'junit,json',
  '--report-junit-path',
  resolve(out, 'schemathesis.xml'),
  '--report-json-path',
  resolve(out, 'schemathesis.json'),
];
const res = spawnSync('schemathesis', args, {
  cwd: out,
  stdio: 'inherit',
  shell: process.platform === 'win32',
  env: { ...process.env, PYTHONIOENCODING: 'utf-8', PYTHONUTF8: '1' },
});
if (res.error) {
  console.error(`schemathesis could not start (${res.error.message}); install it with \`pip install schemathesis\``);
  process.exit(2);
}
process.exit(res.status ?? 1);
