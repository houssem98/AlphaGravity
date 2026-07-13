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

  loadBase().then(loadSpot);
  setInterval(loadBase, 10000);
  setInterval(loadSpot, 30000);
}
