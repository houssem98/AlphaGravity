// Single Vercel function for all BVMT/Tunisia endpoints (Hobby 12-function cap).
// Dispatches on the path segment: /api/tn/markets | intraday | history | snapshot.
const UA = { 'User-Agent': 'Mozilla/5.0' };
const GROUPS = 'https://www.bvmt.com.tn/rest_api/rest/market/groups/11,12,52,95,99';
const FILE = 'tn_daily.json';

// ── Supabase Storage (JSON blob, no table/DDL) ──────────────────────────────
function store() {
  const url = process.env.SUPABASE_URL, key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const h = { apikey: key!, Authorization: `Bearer ${key}` };
  return {
    async get() {
      const r = await fetch(`${url}/storage/v1/object/market-data/${FILE}`, { headers: h });
      return r.ok ? r.json() : {};
    },
    async put(body: any) {
      const r = await fetch(`${url}/storage/v1/object/market-data/${FILE}`, {
        method: 'POST',
        headers: { ...h, 'Content-Type': 'application/json', 'x-upsert': 'true', 'cache-control': 'max-age=0' },
        body: JSON.stringify(body),
      });
      return r.status;
    },
  };
}

async function groups() { return (await fetch(GROUPS, { headers: UA })).json(); }
async function resolveIsin(symbol: string, g?: any) {
  g = g || await groups();
  const row = (g?.markets || []).find((m: any) => m?.referentiel?.ticker?.toUpperCase() === symbol);
  return { isin: row?.isin || row?.referentiel?.isin || '', name: row?.referentiel?.stockName || symbol, row };
}
const round = (v: number) => Math.round(v * 1000) / 1000;
const hms = (t: string) => { const [h = '0', m = '0', s = '0'] = String(t).split(':'); return +h * 3600 + +m * 60 + +s; };

// ── Live quotes for the whole board ─────────────────────────────────────────
async function markets(_req: any, res: any) {
  res.setHeader('Cache-Control', 's-maxage=900, stale-while-revalidate=3600');
  const d = await groups();
  const rows = (d?.markets || [])
    .filter((m: any) => m?.referentiel?.ticker)
    .map((m: any) => ({
      symbol: m.referentiel.ticker,
      name: m.referentiel.stockName || m.referentiel.ticker,
      price: m.last || m.close || 0,
      changePct: m.change || 0,
      volume: m.volume || 0,
      isin: m.isin || m.referentiel.isin || null,
      seance: m.seance || null,
      open: m.open || 0,
      high: m.high || 0,
      low: m.low || 0,
      close: m.close || 0,
      turnover: m.caps || 0,
      // BVMT swaps the field names: their `limit.bid` is the ASK, `limit.ask` the BID.
      bid: m.limit?.ask || 0,
      ask: m.limit?.bid || 0,
      bidQty: m.limit?.askQty || 0,
      askQty: m.limit?.bidQty || 0,
    }))
    .filter((x: any) => x.price > 0);
  res.json({ rows, updated: rows[0]?.seance || null });
}

