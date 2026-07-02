import React, { useEffect, useRef, useState } from 'react';
import { createChart, CandlestickSeries, HistogramSeries, LineStyle } from 'lightweight-charts';
import type { IChartApi, ISeriesApi, IPriceLine, Time } from 'lightweight-charts';
import { Loader2 } from 'lucide-react';

interface TnChartProps {
  asset: string;
  name?: string;
}

interface Candle { time: number; open: number; high: number; low: number; close: number; volume: number }
interface Intraday {
  prevClose: number;
  last: number;
  changePct: number;
  seance: string | null;
  candles: Candle[];
}

const INTERVALS = [1, 5, 15] as const;
const UP = '#00E676';
const DOWN = '#FF1744';

export const TnChart: React.FC<TnChartProps> = ({ asset, name }) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const candleRef = useRef<ISeriesApi<'Candlestick'> | null>(null);
  const volRef = useRef<ISeriesApi<'Histogram'> | null>(null);
  const priceLineRef = useRef<IPriceLine | null>(null);
  const [interval, setInterval_] = useState<number>(5);
  const [status, setStatus] = useState<'loading' | 'ready' | 'empty' | 'error'>('loading');
  const [meta, setMeta] = useState<Intraday | null>(null);

  // Create chart + series once.
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
    candleRef.current = chart.addSeries(CandlestickSeries, {
      upColor: UP, downColor: DOWN, borderVisible: false, wickUpColor: UP, wickDownColor: DOWN,
    });
    volRef.current = chart.addSeries(HistogramSeries, {
      priceFormat: { type: 'volume' }, priceScaleId: '',
    });
    volRef.current.priceScale().applyOptions({ scaleMargins: { top: 0.82, bottom: 0 } });
    return () => { chart.remove(); chartRef.current = null; candleRef.current = null; volRef.current = null; };
  }, []);

  // Load + poll for the current asset / interval.
  useEffect(() => {
    let live = true;
    setStatus('loading');
    const load = async () => {
      try {
        const r = await fetch(`/api/tn/intraday?symbol=${encodeURIComponent(asset)}&interval=${interval}`);
        const d: Intraday = await r.json();
        if (!live || !candleRef.current || !volRef.current) return;
        if (!d.candles?.length) { candleRef.current.setData([]); volRef.current.setData([]); setStatus('empty'); setMeta(d); return; }
        candleRef.current.setData(d.candles.map((c) => ({
          time: c.time as Time, open: c.open, high: c.high, low: c.low, close: c.close,
        })));
        volRef.current.setData(d.candles.map((c) => ({
          time: c.time as Time, value: c.volume, color: c.close >= c.open ? `${UP}55` : `${DOWN}55`,
        })));
        if (priceLineRef.current) candleRef.current.removePriceLine(priceLineRef.current);
        priceLineRef.current = candleRef.current.createPriceLine({
          price: d.prevClose, color: '#5A6478', lineWidth: 1,
          lineStyle: LineStyle.Dashed, axisLabelVisible: true, title: 'prev',
        });
        chartRef.current?.timeScale().fitContent();
        setMeta(d); setStatus('ready');
      } catch {
        if (live) setStatus('error');
      }
    };
    load();
    const iv = window.setInterval(load, 60_000);
    return () => { live = false; window.clearInterval(iv); };
  }, [asset, interval]);

  return (
    <div className="relative w-full h-full bg-[#0A0E17]">
      <div className="absolute top-3 left-4 z-10 flex items-baseline gap-2 font-mono pointer-events-none">
        {meta && status === 'ready' && (
          <>
            <span className="text-body font-semibold text-[color:var(--text)]">{name || asset}</span>
            <span className="text-label text-[color:var(--text-3)]">{interval}m · BVMT intraday{meta.seance ? ` · ${meta.seance}` : ''}</span>
          </>
        )}
      </div>

      {/* Interval selector */}
      <div className="absolute top-3 right-4 z-20 flex gap-1 p-0.5 rounded-md bg-[#0F1420] border border-[#1B2236]">
        {INTERVALS.map((n) => (
          <button
            key={n}
            onClick={() => setInterval_(n)}
            className={`px-2 py-0.5 rounded text-[11px] font-medium transition-colors ${
              interval === n ? 'bg-[#1B2236] text-white' : 'text-[#5A6478] hover:text-white'
            }`}
          >
            {n}m
          </button>
        ))}
      </div>

      <div ref={containerRef} className="w-full h-full" />

      {status !== 'ready' && (
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 text-center px-6 pointer-events-none">
          {status === 'loading' && <Loader2 className="w-5 h-5 animate-spin text-[color:var(--text-3)]" />}
          {status === 'empty' && (
            <>
              <span className="text-body font-semibold text-[color:var(--text-2)]">No trades this session</span>
              <span className="text-label text-[color:var(--text-3)] max-w-xs">BVMT hasn't printed a tick for {name || asset} yet today — candles fill in as trades clear.</span>
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
