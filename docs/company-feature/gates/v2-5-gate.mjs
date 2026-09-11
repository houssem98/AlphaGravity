// V2-5 gate. Period selection is semantic, not lexical.
//
// `LatestQuarterCard.tsx:36` sorted period STRINGS and took the top two. "Q4
// 2025" sorts above "FY2025" because Q sorts above F, so a company reporting
// both had a quarter printed against a fiscal year with a delta between them.
// A quarter is not 4% smaller than a year; that number meant nothing.
//
// Run from the repo root:  node docs/company-feature/gates/v2-5-gate.mjs
import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';

const read = (p) => readFileSync(new URL('../../../' + p, import.meta.url), 'utf8')
  .replace(/\r\n/g, '\n');

let failures = 0;
const check = (name, ok, detail = '') => {
  if (!ok) failures++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail && !ok ? `\n      ${detail}` : ''}`);
};

// Three gates in the previous ledger matched their own explanatory text, and
// this file's header quotes the construct it forbids. Source shape is asserted
// against code with every comment removed.
const stripComments = (s) =>
  s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^[ \t]*\/\/.*$/gm, '');

const { parsePeriod, selectComparablePeriods } = await import(
  new URL('../../../apps/market-ui/src/lib/periods.ts', import.meta.url)
);

// ── each basis is recognised for what it is ─────────────────────────────────
const BASES = [
  ['FY2025', 'annual'], ['2025', 'annual'],
  ['Q4 2025', 'quarterly'], ['Q1 2025', 'quarterly'], ['2025-Q3', 'quarterly'],
  ['TTM', 'ttm'], ['TTM 2025', 'ttm'],
  ['2025-09-27', 'date'],
  ['whenever', 'unknown'],
];
for (const [label, want] of BASES) {
  const got = parsePeriod(label).basis;
  check(`\`${label}\` is ${want}`, got === want, `got ${got}`);
}

// ── the mixed fixture the row asks for ──────────────────────────────────────
const MIXED = ['Q4 2025', 'FY2025', 'FY2024', 'TTM 2025'];

// The control: what the code this row replaced did to that set.
const lexical = [...MIXED].sort().reverse();
check('the fixture is one the old lexical sort got wrong',
  parsePeriod(lexical[0]).basis !== parsePeriod(lexical[1]).basis,
  `lexical order ${JSON.stringify(lexical.slice(0, 2))} is already same-basis — ` +
  'this fixture discriminates nothing');
console.log(`      lexical order gave ${lexical[0]} vs ${lexical[1]} — ` +
  `${parsePeriod(lexical[0]).basis} against ${parsePeriod(lexical[1]).basis}`);

const picked = selectComparablePeriods(MIXED);
check('the mixed set yields a selection', Boolean(picked));
check('latest and prior are on the same basis, or there is no prior',
  picked.prior === undefined || parsePeriod(picked.latest).basis === parsePeriod(picked.prior).basis,
  `${picked.latest} (${parsePeriod(picked.latest).basis}) vs ` +
  `${picked.prior} (${parsePeriod(picked.prior ?? '').basis})`);
check('it does not pair Q4 2025 with FY2025',
  !(picked.latest === 'Q4 2025' && picked.prior === 'FY2025'),
  'the exact cross-basis pair the row names');
check('the only quarter in the set gets no prior at all',
  picked.basis === 'quarterly' && picked.prior === undefined,
  `chose ${picked.basis} ${picked.latest} vs ${picked.prior}`);

// Every basis, paired against every other, must never come back paired.
const SAMPLES = ['FY2025', 'Q4 2025', 'TTM 2025', '2025-09-27'];
let crossed = null;
for (const a of SAMPLES) {
  for (const b of SAMPLES) {
    if (a === b) continue;
    const s = selectComparablePeriods([a, b]);
    if (s.prior !== undefined && parsePeriod(s.latest).basis !== parsePeriod(s.prior).basis) {
      crossed = `${a} + ${b} -> ${s.latest} vs ${s.prior}`;
    }
  }
}
check('no pair drawn from two different bases is ever compared', crossed === null, crossed ?? '');

// ── within a basis, the order is semantic ───────────────────────────────────
const q = selectComparablePeriods(['Q4 2024', 'Q1 2025']);
check('Q1 2025 is newer than Q4 2024, which the string sort has backwards',
  q.latest === 'Q1 2025' && q.prior === 'Q4 2024', `got ${q.latest} vs ${q.prior}`);
check('and the string sort really does have it backwards',
  ['Q4 2024', 'Q1 2025'].sort().reverse()[0] === 'Q4 2024',
  'the control no longer discriminates');

const a = selectComparablePeriods(['FY2019', 'FY2026', 'FY2025']);
check('annual periods order by year', a.latest === 'FY2026' && a.prior === 'FY2025',
  `got ${a.latest} vs ${a.prior}`);

check('an empty set selects nothing', selectComparablePeriods([]) === null);
check('a single period has no prior', selectComparablePeriods(['FY2025']).prior === undefined);

// ── the card actually uses it ───────────────────────────────────────────────
const card = stripComments(read('apps/market-ui/src/components/company/LatestQuarterCard.tsx'));
check('the card imports the selector',
  card.includes('selectComparablePeriods') && card.includes("from '../../lib/periods'"));
check('no lexical sort of period strings survives in the card',
  !/\.sort\(\)\s*\.reverse\(\)/.test(card),
  '`.sort().reverse()` over the period strings is still there');
check('the card reports the basis it chose',
  /basis/.test(card), 'the chosen basis is not carried out of computeQuarterRows');

// ── and the card's own suite passes, mixed fixture included ─────────────────
const suite = 'src/components/company/LatestQuarterCard.test.ts';
let vitest = '';
let vitestOk = true;
try {
  vitest = execFileSync('npx', ['vitest', 'run', suite], {
    cwd: new URL('../../../apps/market-ui/', import.meta.url),
    encoding: 'utf8', stdio: 'pipe', shell: true,
  });
} catch (e) {
  vitestOk = false;
  vitest = `${e.stdout ?? ''}${e.stderr ?? ''}`;
}
check(`${suite} passes`, vitestOk, vitest.trim().split('\n').slice(-12).join('\n      '));
check('that suite contains a mixed-basis case',
  read('apps/market-ui/src/components/company/' + suite.split('/').pop()).includes("'Q4 2025'"),
  'the suite has no mixed fixture, so its PASS grades nothing for this row');
console.log(`      vitest: ${vitest.trim().split('\n').filter(Boolean).pop() ?? '(no output)'}`);

console.log(`\nRESULT ${failures === 0 ? 'PASS' : `FAIL (${failures})`}`);
process.exit(failures === 0 ? 0 : 1);
