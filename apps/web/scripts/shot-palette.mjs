// Screenshots of the ⌘K surface in its three states: empty, searching, asking.
import { mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { chromium } from '@playwright/test';

const WEB_URL = process.env.WEB_URL ?? 'http://localhost:3100';
const OUT = resolve(process.env.SHOT_DIR ?? '../../.shots');
mkdirSync(OUT, { recursive: true });

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1366, height: 820 }, deviceScaleFactor: 1 });
await page.goto(`${WEB_URL}/login`);
await page.getByLabel('Email').fill('admin@daysheet.local');
await page.getByLabel('Password').fill('daysheet-demo');
await page.getByRole('button', { name: 'Sign in', exact: true }).click();
await page.waitForURL(/\/today/);

await page.getByRole('button', { name: /Search or ask/ }).waitFor();
await page.waitForTimeout(500);
await page.keyboard.press('Control+K');
await page
  .getByPlaceholder(/or ask a question/)
  .waitFor({ timeout: 5_000 })
  .catch(async () => {
    await page.screenshot({ path: resolve(OUT, 'palette_debug.png') });
    throw new Error('palette did not open');
  });
await page.screenshot({ path: resolve(OUT, 'palette_empty.png') });

await page.keyboard.type('Jane');
await page.waitForTimeout(700);
await page.screenshot({ path: resolve(OUT, 'palette_search.png') });

await page.keyboard.press('Control+A');
await page.keyboard.type('What needs attention right now?');
await page.waitForTimeout(400);
await page.keyboard.press('Enter');
await page
  .getByText(/open exception/i)
  .first()
  .waitFor({ timeout: 20_000 })
  .catch(async () => {
    await page.screenshot({ path: resolve(OUT, 'palette_debug.png') });
    throw new Error('no answer appeared');
  });
await page.waitForTimeout(400);
await page.screenshot({ path: resolve(OUT, 'palette_ask.png') });
console.log('ok');
await browser.close();
