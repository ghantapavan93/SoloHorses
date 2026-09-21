// Desktop-width screenshots of running pages, for a design pass: `node scripts/shot.mjs /story /build`.
// Signs in as admin first when a path is prefixed with `admin:` (e.g. `admin:/money`).
import { mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { chromium } from '@playwright/test';

const WEB_URL = process.env.WEB_URL ?? 'http://localhost:3100';
const OUT = resolve(process.env.SHOT_DIR ?? '../../.shots');
mkdirSync(OUT, { recursive: true });

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1366, height: 820 }, deviceScaleFactor: 1 });
let signedIn = false;
for (const arg of process.argv.slice(2)) {
  const admin = arg.startsWith('admin:');
  const path = admin ? arg.slice(6) : arg;
  if (admin && !signedIn) {
    await page.goto(`${WEB_URL}/login`);
    await page.getByLabel('Email').fill('admin@daysheet.local');
    await page.getByLabel('Password').fill('daysheet-demo');
    await page.getByRole('button', { name: 'Sign in', exact: true }).click();
    await page.waitForURL(/\/today/);
    signedIn = true;
  }
  await page.goto(`${WEB_URL}${path}`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(600);
  const name = path.replace(/[^a-z0-9]+/gi, '_').replace(/^_|_$/g, '') || 'root';
  const file = resolve(OUT, `${name}.png`);
  await page.screenshot({ path: file, fullPage: process.env.FULL === '1' });
  console.log(file);
}
await browser.close();
