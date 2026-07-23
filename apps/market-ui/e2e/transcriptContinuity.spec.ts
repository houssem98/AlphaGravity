import { test, expect, type Page } from '@playwright/test';

// FI-4 acceptance (docs/FEATURE_INDEPENDENCE_ROADMAP.md): the earnings-call
// summary is one RAG call measured at 1.7-14.7s against prod, so it is a real
// long-run — it must survive leaving the company page and resume the SAME read
// on return rather than starting a second one.
//
// The RAG call is held open so the read stays in-flight across the round trip;
// that controls timing only. What's under test is that its state lives in a
// module-level store (companyBriefStore, keyed by ticker).
const EMAIL = process.env.E2E_EMAIL || 'investor.demo+test@example.com';
const PASSWORD = process.env.E2E_PASSWORD || 'DemoPass2026!';

async function login(page: Page) {
    await page.goto('/auth');
    await page.getByPlaceholder('you@example.com').fill(EMAIL);
    await page.getByPlaceholder('Enter password').fill(PASSWORD);
    await page.locator('button[type="submit"]').click();
    await page.waitForURL('**/search', { timeout: 60_000 });
}

test('an earnings-call summary read resumes the same session after a trading detour', async ({ page }) => {
    test.setTimeout(200_000);
    await page.route('**/v1/search', () => { /* hold open */ });
    await page.route('**/api/llm/chat', () => { /* hold open */ });

    await login(page);
    await page.goto('/companies/AAPL');

    // The read starts on mount and shows its in-flight state.
    await expect(page.getByText('Reading transcript…')).toBeVisible({ timeout: 30_000 });
    await expect(page.getByText(/\d+ running/)).toBeVisible({ timeout: 20_000 });

    // Client-side nav to trading — the read and indicator must persist.
    await page.locator('a[href="/trading"]').first().click();
    await page.waitForURL('**/trading', { timeout: 20_000 });
    await expect(page.getByText(/\d+ running/)).toBeVisible({ timeout: 10_000 });

    // Back to the company via the indicator's transcript job.
    await page.getByText(/\d+ running/).click();
    await expect(page.getByText('Running in background')).toBeVisible({ timeout: 10_000 });
    await page.locator('li button', { hasText: 'AAPL Earnings Call Summary' }).first().click();
    await page.waitForURL('**/companies/AAPL', { timeout: 15_000 });

    // Same read still in flight, and still exactly one transcript job — resumed,
    // not restarted and not duplicated.
    await expect(page.getByText('Reading transcript…')).toBeVisible({ timeout: 15_000 });
    await page.getByText(/\d+ running/).click();
    await expect(page.getByText('Running in background')).toBeVisible({ timeout: 10_000 });
    expect(await page.locator('li button', { hasText: 'AAPL Earnings Call Summary' }).count()).toBe(1);
});
