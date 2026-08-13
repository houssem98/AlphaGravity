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

});

// R13 and R14 stub the API rather than driving a live one. That is deliberate, not a
// shortcut: both rows are claims about what the UI does WITH a server response — the
// CTA names the tier the server named, and the meter prints the number the server
// counted. Intercepting the response tests exactly that contract, and it keeps the
// rows runnable while gravity-api is undeployed. What it does NOT prove is that prod
// returns these shapes; PL-6 and PL-9's pytest cover that half.
test.describe('PLANS upgrade moment', () => {
    // R13 — a denied action shows an upgrade CTA naming the needed tier.
    test('R13 a denied upload shows a CTA naming the tier that lifts the limit', async ({ page }) => {
        await page.route('**/v1/documents/ingest', route => route.fulfill({
            status: 402,
            contentType: 'application/json',
            body: JSON.stringify({
                detail: {
                    error: 'plan_limit_exceeded',
                    capability: 'document_uploads_per_month',
                    label: 'Document uploads / mo',
                    plan: 'Free', plan_id: 'free',
                    limit: 5, used: 6, period: 'month',
                    upgrade_to: 'analyst',
                },
            }),
        }));

        await page.goto('/documents');
        await page.setInputFiles('input[type="file"]', {
            name: 'probe.txt', mimeType: 'text/plain', buffer: Buffer.from('probe'),
        });

        const notice = page.locator('[data-testid="plan-limit-notice"]');
        await expect(notice).toBeVisible({ timeout: 20_000 });
        // The three things a CTA must carry, or the user has to guess.
        await expect(notice).toContainText('Document uploads / mo'.toLowerCase());
        await expect(notice).toContainText('6 of 5');
        await expect(page.locator('[data-testid="plan-limit-cta"]'))
            .toHaveAttribute('data-upgrade-to', 'analyst');
        // The regression that made this task necessary.
        await expect(notice).not.toContainText('[object Object]');
    });

    // R14 — the meter's number equals the server's counter, with no local arithmetic.
    test('R14 the quota meter prints the server counter verbatim', async ({ page }) => {
        // `remaining` deliberately disagrees with limit - used. A meter doing its own
        // sums would print 38 and drift from the gate that actually refuses.
        await page.route('**/v1/plan/usage', route => route.fulfill({
            status: 200,
            contentType: 'application/json',
            body: JSON.stringify({
                tier: 'analyst', tier_name: 'Analyst',
                capabilities: [{
                    capability: 'grid_runs_per_day', label: 'Research Grid runs / day',
                    group: 'research', enforcement: 'server', kind: 'quota',
                    limit: 50, used: 12, remaining: 7, unlimited: false, period: 'day',
                }],
            }),
        }));

        await page.goto('/billing');
        const meter = page.locator('[data-testid="meter-grid_runs_per_day"]');
        await expect(meter).toBeVisible({ timeout: 20_000 });
        await expect(meter).toHaveAttribute('data-used', '12');
        await expect(meter).toHaveAttribute('data-limit', '50');
        await expect(meter).toHaveAttribute('data-remaining', '7');
        await expect(page.locator('[data-testid="meter-text-grid_runs_per_day"]'))
            .toHaveText('12 / 50');
    });
});
