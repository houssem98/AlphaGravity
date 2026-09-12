// V3-1 gate. A margin is never labelled as a profit, nor drawn in dollars.
//
// LatestQuarterCard.tsx:14 matched `/^Gross Profit|Gross margin/i` under the
// label "Gross Profit", :57 sent every non-EPS value through money(), and :61
// stamped unit 'USD' from the row's POSITION in HEADLINE. A filer reporting
// `Gross margin  45 %` rendered as `Gross Profit  $45`, and a 45→40 move printed
// as +12.5% rather than -5pp.
//
// Behavioural: the real computeQuarterRows is compiled and called.
//
// Run from anywhere:  node docs/company-feature/gates/v3-1-gate.mjs
import { readFileSync, mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';

const root = new URL('../../../', import.meta.url);
const read = (p) => readFileSync(new URL(p, root), 'utf8').replace(/\r\n/g, '\n');

let failures = 0;
const check = (name, ok, detail = '') => {
    if (!ok) failures++;
    console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail && !ok ? `\n      ${detail}` : ''}`);
};

// ─── compile the two real modules, then call the real function ──────────────
// The card is TSX, but computeQuarterRows and everything it reaches are pure TS.
// Strip the JSX component and the React import, transpile the rest, and run it —
// so this gate grades the shipped logic and not a copy of it.
const dir = mkdtempSync(join(tmpdir(), 'v3-1-'));
let mod;
try {
    const srcCard = read('apps/market-ui/src/components/company/LatestQuarterCard.tsx');
    const cut = srcCard.indexOf('export default function LatestQuarterCard');
    if (cut < 0) throw new Error('LatestQuarterCard default export not found');
    const logic = srcCard.slice(0, cut)
        .replace(/^import .*?from '\.\.\/\.\.\/lib\/figures';$/m,
            "import { formatFinancialValue, NULL_MARK } from './figures.js';")
        .replace(/^import .*?from '\.\.\/\.\.\/lib\/periods';$/gm,
            "import { selectComparablePeriods } from './periods.js';")
        .replace(/^import type .*?from '\.\.\/\.\.\/lib\/periods';$/gm, '');

    const esbuild = await import(pathToFileURL(
        join(new URL('node_modules/esbuild/lib/main.js', root).pathname.replace(/^\/([A-Za-z]:)/, '$1')),
    ).href);
    const strip = (code) => esbuild.transformSync(code, { loader: 'ts', format: 'esm' }).code;

    for (const [name, rel] of [
        ['figures.js', 'apps/market-ui/src/lib/figures.ts'],
        ['periods.js', 'apps/market-ui/src/lib/periods.ts'],
    ]) writeFileSync(join(dir, name), strip(read(rel)));
    writeFileSync(join(dir, 'card.js'), strip(logic));
    writeFileSync(join(dir, 'package.json'), JSON.stringify({ type: 'module' }));

    mod = await import(pathToFileURL(join(dir, 'card.js')).href);
} catch (e) {
    console.log(`FAIL  the card's logic could not be compiled and loaded\n      ${e.message}`);
    rmSync(dir, { recursive: true, force: true });
    process.exit(1);
}
const { computeQuarterRows } = mod;

// ─── the audit's fixture, verbatim ──────────────────────────────────────────
const marginOnly = [
    { metric: 'Gross margin', value: 45, unit: '%', period: 'Q2 FY2026' },
    { metric: 'Gross margin', value: 40, unit: '%', period: 'Q1 FY2026' },
];
const out = computeQuarterRows(marginOnly);
check('a margin-only fixture still produces a card', out !== null,
    'computeQuarterRows returned null for two valid percent rows');

const rows = out?.rows ?? [];
const byLabel = (l) => rows.find(r => r.label === l);

check('no row is labelled "Gross Profit" for a margin fact',
    !byLabel('Gross Profit'),
    `a margin was rendered under the label Gross Profit: ${JSON.stringify(byLabel('Gross Profit'))}`);

const gm = byLabel('Gross Margin');
check('the margin appears under a margin label', Boolean(gm),
    `labels present: ${rows.map(r => r.label).join(', ') || '(none)'}`);

check('the row carries the unit the fact carried, not USD',
    gm?.unit === '%', `unit was ${JSON.stringify(gm?.unit)}`);

