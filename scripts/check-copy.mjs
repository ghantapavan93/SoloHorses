// Fails when product copy or the README reaches for a word that says nothing.
// The product describes what it does; it never sells. Anything a reviewer would roll their
// eyes at is a defect here, the same as a failing test.
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

const BANNED = [
  /\brevolutionary\b/i,
  /\bintelligent ecosystem\b/i,
  /\bnext[- ]generation\b/i,
  /\bAI[- ]powered\b/i,
  /\bseamless(ly)?\b/i,
  /\bunlock(s|ed|ing)?\b/i,
  /\bleverag(e|es|ed|ing)\b/i,
  /\bcutting[- ]edge\b/i,
  /\bgame[- ]chang(er|ing)\b/i,
  /\bbest[- ]in[- ]class\b/i,
  /\bsupercharge/i,
  /\beffortless(ly)?\b/i,
];

// Where a person reads: the web app's screens, the README, the honesty pages. Not tests, not
// third-party notices, not the research notes that quote public pages verbatim.
const ROOTS = ['apps/web/src', 'README.md', 'docs/ASSUMPTIONS.md', 'docs/AI_BUILD_LEDGER.md', 'docs/ARCHITECTURE.md'];
const SKIP = /node_modules|\.next|\.test\.|\.spec\.|e2e[\\/]/;

function* files(path) {
  const st = statSync(path);
  if (st.isFile()) return yield path;
  for (const name of readdirSync(path)) {
    const full = join(path, name);
    if (SKIP.test(full)) continue;
    yield* files(full);
  }
}

const hits = [];
for (const root of ROOTS) {
  for (const file of files(root)) {
    if (!/\.(tsx?|md|mdx|css)$/.test(file)) continue;
    const lines = readFileSync(file, 'utf8').split('\n');
    lines.forEach((line, i) => {
      for (const re of BANNED)
        if (re.test(line)) hits.push(`${relative('.', file)}:${i + 1}  ${line.trim().slice(0, 100)}`);
    });
  }
}

if (hits.length > 0) {
  console.error('Copy that says nothing:\n  ' + hits.join('\n  '));
  process.exit(1);
}
console.log('copy ok');
