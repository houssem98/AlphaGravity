// Crypto markets for the /trading tab. Primary: CoinGecko /coins/markets
// (keyless free tier — richest payload: logo image, ATH, perf 14d/30d/1y,
// exact FDV/supplies in ONE call). Fallbacks: coinlore (previous primary,
// shape preserved) then OKX. New fields are additive-only so the UI's base
// MarketData shape keeps working across all three sources (CS-2).

let cache: { at: number; rows: any[] } | null = null;
const TTL = 5 * 60 * 1000;

async function fetchCoinGecko() {
  const r = await fetch(
    'https://api.coingecko.com/api/v3/coins/markets?vs_currency=usd&order=market_cap_desc&per_page=100&page=1&sparkline=false&price_change_percentage=1h,24h,7d,14d,30d,1y',
  );
  if (!r.ok) throw new Error(`coingecko ${r.status}`);
  const data = await r.json();
  if (!Array.isArray(data) || data.length === 0) throw new Error('empty coingecko');
  return data.map((c: any, i: number) => ({
    id: c.id, symbol: (c.symbol || '').toUpperCase(), name: c.name, rank: c.market_cap_rank ?? i + 1,
    priceUsd: String(c.current_price ?? 0),
    changePercent1Hr: String(c.price_change_percentage_1h_in_currency ?? 0),
    changePercent24Hr: String(c.price_change_percentage_24h_in_currency ?? 0),
    changePercent7d: String(c.price_change_percentage_7d_in_currency ?? 0),
    marketCapUsd: String(c.market_cap ?? 0),
    volumeUsd24Hr: String(c.total_volume ?? 0),
    csupply: String(c.circulating_supply ?? 0),
    tsupply: String(c.total_supply ?? 0),
    msupply: String(c.max_supply ?? 0),
    // additive (CS-2)
    image: c.image || '',
    ath: String(c.ath ?? 0),
    athChangePct: String(c.ath_change_percentage ?? 0),
    changePercent14d: String(c.price_change_percentage_14d_in_currency ?? 0),
    changePercent30d: String(c.price_change_percentage_30d_in_currency ?? 0),
    changePercent1y: String(c.price_change_percentage_1y_in_currency ?? 0),
    fdvUsd: String(c.fully_diluted_valuation ?? 0),
    source: 'coingecko',
  }));
}

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
  if (cache && Date.now() - cache.at < TTL) return res.json(cache.rows);
  try {
    const rows = await fetchCoinGecko();
    cache = { at: Date.now(), rows };
    return res.json(rows);
  } catch { /* fall through to coinlore */ }
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
