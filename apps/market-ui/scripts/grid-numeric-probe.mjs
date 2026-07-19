#!/usr/bin/env node
// P0.5 — numeric-accuracy regression probe for the Research Grid retrieval path.
// Hits the LIVE gravity-api with queries whose correct figures are known (sourced
// from the indexed SEC XBRL corpus), and asserts each figure appears in the
// answer or its citations. This is a network/live probe, NOT a unit test — it is
// deliberately kept out of `npm run test` so the unit suite stays deterministic.
//
// Usage: npx tsx scripts/grid-numeric-probe.mjs   (or `npm run probe`)
//   VITE_GRAVITY_API_URL overrides the target (default prod).
//
// GT-7: each probe answer is also scored with scoreCellTrust (grade must be
// B-equivalent or better for XBRL-backed answers), and a deliberately-wrong
// planted figure must be caught by consensusFigures as a conflict.
// Runs under tsx (not plain node) so it can import the TS trust helpers.

import { scoreCellTrust, consensusFigures } from '../src/services/gridTrust';
import { extractFigures } from '../src/services/gridResearch';

const API = process.env.VITE_GRAVITY_API_URL || 'https://gravity-api-prod.fly.dev';

// Expected figures verified against live /v1/search citations on 2026-06-30.
// $ millions. Focused per-figure queries (one figure each).
const PROBES = [
    { q: 'AAPL total net sales for fiscal year 2020', fig: '274,515', label: 'AAPL revenue FY2020' },
    { q: 'AAPL total net sales for fiscal year 2021', fig: '365,817', label: 'AAPL revenue FY2021' },
    { q: 'AAPL total net sales for fiscal year 2022', fig: '394,328', label: 'AAPL revenue FY2022' },
    { q: 'AAPL total net sales for fiscal year 2023', fig: '383,285', label: 'AAPL revenue FY2023' },
    { q: 'AAPL total net sales for fiscal year 2024', fig: '391,035', label: 'AAPL revenue FY2024' },
    { q: 'AAPL total net sales for fiscal year 2025', fig: '416,161', label: 'AAPL revenue FY2025' },
    { q: 'NVDA total revenue for fiscal year 2026', fig: '215,938', label: 'NVDA revenue FY2026' },
    { q: 'NVDA total revenue for fiscal year 2022', fig: '26,914', label: 'NVDA revenue FY2022' },
    { q: 'NVDA total revenue for fiscal year 2016', fig: '5,010', label: 'NVDA revenue FY2016' },
    { q: 'NVDA gross profit for fiscal year 2021', fig: '10,396', label: 'NVDA gross profit FY2021' },
    { q: 'NVDA gross profit for fiscal year 2022', fig: '17,475', label: 'NVDA gross profit FY2022' },
    { q: 'NVDA gross profit for fiscal year 2023', fig: '15,356', label: 'NVDA gross profit FY2023' },
];

async function search(query) {
    const r = await fetch(`${API}/v1/search`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-API-Key': 'deep-research-internal' },
        body: JSON.stringify({ query, options: { reasoning_depth: 'fast', stream: false } }),
    });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    const d = await r.json();
    const citations = (d.citations || []).map(c => ({
        id: c.id, title: c.source || `Source ${c.id}`, url: c.url || `gravity://source/${c.id}`,
        source: 'gravity', sourceData: { text: c.text || '' },
    }));
    const cites = (d.citations || []).map(c => `${c.source || ''} ${c.text || ''}`).join(' ');
    return { hay: `${d.answer || ''} ${cites}`, answer: d.answer || '', citations };
}

// GT-7: grade a live probe answer exactly as the grid would grade the cell.
function gradeProbe(answer, citations) {
    return scoreCellTrust({
        ticker: 'PROBE', promptId: 'probe', status: 'done',
        answer, citations, ragUsed: true,
    });
}

// Broad multi-year recall — ONE range query must surface EVERY year, not just the
// endpoints. This is the P0.1 recall gap: "FY2020-2025" named only 2020 & 2025 in
// text, so structured retrieval fetched FY2019/2020/2024/2025 and dropped 2021-2023
// (3 of 6). One assertion per year, all from the SAME query's answer+citations.
const BROAD = [
    {
        q: 'AAPL total net sales for each fiscal year from 2020 to 2025',
        label: 'AAPL revenue FY2020-2025 (broad range)',
        figs: ['274,515', '365,817', '394,328', '383,285', '391,035', '416,161'],
    },
];

let pass = 0, fail = 0;
const failures = [];

console.log(`\n=== Grid numeric probe → ${API} ===\n`);

const hasFig = (hay, fig) =>
    hay.includes(fig) || hay.replace(/[^0-9]/g, '').includes(fig.replace(/,/g, ''));

for (const p of PROBES) {
    let res;
    try {
        res = await search(p.q);
    } catch (e) {
        fail++; failures.push(`${p.label}: ${p.fig} (query failed: ${e.message})`);
        console.log(`  FAIL  ${p.label} — query error: ${e.message}`);
        continue;
    }
    const trust = gradeProbe(res.answer, res.citations);
    const trustOk = trust.grade === 'A' || trust.grade === 'B';
    if (hasFig(res.hay, p.fig)) { pass++; console.log(`  ok    ${p.label}: ${p.fig} [grade ${trust.grade}/${trust.score}]`); }
    else { fail++; failures.push(`${p.label}: ${p.fig}`); console.log(`  FAIL  ${p.label}: ${p.fig} — not found [grade ${trust.grade}]`); }
    // GT-7: an XBRL-backed answer must grade B-equivalent or better.
    if (trustOk) { pass++; }
    else { fail++; failures.push(`${p.label}: trust ${trust.grade} < B (${trust.reasons.join(' · ')})`); console.log(`  FAIL  ${p.label}: trust ${trust.grade} < B`); }
}

for (const b of BROAD) {
    let res;
    try {
        res = await search(b.q);
    } catch (e) {
        for (const f of b.figs) { fail++; failures.push(`${b.label}: ${f} (query failed: ${e.message})`); }
        console.log(`  FAIL  ${b.label} — query error: ${e.message}`);
        continue;
    }
    for (const f of b.figs) {
        if (hasFig(res.hay, f)) { pass++; console.log(`  ok    ${b.label}: ${f}`); }
        else { fail++; failures.push(`${b.label}: ${f}`); console.log(`  FAIL  ${b.label}: ${f} — not found in one broad query`); }
    }
}

// GT-7 conflict canary (offline, deterministic): a deliberately-wrong figure
// planted in a round-2 answer MUST surface as a conflict, never merge silently.
{
    const r1 = extractFigures('AAPL revenue was $274,515M [1].');
    const planted = extractFigures('AAPL revenue was $999,999M [1].');
    const consensus = consensusFigures(r1, planted, 'total net sales $999,999 million per 10-K');
    const caught = consensus.conflict.length === 1
        && consensus.conflict[0].r1.includes('274,515')
        && consensus.conflict[0].r2.includes('999,999');
    if (caught) { pass++; console.log(`  ok    conflict canary: planted $999,999M caught vs $274,515M`); }
    else { fail++; failures.push(`conflict canary: planted wrong figure NOT caught (${JSON.stringify(consensus)})`); console.log(`  FAIL  conflict canary`); }
}

console.log(`\n${pass} passed, ${fail} failed (of ${pass + fail} assertions)`);
if (fail > 0) { console.error('\nFailures:', failures); process.exit(1); }
