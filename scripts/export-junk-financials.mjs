#!/usr/bin/env node
// export-junk-financials — GS-4's backup, taken before anything is deleted.
//
//   node scripts/export-junk-financials.mjs            # export + verify
//   node scripts/export-junk-financials.mjs --verify   # re-verify an existing file
//
// Exports every non-`_xbrl` row of `financials` — 309,835 of 460,578, roughly
// 130 MB of the table — as gzipped JSONL next to the corpus backup that already
// lives in Downloads. These are caption-scraped rows: `NVDA_Cost_of_revenue_
// 2026-05-20_backfill` = 39.5 carries the same metric_name as
// NVDA_CostOfRevenue_FY2026_xbrl = 62,475,000,000.
//
// It exports ALL of them, deliberately wider than the delete that follows. Only
// 298,188 sit on tickers that also have exact rows; the other 11,647 are the ONLY
// structured facts 26 companies have (SNOW, TEAM, TWLO, OKTA, EPAM, MRVL, BRK-B,
// ZM…), and deleting those would take their coverage to zero. Backing up the
// superset costs one pass and keeps that decision reversible either way.
//
// Keyset pagination on `id`, not offset: PostgREST OFFSET re-scans on every page,
// and this is 310 pages.
import { createWriteStream, existsSync, readFileSync, statSync } from 'node:fs';
import { mkdir } from 'node:fs/promises';
import { createGzip } from 'node:zlib';
import { createHash } from 'node:crypto';
import { pipeline } from 'node:stream/promises';
import { Readable } from 'node:stream';
import { createReadStream } from 'node:fs';

const OUT_DIR = 'C:/Users/unicentrale/Downloads/antigravity-corpus-backup';
const OUT_FILE = `${OUT_DIR}/financials_nonxbrl.jsonl.gz`;
const PAGE = 1000;
const EXPECTED = 309_835;   // measured 2026-08-17

const env = Object.fromEntries(
    [...readFileSync('services/gravity-api/.env', 'utf8').matchAll(/^([A-Z_]+)=(.*)$/gm)]
        .map(m => [m[1], m[2].trim()]));
const URL_BASE = env.SUPABASE_URL, KEY = env.SUPABASE_SERVICE_ROLE_KEY;
if (!URL_BASE || !KEY) { console.error('SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY missing'); process.exit(2); }

const sha256 = (path) => new Promise((res, rej) => {
    const h = createHash('sha256');
    const s = createReadStream(path);
    s.on('data', d => h.update(d)); s.on('end', () => res(h.digest('hex'))); s.on('error', rej);
});

async function* rows() {
    let after = '';
    let n = 0;
    for (;;) {
        const params = new URLSearchParams({ select: '*', order: 'id.asc', limit: String(PAGE) });
        // Two filters on one column: repeat the parameter. The `and=(…)` logic-tree
        // form cannot carry these ids — 400 PGRST100 on the first row whose id
        // contains a comma, e.g. "ADBE_Acquisitions,_net_of_cash_acquired_…", because
        // inside a logic tree the comma is the delimiter. Repeated params AND
        // together and parse the value literally.
        params.append('id', 'not.like.*_xbrl');
        // No hand-quoting. Wrapping the cursor in double quotes made the filter
        // `id > '"ADBE_…"'`, and `"` sorts below every alphanumeric, so EVERY row
        // matched and the same first page came back forever — 955 MB of duplicates
        // before it was killed. URLSearchParams percent-encodes the commas, which
        // is all a simple (non-logic-tree) filter needs.
        if (after) params.append('id', `gt.${after}`);
        const url = `${URL_BASE}/rest/v1/financials?${params}`;
        const res = await fetch(url, {
            headers: { apikey: KEY, Authorization: `Bearer ${KEY}` },
            signal: AbortSignal.timeout(120_000),
        });
        if (!res.ok) throw new Error(`page after "${after}": ${res.status} ${(await res.text()).slice(0, 200)}`);
        const batch = await res.json();
        if (batch.length === 0) return;
        for (const r of batch) yield JSON.stringify(r) + '\n';
        n += batch.length;
        const next = batch[batch.length - 1].id;
        // A pagination loop with no progress check is an unbounded write. Both
        // guards exist because the cursor silently stopped advancing once.
        if (next === after) throw new Error(`cursor did not advance past "${after}" — pagination is looping`);
        if (n > EXPECTED * 1.05) throw new Error(`read ${n} rows, more than 105% of the expected ${EXPECTED} — refusing to keep writing`);
        after = next;
        if (n % 20_000 === 0) console.log(`  ${n.toLocaleString()} rows…`);
        if (batch.length < PAGE) return;
    }
}

if (process.argv.includes('--verify')) {
    if (!existsSync(OUT_FILE)) { console.error(`missing ${OUT_FILE}`); process.exit(1); }
    console.log(`${OUT_FILE}\n  ${(statSync(OUT_FILE).size / 1048576).toFixed(1)} MB\n  sha256 ${await sha256(OUT_FILE)}`);
    process.exit(0);
}

await mkdir(OUT_DIR, { recursive: true });
let written = 0;
const counted = async function* () { for await (const line of rows()) { written++; yield line; } };

await pipeline(Readable.from(counted()), createGzip({ level: 9 }), createWriteStream(OUT_FILE));

const mb = (statSync(OUT_FILE).size / 1048576).toFixed(1);
const digest = await sha256(OUT_FILE);
console.log(`\n${OUT_FILE}`);
console.log(`  rows    ${written.toLocaleString()} (expected ${EXPECTED.toLocaleString()})`);
console.log(`  size    ${mb} MB gzipped`);
console.log(`  sha256  ${digest}`);

if (written !== EXPECTED) {
    console.error(`\nROW COUNT MISMATCH — exported ${written}, expected ${EXPECTED}.`);
    console.error('Do not delete anything against this file.');
    process.exit(1);
}
console.log('\nexport verified — the row count matches the measurement the delete is based on');
