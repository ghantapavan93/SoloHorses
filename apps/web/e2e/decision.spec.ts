import { expect, test, type Page } from '@playwright/test';
import { closeOpenRequestsAbout } from './api';
import { signIn } from './helpers';

/**
 * The decision, end to end, as a reviewer with no login: the mare's X-ray, the question, the
 * prepared request as a diff a person reads, the click that sends it under their name — and the
 * race: the record moves between the proposal and the click, and nothing runs. Every step is the
 * real path; the words come from the records and the catalog, never from the test.
 */
async function ask(page: Page, question: string): Promise<void> {
  await page.getByPlaceholder('Ask about an embryo, a recip, a contract…').fill(question);
  await page.getByRole('button', { name: 'Ask', exact: true }).click();
}

async function storyRecipId(page: Page): Promise<string> {
  const id = (await page.getByRole('heading', { level: 1 }).textContent())?.match(/R-\d{4,6}/)?.[0];
  expect(id).toBeTruthy();
  return id ?? '';
}

test.describe('the decision: x-ray → why → prepare → diff → approve, and the race that runs nothing', () => {
  test('the x-ray is drawn from her records; the question reads the board; the prepared request is a diff a person approves under their own name', async ({
    page,
  }) => {
    test.setTimeout(120_000);
    await page.goto('/story');
    const recipId = await storyRecipId(page);

    // 1. The X-ray: a conclusion in the leading signal's words, every node a row, the rules applied named.
    const xray = page.getByTestId('xray');
    await expect(xray).toBeVisible();
    await expect(page.getByTestId('xray-conclusion')).not.toBeEmpty();
    await expect(xray.getByText(/rules applied:/)).toBeVisible();
    const subject = xray.getByRole('button', { name: new RegExp(`^${recipId} · `) }).first();
    await subject.click();
    const drawer = page.getByTestId('evidence-drawer');
    await expect(drawer).toBeVisible();
    await expect(drawer.getByRole('link', { name: `Open ${recipId}` })).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(drawer).toBeHidden();

    // 2. Why can't she leave? The x-ray, read by a real tool, comes back typed: conclusion, rules, who it waits for.
    await ask(page, `Why can't ${recipId} leave?`);
    await expect(page.getByText('getXray').first()).toBeVisible({ timeout: 20_000 });
    await expect(page.getByTestId('investigation')).toBeVisible({ timeout: 20_000 });

    // 3. Prepare the next step: a proposal, shown as a diff — before, after, what it will never do.
    // A request a previous run sent is closed first, so this run prepares a fresh one.
    await closeOpenRequestsAbout(recipId);
    await ask(page, `Prepare the vet request for ${recipId}`);
    await expect(page.getByText('proposeAction').first()).toBeVisible({ timeout: 20_000 });
    const card = page.locator('[data-testid^="decision-"][data-status]').first();
    await expect(card).toBeVisible({ timeout: 20_000 });
    const status = card.getByTestId('decision-status');
    await expect(status).toHaveText('proposed');
    await expect(card.getByText(/does not/)).toBeVisible();
    await expect(card.getByText(/clear the mare/)).toBeVisible();
    // 4. Approve: the request goes to the team under the approver's name; the application says what it did,
    // and the assistant reads again — the request is on record, the mare is still blocked.
    await card.getByTestId('decision-approve').click();
    await expect(page.getByText(/Approved\. It ran under your name\./)).toBeVisible({ timeout: 20_000 });
    await expect(status).toHaveText('approved');
    await expect(page.getByTestId('ask-note')).toContainText(/Veterinary request created/);
    // Another spec may have recorded her video in the meantime; whoever owns the next step now, the assistant read the records again.
    await expect(
      page.getByText(/remains blocked until .* records the result|waits on a person now/).first(),
    ).toBeVisible({ timeout: 20_000 });
    // 5. Asked again, nothing is prepared twice: the open request is the answer.
    await ask(page, `Prepare the vet request for ${recipId}`);
    await expect(page.getByText(/already open/).first()).toBeVisible({ timeout: 20_000 });

    // 6. The ledger: who decided, what ran, what became of it — every line a row with its time.
    await card.getByTestId('decision-ledger-link').click();
    await expect(page).toHaveURL(/\/decisions\/DEC-\d{2}-\d{4,6}$/, { timeout: 20_000 });
    const timeline = page.getByTestId('decision-ledger');
    await expect(timeline.getByTestId('ledger-prepared')).toContainText('Prepared');
    await expect(timeline.getByTestId('ledger-decided')).toContainText('Approved');
    await expect(timeline.getByTestId('ledger-executed')).toContainText('Executed');
    await expect(page.getByText(/Demo Reviewer/).first()).toBeVisible();
    await expect(page.getByTestId('decision-moved')).toContainText('Unchanged at approval');
    // Executed is not resolved: the vet has not answered, so the outcome is awaited, and a click opens the provenance.
    await expect(timeline.getByTestId('ledger-outcome-pending')).toContainText(/awaiting outcome/);
    await timeline.getByTestId('ledger-executed').getByTestId('ledger-event').click();
    await expect(timeline.getByTestId('ledger-provenance')).toContainText(/RequestsService\.create/);

    // 7. The flight record: the run that prepared it, stage by stage, every tool with its time.
    await page.getByRole('link', { name: 'the run' }).click();
    await expect(page).toHaveURL(/\/runs\/[a-z0-9_]+$/);
    await expect(page.getByTestId('run-question')).toContainText(/Prepare the vet request/);
    // The waterfall: the gate, every tool, the verifier, the pause for the person — resumed, since the click happened.
    const flight = page.getByTestId('flight-waterfall');
    await expect(flight.getByTestId('flight-step-policy')).toContainText('policy gate');
    await expect(flight.getByText('proposeAction', { exact: true })).toBeVisible();
    await expect(flight.getByTestId('flight-step-verifier')).toContainText('verifier');
    await expect(flight.getByTestId('flight-step-pause')).toContainText('await human');
    await expect(page.getByTestId('run-summary')).toContainText(/end to end/);
    await expect(page.getByTestId('run-decision-link')).toBeVisible();
    // A step opens on its provenance: what went in and what came back, no thought in between.
    await flight.getByText('proposeAction', { exact: true }).click();
    const flightDrawer = page.getByTestId('flight-drawer');
    await expect(flightDrawer).toContainText(/input/i);
    await expect(flightDrawer).toContainText(/masked/i);
  });

  test('the race: the record moves between the proposal and the click, the approval is refused as stale, and nothing runs', async ({
    page,
  }) => {
    test.setTimeout(120_000);
    await page.goto('/story');
    const recipId = await storyRecipId(page);

    // The request the journey above sent is closed first, so there is a proposal to race against.
    await closeOpenRequestsAbout(recipId);
    await ask(page, `Prepare the vet request for ${recipId}`);
    await expect(page.getByText('proposeAction').first()).toBeVisible({ timeout: 20_000 });
    const proposed = page.locator('[data-testid^="decision-"][data-status="PROPOSED"]').first();
    await expect(proposed).toBeVisible({ timeout: 20_000 });
    // Pin the card by its id: its status attribute is about to change.
    const card = page.getByTestId((await proposed.getAttribute('data-testid')) ?? 'decision-none');

    // The vet records a clearance in the meantime: her veterinary record has moved.
    await page.getByRole('combobox', { name: 'Clearance' }).first().selectOption('COGGINS');
    await page.getByRole('combobox', { name: 'Result' }).first().selectOption('CLEAR');
    await page.getByTestId('record-coggins').click();
    // The control's own toast, not any "recorded" on the page (the rail says "never recorded" of the missing check).
    await expect(page.getByText(/recorded: clear/i).first()).toBeVisible({ timeout: 20_000 });

    // The click: approval re-reads the records, sees they moved, marks the proposal stale, sends nothing.
    await card.getByTestId('decision-approve').click();
    await expect(page.getByText(/The records changed since this was prepared\. Nothing ran/)).toBeVisible({
      timeout: 20_000,
    });
    await expect(card.getByTestId('decision-status')).toHaveText('stale');
    await expect(card.getByRole('link', { name: 'Review the current evidence' })).toBeVisible();
  });
});

