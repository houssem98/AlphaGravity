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

// ---- CX-4: extended indicator math (same klines, no extra calls) ----

const scoreLabel = (buys: number, sells: number, total: number) => {
  if (total === 0) return null;
  const score = (buys - sells) / total;
  return score > 0.5 ? 'Strong Buy' : score > 0.1 ? 'Buy' : score >= -0.1 ? 'Neutral' : score >= -0.5 ? 'Sell' : 'Strong Sell';
};

const wma = (a: number[], n: number) => {
  if (a.length < n) return null;
  const s = a.slice(-n);
  let num = 0, den = 0;
  for (let i = 0; i < n; i++) { num += s[i] * (i + 1); den += i + 1; }
  return num / den;
};

const hmaCalc = (a: number[], n = 20) => {
  const m = Math.round(Math.sqrt(n));
  if (a.length < n + m) return null;
  const diffs: number[] = [];
  for (let j = m - 1; j >= 0; j--) {
    const sub = a.slice(0, a.length - j);
    const w1 = wma(sub, Math.floor(n / 2)), w2 = wma(sub, n);
    if (w1 === null || w2 === null) return null;
    diffs.push(2 * w1 - w2);
  }
  return wma(diffs, m);
};

const rsiSeries = (a: number[], n = 14) => {
  if (a.length < n + 1) return [] as number[];
  let g = 0, l = 0;
  for (let i = 1; i <= n; i++) { const d = a[i] - a[i - 1]; if (d >= 0) g += d; else l -= d; }
  let ag = g / n, al = l / n;
  const out = [al === 0 ? 100 : 100 - 100 / (1 + ag / al)];
  for (let i = n + 1; i < a.length; i++) {
    const d = a[i] - a[i - 1];
    ag = (ag * (n - 1) + Math.max(d, 0)) / n;
    al = (al * (n - 1) + Math.max(-d, 0)) / n;
    out.push(al === 0 ? 100 : 100 - 100 / (1 + ag / al));
  }
  return out;
};

const stochKAt = (h: number[], l: number[], c: number[], idx: number, n = 14) => {
  if (idx + 1 < n) return null;
  const hh = Math.max(...h.slice(idx - n + 1, idx + 1));
  const ll = Math.min(...l.slice(idx - n + 1, idx + 1));
  return hh === ll ? 50 : ((c[idx] - ll) / (hh - ll)) * 100;
};

const adxCalc = (h: number[], l: number[], c: number[], n = 14) => {
  if (c.length < 2 * n + 1) return { adx: null as number | null, diPlus: null as number | null, diMinus: null as number | null };
  const tr: number[] = [], pdm: number[] = [], ndm: number[] = [];
  for (let i = 1; i < c.length; i++) {
    tr.push(Math.max(h[i] - l[i], Math.abs(h[i] - c[i - 1]), Math.abs(l[i] - c[i - 1])));
    const up = h[i] - h[i - 1], dn = l[i - 1] - l[i];
    pdm.push(up > dn && up > 0 ? up : 0);
    ndm.push(dn > up && dn > 0 ? dn : 0);
  }
  let atrS = tr.slice(0, n).reduce((s, v) => s + v, 0);
  let pd = pdm.slice(0, n).reduce((s, v) => s + v, 0);
  let nd = ndm.slice(0, n).reduce((s, v) => s + v, 0);
  const dxs: number[] = [];
  let diP = 0, diM = 0;
  for (let i = n; i < tr.length; i++) {
    atrS = atrS - atrS / n + tr[i];
    pd = pd - pd / n + pdm[i];
    nd = nd - nd / n + ndm[i];
    diP = (100 * pd) / atrS; diM = (100 * nd) / atrS;
    dxs.push((100 * Math.abs(diP - diM)) / (diP + diM || 1));
  }
  if (dxs.length < n) return { adx: null, diPlus: diP, diMinus: diM };
  let adx = dxs.slice(0, n).reduce((s, v) => s + v, 0) / n;
  for (let i = n; i < dxs.length; i++) adx = (adx * (n - 1) + dxs[i]) / n;
  return { adx, diPlus: diP, diMinus: diM };
};

