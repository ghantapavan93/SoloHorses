import { defineConfig, devices } from '@playwright/test';

/**
 * Smoke tests against a running web app (3100) and API (3101) with the seeded database.
 * Locally: `pnpm dev` in one terminal, `pnpm --filter web test:e2e` in another.
 */
export default defineConfig({
  testDir: './e2e',
  timeout: 45_000,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? 'github' : 'list',
  use: {
    baseURL: process.env.WEB_URL ?? 'http://localhost:3100',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  projects: [
    // The journeys run first, one after another, each alone: they settle the current sale and prepare,
    // approve and close requests about the one story mare, so none of them — and none of the other
    // specs — may race another on the same rows. A chain of dependencies is how projects run in series.
    {
      name: 'journey',
      use: { ...devices['Desktop Chrome'], viewport: { width: 1366, height: 768 } },
      testMatch: /[\\/]journey\.spec\.ts$/,
    },
    {
      name: 'journey-front-door',
      use: { ...devices['Desktop Chrome'], viewport: { width: 1366, height: 768 } },
      testMatch: /front-door\.journey\.spec\.ts$/,
      dependencies: ['journey'],
    },
    {
      name: 'journey-loop',
      use: { ...devices['Desktop Chrome'], viewport: { width: 1366, height: 768 } },
      testMatch: /loop\.journey\.spec\.ts$/,
      dependencies: ['journey-front-door'],
    },
    {
      name: 'desktop',
      use: { ...devices['Desktop Chrome'], viewport: { width: 1366, height: 768 } },
      testIgnore: /(mobile|journey|a11y)\.spec\.ts/,
      dependencies: ['journey-loop'],
    },
    { name: 'phone', use: { ...devices['Pixel 7'] }, testMatch: /mobile\.spec\.ts/, dependencies: ['journey-loop'] },
    // The axe scan loads eight pages back to back; run alone after the journeys, so the dev server's
    // compiles do not land on a journey's five-second navigation budget.
    {
      name: 'a11y',
      use: { ...devices['Desktop Chrome'], viewport: { width: 1366, height: 768 } },
      testMatch: /a11y\.spec\.ts/,
      dependencies: ['desktop', 'phone'],
    },
  ],
});
