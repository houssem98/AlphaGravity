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

// ---- CS-5: technicals from Binance 1d klines, hand-rolled math (no deps) ----

const sma = (a: number[], n: number) => (a.length >= n ? a.slice(-n).reduce((s, v) => s + v, 0) / n : null);

const emaSeries = (a: number[], n: number): number[] => {
  const k = 2 / (n + 1);
  let e = a[0];
  return a.map((v, i) => (e = i === 0 ? v : v * k + e * (1 - k)));
};
const ema = (a: number[], n: number) => (a.length >= n ? emaSeries(a, n)[a.length - 1] : null);

const rsiCalc = (a: number[], n = 14) => {
  if (a.length < n + 1) return null;
  let g = 0, l = 0;
  for (let i = 1; i <= n; i++) { const d = a[i] - a[i - 1]; if (d >= 0) g += d; else l -= d; }
  let ag = g / n, al = l / n;
  for (let i = n + 1; i < a.length; i++) {
    const d = a[i] - a[i - 1];
    ag = (ag * (n - 1) + Math.max(d, 0)) / n;
    al = (al * (n - 1) + Math.max(-d, 0)) / n;
  }
  return al === 0 ? 100 : 100 - 100 / (1 + ag / al);
};

const macdCalc = (a: number[]) => {
  if (a.length < 35) return { line: null as number | null, signal: null as number | null };
  const e12 = emaSeries(a, 12), e26 = emaSeries(a, 26);
  const m = a.map((_, i) => e12[i] - e26[i]);
  const sig = emaSeries(m.slice(25), 9);
  return { line: m[m.length - 1], signal: sig[sig.length - 1] };
};

const atrCalc = (h: number[], l: number[], c: number[], n = 14) => {
  if (c.length < n + 1) return null;
  const tr: number[] = [];
  for (let i = 1; i < c.length; i++) tr.push(Math.max(h[i] - l[i], Math.abs(h[i] - c[i - 1]), Math.abs(l[i] - c[i - 1])));
  let a = tr.slice(0, n).reduce((s, v) => s + v, 0) / n;
  for (let i = n; i < tr.length; i++) a = (a * (n - 1) + tr[i]) / n;
  return a;
};

const techCache: Record<string, { at: number; v: any }> = {};

async function techFor(sym: string) {
  const hit = techCache[sym];
  if (hit && Date.now() - hit.at < TTL) return hit.v;
  let v: any = {
    symbol: sym, rsi: null, ema20: null, ema50: null, ema200: null, sma20: null, sma50: null,
    sma200: null, macd: null, macdSignal: null, bbUpper: null, bbLower: null, atr: null, rating: null,
  };
  try {
    const r = await fetch(`https://api.binance.com/api/v3/klines?symbol=${sym}USDT&interval=1d&limit=250`);
    if (r.ok) {
      const k = await r.json();
      if (Array.isArray(k) && k.length >= 30) {
        const highs = k.map((x: any) => parseFloat(x[2]));
        const lows = k.map((x: any) => parseFloat(x[3]));
        const closes = k.map((x: any) => parseFloat(x[4]));
        const price = closes[closes.length - 1];
        const s20 = sma(closes, 20);
        const sd = s20 === null ? null : Math.sqrt(closes.slice(-20).reduce((s, c) => s + (c - s20) ** 2, 0) / 20);
        const { line, signal } = macdCalc(closes);
        const rsi = rsiCalc(closes);
        v = {
          symbol: sym, rsi,
          ema20: ema(closes, 20), ema50: ema(closes, 50), ema200: ema(closes, 200),
          sma20: s20, sma50: sma(closes, 50), sma200: sma(closes, 200),
          macd: line, macdSignal: signal,
          bbUpper: s20 !== null && sd !== null ? s20 + 2 * sd : null,
          bbLower: s20 !== null && sd !== null ? s20 - 2 * sd : null,
          atr: atrCalc(highs, lows, closes),
          rating: null as string | null,
        };
        // Compound rating: MA consensus (price above/below each available MA) + RSI zones + MACD cross.
        let buys = 0, sells = 0, total = 0;
        for (const m of [v.ema20, v.ema50, v.ema200, v.sma20, v.sma50, v.sma200]) {
          if (m === null) continue;
          total++; if (price > m) buys++; else sells++;
        }
        if (rsi !== null) { total++; if (rsi < 30) buys++; else if (rsi > 70) sells++; }
        if (line !== null && signal !== null) { total++; if (line > signal) buys++; else sells++; }
        if (total > 0) {
          const score = (buys - sells) / total;
          v.rating = score > 0.5 ? 'Strong Buy' : score > 0.1 ? 'Buy' : score >= -0.1 ? 'Neutral' : score >= -0.5 ? 'Sell' : 'Strong Sell';
        }
      }
    }
  } catch { /* non-Binance symbol or transient error → nulls */ }
  techCache[sym] = { at: Date.now(), v };
  return v;
}

export default async function handler(req: any, res: any) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  if (req.query?.view === 'technicals') {
    const syms = String(req.query.symbols || '').split(',').map((s: string) => s.trim().toUpperCase()).filter(Boolean).slice(0, 25);
    if (syms.length === 0) return res.status(400).json({ error: 'symbols required' });
    return res.json(await Promise.all(syms.map(techFor)));
  }
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
