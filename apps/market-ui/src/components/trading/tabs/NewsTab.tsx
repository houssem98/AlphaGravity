import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { ExternalLink, Loader2, RefreshCw } from 'lucide-react';
import { safeUrl } from '../../../lib/safeUrl';
import { motion } from 'motion/react';
import type { MarketId } from '../../../lib/markets';
import { useCryptoStore, livePrice } from '../../../stores/cryptoStore';

interface NewsItem { title: string; url: string; source: string; time: string; image?: string }

interface NewsTabProps {
  asset: string;
  name?: string;
  market?: MarketId;
}

function timeAgo(iso: string): string {
  const diff = (Date.now() - new Date(iso).getTime()) / 1000;
  if (isNaN(diff) || diff < 0) return '';
  if (diff < 3600) return `${Math.floor(diff / 60)} min ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)} hours ago`;
  return `${Math.floor(diff / 86400)} days ago`;
}

const TIER1_SOURCES = new Set([
  'coindesk', 'cointelegraph', 'bloomberg', 'reuters', 'cnbc', 'forbes', 'decrypt',
]);

export const NewsTab: React.FC<NewsTabProps> = ({ asset, name, market }) => {
  const [items, setItems] = useState<NewsItem[]>([]);
  const [status, setStatus] = useState<'loading' | 'ready' | 'empty' | 'error'>('loading');
  const [sortMode, setSortMode] = useState<'latest' | 'top'>('latest');

  const isTN = market === 'tunisia';
  // V9 N-2: terminal header reads THE price from cryptoStore (one-source rule)
  const row = useCryptoStore((s) => s.base.find((r: any) => r.symbol === asset));
  const spotRow = useCryptoStore((s) => s.spot[asset]);
  const price = isTN ? null : livePrice(row, spotRow);
  const chg24Raw = !isTN && row ? parseFloat(row.changePercent24Hr) : NaN;
  const chg24 = isFinite(chg24Raw) ? chg24Raw : null;
  const load = useCallback(async () => {
    setStatus('loading');
    try {
      // CP-6: crypto queries by coin NAME + symbol, whitelisted sources only.
      // NT-1/NT-2: 7-day horizon + strict per-coin title match (TN untouched).
      const cleanName = (name || '').split('(')[0].trim();
      const q = isTN ? `${name || asset} Bourse Tunis` : (cleanName ? `${cleanName} ${asset} crypto` : `${asset} crypto`);
      const extra = isTN ? '' : `&wl=crypto&days=7&match=${encodeURIComponent(cleanName || asset)}&sym=${encodeURIComponent(asset)}`;
      const r = await fetch(`/api/news?q=${encodeURIComponent(q)}&region=${isTN ? 'tn' : 'us'}${extra}`);
      const d = await r.json();
      const list: NewsItem[] = d.items || [];
      setItems(list);
      setStatus(list.length ? 'ready' : 'empty');
    } catch { setStatus('error'); }
  }, [asset, name, isTN]);

  useEffect(() => { load(); }, [load]);

  // V10-2: compute hero + list based on sort mode
  const { heroItem, listItems } = useMemo(() => {
    if (status !== 'ready' || !items.length) return { heroItem: null, listItems: [] };

    if (!isTN && items.some((i) => i.image)) {
      // crypto + has images: sort + split
      const sorted =
        sortMode === 'top'
          ? [
              ...items.filter((i) => i.image && TIER1_SOURCES.has(i.source.toLowerCase())),
              ...items.filter((i) => i.image && !TIER1_SOURCES.has(i.source.toLowerCase())),
              ...items.filter((i) => !i.image),
            ]
          : items; // latest: server order
      return { heroItem: sorted[0] || null, listItems: sorted.slice(1) };
    }
    // no images or TN: plain list
    return { heroItem: null, listItems: items };
  }, [items, status, isTN, sortMode]);

  return (
    <div className="flex flex-col flex-1 overflow-hidden bg-[color:var(--bg)]">
      {/* Header — V9 N-2: crypto gets the terminal report block, TN keeps plain */}
      {isTN ? (
        <div className="p-4 border-b border-[color:var(--line)] flex items-center gap-3">
          <span className="text-body font-semibold text-[color:var(--text)]">{name || asset} News</span>
          <button onClick={load} className="ml-auto p-1.5 rounded-sm text-[color:var(--text-3)] hover:text-[color:var(--text)] hover:bg-[color:var(--surface)]" aria-label="Refresh">
            <RefreshCw className={`w-3.5 h-3.5 ${status === 'loading' ? 'animate-spin' : ''}`} />
          </button>
        </div>
      ) : (
        <div className="p-4 border-b border-[color:var(--line)]">
          <div className="flex items-center gap-3">
            <span className="text-body font-semibold text-[color:var(--text)] tracking-wide">
              {(name || asset).split('(')[0].trim().toUpperCase()} ({asset}) — NETWORK NEWS
            </span>
            {heroItem && (
              <div className="ml-auto flex gap-1 bg-[color:var(--surface)] rounded-sm p-0.5 border border-[color:var(--line)]">
                <button
                  onClick={() => setSortMode('latest')}
                  className={`px-2 py-1 text-label font-semibold rounded-sm transition-colors ${
                    sortMode === 'latest'
                      ? 'text-[color:var(--text)] bg-[color:var(--bg)]'
                      : 'text-[color:var(--text-3)] hover:text-[color:var(--text)]'
                  }`}
                >
                  LATEST
                </button>
                <button
                  onClick={() => setSortMode('top')}
                  className={`px-2 py-1 text-label font-semibold rounded-sm transition-colors ${
                    sortMode === 'top'
                      ? 'text-[color:var(--text)] bg-[color:var(--bg)]'
                      : 'text-[color:var(--text-3)] hover:text-[color:var(--text)]'
                  }`}
                >
                  TOP
                </button>
              </div>
            )}
            <button onClick={load} className="p-1.5 rounded-sm text-[color:var(--text-3)] hover:text-[color:var(--text)] hover:bg-[color:var(--surface)]" aria-label="Refresh">
              <RefreshCw className={`w-3.5 h-3.5 ${status === 'loading' ? 'animate-spin' : ''}`} />
            </button>
          </div>
          <div className="mt-2 font-mono text-label text-[color:var(--text-3)] border border-[color:var(--line)] rounded-sm px-2.5 py-1.5 flex flex-wrap gap-x-3">
            <span className="text-[color:var(--text-2)]">{price != null ? `$${price >= 1 ? price.toLocaleString(undefined, { maximumFractionDigits: 2 }) : price.toPrecision(4)}` : '--'}</span>
            <span className={chg24 == null ? '' : chg24 >= 0 ? 'text-[color:var(--up,#22c55e)]' : 'text-[color:var(--down,#ef4444)]'}>
              {chg24 != null ? `${chg24 >= 0 ? '+' : ''}${chg24.toFixed(2)}% 24H` : '-- 24H'}
            </span>
            <span>{items.length} ARTICLES</span>
            <span>7D WINDOW</span>
          </div>
        </div>
      )}

      <div className="flex-1 overflow-y-auto">
        {status === 'loading' && (
          <div className="flex items-center justify-center h-full text-[color:var(--text-3)]"><Loader2 className="w-6 h-6 animate-spin" /></div>
        )}
        {status === 'empty' && (
          <div className="flex flex-col items-center justify-center h-full text-center gap-1 px-6">
            <span className="text-body font-semibold text-[color:var(--text-2)]">No recent news</span>
            <span className="text-label text-[color:var(--text-3)]">{isTN ? `Nothing published on ${name || asset} lately.` : `No recent news articles found for ${name || asset} within the last week.`}</span>
          </div>
        )}
        {status === 'error' && (
          <div className="flex items-center justify-center h-full text-label text-[color:var(--text-3)]">Couldn't load news. Try again.</div>
        )}
        {status === 'ready' && (
          heroItem ? (
            // V10-2: CMC-style two-zone layout (crypto with images)
            <div className="flex flex-col md:flex-row gap-4 p-4 overflow-auto">
              {/* LEFT: Hero article */}
              <motion.a
                href={safeUrl(heroItem.url)}
                target="_blank"
                rel="noopener noreferrer"
                initial={{ opacity: 0, y: 6 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0 }}
                className="group flex-shrink-0 md:flex-1 md:max-w-sm flex flex-col bg-[color:var(--surface)] rounded-sm border border-[color:var(--line)] overflow-hidden hover:border-[color:var(--accent)] transition-colors"
              >
                {heroItem.image && (
                  <img
                    src={heroItem.image}
                    alt={heroItem.title}
                    className="w-full aspect-video object-cover"
                    onError={(e) => { e.currentTarget.style.display = 'none'; }}
                  />
                )}
                <div className="flex-1 flex flex-col p-3">
                  <h3 className="text-lg font-semibold text-[color:var(--text)] group-hover:text-[color:var(--accent)] transition-colors line-clamp-3">{heroItem.title}</h3>
                  <div className="flex items-center gap-2 mt-auto text-label text-[color:var(--text-3)]">
                    <span className="truncate">{heroItem.source}</span>
                    {heroItem.time && <span>· {timeAgo(heroItem.time)}</span>}
                  </div>
                </div>
              </motion.a>
              {/* RIGHT: List */}
              <div className="flex-1 flex flex-col divide-y divide-[color:var(--line)] overflow-auto">
                {listItems.map((item, idx) => (
                  <motion.a
                    key={idx}
                    href={safeUrl(item.url)}
                    target="_blank"
                    rel="noopener noreferrer"
                    initial={{ opacity: 0, y: 6 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ delay: Math.min((idx + 1) * 0.03, 0.3) }}
                    className="group flex items-start gap-2 py-2 px-3 hover:bg-[color:var(--surface)] transition-colors"
                  >
                    {item.image && (
                      <img
                        src={item.image}
                        alt={item.title}
                        className="w-10 h-10 flex-shrink-0 rounded object-cover"
                        onError={(e) => { e.currentTarget.style.display = 'none'; }}
                      />
                    )}
                    <div className="flex-1 min-w-0">
                      <h3 className="text-body text-[color:var(--text)] group-hover:text-[color:var(--accent)] transition-colors line-clamp-2">{item.title}</h3>
                      <div className="flex items-center gap-2 mt-1 text-label text-[color:var(--text-3)]">
                        <span className="truncate">{item.source}</span>
                        {item.time && <span>· {timeAgo(item.time)}</span>}
                      </div>
                    </div>
                    <ExternalLink className="w-3.5 h-3.5 text-[color:var(--text-3)] opacity-0 group-hover:opacity-100 transition-opacity shrink-0 mt-0.5 flex-shrink-0" />
                  </motion.a>
                ))}
              </div>
            </div>
          ) : (
            // Plain list (no hero: TN or no images)
            <div className="flex flex-col divide-y divide-[color:var(--line)]">
              {listItems.map((item, idx) => (
                <motion.a
                  key={idx}
                  href={safeUrl(item.url)}
                  target="_blank"
                  rel="noopener noreferrer"
                  initial={{ opacity: 0, y: 6 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: Math.min(idx * 0.03, 0.3) }}
                  className="group flex items-start gap-3 px-4 py-3 hover:bg-[color:var(--surface)] transition-colors"
                >
                  <div className="flex-1 min-w-0">
                    <h3 className="text-body text-[color:var(--text)] group-hover:text-[color:var(--accent)] transition-colors line-clamp-2">{item.title}</h3>
                    <div className="flex items-center gap-2 mt-1 text-label text-[color:var(--text-3)]">
                      <span className="truncate">{item.source}</span>
                      {item.time && <span>· {timeAgo(item.time)}</span>}
                    </div>
                  </div>
                  <ExternalLink className="w-3.5 h-3.5 text-[color:var(--text-3)] opacity-0 group-hover:opacity-100 transition-opacity shrink-0 mt-1" />
                </motion.a>
              ))}
            </div>
          )
        )}
      </div>
    </div>
  );
};
