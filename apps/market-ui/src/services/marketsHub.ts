// One adapter for every market. Normalizes crypto / Yahoo / TN-mock into AssetRow.
// Swapping a source is a one-line change in fetchMarket().

import type { MarketDef, SymbolDef, Unit } from '../lib/markets';

export interface AssetRow {
  symbol: string;
  name: string;
  price: number;
  changePct: number; // day / 24h
  changePct1h?: number;
  changePct7d?: number;
  marketCap?: number;
  volume?: number;
  currency: Unit;
  logo?: string;
  isin?: string; // BVMT listings — used for official fiche-valeur links
  sevenDayCloses?: number[]; // TN: bundled with the row fetch (no per-symbol spark call)
}

// ── Formatting ────────────────────────────────────────────────
export const fmtCompact = (n: number) => {
  const a = Math.abs(n);
  if (a >= 1e12) return (n / 1e12).toFixed(2) + 'T';
  if (a >= 1e9) return (n / 1e9).toFixed(2) + 'B';
  if (a >= 1e6) return (n / 1e6).toFixed(2) + 'M';
  if (a >= 1e3) return (n / 1e3).toFixed(2) + 'K';
  return n.toFixed(2);
};

export const fmtPrice = (n: number, unit: Unit) => {
  if (unit === 'PCT') return `${n.toFixed(2)}%`;
  if (unit === 'RATE') return n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 4 });
  const digits = Math.abs(n) < 1 ? (Math.abs(n) < 0.01 ? 6 : 4) : 2;
  const v = n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: digits });
  return unit === 'TND' ? `${v} TND` : `$${v}`;
};

export const fmtPct = (n: number) => `${n >= 0 ? '+' : ''}${n.toFixed(2)}%`;

// ── Sources ───────────────────────────────────────────────────
async function fetchCrypto(): Promise<AssetRow[]> {
  const res = await fetch('/api/crypto/markets');
  if (!res.ok) throw new Error('crypto fetch failed');
  const data = await res.json();
  return (Array.isArray(data) ? data : []).map((c: any) => ({
    symbol: c.symbol,
    name: c.name,
    price: parseFloat(c.priceUsd || '0'),
    changePct: parseFloat(c.changePercent24Hr || '0'),
    changePct1h: parseFloat(c.changePercent1Hr || '0'),
    changePct7d: parseFloat(c.changePercent7d || '0'),
    marketCap: parseFloat(c.marketCapUsd || '0'),
    volume: parseFloat(c.volumeUsd24Hr || '0'),
    currency: 'USD' as const,
    logo: `https://assets.coincap.io/assets/icons/${(c.symbol || 'btc').toLowerCase()}@2x.png`,
  }));
}

// Public: fetch live quotes for an arbitrary symbol list (used for page-based
// fetching of the full S&P 500 so we never hit Yahoo for 500 symbols at once).
export async function fetchQuotes(defs: SymbolDef[]): Promise<AssetRow[]> {
  const nameMap = new Map(defs.map((d) => [d.symbol, d.name]));
  const chunks: SymbolDef[][] = [];
  for (let i = 0; i < defs.length; i += 50) chunks.push(defs.slice(i, i + 50));
  const results = await Promise.all(
    chunks.map(async (chunk) => {
      const q = chunk.map((d) => d.symbol).join(',');
      const res = await fetch(`/api/quote?symbols=${encodeURIComponent(q)}`);
      if (!res.ok) return [];
      const j = await res.json();
      return (j?.quoteResponse?.result || []) as any[];
    }),
  );
  const bySym = new Map<string, any>(results.flat().map((r: any) => [r.symbol, r]));
  // Preserve input order (Yahoo may reorder / drop symbols).
  return defs
    .map((d) => bySym.get(d.symbol))
    .filter(Boolean)
    .map((x: any) => ({
      symbol: x.symbol,
      name: nameMap.get(x.symbol) || x.symbol,
      price: x.regularMarketPrice ?? 0,
      changePct: x.regularMarketChangePercent ?? 0,
      marketCap: x.marketCap || undefined,
      volume: x.regularMarketVolume || undefined,
      currency: 'USD' as const,
    }));
}

// Live BVMT stocks via our /api/tn/board proxy (marketCap + 7d closes bundled
// in one server-side call — no per-symbol sparkline round-trip). Falls back to
// the static mock below if the proxy or BVMT is down.
async function fetchTunisia(defs: SymbolDef[]): Promise<AssetRow[]> {
  try {
    const res = await fetch('/api/tn/board');
    if (!res.ok) throw new Error('tn fetch failed');
    const j = await res.json();
    const rows = (j?.board || []) as any[];
    if (!rows.length) throw new Error('tn empty');
    return rows.map((r) => ({
      symbol: r.symbol,
      name: r.name,
      price: r.price,
      changePct: r.changePct,
      changePct7d: r.change7d ?? undefined,
      marketCap: r.marketCap || undefined,
      volume: r.volume || undefined,
      isin: r.isin || undefined,
      currency: 'TND' as const,
      sevenDayCloses: r.closes || undefined,
    }));
  } catch {
    return fetchTunisiaMock(defs);
  }
}

