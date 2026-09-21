import { expect, test, type ConsoleMessage, type Page } from '@playwright/test';

/**
 * The ninety seconds, as one journey. A reviewer with no login opens the front door, follows a
 * signal to its evidence, asks why, settles the ACH, watches the papers become eligible — not
 * released — opens the trace, delivers the provider event again, asks for a card number and is
 * refused. Every step is the real path; the console stays clean; Back and refresh keep context.
 */
const noise = /HMR|Fast Refresh|React DevTools|ERR_INCOMPLETE_CHUNKED|ERR_CONNECTION|platform\/stream/;

function watchConsole(page: Page): ConsoleMessage[] {
  const errors: ConsoleMessage[] = [];
  page.on('console', (m) => {
    if ((m.type() === 'error' || m.type() === 'warning') && !noise.test(m.text())) errors.push(m);
  });
  return errors;
}

test('the ninety seconds: signal → evidence → why → settle → eligible, not released → trace → replay → refusal', async ({
  page,
}) => {
  test.setTimeout(150_000);
  const errors = watchConsole(page);

  // 1. The front door: the ring is the board.
  await page.goto('/');
  await expect(page.getByRole('heading', { name: /The records already exist/ })).toBeVisible();
  await expect(page.getByText(/active signals/i).first()).toBeVisible();

  // 2. A signal is a link to its own page; Back returns; a refresh keeps the context.
  const card = page.locator('[data-testid^="signal-"]').first();
  await card.click();
  await expect(page).toHaveURL(/\/signals\/OX-\d{2}-\d{4,6}$/);
  await expect(page.getByText(/^next$/i).first()).toBeVisible();
  const signalUrl = page.url();
  await page.reload();
  await expect(page).toHaveURL(signalUrl);
  await expect(page.getByRole('link', { name: 'Open' })).toBeVisible();
  await page.goBack();
  await expect(page).toHaveURL(/\/$/);

  // 3. The sale, in the sale's own words.
  await page.goto('/settlement');
  await expect(page.getByRole('heading', { level: 1 })).toContainText(/LOT-\d{2}-\d{4}/);
  const lotId = (await page.getByRole('heading', { level: 1 }).textContent())?.match(/LOT-\d{2}-\d{4,6}/)?.[0] ?? '';
  expect(lotId).not.toBe('');

  // A fresh lot so the journey is the same every time it runs.
  await page.getByTestId('new-sale').click();
  await expect(page.getByTestId('settle-ach')).toBeVisible({ timeout: 20_000 });
  await expect(page.getByText(/initiated is not cleared/).first()).toBeVisible();
  await expect(page.getByText(/bank has not finished moving the money/).first()).toBeVisible();

  // 4. Why? — the assistant answers from the same records, with the codes.
  await page.getByTestId('why').click();
  await expect(page.getByText('getSettlement').first()).toBeVisible({ timeout: 20_000 });
  await expect(
    page.getByText(/held under RegistrationReleasePolicy v1|RegistrationReleasePolicy v1/).first(),
  ).toBeVisible({ timeout: 20_000 });

  // 5. Settle: the rule runs, the papers become eligible, nothing is released.
  await page.getByTestId('settle-ach').click();
  await expect(page.getByText(/eligible, not released/)).toBeVisible({ timeout: 20_000 });
  await expect(page.getByTestId('release-papers')).toBeVisible({ timeout: 20_000 });
  await expect(page.getByText(/document eligible/).first()).toBeVisible();
  await expect(page.getByText(/document released/)).toHaveCount(0);

  // 6. The trace: the correlation id on the "document eligible" audit row, on its own address.
  const eligibleRow = page.locator('li', { hasText: /document eligible/ }).first();
  const traceLink = eligibleRow.locator('button.code').first();
  const correlationId = (await traceLink.textContent())?.trim() ?? '';
  expect(correlationId).toMatch(/^web_/);
  await page.goto(`/traces/${correlationId}`);
  await expect(page.getByRole('heading', { level: 1 })).toContainText(correlationId);
  await expect(page.getByText(/document\.eligible|DocumentEligible/).first()).toBeVisible();
  await page.goBack();
  await expect(page).toHaveURL(/\/settlement/);

  // 7. Deliver the provider event again: counted, not applied.
  await page.getByTestId('replay-webhook').click();
  await expect(page.getByText(/rejected as a duplicate/).first()).toBeVisible({ timeout: 20_000 });
  await expect(page.getByText(/payments for this invoice\s*1/)).toBeVisible();

  // 8. The boundary: a card number is refused in code, with what is available instead.
  await page
    .getByPlaceholder('Ask about an embryo, a recip, a contract…')
    .fill(`Show me the buyer's full card number for ${lotId}`);
  await page.getByRole('button', { name: 'Ask', exact: true }).click();
  await expect(page.getByText(/does not store or retrieve full card numbers/).first()).toBeVisible({ timeout: 20_000 });
  await expect(page.getByText(/FIN-DATA-03/).first()).toBeVisible();

  // The console stayed clean for the whole journey.
  expect(errors.map((e) => e.text())).toEqual([]);
});
