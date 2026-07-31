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

// Drive a continuous scroll and report the dimmest a node got along the way —
// used both to prove the nav fades and to prove the column labels never do.
async function dimmestDuringScroll(page: Page, selector: string) {
  return page.evaluate(async (sel) => {
    const el = document.querySelector('.overflow-y-auto') as HTMLElement;
    const node = document.querySelector(sel) as HTMLElement;
    let dimmest = 1;
    for (let i = 1; i <= 8; i++) {
      el.scrollTop = i * 150;
      await new Promise((r) => setTimeout(r, 50));
      dimmest = Math.min(dimmest, parseFloat(getComputedStyle(node).opacity));
    }
    return dimmest;
  }, selector);
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

test('the top nav goes away on the way down and stays away until you go back up', async ({ page }) => {
  await openCryptoList(page);
  await settle(page);
  const nav = page.locator('header.chrome-nav');
  await expect(nav).toBeVisible();

  await scrollList(page, 900);
  await expect.poll(async () => nav.evaluate((el) => getComputedStyle(el).opacity), { timeout: 5_000 }).toBe('0');

  // Pausing must not flick it back — that was the old behaviour and it made
  // reading a long list feel twitchy.
  await page.waitForTimeout(900); // well past the 180ms idle window
  expect(await nav.evaluate((el) => getComputedStyle(el).opacity)).toBe('0');

  // Heading back up is what returns it.
  await scrollList(page, 0);
  await expect.poll(async () => nav.evaluate((el) => getComputedStyle(el).opacity), { timeout: 5_000 }).toBe('1');
});

test('column labels survive the trip down — they never fade', async ({ page }) => {
  await openCryptoList(page);
  await settle(page);
  const sel = 'div.overflow-x-auto table.sticky-head thead th';

  // The headings are the reason the header is pinned at all; if they dim, the
  // numbers underneath lose their meaning.
  expect(await dimmestDuringScroll(page, sel)).toBe(1);

  await scrollList(page, 1500);
  await page.waitForTimeout(600);
  expect(await page.locator(sel).first().evaluate((el) => getComputedStyle(el).opacity)).toBe('1');
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
