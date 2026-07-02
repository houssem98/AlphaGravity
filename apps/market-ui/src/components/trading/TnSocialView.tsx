import React, { useEffect, useState } from 'react';
import { TrendingUp, TrendingDown, Minus, ExternalLink, Loader2, RefreshCw } from 'lucide-react';

interface TnSocialViewProps {
  asset: string;
  name?: string;
}

interface NewsItem { title: string; url: string; source: string; time: string }
type Tone = 'bullish' | 'bearish' | 'neutral';

// FR + EN lexicon — BVMT coverage is mostly French financial press.
const POS = ['hausse', 'progress', 'bénéfice', 'benefice', 'croissance', 'record', 'gain', 'succès', 'succes', 'dividende', 'surperform', 'rachat', 'accord', 'partenariat', 'expansion', 'profit', 'surge', 'rise', 'beat', 'growth', 'upgrade', 'strong', 'jump'];
const NEG = ['baisse', 'perte', 'chute', 'recul', 'déficit', 'deficit', 'sanction', 'litige', 'dette', 'défaut', 'defaut', 'fraude', 'enquête', 'enquete', 'suspension', 'avertissement', 'downgrade', 'drop', 'fall', 'loss', 'weak', 'plunge', 'probe', 'warning'];

function score(title: string): Tone {
  const t = title.toLowerCase();
  let s = 0;
  for (const w of POS) if (t.includes(w)) s++;
  for (const w of NEG) if (t.includes(w)) s--;
  return s > 0 ? 'bullish' : s < 0 ? 'bearish' : 'neutral';
}

function timeAgo(iso: string): string {
  const diff = (Date.now() - new Date(iso).getTime()) / 1000;
  if (isNaN(diff) || diff < 0) return '';
  if (diff < 3600) return `${Math.floor(diff / 60)}m`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h`;
  return `${Math.floor(diff / 86400)}d`;
}

const TONE = {
  bullish: { label: '▲ Bullish', color: '#00C853' },
  bearish: { label: '▼ Bearish', color: '#FF3D3D' },
  neutral: { label: '— Neutral', color: '#8A92A6' },
} as const;

export const TnSocialView: React.FC<TnSocialViewProps> = ({ asset, name }) => {
  const [items, setItems] = useState<NewsItem[]>([]);
  const [status, setStatus] = useState<'loading' | 'ready' | 'empty' | 'error'>('loading');

  const load = React.useCallback(async () => {
    setStatus('loading');
    try {
      const q = `${name || asset} Bourse Tunis`;
      const r = await fetch(`/api/news?q=${encodeURIComponent(q)}&region=tn`);
      const d = await r.json();
      const list: NewsItem[] = d.items || [];
      setItems(list);
      setStatus(list.length ? 'ready' : 'empty');
    } catch { setStatus('error'); }
  }, [asset, name]);

  useEffect(() => { load(); }, [load]);

  const scored = items.map((i) => ({ ...i, tone: score(i.title) }));
  const bulls = scored.filter((i) => i.tone === 'bullish').length;
  const bears = scored.filter((i) => i.tone === 'bearish').length;
  const total = scored.length || 1;
  const bullPct = Math.round((bulls / total) * 100);
  const bearPct = Math.round((bears / total) * 100);
  const overall: Tone = bulls > bears ? 'bullish' : bears > bulls ? 'bearish' : 'neutral';
  const OverallIcon = overall === 'bullish' ? TrendingUp : overall === 'bearish' ? TrendingDown : Minus;

  return (
    <div className="flex flex-col h-full bg-[#0A0E17] text-white overflow-hidden">
      {/* Header */}
      <div className="flex items-center gap-2 px-4 py-3 border-b border-[#1B2236] shrink-0">
        <div className="w-7 h-7 rounded-md flex items-center justify-center" style={{ background: `${TONE[overall].color}18` }}>
          <OverallIcon className="w-4 h-4" style={{ color: TONE[overall].color }} />
        </div>
        <div className="flex-1 min-w-0">
          <div className="text-[13px] font-bold leading-tight">Social Intelligence</div>
          <div className="text-[10px] text-[#5A6478]">News sentiment · {name || asset}</div>
        </div>
        <button onClick={load} className="p-1.5 rounded-md hover:bg-[#1B2236] text-[#5A6478]" aria-label="Refresh">
          <RefreshCw className={`w-3.5 h-3.5 ${status === 'loading' ? 'animate-spin' : ''}`} />
        </button>
      </div>

      {/* Gauge */}
      {status === 'ready' && (
        <div className="px-4 py-3 border-b border-[#1B2236] shrink-0">
          <div className="flex items-baseline justify-between mb-2">
            <span className="text-[15px] font-bold" style={{ color: TONE[overall].color }}>{TONE[overall].label}</span>
            <span className="text-[10px] text-[#5A6478]">{scored.length} headlines · 7d</span>
          </div>
          <div className="flex h-1.5 rounded-full overflow-hidden bg-[#1B2236]">
            <div style={{ width: `${bullPct}%`, background: '#00C853' }} />
            <div style={{ width: `${100 - bullPct - bearPct}%`, background: '#5A6478' }} />
            <div style={{ width: `${bearPct}%`, background: '#FF3D3D' }} />
          </div>
          <div className="flex justify-between mt-1.5 text-[10px]">
            <span className="text-[#00C853]">{bullPct}% bull</span>
            <span className="text-[#FF3D3D]">{bearPct}% bear</span>
          </div>
        </div>
      )}

      {/* Feed */}
      <div className="flex-1 overflow-y-auto">
        {status === 'loading' && (
          <div className="flex items-center justify-center h-full text-[#5A6478]"><Loader2 className="w-5 h-5 animate-spin" /></div>
        )}
        {status === 'empty' && (
          <div className="flex flex-col items-center justify-center h-full text-center px-6 gap-1">
            <span className="text-[13px] font-semibold text-[#8A92A6]">No recent coverage</span>
            <span className="text-[11px] text-[#5A6478]">No Tunisian press picked up {name || asset} lately.</span>
          </div>
        )}
        {status === 'error' && (
          <div className="flex items-center justify-center h-full text-center px-6 text-[11px] text-[#5A6478]">Couldn't load news.</div>
        )}
        {status === 'ready' && scored.map((item, i) => (
          <a key={i} href={item.url} target="_blank" rel="noopener noreferrer"
            className="block px-4 py-3 border-b border-[#151B29] hover:bg-[#0F1420] transition-colors group">
            <div className="flex items-start gap-2">
              <span className="mt-0.5 text-[10px] font-bold shrink-0" style={{ color: TONE[item.tone].color }}>
                {item.tone === 'bullish' ? '▲' : item.tone === 'bearish' ? '▼' : '—'}
              </span>
              <div className="min-w-0">
                <div className="text-[12px] leading-snug text-[#D4DAE6] group-hover:text-white line-clamp-3">{item.title}</div>
                <div className="flex items-center gap-1.5 mt-1 text-[10px] text-[#5A6478]">
                  <span className="truncate">{item.source}</span>
                  {item.time && <span>· {timeAgo(item.time)}</span>}
                  <ExternalLink className="w-2.5 h-2.5 opacity-0 group-hover:opacity-100 transition-opacity" />
                </div>
              </div>
            </div>
          </a>
        ))}
      </div>
    </div>
  );
};
