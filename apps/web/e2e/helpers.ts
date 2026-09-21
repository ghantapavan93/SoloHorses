import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { expect, type BrowserContext, type Page } from '@playwright/test';

const AUTH_DIR = resolve(__dirname, '.auth');
const MAX_AGE_MS = 10 * 60 * 1000;

/** The world's own stamp: a cached session belongs to the world it was signed into, and a reseed makes it a stranger. */
async function seededAt(page: Page): Promise<string | null> {
  try {
    const health = await page.request.get(`${process.env.API_URL ?? 'http://localhost:3101'}/health`);
    return ((await health.json()) as { seededAt?: string | null }).seededAt ?? null;
  } catch {
    return null;
  }
}

/**
 * Signs in as a seeded demo user. The session cookies are cached on disk for ten minutes
 * and reused across specs: the API limits sign-ins per e-mail (ten a minute, on purpose),
 * and a suite that signs in as admin in every test would trip it. A reseed in between
 * invalidates the cache: the users it names no longer exist.
 */
export async function signIn(page: Page, email: string): Promise<void> {
  const file = resolve(AUTH_DIR, `${email.replace(/[^a-z0-9]+/gi, '_')}.json`);
  const world = await seededAt(page);
  if (existsSync(file)) {
    const cached = JSON.parse(readFileSync(file, 'utf8')) as {
      savedAt: number;
      seededAt?: string | null;
      cookies: Awaited<ReturnType<BrowserContext['cookies']>>;
    };
    if (Date.now() - cached.savedAt < MAX_AGE_MS && (cached.seededAt ?? null) === world) {
      await page.context().addCookies(cached.cookies);
      await page.goto('/today', { waitUntil: 'networkidle' });
      if (/\/today$|\/customers\/C-\d{4}$/.test(page.url())) return; // hydrated: the keyboard shortcuts are live
      await page.context().clearCookies();
    }
  }
  await page.goto('/login');
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Password').fill('daysheet-demo');
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  // A client lands on her own record; staff on the Day Sheet. The dev server may still be compiling the page.
  await expect(page).toHaveURL(/\/today$|\/customers\/C-\d{4}$/, { timeout: 20_000 });
  await page.waitForLoadState('networkidle');
  mkdirSync(AUTH_DIR, { recursive: true });
  writeFileSync(
    file,
    JSON.stringify({ savedAt: Date.now(), seededAt: world, cookies: await page.context().cookies() }),
  );
}

/**
 * ⌘J is a listener React attaches after hydration; on a slow runner the first press can land
 * before it exists. Press until the dock answers — a press that reached nobody toggled nothing.
 */
export async function openAskDock(page: Page): Promise<void> {
  const dock = page.getByTestId('ask-dock');
  await expect(async () => {
    await page.keyboard.press('Control+J');
    await expect(dock).toBeVisible({ timeout: 2_000 });
  }).toPass({ timeout: 30_000 });
}
