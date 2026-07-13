// CV-2: single client source of truth for crypto numbers. Markets.tsx owns
// the fetch/poll cadence and writes here; every component that renders a
// crypto number (list, AssetInfoPanel) reads the same fields — never its own
// fetch (ONE SOURCE RULE, docs/CRYPTO_V5_ONE_TICK_ROADMAP.md).
import { create } from 'zustand';

// ?view=spot row shape (CX-2 server; CW-3 added gate-verified venue `last`).
export interface SpotData {
  symbol: string; last?: number | null; open: number | null; high: number | null; low: number | null;
  prevClose: number | null; chgAbs: number | null; changeFromOpenPct: number | null;
  gapPct: number | null; volatilityPct: number | null;
}

interface CryptoState {
  base: any[];
  spot: Record<string, SpotData>;
  setBase: (rows: any[]) => void;
  mergeSpot: (rows: SpotData[]) => void;
}

export const useCryptoStore = create<CryptoState>((set) => ({
  base: [],
  spot: {},
  setBase: (rows) => set({ base: rows }),
  mergeSpot: (rows) => set((s) => {
    const spot = { ...s.spot };
    for (const r of rows) spot[r.symbol] = r;
    return { spot };
  }),
}));

// CV-3: the feed lives with the store, not a component — the chart view
// unmounts Markets, and numbers must keep ticking there. Idempotent.
const normalizeCoinlore = (coin: any) => ({
  id: coin.nameid, symbol: coin.symbol, name: coin.name, rank: coin.rank,
  priceUsd: coin.price_usd,
  changePercent1Hr: coin.percent_change_1h || '0',
  changePercent24Hr: coin.percent_change_24h || '0',
  changePercent7d: coin.percent_change_7d || '0',
  marketCapUsd: coin.market_cap_usd || '0',
  volumeUsd24Hr: coin.volume24?.toString() || '0',
  csupply: coin.csupply || '0', tsupply: coin.tsupply || '0', msupply: coin.msupply || '0',
});

let feedStarted = false;
export function ensureCryptoFeed() {
  if (feedStarted) return;
  feedStarted = true;

  const loadBase = async () => {
    try {
      const res = await fetch('/api/crypto/markets');
      if (res.ok) {
        const data = await res.json();
        if (Array.isArray(data) && data.length > 0) { useCryptoStore.getState().setBase(data); return; }
      }
    } catch { /* fall through */ }
    try {
      const res = await fetch('https://api.coinlore.net/api/tickers/?start=0&limit=100');
      const data = await res.json();
      if (data?.data && Array.isArray(data.data)) useCryptoStore.getState().setBase(data.data.map(normalizeCoinlore));
    } catch (error) { console.error('Failed to fetch markets:', error); }
  };

  // CW-3 cadence: 30s spot for the whole universe while the tab is visible.
  const loadSpot = async () => {
    if (document.visibilityState !== 'visible') return;
    const base = useCryptoStore.getState().base.slice(0, 100);
    if (!base.length) return;
    const syms = base.map((c: any) => c.symbol).join(',');
    const px = encodeURIComponent(base.filter((c: any) => c.priceUsd).map((c: any) => `${c.symbol}:${c.priceUsd}`).join(','));
    try {
      const rows = await (await fetch(`/api/crypto/markets?view=spot&symbols=${syms}&px=${px}`)).json();
      if (Array.isArray(rows)) useCryptoStore.getState().mergeSpot(rows);
    } catch { /* keep last values */ }
  };

  loadBase().then(() => { loadSpot(); openBinanceWs(); openOkxWs(); });
  setInterval(() => loadBase().then(() => { openBinanceWs(); openOkxWs(); }), 10000);
  setInterval(loadSpot, 30000);
  setInterval(flushTicks, 500);
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') { loadSpot(); openBinanceWs(); openOkxWs(); }
    else { binanceWs?.close(); okxWs?.close(); }
  });
}

// ── CV-4: Binance WS live ticks (browser, keyless, native WebSocket) ────────
// One combined miniTicker stream for every venue=binance coin. Each tick must
// pass the same price gate as the server (|tick/CG−1| ≤ 3%, stables 1%) or it
// is dropped. Ticks buffer and flush to the store every 500ms so 87 symbols
// don't force 87 renders/s. Closed on hidden tab; reconnects with backoff —
// the 30s REST poll stays as fallback and CG-base refresher.
const STABLE_SYMS = new Set(['USDT', 'USDC', 'DAI', 'FDUSD', 'USDE', 'TUSD', 'PYUSD', 'USDP', 'USDD', 'FRAX', 'BUSD', 'GUSD']);
const EMPTY_SPOT = (symbol: string): SpotData => ({ symbol, open: null, high: null, low: null, prevClose: null, chgAbs: null, changeFromOpenPct: null, gapPct: null, volatilityPct: null });

