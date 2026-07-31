import { test, expect, type Page } from '@playwright/test';

// The floating header is imperative DOM (a cloned <thead> shown on scroll), so a
// green build proves nothing about it. These drive the real page instead.
const BASE = process.env.E2E_BASE || 'https://market-ui-self.vercel.app';

// The clone is appended next to the table's scroll container, outside React.
const CLONE = 'div[style*="position: fixed"] table thead';

// /trading opens the hub; the table lives one click in, on a market list.
async function openCryptoList(page: Page) {
  await page.goto(`${BASE}/trading`, { waitUntil: 'domcontentloaded' });
  await page.getByRole('button', { name: /See all Crypto/i }).first().click();
  await page.waitForSelector('table tbody tr', { timeout: 60_000 });
}

test('column header follows you down the list', async ({ page }) => {
  await openCryptoList(page);

  // Nothing pinned while the real header is still on screen.
  expect(await page.locator(CLONE).count()).toBeGreaterThanOrEqual(0);
  await expect(page.locator(CLONE).first()).toBeHidden();

  // Scope to the real table: the clone also has a <thead>, and a hidden node
  // reports raw text while a visible one reports the CSS-uppercased text.
  const labels = (await page.locator('div.overflow-x-auto table thead th').allInnerTexts()).join('|');

  // Scroll the page's own scroller far enough to bury the real header.
  await page.evaluate(() => {
    const el = document.querySelector('.overflow-y-auto') as HTMLElement | null;
    (el ?? document.scrollingElement!).scrollTop = 1500;
  });
  await page.waitForTimeout(400);

  const clone = page.locator(CLONE).first();
  await expect(clone).toBeVisible();

  // It must be the same columns, in the same order — not a stale snapshot.
  const cloneLabels = (await clone.locator('th').allInnerTexts()).join('|');
  expect(cloneLabels).toBe(labels);

  // And it must sit at the top of the visible area, not float mid-page.
  const box = await clone.boundingBox();
  expect(box!.y).toBeLessThan(200);
});

test('floating header hides again when scrolled back up', async ({ page }) => {
  await openCryptoList(page);
  await page.evaluate(() => {
    const el = document.querySelector('.overflow-y-auto') as HTMLElement | null;
    (el ?? document.scrollingElement!).scrollTop = 1500;
  });
  await page.waitForTimeout(400);
  await expect(page.locator(CLONE).first()).toBeVisible();

  await page.evaluate(() => {
    const el = document.querySelector('.overflow-y-auto') as HTMLElement | null;
    (el ?? document.scrollingElement!).scrollTop = 0;
  });
  await page.waitForTimeout(400);
  await expect(page.locator(CLONE).first()).toBeHidden();
});

test('page does not scroll sideways (5158a97 containment holds)', async ({ page }) => {
  await openCryptoList(page);
  const overflows = await page.evaluate(() => {
    const d = document.documentElement;
    const scroller = document.querySelector('.overflow-y-auto') as HTMLElement | null;
    return {
      doc: d.scrollWidth > d.clientWidth + 1,
      root: scroller ? scroller.scrollWidth > scroller.clientWidth + 1 : false,
    };
  });
  expect(overflows.doc).toBe(false);
  expect(overflows.root).toBe(false);
});
