import { test, expect, type Page } from '@playwright/test';

// A background task (here a company AI brief) must keep running when the user
// switches views, and the global indicator must show it on every route and link
// back to it. Regression cover for the "switching tabs cancels my task" report.
//
// The task's backend calls are held open so the job stays alive across the
// navigation; that controls timing only. What's under test is that the job
// lives in a module-level store and the indicator is mounted above the router,
// so a client-side route change (the way a user switches views) preserves both.
const EMAIL = process.env.E2E_EMAIL || 'investor.demo+test@example.com';
const PASSWORD = process.env.E2E_PASSWORD || 'DemoPass2026!';

async function login(page: Page) {
    await page.goto('/auth');
    await page.getByPlaceholder('you@example.com').fill(EMAIL);
    await page.getByPlaceholder('Enter password').fill(PASSWORD);
    await page.locator('button[type="submit"]').click();
    await page.waitForURL('**/search', { timeout: 60_000 });
}

test('a background task survives navigation and the indicator links back', async ({ page }) => {
    test.setTimeout(180_000);
    await page.route('**/v1/search', () => { /* hold open so the brief keeps running */ });
    await page.route('**/api/llm/chat', () => { /* hold open */ });

    await login(page);
    await page.goto('/companies/AAPL');
    await page.waitForTimeout(8000);

    const regen = page.getByRole('button', { name: /Regenerate|Stop/ }).first();
    await regen.scrollIntoViewIfNeeded().catch(() => {});
    await expect(regen).toBeVisible({ timeout: 30_000 });
    if (/Regenerate/.test((await regen.textContent()) || '')) await regen.click();

    // Indicator shows the running job.
    await expect(page.getByText(/\d+ running/)).toBeVisible({ timeout: 20_000 });

    // Client-side nav to another route — the store and indicator must persist.
    await page.locator('a[href="/search"]').first().click();
    await page.waitForURL('**/search', { timeout: 20_000 });
    await expect(page.getByText(/\d+ running/)).toBeVisible({ timeout: 10_000 });

    // Expand and click the job → routes back to the company that owns it.
    await page.getByText(/\d+ running/).click();
    await expect(page.getByText('AAPL Company Brief').first()).toBeVisible({ timeout: 5000 });
    await page.getByText('AAPL Company Brief').first().click();
    await page.waitForURL('**/companies/AAPL', { timeout: 15_000 });
});
