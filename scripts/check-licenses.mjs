// Fails when a production dependency carries a license outside the allowlist.
// Study-only projects (AGPL/BUSL) are never dependencies here; this keeps it that way.
import { execSync } from 'node:child_process';

const ALLOW = new Set([
  'MIT',
  'MIT-0',
  'ISC',
  'Apache-2.0',
  'BSD-2-Clause',
  'BSD-3-Clause',
  '0BSD',
  'CC0-1.0',
  'Unlicense',
  'MPL-2.0',
  'BlueOak-1.0.0',
  'Python-2.0',
  'CC-BY-4.0',
  'CC-BY-3.0',
  'W3C-20150513',
  'WTFPL',
  // Sentry's CLI ships under the Functional Source License (source-available, becomes MIT after two years).
  // It is a build-time tool for source maps, not shipped code. Documented in THIRD_PARTY_NOTICES.md.
  'FSL-1.1-MIT',
]);

const raw = execSync('pnpm licenses list --json --prod', { encoding: 'utf8', stdio: ['ignore', 'pipe', 'inherit'] });
const byLicense = JSON.parse(raw);
const offenders = [];
for (const [license, packages] of Object.entries(byLicense)) {
  const ok = license
    .split(/\s+(?:OR|AND)\s+|[()]/)
    .map((l) => l.trim())
    .filter(Boolean)
    .some((l) => ALLOW.has(l));
  if (!ok)
    for (const p of packages) offenders.push(`${p.name}@${p.versions?.join(',') ?? p.version ?? '?'} — ${license}`);
}
if (offenders.length > 0) {
  console.error('Disallowed licenses:\n  ' + offenders.join('\n  '));
  process.exit(1);
}
console.log(`licenses ok (${Object.values(byLicense).flat().length} packages)`);
