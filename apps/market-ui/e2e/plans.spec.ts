// PLANS — the pricing matrix in a real browser.
//
// Rows graded here (docs/PLANS_WORLD_CLASS_ROADMAP.md §6):
//   R11 — the pricing table renders all §4 rows in all 4 columns
//   R12 — unavailable rows render struck-through, not omitted
//   R13 — a denied action shows an upgrade CTA naming the needed tier   (PL-11)
//   R14 — the quota meter's number equals the server's counter          (PL-11)
//
// R13 and R14 are declared here so `entitlement-probe.mjs` can see that the rows
// have a home, and are skipped until PL-11 builds what they grade. A skipped test
// that names its blocker is honest; a passing test for a UI that does not exist is
// not. Run: npx playwright test plans --project=chromium
import { test, expect } from '@playwright/test';

const MATRIX = '[data-testid="plan-matrix"]';

test.describe('PLANS pricing matrix', () => {
    test.beforeEach(async ({ page }) => {
        await page.goto('/billing');
        // The table only renders once /v1/billing/config answers with a matrix.
        await page.waitForSelector(MATRIX, { timeout: 20_000 });
    });

    // R11 — every row in every column. The count IS the claim: the bullet lists
    // this replaced showed different features per plan, so nothing lined up.
    test('R11 every capability row is rendered for every tier', async ({ page }) => {
        const cells = page.locator('[data-testid^="cell-"]');
        const headers = page.locator('[data-testid^="start-"]');
        const tierCount = await headers.count();
        const cellCount = await cells.count();

        expect(tierCount).toBe(4);
        expect(cellCount).toBeGreaterThan(0);
        // No holes: the grid is exactly rows × tiers.
        expect(cellCount % tierCount).toBe(0);
        expect(cellCount / tierCount).toBeGreaterThanOrEqual(20);
    });

    // R12 — absence is rendered, not omitted. This is the property that lets a
    // buyer see the ceiling they are under.
    test('R12 unavailable features are struck through rather than hidden', async ({ page }) => {
        const unavailable = page.locator('[data-testid^="cell-"][data-available="no"]');
        expect(await unavailable.count()).toBeGreaterThan(0);

        const first = unavailable.first();
        await expect(first).toBeVisible();                       // present, not omitted
        const cls = await first.getAttribute('class');
        expect(cls).toContain('line-through');
    });

    test('R12 an unpriced tier never shows an invented price', async ({ page }) => {
        // §10 E-P: §4's proposed figures are unconfirmed, so a tier with no
        // configured plan must say so and refuse the click.
        for (const tier of ['free', 'analyst', 'professional', 'institutional']) {
            const price = page.locator(`[data-testid="price-${tier}"]`);
            if ((await price.innerText()).trim() === 'Not yet priced') {
                await expect(page.locator(`[data-testid="start-${tier}"]`)).toBeDisabled();
            }
        }
    });

    test.skip('R13 a denied action shows an upgrade CTA naming the tier', async () => {
        // Blocked on PL-11, which builds the in-context CTA. The server half is
        // done: /v1/billing enforcement returns 402 with `upgrade_to` (PL-6).
    });

    test.skip('R14 the quota meter matches GET /v1/plan/usage', async () => {
        // Blocked on PL-11. The endpoint exists and is proven to read the
        // enforcer's own counter (PL-9 / R17); nothing renders it yet.
    });
});
