import { test, expect, type Page } from '@playwright/test';

// Live browser verification of the two 2026-07-19/20 roadmaps:
//   GRID_TRUST (chips, grades) + GRID_AGENT_CELL (tool traces, live ticker,
//   Tools accordion, /api/tn/ask NL endpoint) — against the prod deployment.
// Runs ONE real 1-ticker grid (AAPL × default prompts): live gravity RAG +
// market-server tools, DeepSeek only for synthesis.

const EMAIL = process.env.E2E_EMAIL || 'investor.demo+test@example.com';
const PASSWORD = process.env.E2E_PASSWORD || 'DemoPass2026!';

async function login(page: Page) {
    await page.goto('/auth');
    await page.getByPlaceholder('you@example.com').fill(EMAIL);
    await page.getByPlaceholder('Enter password').fill(PASSWORD);
    await page.locator('button[type="submit"]').click();
    await page.waitForURL('**/search', { timeout: 60_000 });
}

test('agentic grid run shows live steps, trace chips, trust grades, Tools accordion', async ({ page }) => {
    test.setTimeout(300_000); // one real grid run

    await login(page);
    await page.getByText('Research Grid').first().click();
    await expect(page.getByText('Tickers (comma-separated)')).toBeVisible();

    // Single ticker keeps the run short; default prompt set stays on.
    await page.getByPlaceholder('NVDA, AAPL, MSFT').fill('AAPL');
    await page.getByRole('button', { name: /Run Grid/i }).click();

    // AC-5 live ticker: some cell must show its current step while running.
    await expect(
        page.getByText(/Searching SEC filings…|Fetching market data…|Pulling fundamentals…|Analyzing…/).first(),
    ).toBeVisible({ timeout: 45_000 });

    // Run completes → Run Grid button returns.
    await expect(page.getByRole('button', { name: /Run Grid/i })).toBeVisible({ timeout: 240_000 });

    // GT-4 trust chip: at least one earned grade with its reasons tooltip.
    await expect(page.locator('[title*="RAG-grounded"], [title*="honesty"]').first()).toBeVisible();

    // AC-5 trace chip: ⚡N·X.Xs on done cells.
    await expect(page.getByText(/⚡\d/).first()).toBeVisible();

    // Open a done cell → modal has the Tools accordion with real step rows.
    await page.locator('.card-module').first().click();
    await expect(page.getByText(/Tools — called \d/)).toBeVisible();
    await expect(page.getByText('Searching SEC filings').first()).toBeVisible();
    await page.keyboard.press('Escape');
});

test('NL agentic endpoint answers with steps + earned trust from the browser context', async ({ page }) => {
    const r = await page.request.get('/api/tn/ask?q=AAPL+total+net+sales+fiscal+year+2025&ticker=AAPL');
    expect(r.ok()).toBe(true);
    const j = await r.json();
    expect(j.status).toBe('done');
    expect(j.answer).toContain('416');
    expect(j.steps.length).toBeGreaterThanOrEqual(2);
    expect(j.steps.every((s: any) => typeof s.ms === 'number')).toBe(true);
    expect(['A', 'B', 'C']).toContain(j.trust?.grade); // grounded XBRL answer must not grade D/F
});
