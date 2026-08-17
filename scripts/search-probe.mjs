#!/usr/bin/env node
// search-probe — the kill authority for GRAVITY_LOOP.sh.
//
//   node scripts/search-probe.mjs                 # local (default): 127.0.0.1:8000
//   node scripts/search-probe.mjs --target prod   # prod, READ-ONLY (§10 E-F)
//   node scripts/search-probe.mjs --json          # machine-readable rows
//
// One assertion per docs/GRAVITY_SEARCH_ROADMAP.md §6 row. Non-zero exit halts the
// loop whatever §7 says. A row this probe cannot measure yet reports PENDING with
// the task that owns it — never green, never silently dropped.
//
// Why R3 is the row that matters: prod answered "cost of goods sold is missing from
// the sources" on 2026-08-17 while AMD_CostOfGoodsAndServicesSold_FY2025_xbrl =
// 17,487,000,000 sat in Postgres. R3 fails until retrieval finds what the corpus has.
import { readFileSync, writeFileSync, existsSync } from 'node:fs';

const args = process.argv.slice(2);
const arg = (k, d) => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : d; };
const TARGET = arg('--target', 'local');
const JSON_OUT = args.includes('--json');

const BASE = TARGET === 'prod' ? 'https://gravity-api-prod.fly.dev' : 'http://127.0.0.1:8000';
const API_KEY = process.env.GRAVITY_API_KEY || 'eval-unlimited-fb-2026';
const DB_CEILING_MB = 450;      // §4: free tier is 500, halt at 450
const RUN_SPEND_CAP = 1.00;     // one probe run must not cost more than a dollar
const TOTAL_SPEND_CAP = 15.00;  // §9 BUDGET
const SPEND_LEDGER = 'scripts/probe-spend.json';

const env = (() => {
    const path = 'services/gravity-api/.env';
    if (!existsSync(path)) return {};
    const text = readFileSync(path, 'utf8');
    return Object.fromEntries([...text.matchAll(/^([A-Z_]+)=(.*)$/gm)].map(m => [m[1], m[2].trim()]));
})();

// ── the fixed query set ──────────────────────────────────────────────────────
// Small on purpose: a probe that runs every wakeup is a recurring cost, not a
// one-off. Measured 2026-08-17: $0.003 single-entity, $0.035 multi-entity.
//
// Two shapes of the same fact, because they do not fail together. Asked about one
// company, prod returns AMD's COGS correctly. Asked to compare two, it answers
// "cost of goods sold is missing from the sources" — with 11 passages retrieved,
// 7 NVDA and 4 AMD, and neither company's COGS among them. Only the second shape
// grades GS-3, so a probe carrying only the first would call the bug fixed.
const TOLERANCE = 0.02;
const EXACT = {
    query: "What was AMD's cost of goods sold in fiscal 2025?",
    expect: [17_487_000_000],     // AMD_CostOfGoodsAndServicesSold_FY2025_xbrl
};
const MULTI = {
    query: 'Compare NVDA and AMD inventory turnover for the latest reported fiscal year.',
    expect: [62_475_000_000,      // NVDA_CostOfRevenue_FY2026_xbrl
             17_487_000_000],     // AMD_CostOfGoodsAndServicesSold_FY2025_xbrl
};

// A per-run marker on the query text. The semantic cache matches at cosine >0.95,
// so without it the second run of this probe grades the first run's cached answers:
// measured 2026-08-17, run 2 returned $0.0000, channels [] and 1.3s on every query.
// A replay cannot detect a regression. SearchRequest has no cache-bypass field and
// prod is read-only to this loop (§10 E-F), so the bust has to be client-side.
const RUN_ID = Date.now().toString(36).slice(-5);
const fresh = (q) => `${q} (ref ${RUN_ID})`;

const search = async (query) => {
    const started = Date.now();
    const res = await fetch(`${BASE}/v1/search`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-API-Key': API_KEY },
        // reasoning_depth belongs under options — SearchRequest ignores it at the
        // top level, which silently made every earlier probe run use "auto".
        body: JSON.stringify({ query, options: { reasoning_depth: 'fast' } }),
        signal: AbortSignal.timeout(120_000),
    });
    if (!res.ok) throw new Error(`${res.status} ${(await res.text()).slice(0, 160)}`);
    const body = await res.json();
    return { ...body, elapsed_ms: Date.now() - started };
};

