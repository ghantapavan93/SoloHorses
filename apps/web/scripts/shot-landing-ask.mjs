// The landing's assistant is the real one: press ⌘K on the front door, ask, get an abstention.
import { mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { chromium } from '@playwright/test';

const WEB_URL = process.env.WEB_URL ?? 'http://localhost:3100';
const OUT = resolve(process.env.SHOT_DIR ?? '../../.shots');
mkdirSync(OUT, { recursive: true });

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1366, height: 820 }, deviceScaleFactor: 1 });
await page.goto(`${WEB_URL}/`, { waitUntil: 'networkidle' });
await page.getByRole('heading', { name: /What needs a person/ }).scrollIntoViewIfNeeded();
await page.waitForTimeout(400);
await page.screenshot({ path: resolve(OUT, 'landing_ops.png') });

await page.getByRole('button', { name: /Ask about the operation/ }).click();
const question = await page.getByRole('button', { name: /cleared for a transfer\?/ }).first();
await question.waitFor({ timeout: 5_000 });
await question.click();
await page
  .getByText(/Veterinary review is required/)
  .first()
  .waitFor({ timeout: 20_000 });
await page.waitForTimeout(300);
await page.screenshot({ path: resolve(OUT, 'landing_ask.png') });
console.log('ok');
await browser.close();
