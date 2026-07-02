import React, { useEffect, useMemo, useState } from 'react';
import { Search, ArrowLeft, TrendingUp, TrendingDown, AlertTriangle, Star, Trophy, Activity, ArrowUpDown } from 'lucide-react';
import type { MarketDef } from '../../lib/markets';
import { fetchMarket, fetchQuotes, fetchSparks, fmtPrice, fmtPct, fmtCompact, type AssetRow } from '../../services/marketsHub';

interface MarketListProps {
  market: MarketDef;
  onAssetSelect: (symbol: string) => void;
  onBack: () => void;
}

type SortKey = 'name' | 'price' | 'changePct' | 'volume' | 'marketCap';

// Tiny inline sparkline from a close series (no per-row fetch).
const MiniSpark = ({ data }: { data: number[] }) => {
  if (data.length < 2) return <span className="text-[color:var(--text-3)]">—</span>;
  const min = Math.min(...data);
  const max = Math.max(...data);
  const range = max - min || 1;
  const w = 96, h = 32;
  const pts = data.map((v, i) => `${(i / (data.length - 1)) * w},${h - ((v - min) / range) * h}`).join(' ');
  const up = data[data.length - 1] >= data[0];
  return (
    <svg width={w} height={h} className="overflow-visible">
      <polyline points={pts} fill="none" stroke={up ? 'var(--up)' : 'var(--down)'} strokeWidth="1.5" strokeLinejoin="round" strokeLinecap="round" />
    </svg>
  );
};

const Delta = ({ pct }: { pct: number }) => {
  const up = pct >= 0;
  return (
    <span className={`inline-flex items-center gap-0.5 font-mono ${up ? 'up' : 'down'}`}>
      {up ? <TrendingUp className="w-2.5 h-2.5" /> : <TrendingDown className="w-2.5 h-2.5" />}
      {fmtPct(pct)}
    </span>
  );
};

const AssetIcon = ({ r, size = 6 }: { r: AssetRow; size?: 5 | 6 }) => {
  const cls = size === 5 ? 'w-5 h-5' : 'w-6 h-6';
  return r.logo ? (
    <img src={r.logo} alt={r.symbol} className={`${cls} rounded-full border border-[color:var(--line)]`} onError={(e) => { (e.target as HTMLImageElement).style.visibility = 'hidden'; }} />
  ) : (
    <span className={`${cls} rounded-full flex items-center justify-center text-[10px] font-bold bg-[color:var(--bg)] text-[color:var(--text-2)] border border-[color:var(--line)] shrink-0`}>
      {r.symbol.replace('^', '').slice(0, 2)}
    </span>
  );
};

// TRENDING/GAINERS/LOSERS-style card matching the crypto Markets page.
const HighlightCard = ({ title, icon: Icon, data, onSelect }: { title: string; icon: any; data: AssetRow[]; onSelect: (s: string) => void }) => (
  <div className="bg-[color:var(--surface)] border border-[color:var(--line)] hover:border-[color:var(--line-strong)] rounded-[4px] p-3 transition-colors lux-border">
    <div className="flex items-center gap-2 mb-3">
      <Icon className="w-3.5 h-3.5 text-[color:var(--accent)]" />
      <span className="label">{title}</span>
    </div>
    <div className="space-y-1">
      {data.length === 0 && (
        <div className="text-label text-[color:var(--text-3)] px-2 py-1.5">Loading…</div>
      )}
      {data.slice(0, 3).map((r, idx) => (
        <div
          key={r.symbol}
          onClick={() => onSelect(r.symbol)}
          className="flex items-center justify-between px-2 py-1.5 -mx-2 rounded-sm cursor-pointer hover:bg-[color:var(--surface-2)] transition-colors"
        >
          <div className="flex items-center gap-2.5 min-w-0">
            <span className="font-mono text-data text-[color:var(--text-3)] w-3">{idx + 1}</span>
            <AssetIcon r={r} size={5} />
            <div className="flex flex-col leading-tight min-w-0">
              <span className="text-data font-semibold text-[color:var(--text)]">{r.symbol.replace('^', '')}</span>
              <span className="text-label text-[color:var(--text-3)] truncate w-24">{r.name}</span>
            </div>
          </div>
          <div className="flex flex-col items-end leading-tight shrink-0">
            <span className="font-mono text-data text-[color:var(--text)]">{fmtPrice(r.price, r.currency)}</span>
            <span className="text-label"><Delta pct={r.changePct} /></span>
          </div>
        </div>
      ))}
    </div>
  </div>
);

