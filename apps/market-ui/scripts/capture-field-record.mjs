// MF-1 · row R3 of docs/MOBILE_FIELD_ROADMAP.md — the field record.
//
// Ten routes x two orientations, shot against the live alias, with the three
// numbers this ledger argues about printed per shot: the CSS viewport the page
// actually got, how far the document overflows it, and how many elements are
// painting over another element's text.
//
//   node scripts/capture-field-record.mjs            (both orientations)
//   node scripts/capture-field-record.mjs portrait   (one)
//
// Node strips the types out of ../src/lib/overpaint.ts on import; that module
// is the same instrument e2e/mobileField.spec.ts uses, never a copy of it.
import { chromium, devices } from '@playwright/test';
import { readFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { collectPaintBoxes, overpaintPairs } from '../src/lib/overpaint.ts';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = join(root, '..', '..', 'docs', 'mobile', 'field');
mkdirSync(OUT, { recursive: true });

const BASE = process.env.E2E_BASE_URL || 'https://market-ui-self.vercel.app';
const ROUTES = [
    '/', '/auth', '/search', '/trading', '/companies',
    '/history', '/dashboard', '/documents', '/settings', '/billing',
];

// §5 N and LS. The device reports 360x780 portrait / 788x360 landscape at
// devicePixelRatio 2 — see §8 for how those numbers were obtained.
const ORIENTATIONS = {
    portrait: { width: 360, height: 780 },
    landscape: { width: 788, height: 360 },
};

const want = process.argv[2];
const runs = Object.entries(ORIENTATIONS).filter(([k]) => !want || k === want);

const browser = await chromium.launch();
const rows = [];

for (const [orientation, viewport] of runs) {
    const ctx = await browser.newContext({
        ...devices['Desktop Chrome'],
        viewport,
        isMobile: true,
        hasTouch: true,
        deviceScaleFactor: 2,
        storageState: JSON.parse(readFileSync(join(root, 'e2e', '.auth', 'user.json'), 'utf8')),
    });
    const page = await ctx.newPage();

    for (const route of ROUTES) {
        await page.goto(BASE + route, { waitUntil: 'domcontentloaded', timeout: 60_000 });
        await page.waitForLoadState('networkidle', { timeout: 45_000 }).catch(() => {});
        await page.waitForTimeout(3_000);

        const geom = await page.evaluate(() => {
            const de = document.documentElement;
            return { w: de.clientWidth, h: de.clientHeight, over: de.scrollWidth - de.clientWidth };
        });
        const boxes = await page.evaluate(collectPaintBoxes, 'body');
        const pairs = overpaintPairs(boxes);
        const numeric = pairs.filter((p) => p.numeral);

        const name = route === '/' ? 'root' : route.replace(/^\//, '').replace(/\//g, '-');
        const file = `${name}-${orientation}.png`;
        await page.screenshot({ path: join(OUT, file) });

        const row = {
            orientation,
            route,
            client: `${geom.w}x${geom.h}`,
            overflow: geom.over,
            boxes: boxes.length,
            overpaint: pairs.length,
            overpaintNumeric: numeric.length,
            worst: numeric[0] || pairs[0] || null,
            file,
        };
        rows.push(row);
        console.log(
            `${orientation.padEnd(9)} ${route.padEnd(12)} ${row.client.padEnd(9)} ` +
            `overflow ${String(row.overflow).padStart(4)}px  ` +
            `overpaint ${String(row.overpaint).padStart(3)} (${row.overpaintNumeric} numeric)` +
            (row.worst ? `  worst: ${row.worst.over} over "${row.worst.covered}"` : ''),
        );
    }
    await ctx.close();
}

writeFileSync(join(OUT, 'record.json'), JSON.stringify({ base: BASE, at: new Date().toISOString(), rows }, null, 2));
console.log(`\n${rows.length} shots -> ${OUT}`);
await browser.close();
