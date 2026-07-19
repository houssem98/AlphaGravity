// splitAnswerSources() unit checks — strip the baked-in "Sources" footer,
// keep rich labels by id. Run: npx tsx apps/market-ui/src/services/gridResearch.sources.test.ts

import { splitAnswerSources, findUnmappedCites, figuresChanged, distinctiveTerms, buildMemo, aggregateCitations, toCSV, type GridState } from './gridResearch';

let pass = 0, fail = 0;
const failures: string[] = [];
function check(name: string, cond: boolean, detail?: string) {
    if (cond) { pass++; console.log(`  ok   ${name}`); }
    else { fail++; failures.push(name); console.log(`  FAIL ${name}${detail ? ` — ${detail}` : ''}`); }
}

console.log('\n=== splitAnswerSources ===\n');

const answer = [
    'Apple risks. Regulatory pressure [7]. Total net sales $416.16B [6].',
    '',
    'Sources',
    '[1] AAPL 10-K FY2020, Revenue (SEC XBRL) [AAPL]: $274,515 million',
    '[6] AAPL 10-K FY2025, Revenue (SEC XBRL) [AAPL]: $416,161 million',
    '[7] AAPL 10-Q, Item 1 Legal Proceedings (2026-05-01) [AAPL]: "On April 23..."',
].join('\n');

const { prose, labels } = splitAnswerSources(answer);

check('prose drops the footer', !/Sources\n\[1\]/.test(prose) && !prose.includes('274,515'), prose.slice(-60));
check('prose keeps the body', prose.includes('Regulatory pressure [7]'));
check('parses all 3 labels', labels.size === 3, `got ${labels.size}`);
check('label 6 is rich', labels.get(6) === 'AAPL 10-K FY2025, Revenue (SEC XBRL) [AAPL]: $416,161 million');
check('label 7 keeps quote', (labels.get(7) ?? '').includes('Legal Proceedings'));

// No footer → unchanged, no labels.
const plain = splitAnswerSources('Just an answer with a [1] inline cite.');
check('no footer → prose unchanged', plain.prose === 'Just an answer with a [1] inline cite.');
check('no footer → no labels', plain.labels.size === 0);

// "## Sources" markdown heading variant.
const md = splitAnswerSources('Body text.\n\n## Sources\n[2] Doc B: value');
check('strips ## Sources heading', md.prose === 'Body text.' && md.labels.get(2) === 'Doc B: value');

console.log('\n=== findUnmappedCites ===\n');

const cites = [{ id: 7 }, { id: 8 }, { id: 9 }];
check('clean: all mapped', findUnmappedCites('Risk [7] and [8].', cites).length === 0);
check('flags fabricated [12]', JSON.stringify(findUnmappedCites('See [7], [12], [99].', cites)) === '[12,99]');
check('dedupes + sorts', JSON.stringify(findUnmappedCites('[5] [5] [3]', cites)) === '[3,5]');
check('no markers → empty', findUnmappedCites('No cites here.', cites).length === 0);

console.log('\n=== figuresChanged ===\n');

check('phrasing drift, same numbers → no change',
    figuresChanged('Revenue was $416,161M [1].', 'Apple reported $416,161M in revenue [2].') === false);
check('a figure moved → change',
    figuresChanged('Revenue $416,161M', 'Revenue $420,000M') === true);
check('new figure added → change',
    figuresChanged('Margin 19%', 'Margin 19%, FCF $99B') === true);
check('ignores [N] citation markers',
    figuresChanged('Risk [1] and [2].', 'Risk [7] and [8].') === false);

console.log('\n=== distinctiveTerms (M2 outliers) ===\n');

const col = [
    'NVDA faces ongoing antitrust investigation in the EU.',  // unique: antitrust, investigation
    'AAPL reported strong margins and growth.',               // none salient
    'MSFT noted cloud revenue and litigation is a sibling? no', // litigation only here
];
const dt = distinctiveTerms(col);
check('cell 0 flags antitrust', dt[0].includes('antitrust') && dt[0].includes('investigation'));
check('cell 1 no outlier', dt[1].length === 0);
check('cell 2 flags litigation', dt[2].includes('litigation'));
// Shared term is NOT distinctive.
const shared = distinctiveTerms(['decline in sales', 'decline in margin']);
check('shared term not distinctive', shared[0].length === 0 && shared[1].length === 0);

console.log('\n=== buildMemo (M4) ===\n');

