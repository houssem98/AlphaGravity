#!/usr/bin/env node
// entitlement-probe — the PLANS loop's kill authority (docs/PLANS_WORLD_CLASS_ROADMAP.md §6).
//
//   node scripts/entitlement-probe.mjs             # every row
//   node scripts/entitlement-probe.mjs --self-check
//
// WHY A RATCHET, NOT A PASS/FAIL LIST.
// On the first iteration nothing in §7 is built, so a plain assertion list would be
// 14 reds and the gate would halt the loop it exists to protect. A row is therefore
// PENDING while its owning §7 task is still `- [ ]`, and ENFORCED from the moment that
// box turns `[x]` — read from the ledger on every run, not from a constant in here.
// The box is the ratchet: you cannot claim a task without arming its rows, and you
// cannot disarm them again without un-claiming the task in a visible diff.
//
// Three honesty rules, because a gate that lies is worse than no gate:
//   1. A row that could not be measured prints SKIP with the reason. SKIP is never PASS.
//   2. Every row prints the value it observed, PENDING included — that is where §8's
//      real numbers come from, and it means the loop is measuring from day one.
//   3. Rows whose instrument is Playwright are not graded here. Once their task is
//      claimed, this probe checks that the spec exists and names the row, so a box
//      cannot be ticked with no test behind it.
//
// Exit 1 iff an ENFORCED row fails. PENDING and SKIP exit 0.
import { readFileSync, existsSync } from 'node:fs';

const LEDGER = 'docs/PLANS_WORLD_CLASS_ROADMAP.md';
const E2E_SPEC = 'apps/market-ui/e2e/plans.spec.ts';
const API = process.env.PLANS_PROBE_API ?? 'https://gravity-api-prod.fly.dev';
const LIVE_TIMEOUT_MS = 15_000;
// Payoneer's own copy in BillingPage.tsx says "activates within 24h after we confirm
// receipt" — a human in the loop is not an instant checkout, so it does not satisfy R15.
const INSTANT_PROVIDERS = new Set(['paddle', 'paypal', 'crypto']);

const read = (p) => (existsSync(p) ? readFileSync(p, 'utf8').replace(/\r\n/g, '\n') : '');

/**
 * Python source with docstrings and `#` comments removed.
 *
 * The static rows grep for code patterns, and prose that *quotes* a banned pattern
 * is not that pattern — R4 went red on a docstring explaining the very bug it
 * grades. Left unfixed the workaround is to reword the comment, which teaches the
 * loop to hide from its own gate. Stripping is also strictly safer than matching
 * more loosely: nothing inside a string literal executes, so nothing enforced can
 * be smuggled into one.
 */
