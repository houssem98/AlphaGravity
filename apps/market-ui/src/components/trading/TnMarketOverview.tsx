import React, { useEffect, useState } from 'react';
import { TrendingUp, TrendingDown } from 'lucide-react';

interface Idx { name: string; level: number; changePct: number; yearPct: number | null }
interface Stats { marketCap: number | null; advancers: number | null; decliners: number | null; turnover: number | null; trades: number | null; active: number | null; listed: number | null }

const fmtLevel = (n: number) => n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const fmtCap = (n: number) => n >= 1e9 ? `${(n / 1e9).toFixed(2)}B` : n >= 1e6 ? `${(n / 1e6).toFixed(1)}M` : String(Math.round(n));
const shortName = (n: string) => {
  const s = n.replace(/^INDICE\s+(DE\s+|DES\s+|DE\s+LA\s+|D['’])?/i, '').trim();
  return s.charAt(0) + s.slice(1).toLowerCase();
};
const pctColor = (p: number) => (p > 0 ? '#00C853' : p < 0 ? '#FF3D3D' : '#8A92A6');
const pct = (p: number) => `${p >= 0 ? '+' : ''}${p.toFixed(2)}%`;

export const TnMarketOverview: React.FC = () => {
  const [indices, setIndices] = useState<Idx[]>([]);
  const [stats, setStats] = useState<Stats | null>(null);

  useEffect(() => {
    let live = true;
    const load = () => fetch('/api/tn/index').then((r) => r.json()).then((j) => {
      if (!live) return;
      setIndices(j.indices || []);
      setStats(j.stats || null);
    }).catch(() => {});
    load();
    const iv = setInterval(load, 120_000);
    return () => { live = false; clearInterval(iv); };
  }, []);

  const tunindex = indices.find((i) => i.name === 'TUNINDEX');
  const tunindex20 = indices.find((i) => i.name === 'TUNINDEX20');
  const sectors = indices.filter((i) => i.name !== 'TUNINDEX' && i.name !== 'TUNINDEX20');
  if (!tunindex) return null;

  return (
    <div className="mb-4 bg-[color:var(--surface)] border border-[color:var(--line)] rounded-[4px] overflow-hidden">
      {/* Headline row: TUNINDEX + TUNINDEX20 + breadth */}
      <div className="flex flex-wrap items-center gap-x-6 gap-y-2 px-4 py-3 border-b border-[color:var(--line)]">
        {[tunindex, tunindex20].filter(Boolean).map((idx) => (
          <div key={idx!.name} className="flex items-baseline gap-2">
            <span className="label text-[color:var(--text-3)]">{idx!.name}</span>
            <span className="text-h4 font-display font-semibold text-[color:var(--text)] font-mono">{fmtLevel(idx!.level)}</span>
            <span className="text-body font-mono font-semibold" style={{ color: pctColor(idx!.changePct) }}>
              {idx!.changePct >= 0 ? <TrendingUp className="inline w-3 h-3 mr-0.5" /> : <TrendingDown className="inline w-3 h-3 mr-0.5" />}
              {pct(idx!.changePct)}
            </span>
            {idx!.yearPct != null && <span className="text-label text-[color:var(--text-3)]">1Y {pct(idx!.yearPct)}</span>}
          </div>
        ))}
        {stats && (
          <div className="ml-auto flex items-center gap-4 text-label font-mono text-[color:var(--text-3)]">
            {stats.advancers != null && (
              <span><span className="up">▲{stats.advancers}</span> / <span className="down">▼{stats.decliners}</span></span>
            )}
            {stats.marketCap != null && <span>Cap {fmtCap(stats.marketCap)} TND</span>}
            {stats.trades != null && <span>{stats.trades.toLocaleString('en-US')} trades</span>}
          </div>
        )}
      </div>

      {/* Sector indices strip */}
      <div className="flex gap-2 px-4 py-2.5 overflow-x-auto">
        {sectors.map((s) => (
          <div key={s.name} className="shrink-0 flex flex-col px-3 py-1.5 rounded-sm bg-[color:var(--bg)] border border-[color:var(--line)] min-w-[120px]">
            <span className="text-label text-[color:var(--text-3)] truncate">{shortName(s.name)}</span>
            <div className="flex items-baseline gap-1.5">
              <span className="text-data font-mono font-semibold text-[color:var(--text)]">{fmtLevel(s.level)}</span>
              <span className="text-label font-mono font-semibold" style={{ color: pctColor(s.changePct) }}>{pct(s.changePct)}</span>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
};
