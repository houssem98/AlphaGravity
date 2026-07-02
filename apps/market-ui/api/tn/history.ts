// Daily OHLC candles for a BVMT listing, read from the Storage snapshot blob
// that /api/tn/snapshot accumulates. Empty until the first post-close run.
const UA = { 'User-Agent': 'Mozilla/5.0' };
const GROUPS = 'https://www.bvmt.com.tn/rest_api/rest/market/groups/11,12,52,95,99';

export default async function handler(req: any, res: any) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Cache-Control', 's-maxage=1800, stale-while-revalidate=86400');
  const symbol = String(req.query.symbol || '').toUpperCase();
  let isin = String(req.query.isin || '');
  if (!symbol && !isin) return res.status(400).json({ error: 'symbol or isin required' });
  const url = process.env.SUPABASE_URL, key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return res.status(500).json({ error: 'supabase env missing' });
  try {
    if (!isin) {
      const g = await (await fetch(GROUPS, { headers: UA })).json();
      const row = (g?.markets || []).find((m: any) => m?.referentiel?.ticker?.toUpperCase() === symbol);
      isin = row?.isin || row?.referentiel?.isin || '';
      if (!isin) return res.status(404).json({ error: `unknown ticker ${symbol}` });
    }
    const r = await fetch(`${url}/storage/v1/object/market-data/tn_daily.json`,
      { headers: { apikey: key, Authorization: `Bearer ${key}` } });
    const blob = r.ok ? await r.json() : {};
    const bars = blob[isin]?.b || {};
    const candles = Object.entries(bars)
      .map(([d, v]: [string, any]) => ({
        time: Math.floor(Date.parse(d) / 1000),
        open: v[0], high: v[1], low: v[2], close: v[3], volume: v[4],
      }))
      .sort((a, b) => a.time - b.time);
    res.json({ symbol, isin, candles });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
}
