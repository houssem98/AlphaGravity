import { test, expect } from '@playwright/test';
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

// MB-2 · row 18 — the desktop no-op guard.
//
// Row 18 originally said "pixel-identical screenshot". That is unachievable
// here and would have been a permanently red gate: every route on this alias
// renders live market data, so two runs a minute apart differ in hundreds of
// price cells with no layout change whatsoever. Masking every dynamic cell on
// ten routes is more selector surface than the app.
//
// What row 18 actually protects is "the desktop LAYOUT did not move". So the
// baseline is layout geometry — the x-offset and width of every structural
// landmark, plus how many of each there are. That is invariant to price ticks
// and to row counts, and it moves the instant a rail collapses, a column
// re-flows, a panel restacks, or a breakpoint fires early. It is a sharper
// instrument for this specific question than a screenshot, not a weaker one.
//
// Heights are recorded but NOT asserted: a table that gained four rows is data,
// not layout.
//
// Screenshots are still written, as human-reviewable artifacts. They are not
// the gate.
const here = dirname(fileURLToPath(import.meta.url));
const DIR = join(here, 'baselines');
const SHOTS = join(DIR, 'shots');

const UPDATE = process.env.MB_BASELINE_UPDATE === '1';

const ROUTES = [
  '/', '/auth', '/search', '/trading', '/companies',
  '/history', '/dashboard', '/documents', '/settings', '/billing',
] as const;

// Structural landmarks only. Never content elements — those legitimately move
// with the data and would make this gate cry wolf.
//
// The last selector is not decoration: /trading builds its three columns from
// plain divs sized by inline style (`style={{ width: leftW }}`,
// TradingAssistantPage.tsx:567,674), so the semantic selectors see only the
// rail and catch nothing when MB-4 restacks the panels. Anything width-pinned
// by inline style IS the layout on that page.
const LANDMARKS = [
  'aside', 'header', 'nav', 'main', 'table', 'form', 'footer',
  '[style*="width:"]',
];

const slug = (p: string) => (p === '/' ? 'root' : p.replace(/^\//, '').replace(/\//g, '-'));

type Frame = { sel: string; i: number; x: number; w: number; h: number };

async function capture(page: import('@playwright/test').Page): Promise<Frame[]> {
  return page.evaluate((sels) => {
    const out: Frame[] = [];
    for (const sel of sels) {
      Array.from(document.querySelectorAll(sel)).forEach((el, i) => {
        const r = el.getBoundingClientRect();
        if (r.width === 0 && r.height === 0) return;
        // The inline-width selector also matches sparklines and chips inside
        // market cards, whose COUNT tracks the data and would make this gate
        // flap. Only panel-scale boxes are layout.
        if (sel.startsWith('[style') && r.width < 200) return;
        out.push({ sel, i, x: Math.round(r.x), w: Math.round(r.width), h: Math.round(r.height) });
      });
    }
    return out;
  }, LANDMARKS);
}

async function settle(page: import('@playwright/test').Page) {
  await page.waitForLoadState('networkidle', { timeout: 45_000 }).catch(() => {});
  await page.waitForTimeout(2_000);
}

function compare(base: Frame[], now: Frame[]): string[] {
  // The comparison is over the SET of distinct positions, not per-index.
  //
  // Indexing by ordinal leaks the item count into the gate: /history renders a
  // three-column card grid, and when the account's list shrank between runs,
  // eight cards at the same three x-offsets "disappeared" and failed a route
  // whose layout had not moved a pixel. Row counts are data.
  //
  // A set still catches every layout regression this loop can cause — a column
  // that moves, resizes, restacks, or vanishes changes which distinct positions
  // exist. Only the multiplicity is discarded.
  //
  // Heights are recorded but not compared; a taller table is data too.
  const geom = (f: Frame) => `${f.sel} x=${f.x} w=${f.w}`;
  const a = new Set(base.map(geom));
  const b = new Set(now.map(geom));
  const moved: string[] = [];
  for (const k of a) if (!b.has(k)) moved.push(`gone: ${k}`);
  for (const k of b) if (!a.has(k)) moved.push(`new:  ${k}`);
  return moved;
}

function check(name: string, frames: Frame[]) {
  const file = join(DIR, `desktop-${name}.json`);
  if (UPDATE || !existsSync(file)) {
    writeFileSync(file, JSON.stringify(frames, null, 2) + '\n');
    test.info().annotations.push({ type: 'baseline', description: `wrote ${frames.length} landmarks for ${name}` });
    return;
  }
  const moved = compare(JSON.parse(readFileSync(file, 'utf8')), frames);
  expect(moved, `${name}: ${moved.length} desktop landmark(s) moved`).toEqual([]);
}

test.describe('row 18 — desktop layout is unchanged at 1440px', () => {
  test.beforeAll(() => {
    mkdirSync(DIR, { recursive: true });
    mkdirSync(SHOTS, { recursive: true });
  });

  for (const path of ROUTES) {
    test(`${path} — landmark geometry matches the baseline`, async ({ page }) => {
      await page.goto(path, { waitUntil: 'domcontentloaded', timeout: 60_000 });
      await settle(page);

      const frames = await capture(page);
      await page.screenshot({ path: join(SHOTS, `${slug(path)}.png`) }).catch(() => {});
      check(slug(path), frames);
    });
  }

  // /trading at rest is the market hub. The three-column asset view — the
  // 288px + 300px panels MB-4 restacks, fault F1 — is one click deeper, so a
  // bare route load would guard nothing on the page this loop changes most.
  // Navigation idiom borrowed from hubAssetMarket.spec.ts:12-19.
  test('/trading asset view — landmark geometry matches the baseline', async ({ page }) => {
    await page.goto('/trading', { waitUntil: 'domcontentloaded', timeout: 60_000 });
    await settle(page);

    const card = page.locator('div').filter({ hasText: /^Tunisian Market/ }).first();
    const stock = card.getByRole('button').nth(1);
    await expect(stock).toBeVisible({ timeout: 30_000 });
    const symbol = (await stock.locator('span').first().innerText()).trim();
    await stock.click();
    await expect(page.getByRole('button', { name: `BUY ${symbol}` })).toBeVisible({ timeout: 30_000 });
    await settle(page);

    const frames = await capture(page);
    await page.screenshot({ path: join(SHOTS, 'trading-asset.png') }).catch(() => {});
    check('trading-asset', frames);
  });
});
