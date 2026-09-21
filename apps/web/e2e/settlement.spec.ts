import { expect, test, type Page } from '@playwright/test';

async function askInPanel(page: Page, question: string): Promise<void> {
  await page.getByPlaceholder('Ask about an embryo, a recip, a contract…').fill(question);
  await page.getByRole('button', { name: 'Ask', exact: true }).click();
}

/**
 * The second front door, driven as a reviewer with no login: one sold lot from the hammer to
 * the papers. The test starts its own lot so the seeded scene is the same for the next run;
 * it settles the ACH (a simulated delivery down the real path), watches the papers become
 * eligible — not released — releases them as the reviewer, and asks the assistant for a card
 * number it will never have.
 */
test.describe('a sale settlement, end to end', () => {
  test('landing offers the settlement as its second door and names the three things', async ({ page }) => {
    await page.goto('/');
    await expect(page.getByRole('heading', { name: /What needs a person/ })).toBeVisible();
    await page.getByRole('link', { name: /Run a sale settlement/ }).click();
    await expect(page).toHaveURL(/\/settlement$/);
    await expect(page.getByRole('heading', { level: 1 })).toContainText(/LOT-\d{2}-\d{4}/);
  });

  test('an initiated ACH holds the papers; settling makes them eligible; a person releases them', async ({ page }) => {
    await page.goto('/settlement');
    await page.getByTestId('new-sale').click();
    await expect(page.getByText(/ACH initiated, papers held/)).toBeVisible({ timeout: 20_000 });
    await expect(page.getByTestId('settle-ach')).toBeVisible({ timeout: 20_000 });

    // Held: the rule's words, in the office's register and the engineer's.
    await expect(page.getByText(/initiated is not cleared/).first()).toBeVisible();
    await expect(page.getByText(/bank has not finished moving the money/).first()).toBeVisible();
    await expect(page.getByTestId('release-papers')).toHaveCount(0);

    await page.getByTestId('settle-ach').click();
    await expect(page.getByText(/eligible, not released/)).toBeVisible({ timeout: 20_000 });
    await expect(page.getByTestId('release-papers')).toBeVisible({ timeout: 20_000 });
    await expect(page.getByText(/Papers release eligible/)).toBeVisible();
    await expect(page.getByTestId('settle-ach')).toHaveCount(0);

    await page.getByTestId('release-note').fill('Sent to the association');
    await page.getByTestId('release-papers').click();
    await expect(page.getByText(/Released, with your name on the audit row/)).toBeVisible({ timeout: 20_000 });
    await page.waitForLoadState('networkidle');
    await expect(page.getByText(/document released/).first()).toBeVisible();
  });

  test('the assistant refuses a card number in code and explains held papers with evidence', async ({ page }) => {
    await page.goto('/settlement');
    const lotId = (await page.getByRole('heading', { level: 1 }).textContent())?.match(/LOT-\d{2}-\d{4,6}/)?.[0];
    expect(lotId).toBeTruthy();

    await page.getByRole('button', { name: `Show me the buyer's full card number for ${lotId}` }).click();
    await expect(page.getByText(/does not store or retrieve full card numbers/).first()).toBeVisible({
      timeout: 20_000,
    });
    await expect(page.getByText(/FIN-DATA-03/).first()).toBeVisible();

    await askInPanel(page, `Why are the papers for ${lotId} held?`);
    await expect(page.getByText('getSettlement').first()).toBeVisible({ timeout: 20_000 });
    await expect(page.getByText(/RegistrationReleasePolicy v1/).first()).toBeVisible();
  });

  test('the mare that came back: the vet records, the rule decides what a person may decide', async ({ page }) => {
    await page.goto('/settlement');
    // A fresh assessment either way: the seeded mare has none, a previous run may have left one.
    const record = page.getByTestId('record-return_assessment');
    await expect(record).toBeVisible();
    await page.getByRole('combobox', { name: 'Result' }).last().selectOption('ABNORMAL');
    await record.click();
    await expect(page.getByText(/a person decides whether it applies/).first()).toBeVisible({ timeout: 20_000 });
    await expect(page.getByRole('link', { name: 'Decide on the board' })).toBeVisible();
    await expect(page.getByText(/return fee decision/i).first()).toBeVisible({ timeout: 20_000 });

    await page.getByRole('combobox', { name: 'Result' }).last().selectOption('CLEAR');
    await page.getByTestId('record-return_assessment').click();
    await expect(page.getByText(/Condition met on the vet’s record/).first()).toBeVisible({ timeout: 20_000 });
  });

  test('the ring on the landing is the board: a signal opens on its own page, and hands the assistant its question', async ({
    page,
  }) => {
    await page.goto('/');
    await expect(page.getByText(/active signals/i).first()).toBeVisible();
    // Whichever channel is lit first (the sale's, on a fresh seed; another after a settlement ran): every card is a real row.
    const card = page.locator('[data-testid^="signal-"]').first();
    await card.click();
    await expect(page).toHaveURL(/\/signals\/OX-\d{2}-\d{4,6}$/);
    await expect(page.getByRole('link', { name: 'Open' })).toBeVisible();
    await expect(page.getByText(/^next$/i).first()).toBeVisible();
    // "Ask about this" carries the question to the surface that answers it — the page's own
    // assistant or, behind the one-click login, the shell's palette — and a real tool runs.
    await page.getByRole('link', { name: 'Ask about this' }).click();
    if (/\/login/.test(page.url())) await page.getByTestId('login-admin').click();
    await expect(page.getByText(/^get[A-Z]\w+$/).first()).toBeVisible({ timeout: 20_000 });
  });

  test('the board in dollars: the ring prices the sale, the landing sums it, and Ask answers "what is at stake"', async ({
    page,
  }) => {
    await page.goto('/');
    await expect(page.getByTestId('signal-sale')).toContainText(/\$\d{1,3}(,\d{3})*\.\d{2}/);
    await expect(page.getByText(/\$\d{1,3}(,\d{3})*\.\d{2} at stake/)).toBeVisible();
    await page.getByRole('button', { name: 'Ask about the operation…' }).click();
    await page.getByRole('button', { name: 'What is at stake today?' }).click();
    await expect(page.getByText('getOpenExceptions').first()).toBeVisible({ timeout: 20_000 });
    await expect(page.getByText(/is waiting on a person across \d+ item/).first()).toBeVisible({ timeout: 20_000 });
  });

  test('a signal is addressable: the same id on its own page after a refresh, and 404 for one that does not exist', async ({
    page,
  }) => {
    await page.goto('/');
    const card = page.locator('[data-testid^="signal-"]').first();
    await card.click();
    await expect(page).toHaveURL(/\/signals\/OX-\d{2}-\d{4,6}$/);
    const id = page.url().split('/').pop() ?? '';
    await page.reload();
    await expect(page.getByRole('heading', { level: 1 })).toContainText(id);
    await expect(page.getByRole('link', { name: 'Open' })).toBeVisible();
    const missing = await page.goto('/signals/OX-26-999999');
    expect(missing?.status()).toBe(404);
  });

  test('the dock follows the reviewer: the same signal, the same id, on another page', async ({ page }) => {
    await page.goto('/story');
    await page.getByTestId('signal-dock-button').click();
    await expect(page.getByText('Active signals')).toBeVisible();
    const first = page.locator('[data-testid^="dock-OX-"]').first();
    const id = (await first.getAttribute('data-testid'))?.replace('dock-', '');
    await first.click();
    await expect(page).toHaveURL(new RegExp(`/signals/${id ?? 'OX-'}$`));
    await expect(page.getByRole('heading', { level: 1 })).toContainText(id ?? 'OX-');
    await expect(page.getByRole('link', { name: 'Open' })).toBeVisible();
  });

  test('Why? asks the assistant about the state on screen; the webhook can be delivered again and counts as a duplicate', async ({
    page,
  }) => {
    await page.goto('/settlement');
    await page.getByTestId('why').click();
    await expect(page.getByText('getSettlement').first()).toBeVisible({ timeout: 20_000 });
    if (await page.getByTestId('settle-ach').isVisible()) {
      await page.getByTestId('settle-ach').click();
      await expect(page.getByTestId('replay-webhook')).toBeVisible({ timeout: 20_000 });
    }
    await page.getByTestId('replay-webhook').click();
    await expect(page.getByText(/rejected as a duplicate/).first()).toBeVisible({ timeout: 20_000 });
    await expect(page.getByText(/payments for this invoice\s*1/)).toBeVisible();
  });

  test('the honesty page is a readout: services, the last event, the last trace', async ({ page }) => {
    await page.goto('/build');
    await expect(page.getByText(/Build health · live/i)).toBeVisible();
    await expect(page.getByText(/Review graph/)).toBeVisible();
    await expect(page.getByText(/ExceptionReviewGraph/)).toBeVisible();
    await expect(page.getByRole('button', { name: /Replay event/ })).toBeVisible();
  });

  test('three next things: the digest is drafted from records, consent is on the row, and a person sends', async ({
    page,
  }) => {
    await page.goto('/vision');
    await expect(page.getByRole('heading', { name: /Customer update/ })).toBeVisible();
    await expect(page.getByText(/embryo update/).first()).toBeVisible();
    await expect(page.getByText(/sms consent/i)).toBeVisible();
    await expect(page.getByRole('link', { name: /a person, on Intake/ })).toBeVisible();
  });

  test('why this one: a signal’s own address draws the chain from the record to the person, with the block highlighted and the records as links', async ({
    page,
  }) => {
    await page.goto('/');
    const signalLink = page.locator('a[href^="/signals/OX-"]').first();
    const href = await signalLink.getAttribute('href');
    expect(href).toMatch(/^\/signals\/OX-\d{2}-\d{4,6}$/);
    await page.goto(href!);
    await expect(page.getByText('Why this one')).toBeVisible();
    const map = page.getByTestId('causal-map');
    await expect(map).toBeVisible();
    await expect(map.getByTestId('map-block')).toBeVisible();
    // The chain reads left to right and ends with a person: the SVG names it for a screen reader too.
    await expect(map.locator('svg')).toHaveAttribute('aria-label', /→ [a-z ]+ decides: [^→]+\.$/);
    await expect(map.locator('a[href]').first()).toBeVisible();
  });

  test('the assistant drawn as the thing it is: the boundary lights along the tools a question really reached for, and the landing shows the last real run', async ({
    page,
  }) => {
    await page.goto('/vision');
    const membrane = page.getByTestId('membrane');
    await expect(membrane).toBeVisible();
    await page.getByRole('button', { name: /Is the QuickBooks sync working\?/ }).click();
    // Offline or live, the question reaches for at least one tool, and that strand lights.
    await expect(page.locator('[data-testid^="membrane-step-"]').first()).toBeVisible({ timeout: 40_000 });
    // A read-only strand is drawn crossing the boundary; a refused capability is severed at it.
    await expect(membrane.getByRole('button', { name: /getMoneyTrail — Reads, freely/ })).toBeVisible();
    await expect(membrane.getByRole('button', { name: /move money or change a ledger — Never/ })).toBeVisible();
    await page.goto('/');
    await expect(page.getByTestId('membrane')).toBeVisible();
    await expect(page.getByText(/Last question:/)).toBeVisible();
  });
});
