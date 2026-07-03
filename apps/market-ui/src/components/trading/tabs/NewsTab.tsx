import React, { useState, useEffect, useCallback } from 'react';
import { ExternalLink, Loader2, RefreshCw } from 'lucide-react';
import { safeUrl } from '../../../lib/safeUrl';
import { motion } from 'motion/react';
import type { MarketId } from '../../../lib/markets';

interface NewsItem { title: string; url: string; source: string; time: string }

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

export const NewsTab: React.FC<NewsTabProps> = ({ asset, name, market }) => {
  const [items, setItems] = useState<NewsItem[]>([]);
  const [status, setStatus] = useState<'loading' | 'ready' | 'empty' | 'error'>('loading');

  const isTN = market === 'tunisia';
  const load = useCallback(async () => {
    setStatus('loading');
    try {
      const q = isTN ? `${name || asset} Bourse Tunis` : (name ? `${name} (${asset})` : asset);
      const r = await fetch(`/api/news?q=${encodeURIComponent(q)}&region=${isTN ? 'tn' : 'us'}`);
      const d = await r.json();
      const list: NewsItem[] = d.items || [];
      setItems(list);
      setStatus(list.length ? 'ready' : 'empty');
    } catch { setStatus('error'); }
  }, [asset, name, isTN]);

  useEffect(() => { load(); }, [load]);

  return (
    <div className="flex flex-col flex-1 overflow-hidden bg-[color:var(--bg)]">
      {/* Header */}
      <div className="p-4 border-b border-[color:var(--line)] flex items-center gap-3">
        <span className="text-body font-semibold text-[color:var(--text)]">{name || asset} News</span>
        <button onClick={load} className="ml-auto p-1.5 rounded-sm text-[color:var(--text-3)] hover:text-[color:var(--text)] hover:bg-[color:var(--surface)]" aria-label="Refresh">
          <RefreshCw className={`w-3.5 h-3.5 ${status === 'loading' ? 'animate-spin' : ''}`} />
        </button>
      </div>

      <div className="flex-1 overflow-y-auto">
        {status === 'loading' && (
          <div className="flex items-center justify-center h-full text-[color:var(--text-3)]"><Loader2 className="w-6 h-6 animate-spin" /></div>
        )}
        {status === 'empty' && (
          <div className="flex flex-col items-center justify-center h-full text-center gap-1 px-6">
            <span className="text-body font-semibold text-[color:var(--text-2)]">No recent news</span>
            <span className="text-label text-[color:var(--text-3)]">Nothing published on {name || asset} lately.</span>
          </div>
        )}
        {status === 'error' && (
          <div className="flex items-center justify-center h-full text-label text-[color:var(--text-3)]">Couldn't load news. Try again.</div>
        )}
        {status === 'ready' && (
          <div className="flex flex-col divide-y divide-[color:var(--line)]">
            {items.map((item, idx) => (
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
        )}
      </div>
    </div>
  );
};
