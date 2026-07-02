// Daily BVMT close snapshot → Supabase Storage (one JSON blob, no table/DDL).
// Runs via Vercel Cron after the session closes; appends today's OHLCV per ISIN.
// Idempotent per (isin, date). Manual trigger: /api/tn/snapshot?key=$CRON_SECRET
const UA = { 'User-Agent': 'Mozilla/5.0' };
const GROUPS = 'https://www.bvmt.com.tn/rest_api/rest/market/groups/11,12,52,95,99';
const FILE = 'tn_daily.json';

function store() {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const h = { apikey: key!, Authorization: `Bearer ${key}` };
  return {
    async get(): Promise<any> {
      const r = await fetch(`${url}/storage/v1/object/market-data/${FILE}`, { headers: h });
      return r.ok ? r.json() : {};
    },
    async put(body: any): Promise<number> {
      const r = await fetch(`${url}/storage/v1/object/market-data/${FILE}`, {
        method: 'POST',
        headers: { ...h, 'Content-Type': 'application/json', 'x-upsert': 'true', 'cache-control': 'max-age=0' },
        body: JSON.stringify(body),
      });
      return r.status;
    },
  };
}

export default async function handler(req: any, res: any) {
  // Auth: Vercel Cron sends `Authorization: Bearer $CRON_SECRET`; allow ?key= too.
  const secret = process.env.CRON_SECRET;
  const ok = !secret
    || req.headers.authorization === `Bearer ${secret}`
    || req.query.key === secret;
  if (!ok) return res.status(401).json({ error: 'unauthorized' });
  if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY)
    return res.status(500).json({ error: 'supabase env missing' });

  const now = new Date();
  const dow = now.getUTCDay();
  if ((dow === 0 || dow === 6) && req.query.force !== '1')
    return res.json({ skipped: 'weekend', date: now.toISOString().slice(0, 10) });

  try {
    const g = await (await fetch(GROUPS, { headers: UA })).json();
    const date = now.toISOString().slice(0, 10);
    const s = store();
    const blob = await s.get();
    let n = 0;
    for (const m of g?.markets || []) {
      const isin = m.isin || m.referentiel?.isin;
      const last = m.last || m.close || 0;
      if (!isin || last <= 0) continue;
      const prev = m.close || last;             // BVMT `open` is 0 → use prev close as the day's open proxy
      const high = m.high || last, low = m.low || last;
      blob[isin] = blob[isin] || { s: m.referentiel?.ticker || isin, b: {} };
      blob[isin].b[date] = [round(prev), round(high), round(low), round(last), m.volume || 0];
      n++;
    }
    const code = await s.put(blob);
    res.json({ ok: code === 200, date, stocks: n, storage: code });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
}

const round = (v: number) => Math.round(v * 1000) / 1000;
