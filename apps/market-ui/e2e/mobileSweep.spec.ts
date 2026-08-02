import { test, expect } from '@playwright/test';

// MB-2 · rows 9 and 10 of docs/MOBILE_APP_ROADMAP.md, run across the §5 device
// matrix against the live alias.
//
// The evaluator is DD-13's, lifted from dexterNarrow.spec.ts:49-69 — an element
// wider than the frame is fine if some ancestor scrolls it, and a bug if not.
// DD-13 proved one panel's markup in a fixture; this runs the same question at
// the whole product, on the pages a phone actually loads.
//
// This spec is expected to fail on most routes when it lands. That failure list
// is the fault map MB-3 onward works through. It is not a broken test.
const ROUTES = [
  '/',
  '/auth',
  '/search',
  '/trading',
  '/companies',
  '/history',
  '/dashboard',
  '/documents',
  '/settings',
  '/billing',
] as const;

// Prod is a live terminal: charts stream, tables paginate in, lazy route chunks
// resolve after first paint. Settle before measuring or the sweep reports the
// skeleton's geometry instead of the page's.
async function settle(page: import('@playwright/test').Page, path: string) {
  await page.goto(path, { waitUntil: 'domcontentloaded', timeout: 60_000 });
  await page.waitForLoadState('networkidle', { timeout: 45_000 }).catch(() => {});
  await page.waitForTimeout(2_000);
}

test.describe('rows 9 + 10 — no route scrolls sideways on a phone', () => {
  for (const path of ROUTES) {
    test(`${path} — document gains no horizontal scroll`, async ({ page }) => {
      await settle(page, path);
      const { scrollWidth, clientWidth, overflow } = await page.evaluate(() => {
        const de = document.documentElement;
        return {
          scrollWidth: de.scrollWidth,
          clientWidth: de.clientWidth,
          overflow: de.scrollWidth - de.clientWidth,
        };
      });
      expect(
        overflow,
        `${path}: scrollWidth ${scrollWidth} exceeds clientWidth ${clientWidth} by ${overflow}px`,
      ).toBeLessThanOrEqual(0);
    });

    test(`${path} — nothing escapes the viewport uncontained`, async ({ page }) => {
      await settle(page, path);
      const escapees = await page.evaluate(() => {
        const frame = document.documentElement.clientWidth;
        const scrolls = (el: Element) => {
          const o = getComputedStyle(el).overflowX;
          return o === 'auto' || o === 'scroll';
        };
        const seen = new Map<string, number>();
        for (const el of Array.from(document.body.querySelectorAll('*'))) {
          const r = el.getBoundingClientRect();
          if (r.width === 0 || r.height === 0) continue;
          if (r.right <= frame + 0.5) continue;
          // Wider than the frame is fine if an ancestor scrolls it.
          let p: Element | null = el.parentElement;
          let contained = false;
          while (p && p !== document.body) {
            if (scrolls(p)) { contained = true; break; }
            p = p.parentElement;
          }
          if (contained) continue;
          const cls = (el.getAttribute('class') || '').slice(0, 80);
          const key = `${el.tagName.toLowerCase()}${cls ? '.' + cls : ''} +${Math.round(r.right - frame)}px`;
          seen.set(key, (seen.get(key) || 0) + 1);
        }
        // Collapse repeats — 40 identical overflowing table cells are one bug.
        return Array.from(seen, ([k, n]) => (n > 1 ? `${k} (x${n})` : k)).slice(0, 12);
      });
      expect(escapees, `${path}: ${escapees.length} uncontained overflow source(s)`).toEqual([]);
    });
  }

  // A bare /trading load lands on the market hub, which is `max-w-[1280px]
  // mx-auto px-4` and reflows fine — so the route above passes at every width
  // while fault F1, the worst layout bug in the app, sits one click deeper in
  // the three-column asset view. Measuring only what loads at rest would have
  // certified the broken surface as clean.
  // Navigation idiom borrowed from hubAssetMarket.spec.ts:12-19.
  test('/trading asset view — the chart is not crushed by the side panels', async ({ page }) => {
    await settle(page, '/trading');

    const card = page.locator('div').filter({ hasText: /^Tunisian Market/ }).first();
    const stock = card.getByRole('button').nth(1);
    await expect(stock).toBeVisible({ timeout: 30_000 });
    const symbol = (await stock.locator('span').first().innerText()).trim();
    await stock.click();
    await expect(page.getByRole('button', { name: `BUY ${symbol}` })).toBeVisible({ timeout: 30_000 });
    await page.waitForTimeout(2_000);

    // Row 11: the chart column must own the viewport, not the leftovers of a
    // 288px + 300px pair of fixed panels.
    const geom = await page.evaluate(() => {
      const frame = document.documentElement.clientWidth;
      const panels = Array.from(document.querySelectorAll<HTMLElement>('[style*="width:"]'))
        .map((el) => el.getBoundingClientRect())
        .filter((r) => r.width >= 200 && r.height >= 200);
      const chart = document.querySelector('canvas, .tv-lightweight-charts, [class*="chart"]');
      const c = chart?.getBoundingClientRect();
      return {
        frame,
        panelWidths: panels.map((p) => Math.round(p.width)),
        chartWidth: c ? Math.round(c.width) : 0,
        chartPct: c ? Math.round((c.width / frame) * 100) : 0,
      };
    });

    expect(
      geom.chartPct,
      `chart is ${geom.chartWidth}px = ${geom.chartPct}% of a ${geom.frame}px viewport; ` +
        `side panels measured [${geom.panelWidths.join(', ')}]`,
    ).toBeGreaterThanOrEqual(88);
  });
});
