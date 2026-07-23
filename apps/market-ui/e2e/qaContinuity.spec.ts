import { test, expect, type Page } from '@playwright/test';

// FI-2 acceptance (docs/FEATURE_INDEPENDENCE_ROADMAP.md): a Quick Answer must
// keep streaming when the user switches views, and returning must resume the
// SAME in-flight thread — not restart it, not lose it, not duplicate it.
//
// The Gravity search WebSocket is held open (routeWebSocket, never answers) so
// the run stays in-flight across the round trip; that controls timing only.
// What's under test is that the run lives in a module-level store (qaStore), so
// SearchPage can unmount and remount without dropping the stream.
const EMAIL = process.env.E2E_EMAIL || 'investor.demo+test@example.com';
const PASSWORD = process.env.E2E_PASSWORD || 'DemoPass2026!';
const PROBE = 'QA continuity probe zulu-4471';

async function login(page: Page) {
    await page.goto('/auth');
    await page.getByPlaceholder('you@example.com').fill(EMAIL);
    await page.getByPlaceholder('Enter password').fill(PASSWORD);
    await page.locator('button[type="submit"]').click();
    await page.waitForURL('**/search', { timeout: 60_000 });
}

test('a Quick Answer resumes the same streaming thread after a trading detour', async ({ page }) => {
    test.setTimeout(180_000);
    // Accept the QA WebSocket but never send frames → the stream stays in-flight.
    await page.routeWebSocket(/\/v1\/search\/stream/, () => { /* hold open */ });

    await login(page);

    // Ask a question (mode defaults to Quick Answer).
    const input = page.getByPlaceholder(/Ask anything about any company/);
    await input.fill(PROBE);
    await input.press('Enter');

    // The live exchange shows the question and the run is in-flight (Cancel + a bg job).
    await expect(page.getByText(PROBE).first()).toBeVisible({ timeout: 15_000 });
    await expect(page.getByRole('button', { name: 'Cancel' })).toBeVisible({ timeout: 15_000 });
    await expect(page.getByText(/\d+ running/)).toBeVisible({ timeout: 15_000 });
    const jobsBefore = await page.getByText(/\d+ running/).textContent();

    // Client-side nav to /trading — the store, stream, and indicator must persist.
    await page.locator('a[href="/trading"]').first().click();
    await page.waitForURL('**/trading', { timeout: 20_000 });
    await expect(page.getByText(/\d+ running/)).toBeVisible({ timeout: 10_000 });

    // Back via the indicator; the SAME thread must still be streaming.
    await page.getByText(/\d+ running/).click();
    await expect(page.getByText('Running in background')).toBeVisible({ timeout: 10_000 });
    await page.locator('li button', { hasText: PROBE }).first().click();
    await page.waitForURL('**/search', { timeout: 15_000 });

    // Same question, still in-flight, same job count (resumed, not a new run).
    await expect(page.getByText(PROBE).first()).toBeVisible({ timeout: 10_000 });
    await expect(page.getByRole('button', { name: 'Cancel' })).toBeVisible({ timeout: 10_000 });
    expect(await page.getByText(/\d+ running/).textContent()).toBe(jobsBefore);
    // Clicking the job closed the indicator panel, so the probe now appears only
    // in the thread — exactly once means no duplicate turn and no lost thread.
    expect(await page.getByText(PROBE).count()).toBe(1);
});