// ── Intraday tick series → points + OHLC candles ────────────────────────────
async function intraday(req: any, res: any) {
  res.setHeader('Cache-Control', 's-maxage=60, stale-while-revalidate=600');
  const symbol = String(req.query.symbol || '').toUpperCase();
  let isin = String(req.query.isin || ''), name = symbol;
  if (!symbol && !isin) return res.status(400).json({ error: 'symbol or isin required' });
  if (!isin) { const r = await resolveIsin(symbol); if (!r.isin) return res.status(404).json({ error: `unknown ticker ${symbol}` }); isin = r.isin; name = r.name; }

  const d = await (await fetch(`https://www.bvmt.com.tn/rest_api/rest/intraday/${isin}`, { headers: UA })).json();
  const raw = (d?.intradays || []).filter((p: any) => p?.last > 0 && p?.time);
  const base = raw.find((p: any) => p.time === '00:00:00');
  const prevClose = base?.last ?? raw[0]?.last ?? 0;

  const dayStart = Math.floor(Date.now() / 86400_000) * 86400;
  const bySec = new Map<number, { time: number; value: number; volume: number }>();
  for (const p of raw) {
    if (p.time === '00:00:00') continue;
    const time = dayStart + hms(p.time);
    const prev = bySec.get(time);
    bySec.set(time, { time, value: p.last, volume: (prev?.volume || 0) + (p.volume || 0) });
  }
  const points = [...bySec.values()].sort((a, b) => a.time - b.time);
  const last = points.length ? points[points.length - 1].value : prevClose;

  const iv = Math.max(1, Math.min(60, +req.query.interval || 5)), step = iv * 60;
  const buckets = new Map<number, any>();
  for (const p of points) {
    const t = Math.floor(p.time / step) * step;
    const b = buckets.get(t);
    if (!b) buckets.set(t, { time: t, open: p.value, high: p.value, low: p.value, close: p.value, volume: p.volume });
    else { b.high = Math.max(b.high, p.value); b.low = Math.min(b.low, p.value); b.close = p.value; b.volume += p.volume; }
  }
  const candles = [...buckets.values()].sort((a, b) => a.time - b.time);
  res.json({
    symbol, name, isin, prevClose, last, interval: iv,
    changePct: prevClose ? ((last - prevClose) / prevClose) * 100 : 0,
    seance: d?.intradays?.[0]?.seance || null, points, candles,
  });
}

// ── Daily candles from the Storage snapshot blob ────────────────────────────
async function history(req: any, res: any) {
  res.setHeader('Cache-Control', 's-maxage=1800, stale-while-revalidate=86400');
  const symbol = String(req.query.symbol || '').toUpperCase();
  let isin = String(req.query.isin || '');
  if (!symbol && !isin) return res.status(400).json({ error: 'symbol or isin required' });
  if (!process.env.SUPABASE_URL) return res.status(500).json({ error: 'supabase env missing' });
  if (!isin) { const r = await resolveIsin(symbol); if (!r.isin) return res.status(404).json({ error: `unknown ticker ${symbol}` }); isin = r.isin; }
  const blob = await store().get();
  const bars = blob[isin]?.b || {};
  const candles = Object.entries(bars)
    .map(([dt, v]: [string, any]) => ({ time: Math.floor(Date.parse(dt) / 1000), open: v[0], high: v[1], low: v[2], close: v[3], volume: v[4] }))
    .sort((a, b) => a.time - b.time);
  res.json({ symbol, isin, candles });
}

// ── Daily close snapshot (Vercel Cron) ──────────────────────────────────────
async function snapshot(req: any, res: any) {
  const secret = process.env.CRON_SECRET;
  const ok = !secret || req.headers.authorization === `Bearer ${secret}` || req.query.key === secret;
  if (!ok) return res.status(401).json({ error: 'unauthorized' });
  if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) return res.status(500).json({ error: 'supabase env missing' });

  const now = new Date(), dow = now.getUTCDay();
  if ((dow === 0 || dow === 6) && req.query.force !== '1') return res.json({ skipped: 'weekend', date: now.toISOString().slice(0, 10) });

  const g = await groups();
  const date = now.toISOString().slice(0, 10);
  const s = store();
  const blob = await s.get();
  let n = 0;
  for (const m of g?.markets || []) {
    const isin = m.isin || m.referentiel?.isin;
    const last = m.last || m.close || 0;
    if (!isin || last <= 0) continue;
    const prev = m.close || last, high = m.high || last, low = m.low || last;
    blob[isin] = blob[isin] || { s: m.referentiel?.ticker || isin, b: {} };
    blob[isin].b[date] = [round(prev), round(high), round(low), round(last), m.volume || 0];
    n++;
  }
  const code = await s.put(blob);
  res.json({ ok: code === 200, date, stocks: n, storage: code });
}

const ROUTES: Record<string, (req: any, res: any) => Promise<any>> = { markets, intraday, history, snapshot };

export default async function handler(req: any, res: any) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  const fn = String(req.query.fn || '');
  const route = ROUTES[fn];
  if (!route) return res.status(404).json({ error: `unknown tn endpoint: ${fn}` });
  try { await route(req, res); }
  catch (e: any) { res.status(500).json({ error: e.message }); }
}