const psarCalc = (h: number[], l: number[]) => {
  if (h.length < 5) return null;
  let up = true, af = 0.02, ep = h[0], sar = l[0];
  for (let i = 1; i < h.length; i++) {
    sar = sar + af * (ep - sar);
    if (up) {
      if (l[i] < sar) { up = false; sar = ep; ep = l[i]; af = 0.02; }
      else if (h[i] > ep) { ep = h[i]; af = Math.min(0.2, af + 0.02); }
    } else {
      if (h[i] > sar) { up = true; sar = ep; ep = h[i]; af = 0.02; }
      else if (l[i] < ep) { ep = l[i]; af = Math.min(0.2, af + 0.02); }
    }
  }
  return sar;
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
        const opens = k.map((x: any) => parseFloat(x[1]));
        const highs = k.map((x: any) => parseFloat(x[2]));
        const lows = k.map((x: any) => parseFloat(x[3]));
        const closes = k.map((x: any) => parseFloat(x[4]));
        const vols = k.map((x: any) => parseFloat(x[5]));
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

        // ---- CX-4 extended indicators (all from the same candles) ----
        const L = closes.length;
        const kNow = stochKAt(highs, lows, closes, L - 1);
        const k1 = stochKAt(highs, lows, closes, L - 2);
        const k2 = stochKAt(highs, lows, closes, L - 3);
        v.stochK = kNow;
        v.stochD = kNow !== null && k1 !== null && k2 !== null ? (kNow + k1 + k2) / 3 : null;
        const rsis = rsiSeries(closes);
        if (rsis.length >= 14) {
          const win = rsis.slice(-14);
          const mn = Math.min(...win), mx = Math.max(...win);
          v.stochRsi = mx === mn ? 50 : ((rsis[rsis.length - 1] - mn) / (mx - mn)) * 100;
        } else v.stochRsi = null;
        const hh14 = Math.max(...highs.slice(-14)), ll14 = Math.min(...lows.slice(-14));
        v.willR = hh14 === ll14 ? null : (-100 * (hh14 - price)) / (hh14 - ll14);
        const tps = closes.map((c, i) => (highs[i] + lows[i] + c) / 3);
        const tpS = sma(tps, 20);
        if (tpS !== null) {
          const dev = tps.slice(-20).reduce((s, t) => s + Math.abs(t - tpS), 0) / 20;
          v.cci = dev === 0 ? null : (tps[tps.length - 1] - tpS) / (0.015 * dev);
        } else v.cci = null;
        const { adx, diPlus, diMinus } = adxCalc(highs, lows, closes);
        v.adx = adx; v.diPlus = diPlus; v.diMinus = diMinus;
        v.roc = L > 12 ? (closes[L - 1] / closes[L - 13] - 1) * 100 : null;
        v.mom = L > 10 ? closes[L - 1] - closes[L - 11] : null;
        const hl2 = highs.map((h, i) => (h + lows[i]) / 2);
        const s5 = sma(hl2, 5), s34 = sma(hl2, 34);
        v.ao = s5 !== null && s34 !== null ? s5 - s34 : null;
        v.psar = psarCalc(highs, lows);
        const hi25 = highs.slice(-25), lo25 = lows.slice(-25);
        v.aroonUp = ((25 - (24 - hi25.indexOf(Math.max(...hi25)))) / 25) * 100;
        v.aroonDown = ((25 - (24 - lo25.indexOf(Math.min(...lo25)))) / 25) * 100;
        v.atrPct = v.atr !== null && price > 0 ? (v.atr / price) * 100 : null;
        v.donchU = Math.max(...highs.slice(-20));
        v.donchL = Math.min(...lows.slice(-20));
        v.keltU = v.ema20 !== null && v.atr !== null ? v.ema20 + 2 * v.atr : null;
        v.keltL = v.ema20 !== null && v.atr !== null ? v.ema20 - 2 * v.atr : null;
        v.hma = hmaCalc(closes);
        v.ichiConv = (Math.max(...highs.slice(-9)) + Math.min(...lows.slice(-9))) / 2;
        v.ichiBase = (Math.max(...highs.slice(-26)) + Math.min(...lows.slice(-26))) / 2;
        const e13 = ema(closes, 13);
        v.bbp = e13 !== null ? highs[L - 1] - e13 + (lows[L - 1] - e13) : null;
        // Pivots from the last COMPLETED day (last candle is the running day).
        const pH = highs[L - 2], pL = lows[L - 2], pC = closes[L - 2];
        const P = (pH + pL + pC) / 3;
        v.pivP = P; v.pivR1 = 2 * P - pL; v.pivS1 = 2 * P - pH;
        v.fibR1 = P + 0.382 * (pH - pL); v.fibS1 = P - 0.382 * (pH - pL);
        // Sub-ratings: MAs only / oscillators only.
        let mb = 0, ms = 0, mt = 0;
        for (const m of [v.ema20, v.ema50, v.ema200, v.sma20, v.sma50, v.sma200]) {
          if (m === null) continue;
          mt++; if (price > m) mb++; else ms++;
        }
        v.maRating = scoreLabel(mb, ms, mt);
        let ob = 0, os = 0, ot = 0;
        if (rsi !== null) { ot++; if (rsi < 30) ob++; else if (rsi > 70) os++; }
        if (kNow !== null) { ot++; if (kNow < 20) ob++; else if (kNow > 80) os++; }
        if (v.cci !== null) { ot++; if (v.cci < -100) ob++; else if (v.cci > 100) os++; }
        if (v.willR !== null) { ot++; if (v.willR < -80) ob++; else if (v.willR > -20) os++; }
        if (v.mom !== null) { ot++; if (v.mom > 0) ob++; else os++; }
        if (line !== null && signal !== null) { ot++; if (line > signal) ob++; else os++; }
        v.oscRating = scoreLabel(ob, os, ot);
        // Candle pattern on the latest candle.
        const o = opens[L - 1], h = highs[L - 1], lo = lows[L - 1], c = closes[L - 1];
        const body = Math.abs(c - o), range = h - lo || 1;
        const upSh = h - Math.max(o, c), dnSh = Math.min(o, c) - lo;
        const pO = opens[L - 2], pCl = closes[L - 2];
        v.candle =
          body <= 0.1 * range ? 'Doji'
          : dnSh >= 2 * body && upSh <= body ? 'Hammer'
          : c > o && pCl < pO && c >= pO && o <= pCl ? 'Bull Engulfing'
          : c < o && pCl > pO && c <= pO && o >= pCl ? 'Bear Engulfing'
          : null;
        // Volume change % — completed day vs prior completed day (last candle is partial).
        v.volChangePct = L > 2 && vols[L - 3] > 0 ? (vols[L - 2] / vols[L - 3] - 1) * 100 : null;
      }
    }
  } catch { /* non-Binance symbol or transient error → nulls */ }
  techCache[sym] = { at: Date.now(), v };
  return v;
}

