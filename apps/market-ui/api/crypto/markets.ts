// Crypto markets for the /trading tab. Primary: CoinGecko /coins/markets
// (keyless free tier — richest payload: logo image, ATH, perf 14d/30d/1y,
// exact FDV/supplies in ONE call). Fallbacks: coinlore (previous primary,
// shape preserved) then OKX. New fields are additive-only so the UI's base
// MarketData shape keeps working across all three sources (CS-2).

let cache: { at: number; rows: any[] } | null = null;
const TTL = 5 * 60 * 1000;

// ── Blob SWR layer (same pattern as api/tn/[fn].ts — the "TN freeze" fix). ──
// View payloads for the whole top-100 are precomputed and stale-served from
// Supabase Storage (~100ms) with a background refresh, so the crypto tab gets
// instant columns instead of waiting on 100 klines / 3×25 fapi calls / the
// 7.9MB llama map on every cold serverless instance.
function blobStore(file: string) {
  const url = process.env.SUPABASE_URL, key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const h = { apikey: key!, Authorization: `Bearer ${key}` };
  return {
    async get() {
      const r = await fetch(`${url}/storage/v1/object/market-data/${file}`, { headers: h });
      return r.ok ? r.json() : null;
    },
    async put(body: any) {
      await fetch(`${url}/storage/v1/object/market-data/${file}`, {
        method: 'POST',
        headers: { ...h, 'Content-Type': 'application/json', 'x-upsert': 'true', 'cache-control': 'max-age=0' },
        body: JSON.stringify(body),
      });
    },
  };
}
function waitUntil(p: Promise<any>) {
  const ctx = (globalThis as any)[Symbol.for('@vercel/request-context')]?.get?.();
  const q = p.catch(() => {});
  if (ctx?.waitUntil) ctx.waitUntil(q);
}
async function cachedBlob<T>(file: string, ttlSec: number, compute: () => Promise<T>, usable: (d: T) => boolean): Promise<T> {
  if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) return compute();
  const s = blobStore(file);
  const refresh = async () => {
    const d = await compute();
    if (usable(d)) await s.put({ _t: Date.now(), d }); // never cache an empty/bad payload
    return d;
  };
  const blob: any = await s.get().catch(() => null);
  if (blob?._t && usable(blob.d)) {
    if (Date.now() - blob._t > ttlSec * 1000) waitUntil(refresh());
    return blob.d;
  }
  return refresh();
}

