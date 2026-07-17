import React, { useEffect, useRef, useState } from 'react';
import { createChart, AreaSeries } from 'lightweight-charts';
import type { Time } from 'lightweight-charts';
import { TrendingUp, TrendingDown } from 'lucide-react';

// TNH-4: TUNINDEX macro chart — deep daily closes from fn=indexhistory
// (tn_index_history.json blob, official exchange NDJSON; floor 2024-12-31).
// Honest floor label; no invented points.
const TunindexMacro: React.FC = () => {
  const ref = useRef<HTMLDivElement>(null);
  const [floor, setFloor] = useState<string | null>(null);
  useEffect(() => {
    if (!ref.current) return;
    const chart = createChart(ref.current, {
      autoSize: true,
      layout: { background: { color: 'transparent' }, textColor: '#5A6478', fontSize: 10, attributionLogo: false },
      grid: { vertLines: { visible: false }, horzLines: { color: '#1A202C' } },
      timeScale: { borderColor: '#1A202C', timeVisible: false },
      rightPriceScale: { borderColor: '#1A202C' },
      crosshair: { mode: 0 },
      handleScroll: false,
      handleScale: false,
    });
    const series = chart.addSeries(AreaSeries, {
      lineColor: '#00E676', lineWidth: 2,
      topColor: 'rgba(0,230,118,0.18)', bottomColor: 'rgba(0,230,118,0)',
      priceLineVisible: false, lastValueVisible: true,
      priceFormat: { type: 'price', precision: 0, minMove: 1 },
    });
    let live = true;
    fetch('/api/tn/indexhistory?index=TN0009050014').then((r) => r.json()).then((j) => {
      if (!live || !j?.series?.length) return;
      series.setData(j.series.map((p: { time: number; value: number }) => ({ time: p.time as Time, value: p.value })));
      chart.timeScale().fitContent();
      setFloor(new Date(j.series[0].time * 1000).toISOString().slice(0, 10));
    }).catch(() => {});
    return () => { live = false; chart.remove(); };
  }, []);
  return (
    <div className="px-4 py-3 border-t border-[color:var(--line)]">
      <div className="flex items-center gap-2 mb-1.5">
        <span className="label text-[color:var(--text-3)]">TUNINDEX</span>
        {floor && <span className="text-label text-[color:var(--text-3)]">since {floor} — official data floor</span>}
      </div>
      <div ref={ref} className="w-full h-[150px]" />
    </div>
  );
};

interface Idx { name: string; level: number; changePct: number; yearPct: number | null }
interface Stats { marketCap: number | null; advancers: number | null; decliners: number | null; turnover: number | null; trades: number | null; active: number | null; listed: number | null }
interface Mover { symbol: string; changePct: number; price: number }
interface Brief {
  date: string;
  tunindex: { level: number | null; changePct: number | null };
  breadth: { advancers: number; decliners: number; unchanged: number; traded: number };
  topGainers: Mover[];
  topLosers: Mover[];
  text: string;
}