const memoState: GridState = {
    def: { id: 'g', name: 'Test Grid', tickers: ['NVDA'], prompts: [{ id: 'risks', label: 'Risks', prompt: '{ticker} risks' }] },
    cells: {
        'NVDA::risks': {
            ticker: 'NVDA', promptId: 'risks', status: 'done',
            answer: 'Antitrust risk is material [1].',
            citations: [{ id: 1, title: 'NVDA 10-K', url: 'https://sec.gov/x', source: 'gravity' }],
        },
    },
};
const memo = buildMemo(memoState, new Map([['NVDA::risks', ['antitrust']]]));
check('memo has title', memo.includes('# Test Grid — Research Memo'));
check('memo has ticker section', memo.includes('## NVDA'));
check('memo has question + answer', memo.includes('### Risks') && memo.includes('Antitrust risk is material'));
check('memo notes outlier', memo.includes('⚡ Unique to NVDA: antitrust'));
check('memo lists real source url', memo.includes('https://sec.gov/x'));

console.log('\n=== GT-8 export honesty (trust in memo + CSV) ===\n');

const trustState: GridState = {
    def: { id: 'g', name: 'Trusted Grid', tickers: ['NVDA'], prompts: [{ id: 'risks', label: 'Risks', prompt: '{ticker} risks' }] },
    cells: {
        'NVDA::risks': {
            ticker: 'NVDA', promptId: 'risks', status: 'done',
            answer: 'Revenue was $416,161M [1].',
            citations: [{ id: 1, title: 'NVDA 10-K', url: 'https://sec.gov/x', source: 'gravity' }],
            trust: { grade: 'D', score: 45, reasons: ['1 figure contradiction(s) across rounds'] },
            rounds: 2,
            contradictions: ['round1: $416,161m vs round2: $420,000m'],
        },
    },
};
const trustMemo = buildMemo(trustState);
check('memo heading carries grade', trustMemo.includes('### Risks — Trust D'));
check('memo has inline contradiction callout', trustMemo.includes('⚠ CONTRADICTION') && trustMemo.includes('$420,000m'));
check('memo has Trust section', trustMemo.includes('## Trust'));
check('memo Trust section lists per-company grades', trustMemo.includes('- NVDA: Risks D⚠'));
check('memo Trust section lists conflict with both values', trustMemo.includes('- NVDA Risks: round1: $416,161m vs round2: $420,000m'));

const trustCsv = toCSV(trustState);
const csvLines = trustCsv.split('\r\n');
check('CSV header gains trust column', csvLines[0].endsWith(',trust'));
check('CSV row carries grade + conflict marker', csvLines[1].endsWith(',D⚠'));

// Un-graded state: memo has no Trust section, CSV grades show placeholder.
const plainMemo = buildMemo(memoState);
check('ungraded memo has no Trust section', !plainMemo.includes('## Trust'));
const plainCsv = toCSV(memoState);
check('ungraded CSV trust cell is placeholder', plainCsv.split('\r\n')[1].endsWith(',·'));

console.log('\n=== aggregateCitations (P3.1) ===\n');

const aggState: GridState = {
    def: { id: 'g', name: 'G', tickers: ['NVDA', 'AAPL'], prompts: [
        { id: 'risks', label: 'Risks', prompt: 'x' },
        { id: 'cmp', label: 'Comparison', prompt: 'y', synthesis: true },
    ] },
    cells: {
        'NVDA::risks': { ticker: 'NVDA', promptId: 'risks', status: 'done', answer: 'a', citations: [{ id: 1, title: 'NVDA 10-K', url: 'u1', source: 'gravity' }] },
        'AAPL::risks': { ticker: 'AAPL', promptId: 'risks', status: 'done', answer: 'b', citations: [{ id: 1, title: 'AAPL 10-K', url: 'u2', source: 'gravity' }, { id: 2, title: 'NVDA 10-K', url: 'u1', source: 'gravity' }] },
    },
};
const agg = aggregateCitations(aggState.def, aggState);
check('aggregates across cells', agg.length === 2, `got ${agg.length}`);
check('dedupes by title+url', agg.filter(c => c.title === 'NVDA 10-K').length === 1);
check('renumbers sequentially', agg[0].id === 1 && agg[1].id === 2);

console.log(`\n${pass} passed, ${fail} failed`);
if (fail > 0) { console.error('Failures:', failures); process.exit(1); }
