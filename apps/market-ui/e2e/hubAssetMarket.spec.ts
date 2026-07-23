import { test, expect } from '@playwright/test';

// Regression cover: picking a Tunisian stock off the /trading hub used to keep
// activeMarket on its 'crypto' default, so the stock opened the crypto chart
// ("No verified candle source"), the info panel had no data, and Back returned
// to the crypto list instead of the Tunisian one. The market id must travel
// with the symbol.
//
// The card lists whichever names are most active that session, so this reads
// the leading stock's ticker at runtime rather than pinning one — pinning BIAT
// broke the day BIAT dropped out of the card.
test('a Tunisian stock picked from the hub opens in the Tunisian market', async ({ page }) => {
    await page.goto('/trading');

    const tnCard = page.locator('div').filter({ hasText: /^Tunisian Market/ }).first();
    // Stock rows are the buttons priced in TND; the header and "See all" are not.
    const firstStock = tnCard.getByRole('button').filter({ hasText: /TND/ }).first();
    await expect(firstStock).toBeVisible({ timeout: 30_000 });
    await firstStock.click();

    // We are on a TN stock's page, priced in TND — not the hub, not a crypto page.
    // BUY <ticker> exists for whichever stock led the card this session.
    await expect(page.getByRole('button', { name: /^BUY / })).toBeVisible({ timeout: 30_000 });
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