// Bounded-concurrency map for the 100-coin precompute passes.
async function pool<T, R>(items: T[], n: number, fn: (t: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let i = 0;
  await Promise.all(Array.from({ length: Math.min(n, items.length) }, async () => {
    while (i < items.length) { const j = i++; out[j] = await fn(items[j]); }
  }));
  return out;
}

// CW-2: curated universe — highest-mcap CG coins with a gate-verified
// Binance/OKX spot venue (built by scripts/build_crypto_universe.mjs,
// evidence + exclusions in docs/CRYPTO_UNIVERSE.md). Order still comes from
// CG's live mcap sort; ids= only pins membership.
const CURATED_IDS = ['bitcoin', 'ethereum', 'binancecoin', 'usd-coin', 'ripple', 'solana', 'tron', 'hyperliquid', 'dogecoin', 'usds', 'leo-token', 'zcash', 'stellar', 'chainlink', 'cardano', 'canton-network', 'bitcoin-cash', 'usd1-wlfi', 'the-open-network', 'ethena-usde', 'litecoin', 'global-dollar', 'sui', 'hedera-hashgraph', 'paypal-usd', 'avalanche-2', 'crypto-com-chain', 'near', 'tether-gold', 'shiba-inu', 'uniswap', 'dexe', 'bittensor', 'world-liberty-financial', 'pax-gold', 'okb', 'aster-2', 'ripple-usd', 'ondo-finance', 'aave', 'polkadot', 'worldcoin-wld', 'sky', 'bfusd', 'morpho', 'internet-computer', 'pepe', 'ethereum-classic', 'united-stables', 'quant-network', 'pi-network', 'polygon-ecosystem-token', 'just', 'cosmos', 'render-token', 'ethena', 'algorand', 'nexo', 'bianrensheng', 'jupiter-exchange-solana', 'filecoin', 'pump-fun', 'lighter', 'arbitrum', 'flare-networks', 'aptos', 'true-usd', 'midnight-3', 'injective-protocol', 'pancakeswap-token', 'dash', 'vechain', 'celestia', 'pyth-network', 'pudgy-penguins', 'official-trump', 'virtual-protocol', 'fetch-ai', 'ether-fi', 'sun-token', 'first-digital-usd', 'curve-dao-token', 'bonk', 'terra-luna', 'sei-network', 'jito-governance-token', 'blockstack', 'kite-2', 'layerzero', 'gnosis', 'lido-dao', 'apenft', 'monad', 'pendle', 'doublezero', 'tezos', 'plasma', 'grass', 'conflux-token', 'decred', 'syrup', 'floki', 'optimism', 'zebec-network', 'jasmycoin', 'kaia', 'starknet', 'usa', 'the-graph', 'falcon-finance-ff', 'raydium', 'eigenlayer', 'chiliz', 'axie-infinity', 'iota', 'kaito', 'ethereum-name-service', 'compound-governance-token', 'dogwifcoin', 'edgex', 'apecoin', 'trust-wallet-token', 'theta-token', 'thorchain', 'decentraland', 'neo', 'havven', 'rif-token', 'ecash', 'arweave', 'the-sandbox', 'allora', 'stp-network', 'vaulta', 'basic-attention-token', 'convex-finance', 'genius-3', 'immutable-x', 'safepal', 'sentient', 'dydx-chain', 'zksync', '1inch', 'golem', 'gala', 'kamino', 'sonic-3', 'story-2', 'elrond-erd-2', 'spacex-bstocks-tokenized-stock', 'aethir', 'safe', 're', 'meteora', 'cow-protocol', 'instadapp', 'yearn-finance', 'micron-technology-bstock', 'four', 'reserve-rights-token', 'livepeer', 'walrus-2', 'banana-for-scale-2', 'zencash', 'ordinals', 'nexpace', '0x', 'zama', 'arkham', 'qtum', 'orca', 'centrifuge-2', 'gas', 'numeraire', 'holotoken', 'ravencoin', 'chip-2', 'kusama', 'bio-protocol', 'linea', 'gmx', 'wormhole', 'plume', 'zilliqa', 'turbo', 'theta-fuel', 'io', 'baby-doge-coin', 'mina-protocol', 'berachain-bera', 'enjincoin', 'synapse-2', 'superfarm', 'spark-2', 'threshold-network-token', 'megaeth', 'pharos-network', 'zetachain', 'velo', 'home'];

async function fetchCoinGecko() {
  const r = await fetch(
    `https://api.coingecko.com/api/v3/coins/markets?vs_currency=usd&order=market_cap_desc&per_page=250&page=1&sparkline=false&price_change_percentage=1h,24h,7d,14d,30d,1y&ids=${CURATED_IDS.join(',')}`,
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
    // additive (CS-2). CT-5: missing CG metric -> '' (honest absence), never a
    // fake '0' — the UI renders '' as '—'; a real 0 from CG still comes through.
    image: c.image || '',
    ath: c.ath == null ? '' : String(c.ath),
    athChangePct: c.ath_change_percentage == null ? '' : String(c.ath_change_percentage),
    changePercent14d: c.price_change_percentage_14d_in_currency == null ? '' : String(c.price_change_percentage_14d_in_currency),
    changePercent30d: c.price_change_percentage_30d_in_currency == null ? '' : String(c.price_change_percentage_30d_in_currency),
    changePercent1y: c.price_change_percentage_1y_in_currency == null ? '' : String(c.price_change_percentage_1y_in_currency),
    fdvUsd: c.fully_diluted_valuation == null ? '' : String(c.fully_diluted_valuation),
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

const NULL_TECH = (sym: string): any => ({
  symbol: sym, rsi: null, ema20: null, ema50: null, ema200: null, sma20: null, sma50: null,
  sma200: null, macd: null, macdSignal: null, bbUpper: null, bbLower: null, atr: null, rating: null,
});

// CT-4: indicator math extracted from techFor so Binance and OKX candle
// sources share it verbatim (arrays must be oldest-first).
function computeTech(sym: string, opens: number[], highs: number[], lows: number[], closes: number[], vols: number[]) {
  const price = closes[closes.length - 1];
  const s20 = sma(closes, 20);
  const sd = s20 === null ? null : Math.sqrt(closes.slice(-20).reduce((s, c) => s + (c - s20) ** 2, 0) / 20);
  const { line, signal } = macdCalc(closes);
  const rsi = rsiCalc(closes);
  const v: any = {
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
  return v;
}

async function techFor(sym: string) {
  const hit = techCache[sym];
  if (hit && Date.now() - hit.at < TTL) return hit.v;
  let v: any = NULL_TECH(sym);
  try {
    const r = await fetch(`https://api.binance.com/api/v3/klines?symbol=${sym}USDT&interval=1d&limit=250`);
    if (r.ok) {
      const k = await r.json();
      if (Array.isArray(k) && k.length >= 30) {
        v = computeTech(
          sym,
          k.map((x: any) => parseFloat(x[1])),
          k.map((x: any) => parseFloat(x[2])),
          k.map((x: any) => parseFloat(x[3])),
          k.map((x: any) => parseFloat(x[4])),
          k.map((x: any) => parseFloat(x[5])),
        );
      }
    }
  } catch { /* non-Binance symbol or transient error → nulls */ }
  techCache[sym] = { at: Date.now(), v };
  return v;
}

// CT-4: OKX 1D candles, taker of last resort for coins with no verified
// Binance pair (HYPE/LEO/OKB class). Symbol-matched source, so the price
// cross-check gate is mandatory: latest OKX close must agree with the coin's
// CG price (3%, stables 1%) or everything stays null. OKX rows come newest
// first (ts,o,h,l,c,vol,...) — reversed before math.
async function techForOkx(sym: string, cgPrice: number) {
  const key = 'okx:' + sym;
  const hit = techCache[key];
  if (hit && Date.now() - hit.at < TTL) return hit.v;
  let v: any = NULL_TECH(sym);
  try {
    const r = await fetch(`https://www.okx.com/api/v5/market/candles?instId=${sym}-USDT&bar=1D&limit=250`);
    if (r.ok) {
      const j = await r.json();
      const rows: any[] = Array.isArray(j?.data) ? [...j.data].reverse() : [];
      if (rows.length >= 30) {
        const closes = rows.map((x) => parseFloat(x[4]));
        const last = closes[closes.length - 1];
        const tol = STABLE_SYMS.has(sym) ? 0.01 : 0.03;
        if (last > 0 && cgPrice > 0 && Math.abs(last / cgPrice - 1) <= tol) {
          v = computeTech(
            sym,
            rows.map((x) => parseFloat(x[1])),
            rows.map((x) => parseFloat(x[2])),
            rows.map((x) => parseFloat(x[3])),
            closes,
            rows.map((x) => parseFloat(x[5])),
          );
        }
      }
    }
  } catch { /* unreachable or unlisted → nulls */ }
  techCache[key] = { at: Date.now(), v };
  return v;
}

// ---- CX-6: meta — TVL (DeFiLlama) + categories/trending (CoinGecko), 1h cache ----

const HOUR = 60 * 60 * 1000;
let metaCache: {
  at: number;
  tvl: Record<string, number>;          // chain TVL by tokenSymbol (unchanged)
  tvlById: Record<string, number>;      // CT-3: protocol-family TVL by CG id
  cats: Record<string, string[]>;       // legacy symbol map (no-ids callers)
  catsById: Record<string, string[]>;   // CT-3: categories by CG id
  trend: Record<string, number>;
  trendById: Record<string, number>;    // CT-3: trending by CG id
} | null = null;

// Slugs curl-verified 2026-07-12 (CG free tier 429s on bursts — fetch sequentially, tolerate partials).
const CG_CATS: [string, string][] = [
  ['layer-1', 'Layer 1'], ['layer-2', 'Layer 2'], ['decentralized-finance-defi', 'DeFi'],
  ['stablecoins', 'Stablecoins'], ['meme-token', 'Meme'], ['artificial-intelligence', 'AI'],
  ['gaming', 'Gaming'], ['centralized-exchange-token-cex', 'Exchange'],
];

async function buildMeta() {
  if (metaCache && Date.now() - metaCache.at < HOUR) return metaCache;
  const tvl: Record<string, number> = {};
  const tvlById: Record<string, number> = {};
  const cats: Record<string, string[]> = {};
  const catsById: Record<string, string[]> = {};
  const trend: Record<string, number> = {};
  const trendById: Record<string, number> = {};
  // Chains first (ETH/SOL/... = chain TVL) — tokenSymbol map, unchanged.
  try {
    const ch = await (await fetch('https://api.llama.fi/v2/chains')).json();
    if (Array.isArray(ch)) for (const c of ch) {
      if (c.tokenSymbol && c.tvl > 0) { const s = String(c.tokenSymbol).toUpperCase(); tvl[s] = Math.max(tvl[s] || 0, c.tvl); }
    }
  } catch { /* partial ok */ }
  // CT-3: protocol TVL joined by CG id, never symbol. Families (parentProtocol
  // or own slug) are attributed to a CG id only when the family carries that
  // gecko_id — on a member row or on the parent entry (/lite/protocols2;
  // /protocols rows have gecko_id on ~1 version only, e.g. Aave V2 but not V3).
  // llama mcap is null on all 7830 rows (curl-verified 2026-07-12) so the
  // mcap-agreement rule is unenforceable; the id-join is strictly stronger.
  // CEX rows are excluded: exchange reserves are not protocol TVL.
  try {
    const [pr, lite] = await Promise.all([
      (await fetch('https://api.llama.fi/protocols')).json(),
      (await fetch('https://api.llama.fi/lite/protocols2')).json().catch(() => null),
    ]);
    if (Array.isArray(pr)) {
      const parentGecko: Record<string, string> = {};
      if (Array.isArray(lite?.parentProtocols)) {
        for (const pp of lite.parentProtocols) if (pp.id && pp.gecko_id) parentGecko[pp.id] = pp.gecko_id;
      }
      const famTvl: Record<string, number> = {};
      const famIds: Record<string, Set<string>> = {};
      for (const p of pr) {
        if (p.category === 'CEX') continue;
        const fam = p.parentProtocol || p.slug;
        if (!fam) continue;
        if (p.tvl > 0) famTvl[fam] = (famTvl[fam] || 0) + p.tvl;
        if (p.gecko_id) (famIds[fam] = famIds[fam] || new Set()).add(String(p.gecko_id));
        if (parentGecko[fam]) (famIds[fam] = famIds[fam] || new Set()).add(parentGecko[fam]);
      }
      for (const fam of Object.keys(famIds)) {
        for (const id of famIds[fam]) tvlById[id] = (tvlById[id] || 0) + (famTvl[fam] || 0);
      }
    }
  } catch { /* partial ok */ }
  try {
    const t = await (await fetch('https://api.coingecko.com/api/v3/search/trending')).json();
    if (Array.isArray(t?.coins)) t.coins.forEach((c: any, i: number) => {
      trend[(c.item?.symbol || '').toUpperCase()] = i + 1;
      if (c.item?.id) trendById[c.item.id] = i + 1;
    });
  } catch { /* partial ok */ }
  for (const [slug, label] of CG_CATS) {
    try {
      const r = await fetch(`https://api.coingecko.com/api/v3/coins/markets?vs_currency=usd&category=${slug}&per_page=100&page=1`);
      const arr = await r.json();
      if (Array.isArray(arr)) for (const c of arr) {
        const s = (c.symbol || '').toUpperCase();
        (cats[s] = cats[s] || []).push(label);
        if (c.id) (catsById[c.id] = catsById[c.id] || []).push(label);
      }
    } catch { /* 429 → skip this category this hour */ }
  }
  metaCache = { at: Date.now(), tvl, tvlById, cats, catsById, trend, trendById };
  return metaCache;
}

// ---- CP-1: coin profiles (CoinGecko slim) — 24h cache per id ----

async function fetchProfile(cgId: string) {
  const r = await fetch(
    `https://api.coingecko.com/api/v3/coins/${cgId}?localization=false&tickers=false&market_data=true&community_data=false&developer_data=false`,
  );
  if (!r.ok) throw new Error(`coingecko profile ${r.status}`);
  const c = await r.json();
  const cats = Array.isArray(c.categories) ? c.categories.slice(0, 3) : [];
  const links = c.links || {};
  return {
    id: c.id,
    name: c.name || '',
    symbol: (c.symbol || '').toUpperCase(),
    description: c.description?.en || '',
    image: c.image?.large || c.image?.small || c.image?.thumb || '',
    genesisDate: c.genesis_date || '',
    hashingAlgorithm: c.hashing_algorithm || '',
    categories: cats,
    circulatingSupply: c.market_data?.circulating_supply ?? null,
    totalSupply: c.market_data?.total_supply ?? null,
    maxSupply: c.market_data?.max_supply ?? null,
    rank: c.market_cap_rank ?? null,
    links: {
      homepage: Array.isArray(links.homepage) ? links.homepage[0] || '' : links.homepage || '',
      whitepaper: links.whitepaper || '',
      blockchainSite: Array.isArray(links.blockchain_site) ? links.blockchain_site : [],
      twitter: links.twitter_screen_name ? `https://twitter.com/${links.twitter_screen_name}` : '',
      repos: links.repos_url?.github || [],
    },
  };
}

// ---- CP-2: exchange tickers (CoinGecko /tickers?depth=true) — 15m cache per id ----
// Rows filtered honest: anomalous/stale dropped, trust_score red dropped (null
// kept — CG free tier nulls it). Sorted by USD volume, top 20.

async function fetchTickers(cgId: string) {
  const r = await fetch(`https://api.coingecko.com/api/v3/coins/${cgId}/tickers?depth=true`);
  if (!r.ok) throw new Error(`coingecko tickers ${r.status}`);
  const j = await r.json();
  const rows: any[] = Array.isArray(j?.tickers) ? j.tickers : [];
  return rows
    .filter((t) => !t.is_anomaly && !t.is_stale && t.trust_score !== 'red' && t.converted_last?.usd > 0)
    .sort((a, b) => (b.converted_volume?.usd || 0) - (a.converted_volume?.usd || 0))
    .slice(0, 20)
    .map((t) => ({
      name: t.market?.name || '',
      pair: `${t.base}/${t.target}`,
      priceUsd: t.converted_last?.usd ?? null,
      volumeUsd: t.converted_volume?.usd ?? null,
      depthUpUsd: t.cost_to_move_up_usd ?? null,
      depthDownUsd: t.cost_to_move_down_usd ?? null,
      spreadPct: t.bid_ask_spread_percentage ?? null,
      trustScore: t.trust_score ?? null,
      tradeUrl: t.trade_url || '',
    }));
}

// ---- CP-5: historical market cap (CG market_chart daily, REAL mcap) ----

async function fetchMcapChart(cgId: string) {
  const r = await fetch(`https://api.coingecko.com/api/v3/coins/${cgId}/market_chart?vs_currency=usd&days=365&interval=daily`);
  if (!r.ok) throw new Error(`coingecko market_chart ${r.status}`);
  const j = await r.json();
  const caps: any[] = Array.isArray(j?.market_caps) ? j.market_caps : [];
  return caps.filter((c) => Array.isArray(c) && c[1] > 0).map((c) => [c[0], c[1]]);
}

// ---- CP-3: DeFi yield pools (yields.llama.fi/pools) ----
// The full pools JSON is ~10MB — held in-memory 1h, NEVER blobbed whole;
// only the tiny per-symbol top-15 slice goes to blob (1h TTL).

let poolsCache: { at: number; rows: any[] } | null = null;
async function llamaPools() {
  if (poolsCache && Date.now() - poolsCache.at < HOUR) return poolsCache.rows;
  const j = await (await fetch('https://yields.llama.fi/pools')).json();
  const rows: any[] = Array.isArray(j?.data) ? j.data : [];
  if (rows.length) poolsCache = { at: Date.now(), rows };
  return rows;
}

async function yieldFor(sym: string) {
  const rows = await llamaPools();
  return rows
    .filter((p) => p.symbol === sym && p.tvlUsd > 0 && p.apy !== null && !p.outlier)
    .sort((a, b) => b.tvlUsd - a.tvlUsd)
    .slice(0, 15)
    .map((p) => ({
      project: p.project,
      chain: p.chain,
      symbol: p.symbol,
      apy: p.apy,
      tvlUsd: p.tvlUsd,
      stablecoin: !!p.stablecoin,
    }));
}

// ---- CT-2: verified-pair gate. A Binance/fapi row only counts for a coin if
// the source's own price agrees with the coin's CG/base price (px= hints from
// the UI, "SYM:price,..."). Disagreement > 3% (stables 1%) = symbol collision
// (e.g. CG LIT=Lighter vs Binance LIT=Litentry) -> serve nulls, cache verdict.
// No hint for a symbol -> legacy ungated behavior (additive).

const STABLE_SYMS = new Set(['USDT', 'USDC', 'DAI', 'FDUSD', 'USDE', 'TUSD', 'PYUSD', 'USDP', 'USDD', 'FRAX', 'BUSD', 'GUSD']);
const pairVerdict: Record<string, { at: number; ok: boolean }> = {};

function parsePx(q: any): Record<string, number> {
  const out: Record<string, number> = {};
  for (const part of String(q?.px || '').split(',')) {
    const i = part.indexOf(':');
    if (i <= 0) continue;
    const sym = part.slice(0, i).trim().toUpperCase();
    const p = parseFloat(part.slice(i + 1));
    if (sym && isFinite(p) && p > 0) out[sym] = p;
  }
  return out;
}

function verifiedPair(sym: string, cgPrice: number | undefined, srcPrice: number): boolean {
  if (cgPrice === undefined) return true; // no hint -> cannot judge, legacy path
  const hit = pairVerdict[sym];
  if (hit && Date.now() - hit.at < TTL) return hit.ok;
  const tol = STABLE_SYMS.has(sym) ? 0.01 : 0.03;
  const ok = srcPrice > 0 && Math.abs(srcPrice / cgPrice - 1) <= tol;
  pairVerdict[sym] = { at: Date.now(), ok };
  return ok;
}

// ---- CX-2: spot 24h ticker map (1 call for ALL symbols, 5-min cache) ----

let tickerCache: { at: number; map: Record<string, any> } | null = null;

async function tickerMap() {
  // CW-3: 25s window (was TTL) — spot blob refreshes every 30s and must see
  // fresh venue prices, not a 5-min-old map. Still 1 keyless call per refresh.
  if (tickerCache && Date.now() - tickerCache.at < 25_000) return tickerCache.map;
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

// CX-7: OI d/d change + long/short + taker ratios (fapi futures/data, keyless).
const derivXCache: Record<string, { at: number; v: { oiChangePct: number | null; lsRatio: number | null; takerRatio: number | null } }> = {};

async function derivExtras(sym: string) {
  const hit = derivXCache[sym];
  if (hit && Date.now() - hit.at < TTL) return hit.v;
  const v = { oiChangePct: null as number | null, lsRatio: null as number | null, takerRatio: null as number | null };
  try {
    const [oiH, ls, tk] = await Promise.all([
      fetch(`https://fapi.binance.com/futures/data/openInterestHist?symbol=${sym}USDT&period=1d&limit=2`).then((r) => (r.ok ? r.json() : null)),
      fetch(`https://fapi.binance.com/futures/data/globalLongShortAccountRatio?symbol=${sym}USDT&period=1d&limit=1`).then((r) => (r.ok ? r.json() : null)),
      fetch(`https://fapi.binance.com/futures/data/takerlongshortRatio?symbol=${sym}USDT&period=1d&limit=1`).then((r) => (r.ok ? r.json() : null)),
    ]);
    if (Array.isArray(oiH) && oiH.length === 2) {
      const a = parseFloat(oiH[0].sumOpenInterestValue), b = parseFloat(oiH[1].sumOpenInterestValue);
      if (a > 0 && isFinite(b)) v.oiChangePct = (b / a - 1) * 100;
    }
    if (Array.isArray(ls) && ls[0]?.longShortRatio) v.lsRatio = parseFloat(ls[0].longShortRatio);
    if (Array.isArray(tk) && tk[0]?.buySellRatio) v.takerRatio = parseFloat(tk[0].buySellRatio);
  } catch { /* nulls */ }
  derivXCache[sym] = { at: Date.now(), v };
  return v;
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

// ── All-100 precompute passes (blob SWR payloads). The server holds the CG
// base list itself, so every row is price-gated against the coin's own CG
// price server-side — no px hints needed for the tab's coins.

const gateOk = (sym: string, cgPrice: number, srcPrice: number) =>
  srcPrice > 0 && cgPrice > 0 && Math.abs(srcPrice / cgPrice - 1) <= (STABLE_SYMS.has(sym) ? 0.01 : 0.03);

// OKX spot tickers — one call for every instrument, 5-min cache. Backs the
// spot + derivatives OKX fallbacks for coins with no verified Binance pair
// (OKB/HYPE/LEO/RLUSD class). curl-verified 2026-07-13.
let okxSpotCache: { at: number; map: Record<string, any> } | null = null;
async function okxSpotMap() {
  if (okxSpotCache && Date.now() - okxSpotCache.at < 25_000) return okxSpotCache.map; // CW-3: same 25s window as tickerMap
  const j = await (await fetch('https://www.okx.com/api/v5/market/tickers?instType=SPOT')).json();
  const map: Record<string, any> = {};
  if (Array.isArray(j?.data)) for (const t of j.data) {
    if (t.instId?.endsWith('-USDT')) map[t.instId.slice(0, -5)] = t;
  }
  okxSpotCache = { at: Date.now(), map };
  return map;
}

// OKX swap open interest — one call, oiUsd directly on each row.
let okxOiCache: { at: number; map: Record<string, number> } | null = null;
async function okxOiMap() {
  if (okxOiCache && Date.now() - okxOiCache.at < TTL) return okxOiCache.map;
  const j = await (await fetch('https://www.okx.com/api/v5/public/open-interest?instType=SWAP')).json();
  const map: Record<string, number> = {};
  if (Array.isArray(j?.data)) for (const r of j.data) {
    if (r.instId?.endsWith('-USDT-SWAP')) { const n = parseFloat(r.oiUsd); if (isFinite(n)) map[r.instId.slice(0, -10)] = n; }
  }
  okxOiCache = { at: Date.now(), map };
  return map;
}

async function okxFundingFor(sym: string): Promise<number | null> {
  try {
    const j = await (await fetch(`https://www.okx.com/api/v5/public/funding-rate?instId=${sym}-USDT-SWAP`)).json();
    const n = parseFloat(j?.data?.[0]?.fundingRate);
    return isFinite(n) ? n : null;
  } catch { return null; }
}

// CW-4: OKX 1D candles (newest first) → prevClose = last completed candle
// close, dayOpen = current candle open. Same instId as the gated ticker, so
// the row's price gate already vouches for the asset. 5-min cache — the
// values change once a day.
const okxDayCache: Record<string, { at: number; prevClose: number | null; dayOpen: number | null }> = {};
async function okxDayCandle(sym: string) {
  const hit = okxDayCache[sym];
  if (hit && Date.now() - hit.at < TTL) return hit;
  const v = { at: Date.now(), prevClose: null as number | null, dayOpen: null as number | null };
  try {
    const j = await (await fetch(`https://www.okx.com/api/v5/market/candles?instId=${sym}-USDT&bar=1D&limit=2`)).json();
    const d: any[] = Array.isArray(j?.data) ? j.data : [];
    if (d.length === 2) {
      const prev = parseFloat(d[1][4]), open = parseFloat(d[0][1]);
      if (prev > 0) v.prevClose = prev;
      if (open > 0) v.dayOpen = open;
    }
  } catch { /* nulls */ }
  okxDayCache[sym] = v;
  return v;
}

// OKX ticker → spot row. OKX tickers carry no prevClose; CW-4 derives it from
// the 1D candles (prev candle close) — gap = day open vs prev close.
function spotRowOkx(s: string, t: any, day?: { prevClose: number | null; dayOpen: number | null }) {
  const open = parseFloat(t.open24h), high = parseFloat(t.high24h), low = parseFloat(t.low24h), last = parseFloat(t.last);
  if (!(open > 0)) return NULL_SPOT(s);
  return {
    symbol: s, last: last > 0 ? last : null, open, high, low, prevClose: day?.prevClose ?? null, chgAbs: last - open,
    changeFromOpenPct: ((last - open) / open) * 100,
    gapPct: day?.prevClose && day?.dayOpen ? ((day.dayOpen - day.prevClose) / day.prevClose) * 100 : null,
    volatilityPct: low > 0 ? ((high - low) / low) * 100 : null,
  };
}

async function baseRows(): Promise<any[]> {
  if (cache && Date.now() - cache.at < TTL) return cache.rows;
  const rows = await fetchCoinGecko();
  // CV-1: venue = the coin's gate-verified live-price source (same verdict
  // spotAll uses) — additive; null when no venue passes the gate.
  const [tm, om] = await Promise.all([
    tickerMap().catch(() => ({} as Record<string, any>)),
    okxSpotMap().catch(() => ({} as Record<string, any>)),
  ]);
  for (const c of rows) {
    const p = parseFloat(c.priceUsd);
    c.venue = tm[c.symbol] && gateOk(c.symbol, p, parseFloat(tm[c.symbol].lastPrice)) ? 'binance'
      : om[c.symbol] && gateOk(c.symbol, p, parseFloat(om[c.symbol].last)) ? 'okx' : null;
  }
  cache = { at: Date.now(), rows };
  return rows;
}

const NULL_SPOT = (s: string) => ({ symbol: s, last: null, open: null, high: null, low: null, prevClose: null, chgAbs: null, changeFromOpenPct: null, gapPct: null, volatilityPct: null });
const NULL_DERIV = (s: string) => ({ symbol: s, fundingRate: null, oiUsd: null, oiChangePct: null, lsRatio: null, takerRatio: null });

function spotRow(s: string, t: any) {
  const open = parseFloat(t.openPrice), high = parseFloat(t.highPrice), low = parseFloat(t.lowPrice);
  const last = parseFloat(t.lastPrice), prev = parseFloat(t.prevClosePrice), chg = parseFloat(t.priceChange);
  return {
    // CW-3: last = gate-verified venue price, fresher than CG base
    symbol: s, last: last > 0 ? last : null, open, high, low, prevClose: prev, chgAbs: chg,
    changeFromOpenPct: open > 0 ? ((last - open) / open) * 100 : null,
    gapPct: prev > 0 ? ((open - prev) / prev) * 100 : null,
    volatilityPct: low > 0 ? ((high - low) / low) * 100 : null,
  };
}

async function spotAll() {
  const base = await baseRows();
  const tm = await tickerMap().catch(() => ({} as Record<string, any>));
  const om = await okxSpotMap().catch(() => ({} as Record<string, any>));
  return pool(base, 8, async (c) => {
    const p = parseFloat(c.priceUsd);
    const t = tm[c.symbol];
    if (t && gateOk(c.symbol, p, parseFloat(t.lastPrice))) return spotRow(c.symbol, t);
    const o = om[c.symbol];
    if (o && gateOk(c.symbol, p, parseFloat(o.last))) return spotRowOkx(c.symbol, o, await okxDayCandle(c.symbol));
    return NULL_SPOT(c.symbol);
  });
}

async function techAll() {
  const base = await baseRows();
  const tm = await tickerMap().catch(() => ({} as Record<string, any>));
  return pool(base, 8, async (c) => {
    const t = tm[c.symbol];
    const p = parseFloat(c.priceUsd);
    if (t && gateOk(c.symbol, p, parseFloat(t.lastPrice))) return techFor(c.symbol);
    return techForOkx(c.symbol, p);
  });
}

async function derivAll() {
  const base = await baseRows();
  const fm = await fundingMap().catch(() => ({} as Record<string, { fr: number; mark: number }>));
  const [om, oiM] = await Promise.all([
    okxSpotMap().catch(() => ({} as Record<string, any>)),
    okxOiMap().catch(() => ({} as Record<string, number>)),
  ]);
  return pool(base, 8, async (c) => {
    const p = parseFloat(c.priceUsd);
    const f = fm[c.symbol];
    if (f && gateOk(c.symbol, p, f.mark)) {
      const [oi, x] = await Promise.all([oiFor(c.symbol), derivExtras(c.symbol)]);
      return { symbol: c.symbol, fundingRate: f.fr, oiUsd: oi !== null ? oi * f.mark : null, ...x };
    }
    // CW-4: Binance 1000-prefixed perps (1000LUNCUSDT class) — mark/funding
    // are per-1000 units, so gate against mark/1000; oi(contracts)*mark is USD.
    const k = fm['1000' + c.symbol];
    if (k && gateOk(c.symbol, p, k.mark / 1000)) {
      const [oi, x] = await Promise.all([oiFor('1000' + c.symbol), derivExtras('1000' + c.symbol)]);
      return { symbol: c.symbol, fundingRate: k.fr, oiUsd: oi !== null ? oi * k.mark : null, ...x };
    }
    // OKX swap fallback (funding + OI USD; ratio stats stay null — honest).
    const o = om[c.symbol];
    if (oiM[c.symbol] !== undefined && o && gateOk(c.symbol, p, parseFloat(o.last))) {
      return {
        symbol: c.symbol, fundingRate: await okxFundingFor(c.symbol), oiUsd: oiM[c.symbol],
        oiChangePct: null, lsRatio: null, takerRatio: null,
      };
    }
    return NULL_DERIV(c.symbol);
  });
}

async function metaAll() {
  const base = await baseRows();
  const m = await buildMeta();
  return base.map((c) => {
    let tvl = m.tvl[c.symbol] ?? m.tvlById[c.id] ?? null;
    if (tvl !== null && tvl < 1e6) tvl = null;
    return { symbol: c.symbol, tvl, categories: m.catsById[c.id] || [], trending: m.trendById[c.id] ?? null };
  });
}

// Serve requested symbols from a blob payload; null = some symbol missing
// (top-100 churn) so the caller falls through to the live path.
function fromBlob(all: any[] | null, syms: string[]) {
  if (!Array.isArray(all)) return null;
  const bySym: Record<string, any> = {};
  for (const r of all) bySym[r.symbol] = r;
  const rows = syms.map((s) => bySym[s]);
  return rows.every(Boolean) ? rows : null;
}

const manyRows = (d: any[]) => Array.isArray(d) && d.length >= 50;

export default async function handler(req: any, res: any) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  if (req.query?.view === 'profile') {
    const cgId = String(req.query.id || '').trim();
    if (!cgId) return res.status(400).json({ error: 'id required' });
    try {
      const profile = await cachedBlob(`crypto_profile_${cgId}.json`, 86400, () => fetchProfile(cgId), (d) => d && d.id);
      return res.json(profile);
    } catch (e) {
      return res.status(404).json({ error: 'profile not found' });
    }
  }
  if (req.query?.view === 'mcapchart') {
    const cgId = String(req.query.id || '').trim();
    if (!cgId) return res.status(400).json({ error: 'id required' });
    try {
      const rows = await cachedBlob(`crypto_mcapchart_${cgId}.json`, 3600, () => fetchMcapChart(cgId), (d) => Array.isArray(d) && d.length > 0);
      return res.json(rows);
    } catch {
      return res.status(404).json({ error: 'mcap chart not found' });
    }
  }
  if (req.query?.view === 'yield') {
    const sym = String(req.query.sym || '').trim().toUpperCase();
    if (!sym) return res.status(400).json({ error: 'sym required' });
    try {
      // usable = any array (empty is a real answer: no pools for this symbol)
      const rows = await cachedBlob(`crypto_yield_${sym}.json`, 3600, () => yieldFor(sym), (d) => Array.isArray(d));
      return res.json(rows);
    } catch {
      return res.status(502).json({ error: 'yield source unavailable' });
    }
  }
  if (req.query?.view === 'tickers') {
    const cgId = String(req.query.id || '').trim();
    if (!cgId) return res.status(400).json({ error: 'id required' });
    try {
      const rows = await cachedBlob(`crypto_tickers_${cgId}.json`, 900, () => fetchTickers(cgId), (d) => Array.isArray(d) && d.length > 0);
      return res.json(rows);
    } catch {
      return res.status(404).json({ error: 'tickers not found' });
    }
  }
  if (req.query?.view === 'meta') {
    const syms = String(req.query.symbols || '').split(',').map((s: string) => s.trim().toUpperCase()).filter(Boolean).slice(0, 200);
    if (syms.length === 0) return res.status(400).json({ error: 'symbols required' });
    const metaBlob = fromBlob(await cachedBlob('crypto_meta.json', 3600, metaAll, manyRows).catch(() => null), syms);
    if (metaBlob) return res.json(metaBlob);
    // CT-3: ids= is positional with symbols=. With an id: categories/trending/
    // protocol-TVL join by CG id. Without (legacy callers): chain TVL + symbol
    // categories only — never symbol-summed protocols, trending id-only.
    const ids = String(req.query.ids || '').split(',').map((s: string) => s.trim());
    const m = await buildMeta();
    return res.json(syms.map((s, i) => {
      const id = ids[i] || null;
      let tvl = m.tvl[s] ?? (id ? m.tvlById[id] ?? null : null);
      if (tvl !== null && tvl < 1e6) tvl = null; // dust, not signal
      return {
        symbol: s, tvl,
        categories: id ? (m.catsById[id] || []) : (m.cats[s] || []),
        trending: id ? (m.trendById[id] ?? null) : null,
      };
    }));
  }
  if (req.query?.view === 'spot') {
    const syms = String(req.query.symbols || '').split(',').map((s: string) => s.trim().toUpperCase()).filter(Boolean).slice(0, 200);
    if (syms.length === 0) return res.status(400).json({ error: 'symbols required' });
    const spotBlob = fromBlob(await cachedBlob('crypto_spot.json', 30, spotAll, manyRows).catch(() => null), syms);
    if (spotBlob) return res.json(spotBlob);
    const tm = await tickerMap().catch(() => ({} as Record<string, any>));
    const px = parsePx(req.query);
    return res.json(syms.map((s) => {
      const t = tm[s];
      if (!t || !verifiedPair(s, px[s], parseFloat(t.lastPrice))) return NULL_SPOT(s);
      return spotRow(s, t);
    }));
  }
  if (req.query?.view === 'derivatives') {
    const syms = String(req.query.symbols || '').split(',').map((s: string) => s.trim().toUpperCase()).filter(Boolean).slice(0, 25);
    if (syms.length === 0) return res.status(400).json({ error: 'symbols required' });
    const derivBlob = fromBlob(await cachedBlob('crypto_deriv.json', 300, derivAll, manyRows).catch(() => null), syms);
    if (derivBlob) return res.json(derivBlob);
    const fm = await fundingMap().catch(() => ({} as Record<string, { fr: number; mark: number }>));
    const pxd = parsePx(req.query);
    const rows = await Promise.all(syms.map(async (s) => {
      const f = fm[s];
      if (!f || !verifiedPair(s, pxd[s], f.mark)) return NULL_DERIV(s); // spot-only coin or unverified pair
      const [oi, x] = await Promise.all([oiFor(s), derivExtras(s)]);
      return { symbol: s, fundingRate: f.fr, oiUsd: oi !== null ? oi * f.mark : null, ...x };
    }));
    return res.json(rows);
  }
  if (req.query?.view === 'technicals') {
    const syms = String(req.query.symbols || '').split(',').map((s: string) => s.trim().toUpperCase()).filter(Boolean).slice(0, 25);
    if (syms.length === 0) return res.status(400).json({ error: 'symbols required' });
    const techBlob = fromBlob(await cachedBlob('crypto_tech.json', 600, techAll, manyRows).catch(() => null), syms);
    if (techBlob) return res.json(techBlob);
    const pxt = parsePx(req.query);
    const tmt = await tickerMap().catch(() => ({} as Record<string, any>));
    return res.json(await Promise.all(syms.map((s) => {
      const hint = pxt[s];
      if (hint === undefined) return techFor(s); // legacy ungated path
      const t = tmt[s];
      if (t && verifiedPair(s, hint, parseFloat(t.lastPrice))) return techFor(s);
      // no verified Binance pair — OKX taker of last resort, same gate (CT-4)
      return techForOkx(s, hint);
    })));
  }
  if (cache && Date.now() - cache.at < TTL) return res.json(cache.rows);
  try {
    const rows = await cachedBlob('crypto_base.json', 120, baseRows, manyRows);
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
