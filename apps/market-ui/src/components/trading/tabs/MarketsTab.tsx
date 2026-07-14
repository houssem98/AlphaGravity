import React, { useState, useEffect } from 'react';
import { motion } from 'motion/react';
import { AlertCircle, Search, X, ArrowUpDown, ExternalLink, Info, SlidersHorizontal, Sparkles, BarChart2 } from 'lucide-react';
import { HermesQueryPanel } from '../HermesQueryPanel';
import { useHermesPanel } from '../../../hooks/useHermesPanel';
import { useMarketsSort } from '../../../hooks/useMarketsSort';

interface MarketsTabProps {
  asset: string;
}

// Known exchange brand colours (monogram fallback) + CoinMarketCap static
// logo ids. Real logos load in the browser from CMC's CDN; any miss/unknown
// exchange falls back to the brand-colour monogram via <img onError>.
const BRAND: Record<string, string> = {
  binance: '#F0B90B',
  coinbase: '#0052FF',
  kraken: '#5741D9',
  okx: '#000000',
  bybit: '#F7A600',
  bitget: '#00F0FF',
  upbit: '#093687',
  aster: '#A78BFA',
  gate: '#2354E6',
  kucoin: '#23AF91',
};

// name-substring -> CMC exchange id (https://s2.coinmarketcap.com/static/img/exchanges/64x64/<id>.png)
const CMC_LOGO_ID: Record<string, number> = {
  binance: 270,
  coinbase: 89,
  kraken: 24,
  okx: 294,
  bybit: 521,
  bitget: 513,
  upbit: 102,
  gate: 302,
  kucoin: 311,
  'crypto.com': 391,
  mexc: 544,
};

function matchKey<T>(name: string, map: Record<string, T>): T | undefined {
  const key = name.toLowerCase();
  for (const k of Object.keys(map)) if (key.includes(k)) return map[k];
  return undefined;
}

function brandColor(name: string): string {
  const hit = matchKey(name, BRAND);
  if (hit) return hit;
  let h = 0;
  for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) % 360;
  return `hsl(${h} 55% 45%)`;
}

const ExchangeLogo: React.FC<{ name: string }> = ({ name }) => {
  const id = matchKey(name, CMC_LOGO_ID);
  const [failed, setFailed] = useState(false);

  if (id && !failed) {
    return (
      <img
        src={`https://s2.coinmarketcap.com/static/img/exchanges/64x64/${id}.png`}
        alt={name}
        loading="lazy"
        onError={() => setFailed(true)}
        className="flex-none w-7 h-7 rounded-full object-cover bg-[color:var(--surface-2)]"
      />
    );
  }

  const color = brandColor(name);
  const initial = name.trim().charAt(0).toUpperCase();
  return (
    <span
      className="flex-none w-7 h-7 rounded-full inline-flex items-center justify-center text-xs font-bold text-white"
      style={{ background: `linear-gradient(135deg, ${color}, color-mix(in oklch, ${color} 70%, #000))` }}
    >
      {initial}
    </span>
  );
};

const SkeletonRow = () => (
  <tr className="border-b border-[color:var(--line)]">
    {Array.from({ length: 8 }).map((_, i) => (
      <td key={i} className="px-3 py-2.5">
        <div className="h-4 bg-[color:var(--surface-2)] rounded-md animate-pulse" />
      </td>
    ))}
  </tr>
);

const TYPE_TABS = ['Spot', 'Perpetual', 'Futures'] as const;
type MarketType = (typeof TYPE_TABS)[number];

// CP-2: CG tickers row → the ExchangeMarket shape the grid already renders.
const fmtUsd = (n: number | null) =>
  n === null ? '—' : `$${n.toLocaleString('en-US', { maximumFractionDigits: n >= 100 ? 0 : n >= 1 ? 2 : 6 })}`;
const fmtCompact = (n: number | null) =>
  n === null ? '—' : `$${Intl.NumberFormat('en-US', { notation: 'compact', maximumFractionDigits: 2 }).format(n)}`;

