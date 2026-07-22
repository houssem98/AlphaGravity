import { test, expect } from '@playwright/test';

// The Tunisian route has now been blanked three times by the same defect: a
// number formatter typed `number` while the BVMT feed sends null, throwing out
// of React render and replacing the whole page with the error boundary. A null
// level is normal — pre-open, a halted sector, an index with no volume that day.
//
// This pins the contract: every /api/tn payload nulled out, and the page still
// renders. If it snags, some formatter is assuming a number again.
const NULL_BODIES: Record<string, unknown> = {
    indices: {
        tunindex: { name: 'TUNINDEX', level: null, changePct: null, yearPct: null },
        tunindex20: { name: 'TUNINDEX20', level: null, changePct: null, yearPct: null },
        sectors: [
            { name: 'INDICE DES BANQUES', level: null, changePct: null, yearPct: null },
            { name: 'INDICE DISTRIBUTION', level: 1234.5, changePct: null, yearPct: null },
        ],
        stats: { marketCap: null, advancers: null, decliners: null, turnover: null, trades: null, active: null, listed: null },
    },
    index: { tunindex: { level: null, changePct: null } },
    brief: {
        date: '2026-07-21',
        tunindex: { level: null, changePct: null },
        breadth: { advancers: 0, decliners: 0, unchanged: 0, traded: 0 },
        topGainers: [{ symbol: 'BIAT', changePct: null, price: null }],
        topLosers: [{ symbol: 'SFBT', changePct: null, price: null }],
        text: 'No session.',
    },
};

test('the Tunisian market renders when every BVMT figure is null', async ({ page }) => {
    const errors: string[] = [];
    page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });

    await page.route('**/api/tn/**', async (route) => {
        const fn = new URL(route.request().url()).pathname.split('/').pop() || '';
        const body = NULL_BODIES[fn];
        if (!body) return route.continue();
        await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(body) });
    });

    await page.goto('/trading');
    await page.getByText('See all Tunisian Market').click();
    await expect(page.getByText('Prices & Movers')).toBeVisible({ timeout: 30_000 });
    await page.waitForTimeout(4000);

    await expect(page.getByText('This page hit a snag.')).toHaveCount(0);
    expect(errors.filter((e) => /toLocaleString|toFixed|of null|of undefined/.test(e))).toEqual([]);
});
