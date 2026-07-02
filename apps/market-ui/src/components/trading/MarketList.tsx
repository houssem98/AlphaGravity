import React, { useEffect, useMemo, useState } from 'react';
import { Search, ArrowLeft, TrendingUp, TrendingDown, AlertTriangle } from 'lucide-react';
import type { MarketDef } from '../../lib/markets';
import { fetchMarket, fetchQuotes, fmtPrice, fmtPct, fmtCompact, type AssetRow } from '../../services/marketsHub';

interface MarketListProps {
  market: MarketDef;
  onAssetSelect: (symbol: string) => void;
  onBack: () => void;
}

type SortKey = 'name' | 'price' | 'changePct' | 'marketCap';
const PAGE = 25;

export const MarketList: React.FC<MarketListProps> = ({ market, onAssetSelect, onBack }) => {
  // Large Yahoo lists (S&P 500) fetch page-by-page so we never quote 500 symbols
  // at once. Small lists (crypto ~100, TN mock) load fully.
  const paged = market.source === 'yahoo' && market.symbols.length > 60;

  const [fullRows, setFullRows] = useState<AssetRow[]>([]);
  const [quotes, setQuotes] = useState<Record<string, AssetRow>>({});
  const [loading, setLoading] = useState(!paged);
  const [query, setQuery] = useState('');
  const [page, setPage] = useState(1);
  const [sort, setSort] = useState<{ key: SortKey; dir: 'asc' | 'desc' }>(
    paged ? { key: 'name', dir: 'asc' } : { key: 'marketCap', dir: 'desc' },
  );

  // Full load (non-paged sources).
  useEffect(() => {
    if (paged) return;
    let alive = true;
    setLoading(true);
    const load = () =>
      fetchMarket(market)
        .then((r) => { if (alive) { setFullRows(r); setLoading(false); } })
        .catch(() => { if (alive) setLoading(false); });
    load();
    const t = market.source === 'tunisia-mock' ? undefined : setInterval(load, 15000);
    return () => { alive = false; if (t) clearInterval(t); };
  }, [market, paged]);

  useEffect(() => { setPage(1); }, [query, market]);

  // Base rows: stubs (name/symbol) for paged, live rows otherwise.
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

  const view = useMemo(() => {
    const q = query.toLowerCase();
    const filtered = baseRows.filter(
      (r) => r.symbol.toLowerCase().includes(q) || r.name.toLowerCase().includes(q),
    );
    const dir = sort.dir === 'asc' ? 1 : -1;
    return filtered.sort((a, b) => {
      if (sort.key === 'name') return a.name.localeCompare(b.name) * dir;
      return (((a[sort.key] as number) || 0) - ((b[sort.key] as number) || 0)) * dir;
    });
  }, [baseRows, query, sort]);

  const totalPages = Math.max(1, Math.ceil(view.length / PAGE));
  const pageView = view.slice((page - 1) * PAGE, page * PAGE);

  // Paged: fetch quotes for the visible page (on page/search/sort change).
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
  }, [paged, page, query, sort.key, sort.dir]);

  const toggleSort = (key: SortKey) =>
    setSort((p) => ({ key, dir: p.key === key && p.dir === 'desc' ? 'asc' : 'desc' }));

  return (
    <div className="flex-1 bg-[color:var(--bg)] overflow-y-auto">
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
            <div className="section-mark" data-mark="001 / MARKET">
              <h2 className="text-h2 font-display font-semibold text-[color:var(--text)] tracking-tight leading-[0.95]">
                {market.label}
              </h2>
              <p className="text-body text-[color:var(--text-3)] mt-1">{market.blurb} · {market.currency}</p>
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

        {market.source === 'tunisia-mock' && (
          <div className="mb-3 flex items-center gap-2 text-label text-[color:var(--text-3)] bg-[color:var(--surface)] border border-[color:var(--line)] rounded-sm px-3 py-2">
            <AlertTriangle className="w-3.5 h-3.5 text-[color:var(--accent)]" />
            Indicative data — live BVMT feed coming soon.
          </div>
        )}

        {/* Table */}
        <div className="bg-[color:var(--surface)] border border-[color:var(--line)] rounded-[4px] overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse whitespace-nowrap">
              <thead>
                <tr className="border-b border-[color:var(--line)] bg-[color:var(--surface-2)]">
                  {([
                    { key: 'name', label: 'Name', cls: '' },
                    { key: 'price', label: 'Price', cls: 'text-right' },
                    { key: 'changePct', label: '24h %', cls: 'text-right' },
                    ...(hasMcap ? [{ key: 'marketCap', label: 'Market Cap', cls: 'text-right hidden sm:table-cell' }] : []),
                  ] as { key: SortKey; label: string; cls: string }[]).map((h) => (
                    <th
                      key={h.key}
                      onClick={() => toggleSort(h.key)}
                      className={`py-2 px-4 label cursor-pointer hover:text-[color:var(--text)] transition-colors ${h.cls}`}
                    >
                      {h.label}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {loading ? (
                  <tr><td colSpan={4} className="py-10 text-center label text-[color:var(--text-3)]">LOADING…</td></tr>
                ) : pageView.length === 0 ? (
                  <tr><td colSpan={4} className="py-10 text-center text-body text-[color:var(--text-3)]">No assets found.</td></tr>
                ) : (
                  pageView.map((r) => {
                    const loaded = r.price > 0;
                    const up = r.changePct >= 0;
                    return (
                      <tr
                        key={r.symbol}
                        onClick={() => onAssetSelect(r.symbol)}
                        className="border-b border-[color:var(--line)] hover:bg-[color:var(--surface-2)] cursor-pointer transition-colors"
                      >
                        <td className="py-2.5 px-4">
                          <div className="flex items-center gap-2.5">
                            {r.logo ? (
                              <img src={r.logo} alt={r.symbol} className="w-6 h-6 rounded-full border border-[color:var(--line)]" onError={(e) => { (e.target as HTMLImageElement).style.visibility = 'hidden'; }} />
                            ) : (
                              <span className="w-6 h-6 rounded-full flex items-center justify-center text-[10px] font-bold bg-[color:var(--bg)] text-[color:var(--text-2)] border border-[color:var(--line)]">
                                {r.symbol.replace('^', '').slice(0, 2)}
                              </span>
                            )}
                            <span className="text-body font-semibold text-[color:var(--text)]">{r.name}</span>
                            <span className="font-mono text-label text-[color:var(--text-3)] bg-[color:var(--bg)] border border-[color:var(--line)] px-1.5 py-0.5 rounded-sm">{r.symbol.replace('^', '')}</span>
                          </div>
                        </td>
                        <td className="py-2.5 px-4 text-right font-mono text-data text-[color:var(--text)]">{loaded ? fmtPrice(r.price, r.currency) : '—'}</td>
                        <td className={`py-2.5 px-4 text-right font-mono text-data ${loaded ? (up ? 'up' : 'down') : 'text-[color:var(--text-3)]'}`}>
                          {loaded ? (
                            <span className="inline-flex items-center gap-0.5 justify-end">
                              {up ? <TrendingUp className="w-2.5 h-2.5" /> : <TrendingDown className="w-2.5 h-2.5" />}
                              {fmtPct(r.changePct)}
                            </span>
                          ) : '—'}
                        </td>
                        {hasMcap && (
                          <td className="py-2.5 px-4 text-right font-mono text-data text-[color:var(--text-2)] hidden sm:table-cell">
                            {r.marketCap ? '$' + fmtCompact(r.marketCap) : '—'}
                          </td>
                        )}
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>

          {/* Pagination */}
          {!loading && view.length > PAGE && (
            <div className="flex items-center justify-between px-4 py-2.5 border-t border-[color:var(--line)]">
              <span className="text-body text-[color:var(--text-3)]">
                Showing <span className="font-mono text-[color:var(--text)]">{(page - 1) * PAGE + 1}</span>–
                <span className="font-mono text-[color:var(--text)]">{Math.min(page * PAGE, view.length)}</span> of{' '}
                <span className="font-mono text-[color:var(--text)]">{view.length}</span>
              </span>
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
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
