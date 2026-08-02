// MB-15 · one screenshot per route at 390px, the shipped record for the ledger.
//   node scripts/capture-mobile-record.mjs
import { chromium, devices } from '@playwright/test';
import { readFileSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = join(root, '..', '..', 'docs', 'mobile');
mkdirSync(OUT, { recursive: true });

const ROUTES = [
  '/', '/auth', '/search', '/trading', '/companies/AAPL',
  '/history', '/dashboard', '/documents', '/settings', '/billing',
];

const b = await chromium.launch();
const ctx = await b.newContext({
  ...devices['iPhone 14'],
  storageState: JSON.parse(readFileSync(join(root, 'e2e', '.auth', 'user.json'), 'utf8')),
});
const p = await ctx.newPage();

for (const route of ROUTES) {
  await p.goto('https://market-ui-self.vercel.app' + route, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await p.waitForLoadState('networkidle', { timeout: 45000 }).catch(() => {});
  await p.waitForTimeout(3500);

  const name = route === '/' ? 'root' : route.replace(/^\//, '').replace(/\//g, '-');
  const overflow = await p.evaluate(() => {
    const de = document.documentElement;
    return { over: de.scrollWidth - de.clientWidth, w: de.clientWidth };
  });
  await p.screenshot({ path: join(OUT, `${name}-390.png`) });
  console.log(`${route.padEnd(18)} ${overflow.w}px  overflow ${overflow.over}px`);
}

await b.close();
