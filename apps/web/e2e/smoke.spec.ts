import { expect, test } from '@playwright/test';
import { signIn } from './helpers';

test.describe('critical paths', () => {
  test('recip farm: day sheet → embryo record → intake', async ({ page }) => {
    await signIn(page, 'recips@daysheet.local');
    // The day opens on what needs a person; the full sheet is one click below.
    await page.getByTestId('view-day-sheet').click();
    await expect(page.getByRole('heading', { name: /Collection day|No collection today/ })).toBeVisible({
      timeout: 20_000,
    });
    await expect(page.getByText('Checks due')).toBeVisible();
    await expect(page.getByText(/Unofficial candidate prototype/)).toBeVisible();

    // The first embryo code on the sheet opens its record with a timeline.
    const embryoLink = page.locator('table a[href^="/embryos/E-"]').first();
    const code = (await embryoLink.textContent())?.trim() ?? '';
    await embryoLink.click();
    // The first visit to a record page after a build may wait on the dev server's compile.
    await expect(page.getByRole('heading', { name: code })).toBeVisible({ timeout: 20_000 });
    await expect(page.getByRole('heading', { name: 'Timeline' })).toBeVisible();
    // A recip user never sees invoices on a record.
    await expect(page.getByRole('heading', { name: 'Invoices' })).toHaveCount(0);

    await page.goto('/intake');
    await expect(page.getByRole('heading', { name: 'Intake' })).toBeVisible();
    await expect(page.getByText(/not confirmed until we reply/)).toBeVisible();
  });

  test('billing: money page shows discrepancies and the sync log', async ({ page }) => {
    await signIn(page, 'billing@daysheet.local');
    await page.goto('/money');
    await expect(page.getByRole('heading', { name: 'Money' })).toBeVisible();
    await expect(page.getByRole('tab', { name: /Discrepancies/ })).toBeVisible();
    await page.getByRole('tab', { name: /Sync log/ }).click();
    await expect(page.getByText(/invoice · INV-/).first()).toBeVisible();
  });

  test('customer: sees only their own records and no money tabs', async ({ page }) => {
    await signIn(page, 'customer@daysheet.local');
    await expect(page.getByRole('link', { name: 'Money' })).toHaveCount(0);
    await page.goto('/embryos');
    const owners = await page.locator('tbody tr td:nth-child(3)').allTextContents();
    expect(owners.length).toBeGreaterThan(0);
    expect(new Set(owners.map((o) => o.trim())).size).toBe(1);
    // A foreign contract is not found, not leaked.
    await page.goto('/contracts/SS-26-0003');
    await expect(page.getByText(/could not be found/i).first()).toBeVisible();
  });

  test('customer: another client’s records do not exist for her — by URL, on any record kind, or through the assistant', async ({
    page,
  }) => {
    await signIn(page, 'customer@daysheet.local');
    // The story mare’s owner, his embryo, the mare herself and his contract: each is a page that is not there.
    for (const path of ['/customers/C-0006', '/embryos/E-26-0009', '/horses/R-0037', '/contracts/SS-26-0006']) {
      await page.goto(path);
      await expect(page.getByText(/could not be found/i).first()).toBeVisible();
    }
    // Her own embryo renders, which is where the assistant is opened from.
    await page.goto('/embryos/E-26-0001');
    await expect(page.getByText('E-26-0001').first()).toBeVisible();
    await page.keyboard.press('Control+J');
    const dock = page.getByTestId('ask-dock');
    await expect(dock).toBeVisible();
    await page.getByPlaceholder(/Ask about an embryo/).fill('Where is E-26-0009 right now?');
    await page.keyboard.press('Enter');
    // The assistant reads through the same scoped services: an abstention ("Not visible to your role"), never the record.
    await expect(
      dock
        .getByText(/Not visible to your role|may not view this record|No record|not found|Out of scope|Ask is offline/i)
        .first(),
    ).toBeVisible({ timeout: 40_000 });
    await expect(dock.getByText(/Whitfield|R-0037|Recip #37/)).toHaveCount(0);
  });

  test('vet: record a check from the day sheet', async ({ page }) => {
    await signIn(page, 'vet@daysheet.local');
    await page.goto('/today?sheet=1');
    const button = page.getByRole('button', { name: 'Record check' }).first();
    await expect(button).toBeVisible();
    await button.click();
    await expect(page.getByRole('dialog')).toBeVisible();
    await page.getByRole('button', { name: 'Cancel' }).click();
    await expect(page.getByRole('dialog')).toHaveCount(0);
  });

  test('ask dock opens with the keyboard and answers', async ({ page }) => {
    await signIn(page, 'recips@daysheet.local');
    await page.keyboard.press('Control+J');
    await expect(page.getByTestId('ask-dock')).toBeVisible();
    await page.getByPlaceholder(/Ask about an embryo/).fill('Where is E-26-0002?');
    await page.keyboard.press('Enter');
    // Offline or live, an answer block (statements or an abstention) must appear.
    await expect(page.getByText(/is in the records|Ask is offline|Out of scope|No record|Recip #/).first()).toBeVisible(
      { timeout: 40_000 },
    );
  });
});
