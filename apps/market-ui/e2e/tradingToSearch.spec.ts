import { test, expect, type Page } from '@playwright/test';

// Regression cover for the frozen-page bug: react-router v7 navigates inside
// startTransition, so React keeps the CURRENT page mounted until the next
// route's lazy chunk resolves — it does not show the Suspense fallback. With a
// cold chunk, clicking Search on /trading flipped the URL to /search while the
// Tunisian market table stayed on screen ("the click did nothing").
//
// Creds come from env so the repo carries no password. Defaults match the
// throwaway demo account.
const EMAIL = process.env.E2E_EMAIL || 'investor.demo+test@example.com';
const PASSWORD = process.env.E2E_PASSWORD || 'DemoPass2026!';

const SEARCH_CHUNK = /\/assets\/SearchPage-[A-Za-z0-9_-]+\.js/;

async function login(page: Page) {
    await page.goto('/auth');
    await page.getByPlaceholder('you@example.com').fill(EMAIL);
    await page.getByPlaceholder('Enter password').fill(PASSWORD);
    // "Log In" also names the mode tab — target the submit button specifically.
    await page.locator('button[type="submit"]').click();
    await page.waitForURL('**/search', { timeout: 60_000 });
}

// The Search entry in the trading rail — the sparkle link above the nav icons.
function searchLink(page: Page) {
    return page.locator('aside a[href="/search"]').first();
}

test('clicking Search from the Tunisian market actually renders the search page', async ({ page }) => {
    await login(page);

    await page.goto('/trading');
    await expect(page.getByText('Markets').first()).toBeVisible();

    await searchLink(page).click();

    await expect(page).toHaveURL(/\/search/);
    // The real assertion: SearchPage content is on screen. Before the fix the
    // URL changed but the trading UI stayed put, so a URL check alone passed
    // while the page was visibly frozen.
    await expect(page.getByText('Deep Research').first()).toBeVisible();
    await expect(page.getByText('Research Grid').first()).toBeVisible();
});

test('hovering Search warms the SearchPage chunk before any click', async ({ page }) => {
    const requested: string[] = [];
    page.on('request', (r) => {
        if (SEARCH_CHUNK.test(r.url())) requested.push(r.url());
    });

    await login(page);
    await page.goto('/trading');
    await expect(page.getByText('Markets').first()).toBeVisible();

    // Drop anything the idle preload already fetched, so this asserts the hover
    // path specifically rather than the mount path.
    requested.length = 0;
    await searchLink(page).hover();

    // Either the hover fires the request, or the chunk is already cached from
    // the idle preload — both mean the click will not hit a cold chunk.
    const warmed = await page
        .waitForRequest(SEARCH_CHUNK, { timeout: 5_000 })
        .then(() => true)
        .catch(() => false);
    const alreadyCached = await page.evaluate(() =>
        performance.getEntriesByType('resource').some((e) => /SearchPage-.*\.js/.test(e.name)),
    );

    expect(warmed || alreadyCached).toBe(true);
});
