// CF-8 gate. The trend chart used to cost two SERIAL round trips: fetch
// financials, read its newest fiscal year, then fetch longitudinal. Now the
// periods come from the calendar, so both go out together.
//
// Measures both shapes against the live API and asserts the page no longer
// contains the serial one.
import { readFileSync } from 'node:fs';

const ROOT = 'c:/Users/unicentrale/Downloads/antigravity';
const BASE = process.env.GRAVITY_BASE ?? 'https://gravity-api-prod.fly.dev';
const KEY = process.env.GRAVITY_API_KEY ?? 'deep-research-internal';
const TICKERS = (process.env.TICKERS ?? 'AAPL,NVDA,TSLA').split(',');

const src = readFileSync(`${ROOT}/apps/market-ui/src/pages/CompanyPage.tsx`, 'utf8');

let failures = 0;
const check = (name, cond, detail = '') => {
  if (!cond) failures++;
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${detail && !cond ? `\n      ${detail}` : ''}`);
};

const ms = async (url) => {
  const t0 = performance.now();
  const r = await fetch(url, { headers: { 'X-API-Key': KEY } });
  await r.text();
  return performance.now() - t0;
};

// The window the page now asks for, read from the page rather than retyped.
const span = Number(src.match(/LONGITUDINAL_SPAN = (\d+)/)[1]);
const newest = new Date().getFullYear() + 1;
const periods = Array.from({ length: span }, (_, i) => `FY${newest - span + 1 + i}`).join(',');

console.log(`span=${span}  periods=${periods}\n`);
console.log(`${'ticker'.padEnd(8)}${'serial'.padStart(10)}${'parallel'.padStart(10)}${'saved'.padStart(10)}`);

let totalSerial = 0, totalParallel = 0;
for (const t of TICKERS) {
  const fin = `${BASE}/v1/company/${t}/financials?limit=80`;
  const lon = `${BASE}/v1/analytics/longitudinal/${t}?metric=revenue&periods=${periods}`;

  // OLD shape: longitudinal cannot start until financials has landed.
  const a = await ms(fin);
  const b = await ms(lon);
  const serial = a + b;

  // NEW shape: both issued together, so the wall time is the slower of the two.
  const t0 = performance.now();
  await Promise.all([ms(fin), ms(lon)]);
  const parallel = performance.now() - t0;

  totalSerial += serial;
  totalParallel += parallel;
  console.log(`${t.padEnd(8)}${(serial / 1000).toFixed(2).padStart(9)}s${(parallel / 1000).toFixed(2).padStart(9)}s${((serial - parallel) / 1000).toFixed(2).padStart(9)}s`);
}

console.log(`\ntotal serial   ${(totalSerial / 1000).toFixed(2)}s`);
console.log(`total parallel ${(totalParallel / 1000).toFixed(2)}s`);
check('issuing both together is faster than issuing them in sequence', totalParallel < totalSerial,
  `serial ${(totalSerial / 1000).toFixed(2)}s vs parallel ${(totalParallel / 1000).toFixed(2)}s`);

// Wiring: the serial shape must be gone from the page, not merely unused.
check('longitudinal is issued inside the main batch',
  /fetchSurface\(\s*`\$\{GRAVITY_BASE\}\/v1\/analytics\/longitudinal/.test(src));
check('periods no longer come from the financials response',
  !/useEffect\([\s\S]{0,400}?metrics\.length === 0[\s\S]{0,600}?longitudinal/.test(src),
  'an effect keyed on `metrics` still fetches longitudinal');
check('no effect depends on [symbol, metrics]', !/\}, \[symbol, metrics\]\);/.test(src));
check('the period window is derived from the calendar', /revenuePeriods\(\)/.test(src));

console.log(`\nRESULT ${failures === 0 ? 'PASS' : `FAIL (${failures})`}`);
process.exit(failures === 0 ? 0 : 1);
