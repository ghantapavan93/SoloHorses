#!/usr/bin/env node
// `pnpm verify:report` — the same gates as `pnpm verify`, with each suite's count written down.
// Writes .verify/last.json (git-ignored) and docs/verify/last.json (committed) so the honesty page can show a real, dated result
// instead of a badge. Anything that fails is recorded as failed; nothing here rounds up.
import { execSync, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const out = resolve(root, '.verify');
mkdirSync(out, { recursive: true });
const pnpm = process.platform === 'win32' ? 'pnpm.cmd' : 'pnpm';
const npx = process.platform === 'win32' ? 'npx.cmd' : 'npx';
const shell = process.platform === 'win32';
const startedAt = new Date().toISOString();

/** A gate: pass or fail, output straight to the terminal. */
function gate(args) {
  const started = Date.now();
  const res = spawnSync(pnpm, args, { cwd: root, stdio: 'inherit', shell });
  return { ok: res.status === 0, ms: Date.now() - started };
}

/**
 * A suite with a JSON reporter on stdout: the counts come from the runner, not from grepping.
 * The runner is invoked directly in its package (pnpm would read `--reporter` as its own flag).
 */
function suite(pkg, args, count) {
  const started = Date.now();
  // Playwright, like Vitest, writes its JSON to the file when told to; a retried test's error text
  // carries braces that a scan of stdout for the last object cannot see past.
  const res = spawnSync(npx, args, {
    cwd: resolve(root, pkg),
    stdio: ['ignore', 'pipe', 'inherit'],
    shell,
    maxBuffer: 64 * 1024 * 1024,
    env: { ...process.env, CI: '1', PLAYWRIGHT_JSON_OUTPUT_NAME: '.verify-report.json' },
  });
  const stdout = res.stdout?.toString('utf8') ?? '';
  // Vitest writes its JSON to a file, not stdout; a relative name keeps a spaced path out of the shell.
  const file = resolve(root, pkg, '.verify-report.json');
  // A file holds one document and is parsed whole; a retried test's error text carries braces
  // that the last-object scan of stdout cannot see past.
  const json = existsSync(file) ? wholeJson(readFileSync(file, 'utf8')) : lastJson(stdout);
  rmSync(file, { force: true });
  const counted = json ? count(json) : { passed: 0, total: 0 };
  process.stdout
    .write(`${pkg}: ${args.join(' ')} → ${counted.passed} / ${counted.total}${res.status === 0 ? '' : ' (FAILED)'}
`);
  return { ok: res.status === 0 && json !== null, ...counted, ms: Date.now() - started };
}

function wholeJson(text) {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

/** The runner's JSON is the last balanced object on stdout; pnpm prints its own lines before it. */
function lastJson(text) {
  const end = text.lastIndexOf('}');
  if (end === -1) return null;
  let depth = 0;
  for (let i = end; i >= 0; i -= 1) {
    if (text[i] === '}') depth += 1;
    if (text[i] === '{') depth -= 1;
    if (depth === 0) {
      try {
        return JSON.parse(text.slice(i, end + 1));
      } catch {
        return null;
      }
    }
  }
  return null;
}

const jestLike = (j) => ({ passed: j.numPassedTests ?? 0, total: j.numTotalTests ?? 0 });
const playwright = (j) => {
  const specs = (j.suites ?? []).flatMap(function walk(s) {
    return [...(s.specs ?? []), ...(s.suites ?? []).flatMap(walk)];
  });
  return { passed: specs.filter((s) => s.ok).length, total: specs.length };
};

/**
 * The gauntlet: each line is PASS, FAILED or NOT RUN from an artifact on disk — the architecture
 * check runs here; the mutation, fuzz and accessibility passes are their own commands and are read
 * from the reports they leave behind, with their own dates, or reported as not run. Nothing rounds up.
 */
function architecture() {
  const started = Date.now();
  const res = spawnSync(pnpm, ['check:architecture'], {
    cwd: root,
    encoding: 'utf8',
    shell,
    maxBuffer: 16 * 1024 * 1024,
  });
  const text = `${res.stdout ?? ''}${res.stderr ?? ''}`;
  process.stdout.write(text);
  const cruised = /\((\d+) modules, (\d+) dependencies cruised\)/.exec(text);
  const violations = /(\d+) dependency violations/.exec(text);
  return {
    status: res.status === 0 ? 'PASS' : 'FAILED',
    detail: cruised
      ? `${violations ? violations[1] : 0} violations · ${cruised[1]} modules · ${cruised[2]} edges`
      : 'no result',
    ms: Date.now() - started,
  };
}

function readJson(file) {
  try {
    return existsSync(file)
      ? { data: JSON.parse(readFileSync(file, 'utf8')), at: statSync(file).mtime.toISOString() }
      : null;
  } catch {
    return null;
  }
}

function properties(domainJson) {
  const file = (domainJson?.testResults ?? []).find((t) => /invariants\.property\.test\.ts$/.test(t.name));
  if (!file) return { status: 'NOT RUN', detail: 'no property suite in the domain run' };
  const tests = file.assertionResults ?? [];
  const passed = tests.filter((t) => t.status === 'passed').length;
  const runs = /const runs = \(numRuns = (\d+)\)/.exec(
    readFileSync(resolve(root, 'packages/domain/src/invariants.property.test.ts'), 'utf8'),
  );
  const perProperty = runs ? Number(runs[1]) : null;
  return {
    status: passed === tests.length ? 'PASS' : 'FAILED',
    detail: `${passed} / ${tests.length} properties${perProperty ? ` · ${(tests.length * perProperty).toLocaleString('en-US')} generated cases` : ''}`,
  };
}

function mutation() {
  const report = readJson(resolve(root, 'packages/domain/reports/mutation/mutation.json'));
  if (!report) return { status: 'NOT RUN', detail: 'pnpm --filter @daysheet/domain test:mutation' };
  let killed = 0;
  let total = 0;
  for (const file of Object.values(report.data.files ?? {})) {
    for (const m of file.mutants ?? []) {
      if (m.status === 'Killed' || m.status === 'Timeout') killed += 1;
      if (m.status !== 'Ignored' && m.status !== 'CompileError' && m.status !== 'RuntimeError') total += 1;
    }
  }
  const score = total ? (100 * killed) / total : 0;
  return {
    status: total ? 'PASS' : 'FAILED',
    detail: `${score.toFixed(1)}% · ${killed} / ${total} mutants killed`,
    at: report.at,
  };
}

function fuzz() {
  const report = readJson(resolve(root, 'reports/fuzz/schemathesis.json'));
  if (!report) return { status: 'NOT RUN', detail: 'pnpm fuzz:api' };
  const d = report.data;
  // Schemathesis lists each failure and error; the count is the list's length.
  const count = (v) => (Array.isArray(v) ? v.length : Number(v ?? 0));
  const failures = count(d.failures) + count(d.errors) + count(d.operations?.errored);
  return {
    status: d.complete && failures === 0 ? 'PASS' : 'FAILED',
    detail: `${d.operations?.tested ?? 0} operations · ${(d.test_cases?.generated ?? 0).toLocaleString('en-US')} cases · ${failures} server errors`,
    at: d.started_at ?? report.at,
  };
}

function accessibility() {
  const report = readJson(resolve(root, 'reports/a11y/axe.json'));
  if (!report) return { status: 'NOT RUN', detail: 'pnpm --filter web test:e2e -- e2e/a11y.spec.ts' };
  const pages = Object.keys(report.data.pages ?? {});
  const all = Object.values(report.data.pages ?? {}).flatMap((p) => p.violations ?? []);
  return {
    status: report.data.seriousOrCritical === 0 ? 'PASS' : 'FAILED',
    detail: `${pages.length} pages · ${report.data.seriousOrCritical} serious or critical · ${all.length - report.data.seriousOrCritical} minor`,
    at: report.data.at ?? report.at,
  };
}

const gates = { lint: gate(['lint']), typecheck: gate(['typecheck']) };
const gauntlet = { architecture: architecture() };
let domainJson = null;
const suites = {
  domain: suite('packages/domain', ['vitest', 'run', '--reporter=json', '--outputFile=.verify-report.json'], (j) => {
    domainJson = j;
    return jestLike(j);
  }),
  db: suite('packages/db', ['vitest', 'run', '--reporter=json', '--outputFile=.verify-report.json'], jestLike),
  web: suite('apps/web', ['vitest', 'run', '--reporter=json', '--outputFile=.verify-report.json'], jestLike),
  api: suite('apps/api', ['jest', '--json'], jestLike),
};
if (process.env.VERIFY_E2E !== '0')
  suites.e2e = suite('apps/web', ['playwright', 'test', '--reporter=json'], playwright);
gates.build = gate(['build']);
Object.assign(gauntlet, {
  properties: properties(domainJson),
  mutation: mutation(),
  fuzz: fuzz(),
  accessibility: accessibility(),
});

let commit = null;
let dirty = false;
try {
  commit = execSync('git rev-parse --short HEAD', { cwd: root }).toString().trim();
  // A run over uncommitted changes proves the working tree, not the commit; the readout says which.
  // Untracked files are not changes to the commit's code, so they do not count; nor does the file
  // Next rewrites for whichever of dev or build ran last.
  dirty =
    execSync("git status --porcelain --untracked-files=no -- . ':!apps/web/next-env.d.ts'", { cwd: root })
      .toString()
      .trim().length > 0;
} catch {
  /* not a repository */
}

const report = {
  startedAt,
  finishedAt: new Date().toISOString(),
  commit,
  dirty,
  ok:
    Object.values(gates).every((g) => g.ok) &&
    Object.values(suites).every((s) => s.ok) &&
    gauntlet.architecture.status === 'PASS',
  gates,
  suites,
  gauntlet,
};
for (const [name, line] of Object.entries(gauntlet))
  process.stdout.write(`gauntlet · ${name}: ${line.status} — ${line.detail}\n`);
writeFileSync(resolve(out, 'last.json'), JSON.stringify(report, null, 2));
// A copy that travels with the code: docs/verify/last.json is committed, so a deployment that never ran
// the gate can still show a real, dated result — and say which commit it was of.
mkdirSync(resolve(root, 'docs/verify'), { recursive: true });
writeFileSync(resolve(root, 'docs/verify/last.json'), JSON.stringify(report, null, 2) + '\n');
console.log(`\nverify report → .verify/last.json (${report.ok ? 'green' : 'RED'})`);
if (!report.ok) process.exit(1);
