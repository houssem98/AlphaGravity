import React, { useEffect, useMemo, useState } from 'react';
import { Search, ArrowLeft, TrendingUp, TrendingDown, AlertTriangle } from 'lucide-react';
import type { MarketDef } from '../../lib/markets';
import { fetchMarket, fmtPrice, fmtPct, fmtCompact, type AssetRow } from '../../services/marketsHub';

interface MarketListProps {
  market: MarketDef;
  onAssetSelect: (symbol: string) => void;
  onBack: () => void;
}

type SortKey = 'name' | 'price' | 'changePct' | 'marketCap';

export const MarketList: React.FC<MarketListProps> = ({ market, onAssetSelect, onBack }) => {
  const [rows, setRows] = useState<AssetRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [query, setQuery] = useState('');
  const [sort, setSort] = useState<{ key: SortKey; dir: 'asc' | 'desc' }>({ key: 'marketCap', dir: 'desc' });

  useEffect(() => {
    let alive = true;
    setLoading(true);
    const load = () =>
      fetchMarket(market)
        .then((r) => { if (alive) { setRows(r); setLoading(false); } })
        .catch(() => { if (alive) setLoading(false); });
    load();
    // Live poll for real sources; mock is static so skip.
    const t = market.source === 'tunisia-mock' ? undefined : setInterval(load, 15000);
    return () => { alive = false; if (t) clearInterval(t); };
  }, [market]);

  const hasMcap = rows.some((r) => r.marketCap);

  const view = useMemo(() => {
    const q = query.toLowerCase();
    const filtered = rows.filter(
      (r) => r.symbol.toLowerCase().includes(q) || r.name.toLowerCase().includes(q),
    );
    const dir = sort.dir === 'asc' ? 1 : -1;
    return filtered.sort((a, b) => {
      if (sort.key === 'name') return a.name.localeCompare(b.name) * dir;
      return (((a[sort.key] as number) || 0) - ((b[sort.key] as number) || 0)) * dir;
    });
  }, [rows, query, sort]);

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
                ) : view.length === 0 ? (
                  <tr><td colSpan={4} className="py-10 text-center text-body text-[color:var(--text-3)]">No assets found.</td></tr>
                ) : (
                  view.map((r) => {
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
                        <td className="py-2.5 px-4 text-right font-mono text-data text-[color:var(--text)]">{fmtPrice(r.price, r.currency)}</td>
                        <td className={`py-2.5 px-4 text-right font-mono text-data ${up ? 'up' : 'down'}`}>
                          <span className="inline-flex items-center gap-0.5 justify-end">
                            {up ? <TrendingUp className="w-2.5 h-2.5" /> : <TrendingDown className="w-2.5 h-2.5" />}
                            {fmtPct(r.changePct)}
                          </span>
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
        </div>
      </div>
    </div>
  );
};