// ---- CX-6: meta — TVL (DeFiLlama) + categories/trending (CoinGecko), 1h cache ----

const HOUR = 60 * 60 * 1000;
let metaCache: { at: number; tvl: Record<string, number>; cats: Record<string, string[]>; trend: Record<string, number> } | null = null;

// Slugs curl-verified 2026-07-12 (CG free tier 429s on bursts — fetch sequentially, tolerate partials).
const CG_CATS: [string, string][] = [
  ['layer-1', 'Layer 1'], ['layer-2', 'Layer 2'], ['decentralized-finance-defi', 'DeFi'],
  ['stablecoins', 'Stablecoins'], ['meme-token', 'Meme'], ['artificial-intelligence', 'AI'],
  ['gaming', 'Gaming'], ['centralized-exchange-token-cex', 'Exchange'],
];

async function buildMeta() {
  if (metaCache && Date.now() - metaCache.at < HOUR) return metaCache;
  const tvl: Record<string, number> = {};
  const cats: Record<string, string[]> = {};
  const trend: Record<string, number> = {};
  // Chains first (ETH/SOL/... = chain TVL), then protocols only for symbols not chain-set.
  try {
    const ch = await (await fetch('https://api.llama.fi/v2/chains')).json();
    if (Array.isArray(ch)) for (const c of ch) {
      if (c.tokenSymbol && c.tvl > 0) { const s = String(c.tokenSymbol).toUpperCase(); tvl[s] = Math.max(tvl[s] || 0, c.tvl); }
    }
  } catch { /* partial ok */ }
  try {
    const pr = await (await fetch('https://api.llama.fi/protocols')).json();
    if (Array.isArray(pr)) {
      const sums: Record<string, number> = {};
      for (const p of pr) if (p.symbol && p.symbol !== '-' && p.tvl > 0) {
        const s = String(p.symbol).toUpperCase();
        sums[s] = (sums[s] || 0) + p.tvl; // sum protocol versions (Aave V2+V3…)
      }
      for (const s of Object.keys(sums)) if (!(s in tvl)) tvl[s] = sums[s];
    }
  } catch { /* partial ok */ }
  try {
    const t = await (await fetch('https://api.coingecko.com/api/v3/search/trending')).json();
    if (Array.isArray(t?.coins)) t.coins.forEach((c: any, i: number) => { trend[(c.item?.symbol || '').toUpperCase()] = i + 1; });
  } catch { /* partial ok */ }
  for (const [slug, label] of CG_CATS) {
    try {
      const r = await fetch(`https://api.coingecko.com/api/v3/coins/markets?vs_currency=usd&category=${slug}&per_page=100&page=1`);
      const arr = await r.json();
      if (Array.isArray(arr)) for (const c of arr) {
        const s = (c.symbol || '').toUpperCase();
        (cats[s] = cats[s] || []).push(label);
      }
    } catch { /* 429 → skip this category this hour */ }
  }
  metaCache = { at: Date.now(), tvl, cats, trend };
  return metaCache;
}