test.describe('the investigation and the ladder', () => {
  test('“why can’t she leave?” comes back typed: the conclusion, the rules with verdicts, who it waits for, and the doors', async ({
    page,
  }) => {
    await page.goto('/story');
    const recipId = (await page.getByRole('heading', { level: 1 }).textContent())?.match(/R-\d{4,6}/)?.[0] ?? '';
    expect(recipId).not.toBe('');
    await page.getByPlaceholder('Ask about an embryo, a recip, a contract…').fill(`Why can't ${recipId} leave?`);
    await page.getByRole('button', { name: 'Ask', exact: true }).click();
    await expect(page.getByText('getXray').first()).toBeVisible({ timeout: 20_000 });
    const block = page.getByTestId('investigation');
    await expect(block).toBeVisible({ timeout: 20_000 });
    await expect(page.getByTestId('investigation-conclusion')).not.toBeEmpty();
    await expect(block.getByText(/rules blocked · waits for/)).toBeVisible();
    // The doors are the application's: her record at the part that matters, and the graph beside the conversation.
    const actions = page.getByTestId('investigation-actions');
    await expect(actions.getByRole('link', { name: new RegExp(`Open ${recipId}`) })).toHaveAttribute(
      'href',
      new RegExp(`^/horses/${recipId}\\?focus=`),
    );
    await actions.getByRole('button', { name: 'Show why' }).click();
    const peek = page.getByTestId('ask-peek');
    await expect(peek).toBeVisible();
    await expect(peek.getByTestId('xray')).toBeVisible({ timeout: 20_000 });
    await page.keyboard.press('Escape');
    await expect(peek).toBeHidden();
  });

  test('a waiting decision reads as a diff: the rows a yes changes lit, the facts it reads quiet, the rule as it stands, who may say yes, and the click', async ({
    page,
  }) => {
    await signIn(page, 'admin@daysheet.local');
    await page.goto('/decisions');
    const waiting = page.locator('tr[data-testid^="decision-row-"]').filter({ hasText: 'waiting' }).first();
    if ((await waiting.count()) === 0) test.skip(true, 'no waiting decision on this board');
    await waiting.getByRole('link').first().click();
    await expect(page).toHaveURL(/\/decisions\/DEC-\d{2}-\d{4,6}$/, { timeout: 20_000 });
    const diff = page.getByTestId('decision-diff');
    await expect(diff).toBeVisible();
    expect(await diff.getByTestId('diff-change').count()).toBeGreaterThan(0);
    expect(await diff.getByTestId('diff-fact').count()).toBeGreaterThan(0);
    await expect(diff).toContainText(/the rule, as it stands/i);
    await expect(diff).toContainText(/who may say yes/i);
    // Another journey running beside this one may have decided the row in between; the click is there while it waits.
    if (/bound to the records as they stand/.test(await diff.innerText())) {
      await expect(diff.getByTestId('diff-approve')).toBeVisible();
      await expect(diff.getByTestId('diff-decline')).toBeVisible();
    }
  });

  test('the vision page says where the build stands on the ladder, with real counts, and labels built, interactive concept and future', async ({
    page,
  }) => {
    await page.goto('/vision');
    await expect(page.getByRole('heading', { name: /Ask earns autonomy/ })).toBeVisible();
    const ladder = page.getByTestId('autonomy-ladder');
    await expect(ladder).toBeVisible();
    await expect(ladder.getByTestId('stage-propose')).toHaveAttribute('aria-selected', 'true');
    await expect(page.getByText(/Propose · built · where this build stands/)).toBeVisible();
    await expect(page.getByTestId('ladder-count')).toContainText(/\d+ prepared · \d+ approved by a person/);
    await ladder.getByTestId('stage-execute').click();
    await expect(page.getByText(/Execute · future/)).toBeVisible();
    await expect(page.getByText('interactive concept').first()).toBeVisible();
    await expect(page.getByText('future', { exact: true }).first()).toBeVisible();
  });
});