export const MarketList: React.FC<MarketListProps> = ({ market, onAssetSelect, onBack }) => {
  // Large Yahoo lists (S&P 500) fetch page-by-page so we never quote 500 symbols
  // at once. Small lists (crypto ~100, TN) load fully.
  const paged = market.source === 'yahoo' && market.symbols.length > 60;

  const [fullRows, setFullRows] = useState<AssetRow[]>([]);
  const [quotes, setQuotes] = useState<Record<string, AssetRow>>({});
  const [sparks, setSparks] = useState<Record<string, number[]>>({});
  const [loading, setLoading] = useState(!paged);
  const [error, setError] = useState(false);
  const [reloadKey, setReloadKey] = useState(0);
  const [query, setQuery] = useState('');
  const [page, setPage] = useState(1);
  const [perPage, setPerPage] = useState(25);
  const [sort, setSort] = useState<{ key: SortKey; dir: 'asc' | 'desc' }>(
    paged ? { key: 'name', dir: 'asc' } : { key: 'marketCap', dir: 'desc' },
  );
  const WKEY = `hub_watchlist_${market.id}`;
  const [watchlist, setWatchlist] = useState<string[]>(() => {
    try { return JSON.parse(localStorage.getItem(WKEY) || '[]'); } catch { return []; }
  });
  const [watchOnly, setWatchOnly] = useState(false);
  useEffect(() => {
    try { setWatchlist(JSON.parse(localStorage.getItem(WKEY) || '[]')); } catch { setWatchlist([]); }
    setWatchOnly(false);
  }, [WKEY]);
  useEffect(() => { localStorage.setItem(WKEY, JSON.stringify(watchlist)); }, [WKEY, watchlist]);
  const toggleWatch = (e: React.MouseEvent, sym: string) => {
    e.stopPropagation();
    setWatchlist((p) => (p.includes(sym) ? p.filter((s) => s !== sym) : [...p, sym]));
  };

  // Full load (non-paged sources).
  useEffect(() => {
    if (paged) return;
    let alive = true;
    setLoading(true); setError(false);
    const load = () =>
      fetchMarket(market)
        .then((r) => { if (alive) { setFullRows(r); setLoading(false); setError(false); } })
        .catch(() => { if (alive) { setLoading(false); if (fullRows.length === 0) setError(true); } });
    load();
    const t = setInterval(load, 15000);
    return () => { alive = false; clearInterval(t); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [market, paged, reloadKey]);

  useEffect(() => { setPage(1); }, [query, market, watchOnly, perPage]);

  const baseRows: AssetRow[] = useMemo(
    () =>
      paged
        ? market.symbols.map((s) => {
            const q = quotes[s.symbol];
            return q || { symbol: s.symbol, name: s.name, price: 0, changePct: 0, currency: market.currency };
          })
        : fullRows,
    [paged, market, fullRows, quotes],
  );

  const hasMcap = baseRows.some((r) => r.marketCap);
  const hasVol = baseRows.some((r) => r.volume);
  const showSpark = market.source === 'yahoo';
  const nCols = 5 + (hasVol ? 1 : 0) + (hasMcap ? 1 : 0) + (showSpark ? 1 : 0);

  const view = useMemo(() => {
    const q = query.toLowerCase();
    const filtered = baseRows.filter(
      (r) =>
        (!watchOnly || watchlist.includes(r.symbol)) &&
        (r.symbol.toLowerCase().includes(q) || r.name.toLowerCase().includes(q)),
    );
    const dir = sort.dir === 'asc' ? 1 : -1;
    return filtered.sort((a, b) => {
      if (sort.key === 'name') return a.name.localeCompare(b.name) * dir;
      return (((a[sort.key] as number) || 0) - ((b[sort.key] as number) || 0)) * dir;
    });
  }, [baseRows, query, sort, watchOnly, watchlist]);

  const totalPages = Math.max(1, Math.ceil(view.length / perPage));
  const pageView = view.slice((page - 1) * perPage, page * perPage);

  // Paged: fetch quotes for the visible page.
  useEffect(() => {
    if (!paged || pageView.length === 0) return;
    let alive = true;
    const need = pageView.map((r) => ({ symbol: r.symbol, name: r.name }));
    fetchQuotes(need).then((qs) => {
      if (!alive) return;
      setQuotes((p) => { const n = { ...p }; qs.forEach((q) => (n[q.symbol] = q)); return n; });
    });
    return () => { alive = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [paged, page, query, sort.key, sort.dir, perPage]);

  // Sparklines for the visible page (Yahoo sources; one batch request).
  useEffect(() => {
    if (!showSpark || pageView.length === 0) return;
    let alive = true;
    const need = pageView.map((r) => r.symbol).filter((s) => !(s in sparks));
    if (!need.length) return;
    fetchSparks(need).then((m) => {
      if (alive && Object.keys(m).length) setSparks((p) => ({ ...p, ...m }));
    });
    return () => { alive = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [showSpark, page, query, sort.key, sort.dir, perPage, market.id, loading]);

  const toggleSort = (key: SortKey) =>
    setSort((p) => ({ key, dir: p.key === key && p.dir === 'desc' ? 'asc' : 'desc' }));

  // Stats + highlights from whatever is quoted so far.
  const loadedRows = (paged ? Object.values(quotes) : fullRows).filter((r) => r.price > 0);
  const gainers = [...loadedRows].sort((a, b) => b.changePct - a.changePct);
  const losers = [...loadedRows].sort((a, b) => a.changePct - b.changePct);
  const active = [...loadedRows].sort((a, b) => (b.volume || 0) - (a.volume || 0));
  const nUp = loadedRows.filter((r) => r.changePct > 0).length;
  const nDown = loadedRows.filter((r) => r.changePct < 0).length;

  const Stat = ({ label, value }: { label: string; value: React.ReactNode }) => (
    <div className="flex items-baseline gap-1.5">
      <span className="label">{label}</span>
      <span className="font-mono text-data text-[color:var(--text)]">{value}</span>
    </div>
  );

  return (
    <div className="flex-1 bg-[color:var(--bg)] overflow-y-auto">
      {/* Market stats bar (mirrors the crypto global bar) */}
      <div className="border-b border-[color:var(--line)] bg-[color:var(--surface)] px-4 py-2 flex flex-wrap items-center gap-x-5 gap-y-1">
        <Stat label="ASSETS" value={market.symbols.length || loadedRows.length} />
        <span className="w-px h-3 bg-[color:var(--line)]" />
        <Stat label="GAINERS" value={<span className="up">{nUp}</span>} />
        <Stat label="LOSERS" value={<span className="down">{nDown}</span>} />
        <span className="w-px h-3 bg-[color:var(--line)]" />
        <div className="flex items-center gap-1.5">
          <Activity className="w-3 h-3 text-[color:var(--text-3)]" />
          <Stat label="UNIT" value={market.currency} />
        </div>
      </div>

      <div className="max-w-[1280px] mx-auto px-4 py-4">
        {/* Header */}
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-3 mb-4">
          <div className="flex items-center gap-3">
            <button
              onClick={onBack}
              className="w-8 h-8 rounded-sm flex items-center justify-center text-[color:var(--text-3)] hover:text-[color:var(--text)] hover:bg-[color:var(--surface-2)] transition-colors"
              title="Back to markets"
            >
              <ArrowLeft className="w-4 h-4" />
            </button>
            <div className="section-mark" data-mark="001 / MARKETS">
              <h2 className="text-h2 font-display font-semibold text-[color:var(--text)] tracking-tight leading-[0.95]">
                {market.label} <span className="text-[color:var(--text-3)] italic font-normal">Prices &amp; Movers</span>
              </h2>
              <p className="text-body text-[color:var(--text-3)] mt-1.5">{market.blurb}</p>
            </div>
          </div>
          <div className="relative">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-[color:var(--text-3)]" />
            <input
              type="text"
              placeholder="Search assets..."
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              className="bg-[color:var(--surface)] border border-[color:var(--line)] text-[color:var(--text)] placeholder:text-[color:var(--text-3)] text-body pl-8 pr-3 py-1.5 rounded-sm focus:outline-none focus:border-[color:var(--line-strong)] w-full md:w-72 transition-colors"
            />
          </div>
        </div>

        {market.id === 'tunisia' && (
          <div className="mb-3 flex items-center gap-2 text-label text-[color:var(--text-3)] bg-[color:var(--surface)] border border-[color:var(--line)] rounded-sm px-3 py-2">
            <AlertTriangle className="w-3.5 h-3.5 text-[color:var(--accent)]" />
            Stock quotes live from BVMT (15-min cache) — TUNINDEX value indicative.
          </div>
        )}

        {/* Highlights */}
        {!query && !watchOnly && (
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3 mb-4 stagger">
            <HighlightCard title="TOP GAINERS" icon={Trophy} data={gainers} onSelect={onAssetSelect} />
            <HighlightCard title="TOP LOSERS" icon={TrendingDown} data={losers} onSelect={onAssetSelect} />
            <HighlightCard title="MOST ACTIVE" icon={Activity} data={hasVol ? active : gainers.slice(3)} onSelect={onAssetSelect} />
          </div>
        )}

        {/* Tabs (mirrors the crypto tab bar) */}
        <div className="flex items-center gap-0 mb-0 border-b border-[color:var(--line)]">
          {([
            { id: false, label: market.label },
            { id: true, label: `Watchlist (${watchlist.length})` },
          ] as { id: boolean; label: string }[]).map((tab) => {
            const isActive = watchOnly === tab.id;
            return (
              <button
                key={String(tab.id)}
                onClick={() => setWatchOnly(tab.id)}
                className={`relative px-3 py-2 text-body font-medium whitespace-nowrap transition-colors ${
                  isActive ? 'text-[color:var(--text)]' : 'text-[color:var(--text-3)] hover:text-[color:var(--text-2)]'
                }`}
              >
                <div className="flex items-center gap-1.5">
                  {tab.id && <Star className={`w-3.5 h-3.5 ${isActive ? 'text-[color:var(--accent)]' : ''}`} />}
                  {tab.label}
                </div>
                {isActive && <span className="absolute bottom-0 left-0 right-0 h-px bg-[color:var(--accent)]" />}
              </button>
            );
          })}
        </div>

        {/* Table */}
        <div className="bg-[color:var(--surface)] border border-t-0 border-[color:var(--line)] overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse whitespace-nowrap">
              <thead>
                <tr className="border-b border-[color:var(--line)] bg-[color:var(--surface-2)]">
                  <th className="py-2 px-4 w-8" />
                  <th className="py-2 px-4 label w-10 hidden sm:table-cell">#</th>
                  {([
                    { key: 'name', label: 'Name', cls: '' },
                    { key: 'price', label: 'Price', cls: 'text-right' },
                    { key: 'changePct', label: '24h %', cls: 'text-right' },
                    ...(hasVol ? [{ key: 'volume', label: 'Volume', cls: 'text-right hidden lg:table-cell' }] : []),
                    ...(hasMcap ? [{ key: 'marketCap', label: 'Market Cap', cls: 'text-right hidden sm:table-cell' }] : []),
                  ] as { key: SortKey; label: string; cls: string }[]).map((h) => (
                    <th
                      key={h.key}
                      onClick={() => toggleSort(h.key)}
                      className={`py-2 px-4 label cursor-pointer hover:text-[color:var(--text)] transition-colors group ${h.cls}`}
                    >
                      <div className={`flex items-center gap-1 ${h.cls.includes('text-right') ? 'justify-end' : ''}`}>
                        {h.label}
                        <ArrowUpDown className="w-2.5 h-2.5 opacity-0 group-hover:opacity-100 transition-opacity" />
                      </div>
                    </th>
                  ))}
                  {showSpark && <th className="py-2 px-4 label text-right hidden md:table-cell">Last 7 Days</th>}
                </tr>
              </thead>
              <tbody>
                {loading ? (
                  Array.from({ length: 10 }).map((_, i) => (
                    <tr key={i} className="border-b border-[color:var(--line)]">
                      <td className="py-3 px-4"><div className="w-3.5 h-3.5 rounded-sm bg-[color:var(--surface-2)] animate-pulse" /></td>
                      <td className="py-3 px-4 hidden sm:table-cell"><div className="h-3 w-4 rounded bg-[color:var(--surface-2)] animate-pulse" /></td>
                      <td className="py-3 px-4"><div className="flex items-center gap-2.5"><div className="w-6 h-6 rounded-full bg-[color:var(--surface-2)] animate-pulse" /><div className="h-3 w-40 rounded bg-[color:var(--surface-2)] animate-pulse" /></div></td>
                      <td className="py-3 px-4"><div className="h-3 w-20 rounded bg-[color:var(--surface-2)] animate-pulse ml-auto" /></td>
                      <td className="py-3 px-4"><div className="h-3 w-14 rounded bg-[color:var(--surface-2)] animate-pulse ml-auto" /></td>
                      {hasVol && <td className="py-3 px-4 hidden lg:table-cell"><div className="h-3 w-14 rounded bg-[color:var(--surface-2)] animate-pulse ml-auto" /></td>}
                      {hasMcap && <td className="py-3 px-4 hidden sm:table-cell"><div className="h-3 w-16 rounded bg-[color:var(--surface-2)] animate-pulse ml-auto" /></td>}
                      {showSpark && <td className="py-3 px-4 hidden md:table-cell"><div className="h-6 w-24 rounded bg-[color:var(--surface-2)] animate-pulse ml-auto" /></td>}
                    </tr>
                  ))
                ) : error ? (
                  <tr><td colSpan={nCols} className="py-10 text-center">
                    <div className="text-body text-[color:var(--text-3)] mb-2">Couldn't load {market.label}.</div>
                    <button onClick={() => { setError(false); setLoading(true); setReloadKey((k) => k + 1); }} className="px-3 py-1.5 rounded-sm text-label font-semibold bg-[color:var(--surface-2)] border border-[color:var(--line)] text-[color:var(--text-2)] hover:text-[color:var(--text)] hover:border-[color:var(--line-strong)] transition-colors">RETRY</button>
                  </td></tr>
                ) : pageView.length === 0 ? (
                  <tr><td colSpan={nCols} className="py-10 text-center text-body text-[color:var(--text-3)]">
                    {watchOnly ? 'Your watchlist is empty. Star assets to add them.' : 'No assets found.'}
                  </td></tr>
                ) : (
                  pageView.map((r, i) => {
                    const loaded = r.price > 0;
                    const up = r.changePct >= 0;
                    return (
                      <tr
                        key={r.symbol}
                        onClick={() => onAssetSelect(r.symbol)}
                        className="border-b border-[color:var(--line)] hover:bg-[color:var(--surface-2)] cursor-pointer transition-colors group"
                      >
                        <td className="py-2.5 px-4" onClick={(e) => toggleWatch(e, r.symbol)}>
                          <Star className={`w-3.5 h-3.5 transition-colors ${watchlist.includes(r.symbol) ? 'text-[color:var(--accent)] fill-[color:var(--accent)]' : 'text-[color:var(--text-3)] hover:text-[color:var(--text)]'}`} />
                        </td>
                        <td className="py-2.5 px-4 font-mono text-data text-[color:var(--text-3)] hidden sm:table-cell">
                          {(page - 1) * perPage + i + 1}
                        </td>
                        <td className="py-2.5 px-4">
                          <div className="flex items-center gap-2.5">
                            <AssetIcon r={r} />
                            <span className="text-body font-semibold text-[color:var(--text)]">{r.name}</span>
                            <span className="font-mono text-label text-[color:var(--text-3)] bg-[color:var(--bg)] border border-[color:var(--line)] px-1.5 py-0.5 rounded-sm">{r.symbol.replace('^', '')}</span>
                          </div>
                        </td>
                        <td className="py-2.5 px-4 text-right font-mono text-data text-[color:var(--text)]">{loaded ? fmtPrice(r.price, r.currency) : '—'}</td>
                        <td className={`py-2.5 px-4 text-right text-data ${loaded ? (up ? 'up' : 'down') : 'text-[color:var(--text-3)]'}`}>
                          {loaded ? <Delta pct={r.changePct} /> : '—'}
                        </td>
                        {hasVol && (
                          <td className="py-2.5 px-4 text-right font-mono text-data text-[color:var(--text-2)] hidden lg:table-cell">
                            {r.volume ? fmtCompact(r.volume) : '—'}
                          </td>
                        )}
                        {hasMcap && (
                          <td className="py-2.5 px-4 text-right font-mono text-data text-[color:var(--text-2)] hidden sm:table-cell">
                            {r.marketCap ? '$' + fmtCompact(r.marketCap) : '—'}
                          </td>
                        )}
                        {showSpark && (
                          <td className="py-2.5 px-4 text-right hidden md:table-cell">
                            <div className="flex items-center justify-end gap-3 relative">
                              <div className="w-24 h-8 transition-opacity group-hover:opacity-0 flex items-center justify-end">
                                <MiniSpark data={sparks[r.symbol] || []} />
                              </div>
                              <div className="absolute inset-0 flex items-center justify-end opacity-0 group-hover:opacity-100 transition-opacity">
                                <button
                                  onClick={(e) => { e.stopPropagation(); onAssetSelect(r.symbol); }}
                                  className="bg-[color:var(--accent)] text-[color:var(--accent-ink)] hover:brightness-110 px-3 py-1 rounded-sm text-label font-semibold transition-colors shiny chrome cta-glow press"
                                  style={{ letterSpacing: '0.06em' }}
                                >
                                  TRADE
                                </button>
                              </div>
                            </div>
                          </td>
                        )}
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>

          {/* Pagination (crypto-style footer) */}
          {!loading && !error && view.length > 0 && (
            <div className="flex flex-col sm:flex-row items-center justify-between px-4 py-2.5 border-t border-[color:var(--line)] gap-3">
              <div className="flex items-center gap-3 text-body text-[color:var(--text-3)]">
                <div>
                  Showing <span className="font-mono text-[color:var(--text)]">{(page - 1) * perPage + 1}</span>–<span className="font-mono text-[color:var(--text)]">{Math.min(page * perPage, view.length)}</span> of <span className="font-mono text-[color:var(--text)]">{view.length}</span>
                </div>
                <div className="flex items-center gap-1.5">
                  <span className="label">ROWS</span>
                  <select
                    value={perPage}
                    onChange={(e) => setPerPage(Number(e.target.value))}
                    className="bg-[color:var(--bg)] border border-[color:var(--line)] text-[color:var(--text)] font-mono text-data rounded-sm px-1.5 py-0.5 focus:outline-none focus:border-[color:var(--line-strong)]"
                  >
                    <option value={25}>25</option>
                    <option value={50}>50</option>
                    <option value={100}>100</option>
                  </select>
                </div>
              </div>
              {totalPages > 1 && (
                <div className="flex items-center gap-1">
                  <button
                    onClick={() => setPage((p) => Math.max(1, p - 1))}
                    disabled={page === 1}
                    className="px-2.5 py-1 rounded-sm bg-[color:var(--bg)] border border-[color:var(--line)] text-[color:var(--text-2)] disabled:opacity-40 disabled:cursor-not-allowed hover:border-[color:var(--line-strong)] hover:text-[color:var(--text)] transition-colors text-label font-semibold"
                  >
                    PREV
                  </button>
                  <span className="px-2 font-mono text-data text-[color:var(--text-3)]">{page} / {totalPages}</span>
                  <button
                    onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                    disabled={page === totalPages}
                    className="px-2.5 py-1 rounded-sm bg-[color:var(--bg)] border border-[color:var(--line)] text-[color:var(--text-2)] disabled:opacity-40 disabled:cursor-not-allowed hover:border-[color:var(--line-strong)] hover:text-[color:var(--text)] transition-colors text-label font-semibold"
                  >
                    NEXT
                  </button>
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
