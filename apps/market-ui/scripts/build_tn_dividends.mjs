// One-shot: post-AGO publications → PDF → dividend/share → PATCH tn_fundamentals.json.
// Every value stores its source PDF URL + AGO date. Regex first, DeepSeek fallback,
// sanity guard 0 < yield <= 15%. Honest null on ambiguity.
// Env from repo-root .env: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, DEEPSEEK_API_KEY.
import { readFileSync, writeFileSync, mkdtempSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

for (const line of readFileSync(new URL('../../../.env', import.meta.url), 'utf8').split('\n')) {
  const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2].trim().replace(/^"|"$/g, '');
}
const SUPA = process.env.SUPABASE_URL, SKEY = process.env.SUPABASE_SERVICE_ROLE_KEY, DSK = process.env.DEEPSEEK_API_KEY;
if (!SUPA || !SKEY) throw new Error('missing supabase env');

const TSE = 'https://tunis-stockexchange.com';
const UA = { 'User-Agent': 'Mozilla/5.0' };
const GRAFANA = `${TSE}/grafana/api/ds/query`;
async function gq(rawSql) {
  const r = await fetch(GRAFANA, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Referer: `${TSE}/grafana/`, ...UA },
    body: JSON.stringify({ queries: [{ refId: 'A', datasource: { uid: 'ef4kunff033eoe', type: 'grafana-postgresql-datasource' }, rawSql, format: 'table' }] }),
  });
  const raw = (await r.json())?.results?.A?.frames?.[0]?.data?.values?.[0] || [];
  return raw.map((s) => { try { return JSON.parse(s); } catch { return null; } }).filter(Boolean);
}

// 1. ALL post-AGO publications (fr), newest first — some issuers publish the
// notice twice and only one carries the PDF (BIAT/TJARI), and post-AGO rows
// hide under several types (CIL: 'Informations Post Assemblée...', TUNISAIR:
// 'Ordinaire & Extraordianire' [sic, feed typo]). Iterate per ISIN until a PDF
// yields a dividend.
const allPubs = await gq(
  `SELECT raw_data FROM raw_publications ` +
  `WHERE raw_data->>'langue'='fr' AND raw_data->>'title' ILIKE '%post assembl%' ` +
  `AND (raw_data->>'type' LIKE 'Ordinaire%' OR raw_data->>'type' LIKE 'Informations Post%') ` +
  `ORDER BY raw_data->>'date' DESC`);
const byIsinPubs = new Map();
for (const p of allPubs) (byIsinPubs.get(p.codeIsin) || byIsinPubs.set(p.codeIsin, []).get(p.codeIsin)).push(p);
const pubs = [...byIsinPubs.values()].map((l) => l[0]); // keep shape for the loop below
console.log(`post-AGO publications: ${allPubs.length} rows, ${pubs.length} isins`);

// 2. Board: isin -> {symbol, price}.
const board = (await (await fetch('https://market-ui-self.vercel.app/api/tn/board')).json()).board;
const byIsin = Object.fromEntries(board.map((b) => [b.isin, b]));

// Regex battery for "dividende ... X millimes|dinars par action" phrasings.
const RES = [
  /dividendes?[^.\n]{0,160}?fix[ée]s?\s+à\s+([\d][\d\s.,]*)\s*(millimes?|dinars?|DT|TND)\s*(?:par|l')?\s*action/i,
  /dividende\s+(?:de|d'un montant de)\s+([\d][\d\s.,]*)\s*(millimes?|dinars?|DT|TND)\s*(?:par|l')?\s*action/i,
  /distribution\s+d'un\s+dividende[^.\n]{0,120}?([\d][\d\s.,]*)\s*(millimes?|dinars?|DT|TND)\s*(?:par|l')?\s*action/i,
];
const parseAmt = (numS, unit) => {
  const n = parseFloat(numS.replace(/\s/g, '').replace(',', '.'));
  if (!isFinite(n)) return null;
  return /millime/i.test(unit) ? n / 1000 : n;
};

