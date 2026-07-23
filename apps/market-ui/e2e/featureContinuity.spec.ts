import { test, expect, type Page } from '@playwright/test';

// Acceptance harness for docs/FEATURE_INDEPENDENCE_ROADMAP.md. A long-running
// feature must keep running when the user switches views, and returning must
// resume the SAME in-flight session — not restart it. Covers the reported bug:
// starting a company brief, visiting /trading, and coming back.
//
// The feature's backend is held open so the run stays in-flight across the
// round trip; that controls timing only. What's under test is that the run's
// state lives in a module-level store (companyBriefStore), so the component can
// unmount and remount without dropping or duplicating the run.
const EMAIL = process.env.E2E_EMAIL || 'investor.demo+test@example.com';
const PASSWORD = process.env.E2E_PASSWORD || 'DemoPass2026!';

async function login(page: Page) {
    await page.goto('/auth');
    await page.getByPlaceholder('you@example.com').fill(EMAIL);
    await page.getByPlaceholder('Enter password').fill(PASSWORD);
    await page.locator('button[type="submit"]').click();
    await page.waitForURL('**/search', { timeout: 60_000 });
}

test('a company brief resumes the same session after a trading detour', async ({ page }) => {
    test.setTimeout(200_000);
    await page.route('**/v1/search', () => { /* hold open */ });
    await page.route('**/api/llm/chat', () => { /* hold open */ });

    await login(page);
    await page.goto('/companies/AAPL');
    await page.waitForTimeout(8000);

    const regen = page.getByRole('button', { name: /Regenerate|Stop/ }).first();
    await regen.scrollIntoViewIfNeeded().catch(() => {});
    if (/Regenerate/.test((await regen.textContent()) || '')) await regen.click();
    await page.waitForTimeout(2500);
    await expect(page.getByRole('button', { name: /Stop/ })).toBeVisible({ timeout: 15_000 });
    await expect(page.getByText(/\d+ running/)).toBeVisible({ timeout: 15_000 });

    // Client-side nav to trading — the run and indicator must persist.
    await page.locator('a[href="/trading"]').first().click();
    await page.waitForURL('**/trading', { timeout: 20_000 });
    await expect(page.getByText(/\d+ running/)).toBeVisible({ timeout: 10_000 });

    // Back to the company via the indicator; the brief must be the SAME run.
    await page.getByText(/\d+ running/).click();
    await page.getByText('AAPL Company Brief').first().click();
    await page.waitForURL('**/companies/AAPL', { timeout: 15_000 });
    await page.waitForTimeout(3000);
    await expect(page.getByRole('button', { name: /Stop/ })).toBeVisible({ timeout: 10_000 });
    // Still exactly one Company Brief job → it resumed rather than starting a
    // duplicate. (The total is not asserted: the page's transcript read registers
    // its own job, so the total legitimately varies.)
    await page.getByText(/\d+ running/).click();
    await expect(page.getByText('Running in background')).toBeVisible({ timeout: 10_000 });
    expect(await page.locator('li button', { hasText: 'AAPL Company Brief' }).count()).toBe(1);
});