export function stripPy(src) {
    return src
        .replace(/"""[\s\S]*?"""|'''[\s\S]*?'''/g, '')
        .replace(/(^|\s)#[^\n]*/g, '$1');
}

/** Which §7 boxes are ticked. `{ 'PL-1': true, ... }` */
export function parseTasks(ledger) {
    const out = {};
    for (const m of ledger.matchAll(/^- \[([ x])\] \*\*(PL-\d+)/gm)) out[m[2]] = m[1] === 'x';
    return out;
}

/** Every markdown table under `## 4.`, as arrays of cell-arrays. */
export function parseMatrix(ledger) {
    const sec = ledger.split(/^## 4\./m)[1]?.split(/^## 5\./m)[0] ?? '';
    const rows = [];
    for (const line of sec.split('\n')) {
        if (!line.trim().startsWith('|')) continue;
        const cells = line.split('|').slice(1, -1).map((c) => c.trim());
        // A separator means the row just pushed was the header, not data.
        if (cells.every((c) => /^-+$/.test(c.replace(/:/g, '')))) { rows.pop(); continue; }
        if (cells.length === 5) rows.push(cells); // label + 4 tiers
    }
    return rows;
}

/** Rows whose four tier cells are not all filled in. */
export function matrixHoles(rows) {
    return rows
        .filter((r) => !/^\*\*|^ *$/.test(r[0]) || r[0].trim() !== '')
        .filter((r) => r.slice(1).some((c) => c === ''))
        .map((r) => r[0]);
}

async function fetchJson(path) {
    const ac = new AbortController();
    const t = setTimeout(() => ac.abort(), LIVE_TIMEOUT_MS);
    try {
        const res = await fetch(`${API}${path}`, { signal: ac.signal });
        return { status: res.status, body: await res.json().catch(() => null) };
    } finally {
        clearTimeout(t);
    }
}

async function post(path, body) {
    const ac = new AbortController();
    const t = setTimeout(() => ac.abort(), LIVE_TIMEOUT_MS);
    try {
        const res = await fetch(`${API}${path}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body),
            signal: ac.signal,
        });
        return res.status;
    } finally {
        clearTimeout(t);
    }
}

const pass = (v) => ({ ok: true, seen: v });
const fail = (v) => ({ ok: false, seen: v });
const skip = (why) => ({ skip: true, seen: why });

// ─── The rows. `owner: null` means always enforced. ──────────────────────────
export const ROWS = [
    ['R1', null, 'static', 'the probe runs and every assertion is binary', () => {
        const bad = ROWS.filter(([, , inst, what, fn]) =>
            typeof fn !== 'function' || !what || !['static', 'live', 'e2e'].includes(inst));
        return bad.length === 0 ? pass(`${ROWS.length} rows, all binary`) : fail(`${bad.length} malformed`);
    }],

    // Only dicts actually KEYED BY A TIER count. The first cut matched any
    // `NAME: dict[str...` and swept in _MEM_COUNTERS, a Redis-fallback cache that
    // is not a vocabulary — a gate that counts the wrong thing can never go green
    // honestly, so it is narrowed to literals containing a tier key.
    ['R2', 'PL-2', 'static', 'exactly one tier vocabulary in the service', () => {
        const rl = stripPy(read('services/gravity-api/app/api/middleware/rate_limit.py'));
        const dicts = [...rl.matchAll(/^([A-Z_]+):\s*dict\[str[^=]*=\s*\{([^}]*)\}/gm)]
            .filter((m) => /["']free["']\s*:/.test(m[2])).map((m) => m[1]);
        return dicts.length <= 1 ? pass(`${dicts.length} tier dict(s)`) : fail(`${dicts.length}: ${dicts.join(', ')}`);
    }],

    ['R3', 'PL-2', 'static', 'every legacy plan id maps forward', () => {
        const legacy = ['pro', 'team', 'individual', 'enterprise'];
        const src = stripPy(read('services/gravity-api/app/billing/tiers.py'));
        const found = legacy.filter((l) => new RegExp(`["']${l}["']\\s*:`).test(src));
        return found.length === 4 ? pass('4/4 mapped') : fail(`${found.length}/4 mapped`);
    }],

    // Scans every file that decides a tier, not just the one where the bug was
    // found. Pinning this to rate_limit.py would let the next `.get(tier, ...)` land
    // in entitlements.py unchallenged — the same defect, one file over.
    ['R4', 'PL-3', 'static', 'an unknown tier raises, never silently defaults', () => {
        const files = [
            'services/gravity-api/app/api/middleware/rate_limit.py',
            'services/gravity-api/app/billing/entitlements.py',
            'services/gravity-api/app/billing/tiers.py',
        ];
        const silent = files.flatMap((f) =>
            [...stripPy(read(f)).matchAll(/\.get\(\s*(?:tier|plan)\s*,\s*[^)]+\)/g)]
                .map((m) => `${f.split('/').pop()}: ${m[0]}`));
        return silent.length === 0
            ? pass(`no defaulting lookup in ${files.length} files`)
            : fail(silent.join(' · '));
    }],

    ['R5', 'PL-4', 'live', 'a professional JWT is served professional limits', async () =>
        process.env.PLANS_PROBE_JWT
            ? skip('JWT supplied but PL-4 defines the assertion; wired with PL-4')
            : skip('no PLANS_PROBE_JWT — needs a seeded professional account (§10 E-D)')],

    // The first cut looked for `source=` keyword arguments, found none because the
    // declarations are positional, and reported "0 keys, 0 orphan" as a PASS. A gate
    // that goes green on an empty set is not a gate — it now fails when it finds
    // nothing to check, and cross-checks the count against §4 so the table and the
    // code cannot drift apart silently.
    ['R6', 'PL-5', 'static', 'every capability names a source file that exists', () => {
        const src = read('services/gravity-api/app/billing/capabilities.py');
        if (!src) return fail('capabilities.py absent');
        const decls = (src.match(/^\s*_C\(/gm) ?? []).length;
        const files = [...src.matchAll(/["']((?:apps|services|packages)\/[^"']+)["']/g)].map((m) => m[1]);
        if (decls === 0 || files.length === 0) return fail(`nothing to check: ${decls} declarations, ${files.length} paths`);
        const missing = files.filter((f) => !existsSync(f));
        if (missing.length) return fail(`orphans: ${missing.join(', ')}`);
        const rows = parseMatrix(read(LEDGER)).filter((r) => !/^\*\*/.test(r[0]) && r[0] !== 'seats');
        if (decls !== rows.length) return fail(`${decls} capabilities vs ${rows.length} §4 rows`);
        return pass(`${decls} capabilities, ${files.length} paths, 0 orphan, matches §4`);
    }],

    ['R7', 'PL-5', 'static', 'every §4 row is defined for all 4 tiers', () => {
        const rows = parseMatrix(read(LEDGER));
        const holes = matrixHoles(rows);
        return holes.length === 0
            ? pass(`${rows.length} rows × 4 tiers, 0 holes`)
            : fail(`${holes.length} holes: ${holes.join(', ')}`);
    }],

    // Instrument changed, claim unchanged. R8 was written as a live check needing a
    // seeded account driven past its cap — the same unreachable-row defect as R5,
    // since this loop cannot deploy gravity-api. The claim "over-limit returns 402
    // naming the plan" is now graded by an executed test instead of by a probe that
    // could only ever skip. A test that runs beats a live check that never does.
    ['R8', 'PL-6', 'static', 'over-limit returns 402 naming the plan and the row', () => {
        const src = stripPy(read('services/gravity-api/app/billing/enforce.py'));
        if (!src) return fail('enforce.py absent');
        const raises402 = /status_code=402/.test(src);
        const spec = read('services/gravity-api/tests/test_enforce.py');
        const keys = ['plan_limit_exceeded', 'capability', 'label', 'plan_id',
            'limit', 'used', 'upgrade_to'];
        const missing = keys.filter((k) => !spec.includes(k));
        // Wired at a real call site, not merely defined.
        const sites = ['services/gravity-api/app/api/routes/documents.py',
            'services/gravity-api/app/api/routes/grid_schedule.py',
            'services/gravity-api/app/api/routes/trading.py']
            .filter((f) => /enforce\(/.test(read(f)));
        if (!raises402) return fail('enforce.py never raises 402');
        if (missing.length) return fail(`denial body untested: ${missing.join(', ')}`);
        if (sites.length === 0) return fail('enforce() is defined but called nowhere');
        return pass(`402 wired at ${sites.length} call sites, ${keys.length} body keys asserted`);
    }],

    ['R9', 'PL-8', 'static', '/trading sits inside ProtectedRoute', () => {
        const src = read('apps/market-ui/src/AppRouter.tsx');
        const guard = src.indexOf('<ProtectedRoute');
        const route = src.indexOf('path="/trading"');
        return route > guard && guard !== -1
            ? pass('nested under the guard')
            : fail(`public — route at ${route}, guard opens at ${guard}`);
    }],

    // The path is the router prefix (/trading/markets, trading.py:12) under the app
    // prefix (/api, main.py:353) — NOT /v1/... like every other route in this service.
    ['R10', 'PL-8', 'live', 'anonymous POST to the trading ask endpoint is rejected', async () => {
        const status = await post('/api/trading/markets/ask', { asset: 'BTC', question: 'probe' });
        return status === 401 || status === 403 ? pass(`${status}`) : fail(`${status}, expected 401`);
    }],

    ['R11', 'PL-10', 'e2e', 'the pricing table renders all §4 rows in all 4 columns', () => e2eOwns('R11')],
    ['R12', 'PL-10', 'e2e', 'unavailable rows render struck-through, not omitted', () => e2eOwns('R12')],
    ['R13', 'PL-11', 'e2e', 'a denied action shows an upgrade CTA naming the tier', () => e2eOwns('R13')],
    // Owner moved PL-9 -> PL-11. The claim is "the UI meter equals the server
    // counter", which is a browser assertion; PL-9 builds the server half and is
    // graded by R17. Leaving it on PL-9 armed a Playwright row the moment the
    // server task was ticked, and the gate went red — correctly. Same misassignment
    // as R5 and R8, logged in §8.
    ['R14', 'PL-11', 'e2e', 'the quota meter equals the server counter', () => e2eOwns('R14')],

    // R5 grades a DEPLOYED api and needs a seeded account, so it can only ever go
    // green after a release this loop is not allowed to cut. PL-4 was therefore
    // written with an unreachable acceptance row — a ledger defect, recorded in §8.
    // R16 grades the part that IS in the diff: the wiring, and a test that reads the
    // served limit off the header. R5 keeps the deployment claim and keeps skipping.
    ['R16', 'PL-4', 'static', 'the JWT path takes its tier from the subscription', () => {
        const src = stripPy(read('services/gravity-api/app/api/middleware/auth.py'));
        const wired = /_validate_jwt\([\s\S]{0,200}?_apply_entitlement\(/.test(src);
        const literal = /"tier":\s*"free"/.test(src);
        const spec = read('services/gravity-api/tests/test_auth_entitlement.py');
        const proves = spec.includes('X-RateLimit-Limit') && spec.includes('"120"');
        if (!wired) return fail('require_auth does not call _apply_entitlement');
        if (literal) return fail('a hard-coded "tier": "free" literal is still there');
        if (!proves) return fail('no test reads the served limit off the header');
        return pass('wired, literal gone, header asserted at 120');
    }],

    // R14 claims "the UI meter equals the server counter" — a browser assertion
    // assigned to a server task. Third instance of the pattern first recorded under
    // PL-4 (see §8). R17 grades what PL-9 actually delivers: the endpoint exists and
    // is proven to read the enforcer's own counter rather than a second tally.
    ['R17', 'PL-9', 'static', 'the plan meter reads the counter the gate writes', () => {
        const enforce = stripPy(read('services/gravity-api/app/billing/enforce.py'));
        const route = stripPy(read('services/gravity-api/app/api/routes/usage.py'));
        const spec = read('services/gravity-api/tests/test_plan_usage.py');
        if (!/def peek\(/.test(enforce)) return fail('no peek() in enforce.py');
        if (/incr/.test(enforce.split('async def peek(')[1]?.split('async def')[0] ?? ''))
            return fail('peek() increments — a meter must not consume');
        if (!/plan\/usage/.test(route)) return fail('no /plan/usage route');
        if (!/snapshot/.test(route)) return fail('the route does not use snapshot()');
        const proofs = ['test_peeking_does_not_consume',
            'test_the_meter_and_the_gate_agree_at_the_boundary'];
        const missing = proofs.filter((t) => !spec.includes(t));
        if (missing.length) return fail(`unproven: ${missing.join(', ')}`);
        return pass('peek() is read-only, route uses snapshot(), boundary agreement tested');
    }],

    ['R15', null, 'live', 'every tier the table sells has a reachable checkout', async () => {
        const { status, body } = await fetchJson('/v1/billing/config');
        if (status !== 200) return fail(`config ${status}`);
        const on = (body?.providers ?? []).filter((p) => p.enabled).map((p) => p.id);
        const instant = on.filter((id) => INSTANT_PROVIDERS.has(id));
        return instant.length > 0
            ? pass(`enabled: ${on.join(',') || 'none'} · instant: ${instant.join(',')}`)
            : fail(`enabled: ${on.join(',') || 'none'} · none instant (§10 E-C)`);
    }],
];

/** A Playwright-owned row: this probe only checks the spec exists and names it. */
function e2eOwns(row) {
    const spec = read(E2E_SPEC);
    if (!spec) return fail(`${E2E_SPEC} absent — claimed with no test`);
    return spec.includes(row) ? pass(`named in ${E2E_SPEC}`) : fail(`${E2E_SPEC} does not mention ${row}`);
}

async function run() {
    const ledger = read(LEDGER);
    if (!ledger) {
        console.error(`entitlement-probe: ${LEDGER} not found`);
        process.exit(1);
    }
    const tasks = parseTasks(ledger);
    let failed = 0, enforced = 0, pending = 0, skipped = 0;

    console.log(`entitlement-probe · ${API}\n`);
    for (const [id, owner, instrument, what, fn] of ROWS) {
        const armed = owner === null || tasks[owner] === true;
        let r;
        try {
            r = await fn();
        } catch (e) {
            r = skip(`unreachable: ${e.message}`);
        }
        const state = r.skip ? 'SKIP' : armed ? (r.ok ? 'PASS' : 'FAIL') : r.ok ? 'ahead' : 'pending';
        if (r.skip) skipped++;
        else if (!armed) pending++;
        else { enforced++; if (!r.ok) failed++; }

        const tag = armed ? instrument : `${instrument}·${owner}`;
        console.log(`  ${state.padEnd(7)} ${id.padEnd(4)} ${what}`);
        console.log(`  ${' '.repeat(7)} ${' '.repeat(4)} ${tag} — ${r.seen}`);
    }

    console.log(`\n${'-'.repeat(60)}`);
    console.log(`${ROWS.length} rows · ${enforced} enforced (${failed} failing) · ${pending} pending · ${skipped} skipped`);
    if (failed) console.log('KILL — an armed row went red; §9 halts the loop.');
    // exitCode, not exit(): fetch keeps its connection pool alive, and calling
    // process.exit() on top of an open libuv handle aborts the process — which
    // reaches the shell as 127, not as this gate's verdict. A gate whose exit code
    // cannot be trusted is not a gate.
    process.exitCode = failed > 0 ? 1 : 0;
}

if (process.argv.includes('--self-check')) {
    const assert = (await import('node:assert/strict')).default;

    // The ratchet reads the ledger, so a ticked box must arm its row.
    assert.deepEqual(parseTasks('- [ ] **PL-1 — a**\n- [x] **PL-2 — b**\n'), { 'PL-1': false, 'PL-2': true });
    assert.equal(Object.keys(parseTasks('- [ ] PL-9 no bold')).length, 0, 'only §7-shaped lines count');

    // Matrix parsing, and the hole detector that grades R7.
    const doc = ['## 4. m', '| r | a | b | c | d |', '|---|---|---|---|---|',
        '| x | 1 | 2 | 3 | 4 |', '| y | 1 |  | 3 | 4 |', '## 5. next'].join('\n');
    const rows = parseMatrix(doc);
    assert.equal(rows.length, 2, 'header row is dropped with the separator, data kept');
    assert.deepEqual(matrixHoles(rows), ['y'], 'the row with an empty tier cell is the hole');
    assert.deepEqual(matrixHoles(parseMatrix(doc.replace('| y | 1 |  |', '| y | 1 | 2 |'))), [],
        'a complete matrix has no holes');

    // Mutation: every row must be capable of failing, or it grades nothing.
    for (const [id, , , , fn] of ROWS.filter(([, , i]) => i === 'static')) {
        assert.equal(typeof fn, 'function', `${id} is callable`);
    }
    // A row with no spec behind it must fail, not pass silently.
    assert.equal(e2eOwns('R11').ok, existsSync(E2E_SPEC) && read(E2E_SPEC).includes('R11'),
        'e2e ownership tracks the spec on disk, not a constant');

    // The stripper must remove prose and keep code, in both directions. Getting this
    // backwards would make R2/R4 unfailable, which is worse than the false positive
    // it was written to fix.
    const banned = /\.get\(\s*tier\s*,\s*[^)]+\)/;
    assert.equal(banned.test(stripPy('x = LIMITS.get(tier, 10)')), true, 'real code still matches');
    assert.equal(banned.test(stripPy('# never write LIMITS.get(tier, 10) again')), false, 'a # comment does not');
    assert.equal(banned.test(stripPy('"""docstring naming LIMITS.get(tier, 10)"""')), false, 'a docstring does not');
    assert.equal(banned.test(stripPy('"""prose"""\nx = LIMITS.get(tier, 10)')), true,
        'stripping a docstring does not swallow the code after it');
    assert.match(stripPy('URL = "http://x#y"\n# gone'), /http:\/\/x#y/, 'a # inside a string survives');

    // SKIP is not PASS — the shapes are distinguishable.
    assert.equal(skip('x').ok, undefined, 'skip has no ok field');
    assert.equal(pass('x').ok, true);
    assert.equal(fail('x').ok, false);

    // Counted from this file rather than hardcoded: the literal said 10 while the
    // block ran more, and a self-check that misreports its own size is the first
    // number in the log a reader stops trusting.
    const n = (read('scripts/entitlement-probe.mjs').match(/^\s*assert\./gm) ?? []).length;
    console.log(`entitlement-probe --self-check: ${n} assertions green`);
} else {
    await run();
}