// ---- CX-2: spot 24h ticker map (1 call for ALL symbols, 5-min cache) ----

let tickerCache: { at: number; map: Record<string, any> } | null = null;

async function tickerMap() {
  if (tickerCache && Date.now() - tickerCache.at < TTL) return tickerCache.map;
  const r = await fetch('https://api.binance.com/api/v3/ticker/24hr');
  const arr = await r.json();
  const map: Record<string, any> = {};
  if (Array.isArray(arr)) {
    for (const t of arr) {
      if (typeof t.symbol === 'string' && t.symbol.endsWith('USDT')) map[t.symbol.slice(0, -4)] = t;
    }
  }
  tickerCache = { at: Date.now(), map };
  return map;
}

// ---- CS-7: derivatives from Binance fapi (funding = 1 call for all symbols) ----

let fundingCache: { at: number; map: Record<string, { fr: number; mark: number }> } | null = null;
const oiCache: Record<string, { at: number; v: number | null }> = {};

async function fundingMap() {
  if (fundingCache && Date.now() - fundingCache.at < TTL) return fundingCache.map;
  const r = await fetch('https://fapi.binance.com/fapi/v1/premiumIndex');
  const arr = await r.json();
  const map: Record<string, { fr: number; mark: number }> = {};
  if (Array.isArray(arr)) {
    for (const x of arr) {
      if (typeof x.symbol === 'string' && x.symbol.endsWith('USDT')) {
        map[x.symbol.slice(0, -4)] = { fr: parseFloat(x.lastFundingRate), mark: parseFloat(x.markPrice) };
      }
    }
  }
  fundingCache = { at: Date.now(), map };
  return map;
}

async function oiFor(sym: string) {
  const hit = oiCache[sym];
  if (hit && Date.now() - hit.at < TTL) return hit.v;
  let v: number | null = null;
  try {
    const r = await fetch(`https://fapi.binance.com/fapi/v1/openInterest?symbol=${sym}USDT`);
    if (r.ok) {
      const j = await r.json();
      const n = parseFloat(j.openInterest);
      if (isFinite(n)) v = n;
    }
  } catch { /* no perp for this symbol */ }
  oiCache[sym] = { at: Date.now(), v };
  return v;
}

export default async function handler(req: any, res: any) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  if (req.query?.view === 'meta') {
    const syms = String(req.query.symbols || '').split(',').map((s: string) => s.trim().toUpperCase()).filter(Boolean).slice(0, 100);
    if (syms.length === 0) return res.status(400).json({ error: 'symbols required' });
    const m = await buildMeta();
    return res.json(syms.map((s) => ({
      symbol: s, tvl: m.tvl[s] ?? null, categories: m.cats[s] || [], trending: m.trend[s] ?? null,
    })));
  }
  if (req.query?.view === 'spot') {
    const syms = String(req.query.symbols || '').split(',').map((s: string) => s.trim().toUpperCase()).filter(Boolean).slice(0, 100);
    if (syms.length === 0) return res.status(400).json({ error: 'symbols required' });
    const tm = await tickerMap().catch(() => ({} as Record<string, any>));
    return res.json(syms.map((s) => {
      const t = tm[s];
      if (!t) return { symbol: s, open: null, high: null, low: null, prevClose: null, chgAbs: null, changeFromOpenPct: null, gapPct: null, volatilityPct: null };
      const open = parseFloat(t.openPrice), high = parseFloat(t.highPrice), low = parseFloat(t.lowPrice);
      const last = parseFloat(t.lastPrice), prev = parseFloat(t.prevClosePrice), chg = parseFloat(t.priceChange);
      return {
        symbol: s, open, high, low, prevClose: prev, chgAbs: chg,
        changeFromOpenPct: open > 0 ? ((last - open) / open) * 100 : null,
        gapPct: prev > 0 ? ((open - prev) / prev) * 100 : null,
        volatilityPct: low > 0 ? ((high - low) / low) * 100 : null,
      };
    }));
  }
  if (req.query?.view === 'derivatives') {
    const syms = String(req.query.symbols || '').split(',').map((s: string) => s.trim().toUpperCase()).filter(Boolean).slice(0, 25);
    if (syms.length === 0) return res.status(400).json({ error: 'symbols required' });
    const fm = await fundingMap().catch(() => ({} as Record<string, { fr: number; mark: number }>));
    const rows = await Promise.all(syms.map(async (s) => {
      const f = fm[s];
      if (!f) return { symbol: s, fundingRate: null, oiUsd: null }; // spot-only coin — skip OI call
      const oi = await oiFor(s);
      return { symbol: s, fundingRate: f.fr, oiUsd: oi !== null ? oi * f.mark : null };
    }));
    return res.json(rows);
  }
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
