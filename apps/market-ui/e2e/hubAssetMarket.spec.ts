import { test, expect } from '@playwright/test';

// Regression cover: picking a Tunisian stock off the /trading hub used to keep
// activeMarket on its 'crypto' default, so BIAT opened the crypto chart ("No
// verified candle source for BIAT"), the info panel had no data, and Back
// returned to the crypto list instead of the Tunisian one. The market id must
// travel with the symbol.
test('a Tunisian stock picked from the hub opens in the Tunisian market', async ({ page }) => {
    await page.goto('/trading');

    // The Tunisian card lists its most-traded stocks under the TUNINDEX lead.
    const tnCard = page.locator('div').filter({ hasText: /^Tunisian Market/ }).first();
    // The card lists the most-traded TN stocks, and that set changes every
    // session — take whichever is listed instead of naming one. Button order is
    // [card header, ...constituents, See all], so nth(1) is the first stock.
    const stock = tnCard.getByRole('button').nth(1);
    await expect(stock).toBeVisible({ timeout: 30_000 });
    const symbol = (await stock.locator('span').first().innerText()).trim();
    await stock.click();

    // We are on BIAT's page, priced in TND — not the hub, not a crypto page.
    await expect(page.getByRole('button', { name: `BUY ${symbol}` })).toBeVisible({ timeout: 30_000 });
    await expect(page.getByText('TND').first()).toBeVisible();
    // TN assets render TnChart, never the crypto candle chart.
    await expect(page.getByText('No verified candle source')).toHaveCount(0);
    // The crypto-only global header must not be showing.
    await expect(page.getByRole('button', { name: 'Cryptocurrencies' })).toHaveCount(0);

    // Back goes to the Tunisian list, not the crypto one.
    await page.getByRole('button', { name: /^Back$/i }).first().click();
    await expect(page.getByText(/Bourse de Tunis|TUNINDEX/).first()).toBeVisible({ timeout: 30_000 });
    await expect(page.getByText('Cryptocurrency Prices')).toHaveCount(0);
});