// CP-2: crypto markets come from CG /coins/{id}/tickers via ?view=tickers
// (15m blob) — keyed by CG id from the base rows, never bare symbol. The dead
// market-server WS path is gone for crypto.
function useCgTickers(asset: string) {
  const [rows, setRows] = useState<any[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [retryKey, setRetryKey] = useState(0);

  useEffect(() => {
    let live = true;
    setLoading(true);
    setError(null);
    setRows(null);
    (async () => {
      const base = await fetch('/api/crypto/markets').then((r) => r.json()).catch(() => []);
      const row = Array.isArray(base) ? base.find((r: any) => r.symbol === asset) : null;
      if (!row?.id) throw new Error('id');
      const r = await fetch(`/api/crypto/markets?view=tickers&id=${encodeURIComponent(row.id)}`);
      if (!r.ok) throw new Error(`${r.status}`);
      const tickers = await r.json();
      if (!Array.isArray(tickers)) throw new Error('shape');
      const volSum = tickers.reduce((s: number, t: any) => s + (t.volumeUsd || 0), 0);
      return tickers.map((t: any, i: number) => ({
        rank: i + 1,
        name: t.name,
        pair: t.pair,
        price: fmtUsd(t.priceUsd),
        depth: { bid: fmtCompact(t.depthUpUsd), ask: fmtCompact(t.depthDownUsd) },
        volume24h: fmtCompact(t.volumeUsd),
        volumePercent: volSum > 0 && t.volumeUsd ? `${((t.volumeUsd / volSum) * 100).toFixed(2)}%` : '—',
        liquidity: Math.round((t.depthUpUsd || 0) + (t.depthDownUsd || 0)),
        spreadBps: t.spreadPct !== null ? Math.round(t.spreadPct * 100) : 0,
        lastUpdate: '',
        symbol: asset,
        market_type: 'spot' as const,
        tradeUrl: t.tradeUrl,
      }));
    })()
      .then((r) => { if (live) setRows(r); })
      .catch(() => { if (live) setError(`Data temporarily unavailable for ${asset}`); })
      .finally(() => { if (live) setLoading(false); });
    return () => { live = false; };
  }, [asset, retryKey]);

  return { rows, loading, error, retry: () => setRetryKey((k) => k + 1) };
}

export const MarketsTab: React.FC<MarketsTabProps> = ({ asset }) => {
  const [hoveredRank, setHoveredRank] = useState<number | null>(null);
  const [filter, setFilter] = useState<'all' | 'cex' | 'dex'>('all');
  const [marketType, setMarketType] = useState<MarketType>('Spot');
  const [showSearch, setShowSearch] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const hermesPanel = useHermesPanel();
  const { rows: cgRows, loading, error, retry } = useCgTickers(asset);
  const marketsData = cgRows ? { exchanges: cgRows } : null;

  const wantType = marketType.toLowerCase(); // 'spot' | 'perpetual' | 'futures'
  const typeFiltered = (marketsData?.exchanges || []).filter((ex) => {
    // Market type (spot/perpetual/futures). Rows default to spot if untagged.
    if ((ex.market_type || 'spot') !== wantType) return false;
    if (filter === 'all') return true;
    const cexNames = ['Binance', 'Coinbase', 'Kraken', 'OKX', 'Bybit', 'Bitget', 'Upbit'];
    const isCEX = cexNames.some((name) => ex.name.includes(name));
    return filter === 'cex' ? isCEX : !isCEX;
  });

  const searchFiltered = typeFiltered.filter((ex) => {
    if (!searchQuery.trim()) return true;
    const q = searchQuery.toLowerCase();
    return ex.name.toLowerCase().includes(q) || ex.pair.toLowerCase().includes(q);
  });

  const { sorted: filteredData, sortField, sortOrder, toggleSort } = useMarketsSort(searchFiltered);

  const segBtn = (active: boolean) =>
    `px-4 py-1.5 rounded-md text-sm font-medium transition-colors duration-150 ${
      active
        ? 'bg-[color:var(--surface)] text-[color:var(--text)] shadow-sm'
        : 'text-[color:var(--text-3)] hover:text-[color:var(--text-2)]'
    }`;

  return (
    <div className="flex flex-col flex-1 overflow-y-auto bg-[color:var(--bg)]">
      {/* Header */}
      <div className="sticky top-0 z-30 px-5 pt-4 pb-3 bg-[color:var(--bg)]">
        <h2 className="text-xl font-bold text-[color:var(--text)] tracking-tight mb-4">{asset} Markets</h2>

        {/* Filter chip rows (CMC-style segmented controls) */}
        <div className="flex items-center gap-3 flex-wrap">
          {/* All / CEX / DEX */}
          <div className="flex items-center gap-1 p-1 rounded-lg bg-[color:var(--surface-2)] border border-[color:var(--line)]">
            {(['All', 'CEX', 'DEX'] as const).map((f) => (
              <button key={f} onClick={() => setFilter(f.toLowerCase() as any)} className={segBtn(filter === f.toLowerCase())}>
                {f}
              </button>
            ))}
          </div>

          {/* Spot / Perpetual / Futures */}
          <div className="flex items-center gap-1 p-1 rounded-lg bg-[color:var(--surface-2)] border border-[color:var(--line)]">
            {TYPE_TABS.map((t) => (
              <button key={t} onClick={() => setMarketType(t)} className={segBtn(marketType === t)}>
                {t}
              </button>
            ))}
          </div>

          {/* Filters (toggles search) */}
          <button
            onClick={() => setShowSearch((s) => !s)}
            className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium border transition-colors ${
              showSearch
                ? 'bg-[color:var(--surface)] text-[color:var(--text)] border-[color:var(--accent)]/40'
                : 'bg-[color:var(--surface-2)] text-[color:var(--text-3)] border-[color:var(--line)] hover:text-[color:var(--text-2)]'
            }`}
          >
            <SlidersHorizontal className="w-4 h-4" />
            Filters
          </button>

          <button
            onClick={() => hermesPanel.openPanel({ exchanges: filteredData, asset })}
            className="ml-auto flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-semibold bg-[color:var(--accent)] text-[color:var(--accent-ink)] hover:opacity-90 transition-opacity whitespace-nowrap"
          >
            <Sparkles className="w-4 h-4" />
            Ask Hermes
          </button>
        </div>

        {/* Collapsible search */}
        {showSearch && (
          <div className="relative max-w-md mt-3">
            <Search className="absolute left-3.5 top-2.5 w-4 h-4 text-[color:var(--text-3)]" />
            <input
              type="text"
              autoFocus
              placeholder="Search exchange or pair..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full pl-10 pr-9 py-2 rounded-lg bg-[color:var(--surface-2)] border border-[color:var(--line)] text-[color:var(--text)] text-sm placeholder-[color:var(--text-3)] focus:outline-none focus:ring-2 focus:ring-[color:var(--accent)]/40"
            />
            {searchQuery && (
              <button onClick={() => setSearchQuery('')} className="absolute right-3 top-2.5 text-[color:var(--text-3)] hover:text-[color:var(--text)]">
                <X className="w-4 h-4" />
              </button>
            )}
          </div>
        )}
      </div>

      {/* Error */}
      {error && (
        <div className="flex-1 px-6 py-8 flex items-center justify-center">
          <div className="text-center">
            <AlertCircle className="w-12 h-12 text-[color:var(--down)] mx-auto mb-3 opacity-50" />
            <p className="text-[color:var(--text-3)]">{error}</p>
            <button onClick={retry} className="mt-3 px-4 py-2 rounded-lg text-sm font-semibold bg-[color:var(--accent)] text-[color:var(--accent-ink)] hover:opacity-90">Retry</button>
          </div>
        </div>
      )}

      {/* Table */}
      {!error && (
        <div className="flex-1 px-5 pb-5 overflow-x-auto">
          <table className="w-full text-sm border-collapse">
            <thead>
              <tr className="border-b border-[color:var(--line)]">
                <th className="px-3 py-2.5 text-left text-xs font-semibold text-[color:var(--text-3)]">#</th>
                <th className="px-3 py-2.5 text-left text-xs font-semibold text-[color:var(--text-3)]">Exchange</th>
                <th className="px-3 py-2.5 text-left text-xs font-semibold text-[color:var(--text-3)]">Pairs</th>
                <th
                  onClick={() => toggleSort('price')}
                  className="px-3 py-2.5 text-right text-xs font-semibold text-[color:var(--text-3)] cursor-pointer hover:text-[color:var(--text)] transition-colors"
                >
                  <span className="inline-flex items-center gap-1.5">
                    Price
                    <ArrowUpDown className={`w-3.5 h-3.5 ${sortField === 'price' ? 'text-[color:var(--accent)]' : 'opacity-30'} ${sortField === 'price' && sortOrder === 'asc' ? 'rotate-180' : ''}`} />
                  </span>
                </th>
                <th className="px-3 py-2.5 text-right text-xs font-semibold text-[color:var(--text-3)]">
                  <span className="inline-flex items-center gap-1.5">
                    <Info className="w-3.5 h-3.5 opacity-50" />
                    +2% / -2% Depth
                  </span>
                </th>
                <th
                  onClick={() => toggleSort('volume24h')}
                  className="px-3 py-2.5 text-right text-xs font-semibold text-[color:var(--text-3)] cursor-pointer hover:text-[color:var(--text)] transition-colors"
                >
                  <span className="inline-flex items-center gap-1.5">
                    <Info className="w-3.5 h-3.5 opacity-50" />
                    Volume (24h)
                    <ArrowUpDown className={`w-3.5 h-3.5 ${sortField === 'volume24h' ? 'text-[color:var(--accent)]' : 'opacity-30'} ${sortField === 'volume24h' && sortOrder === 'asc' ? 'rotate-180' : ''}`} />
                  </span>
                </th>
                <th className="px-3 py-2.5 text-right text-xs font-semibold text-[color:var(--text-3)]">Volume %</th>
                <th
                  onClick={() => toggleSort('liquidity')}
                  className="px-3 py-2.5 text-right text-xs font-semibold text-[color:var(--text-3)] cursor-pointer hover:text-[color:var(--text)] transition-colors"
                >
                  <span className="inline-flex items-center gap-1.5">
                    <Info className="w-3.5 h-3.5 opacity-50" />
                    Liquidity
                    <ArrowUpDown className={`w-3.5 h-3.5 ${sortField === 'liquidity' ? 'text-[color:var(--accent)]' : 'opacity-30'} ${sortField === 'liquidity' && sortOrder === 'asc' ? 'rotate-180' : ''}`} />
                  </span>
                </th>
              </tr>
            </thead>
            <tbody>
              {loading
                ? Array.from({ length: 8 }).map((_, i) => <SkeletonRow key={i} />)
                : filteredData.map((ex, idx) => {
                    const isHovered = hoveredRank === ex.rank;
                    return (
                      <motion.tr
                        key={`${ex.rank}-${ex.pair}`}
                        initial={{ opacity: 0, y: 4 }}
                        animate={{ opacity: 1, y: 0 }}
                        transition={{ delay: idx * 0.015 }}
                        onMouseEnter={() => setHoveredRank(ex.rank)}
                        onMouseLeave={() => setHoveredRank(null)}
                        className={`border-b border-[color:var(--line)] transition-colors ${
                          isHovered ? 'bg-[color:var(--surface-2)]' : ''
                        }`}
                      >
                        {/* Rank */}
                        <td className="px-3 py-2.5 text-[color:var(--text-3)] tabular-nums">{ex.rank}</td>

                        {/* Exchange */}
                        <td className="px-3 py-2.5">
                          <div className="flex items-center gap-3">
                            <ExchangeLogo name={ex.name} />
                            <span className="font-semibold text-[color:var(--text)]">{ex.name}</span>
                          </div>
                        </td>

                        {/* Pairs */}
                        <td className="px-3 py-2.5">
                          <span className="inline-flex items-center gap-1 font-medium text-[color:var(--accent)] hover:underline cursor-pointer">
                            {ex.pair}
                            <ExternalLink className="w-3 h-3 opacity-70" />
                          </span>
                        </td>

                        {/* Price */}
                        <td className="px-3 py-2.5 text-right font-mono font-semibold text-[color:var(--text)] tabular-nums">
                          {ex.price}
                        </td>

                        {/* Depth pill */}
                        <td className="px-3 py-2.5 text-right">
                          <span className="inline-flex items-center gap-1 px-2 py-1 rounded-md bg-[color:var(--surface-2)] font-mono text-xs tabular-nums">
                            <span className="text-[color:var(--up)] font-semibold">{ex.depth.bid}</span>
                            <span className="text-[color:var(--text-3)]">/</span>
                            <span className="text-[color:var(--down)] font-semibold">{ex.depth.ask}</span>
                          </span>
                        </td>

                        {/* Volume (24h) pill */}
                        <td className="px-3 py-2.5 text-right">
                          <span className="inline-block px-2 py-1 rounded-md font-mono text-xs font-semibold tabular-nums text-[color:var(--up)] bg-[color:color-mix(in_oklch,var(--up)_12%,var(--surface-2))]">
                            {ex.volume24h}
                          </span>
                        </td>

                        {/* Volume % */}
                        <td className="px-3 py-2.5 text-right font-mono text-xs tabular-nums text-[color:var(--text-2)]">
                          {ex.volumePercent}
                        </td>

                        {/* Liquidity pill */}
                        <td className="px-3 py-2.5 text-right">
                          <span className="inline-flex items-center gap-1.5 px-2 py-1 rounded-md bg-[color:var(--surface-2)] font-mono text-xs font-semibold tabular-nums text-[color:var(--text)]">
                            <BarChart2 className="w-3 h-3 text-[color:var(--text-3)]" />
                            {ex.liquidity.toLocaleString()}
                          </span>
                        </td>
                      </motion.tr>
                    );
                  })}
            </tbody>
          </table>

          {!loading && filteredData.length === 0 && (
            <div className="py-16 text-center text-[color:var(--text-3)] text-sm">No markets match your filters.</div>
          )}
        </div>
      )}

      {/* Hermes Query Panel */}
      {hermesPanel.isOpen && (
        <HermesQueryPanel asset={asset} context={hermesPanel.selectedContext} onClose={hermesPanel.closePanel} />
      )}
    </div>
  );
};
