// P3-d cross-doc comparison — buildSynthesisPrompt() unit checks.
// Run: npx tsx apps/market-ui/src/services/gridResearch.synthesis.test.ts

import { buildSynthesisPrompt, initializeGrid, updateCell, type GridDef } from './gridResearch';

let pass = 0, fail = 0;
const failures: string[] = [];
function check(name: string, cond: boolean, detail?: string) {
    if (cond) { pass += 1; console.log(`  ok   ${name}`); }
    else { fail += 1; failures.push(name); console.log(`  FAIL ${name}${detail ? ' — ' + detail : ''}`); }
}

const def: GridDef = {
    id: 'g', name: 'test',
    tickers: ['AAPL', 'MSFT'],
    prompts: [
        { id: 'moat', label: 'Moat', prompt: 'moat?' },
        { id: 'val', label: 'Valuation', prompt: 'valuation?' },
        { id: 'syn', label: 'Comparison', prompt: 'Rank by conviction.', synthesis: true },
    ],
};
const synth = def.prompts.find(p => p.synthesis)!;

console.log('\n=== buildSynthesisPrompt ===\n');

// No completed cells → null
check('null when nothing completed', buildSynthesisPrompt(def, initializeGrid(def), synth) === null);

// Group by dimension across tickers
let s = initializeGrid(def);
s = updateCell(s, 'AAPL', 'moat', { status: 'done', answer: 'ecosystem lock-in' });
s = updateCell(s, 'MSFT', 'moat', { status: 'done', answer: 'enterprise switching cost' });
s = updateCell(s, 'AAPL', 'val', { status: 'done', answer: '28x P/E' });
const out = buildSynthesisPrompt(def, s, synth)!;

check('returns a prompt', typeof out === 'string' && out.length > 0);
check('groups by dimension header (Moat)', out.includes('### Moat'));
check('groups by dimension header (Valuation)', out.includes('### Valuation'));
check('includes both tickers under a dimension', out.includes('AAPL: ecosystem') && out.includes('MSFT: enterprise'));
check('omits tickers with no answer for a dimension', !out.includes('MSFT: 28x') && out.includes('AAPL: 28x'));
check('includes the synthesis instruction', out.includes('Rank by conviction'));
check('requests a comparison table', /comparison table/i.test(out));

console.log(`\n${pass} passed, ${fail} failed`);
if (fail) { console.log('FAILURES:', failures.join('; ')); process.exit(1); }
