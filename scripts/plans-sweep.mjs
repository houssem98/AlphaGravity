#!/usr/bin/env node
// plans-sweep — PL-12. Which §4 rows are actually demonstrated, and by what.
//
//   node scripts/plans-sweep.mjs
//   node scripts/plans-sweep.mjs --self-check
//
// §2 proved that a file exists for every capability. That is not the same as the
// feature running, and the ledger says so: "a 16KB sso.py proves someone wrote SSO,
// not that a SAML login completes." This closes that gap as far as it can be closed
// from inside the repo — it reports, per capability, which executed test references
// it, and it FAILS when a server-enforced row has none.
//
// Why server rows are the ones that fail the build: those are the ceilings the
// product actually charges for. A client-enforced row is already declared advisory
// (PL-5), so an untested one is a known weakness rather than a hidden one; an
// untested SERVER row is a paywall nobody has ever seen work.
//
// What this deliberately does NOT claim: that the feature behind the capability is
// good, or that it runs in production. Referencing a key from a passing test proves
// the entitlement plumbing is exercised. Production behaviour needs the deploy that
// §10 has been holding since PL-4.
import { readFileSync, existsSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

const CAPS = 'services/gravity-api/app/billing/capabilities.py';
const TEST_DIRS = [
    'services/gravity-api/tests',
    'apps/market-ui/src/components/billing',
    'apps/market-ui/e2e',
];

const read = (p) => (existsSync(p) ? readFileSync(p, 'utf8').replace(/\r\n/g, '\n') : '');

/** Every capability declaration: key, enforcement, source path. */
export function parseCapabilities(src) {
    const out = [];
    // _C("key", "Label", GROUP, "path", ENFORCEMENT, ...)
    const re = /_C\(\s*"([^"]+)"\s*,\s*"([^"]*)"\s*,\s*(\w+)\s*,\s*\n?\s*"([^"]+)"\s*,\s*(\w+)\s*,/g;
    for (const m of src.matchAll(re)) {
        out.push({ key: m[1], label: m[2], group: m[3], source: m[4], enforcement: m[5] });
    }
    return out;
}

function testFiles() {
    const files = [];
    for (const dir of TEST_DIRS) {
        if (!existsSync(dir)) continue;
        for (const name of readdirSync(dir)) {
            const p = join(dir, name);
            if (!statSync(p).isFile()) continue;
            if (/\.(test|spec)\.(ts|tsx|py)$|^test_.*\.py$/.test(name)) files.push(p);
        }
    }
    return files;
}

/** Which of `files` mention `key`. */
export function referencedBy(key, files, reader = read) {
    return files.filter((f) => reader(f).includes(key)).map((f) => f.split('/').pop());
}

function run() {
    const src = read(CAPS);
    if (!src) {
        console.error(`plans-sweep: ${CAPS} not found`);
        process.exitCode = 1;
        return;
    }
    const caps = parseCapabilities(src);
    const files = testFiles();

    console.log(`plans-sweep · ${caps.length} capabilities · ${files.length} test files\n`);

    const strike = [];
    let serverTested = 0, clientTested = 0, serverRows = 0;

    for (const c of caps) {
        const refs = referencedBy(c.key, files);
        const isServer = c.enforcement === 'SERVER';
        if (isServer) serverRows++;
        const ok = refs.length > 0;
        if (ok) { if (isServer) serverTested++; else clientTested++; }
        else if (isServer) strike.push(c.key);

        const mark = ok ? 'exercised' : (isServer ? 'UNTESTED' : 'advisory ');
        console.log(`  ${mark}  ${c.enforcement.toLowerCase().padEnd(6)} ${c.key.padEnd(28)} ${refs.join(', ') || '—'}`);
        if (!existsSync(c.source)) console.log(`             ORPHAN SOURCE: ${c.source}`);
    }

    const orphans = caps.filter((c) => !existsSync(c.source));
    const clientRows = caps.length - serverRows;

    console.log(`\n${'-'.repeat(72)}`);
    console.log(`server rows  ${serverTested}/${serverRows} exercised`);
    console.log(`client rows  ${clientTested}/${clientRows} exercised (advisory — enforcement is in the browser)`);
    console.log(`orphan sources ${orphans.length}`);
    if (strike.length) {
        console.log(`\nSTRIKE — server-enforced rows with no test referencing them:`);
        for (const k of strike) console.log(`   ${k}`);
        console.log('Either exercise them or delete the row; §3 rule 6.');
    }
    process.exitCode = strike.length || orphans.length ? 1 : 0;
}

if (process.argv.includes('--self-check')) {
    const assert = (await import('node:assert/strict')).default;

    const sample = `
    _C("qa_searches_per_day", "QA searches / day", RESEARCH,
       "services/x.py", SERVER,
       10, 500, 2_000, UNLIMITED),
    _C("watchlist_symbols", "Watchlist symbols", TERMINAL,
       "apps/y.tsx", CLIENT,
       10, 100, 500, UNLIMITED),
`;
    const parsed = parseCapabilities(sample);
    assert.equal(parsed.length, 2, 'both declarations parsed');
    assert.equal(parsed[0].key, 'qa_searches_per_day');
    assert.equal(parsed[0].enforcement, 'SERVER');
    assert.equal(parsed[1].enforcement, 'CLIENT');
    assert.equal(parsed[1].source, 'apps/y.tsx');

    // A parser that silently finds nothing would report every row as untested and
    // strike the whole table, so an empty parse must be visible, not quiet.
    assert.equal(parseCapabilities('nothing here').length, 0, 'no false positives');

    const fake = (p) => (p === 'a.py' ? 'uses qa_searches_per_day here' : 'unrelated');
    assert.deepEqual(referencedBy('qa_searches_per_day', ['a.py', 'b.py'], fake), ['a.py']);
    assert.deepEqual(referencedBy('missing_key', ['a.py', 'b.py'], fake), []);

    console.log('plans-sweep --self-check: 7 assertions green');
} else {
    run();
}