const dbStats = async () => {
    const url = env.SUPABASE_URL, key = env.SUPABASE_SERVICE_ROLE_KEY;
    if (!url || !key) throw new Error('SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY missing from services/gravity-api/.env');
    const res = await fetch(`${url}/rest/v1/rpc/gravity_db_stats`, {
        method: 'POST',
        headers: { apikey: key, Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
        body: '{}',
        signal: AbortSignal.timeout(60_000),
    });
    if (!res.ok) throw new Error(`db stats ${res.status} ${(await res.text()).slice(0, 160)} — apply supabase/migrations/0005_gravity_db_stats.sql`);
    return (await res.json())[0];
};

/**
 * Every number in the text, normalised to units. "$17,487 million", "17.49 billion"
 * and "17487000000" are the same claim written three ways, and an answer is allowed
 * to pick any of them.
 */
export function numbersIn(text) {
    const SCALE = { thousand: 1e3, million: 1e6, billion: 1e9, trillion: 1e12, k: 1e3, m: 1e6, bn: 1e9, b: 1e9, t: 1e12 };
    const out = [];
    for (const m of text.matchAll(/(-?\d[\d,]*\.?\d*)\s*(thousand|million|billion|trillion|bn|[kmbt])?\b/gi)) {
        const n = Number(m[1].replace(/,/g, ''));
        if (!Number.isFinite(n)) continue;
        const scale = m[2] ? SCALE[m[2].toLowerCase()] ?? 1 : 1;
        out.push(n * scale);
    }
    return out;
}

export const matchesWithin = (values, expected, tol) =>
    values.some(v => Math.abs(v - expected) <= Math.abs(expected) * tol);

const channelsOf = (r) => r?.metadata?.retrieval_channels ?? [];
const modelOf = (r) => r?.metadata?.model_used ?? '';
const costOf = (r) => Number(r?.metadata?.estimated_cost_usd ?? 0);

// ── known-open rows ──────────────────────────────────────────────────────────
// A gate that halts on a row whose fixing task has not run yet can never let that
// task run. So a red row whose owner is still `[ ]` in §7 is KNOWN — reported red,
// counted, and not fatal. The moment its owner is checked `[x]`, the same red row
// becomes fatal, which is what makes "I fixed it" falsifiable.
const OWNER = { R2: 'GS-2', R3: 'GS-3', R5: 'GS-5', R6: 'GS-6', R7: 'GS-7', R8: 'GS-8', R9: 'GS-9' };
const LEDGER = 'docs/GRAVITY_SEARCH_ROADMAP.md';
const closed = new Set(
    [...readFileSync(LEDGER, 'utf8').matchAll(/^-\s*\[([ xX])\]\s*\*\*(GS-\d+)/gm)]
        .filter(m => m[1] !== ' ').map(m => m[2]));

// ── run ──────────────────────────────────────────────────────────────────────
const rows = [];
const row = (id, state, detail) => rows.push({ id, state, detail });

let spend = 0;
try {
    const first = await search(fresh(EXACT.query));    // cache miss: this run's marker is new
    const second = await search(fresh(EXACT.query));   // byte-identical repeat: cache hit
    const multi = await search(fresh(MULTI.query));
    spend = costOf(first) + costOf(second) + costOf(multi);
    const stats = await dbStats();

    // R2 — a response that cannot say what produced it is not auditable. The cached
    // reply is the interesting half: on 2026-08-17 prod returned channels [] and
    // model_used "unknown" for exactly this second call.
    const bad = [first, second, multi].filter(r =>
        channelsOf(r).length === 0 || !modelOf(r) || modelOf(r) === 'unknown');
    row('R2', bad.length === 0 ? 'GREEN' : 'RED',
        `miss=[${channelsOf(first)}] model=${modelOf(first) || '∅'} · ` +
        `hit(cache=${second.metadata?.cache_hit})=[${channelsOf(second)}] model=${modelOf(second) || '∅'}`);

    // R3 — every number below is in the database; this asks whether retrieval found
    // it. Both shapes must pass: single-entity has been green since 2026-08-17 and
    // multi-entity has not, so requiring only one of them grades nothing.
    const graded = [EXACT, MULTI].map(spec => {
        const res = spec === EXACT ? first : multi;
        const values = numbersIn(res.answer ?? '');
        const missing = spec.expect.filter(e => !matchesWithin(values, e, TOLERANCE));
        return { spec, res, missing, cited: (res.citations ?? []).length };
    });
    const failing = graded.filter(g => g.missing.length > 0 || g.cited === 0);
    // cache= is printed because it says what was graded. The `ref` marker busts the
    // cache for the multi query but not always for the single one — a short question
    // still lands inside the 0.95 cosine radius of its earlier self — so a green
    // single row can be a replay of a correct answer rather than a fresh retrieval.
    row('R3', failing.length === 0 ? 'GREEN' : 'RED',
        graded.map(g => `${g.spec === EXACT ? 'single' : 'multi'}: ` +
            `${g.spec.expect.length - g.missing.length}/${g.spec.expect.length} facts, ` +
            `${g.cited} cite(s), ${g.res.elapsed_ms}ms, cache=${g.res.metadata?.cache_hit}`).join(' · '));

    // R4 — §4 hard ceiling, printed before and after every writing task.
    row('R4', Number(stats.db_mb) <= DB_CEILING_MB ? 'GREEN' : 'RED',
        `db ${stats.db_mb}MB / ${DB_CEILING_MB}MB · chunks ${stats.chunks_mb}MB/${stats.chunks_rows} rows · ` +
        `financials ${stats.financials_mb}MB/${stats.financials_rows} rows`);

    // R10 — spend is cumulative across runs or it is not a budget.
    const ledger = existsSync(SPEND_LEDGER) ? JSON.parse(readFileSync(SPEND_LEDGER, 'utf8')) : { total_usd: 0, runs: 0 };
    ledger.total_usd = Number((ledger.total_usd + spend).toFixed(4));
    ledger.runs += 1;
    ledger.last_run = new Date().toISOString();
    writeFileSync(SPEND_LEDGER, JSON.stringify(ledger, null, 2) + '\n');
    row('R10', spend <= RUN_SPEND_CAP && ledger.total_usd <= TOTAL_SPEND_CAP ? 'GREEN' : 'RED',
        `this run $${spend.toFixed(4)} · cumulative $${ledger.total_usd.toFixed(4)} / $${TOTAL_SPEND_CAP} over ${ledger.runs} run(s)`);

    // R1 is this probe existing and exiting non-zero on any RED. It is green by
    // construction once the run completes — the rows above are what can fail.
    row('R1', 'GREEN', `${TARGET} · ${BASE} · ${rows.length} rows measured`);
} catch (err) {
    console.error(`\nsearch-probe: run failed against ${BASE}\n  ${err.message}`);
    if (TARGET === 'local') console.error('  (start it: npm run gravity:api — or measure prod with --target prod)');
    process.exit(2);
}

// Rows owned by later tasks. Named, not silently skipped: a row that disappears
// when it is inconvenient is how a gate shrinks.
row('R5', 'PENDING', 'dense channel — owned by GS-5');
row('R6', 'PENDING', 'prose ticker coverage — owned by GS-6');
row('R7', 'PENDING', 'FinanceBench dev split — owned by GS-7');
row('R8', 'PENDING', 'dark-channel history needs 3 runs — owned by GS-8');
row('R9', 'PENDING', 'agentic path — owned by GS-9');

// Red splits two ways against §7: a row nobody has been asked to fix yet is a
// finding, and a row whose owner is closed is a lie in the ledger.
const red = rows.filter(r => r.state === 'RED');
const fatal = red.filter(r => !OWNER[r.id] || closed.has(OWNER[r.id]));
const known = red.filter(r => !fatal.includes(r));

if (JSON_OUT) {
    console.log(JSON.stringify({ target: TARGET, base: BASE, spend_usd: spend, fatal: fatal.map(r => r.id), rows }, null, 2));
} else {
    console.log(`\nsearch-probe · ${TARGET} · ${BASE}\n`);
    for (const r of rows.sort((a, b) => Number(a.id.slice(1)) - Number(b.id.slice(1)))) {
        const open = known.includes(r) ? ` (open: ${OWNER[r.id]})` : '';
        const mark = r.state === 'GREEN' ? '✓' : r.state === 'RED' ? (open ? '!' : '✗') : '·';
        console.log(`  ${mark} ${r.id.padEnd(4)} ${(r.state + open).padEnd(18)} ${r.detail}`);
    }
    console.log(`\n${'-'.repeat(60)}`);
    console.log(`${rows.filter(r => r.state === 'GREEN').length} green, ${fatal.length} fatal, ` +
        `${known.length} known-open, ${rows.filter(r => r.state === 'PENDING').length} pending · ` +
        `$${spend.toFixed(4)} this run`);
    if (fatal.length) console.log(`§9 KILL — halt the loop. ${fatal.map(r => r.id).join(', ')} red with its owner closed.`);
}
process.exit(fatal.length ? 1 : 0);
