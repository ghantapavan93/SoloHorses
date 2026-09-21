import { expect, test } from '@playwright/test';
import { signIn } from './helpers';

/**
 * The reliability surfaces, driven the way a reviewer would drive them. These run the
 * real pipeline against the running stack, so they assert on what the tables report, not
 * on copy.
 */
test.describe('reliability', () => {
  test('landing page still offers engineers the lab', async ({ page }) => {
    await page.goto('/');
    await expect(page.getByRole('heading', { name: /The records already exist/ })).toBeVisible();
    await page.getByRole('link', { name: /Break the system/ }).click();
    await expect(page).toHaveURL(/\/login\?next=%2Flab|\/login\?next=\/lab/);
  });

  test('operations board lists exceptions with the rule that raised them', async ({ page }) => {
    await signIn(page, 'admin@daysheet.local');
    await page.goto('/operations');
    await expect(
      page.getByRole('heading', { name: /require|requires attention|Nothing requires attention/ }),
    ).toBeVisible();
    await expect(page.getByRole('tab', { name: /Board/ })).toBeVisible();
    // Every seeded world has at least one held order or missing recip; the rule label is on the row.
    await expect(
      page.getByText(/no recip is set aside|is holding|was never recorded|never confirmed/).first(),
    ).toBeVisible();
  });

  test('duplicate webhook: three deliveries, one payment', async ({ page }) => {
    await signIn(page, 'admin@daysheet.local');
    await page.goto('/lab');
    await expect(page.getByRole('heading', { name: 'Break the system' })).toBeVisible();
    const row = page.getByRole('listitem').filter({ hasText: /Send the same Stripe webhook three times/ });
    await row.getByRole('button', { name: 'Break it' }).click();
    const scoreboard = page.getByText(/"deliveries":3,"processed":1,"duplicatesRejected":2,"paymentsCreated":1/);
    await expect(scoreboard).toBeVisible({ timeout: 30_000 });
  });

  test('architecture page reports from the ledger and the registry', async ({ page }) => {
    await signIn(page, 'billing@daysheet.local');
    await page.goto('/architecture');
    await expect(page.getByRole('heading', { name: 'Architecture' })).toBeVisible();
    await expect(page.getByText('accounting.sync-payment')).toBeVisible();
    await expect(page.getByText(/Circuit breakers/i)).toBeVisible();
  });

  test('a recip user cannot open the lab', async ({ page }) => {
    await signIn(page, 'recips@daysheet.local');
    await page.goto('/lab');
    await expect(page.getByText(/is not part of the Recip farm view/)).toBeVisible();
  });
});
