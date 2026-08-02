// MB-14 · renders the app mark to the PNG sizes iOS and Android require.
//
// Playwright is already a dev dependency and can rasterise an SVG, so this adds
// no image toolchain. Re-run after any change to public/icon.svg:
//   node scripts/make-icons.mjs
import { chromium } from '@playwright/test';
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const svg = readFileSync(join(root, 'public', 'icon.svg'), 'utf8');

// --accent / --accent-ink, matching public/icon.svg. A manifest icon cannot
// read a CSS variable; keep these in step with src/index.css:15-31.
const ACCENT = '#5898F6';

const TARGETS = [
  // Android / Chrome install prompt. Transparent outside the rounded square so
  // the corners are the mark's own, not a hard bounding box.
  { file: 'icon-192.png', size: 192, maskable: false, transparent: true },
  { file: 'icon-512.png', size: 512, maskable: false, transparent: true },
  // Maskable: Android crops to a platform shape, so the glyph has to survive a
  // circle of 80% diameter. Full-bleed background, mark shrunk into the safe
  // zone — the rounded-square version would have its corners sliced off.
  { file: 'icon-maskable-512.png', size: 512, maskable: true },
  // iOS home screen. Must be opaque: iOS composites transparency onto black.
  { file: 'apple-touch-icon.png', size: 180, maskable: false, transparent: false },
];

const browser = await chromium.launch();
const page = await browser.newPage();

for (const { file, size, maskable, transparent } of TARGETS) {
  const inner = maskable
    ? `<div style="width:${size}px;height:${size}px;background:${ACCENT};display:flex;align-items:center;justify-content:center">
         <div style="width:${Math.round(size * 0.58)}px;height:${Math.round(size * 0.58)}px">${svg.replace(
           /<rect[^>]*\/>/,
           '',
         )}</div>
       </div>`
    : `<div style="width:${size}px;height:${size}px">${svg}</div>`;

  await page.setViewportSize({ width: size, height: size });
  await page.setContent(
    `<!doctype html><html><head><style>
       html,body{margin:0;padding:0;background:${transparent ? 'transparent' : ACCENT}}
       svg{display:block;width:100%;height:100%}
     </style></head><body>${inner}</body></html>`,
    { waitUntil: 'load' },
  );
  const buf = await page.screenshot({ omitBackground: !!transparent });
  writeFileSync(join(root, 'public', file), buf);
  console.log(`${file.padEnd(24)} ${size}x${size}${maskable ? '  (maskable)' : ''}`);
}

await browser.close();