const fmtLevel = (n: number) => n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const fmtCap = (n: number) => n >= 1e9 ? `${(n / 1e9).toFixed(2)}B` : n >= 1e6 ? `${(n / 1e6).toFixed(1)}M` : String(Math.round(n));
const shortName = (n: string) => {
  const s = n.replace(/^INDICE\s+(DE\s+|DES\s+|DE\s+LA\s+|D['’])?/i, '').trim();
  return s.charAt(0) + s.slice(1).toLowerCase();
};
const pctColor = (p: number) => (p > 0 ? 'var(--up)' : p < 0 ? 'var(--down)' : 'var(--flat)');
const pct = (p: number) => `${p >= 0 ? '+' : ''}${p.toFixed(2)}%`;

export const TnMarketOverview: React.FC = () => {
  const [indices, setIndices] = useState<Idx[]>([]);
  const [stats, setStats] = useState<Stats | null>(null);
  const [brief, setBrief] = useState<Brief | null>(null);

  useEffect(() => {
    let live = true;
    const load = () => fetch('/api/tn/index').then((r) => r.json()).then((j) => {
      if (!live) return;
      setIndices(j.indices || []);
      setStats(j.stats || null);
    }).catch(() => {});
    load();
    const iv = setInterval(load, 120_000);
    fetch('/api/tn/brief').then((r) => r.json()).then((j) => { if (live) setBrief(j.brief || null); }).catch(() => {});
    return () => { live = false; clearInterval(iv); };
  }, []);

  const tunindex = indices.find((i) => i.name === 'TUNINDEX');
  const tunindex20 = indices.find((i) => i.name === 'TUNINDEX20');
  const sectors = indices.filter((i) => i.name !== 'TUNINDEX' && i.name !== 'TUNINDEX20');
  if (!tunindex) return null;

  return (
    <div className="mb-4 bg-[color:var(--surface)] border border-[color:var(--line)] rounded-[6px] overflow-hidden lux-border sheen-once">
      {/* Headline row: TUNINDEX + TUNINDEX20 + breadth */}
      <div className="flex flex-wrap items-center gap-x-7 gap-y-2 px-4 py-3.5 border-b border-[color:var(--line)] chrome">
        {[tunindex, tunindex20].map((idx, i) => idx && (
          <div key={idx.name} className="flex items-baseline gap-2.5">
            <span className="flex items-center gap-1.5 label text-[color:var(--text-3)]">
              {i === 0 && <span className="pulse-dot w-1.5 h-1.5 rounded-full bg-[color:var(--up)] text-[color:var(--up)]" />}
              {idx.name}
            </span>
            <span className={`font-display font-semibold text-[color:var(--text)] font-mono tracking-tight ${i === 0 ? 'text-h1' : 'text-h4'}`}>
              {fmtLevel(idx.level)}
            </span>
            <span className="text-body font-mono font-semibold" style={{ color: pctColor(idx.changePct) }}>
              {idx.changePct >= 0 ? <TrendingUp className="inline w-3 h-3 mr-0.5" /> : <TrendingDown className="inline w-3 h-3 mr-0.5" />}
              {pct(idx.changePct)}
            </span>
            {idx.yearPct != null && <span className="text-label text-[color:var(--text-3)]">1Y {pct(idx.yearPct)}</span>}
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

      {/* Sector indices ticker — auto-scrolls (tape-roll, pauses on hover).
          Content is duplicated so the -50% translate loops seamlessly. */}
      <div className="px-4 py-2.5 overflow-hidden">
        <div className="tape-roll flex w-max">
          {[0, 1].map((copy) => (
            <div key={copy} aria-hidden={copy === 1} className="flex gap-2 pr-2">
              {sectors.map((s) => (
                <div key={s.name} className="shrink-0 flex flex-col px-3 py-1.5 rounded-sm bg-[color:var(--bg)] border border-[color:var(--line)] hover:border-[color:var(--line-strong)] transition-colors min-w-[120px]">
                  <span className="text-label text-[color:var(--text-3)] truncate">{shortName(s.name)}</span>
                  <div className="flex items-baseline gap-1.5">
                    <span className="text-data font-mono font-semibold text-[color:var(--text)]">{fmtLevel(s.level)}</span>
                    <span className="text-label font-mono font-semibold" style={{ color: pctColor(s.changePct) }}>{pct(s.changePct)}</span>
                  </div>
                </div>
              ))}
            </div>
          ))}
        </div>
      </div>

      {/* TNH-4: TUNINDEX macro chart (deep history, honest floor) */}
      <TunindexMacro />

      {/* Daily Brief — written nightly by the Hermes agent (H4.1), grounded
          in the same endpoints this page reads. */}
      {brief && (
        <div className="px-4 py-3 border-t border-[color:var(--line)]">
          <div className="flex items-center gap-2 mb-1.5">
            <span className="label text-[color:var(--text-3)]">Daily Brief</span>
            <span className="text-label text-[color:var(--text-3)]">{brief.date}</span>
          </div>
          <p className="text-body text-[color:var(--text-2)] leading-snug mb-2">{brief.text}</p>
          <div className="flex flex-wrap gap-x-4 gap-y-1 text-label font-mono text-[color:var(--text-3)]">
            {brief.topGainers[0] && (
              <span>Top gainer <span className="up">{brief.topGainers[0].symbol} {pct(brief.topGainers[0].changePct)}</span></span>
            )}
            {brief.topLosers[0] && (
              <span>Top loser <span className="down">{brief.topLosers[0].symbol} {pct(brief.topLosers[0].changePct)}</span></span>
            )}
            <span>{brief.breadth.advancers}▲ / {brief.breadth.decliners}▼ of {brief.breadth.traded} traded</span>
          </div>
        </div>
      )}
    </div>
  );
};
