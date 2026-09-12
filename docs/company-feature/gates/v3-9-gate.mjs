// V3-9 gate. One axis carries one unit.
//
// CompanyPage built the secondary bar chart from the first eight numeric metrics
// irrespective of unit, keyed on `m.period`, and OverviewTab drew them as one bar
// series on one Y axis. Revenue in dollars, EPS per share and a margin in percent
// landed on the same scale — and since those eight rows are typically all from
// the SAME period, under eight identical X labels. A shared axis is a claim that
// the bars are comparable.
//
// Behavioural: the real chartGroupFor is compiled and called.
//
// Run from anywhere:  node docs/company-feature/gates/v3-9-gate.mjs
import { readFileSync, mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

const root = new URL('../../../', import.meta.url);
const read = (p) => readFileSync(new URL(p, root), 'utf8').replace(/\r\n/g, '\n');
const win = (u) => new URL(u, root).pathname.replace(/^\/([A-Za-z]:)/, '$1');
const strip = (s) => s
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '')
    .replace(/\{\s*\/\*[\s\S]*?\*\/\s*\}/g, '');

let failures = 0;
const check = (name, ok, detail = '') => {
    if (!ok) failures++;
    console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail && !ok ? `\n      ${detail}` : ''}`);
};

const dir = mkdtempSync(join(tmpdir(), 'v3-9-'));
let chartGroupFor;
try {
    const esbuild = await import(pathToFileURL(win('node_modules/esbuild/lib/main.js')).href);
    const src = read('apps/market-ui/src/components/company/chartGroup.ts')
        .replace(/^import type .*$/gm, '');
    writeFileSync(join(dir, 'package.json'), JSON.stringify({ type: 'module' }));
    writeFileSync(join(dir, 'g.js'), esbuild.transformSync(src, { loader: 'ts', format: 'esm' }).code);
    ({ chartGroupFor } = await import(pathToFileURL(join(dir, 'g.js')).href));
} catch (e) {
    console.log(`FAIL  chartGroup.ts could not be compiled and loaded\n      ${e.message}`);
    rmSync(dir, { recursive: true, force: true });
    process.exit(1);
}

// ─── the audit's fixture ────────────────────────────────────────────────────
const mixed = [
    { metric: 'Revenue (Total Revenue, Net Sales)', value: 100e9, unit: 'USD', period: 'FY2025' },
    { metric: 'Net Income', value: 25e9, unit: 'USD', period: 'FY2025' },
    { metric: 'Earnings Per Share (EPS) Diluted', value: 5, unit: 'USD/shares', period: 'FY2025' },
    { metric: 'Gross margin', value: 45, unit: '%', period: 'FY2025' },
];
const g = chartGroupFor(mixed);
check('a mixed-unit set still produces a chart', g !== null);

const units = new Set(mixed.filter(m => g.data.some(d => d.label === m.metric)).map(m => m.unit));
check('every bar drawn shares ONE unit', units.size === 1,
    `the series mixes ${[...units].join(', ')} on one axis`);

check('the chart states the unit it is drawing', g?.unit === 'USD',
    `unit was ${JSON.stringify(g?.unit)}`);
check('the chart states the period it is drawing', g?.period === 'FY2025',
    `period was ${JSON.stringify(g?.period)}`);
check('the dollar metrics are the ones drawn', g?.data.length === 2,
    `${g?.data.length} bars: ${g?.data.map(d => d.label).join(', ')}`);
check('what was left out is counted, not hidden', g?.omitted === 2,
    `omitted was ${g?.omitted}`);

check('the X axis identifies the METRIC, not the period',
    g?.data.every(d => d.name !== d.label.match(/FY\d{4}/)?.[0] && !/^FY\d{4}$/.test(d.name)),
    `X labels were ${JSON.stringify(g?.data.map(d => d.name))}`);
check('the X labels are distinct',
    new Set(g?.data.map(d => d.name)).size === g?.data.length,
    `duplicate X labels: ${JSON.stringify(g?.data.map(d => d.name))}`);
check('the tooltip label keeps the full metric name',
    g?.data.some(d => d.label.includes('(')),
    'the verbose XBRL name was lost, so the tooltip cannot disambiguate');

// ─── one period at a time ───────────────────────────────────────────────────
const twoPeriods = chartGroupFor([
    { metric: 'Revenue', value: 100e9, unit: 'USD', period: 'FY2025' },
    { metric: 'Net Income', value: 25e9, unit: 'USD', period: 'FY2025' },
    { metric: 'Revenue', value: 90e9, unit: 'USD', period: 'FY2024' },
]);
check('two periods are never drawn as one series',
    twoPeriods?.data.length === 2 && twoPeriods.period === 'FY2025',
    `drew ${twoPeriods?.data.length} bars for period ${twoPeriods?.period}`);
check('the other period is counted as omitted', twoPeriods?.omitted === 1,
    `omitted was ${twoPeriods?.omitted}`);

// ─── a unit-less group says so rather than assuming USD ─────────────────────
const bare = chartGroupFor([
    { metric: 'Something', value: 5, period: 'FY2025' },
    { metric: 'Something Else', value: 6, period: 'FY2025' },
]);
check('a unit-less group reports a null unit, not USD', bare?.unit === null,
    `unit was ${JSON.stringify(bare?.unit)}`);

// ─── units containing spaces and slashes survive the grouping key ───────────
const perShare = chartGroupFor([
    { metric: 'EPS Basic', value: 5, unit: 'USD/shares', period: 'Q4 2025' },
    { metric: 'EPS Diluted', value: 4.9, unit: 'USD/shares', period: 'Q4 2025' },
    { metric: 'Revenue', value: 1e9, unit: 'USD', period: 'Q4 2025' },
]);
check('a unit with a slash and a period with a space group correctly',
    perShare?.unit === 'USD/shares' && perShare.period === 'Q4 2025' && perShare.data.length === 2,
    `unit ${JSON.stringify(perShare?.unit)}, period ${JSON.stringify(perShare?.period)}, ${perShare?.data.length} bars`);

// ─── nothing numeric means no chart ─────────────────────────────────────────
check('an empty metric set draws nothing', chartGroupFor([]) === null);
check('a non-numeric metric set draws nothing',
    chartGroupFor([{ metric: 'X', value: 'n/a', period: 'FY2025' }]) === null);

// ─── the cap still holds ────────────────────────────────────────────────────
const many = chartGroupFor(Array.from({ length: 20 }, (_, i) => (
    { metric: `M${i}`, value: i + 1, unit: 'USD', period: 'FY2025' })));
check('at most eight bars are drawn', many?.data.length === 8, `${many?.data.length} bars`);
check('the rest are counted as omitted', many?.omitted === 12, `omitted was ${many?.omitted}`);

// ─── the render consumes it, and formats in that unit ───────────────────────
const tab = strip(read('apps/market-ui/src/components/company/OverviewTab.tsx'));
check('OverviewTab takes the group rather than a bare array',
    /chartGroup: ChartGroup \| null;/.test(tab),
    'the component still accepts an un-united chartData array');
check('the Y axis formats through the unit-aware formatter',
    /tickFormatter=\{fmtChart\}/.test(tab),
    'the axis renders raw numbers again');
check('the tooltip formats through the same formatter',
    /formatter=\{\(v: number, _n, p\) => \[fmtChart\(v\)/.test(tab),
    'the tooltip and the axis disagree about the unit');
check('the formatter is bound to THIS chart\'s unit',
    /formatFinancialValue\(v, chartGroup\?\.unit \?\? undefined\)/.test(tab),
    'fmtChart does not read the group unit');
check('the header names the unit and the period',
    /\{chartGroup\.period\}[\s\S]{0,40}\{chartGroup\.unit \?\? 'unit not stated'\}/.test(tab),
    'the chart header does not state what the axis means');
check('omitted facts are disclosed to the reader',
    /\{chartGroup\.omitted\}/.test(tab),
    'metrics on other units are dropped silently');

const page = strip(read('apps/market-ui/src/pages/CompanyPage.tsx'));
check('the page no longer slices metrics itself',
    !/metrics\s*\n?\s*\.filter\(m => typeof m\.value === 'number' && m\.period\)\s*\n?\s*\.slice\(0, 8\)/.test(page),
    'the old unit-blind chartData construction is still in the page');
check('the page uses the shared grouping function',
    /const chartGroup = chartGroupFor\(metrics\);/.test(page),
    'the page does not call chartGroupFor');

rmSync(dir, { recursive: true, force: true });
console.log(`\nRESULT ${failures === 0 ? 'PASS' : `FAIL (${failures})`}`);
process.exit(failures === 0 ? 0 : 1);
