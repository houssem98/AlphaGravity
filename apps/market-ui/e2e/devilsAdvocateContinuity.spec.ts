import { test, expect, type Page } from '@playwright/test';

// FI-3 acceptance (docs/FEATURE_INDEPENDENCE_ROADMAP.md): a Devil's Advocate
// challenge must keep running when the user switches views, and returning must
// show the SAME run — not a restarted one, not the idle prompt.
//
// The RAG/LLM calls are held open so the run stays in-flight across the round
// trip; that controls timing only. What's under test is that the run's state
// lives in a module-level store (companyBriefStore, keyed by ticker), so the
// component can unmount and remount without dropping it.
const EMAIL = process.env.E2E_EMAIL || 'investor.demo+test@example.com';
const PASSWORD = process.env.E2E_PASSWORD || 'DemoPass2026!';

async function login(page: Page) {
    await page.goto('/auth');
    await page.getByPlaceholder('you@example.com').fill(EMAIL);
    await page.getByPlaceholder('Enter password').fill(PASSWORD);
    await page.locator('button[type="submit"]').click();
    await page.waitForURL('**/search', { timeout: 60_000 });
}

test("a Devil's Advocate run resumes the same session after a trading detour", async ({ page }) => {
    test.setTimeout(200_000);
    await page.route('**/v1/search', () => { /* hold open */ });
    await page.route('**/api/llm/chat', () => { /* hold open */ });

    await login(page);
    await page.goto('/companies/AAPL');

    // Start the challenge; the button flips to its in-flight label.
    const challenge = page.getByRole('button', { name: /Challenge the thesis|Re-challenge/ });
    await challenge.scrollIntoViewIfNeeded().catch(() => {});
    await challenge.click({ timeout: 30_000 });
    await expect(page.getByRole('button', { name: 'Challenging…' })).toBeVisible({ timeout: 20_000 });
    await expect(page.getByText(/\d+ running/)).toBeVisible({ timeout: 20_000 });

    // Client-side nav to trading — the run and indicator must persist.
    await page.locator('a[href="/trading"]').first().click();
    await page.waitForURL('**/trading', { timeout: 20_000 });
    await expect(page.getByText(/\d+ running/)).toBeVisible({ timeout: 10_000 });

    // Back to the company via the indicator's Devil's Advocate job.
    await page.getByText(/\d+ running/).click();
    await expect(page.getByText('Running in background')).toBeVisible({ timeout: 10_000 });
    await page.locator('li button', { hasText: "AAPL Devil's Advocate" }).first().click();
    await page.waitForURL('**/companies/AAPL', { timeout: 15_000 });

    // Same run still in flight (not restarted, not back to the idle prompt).
    await expect(page.getByRole('button', { name: 'Challenging…' })).toBeVisible({ timeout: 15_000 });
    // Still exactly one Devil's Advocate job → resumed, not duplicated. (The
    // total job count is not asserted: the page's own brief job registers
    // asynchronously, so the total legitimately changes under load.)
    await page.getByText(/\d+ running/).click();
    await expect(page.getByText('Running in background')).toBeVisible({ timeout: 10_000 });
    expect(await page.locator('li button', { hasText: "AAPL Devil's Advocate" }).count()).toBe(1);
});
