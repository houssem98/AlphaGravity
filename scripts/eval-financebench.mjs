#!/usr/bin/env node
// eval-financebench — the real 150, on a pre-registered split (GS-7).
//
//   node scripts/eval-financebench.mjs                     # dev split, prod
//   node scripts/eval-financebench.mjs --split holdout --i-know
//   node scripts/eval-financebench.mjs --limit 10 --target local
//
// Replaces the 25-question embedded sample whose baseline (0.40 type-aware,
// captured 2026-06-13) carried a ±9.8-point standard error. An instrument that
// cannot see a 5-point change cannot grade this loop.
//
// Grading is deterministic. Of the 150 answers, 52 are numeric and 37 open with
// yes/no; those 89 are gradable by machine. The other 61 are prose and are
// reported as UNGRADED rather than handed to an LLM judge — a model-graded stop is
// a coin with a bias (identical repeated judgements flip ~14% of the time), and
// this ledger forbids one.
//
// Be honest about the width anyway: the dev split holds 38 gradable items, so its
// standard error near p=0.5 is ~8 points; only the pooled 89 reaches ~5.3. The
// split exists to stop the analysis being tuned on the data that reports the
// result — not to manufacture precision the sample size does not have.
import { readFileSync, writeFileSync, existsSync } from 'node:fs';

const args = process.argv.slice(2);
const arg = (k, d) => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : d; };
const SPLIT = arg('--split', 'dev');
const LIMIT = Number(arg('--limit', Infinity));
const TARGET = arg('--target', 'prod');
const BASE = TARGET === 'prod' ? 'https://gravity-api-prod.fly.dev' : 'http://127.0.0.1:8010';
const KEY = process.env.GRAVITY_API_KEY || 'eval-unlimited-fb-2026';
const DATA = 'services/gravity-api/eval/data/financebench_150.json';
const SPEND_LEDGER = 'scripts/probe-spend.json';
const TOL = 0.02;

const SCALE = { thousand: 1e3, million: 1e6, billion: 1e9, trillion: 1e12, bn: 1e9, mm: 1e6, k: 1e3, m: 1e6, b: 1e9 };

/** Every number in a string, normalised to units. Percentages stay as written. */
export function numbersIn(text) {
    const out = [];
    for (const m of String(text).matchAll(/(-?\d[\d,]*\.?\d*)\s*(thousand|million|billion|trillion|bn|mm|%)?/gi)) {
        const n = Number(m[1].replace(/,/g, ''));
        if (!Number.isFinite(n)) continue;
        const suffix = (m[2] || '').toLowerCase();
        out.push(suffix && suffix !== '%' ? n * (SCALE[suffix] ?? 1) : n);
    }
    return out;
}

/** Expected answers are single values; a reply may restate them at any scale. */
export function numericHit(expected, reply) {
    const [want] = numbersIn(expected);
    if (!Number.isFinite(want)) return false;
    const scales = [1, 1e3, 1e6, 1e9];
    return numbersIn(reply).some(got =>
        scales.some(s => Math.abs(got - want * s) <= Math.abs(want * s) * TOL));
}

export function booleanHit(expected, reply) {
    const want = /^yes/i.test(expected.trim()) ? 'yes' : 'no';
    // Read the verdict from the opening clause. A "no" buried inside a later
    // explanation is not the answer, and a refusal counts as wrong, not absent.
    const head = reply.trim().replace(/^[^A-Za-z]*/, '').slice(0, 160).toLowerCase();
    const got = /\b(yes|correct|improved|increased)\b/.test(head) ? 'yes'
        : /\b(no|not|declined|decreased)\b/.test(head) ? 'no' : null;
    return got === want;
}

const rows = JSON.parse(readFileSync(DATA, 'utf8'))
    .filter(r => r.split === SPLIT)
    .slice(0, LIMIT);