let binanceWs: WebSocket | null = null;
let wsBackoff = 1000;
const pendingLast: Record<string, number> = {};

function flushTicks() {
  const syms = Object.keys(pendingLast);
  if (!syms.length) return;
  const spot = useCryptoStore.getState().spot;
  const rows = syms.map((s) => ({ ...(spot[s] ?? EMPTY_SPOT(s)), last: pendingLast[s] }));
  for (const s of syms) delete pendingLast[s];
  useCryptoStore.getState().mergeSpot(rows);
}

function gatePass(sym: string, px: number, cg: number) {
  return px > 0 && cg > 0 && Math.abs(px / cg - 1) <= (STABLE_SYMS.has(sym) ? 0.01 : 0.03);
}

function openBinanceWs() {
  if (binanceWs || document.visibilityState !== 'visible') return;
  const syms: string[] = useCryptoStore.getState().base
    .filter((c: any) => c.venue === 'binance').map((c: any) => c.symbol);
  if (!syms.length) return;
  const sock = new WebSocket(`wss://stream.binance.com:9443/stream?streams=${syms.map((s) => s.toLowerCase() + 'usdt@miniTicker').join('/')}`);
  binanceWs = sock;
  sock.onmessage = (ev) => {
    try {
      const d = JSON.parse(ev.data).data;
      if (typeof d?.s !== 'string' || !d.s.endsWith('USDT')) return;
      const sym = d.s.slice(0, -4);
      const px = parseFloat(d.c);
      const row = useCryptoStore.getState().base.find((c: any) => c.symbol === sym);
      if (row && gatePass(sym, px, parseFloat(row.priceUsd))) pendingLast[sym] = px;
    } catch { /* drop malformed frame */ }
  };
  sock.onopen = () => { wsBackoff = 1000; };
  sock.onerror = () => sock.close();
  sock.onclose = () => {
    if (binanceWs === sock) binanceWs = null;
    if (document.visibilityState === 'visible') {
      setTimeout(openBinanceWs, wsBackoff);
      wsBackoff = Math.min(wsBackoff * 2, 30000);
    }
  };
}

// ── CV-5: OKX WS live ticks — the 13 venue=okx coins (OKB/HYPE/LEO class).
// Same gate, same flush buffer, same visibility/backoff rules. OKX drops
// idle sockets after 30s → 'ping' keepalive every 25s.
let okxWs: WebSocket | null = null;
let okxBackoff = 1000;

function openOkxWs() {
  if (okxWs || document.visibilityState !== 'visible') return;
  const syms: string[] = useCryptoStore.getState().base
    .filter((c: any) => c.venue === 'okx').map((c: any) => c.symbol);
  if (!syms.length) return;
  const sock = new WebSocket('wss://ws.okx.com:8443/ws/v5/public');
  okxWs = sock;
  let ping: ReturnType<typeof setInterval> | null = null;
  sock.onopen = () => {
    okxBackoff = 1000;
    sock.send(JSON.stringify({ op: 'subscribe', args: syms.map((s) => ({ channel: 'tickers', instId: `${s}-USDT` })) }));
    ping = setInterval(() => sock.send('ping'), 25000);
  };
  sock.onmessage = (ev) => {
    try {
      const j = JSON.parse(ev.data);
      const instId: string = j?.arg?.instId || '';
      const px = parseFloat(j?.data?.[0]?.last);
      if (!instId.endsWith('-USDT')) return;
      const sym = instId.slice(0, -5);
      const row = useCryptoStore.getState().base.find((c: any) => c.symbol === sym);
      if (row && gatePass(sym, px, parseFloat(row.priceUsd))) pendingLast[sym] = px;
    } catch { /* 'pong' frames and malformed data land here */ }
  };
  sock.onerror = () => sock.close();
  sock.onclose = () => {
    if (ping) clearInterval(ping);
    if (okxWs === sock) okxWs = null;
    if (document.visibilityState === 'visible') {
      setTimeout(openOkxWs, okxBackoff);
      okxBackoff = Math.min(okxBackoff * 2, 30000);
    }
  };
}
