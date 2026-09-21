import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';
import { signIn } from './helpers';

/**
 * axe over the surfaces a reviewer reads: the two front doors, the honesty page, the future page,
 * the landing, and the three working screens behind sign-in. Serious and critical violations fail;
 * moderate and minor are written to the report for a person to read. WCAG 2.1 AA rules only, so
 * the count means something. The report lands in reports/a11y/axe.json (git-ignored), where the
 * honesty page reads it.
 */
const PUBLIC = ['/', '/story', '/settlement', '/build', '/vision'];
const SIGNED_IN = ['/today', '/operations', '/decisions'];
const REPORT = resolve(__dirname, '../../../reports/a11y/axe.json');

type Finding = { page: string; id: string; impact: string; help: string; nodes: number; sample: string };
type Report = { at: string; pages: Record<string, { at: string; violations: Finding[] }>; seriousOrCritical: number };

/**
 * One entry per page, written as each page is scanned: a failed test restarts the worker, so an
 * in-memory list would only remember the pages after the last failure.
 */
function record(path: string, violations: Finding[]): void {
  mkdirSync(resolve(REPORT, '..'), { recursive: true });
  const previous: Report | null = existsSync(REPORT) ? (JSON.parse(readFileSync(REPORT, 'utf8')) as Report) : null;
  const pages = { ...(previous?.pages ?? {}), [path]: { at: new Date().toISOString(), violations } };
  const seriousOrCritical = Object.values(pages)
    .flatMap((p) => p.violations)
    .filter((f) => f.impact === 'serious' || f.impact === 'critical').length;
  writeFileSync(REPORT, JSON.stringify({ at: new Date().toISOString(), pages, seriousOrCritical }, null, 2));
}

async function scan(page: Page, path: string): Promise<void> {
  await page.goto(path, { waitUntil: 'networkidle' });
  const results = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa']).analyze();
  record(
    path,
    results.violations.map((v) => ({
      page: path,
      id: v.id,
      impact: v.impact ?? 'unknown',
      help: v.help,
      nodes: v.nodes.length,
      sample: v.nodes[0]?.target.join(' ') ?? '',
    })),
  );
  const blocking = results.violations.filter((v) => v.impact === 'serious' || v.impact === 'critical');
  expect(
    blocking.map((v) => `${v.id} (${v.impact}) ×${v.nodes.length}: ${v.help} — ${v.nodes[0]?.target.join(' ')}`),
    `${path}: serious or critical violations`,
  ).toEqual([]);
}

test.describe('accessibility (axe, WCAG 2.1 AA)', () => {
  for (const path of PUBLIC) {
    test(`public · ${path}`, async ({ page }) => {
      await scan(page, path);
    });
  }

  for (const path of SIGNED_IN) {
    test(`admin · ${path}`, async ({ page }) => {
      await signIn(page, 'admin@daysheet.local');
      await scan(page, path);
    });
  }
});
