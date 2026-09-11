// V2-1 gate. A chart renders the unit the server sent.
//
// OverviewTab.tsx:61,63 hardcoded `$${(v/1e9).toFixed(0)}B`, so every series was
// drawn as USD billions. CF-21 widened what the card renders — net income,
// operating income — and a margin or an EPS under that formatter reads $0.00B.
// The longitudinal endpoint has always returned `unit`.
//
// Run from anywhere:  node docs/company-feature/gates/v2-1-gate.mjs
import { readFileSync } from 'node:fs';

const read = (p) => readFileSync(new URL('../../../' + p, import.meta.url), 'utf8')
  .replace(/\r\n/g, '\n');

let failures = 0;
const check = (name, ok, detail = '') => {
  if (!ok) failures++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail && !ok ? `\n      ${detail}` : ''}`);
};

// Three gates in the previous ledger matched their own explanatory text. Every
// source-shape assertion below runs against code with the comments removed, so a
// sentence describing the thing this row forbids can never satisfy the row.
const stripComments = (s) =>
  s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^[ \t]*\/\/.*$/gm, '');

// ─── one function, asserted per unit type ───────────────────────────────────
const { formatFinancialValue } = await import(
  new URL('../../../apps/market-ui/src/lib/figures.ts', import.meta.url)
);

check('formatFinancialValue takes (value, unit, metric)', formatFinancialValue.length === 3,
  `arity is ${formatFinancialValue.length}`);

const cases = [
  ['a % series renders 45.0%', [45.0, '%', 'gross_margin'], '45.0%'],
  ['an EPS series renders $7.46', [7.46, 'USD M', 'eps'], '$7.46'],
  ['a USD series renders $391.04B', [391_035_000_000, 'USD M', 'revenue'], '$391.04B'],
];
for (const [name, args, want] of cases) {
  const got = formatFinancialValue(...args);
  check(name, got === want, `got ${JSON.stringify(got)}, want ${JSON.stringify(want)}`);
}

// The defect itself, as a control: the formatter this row replaced, applied to
// the same three values. If it satisfied them, the cases would discriminate
// nothing and the three PASSes above would be worth nothing.
const usdBillions = (v) => `$${(v / 1e9).toFixed(2)}B`;
check('the old USD-billions formatter fails at least two of the three cases',
  cases.filter(([, a, want]) => usdBillions(a[0]) !== want).length >= 2,
  'the cases do not discriminate — the pre-fix code would pass this gate');

// ─── axis, tooltip and label all read that one function ─────────────────────
const overview = stripComments(read('apps/market-ui/src/components/company/OverviewTab.tsx'));

check('OverviewTab imports formatFinancialValue',
  overview.includes('formatFinancialValue') && overview.includes("from '../../lib/figures'"));

const chartStart = overview.indexOf('<LineChart');
const chartEnd = overview.indexOf('</LineChart>');
check('the trend chart block was located', chartStart > -1 && chartEnd > chartStart);
const trendChart = overview.slice(chartStart, chartEnd);

// The axis names a formatter; every other surface must name the SAME one.
const fmtName = (trendChart.match(/tickFormatter=\{(\w+)\}/) || [])[1];
check('the Y axis formats through a named formatter, not an inline literal',
  Boolean(fmtName), 'YAxis tickFormatter is still an inline arrow, or absent');

const defLine = fmtName
  ? overview.split('\n').find(l => l.includes(`const ${fmtName}`) && l.includes('='))
  : undefined;
check('that formatter is defined from formatFinancialValue',
  Boolean(defLine) && defLine.includes('formatFinancialValue('),
  defLine ? `its definition is: ${defLine.trim()}` : `no \`const ${fmtName}\` in the file`);

check('the formatter is given the server unit and the metric',
  Boolean(defLine) && defLine.includes('trendUnit') && defLine.includes('trendKey'),
  'it is called with neither the unit nor the metric, so it cannot vary by either');

// Up to the next element, not up to the next `>` — a formatter prop contains an
// arrow, and cutting at the first `>` truncates the attribute being asserted on.
const tagText = (tag, src) => {
  const i = src.indexOf(tag);
  if (i === -1) return '';
  const j = src.indexOf('<', i + 1);
  return src.slice(i, j === -1 ? src.length : j);
};
check('the tooltip formats through the same formatter',
  Boolean(fmtName) && tagText('<Tooltip', trendChart).includes(`${fmtName}(`),
  'the Tooltip formatter does not call it');

check('the point label formats through the same formatter',
  Boolean(fmtName) && tagText('<LabelList', trendChart).includes(`formatter={${fmtName}}`),
  'no LabelList on the series, or it does not use the formatter');

check('no hardcoded USD-billions literal survives in the trend chart',
  !trendChart.includes('1e9') && !trendChart.includes('$${'),
  'a `/1e9` divide or a `$${...}` template is still drawing the series');

// ─── the unit actually reaches the component ────────────────────────────────
const hook = stripComments(read('apps/market-ui/src/components/company/useCompanyData.ts'));
check('useCompanyData reads `unit` off the longitudinal payload',
  hook.includes('setTrendUnit(lonData?.unit'));
check('useCompanyData returns trendUnit',
  hook.slice(hook.lastIndexOf('return')).includes('trendUnit'));

const page = stripComments(read('apps/market-ui/src/pages/CompanyPage.tsx'));
check('CompanyPage passes trendUnit to OverviewTab', page.includes('trendUnit={trendUnit}'));

console.log(`\nRESULT ${failures === 0 ? 'PASS' : `FAIL (${failures})`}`);
process.exit(failures === 0 ? 0 : 1);
