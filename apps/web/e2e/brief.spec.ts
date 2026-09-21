import { expect, test } from '@playwright/test';
import { signIn } from './helpers';

/**
 * The morning brief: the board against yesterday's snapshot, what a person reads first, and
 * the next two days as the rules see them. On a fresh world the baseline may not exist yet;
 * the brief says so instead of inventing one, and the test accepts either truth.
 */
test.describe('the morning brief', () => {
  test('operations opens on the brief: five numbers, what needs you first, the next 48 hours, what changed', async ({
    page,
  }) => {
    await signIn(page, 'admin@daysheet.local');
    await page.goto('/operations');
    const brief = page.getByTestId('brief');
    await expect(brief).toBeVisible();
    await expect(brief.getByText('need a person')).toBeVisible();
    await expect(brief.getByText('waits on them')).toBeVisible();
    await expect(brief.getByText(/since |in the last 24 hours|first brief/).first()).toBeVisible();
    await expect(page.getByTestId('brief-needs-you')).toBeVisible();
    await expect(page.getByTestId('brief-lookahead')).toBeVisible();
    await expect(page.getByTestId('brief-changes')).toBeVisible();
    // Every row in "needs you first" is a signal with its own address.
    const first = page.getByTestId('brief-needs-you').locator('a[href^="/signals/OX-"]').first();
    if (await first.count()) {
      await first.click();
      await expect(page).toHaveURL(/\/signals\/OX-\d{2}-\d{4,6}$/);
      await expect(page.getByText('Why this one')).toBeVisible();
    }
  });

  test('the front door: one sentence, three numbers, three decisions that open their signals, one line to ask from', async ({
    page,
  }) => {
    await signIn(page, 'admin@daysheet.local');
    await page.goto('/today');
    const hero = page.getByTestId('morning-brief');
    await expect(hero).toBeVisible();
    await expect(hero.getByRole('heading', { level: 1 })).toContainText(
      /^Good (morning|afternoon|evening)\. (\d+ decisions? needs? attention|Nothing needs a decision)\./,
    );
    await expect(page.getByTestId('morning-brief-numbers')).toContainText(
      /(\d+ needs? you|\d+ (billing|recip farm|stallion office|vet))/,
    );
    await expect(page.getByTestId('morning-brief-numbers')).toContainText(/\$[\d,]+\.\d{2} at stake/);
    await expect(page.getByTestId('morning-brief-numbers')).toContainText(/\d+ raised · \d+ resolved/);
    const cards = page.getByTestId('morning-decision');
    const count = await cards.count();
    expect(count).toBeLessThanOrEqual(3);
    if (count > 0) {
      await cards.first().click();
      await expect(page).toHaveURL(/\/signals\/OX-\d{2}-\d{4,6}$/, { timeout: 20_000 });
      await expect(page.getByText('Why this one')).toBeVisible();
      // The decision's x-ray, when the decision has a mare behind it: four answers, a node that opens its row, and "Why?" that asks.
      const xray = page.getByTestId('xray');
      if (await xray.count()) {
        const answers = page.getByTestId('xray-answers');
        await expect(answers).toContainText(/blocked/i);
        await expect(answers).toContainText(/who decides/i);
        await expect(answers).toContainText(/\d+ records? · \d+ rules? applied/);
        await page.getByTestId('xray-block').click();
        const drawer = page.getByTestId('evidence-drawer');
        await expect(drawer).toBeVisible();
        await expect(drawer).toContainText(/state/i);
        await page.keyboard.press('Escape');
        await page.getByTestId('xray-ask-why').click();
        // The question rides to Today, where the dock lives, and the address is cleaned once it is asked.
        await expect(page).toHaveURL(/\/today/, { timeout: 20_000 });
        const dock = page.getByTestId('ask-dock');
        await expect(dock).toBeVisible();
        await expect(dock.getByTestId('investigation')).toBeVisible({ timeout: 30_000 });
        await expect(page).not.toHaveURL(/\?ask=/);
      }
    }
    await page.goto('/today');
    // The entry line and the board's own prompts both go straight to the dock, which knows the page.
    await expect(page.getByTestId('ask-prompts').getByRole('button').first()).toBeVisible();
    await page.getByTestId('morning-brief').getByLabel('Ask', { exact: true }).fill('What changed since yesterday?');
    await page.getByRole('button', { name: 'Ask this' }).click();
    const dock = page.getByTestId('ask-dock');
    await expect(dock).toBeVisible();
    await expect(dock.getByText('What changed since yesterday?').first()).toBeVisible();
    await expect(dock.getByText('getBrief').first()).toBeVisible({ timeout: 30_000 });
  });

  test('the assistant answers "what changed since yesterday" from the brief tool, offline or live', async ({
    page,
  }) => {
    await page.goto('/');
    await page.getByRole('button', { name: 'Ask about the operation…' }).click();
    await page.getByRole('button', { name: 'What changed since yesterday?' }).click();
    await expect(page.getByText('getBrief').first()).toBeVisible({ timeout: 40_000 });
  });
});
