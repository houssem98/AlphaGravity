// Live BVMT intraday tick series for one listing.
// Resolves a ticker → ISIN via the public groups feed, then pulls the
// session's trades from /rest_api/rest/intraday/{isin}. No scraping.
const UA = { 'User-Agent': 'Mozilla/5.0' };
const GROUPS = 'https://www.bvmt.com.tn/rest_api/rest/market/groups/11,12,52,95,99';

function hms(t: string): number {
  const [h = '0', m = '0', s = '0'] = String(t).split(':');
  return (+h) * 3600 + (+m) * 60 + (+s);
}

export default async function handler(req: any, res: any) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Cache-Control', 's-maxage=60, stale-while-revalidate=600');
  const symbol = String(req.query.symbol || '').toUpperCase();
  let isin = String(req.query.isin || '');
  let name = symbol;
  if (!symbol && !isin) return res.status(400).json({ error: 'symbol or isin required' });
  try {
    if (!isin) {
      const g = await (await fetch(GROUPS, { headers: UA })).json();
      const row = (g?.markets || []).find((m: any) => m?.referentiel?.ticker?.toUpperCase() === symbol);
      if (!row) return res.status(404).json({ error: `unknown BVMT ticker ${symbol}` });
      isin = row.isin || row.referentiel?.isin;
      name = row.referentiel?.stockName || symbol;
    }
    const d = await (await fetch(
      `https://www.bvmt.com.tn/rest_api/rest/intraday/${isin}`, { headers: UA },
    )).json();
    const raw = (d?.intradays || []).filter((p: any) => p?.last > 0 && p?.time);

    // Baseline = the 00:00:00 marker (previous close), else first tick.
    const base = raw.find((p: any) => p.time === '00:00:00');
    const prevClose = base?.last ?? raw[0]?.last ?? 0;

    // Collapse to one point per second (last trade wins) so timestamps are
    // strictly ascending — lightweight-charts requires it.
    const dayStart = Math.floor(Date.now() / 86400_000) * 86400; // UTC midnight, seconds
    const bySec = new Map<number, { time: number; value: number; volume: number }>();
    for (const p of raw) {
      if (p.time === '00:00:00') continue;
      const time = dayStart + hms(p.time);
      const prev = bySec.get(time);
      bySec.set(time, { time, value: p.last, volume: (prev?.volume || 0) + (p.volume || 0) });
    }
    const points = [...bySec.values()].sort((a, b) => a.time - b.time);
    const last = points.length ? points[points.length - 1].value : prevClose;

    // Bucket ticks into OHLC candles. interval in minutes (1/5/15…).
    const interval = Math.max(1, Math.min(60, +req.query.interval || 5));
    const step = interval * 60;
    const buckets = new Map<number, { time: number; open: number; high: number; low: number; close: number; volume: number }>();
    for (const p of points) {
      const t = Math.floor(p.time / step) * step;
      const b = buckets.get(t);
      if (!b) buckets.set(t, { time: t, open: p.value, high: p.value, low: p.value, close: p.value, volume: p.volume });
      else {
        b.high = Math.max(b.high, p.value);
        b.low = Math.min(b.low, p.value);
        b.close = p.value;
        b.volume += p.volume;
      }
    }
    const candles = [...buckets.values()].sort((a, b) => a.time - b.time);

    res.json({
      symbol, name, isin, prevClose, last, interval,
      changePct: prevClose ? ((last - prevClose) / prevClose) * 100 : 0,
      seance: d?.intradays?.[0]?.seance || null,
      points, candles,
    });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
}
