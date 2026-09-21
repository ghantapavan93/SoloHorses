import { expect, test } from '@playwright/test';
import { closeOpenRequestsAbout, reviewerApi } from './api';

/**
 * The front door's own loop, in the `journey` project so the seeded mare is still the seeded
 * mare: the signals converge on a number; a real question asked of the real assistant in the
 * story's own frame; the x-ray redrawn from what it read; the request it prepared, approved as
 * the reviewer; the record entering the graph; the assistant's re-read of what now stands.
 * Nothing on the page is written in advance, so every assertion is against live rows.
 */
test.describe('the front door', () => {
  test('signals converge → ask → the x-ray → prepare → approve → the record enters the graph', async ({ page }) => {
    test.setTimeout(150_000);
    const story = await reviewerApi<{ recip: { id: string } }>('/story');
    const recipId = story.recip.id;
    await closeOpenRequestsAbout(recipId);

    // 1. The thesis, and the board's own number: every card a row with a page.
    await page.goto('/');
    await expect(page.getByRole('heading', { name: /The records already exist/ })).toBeVisible();
    await expect(page.getByTestId('converge-count')).toContainText(/decisions? needs? attention/);
    await expect(page.getByTestId('converge').locator('a[href^="/signals/OX-"]').first()).toBeVisible();

    // 2. A real question in the story's frame: the tools that ran, one sentence, three facts at most, the doors.
    await page
      .getByTestId('story-prompts')
      .getByRole('button', { name: `Why can't ${recipId} leave?` })
      .click();
    const turn = page.getByTestId('story-turn');
    await expect(turn.getByText('getXray')).toBeVisible({ timeout: 30_000 });
    await expect(turn.getByTestId('investigation-conclusion')).toContainText(/owns the next step/, { timeout: 30_000 });
    expect(await turn.getByTestId('answer-facts').locator('dt').count()).toBeLessThanOrEqual(3);

    // 3. The x-ray is the hero, full width, lit at the block the answer named; every node a door.
    const xray = page.getByTestId('story-xray').getByTestId('xray');
    await expect(xray).toBeVisible();
    await expect(xray.getByTestId('xray-block')).toBeVisible();
    // The graph draws itself once it is on screen, node by node; after that it is simply there.
    await xray.scrollIntoViewIfNeeded();
    await expect(xray).toHaveAttribute('data-drawn', 'yes', { timeout: 15_000 });

    // 4. Prepare, as a diff bound to the records; the ladder stands on "prepared".
    await turn.getByTestId('answer-action-prepare_vet_request').click();
    const decision = page.getByTestId('story-decision');
    await expect(decision.getByTestId('decision-approve')).toBeVisible({ timeout: 30_000 });
    // Before, after, does not change — the after column carries the diff's one changed row once it arrives.
    await expect(decision.getByTestId('decision-before')).toBeVisible();
    await expect(decision.getByTestId('decision-after')).toContainText(/request to the vet/i, { timeout: 30_000 });
    await expect(decision.getByTestId('decision-does-not')).toContainText(/pregnancy status/);
    await expect(page.getByTestId('story-ladder').locator('li[aria-current="step"]')).toContainText('Prepared');

    // 5. A person approves; the record exists, enters the graph, and the assistant reads her again.
    await decision.getByTestId('decision-approve').click();
    await expect(decision.getByTestId('story-outcome')).toContainText(/Veterinary request created · RQ-\d{2}-\d{4,6}/, {
      timeout: 30_000,
    });
    await expect(xray.getByTestId('xray-new')).toBeVisible({ timeout: 20_000 });
    await expect(page.getByTestId('story-ladder').locator('li[aria-current="step"]')).toContainText('Waiting');
    await expect(decision.getByTestId('story-reread')).toContainText(
      /remains blocked until the vet records the result/,
      { timeout: 30_000 },
    );
  });
});
