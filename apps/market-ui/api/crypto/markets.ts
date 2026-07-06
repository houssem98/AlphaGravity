// OKX public spot tickers (keyless, no auth) - V1.4 fallback when coinlore
// is down/empty. No supply/marketcap/1h/7d data on this endpoint so those
// fields default to '0' (fetchCrypto in marketsHub.ts already renders
// missing marketCap as '—', logo is built from symbol independently -
// verified both null-safe, no UI fix needed).
async function fetchOkxFallback() {
  const r = await fetch('https://www.okx.com/api/v5/market/tickers?instType=SPOT');
  const d = await r.json();
  const rows: any[] = Array.isArray(d?.data) ? d.data : [];
  const out: any[] = [];
  for (const t of rows) {
    if (!t.instId?.endsWith('-USDT')) continue;
    const symbol = t.instId.slice(0, -'-USDT'.length);
    const last = parseFloat(t.last);
    const open24h = parseFloat(t.open24h);
    if (!last || !open24h) continue;
    out.push({
      id: symbol.toLowerCase(), symbol, name: symbol, rank: 0,
      priceUsd: String(last),
      changePercent1Hr: '0',
      changePercent24Hr: String(((last - open24h) / open24h) * 100),
      changePercent7d: '0',
      marketCapUsd: '0',
      volumeUsd24Hr: t.volCcy24h || '0',
      csupply: '0', tsupply: '0', msupply: '0',
      source: 'okx',
    });
  }
  return out;
}

export default async function handler(req: any, res: any) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  try {
    const r = await fetch('https://api.coinlore.net/api/tickers/?start=0&limit=100');
    const data = await r.json();
    if (Array.isArray(data?.data) && data.data.length) {
      return res.json(data.data.map((c: any) => ({
        id: c.nameid, symbol: c.symbol, name: c.name, rank: c.rank,
        priceUsd: c.price_usd,
        changePercent1Hr: c.percent_change_1h || '0',
        changePercent24Hr: c.percent_change_24h || '0',
        changePercent7d: c.percent_change_7d || '0',
        marketCapUsd: c.market_cap_usd || '0',
        volumeUsd24Hr: c.volume24?.toString() || '0',
        csupply: c.csupply || '0', tsupply: c.tsupply || '0', msupply: c.msupply || '0',
        source: 'coinlore',
      })));
    }
    throw new Error('empty coinlore');
  } catch {
    const fallback = await fetchOkxFallback();
    if (fallback.length) return res.json(fallback);
    res.status(500).json({ error: 'crypto markets unavailable' });
  }
}
