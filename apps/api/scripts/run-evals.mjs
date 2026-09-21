// Runs the Ask eval suite through the running API and prints the scorecard.
// Usage: node scripts/run-evals.mjs [--categories grounding,abstention] [--limit 50] [--min 0.8]
// Needs the API up (API_URL, default http://127.0.0.1:3101) with a model answering Ask: ANTHROPIC_API_KEY (spends real
// money) or a local Ollama model (free, a minute a case). The run is started, then polled until it finishes.
import { execFileSync } from 'node:child_process';
import { resolve } from 'node:path';

const args = new Map();
for (let i = 2; i < process.argv.length; i += 2) args.set(process.argv[i].replace(/^--/, ''), process.argv[i + 1]);
const apiUrl = (process.env.API_URL ?? 'http://127.0.0.1:3101').replace(/\/$/, '');
const categories = args
  .get('categories')
  ?.split(',')
  .map((c) => c.trim())
  .filter(Boolean);
const limit = args.has('limit') ? Number(args.get('limit')) : undefined;
const minimum = Number(args.get('min') ?? '0.8');

const token = execFileSync(process.execPath, [resolve(import.meta.dirname, 'dev-token.mjs'), 'ADMIN'], {
  encoding: 'utf8',
}).trim();
const headers = { authorization: `Bearer ${token}`, 'content-type': 'application/json' };

const started = await fetch(`${apiUrl}/evals/run`, {
  method: 'POST',
  headers,
  body: JSON.stringify({ ...(categories?.length ? { categories } : {}), ...(limit ? { limit } : {}) }),
});
if (!started.ok) {
  console.error(`POST /evals/run → ${started.status}: ${await started.text()}`);
  process.exit(2);
}
const { id, total, model } = await started.json();
console.log(`run ${id} started · model ${model} · ${total} cases`);

// The run fills in on the server; poll it. A local model takes a minute a case, so the wait is long and quiet.
const deadline = Date.now() + 3 * 60 * 60_000;
let detail = null;
let lastReported = -1;
while (Date.now() < deadline) {
  const res = await fetch(`${apiUrl}/evals/runs/${encodeURIComponent(id)}`, {
    headers,
    signal: AbortSignal.timeout(30_000),
  });
  if (!res.ok) {
    console.error(`GET /evals/runs/${id} → ${res.status}`);
    process.exit(2);
  }
  detail = await res.json();
  if (detail.finishedAt) break;
  if (detail.results.length !== lastReported) {
    lastReported = detail.results.length;
    console.log(`  ${detail.results.length}/${total} graded`);
  }
  await new Promise((resolve) => setTimeout(resolve, 5_000));
}
if (!detail?.finishedAt) {
  console.error(`run ${id} did not finish in time`);
  process.exit(2);
}
const run = detail;

const rate = run.total > 0 ? run.passed / run.total : 0;
console.log(
  `run ${run.id} · model ${run.model} · ${run.passed}/${run.total} passed (${Math.round(rate * 100)}%) · ~$${(run.costCents / 100).toFixed(2)}`,
);
for (const [category, bucket] of Object.entries(detail.byCategory))
  console.log(`  ${category.padEnd(14)} ${bucket.passed}/${bucket.total}`);
for (const result of detail.results.filter((r) => !r.passed))
  console.log(`  FAIL ${result.case.category} · ${result.case.input.slice(0, 70)} — ${result.reason ?? ''}`);
console.log(`\nfull run: ${process.env.WEB_URL ?? 'http://localhost:3100'}/evals/${run.id}`);
process.exit(rate >= minimum ? 0 : 1);
