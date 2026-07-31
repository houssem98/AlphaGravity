import { test, expect, type Page } from '@playwright/test';

// The scroll-hiding chrome is driven by data attributes useScrollChrome writes
// on <html>, consumed purely in CSS. 5158a97 silently severed it by moving the
// ref onto a horizontal-only scroller, and nothing caught that — hence this.

async function openCryptoList(page: Page) {
  await page.goto('/trading', { waitUntil: 'domcontentloaded' });
  await page.getByRole('button', { name: /See all Crypto/i }).first().click();
  await page.waitForSelector('table tbody tr', { timeout: 60_000 });
}

// Rows and sparklines arrive after first paint; until the list is taller than
// the viewport there is nothing to scroll and the chrome never engages.
async function settle(page: Page) {
  await page.waitForFunction(() => {
    const el = document.querySelector('.overflow-y-auto') as HTMLElement | null;
    return !!el && el.scrollHeight > el.clientHeight + 200;
  }, undefined, { timeout: 30_000 });
}

// Scroll the container the hook resolves to, the same way a wheel would.
async function scrollList(page: Page, top: number) {
  await page.evaluate((y) => {
    const el = document.querySelector('.overflow-y-auto') as HTMLElement | null;
    (el ?? document.scrollingElement!).scrollTop = y;
  }, top);
}

test('scrolling down publishes the nav state the chrome CSS listens for', async ({ page }) => {
  await openCryptoList(page);
  await settle(page);
  expect(await page.evaluate(() => document.documentElement.dataset.nav)).toBeUndefined();

  await scrollList(page, 900);
  await page.waitForFunction(() => document.documentElement.dataset.nav === 'down', undefined, { timeout: 5_000 });

  // Scrolling back up releases it.
  await scrollList(page, 0);
  await page.waitForFunction(() => document.documentElement.dataset.nav === 'up', undefined, { timeout: 5_000 });
});

test('the top nav hides on the way down and comes back on the way up', async ({ page }) => {
  await openCryptoList(page);
  await settle(page);
  const nav = page.locator('header.chrome-nav');
  await expect(nav).toBeVisible();

  await scrollList(page, 900);
  await expect
    .poll(async () => nav.evaluate((el) => getComputedStyle(el).opacity), { timeout: 5_000 })
    .toBe('0');

  await scrollList(page, 0);
  await expect
    .poll(async () => nav.evaluate((el) => getComputedStyle(el).opacity), { timeout: 5_000 })
    .toBe('1');
});

test('column labels come back once scrolling stops', async ({ page }) => {
  await openCryptoList(page);
  await settle(page);
  const th = page.locator('div.overflow-x-auto table.sticky-head thead th').first();

  await scrollList(page, 900);
  // The fade is transient by design — the idle flag clears 180ms after the last
  // scroll event, so assert the resting state rather than racing the animation.
  await expect
    .poll(async () => th.evaluate((el) => getComputedStyle(el).opacity), { timeout: 5_000 })
    .toBe('1');
  expect(await page.evaluate(() => document.documentElement.dataset.scrolling)).toBe('0');
});

// Hiding the nav collapses it by 48px, which reflows the list and emits a scroll
// event. Without a floor above that, the chrome oscillated forever: 95 events in
// 3s untouched. This is the regression guard for that.
test('the chrome settles instead of oscillating', async ({ page }) => {
  await openCryptoList(page);
  await settle(page);
  await scrollList(page, 900);
  await page.waitForTimeout(600); // past the 180ms idle window

  const churn = await page.evaluate(async () => {
    const el = document.querySelector('.overflow-y-auto') as HTMLElement;
    let events = 0;
    const flips = new Set<string>();
    const onS = () => { events++; flips.add(String(document.documentElement.dataset.nav)); };
    el.addEventListener('scroll', onS);
    const before = el.scrollTop;
    await new Promise((r) => setTimeout(r, 2000));
    el.removeEventListener('scroll', onS);
    return { events, drift: Math.abs(el.scrollTop - before), directions: flips.size };
  });

  expect(churn.events).toBeLessThan(5);
  expect(churn.drift).toBeLessThan(10);
  expect(churn.directions).toBeLessThanOrEqual(1);
});
