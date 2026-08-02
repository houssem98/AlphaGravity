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

  // MB-7 · row 14. Fault F9 was arithmetic — 380px of panel at right-4 wants
  // 396px on a 390px screen — but rows 9 and 10 never saw it, because the
  // panel only exists after a tap and the trading shell clips it. DD-13 proved
  // the contents reflow at 380px in a fixture; this proves the shell on prod.
  test('row 14 — the assistant opens as a sheet inside the viewport', async ({ page }, info) => {
    test.skip(info.project.name === 'tablet-768', 'the docked panel is correct above the hinge');
    await settle(page, '/trading');

    // The assistant lives in the asset view, not the hub — same navigation the
    // row 11 test uses.
    const card = page.locator('div').filter({ hasText: /^Tunisian Market/ }).first();
    const stock = card.getByRole('button').nth(1);
    await expect(stock).toBeVisible({ timeout: 30_000 });
    await stock.click();
    await page.waitForTimeout(3_000);

    await page.getByRole('button', { name: 'Open assistant' }).click({ timeout: 30_000 });
    await page.waitForTimeout(1_500);

    const m = await page.evaluate(() => {
      // The sheet identifies itself. Two attempts at inferring it from the DOM
      // both measured the wrong box — walking up by height stopped at an inner
      // scroll container (484px against a 584px sheet), and walking up to the
      // first absolute ancestor stopped at a 42px decoration inside the panel.
      // Both reported failures the shell did not have.
      const el = document.querySelector('[data-testid="assistant-sheet"]') as HTMLElement | null;
      const ta = document.querySelector('textarea, input[type="text"]');
      if (!el) return null;
      const r = el.getBoundingClientRect();
      const c = ta?.getBoundingClientRect();
      return {
        frame: document.documentElement.clientWidth,
        visible: document.documentElement.clientHeight,
        left: Math.round(r.left),
        right: Math.round(r.right),
        height: Math.round(r.height),
        composerBottom: c ? Math.round(c.bottom) : null,
      };
    });
    expect(m, 'assistant panel not found').not.toBeNull();

    expect(m!.right, `panel right edge ${m!.right} on a ${m!.frame}px screen`).toBeLessThanOrEqual(m!.frame + 1);
    expect(m!.left, 'panel starts off the left edge').toBeGreaterThanOrEqual(-1);
    expect(
      Math.round((m!.height / m!.visible) * 100),
      `panel is ${m!.height}px of a ${m!.visible}px viewport`,
    ).toBeGreaterThanOrEqual(85);
    if (m!.composerBottom !== null) {
      expect(m!.composerBottom, 'composer sits below the visible viewport').toBeLessThanOrEqual(m!.visible + 1);
    }
  });

  // MB-8 · fault F10. The sentiment modal reserved a fixed 280px stats column
  // inside a `max-w-[96vw]` box: 96vw of 390 is 374px, so the chart pane was
  // left 94px. Like F9 this is invisible to rows 9 and 10 — the modal only
  // exists after two taps, and it is `position: fixed` with its own overlay.
  test('the asset modal takes the screen and stacks its panes', async ({ page }, info) => {
    test.skip(info.project.name === 'tablet-768', 'the side-by-side modal is correct above the hinge');
    await settle(page, '/trading');

    // Sentiment data exists for crypto, not for the TN stock the other specs
    // use. The route is: a market list, tap a row to EXPAND it, then ADVANCED
    // CHART. The row's own click only toggles the accordion, and the TRADE
    // button that navigates directly lives in the `spark` column, which is
    // `hidden md:table-cell` — so on a phone the expand path is the only way
    // in, and clicking the row and expecting navigation is what made three
    // earlier attempts at this test fail.
    await page.getByRole('button', { name: /see all/i }).first().click({ timeout: 30_000 });
    await page.waitForTimeout(3_000);
    await page.locator('tbody tr').first().click();
    await page.waitForTimeout(1_200);
    await page.getByRole('button', { name: /advanced chart/i }).first().click();
    await page.waitForTimeout(4_000);

    // The info panel is a sheet below the hinge (MB-4); the sentiment bar lives
    // inside it.
    await page.getByRole('button', { name: 'INFO' }).click();
    await page.waitForTimeout(2_000);

    const bar = page.getByRole('button').filter({ hasText: /sentiment/i }).first();
    await expect(bar).toBeVisible({ timeout: 20_000 });
    await bar.click();
    await page.waitForTimeout(2_000);

    const m = await page.evaluate(() => {
      const box = Array.from(document.querySelectorAll('div')).find((d) =>
        (d.getAttribute('class') || '').includes('lg:w-[900px]'),
      );
      if (!box) return null;
      const r = box.getBoundingClientRect();
      const panes = Array.from(box.querySelectorAll(':scope > div'));
      return {
        frame: document.documentElement.clientWidth,
        visible: document.documentElement.clientHeight,
        width: Math.round(r.width),
        right: Math.round(r.right),
        chart: Math.round(box.querySelector('.recharts-wrapper')?.getBoundingClientRect().width || 0),
        panes: panes.length,
      };
    });
    expect(m, 'sentiment modal not found').not.toBeNull();

    expect(m!.right, `modal right edge ${m!.right} on a ${m!.frame}px screen`).toBeLessThanOrEqual(m!.frame + 1);
    expect(
      Math.round((m!.width / m!.frame) * 100),
      `modal is ${m!.width}px of a ${m!.frame}px screen`,
    ).toBeGreaterThanOrEqual(95);
    // The whole point: the chart pane is no longer the leftovers of a fixed
    // side column.
    expect(
      Math.round((m!.chart / m!.frame) * 100),
      `chart pane is ${m!.chart}px of a ${m!.frame}px screen`,
    ).toBeGreaterThanOrEqual(70);
  });

  // MB-6 · row 13. A wide table on a phone is only usable if the row keeps its
  // name while the numbers scroll past. Before this, the 1200px floor gave the
  // Name cell 706px of a 356px container and pushed Price off the edge, with
  // nothing pinned — scrolling to a price meant losing track of whose it was.
  test('row 13 — the identity column stays pinned while the row scrolls', async ({ page }, info) => {
    test.skip(info.project.name === 'tablet-768', 'the table fits unaided above the hinge');
    await settle(page, '/trading');

    await page.getByRole('button', { name: /see all/i }).first().click({ timeout: 30_000 });
    await page.waitForTimeout(3_000);

    const before = await page.evaluate(() => {
      const t = document.querySelector('table');
      const id = t?.querySelector('tbody tr td:nth-child(3)') as HTMLElement | null;
      if (!t || !id) return null;
      const cont = t.parentElement!;
      return {
        sticky: getComputedStyle(id).position,
        text: (id.textContent || '').trim().slice(0, 30),
        left: Math.round(id.getBoundingClientRect().left),
        maxScroll: cont.scrollWidth - cont.clientWidth,
      };
    });
    expect(before, 'market table not found').not.toBeNull();
    expect(before!.sticky, 'identity cell is not pinned').toBe('sticky');

    // Scroll as far as the table actually goes — asserting a fixed 600px would
    // fail for the right reason on a table that is now only 481px wide, which
    // is the improvement, not a regression.
    const after = await page.evaluate(() => {
      const t = document.querySelector('table')!;
      const cont = t.parentElement!;
      cont.scrollLeft = cont.scrollWidth;
      const id = t.querySelector('tbody tr td:nth-child(3)') as HTMLElement;
      const r = id.getBoundingClientRect();
      return {
        scrolled: Math.round(cont.scrollLeft),
        left: Math.round(r.left),
        right: Math.round(r.right),
        text: (id.textContent || '').trim().slice(0, 30),
        frame: document.documentElement.clientWidth,
      };
    });

    expect(after.scrolled, 'table did not scroll').toBeGreaterThan(0);
    expect(after.text, 'the row lost its identity when scrolled').toBe(before!.text);
    expect(
      after.right,
      `identity ends at ${after.right} on a ${after.frame}px screen after scrolling ${after.scrolled}px`,
    ).toBeGreaterThan(0);
    expect(after.left, 'identity scrolled off the left edge').toBeGreaterThanOrEqual(-1);
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

    // Row 5 — MB-5. The topbar carries more than a phone is wide: measured on
    // the TN asset view at 390px, the control rail holds 600px of content in a
    // 390px row. Rows 9 and 10 cannot see that, because an overflow-hidden
    // ancestor swallows it — the content is simply clipped and unreachable
    // rather than scrollable. So assert the two things that matter directly:
    // something in the topbar actually scrolls, and BUY is inside the viewport
    // at a real touch size.
    //
    // Note this runs on a TN asset, whose tab row is 3 tabs / 197px and fits
    // unaided; the 6-tab crypto row is the tighter case and is not covered here.
    const clipped = await page.evaluate(() => {
      // The topbar root is BUY's third ancestor: button -> CTA group -> row 1
      // -> root. Scoping to it keeps the check off the many legitimately
      // overflow-hidden decorative wrappers elsewhere on the page.
      const buy = Array.from(document.querySelectorAll('button')).find((b) =>
        /^BUY /.test((b.textContent || '').trim()),
      );
      const root = buy?.parentElement?.parentElement?.parentElement;
      if (!root) return ['topbar root not found'];
      return Array.from(root.querySelectorAll('div'))
        .filter((d) => {
          if (d.scrollWidth <= d.clientWidth + 1) return false;
          const o = getComputedStyle(d).overflowX;
          return o !== 'auto' && o !== 'scroll';
        })
        .map((d) => `${(d.className || '').toString().slice(0, 50)} ${d.clientWidth}<${d.scrollWidth}`);
    });
    // A row that fits needs no scroller; a row that does not fit must have one,
    // or its overflow is unreachable rather than merely off-screen. At 810px
    // the whole topbar fits and this list is empty for the right reason.
    expect(clipped, `topbar content clipped with no way to scroll to it`).toEqual([]);

    const buy = page.getByRole('button', { name: /^BUY / });
    await expect(buy).toBeVisible();
    const bb = (await buy.boundingBox())!;
    expect(Math.round(bb.x + bb.width), 'BUY is inside the viewport').toBeLessThanOrEqual(geom.frame + 1);
    expect(Math.round(bb.height), 'BUY target height').toBeGreaterThanOrEqual(44);

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
