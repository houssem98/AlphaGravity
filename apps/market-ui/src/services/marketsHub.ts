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
  turnover?: number; // TN: session trading value in TND (volume column headline)
  circulating?: number; // TN: shares outstanding (CMC-style circulating column)
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
// in one server-side call — no per-symbol sparkline round-trip). No mock
// fallback: real data or a visible error state, never fabricated prices.
async function fetchTunisia(_defs: SymbolDef[]): Promise<AssetRow[]> {
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
    turnover: r.turnover || undefined,
    circulating: r.shares || undefined,
    isin: r.isin || undefined,
    currency: 'TND' as const,
    sevenDayCloses: r.closes || undefined,
  }));
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
      // Lead = live TUNINDEX (official), then most-traded live stocks. If the
      // index feed is down, lead with the stocks — never a fabricated level.
      return Promise.all([fetchTunisia(def.symbols), fetchTnIndex()]).then(([rows, idx]) => {
        const top = rows.sort((a, b) => (b.volume || 0) - (a.volume || 0)).slice(0, 4);
        return idx
          ? [{ symbol: 'TUNINDEX', name: 'TUNINDEX', price: idx.level, changePct: idx.changePct, currency: 'TND' as const }, ...top]
          : top;
      });
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

// Hub sparkline for Tunisia — BVMT has no historical index-level feed (only
// today's TUNINDEX snapshot), so we build a real composite from constituent
// data instead of faking one: cap-weighted average of each stock's own 7-day
// close series (from /api/tn/board), normalized to day-0 = 1. Same method a
// cap-weighted index uses, just computed client-side from real closes. [] on failure.
export async function fetchTnIndexSeries(): Promise<number[]> {
  try {
    const res = await fetch('/api/tn/board');
    if (!res.ok) return [];
    const j = await res.json();
    const rows = ((j?.board || []) as { marketCap?: number; closes?: number[] }[])
      .filter((r) => r.marketCap && r.closes && r.closes.length >= 2 && r.closes[0] > 0);
    if (!rows.length) return [];
    const days = Math.min(...rows.map((r) => r.closes!.length));
    const totalCap = rows.reduce((s, r) => s + (r.marketCap || 0), 0);
    const out: number[] = [];
    for (let d = 0; d < days; d++) {
      out.push(rows.reduce((acc, r) => {
        const c = r.closes!.slice(-days);
        return acc + (c[d] / c[0]) * ((r.marketCap || 0) / totalCap);
      }, 0));
    }
    return out;
  } catch {
    return [];
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
