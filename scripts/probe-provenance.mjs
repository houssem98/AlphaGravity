#!/usr/bin/env node
// probe-provenance — CT2-2. Measures whether a financials figure can be linked to
// a filing BY ID, and changes nothing.
//
//   node scripts/probe-provenance.mjs                 # NVDA against prod
//   node scripts/probe-provenance.mjs AAPL MSFT
//
// docs/COMMAND_TERMINAL_V2_ROADMAP.md §5 P1 says the id is "absent from the
// response, present in the table". This probe asks the three questions rows R2
// and R3 need answered before CT2-3 ships any UI:
//
//   1. does GET /v1/company/{t}/financials return document_id at all?
//   2. what document_id values does the financials TABLE actually hold?
//   3. how many of those resolve against GET /v1/company/{t}/filings?
//
// §3 rule 1: resolution is an id lookup. A period match is not a citation, so
// this probe never compares dates — only string identity of ids.
import { readFileSync } from 'node:fs';

const API = process.env.GRAVITY_API_URL ?? 'https://gravity-api-prod.fly.dev';
const KEY = process.env.GRAVITY_API_KEY ?? 'eval-unlimited-fb-2026';

const env = Object.fromEntries(
    readFileSync('.env', 'utf8').split('\n')
        .map(l => l.match(/^([A-Z_][A-Z0-9_]*)=(.*)$/))
        .filter(Boolean).map(m => [m[1], m[2].trim().replace(/^["']|["']$/g, '')]));

const j = async (url, headers) => {
    const r = await fetch(url, { headers });
    const body = await r.text();
    if (!r.ok) throw new Error(`${r.status} ${url}\n${body.slice(0, 300)}`);
    return JSON.parse(body);
};

for (const ticker of (process.argv.slice(2).length ? process.argv.slice(2) : ['NVDA'])) {
    const at = new Date().toISOString();
    console.log(`\n=== ${ticker} · ${at} · ${API}`);

    const fin = await j(`${API}/v1/company/${ticker}/financials?limit=60`, { 'X-API-Key': KEY });
    const fil = await j(`${API}/v1/company/${ticker}/filings?limit=50`, { 'X-API-Key': KEY });
    const withId = fin.rows.filter(r => r.document_id);
    console.log(`R2  api financials  rows ${fin.rows.length} · with document_id ${withId.length}`
        + ` · distinct ${new Set(withId.map(r => r.document_id)).size}`
        + ` · keys [${Object.keys(fin.rows[0] ?? {}).join(',')}]`);

    const filingIds = new Set(fil.documents.map(d => d.id));
    console.log(`    api filings     documents ${fil.documents.length} · total ${fil.total}`
        + ` · sample id ${JSON.stringify(fil.documents[0]?.id ?? null)}`);

    // The table, not the response — the id the API declines to select.
    const base = `${env.SUPABASE_URL}/rest/v1/financials`;
    const q = `ticker=eq.${ticker}&document_id=like.xbrl:*&select=document_id,metric_name,period&limit=2000`;
    const table = await j(`${base}?${q}`, {
        apikey: env.SUPABASE_SERVICE_ROLE_KEY,
        Authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`,
    });
    const ids = [...new Set(table.map(r => r.document_id))];
    console.log(`    table rows      ${table.length} · distinct document_id ${ids.length}`
        + ` · sample ${JSON.stringify(ids.slice(0, 2))}`);

    // R3: id lookup, both as-stored and with the xbrl: prefix stripped, because
    // company_filings drops every id that starts with it (company.py:43).
    const strip = (s) => s.replace(/^xbrl:/, '');
    const direct = ids.filter(i => filingIds.has(i)).length;
    const stripped = ids.filter(i => filingIds.has(strip(i))).length;
    console.log(`R3  resolve         direct ${direct}/${ids.length} · prefix-stripped ${stripped}/${ids.length}`);
    if (!direct && !stripped && ids.length)
        console.log(`    → 0 resolve. company.py:43 skips document_id starting "xbrl:" and`
            + ` company.py:80 selects only those — the two sets are disjoint by construction.`);

    // If document_id is not a filing reference, is any OTHER column one? Asked
    // once, of the real row, so "no source exists" is a measurement not a guess.
    const [full] = await j(`${base}?ticker=eq.${ticker}&document_id=like.xbrl:*&select=*&limit=1`, {
        apikey: env.SUPABASE_SERVICE_ROLE_KEY,
        Authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`,
    });
    console.log(`    row columns     ${Object.keys(full ?? {}).length}: ${JSON.stringify(full)}`);
    const idish = Object.entries(full ?? {}).filter(([k, v]) =>
        /accession|document|filing_id|source|url|cik/i.test(k) && v !== null && v !== '');
    console.log(`    filing-identity columns non-null: ${idish.length ? JSON.stringify(idish) : 'none'}`);
}
