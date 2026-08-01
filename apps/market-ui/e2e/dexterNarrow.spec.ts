import { test, expect } from '@playwright/test';
import { readFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

// DD-13 · row 16, measured rather than asserted.
//
// The vitest suites check that every wide surface owns an `overflow-x-auto`
// parent. That is the structure; this is the outcome. The panel's own markup is
// rendered at the shipped CSS and laid out by a real engine at 380px, and the
// body must not gain a single pixel of horizontal scroll.
//
// The CSS is the production bundle, fetched once into e2e/fixtures. Skips (does
// not fail) when it has not been fetched, so the suite stays runnable offline.
const here = dirname(fileURLToPath(import.meta.url));
const CSS_PATH = join(here, 'fixtures', 'dexter-prod.css');
const HTML_PATH = join(here, 'fixtures', 'dexter-turn.html');

const RAIL = 380;

test.describe('DD-13 row 16 — the panel body never scrolls sideways at 380px', () => {
  test.skip(
    !existsSync(CSS_PATH) || !existsSync(HTML_PATH),
    'run scripts/capture-dexter-fixtures.mjs first',
  );

  const page380 = async (page: import('@playwright/test').Page) => {
    const css = readFileSync(CSS_PATH, 'utf8');
    const body = readFileSync(HTML_PATH, 'utf8');
    await page.setViewportSize({ width: RAIL, height: 900 });
    await page.setContent(
      `<!doctype html><html data-theme="dark"><head><style>${css}</style>
       <style>html,body{margin:0}#rail{width:${RAIL}px}</style></head>
       <body class="bg-[color:var(--bg)]"><div id="rail">${body}</div></body></html>`,
      { waitUntil: 'load' },
    );
    return page;
  };

  test('the document gains no horizontal scroll', async ({ page }) => {
    await page380(page);
    const { scrollWidth, clientWidth } = await page.evaluate(() => ({
      scrollWidth: document.documentElement.scrollWidth,
      clientWidth: document.documentElement.clientWidth,
    }));
    expect(scrollWidth).toBeLessThanOrEqual(clientWidth);
  });

  test('no element overflows the rail except inside its own scroll container', async ({ page }) => {
    await page380(page);
    const escapees = await page.evaluate((rail) => {
      const scrolls = (el: Element) =>
        getComputedStyle(el).overflowX === 'auto' || getComputedStyle(el).overflowX === 'scroll';
      const out: string[] = [];
      for (const el of Array.from(document.querySelectorAll('#rail *'))) {
        if (el.getBoundingClientRect().right <= rail + 0.5) continue;
        // an element wider than the rail is fine if some ancestor scrolls it
        let p: Element | null = el.parentElement;
        let contained = false;
        while (p && p.id !== 'rail') {
          if (scrolls(p)) { contained = true; break; }
          p = p.parentElement;
        }
        if (!contained) out.push(`${el.tagName}.${(el.className || '').toString().slice(0, 60)}`);
      }
      return out;
    }, RAIL);
    expect(escapees).toEqual([]);
  });

  test('the wide table scrolls inside its own container', async ({ page }) => {
    await page380(page);
    const box = page.locator('table').first();
    await expect(box).toBeVisible();
    const parentScrolls = await box.evaluate(
      (el) => getComputedStyle(el.parentElement!).overflowX,
    );
    expect(parentScrolls).toBe('auto');
  });
});
