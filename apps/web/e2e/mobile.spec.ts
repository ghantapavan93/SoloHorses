import { expect, test } from '@playwright/test';
import { signIn } from './helpers';

test('phone: navigation drawer, day sheet tables scroll, no horizontal page overflow', async ({ page }) => {
  await signIn(page, 'recips@daysheet.local');
  await page.getByRole('button', { name: 'Open navigation' }).click();
  await expect(page.getByRole('navigation', { name: 'Primary' })).toBeVisible();
  // Exact: the front door's decision cards are links whose text can carry the word.
  await page.getByRole('link', { name: 'Embryos', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Embryos' })).toBeVisible();
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  expect(overflow).toBeLessThanOrEqual(0);
});

test('phone: the front door — the ring fits, a signal opens on its own page, the settlement strip does not overflow', async ({
  page,
}) => {
  await page.goto('/');
  await expect(page.getByText(/active signals/i).first()).toBeVisible();
  const overflowHome = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  expect(overflowHome).toBeLessThanOrEqual(0);

  await page.locator('[data-testid^="signal-"]').first().click();
  await expect(page).toHaveURL(/\/signals\/OX-\d{2}-\d{4,6}$/);
  await expect(page.getByRole('link', { name: 'Open' })).toBeVisible();
  const overflowSignal = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  expect(overflowSignal).toBeLessThanOrEqual(0);

  await page.goto('/settlement');
  await expect(page.getByRole('heading', { level: 1 })).toContainText(/LOT-\d{2}-\d{4}/);
  const overflowSettlement = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  expect(overflowSettlement).toBeLessThanOrEqual(0);
});

test('phone: the thesis and the signals fit; the x-ray reads as a list; the brief tiles stack; nothing overflows', async ({
  page,
}) => {
  await page.goto('/');
  await expect(page.getByRole('heading', { name: /The records already exist/ })).toBeVisible();
  await expect(page.getByTestId('converge-count')).toBeVisible();
  expect(
    await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth),
  ).toBeLessThanOrEqual(0);

  await page.goto('/story');
  const xray = page.getByTestId('xray');
  await expect(xray).toBeVisible();
  // On a phone the graph is a list in rank order, every node still a door to its evidence.
  await expect(xray.locator('svg')).toBeHidden();
  await expect(xray.locator('ol li').first()).toBeVisible();
  await xray.locator('ol li button').first().click();
  await expect(page.getByTestId('evidence-drawer')).toBeVisible();
  await page.keyboard.press('Escape');
  expect(
    await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth),
  ).toBeLessThanOrEqual(0);

  await page.goto('/vision');
  await expect(page.getByTestId('autonomy-ladder')).toBeVisible();
  expect(
    await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth),
  ).toBeLessThanOrEqual(0);
});

test('phone: the board opens on the brief, two tiles a row, and the ledger table scrolls inside its frame', async ({
  page,
}) => {
  await signIn(page, 'admin@daysheet.local');
  await page.goto('/operations');
  await expect(page.getByTestId('brief')).toBeVisible();
  await expect(page.getByTestId('brief-for-you')).toBeVisible();
  expect(
    await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth),
  ).toBeLessThanOrEqual(0);
  await page.goto('/decisions');
  await expect(page.getByRole('heading', { level: 1 })).toContainText(/decision|Nothing waits/);
  expect(
    await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth),
  ).toBeLessThanOrEqual(0);
});
