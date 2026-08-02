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
        // `auto`/`scroll` contain by letting the user reach the content;
        // `hidden`/`clip` contain by cutting it off. Both stop the PAGE from
        // scrolling sideways, which is what row 9 measures and this row
        // explains — a decorative full-bleed layer inside an overflow-hidden
        // section is a design choice, not a bug, and counting it as an escapee
        // buries the real ones.
        //
        // Deliberately excludes <body>: index.css sets `overflow-x: hidden`
        // there as a global safety net, and honouring it would mark every
        // element on every page as contained and make this row worthless.
        const scrolls = (el: Element) => {
          if (el === document.body) return false;
          const o = getComputedStyle(el).overflowX;
          return o === 'auto' || o === 'scroll' || o === 'hidden' || o === 'clip';
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

  // MB-3 · rows 15 and 16. The bar is the one piece of chrome that must survive
  // the iOS toolbar collapse, and the one the desktop rail never had to prove:
  // a rail can be off-screen and still work with a scroll, a bottom bar cannot.
  test('rows 15 + 16 — the bottom bar is reachable and navigates', async ({ page }, info) => {
    test.skip(info.project.name === 'tablet-768', 'the rail is still the nav at md and above');
    await settle(page, '/search');

    const bar = page.getByTestId('mobile-nav');
    await expect(bar).toBeVisible();

    // Row 15: visible in the collapsed-toolbar viewport without scrolling.
    //
    // Measured against the VISIBLE viewport, not window.innerHeight. Under
    // mobile emulation those differ — 664 vs 743 at iPhone 14 — and the larger
    // one is exactly the lie that hides bottom chrome under the browser
    // toolbar. If this assertion is ever "fixed" by switching to innerHeight,
    // the bug comes back silently.
    const fit = await page.evaluate(() => {
      const r = document.querySelector('[data-testid="mobile-nav"]')!.getBoundingClientRect();
      return {
        bottom: Math.round(r.bottom),
        visible: document.documentElement.clientHeight,
        innerHeight: window.innerHeight,
      };
    });
    expect(
      fit.bottom,
      `bar bottom ${fit.bottom} vs visible ${fit.visible} (innerHeight claims ${fit.innerHeight})`,
    ).toBeLessThanOrEqual(fit.visible + 1);
    expect(await page.evaluate(() => window.scrollY)).toBe(0);

    // Row 6, measured rather than scanned: five targets, each >= 44px.
    const targets = bar.locator('a, button');
    expect(await targets.count()).toBe(5);
    for (let i = 0; i < 5; i++) {
      const b = (await targets.nth(i).boundingBox())!;
      expect(Math.round(b.height), `target ${i} height`).toBeGreaterThanOrEqual(44);
      expect(Math.round(b.width), `target ${i} width`).toBeGreaterThanOrEqual(44);
    }

    // The desktop rail must be gone, not merely overlapped.
    await expect(page.locator('aside').first()).toBeHidden();

    // Row 16: a tap actually routes, and the active state follows.
    await bar.getByRole('link', { name: /History/i }).click();
    await expect(page).toHaveURL(/\/history/);
    await expect(bar.locator('[aria-current="page"]')).toHaveCount(1);

    // The sheet holds every destination the tabs do not.
    await bar.getByRole('button', { name: 'More destinations' }).click();
    await expect(page.getByRole('link', { name: 'Settings' })).toBeVisible();
  });

  // A bare /trading load lands on the market hub, which is `max-w-[1280px]
  // mx-auto px-4` and reflows fine — so the route above passes at every width
  // while fault F1, the worst layout bug in the app, sits one click deeper in
  // the three-column asset view. Measuring only what loads at rest would have
  // certified the broken surface as clean.
  // Navigation idiom borrowed from hubAssetMarket.spec.ts:12-19.
  test('/trading asset view — the chart is not crushed by the side panels', async ({ page }, info) => {
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
      // The WIDEST chart-ish box, not the first in document order. A
      // lightweight-charts root contains several canvases — a price pane and a
      // narrow axis pane — so `querySelector` returns a 52px axis or a hidden
      // 0px canvas and reports the chart as crushed when it is not.
      const chartWidth = Math.max(
        0,
        ...Array.from(
          document.querySelectorAll('.tv-lightweight-charts, canvas, [class*="chart"]'),
        ).map((e) => e.getBoundingClientRect().width),
      );
      return {
        frame,
        panelWidths: panels.map((p) => Math.round(p.width)),
        chartWidth: Math.round(chartWidth),
        chartPct: Math.round((chartWidth / frame) * 100),
      };
    });

    expect(
      geom.chartPct,
      `chart is ${geom.chartWidth}px = ${geom.chartPct}% of a ${geom.frame}px viewport; ` +
        `side panels measured [${geom.panelWidths.join(', ')}]`,
    ).toBeGreaterThanOrEqual(88);

    // Row 12 — the two columns the phone gave up are each one tap away and
    // each own the screen when open. Tablet keeps the desktop three-column
    // layout, so there is no strip there to tap.
    if (info.project.name === 'tablet-768') return;

    for (const [name, label] of [
      ['info', 'INFO'],
      ['community', 'SOCIAL'],
    ] as const) {
      await page.getByRole('button', { name: label }).click();
      const sheet = page.locator('[data-slot="drawer-content"]');
      await expect(sheet).toBeVisible();
      const s = (await sheet.boundingBox())!;
      const v = page.viewportSize()!;
      expect(Math.round((s.width / v.width) * 100), `${name} sheet width`).toBeGreaterThanOrEqual(90);
      expect(Math.round((s.height / v.height) * 100), `${name} sheet height`).toBeGreaterThanOrEqual(85);
      await page.keyboard.press('Escape');
      await expect(sheet).toBeHidden();
    }
  });
});
