import { test, expect } from '@playwright/test';
import { readFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

// DD-14 · row 17. The ship gate.
//
// One live prod reply, rendered by the panel's own components under the CSS
// prod is serving, at the rail width the panel actually gets. Every DD in the
// ledger has to be visible in this one shot, and the shot has to stay legible.
const here = dirname(fileURLToPath(import.meta.url));
const CSS = join(here, 'fixtures', 'dexter-ship.css');
const HTML = join(here, 'fixtures', 'dexter-ship.html');
const RAIL = 420;

test.describe('DD-14 row 17 — the shipped panel, on the reply prod returned', () => {
  test.skip(!existsSync(CSS) || !existsSync(HTML), 'run scripts/capture-dexter-ship.mjs first');

  test.beforeEach(async ({ page }) => {
    await page.setViewportSize({ width: RAIL, height: 1000 });
    await page.setContent(
      `<!doctype html><html data-theme="dark"><head><style>${readFileSync(CSS, 'utf8')}</style>
       <style>html,body{margin:0;background:var(--bg)}#rail{width:${RAIL}px}</style></head>
       <body><div id="rail">${readFileSync(HTML, 'utf8')}</div></body></html>`,
      { waitUntil: 'load' },
    );
  });

  test('every citation marker is a reachable chip, none left as text', async ({ page }) => {
    const chips = page.locator('[data-cite-target]');
    await expect(chips).toHaveCount(38);
    // and each chip's target really exists in the evidence panel
    const dangling = await page.evaluate(() =>
      Array.from(document.querySelectorAll('[data-cite-target]'))
        .map((b) => b.getAttribute('data-cite-target')!)
        .filter((id) => !document.getElementById(id)).length,
    );
    expect(dangling).toBe(0);
    // No marker survives as literal text in the ANSWER. The source cards label
    // themselves `[1]`, `[11]` … — that is the card's own id, not a marker.
    await expect(page.locator('#rail > div > div.min-w-0')).not.toContainText(/\[\d+\]/);
  });

  test('the trust verdict renders its grade and every reason', async ({ page }) => {
    const strip = page.locator('[data-trust-grade]');
    await expect(strip).toHaveAttribute('data-trust-grade', 'B');
    await expect(strip).toContainText('80/100');
    await expect(strip).toContainText('1 round');
    await expect(strip.locator('li')).toHaveCount(4);
    await expect(strip).toContainText('33/33 figures sit in a cited sentence');
  });

  test('the levels ladder renders as a component, not as JSON', async ({ page }) => {
    await expect(page.locator('[data-dexter-block="levels"]')).toBeVisible();
    await expect(page.locator('#rail')).not.toContainText('"lastClose"');
  });

  test('the sources panel carries every citation, untruncated', async ({ page }) => {
    await expect(page.locator('[id^="dexter-cite-ship-"]')).toHaveCount(17);
    const clipped = await page.evaluate(() =>
      Array.from(document.querySelectorAll('[id^="dexter-cite-ship-"]'))
        .filter((el) => el.scrollWidth > el.clientWidth + 1).length,
    );
    expect(clipped).toBe(0);
  });

  test('a clean answer shows no fabricated banner and no uncited marks', async ({ page }) => {
    await expect(page.locator('[role="alert"]')).toHaveCount(0);
    await expect(page.locator('[data-uncited]')).toHaveCount(0);
  });

  test('the trace timeline lists every step with its real duration', async ({ page }) => {
    const timeline = page.locator('[data-trace-timeline]');
    await expect(timeline).toBeVisible();
    await expect(timeline.locator('[data-step-bar]')).toHaveCount(3);
    await expect(timeline).toContainText('21535ms');
    await expect(timeline).toContainText('deepseek/deepseek-v4-flash');
  });

  test('the panel body never scrolls sideways', async ({ page }) => {
    const { scrollWidth, clientWidth } = await page.evaluate(() => ({
      scrollWidth: document.documentElement.scrollWidth,
      clientWidth: document.documentElement.clientWidth,
    }));
    expect(scrollWidth).toBeLessThanOrEqual(clientWidth);
  });

  test('captures the ship shot', async ({ page }) => {
    await page.screenshot({ path: join(here, 'fixtures', 'dexter-ship.png'), fullPage: true });
  });
});
