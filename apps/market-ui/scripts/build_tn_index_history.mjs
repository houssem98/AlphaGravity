// TNH-2: TUNINDEX + sub-indices deep daily history → tn_index_history.json blob.
// Source: TSE historique/indices_recap.ndjson (daily, all 14 indices, floor
// 2025-01-02). currentIndex = session close; previousYearClose = a real
// 2024-12-31 anchor per index. NO invented points, no interpolation.
// Env from repo-root .env: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY.
import { readFileSync } from 'node:fs';

for (const line of readFileSync(new URL('../../../.env', import.meta.url), 'utf8').split('\n')) {
  const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2].trim().replace(/^"|"$/g, '');
}
const SUPA = process.env.SUPABASE_URL, SKEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!SUPA || !SKEY) throw new Error('missing supabase env');

const SRC = 'https://tunis-stockexchange.com/sites/default/files/historique/data_json/indices_recap.ndjson';
const BLOB = `${SUPA}/storage/v1/object/market-data/tn_index_history.json`;
const H = { apikey: SKEY, Authorization: `Bearer ${SKEY}` };

const txt = await (await fetch(SRC, { headers: { 'User-Agent': 'Mozilla/5.0' } })).text();
const lines = txt.split('\n').filter(Boolean);

// { isin: { name, levels: {date: close}, anchors: {date: close} } }
const idx = {};
for (const l of lines) {
  let o; try { o = JSON.parse(l); } catch { continue; }
  const d = o.seance;
  for (const r of o.data || []) {
    const isin = r.isinCode; if (!isin) continue;
    const lvl = parseFloat(r.currentIndex);
    const e = (idx[isin] ||= { name: r.indexName, levels: {} });
    if (Number.isFinite(lvl)) e.levels[d] = lvl;
    // previousYearClose = real end-of-prior-year close (single sourced anchor).
    const pyc = parseFloat(r.previousYearClose);
    if (Number.isFinite(pyc)) {
      const y = +d.slice(0, 4) - 1;
      (e.anchors ||= {})[`${y}-12-31`] = pyc;
    }
  }
}

// Flatten anchors into levels only where we have no same-day real close (they
// predate the feed floor), so the series stays honest: every point is sourced.
let anchorPts = 0;
for (const e of Object.values(idx)) {
  for (const [d, v] of Object.entries(e.anchors || {})) {
    if (!(d in e.levels)) { e.levels[d] = v; anchorPts++; }
  }
  delete e.anchors;
}

const out = { _src: SRC, _built: new Date().toISOString().slice(0, 10), index: idx };
const tun = idx['TN0009050014'];
const tunDates = Object.keys(tun.levels).sort();
console.log(`indices: ${Object.keys(idx).length}  anchor pts added: ${anchorPts}`);
console.log(`TUNINDEX: ${tunDates.length} pts  ${tunDates[0]}=${tun.levels[tunDates[0]]} -> ${tunDates.at(-1)}=${tun.levels[tunDates.at(-1)]}`);

if (process.argv.includes('--write')) {
  const put = await fetch(BLOB, { method: 'PUT', headers: { ...H, 'Content-Type': 'application/json', 'x-upsert': 'true' }, body: JSON.stringify(out) });
  console.log(`blob PUT: ${put.status}`);
} else {
  console.log('(dry run — pass --write to upload)');
}