if (SPLIT === 'holdout' && !args.includes('--i-know')) {
    console.error('holdout is reserved for the GS-10 sweep. Re-run with --i-know if that is genuinely what this is.');
    process.exit(2);
}

console.log(`FinanceBench · ${SPLIT} split · ${rows.length} questions · ${BASE}\n`);

const results = [];
let spend = 0;
for (const [i, r] of rows.entries()) {
    let reply = '', cost = 0, err = null;
    try {
        const res = await fetch(`${BASE}/v1/search`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'X-API-Key': KEY },
            body: JSON.stringify({ query: r.question, options: { reasoning_depth: 'fast' } }),
            signal: AbortSignal.timeout(180_000),
        });
        if (!res.ok) throw new Error(`${res.status} ${(await res.text()).slice(0, 120)}`);
        const body = await res.json();
        reply = body.answer || '';
        cost = Number(body.metadata?.estimated_cost_usd ?? 0);
    } catch (e) { err = String(e.message || e).slice(0, 160); }
    spend += cost;

    const graded = r.grade_kind === 'numeric' ? numericHit(r.answer, reply)
        : r.grade_kind === 'boolean' ? booleanHit(r.answer, reply)
            : null;
    results.push({
        id: r.id, company: r.company, kind: r.grade_kind, correct: graded, err,
        expected: r.answer.slice(0, 60), got: reply.slice(0, 200),
    });
    const mark = graded === null ? '·' : graded ? '+' : 'x';
    console.log(`  ${mark} ${String(i + 1).padStart(3)}/${rows.length} ${r.company.padEnd(22).slice(0, 22)} ` +
        `${r.grade_kind.padEnd(8)} ${err ? 'ERROR ' + err : r.answer.slice(0, 40)}`);
}

const gradable = results.filter(r => r.correct !== null);
const right = gradable.filter(r => r.correct).length;
const byKind = (k) => {
    const s = gradable.filter(r => r.kind === k);
    return `${s.filter(r => r.correct).length}/${s.length}`;
};
// Wilson interval — at these n the normal approximation is not trustworthy.
const wilson = (k, n) => {
    if (!n) return [0, 0];
    const z = 1.96, p = k / n, d = 1 + z * z / n;
    const c = (p + z * z / (2 * n)) / d;
    const h = z * Math.sqrt(p * (1 - p) / n + z * z / (4 * n * n)) / d;
    return [Math.max(0, c - h), Math.min(1, c + h)];
};
const [lo, hi] = wilson(right, gradable.length);

console.log(`\n${'-'.repeat(60)}`);
console.log(`gradable ${right}/${gradable.length} = ${(100 * right / Math.max(gradable.length, 1)).toFixed(1)}%  ` +
    `95% CI [${(100 * lo).toFixed(1)}, ${(100 * hi).toFixed(1)}]`);
console.log(`numeric ${byKind('numeric')} · boolean ${byKind('boolean')} · ` +
    `prose ${results.filter(r => r.kind === 'prose').length} UNGRADED (no judge, by design)`);
console.log(`errors ${results.filter(r => r.err).length} · spend $${spend.toFixed(4)}`);

const outFile = `services/gravity-api/eval/data/results_${SPLIT}_${new Date().toISOString().slice(0, 10)}.json`;
writeFileSync(outFile, JSON.stringify({
    split: SPLIT, target: BASE, n: rows.length, gradable: gradable.length,
    correct: right, ci95: [lo, hi], spend_usd: spend, results,
}, null, 1) + '\n');
console.log(`\nwrote ${outFile}`);

const ledger = existsSync(SPEND_LEDGER) ? JSON.parse(readFileSync(SPEND_LEDGER, 'utf8')) : { total_usd: 0, runs: 0 };
ledger.total_usd = Number((ledger.total_usd + spend).toFixed(4));
ledger.runs += 1;
writeFileSync(SPEND_LEDGER, JSON.stringify(ledger, null, 2) + '\n');
console.log(`cumulative loop spend $${ledger.total_usd.toFixed(4)} of $15`);