async function deepseekExtract(text, name) {
  if (!DSK) return null;
  const r = await fetch('https://api.deepseek.com/chat/completions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${DSK}` },
    body: JSON.stringify({
      model: 'deepseek-chat', temperature: 0,
      messages: [{ role: 'user', content:
        `Document AGO de ${name} (bourse de Tunis). Quel dividende PAR ACTION en dinars a été approuvé ? ` +
        `Réponds UNIQUEMENT par le nombre décimal en dinars (ex: 0.250) ou NULL si aucun dividende n'est mentionné/approuvé.\n\n---\n${text.slice(0, 24000)}` }],
    }),
  }).catch(() => null);
  const out = (await r?.json())?.choices?.[0]?.message?.content?.trim() || '';
  const n = parseFloat(out.replace(',', '.'));
  return isFinite(n) && n > 0 ? n : null;
}

const tmp = mkdtempSync(join(tmpdir(), 'tndiv-'));
const results = [];
for (const [isin, plist] of byIsinPubs) {
  const b = byIsin[isin];
  if (!b) continue; // not a board equity
  const row = { sym: b.symbol, name: plist[0].denomination, date: plist[0].date, div: null, how: '-', src: null };
  results.push(row);
  for (const p of plist) {
    try {
      const html = await (await fetch(p.linkPublication, { headers: UA })).text();
      const href = (html.match(/href="(\/sites\/default\/files\/[^"]+\.pdf)"/i) || [])[1];
      if (!href || /Logotype/i.test(href)) { if (row.how === '-') row.how = 'no-pdf'; continue; }
      row.src = TSE + href.replace(/&amp;/g, '&');
      row.date = p.date;
      const pdfPath = join(tmp, `${b.symbol}-${p.nid}.pdf`), txtPath = join(tmp, `${b.symbol}-${p.nid}.txt`);
      const buf = Buffer.from(await (await fetch(row.src, { headers: UA })).arrayBuffer());
      writeFileSync(pdfPath, buf);
      execFileSync('pdftotext', [pdfPath, txtPath]);
      const text = readFileSync(txtPath, 'utf8');
      for (const re of RES) {
        const m = text.match(re);
        if (m) { row.div = parseAmt(m[1], m[2]); row.how = 'regex'; break; }
      }
      if (row.div == null) {
        if (/dividende/i.test(text)) { row.div = await deepseekExtract(text, p.denomination); row.how = row.div != null ? 'deepseek' : 'miss'; }
        else if (row.how === '-' || row.how === 'no-pdf') row.how = 'no-mention';
      }
      if (row.div != null) {
        const y = (row.div / b.price) * 100;
        if (!(y > 0 && y <= 15)) { console.log(`  REJECT ${b.symbol}: div ${row.div} vs price ${b.price} -> yield ${y.toFixed(1)}% out of guard`); row.div = null; row.how += '-rejected'; }
        else break; // first document with an in-guard dividend wins (newest first)
      }
    } catch (e) { if (row.how === '-') row.how = `err:${String(e.message).slice(0, 40)}`; }
  }
}

console.log('\nticker  div(TND)  yield%   how       AGO date');
for (const r of results) {
  const b = byIsin[board.find((x) => x.symbol === r.sym)?.isin];
  const y = r.div != null && b?.price ? ((r.div / b.price) * 100).toFixed(2) : '—';
  console.log(`${r.sym.padEnd(7)} ${String(r.div ?? '—').padEnd(9)} ${String(y).padEnd(8)} ${r.how.padEnd(9)} ${r.date}`);
}
const good = results.filter((r) => r.div != null);
console.log(`\nextracted: ${good.length}/${results.length}`);

// 3. PATCH the fundamentals blob.
if (process.argv.includes('--write') && good.length) {
  const BLOB = `${SUPA}/storage/v1/object/market-data/tn_fundamentals.json`;
  const H = { apikey: SKEY, Authorization: `Bearer ${SKEY}` };
  const blob = await (await fetch(BLOB, { headers: H })).json();
  for (const r of good) {
    const b = byIsin[board.find((x) => x.symbol === r.sym)?.isin];
    const cur = blob[r.sym] || {};
    blob[r.sym] = { ...cur, dividend: r.div, yield: (r.div / b.price) * 100, divSource: r.src, divAgoDate: r.date };
  }
  const put = await fetch(BLOB, { method: 'PUT', headers: { ...H, 'Content-Type': 'application/json', 'x-upsert': 'true' }, body: JSON.stringify(blob) });
  console.log(`blob PATCH: ${put.status}`);
} else if (!process.argv.includes('--write')) {
  console.log('(dry run — pass --write to patch the blob)');
}
