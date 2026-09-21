import { expect, test } from '@playwright/test';
import { closeOpenRequestsAbout, reviewerApi } from './api';
import { openAskDock, signIn } from './helpers';

/**
 * The closed loop as a person lives it, in the `journey` project — before the other specs, so the
 * mare is still the seeded mare: leaving in two days with no video on record. A plain question from
 * her page, one sentence from live state, the exact door into her record, the request prepared as a
 * diff, the click that sends it under a name, and the assistant's read of what actually stands.
 */
test.describe('the loop, from the dock', () => {
  test('from her page: a plain question, one sentence, the exact door, the prepared request, the click, the real result', async ({
    page,
  }) => {
    test.setTimeout(150_000);
    await signIn(page, 'admin@daysheet.local');
    const story = await reviewerApi<{ recip: { id: string } }>('/story');
    const recipId = story.recip.id;
    await closeOpenRequestsAbout(recipId);

    // 1. On the mare's own page, the question needs no id: the dock knows what "she" means.
    await page.goto(`/horses/${recipId}`);
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
    await openAskDock(page);
    const dock = page.getByTestId('ask-dock');
    await expect(dock.getByTestId('ask-context')).toContainText(recipId);
    await dock.getByPlaceholder('Ask about an embryo, a recip, a contract…').fill("Why can't she leave?");
    await dock.getByRole('button', { name: 'Ask', exact: true }).click();

    // 2. One sentence from live state, three facts, typed doors — and the act the assistant may prepare.
    const card = dock.getByTestId('investigation').last();
    await expect(card).toBeVisible({ timeout: 30_000 });
    await expect(card.getByTestId('investigation-conclusion')).toContainText(/owns the next step/);
    expect(await card.getByTestId('answer-facts').locator('dt').count()).toBeLessThanOrEqual(3);
    const open = card.getByTestId('investigation-actions').getByRole('link', { name: `Open ${recipId}` });
    await expect(open).toHaveAttribute('href', `/horses/${recipId}?focus=departure`);

    // 3. The door opens the record at the part that matters, lit; the conversation stays.
    await open.click();
    await expect(page).toHaveURL(new RegExp(`/horses/${recipId}\\?focus=departure$`));
    const departure = page.getByTestId('focus-departure');
    await expect(departure).toHaveAttribute('data-focused', 'true');
    await expect(page.getByTestId('departure-video')).toContainText(/none on record/);
    await expect(page.getByTestId('departure-requests')).toContainText(/none open/);
    await expect(dock).toBeVisible();

    // 4. Prepare, as a diff; approve; the application says what it did, the assistant reads what still stands.
    await card.getByTestId('answer-action-prepare_vet_request').click();
    const proposal = dock.locator('[data-testid^="decision-"][data-status="PROPOSED"]').first();
    await expect(proposal).toBeVisible({ timeout: 30_000 });
    await expect(proposal.getByText(/does not/)).toBeVisible();
    await proposal.getByTestId('decision-approve').click();
    await expect(dock.getByTestId('ask-note')).toContainText(/Veterinary request created · RQ-\d{2}-\d{4,6}/, {
      timeout: 20_000,
    });
    await expect(dock.getByText(/remains blocked until the vet records the result/).first()).toBeVisible({
      timeout: 30_000,
    });

    // 5. The page moved with the records: the request is on her departure, no reload.
    await expect(page.getByTestId('departure-requests')).toContainText(/Veterinary confirmation/, { timeout: 20_000 });
    await expect(page.getByTestId('departure-rule')).toContainText(/DEPARTURE_UNCONFIRMED/);
  });
});
