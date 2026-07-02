import React, { useEffect, useRef, useState } from 'react';
import { createChart, AreaSeries, LineStyle } from 'lightweight-charts';
import type { IChartApi, ISeriesApi, IPriceLine, Time } from 'lightweight-charts';
import { Loader2 } from 'lucide-react';

interface TnChartProps {
  asset: string;
  name?: string;
}

interface Intraday {
  prevClose: number;
  last: number;
  changePct: number;
  seance: string | null;
  points: { time: number; value: number; volume: number }[];
}

export const TnChart: React.FC<TnChartProps> = ({ asset, name }) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const seriesRef = useRef<ISeriesApi<'Area'> | null>(null);
  const priceLineRef = useRef<IPriceLine | null>(null);
  const [status, setStatus] = useState<'loading' | 'ready' | 'empty' | 'error'>('loading');
  const [meta, setMeta] = useState<Intraday | null>(null);

  // Create the chart once.
  useEffect(() => {
    if (!containerRef.current) return;
    const chart = createChart(containerRef.current, {
      autoSize: true,
      layout: { background: { color: '#0A0E17' }, textColor: '#A0AEC0' },
      grid: { vertLines: { color: '#1A202C' }, horzLines: { color: '#1A202C' } },
      timeScale: { borderColor: '#1A202C', timeVisible: true, secondsVisible: false },
      rightPriceScale: { borderColor: '#1A202C' },
      crosshair: { mode: 0 },
    });
    chartRef.current = chart;
    return () => { chart.remove(); chartRef.current = null; seriesRef.current = null; };
  }, []);

  // Load + poll intraday for the current asset.
  useEffect(() => {
    let live = true;
    setStatus('loading');
    const load = async () => {
      try {
        const r = await fetch(`/api/tn/intraday?symbol=${encodeURIComponent(asset)}`);
        const d: Intraday = await r.json();
        if (!live || !chartRef.current) return;
        if (!d.points?.length) { seriesRef.current?.setData([]); setStatus('empty'); setMeta(d); return; }
        const up = d.last >= d.prevClose;
        const color = up ? '#00E676' : '#FF1744';
        if (!seriesRef.current) {
          seriesRef.current = chartRef.current.addSeries(AreaSeries, {
            lineColor: color, topColor: `${color}44`, bottomColor: `${color}05`, lineWidth: 2,
          });
        } else {
          seriesRef.current.applyOptions({ lineColor: color, topColor: `${color}44`, bottomColor: `${color}05` });
        }
        seriesRef.current.setData(d.points.map((p) => ({ time: p.time as Time, value: p.value })));
        if (priceLineRef.current) seriesRef.current.removePriceLine(priceLineRef.current);
        priceLineRef.current = seriesRef.current.createPriceLine({
          price: d.prevClose, color: '#5A6478', lineWidth: 1,
          lineStyle: LineStyle.Dashed, axisLabelVisible: true, title: 'prev',
        });
        chartRef.current.timeScale().fitContent();
        setMeta(d); setStatus('ready');
      } catch {
        if (live) setStatus('error');
      }
    };
    load();
    const iv = setInterval(load, 60_000);
    return () => { live = false; clearInterval(iv); };
  }, [asset]);

  return (
    <div className="relative w-full h-full bg-[#0A0E17]">
      {meta && status === 'ready' && (
        <div className="absolute top-3 left-4 z-10 pointer-events-none flex items-baseline gap-2 font-mono">
          <span className="text-body font-semibold text-[color:var(--text)]">{name || asset}</span>
          <span className="text-label text-[color:var(--text-3)]">intraday · BVMT{meta.seance ? ` · ${meta.seance}` : ''}</span>
        </div>
      )}
      <div ref={containerRef} className="w-full h-full" />
      {status !== 'ready' && (
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 text-center px-6 pointer-events-none">
          {status === 'loading' && <Loader2 className="w-5 h-5 animate-spin text-[color:var(--text-3)]" />}
          {status === 'empty' && (
            <>
              <span className="text-body font-semibold text-[color:var(--text-2)]">No trades this session</span>
              <span className="text-label text-[color:var(--text-3)] max-w-xs">BVMT hasn't printed a tick for {name || asset} yet today — the intraday line fills in as trades clear.</span>
            </>
          )}
          {status === 'error' && (
            <span className="text-label text-[color:var(--text-3)]">Couldn't reach the BVMT feed. Retrying…</span>
          )}
        </div>
      )}
    </div>
  );
};
