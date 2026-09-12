// V3-5 gate. A failed trend is a failure, not an empty chart.
//
// useCompanyData named four surfaces in its `failures` list — overview, quote,
// filings, XBRL financials. The trend request sits in the SAME Promise.allSettled
// and was not one of them, so a 503 on /trend produced `longitudinal: []` and no
// entry in failedSurfaces: an empty chart, which is exactly what a company that
// reported nothing also looks like. CT-7 row 9 exists so those two never look
// alike.
//
// Behavioural on surfaceFailure (the real function, compiled and called) plus a
// structural check that the hook actually passes `lon` to it.
//
// Run from anywhere:  node docs/company-feature/gates/v3-5-gate.mjs
import { readFileSync, mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

const root = new URL('../../../', import.meta.url);
const read = (p) => readFileSync(new URL(p, root), 'utf8').replace(/\r\n/g, '\n');
const win = (u) => new URL(u, root).pathname.replace(/^\/([A-Za-z]:)/, '$1');

let failures = 0;
const check = (name, ok, detail = '') => {
    if (!ok) failures++;
    console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail && !ok ? `\n      ${detail}` : ''}`);
};

// ─── the real surfaceFailure ────────────────────────────────────────────────
const dir = mkdtempSync(join(tmpdir(), 'v3-5-'));
let surfaces;
try {
    const esbuild = await import(pathToFileURL(win('node_modules/esbuild/lib/main.js')).href);
    // surfaces.ts imports the app's env/config for GRAVITY_BASE; only the pure
    // result helpers are under test, so they are sliced out by name.
    const src = read('apps/market-ui/src/components/company/surfaces.ts');
    const start = src.indexOf('export function surfaceFailure');
    const end = src.indexOf('export async function withLoading');
    if (start < 0 || end < 0) throw new Error('surfaceFailure/withLoading not found in surfaces.ts');
    writeFileSync(join(dir, 'package.json'), JSON.stringify({ type: 'module' }));
    writeFileSync(join(dir, 's.js'),
        esbuild.transformSync(src.slice(start, end), { loader: 'ts', format: 'esm' }).code);
    surfaces = await import(pathToFileURL(join(dir, 's.js')).href);
} catch (e) {
    console.log(`FAIL  surfaces.ts could not be compiled and loaded\n      ${e.message}`);
    rmSync(dir, { recursive: true, force: true });
    process.exit(1);
}
const { surfaceFailure } = surfaces;

const settled = (v) => ({ status: 'fulfilled', value: v });

check('a 503 on the trend is reported as a server error',
    surfaceFailure('Revenue trend', settled({ ok: false, status: 503 }))
        === 'Revenue trend — server error (503)',
    `got ${JSON.stringify(surfaceFailure('Revenue trend', settled({ ok: false, status: 503 })))}`);

check('a 401 on the trend reads as sign-in, not as missing data',
    surfaceFailure('Revenue trend', settled({ ok: false, status: 401 }))
        === 'Revenue trend — sign in to view');

check('a rejected trend request is reported',
    surfaceFailure('Revenue trend', { status: 'rejected', reason: new Error('boom') })
        === 'Revenue trend — request failed');

check('a well-formed EMPTY trend is NOT a failure',
    surfaceFailure('Revenue trend', settled({ ok: true, data: { data_points: [] } })) === null,
    'an honest empty series was reported as a fault');

// ─── the hook actually routes `lon` through it ──────────────────────────────
const stripComments = (s) => s
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '');
const hook = stripComments(read('apps/market-ui/src/components/company/useCompanyData.ts'));

const listMatch = hook.match(/const failures = \[([\s\S]*?)\]\.filter/);
check('the failures list is still assembled in one place', Boolean(listMatch),
    'the `const failures = [...]` block was not found');

const list = listMatch?.[1] ?? '';
check('the trend surface is named in the failures list',
    /surfaceFailure\(\s*['"][^'"]*[Tt]rend[^'"]*['"]\s*,\s*lon\s*\)/.test(list),
    `\`lon\` is not passed to surfaceFailure. The list holds:\n      ${list.trim().replace(/\n\s*/g, ' ')}`);

check('all five settled surfaces are checked, not four',
    (list.match(/surfaceFailure\(/g) || []).length === 5,
    `${(list.match(/surfaceFailure\(/g) || []).length} surfaces are checked; the allSettled has five`);

check('the trend is still fetched in the same parallel batch',
    /Promise\.allSettled\(\[[\s\S]*?\/trend\?/.test(hook),
    'the trend request left the parallel batch — this gate assumes it is the fifth entry');

rmSync(dir, { recursive: true, force: true });
console.log(`\nRESULT ${failures === 0 ? 'PASS' : `FAIL (${failures})`}`);
process.exit(failures === 0 ? 0 : 1);
