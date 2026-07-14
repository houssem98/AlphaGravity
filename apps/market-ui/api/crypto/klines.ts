// CP-4: venue=okx branch — OKX /market/candles proxied into the exact Binance
// kline array shape ([openTimeMs, o, h, l, c, vol]) so the chart client code
// is venue-agnostic. OKX rows come NEWEST FIRST (V3 gotcha) — reversed here.
const OKX_BAR: Record<string, string> = {
  '1m': '1m', '5m': '5m', '15m': '15m', '1h': '1H', '4h': '4H',
  '1d': '1D', '1w': '1W', '1M': '1M',
};

export default async function handler(req: any, res: any) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  const { symbol, interval = '1d', limit = '1000', venue } = req.query;
  if (!symbol) return res.status(400).json({ error: 'symbol required' });
  try {
    if (venue === 'okx') {
      // symbol arrives as {SYM}USDT (client convention) — OKX wants {SYM}-USDT
      const sym = String(symbol).toUpperCase().replace(/USDT$/, '');
      const bar = OKX_BAR[String(interval)] || '1D';
      const cap = Math.min(parseInt(String(limit), 10) || 300, 300); // OKX max 300
      const r = await fetch(`https://www.okx.com/api/v5/market/candles?instId=${sym}-USDT&bar=${bar}&limit=${cap}`);
      const j = await r.json();
      const rows: any[] = Array.isArray(j?.data) ? [...j.data].reverse() : [];
      return res.json(rows.map((k) => [Number(k[0]), k[1], k[2], k[3], k[4], k[5]]));
    }
    const r = await fetch(`https://api.binance.com/api/v3/klines?symbol=${symbol}&interval=${interval}&limit=${limit}`);
    const data = await r.json();
    res.json(data);
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
}