// ponytail: TUNINDEX still indicative (no public BVMT index endpoint found);
// stocks are live. Mock doubles as offline fallback.
const TN_MOCK: Record<string, { name: string; price: number; changePct: number }> = {
  TUNINDEX: { name: 'TUNINDEX', price: 9847.32, changePct: -0.18 },
  BIAT: { name: 'Banque Internationale Arabe de Tunisie', price: 118.45, changePct: 0.92 },
  SFBT: { name: 'Société Frigorifique et Brasserie de Tunis', price: 17.8, changePct: 0.34 },
  BNA: { name: 'Banque Nationale Agricole', price: 9.12, changePct: -0.33 },
  ATB: { name: 'Arab Tunisian Bank', price: 4.78, changePct: 1.15 },
  PGH: { name: 'Poulina Group Holding', price: 11.4, changePct: 0.62 },
  DELICE: { name: 'Délice Holding', price: 13.9, changePct: -0.21 },
  TLNET: { name: 'Telnet Holding', price: 6.32, changePct: -0.55 },
  SAH: { name: 'SAH Lilas', price: 9.85, changePct: 0.4 },
  ATTIJARI: { name: 'Attijari Bank', price: 44.2, changePct: 1.08 },
  CELLCOM: { name: 'Cellcom', price: 3.15, changePct: -0.7 },
};

function fetchTunisiaMock(defs: SymbolDef[]): AssetRow[] {
  return defs
    .filter((d) => TN_MOCK[d.symbol])
    .map((d) => {
      const m = TN_MOCK[d.symbol];
      return {
        symbol: d.symbol,
        name: d.name || m.name,
        price: m.price,
        changePct: m.changePct,
        currency: 'TND' as const,
      };
    });
}

// ── Dispatch ──────────────────────────────────────────────────
export function fetchMarket(def: MarketDef): Promise<AssetRow[]> {
  switch (def.source) {
    case 'crypto':
      return fetchCrypto();
    case 'yahoo':
      return fetchQuotes(def.symbols);
    case 'tunisia':
      return fetchTunisia(def.symbols);
  }
}

// Headline instruments for the hub card (indices, not the full list).
export function fetchHeadline(def: MarketDef): Promise<AssetRow[]> {
  switch (def.source) {
    case 'crypto':
      return fetchCrypto().then((rows) => {
        const bySym = new Map(rows.map((r) => [r.symbol, r]));
        return def.indices.map((d) => bySym.get(d.symbol)).filter(Boolean) as AssetRow[];
      });
    case 'yahoo':
      return fetchQuotes(def.indices);
    case 'tunisia':
      // Lead = live TUNINDEX (official), then most-traded live stocks.
      return Promise.all([fetchTunisia(def.symbols), fetchTnIndex()]).then(([rows, idx]) => [
        idx
          ? { symbol: 'TUNINDEX', name: 'TUNINDEX', price: idx.level, changePct: idx.changePct, currency: 'TND' as const }
          : fetchTunisiaMock(def.indices)[0],
        ...rows.sort((a, b) => (b.volume || 0) - (a.volume || 0)).slice(0, 4),
      ]);
  }
}

// Live official TUNINDEX level + day change (BVMT indices feed). null on failure.
export async function fetchTnIndex(): Promise<{ level: number; changePct: number } | null> {
  try {
    const res = await fetch('/api/tn/index');
    if (!res.ok) return null;
    const j = await res.json();
    return j?.tunindex ? { level: j.tunindex.level, changePct: j.tunindex.changePct } : null;
  } catch {
    return null;
  }
}

// Batch 7d sparklines for a page of Yahoo symbols. {} on failure.
export async function fetchSparks(symbols: string[]): Promise<Record<string, number[]>> {
  if (!symbols.length) return {};
  try {
    const res = await fetch(`/api/spark?symbols=${encodeURIComponent(symbols.join(','))}`);
    if (!res.ok) return {};
    return await res.json();
  } catch {
    return {};
  }
}

// Intraday close series for a Yahoo symbol (hub area charts). [] on failure.
export async function fetchCloses(symbol: string, range = '1d', interval = '15m'): Promise<number[]> {
  try {
    const res = await fetch(`/api/history?symbol=${encodeURIComponent(symbol)}&interval=${interval}&range=${range}`);
    if (!res.ok) return [];
    const j = await res.json();
    const closes = j?.chart?.result?.[0]?.indicators?.quote?.[0]?.close;
    return Array.isArray(closes) ? closes.filter((n: any) => typeof n === 'number') : [];
  } catch {
    return [];
  }
}