check('the current value renders as a percentage, with no dollar sign',
    gm?.cur === '45.0%', `rendered ${JSON.stringify(gm?.cur)}`);
check('the prior value renders as a percentage, with no dollar sign',
    gm?.prev === '40.0%', `rendered ${JSON.stringify(gm?.prev)}`);

check('45% against 40% is +5 POINTS, not +12.5 percent',
    gm?.delta !== null && Math.abs((gm?.delta ?? NaN) - 5) < 1e-9 && gm?.deltaUnit === 'pp',
    `delta ${gm?.delta} ${gm?.deltaUnit} — a relative change on a figure already in percent`);

// ─── a real money row is unchanged ──────────────────────────────────────────
const usd = computeQuarterRows([
    { metric: 'Revenue (Total Revenue, Net Sales)', value: 391035000000, unit: 'USD', period: 'FY2025' },
    { metric: 'Revenue (Total Revenue, Net Sales)', value: 383285000000, unit: 'USD', period: 'FY2024' },
]);
const rev = usd?.rows.find(r => r.label === 'Revenue');
check('a USD row still renders as money', rev?.cur === '$391.04B', `rendered ${JSON.stringify(rev?.cur)}`);
check('a USD row still reports a relative change in percent',
    rev?.deltaUnit === '%' && Math.abs((rev?.delta ?? NaN) - 2.0220) < 1e-3,
    `delta ${rev?.delta} ${rev?.deltaUnit}`);

// ─── a gross PROFIT is still a gross profit ─────────────────────────────────
const profit = computeQuarterRows([
    { metric: 'Gross Profit', value: 180683000000, unit: 'USD', period: 'FY2025' },
    { metric: 'Gross Profit', value: 169148000000, unit: 'USD', period: 'FY2024' },
]);
check('a real Gross Profit still renders under Gross Profit, in dollars',
    profit?.rows.find(r => r.label === 'Gross Profit')?.cur === '$180.68B',
    `rendered ${JSON.stringify(profit?.rows.find(r => r.label === 'Gross Profit')?.cur)}`);

// ─── a fact with NO unit does not acquire one ───────────────────────────────
const unitless = computeQuarterRows([
    { metric: 'Revenue', value: 1234, period: 'FY2025' },
]);
const ur = unitless?.rows.find(r => r.label === 'Revenue');
check('a unit-less fact keeps a null unit', ur?.unit === null, `unit was ${JSON.stringify(ur?.unit)}`);
check('a unit-less fact renders without a dollar sign',
    typeof ur?.cur === 'string' && !ur.cur.includes('$'), `rendered ${JSON.stringify(ur?.cur)}`);

// ─── two facts on different units are never differenced ─────────────────────
const mixedUnits = computeQuarterRows([
    { metric: 'Gross margin', value: 45, unit: '%', period: 'FY2025' },
    { metric: 'Gross margin', value: 40000000, unit: 'USD', period: 'FY2024' },
]);
const mu = mixedUnits?.rows.find(r => r.label === 'Gross Margin');
check('a delta is not drawn across two different units',
    mu?.delta === null, `delta ${mu?.delta} across % and USD`);

// ─── the source itself no longer carries the defect ─────────────────────────
// Comments are stripped first: this ledger's comments QUOTE the code they
// replaced, and a check that reads them grades the prose instead of the program.
const stripComments = (s) => s
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '')
    .replace(/\{\s*\/\*[\s\S]*?\*\/\s*\}/g, '');
const src = stripComments(read('apps/market-ui/src/components/company/LatestQuarterCard.tsx'));
check('the Gross Profit matcher no longer swallows "Gross margin"',
    !/\{\s*label:\s*'Gross Profit',\s*match:\s*\/\^Gross Profit\|Gross margin/.test(src),
    'HEADLINE still maps a margin onto the Gross Profit label');
check('the card no longer stamps a unit from the row position',
    !src.includes("unit: isEps ? 'USD/share' : 'USD'"),
    'the positional unit assignment is still there');

rmSync(dir, { recursive: true, force: true });
console.log(`\nRESULT ${failures === 0 ? 'PASS' : `FAIL (${failures})`}`);
process.exit(failures === 0 ? 0 : 1);
