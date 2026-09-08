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

// CF-9 split the page: the period window lives in surfaces.ts, the batch that
// uses it in useCompanyData.ts. Each assertion reads the file it grades.
const UI = `${ROOT}/apps/market-ui/src/components/company`;
const surfaces = readFileSync(`${UI}/surfaces.ts`, 'utf8');
const hook = readFileSync(`${UI}/useCompanyData.ts`, 'utf8');

let failures = 0;
const check = (name, cond, detail = '') => {
  if (!cond) failures++;
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${detail && !cond ? `\n      ${detail}` : ''}`);
};

// Timing a 404 is not a measurement. CF-10 moved the trend onto the company
// router, and the API this gate points at is frozen (Fly deploys are blocked), so
// without this check the gate happily "proved" that two 404s race faster than they
// queue. Every timed request must be a real 200 or the number is discarded.
const statuses = [];
const ms = async (url) => {
  const t0 = performance.now();
  const r = await fetch(url, { headers: { 'X-API-Key': KEY } });
  await r.text();
  statuses.push({ url, status: r.status });
  return performance.now() - t0;
};

// The window the page now asks for, read from the page rather than retyped.
const span = Number(surfaces.match(/LONGITUDINAL_SPAN = (\d+)/)[1]);
const newest = new Date().getFullYear() + 1;
const periods = Array.from({ length: span }, (_, i) => `FY${newest - span + 1 + i}`).join(',');

console.log(`span=${span}  periods=${periods}\n`);
console.log(`${'ticker'.padEnd(8)}${'serial'.padStart(10)}${'parallel'.padStart(10)}${'saved'.padStart(10)}`);

let totalSerial = 0, totalParallel = 0;
for (const t of TICKERS) {
  const fin = `${BASE}/v1/company/${t}/financials?limit=80`;
  const lon = `${BASE}/v1/company/${t}/trend?metric=revenue&periods=${periods}`;

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
const bad = statuses.filter(s => s.status !== 200);
check('every timed request actually answered 200', bad.length === 0,
  `${bad.length} of ${statuses.length} did not: `
  + [...new Set(bad.map(b => `${new URL(b.url).pathname} -> ${b.status}`))].join(', ')
  + `\n      A 404 here means the route is not deployed at ${BASE}, so the timing`
  + `\n      below measures nothing. Point GRAVITY_BASE at an API running this code.`);
check('issuing both together is faster than issuing them in sequence',
  bad.length === 0 && totalParallel < totalSerial,
  `serial ${(totalSerial / 1000).toFixed(2)}s vs parallel ${(totalParallel / 1000).toFixed(2)}s`);

// Wiring: the serial shape must be gone from the page, not merely unused.
// CF-10 moved this onto the company router; the assertion follows the URL the
// page actually calls, and still grades that the trend is issued in the batch.
check('the trend request is issued inside the main batch',
  /fetchSurface\(\s*`\$\{GRAVITY_BASE\}\/v1\/company\/\$\{symbol\}\/trend/.test(hook));
check('periods no longer come from the financials response',
  !/useEffect\([\s\S]{0,400}?metrics\.length === 0[\s\S]{0,600}?longitudinal/.test(hook),
  'an effect keyed on `metrics` still fetches longitudinal');
check('no effect depends on [symbol, metrics]', !/\}, \[symbol, metrics\]\);/.test(hook));
check('the period window is derived from the calendar', /revenuePeriods\(\)/.test(hook));

console.log(`\nRESULT ${failures === 0 ? 'PASS' : `FAIL (${failures})`}`);
process.exit(failures === 0 ? 0 : 1);
