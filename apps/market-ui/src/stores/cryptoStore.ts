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
