// TNH-3: per-company deep daily OHLCV → tn_deep_daily.json blob, keyed by ISIN.
// Source: TSE historique/market_resume.ndjson — real OHLCV per session
// (coursOuvert/plusHaut/plusBas/cloture/quantites). 2026 = daily, 2025 =
// month-end snapshots (each a real single session, NOT a monthly aggregate).
// NO fabricated bars, no interpolation. Env from repo-root .env.
import { readFileSync } from 'node:fs';

for (const line of readFileSync(new URL('../../../.env', import.meta.url), 'utf8').split('\n')) {
  const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2].trim().replace(/^"|"$/g, '');
}
const SUPA = process.env.SUPABASE_URL, SKEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!SUPA || !SKEY) throw new Error('missing supabase env');

const SRC = 'https://tunis-stockexchange.com/sites/default/files/historique/data_json/market_resume.ndjson';
const BLOB = `${SUPA}/storage/v1/object/market-data/tn_deep_daily.json`;
const H = { apikey: SKEY, Authorization: `Bearer ${SKEY}` };

console.log('downloading market_resume.ndjson (~156MB)…');
const txt = await (await fetch(SRC, { headers: { 'User-Agent': 'Mozilla/5.0' } })).text();
const lines = txt.split('\n').filter(Boolean);
console.log(`sessions: ${lines.length}`);

const num = (v) => { const n = parseFloat(v); return Number.isFinite(n) ? n : null; };
// { isin: { name, bars: { date: [o,h,l,c,v] } } }
const out = {};
for (const l of lines) {
  let o; try { o = JSON.parse(l); } catch { continue; }
  const d = o.seance;
  for (const r of o.data || []) {
    const isin = r.codeISIN; if (!isin) continue;
    const c = num(r.cloture); if (c == null) continue;      // no close = no trade that session → skip (honest)
    const open = num(r.coursOuvert) ?? c, hi = num(r.plusHaut) ?? c, lo = num(r.plusBas) ?? c, vol = num(r.quantites) ?? 0;
    (out[isin] ||= { name: r.mnemo || r.valeur || isin, bars: {} }).bars[d] = [open, hi, lo, c, vol];
  }
}

// Coverage histogram: per-ISIN [firstDate, lastDate, nBars]; year spread.
const rows = Object.entries(out).map(([isin, e]) => { const ds = Object.keys(e.bars).sort(); return { isin, name: e.name, n: ds.length, first: ds[0], last: ds.at(-1) }; });
rows.sort((a, b) => b.n - a.n);
const y2025 = rows.filter((r) => r.first < '2026-01-01').length;
console.log(`ISINs: ${rows.length}  (with 2025 history: ${y2025})`);
console.log('top5:', rows.slice(0, 5).map((r) => `${r.name}:${r.n}(${r.first}->${r.last})`).join('  '));
console.log('bot3:', rows.slice(-3).map((r) => `${r.name}:${r.n}(${r.first}->${r.last})`).join('  '));

if (process.argv.includes('--write')) {
  const put = await fetch(BLOB, { method: 'PUT', headers: { ...H, 'Content-Type': 'application/json', 'x-upsert': 'true' }, body: JSON.stringify({ _src: SRC, _built: new Date().toISOString().slice(0, 10), deep: out }) });
  console.log(`blob PUT: ${put.status}`);
} else {
  console.log('(dry run — pass --write to upload)');
}
