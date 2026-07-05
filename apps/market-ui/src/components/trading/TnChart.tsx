import React, { useEffect, useRef, useState } from 'react';
import { createChart, CandlestickSeries, HistogramSeries, LineStyle } from 'lightweight-charts';
import type { IChartApi, ISeriesApi, IPriceLine, Time } from 'lightweight-charts';
import { Loader2, Bell, BellRing } from 'lucide-react';

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
  sessionStart?: number | null;
  sessionEnd?: number | null;
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
  const [mode, setMode] = useState<'intraday' | 'daily'>('intraday');
  // C2: once the user picks a mode, auto-switching (illiquid names → daily) is disabled.
  const userPickedMode = useRef(false);
  useEffect(() => { if (!userPickedMode.current) setMode('intraday'); }, [asset]);
  const [status, setStatus] = useState<'loading' | 'ready' | 'empty' | 'error'>('loading');
  const [meta, setMeta] = useState<Intraday | null>(null);

  // Price alert (localStorage per asset). Fires a browser notification when the
  // live price crosses the threshold while the chart is open.
  const alertKey = `tn_alert_${asset}`;
  const [alert, setAlert] = useState<{ dir: 'above' | 'below'; price: number } | null>(null);
  const [showAlertUi, setShowAlertUi] = useState(false);
  const [alertInput, setAlertInput] = useState('');
  const alertRef = useRef<{ dir: 'above' | 'below'; price: number } | null>(null);
  useEffect(() => {
    try { const a = JSON.parse(localStorage.getItem(alertKey) || 'null'); setAlert(a); alertRef.current = a; }
    catch { setAlert(null); alertRef.current = null; }
    setShowAlertUi(false);
  }, [asset]);
  const saveAlert = (a: { dir: 'above' | 'below'; price: number } | null) => {
    setAlert(a); alertRef.current = a;
    if (a) localStorage.setItem(alertKey, JSON.stringify(a)); else localStorage.removeItem(alertKey);
  };
  const armAlert = (dir: 'above' | 'below') => {
    const p = parseFloat(alertInput);
    if (!p) return;
    if (typeof Notification !== 'undefined' && Notification.permission === 'default') Notification.requestPermission();
    saveAlert({ dir, price: p }); setShowAlertUi(false); setAlertInput('');
  };
  const checkAlert = (last: number) => {
    const a = alertRef.current;
    if (!a || !last) return;
    if ((a.dir === 'above' && last >= a.price) || (a.dir === 'below' && last <= a.price)) {
      if (typeof Notification !== 'undefined' && Notification.permission === 'granted')
        new Notification(`${name || asset} ${a.dir} ${a.price}`, { body: `Now ${last.toFixed(2)} TND · BVMT` });
      saveAlert(null);
    }
  };

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
      // Sparse intraday (1–2 trades) autoscales to a sliver — keep ≥0.5% of price visible.
      autoscaleInfoProvider: (orig: () => any) => {
        const r = orig();
        if (!r?.priceRange) return r;
        const { minValue, maxValue } = r.priceRange;
        const mid = (minValue + maxValue) / 2, span = mid * 0.005;
        if (maxValue - minValue >= span) return r;
        return { ...r, priceRange: { minValue: mid - span / 2, maxValue: mid + span / 2 } };
      },
    });
    volRef.current = chart.addSeries(HistogramSeries, {
      priceFormat: { type: 'volume' }, priceScaleId: '',
      lastValueVisible: false, priceLineVisible: false,
    });
    volRef.current.priceScale().applyOptions({ scaleMargins: { top: 0.82, bottom: 0 } });
    return () => { chart.remove(); chartRef.current = null; candleRef.current = null; volRef.current = null; };
  }, []);

  // Load (and, intraday only, poll) for the current asset / interval / mode.
  useEffect(() => {
    let live = true;
    setStatus('loading');
    chartRef.current?.applyOptions({ timeScale: { timeVisible: mode === 'intraday' } });
    const load = async () => {
      try {
        const u = mode === 'daily'
          ? `/api/tn/history?symbol=${encodeURIComponent(asset)}`
          : `/api/tn/intraday?symbol=${encodeURIComponent(asset)}&interval=${interval}`;
        const d: Intraday = await (await fetch(u)).json();
        if (!live || !candleRef.current || !volRef.current) return;
        if (mode === 'intraday' && !userPickedMode.current && (d.candles?.length || 0) < 3) { setMode('daily'); return; }
        if (!d.candles?.length) { candleRef.current.setData([]); volRef.current.setData([]); setStatus('empty'); setMeta(d); return; }
        type Bar = { time: Time; open: number; high: number; low: number; close: number } | { time: Time };
        const bars: Bar[] = d.candles.map((c) => ({
          time: c.time as Time, open: c.open, high: c.high, low: c.low, close: c.close,
        }));
        // Frame the whole session with whitespace so a lone candle doesn't fill the width.
        if (mode === 'intraday' && d.sessionStart && d.sessionEnd) {
          const step = interval * 60;
          const seen = new Set(d.candles.map((c) => c.time));
          for (let t = Math.floor(d.sessionStart / step) * step; t <= d.sessionEnd; t += step)
            if (!seen.has(t)) bars.push({ time: t as Time });
          bars.sort((a, b) => (a.time as number) - (b.time as number));
        }
        candleRef.current.setData(bars);
        volRef.current.setData(d.candles.map((c) => ({
          time: c.time as Time, value: c.volume, color: c.close >= c.open ? `${UP}55` : `${DOWN}55`,
        })));
        if (priceLineRef.current) { candleRef.current.removePriceLine(priceLineRef.current); priceLineRef.current = null; }
        if (mode === 'intraday' && d.prevClose) {
          priceLineRef.current = candleRef.current.createPriceLine({
            price: d.prevClose, color: '#5A6478', lineWidth: 1,
            lineStyle: LineStyle.Dashed, axisLabelVisible: true, title: 'prev',
          });
        }
        chartRef.current?.timeScale().fitContent();
        if (mode === 'intraday') checkAlert(d.last);
        setMeta(d); setStatus('ready');
      } catch {
        if (live) setStatus('error');
      }
    };
    load();
    if (mode === 'intraday') {
      const iv = window.setInterval(load, 60_000);
      return () => { live = false; window.clearInterval(iv); };
    }
    return () => { live = false; };
  }, [asset, interval, mode]);

  return (
    <div className="relative w-full h-full bg-[#0A0E17]">
      <div className="absolute top-3 left-4 z-10 flex items-baseline gap-2 font-mono pointer-events-none">
        {meta && status === 'ready' && (
          <>
            <span className="text-body font-semibold text-[color:var(--text)]">{name || asset}</span>
            <span className="text-label text-[color:var(--text-3)]">
              {mode === 'daily' ? 'Daily · BVMT' : `${interval}m · BVMT intraday${meta.seance ? ` · ${meta.seance}` : ''}`}
            </span>
          </>
        )}
      </div>

      {/* Mode + interval selectors */}
      <div className="absolute top-3 right-4 z-20 flex items-center gap-2">
        <div className="flex gap-1 p-0.5 rounded-md bg-[#0F1420] border border-[#1B2236]">
          {(['intraday', 'daily'] as const).map((m) => (
            <button key={m} onClick={() => { userPickedMode.current = true; setMode(m); }}
              className={`px-2 py-0.5 rounded text-[11px] font-medium capitalize transition-colors ${
                mode === m ? 'bg-[#1B2236] text-white' : 'text-[#5A6478] hover:text-white'
              }`}>
              {m}
            </button>
          ))}
        </div>
        {mode === 'intraday' && (
          <div className="flex gap-1 p-0.5 rounded-md bg-[#0F1420] border border-[#1B2236]">
            {INTERVALS.map((n) => (
              <button key={n} onClick={() => setInterval_(n)}
                className={`px-2 py-0.5 rounded text-[11px] font-medium transition-colors ${
                  interval === n ? 'bg-[#1B2236] text-white' : 'text-[#5A6478] hover:text-white'
                }`}>
                {n}m
              </button>
            ))}
          </div>
        )}

        {/* Price alert */}
        <div className="relative">
          <button onClick={() => { setShowAlertUi((v) => !v); setAlertInput(alert ? String(alert.price) : (meta?.last ? meta.last.toFixed(2) : '')); }}
            title={alert ? `Alert ${alert.dir} ${alert.price}` : 'Set price alert'}
            className={`p-1 rounded-md border transition-colors ${alert ? 'bg-[#1B2236] border-[#2962FF]/50 text-[#2962FF]' : 'bg-[#0F1420] border-[#1B2236] text-[#5A6478] hover:text-white'}`}>
            {alert ? <BellRing className="w-3.5 h-3.5" /> : <Bell className="w-3.5 h-3.5" />}
          </button>
          {showAlertUi && (
            <div className="absolute top-full right-0 mt-1 z-30 w-52 p-3 rounded-md bg-[#0F1420] border border-[#1B2236] shadow-xl">
              <div className="text-[11px] text-[#8A92A6] mb-2">Notify when {name || asset} is</div>
              <input type="number" step="0.01" value={alertInput} onChange={(e) => setAlertInput(e.target.value)} placeholder="price (TND)"
                className="w-full mb-2 px-2 py-1 rounded bg-[#151B29] text-[12px] text-white placeholder:text-[#5A6478] focus:outline-none border border-[#1B2236] focus:border-[#2962FF]/50" />
              <div className="flex gap-1.5">
                <button onClick={() => armAlert('above')} className="flex-1 py-1 rounded text-[11px] font-medium bg-[#00C853]/15 text-[#00C853] hover:bg-[#00C853]/25">≥ Above</button>
                <button onClick={() => armAlert('below')} className="flex-1 py-1 rounded text-[11px] font-medium bg-[#FF3D3D]/15 text-[#FF3D3D] hover:bg-[#FF3D3D]/25">≤ Below</button>
              </div>
              {alert && (
                <button onClick={() => { saveAlert(null); setShowAlertUi(false); }} className="w-full mt-1.5 py-1 rounded text-[11px] text-[#5A6478] hover:text-white">Clear alert</button>
              )}
            </div>
          )}
        </div>
      </div>

      <div ref={containerRef} className="w-full h-full" />

      {status !== 'ready' && (
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 text-center px-6 pointer-events-none">
          {status === 'loading' && <Loader2 className="w-5 h-5 animate-spin text-[color:var(--text-3)]" />}
          {status === 'empty' && mode === 'intraday' && (
            <>
              <span className="text-body font-semibold text-[color:var(--text-2)]">No trades this session</span>
              <span className="text-label text-[color:var(--text-3)] max-w-xs">BVMT hasn't printed a tick for {name || asset} yet today — candles fill in as trades clear.</span>
            </>
          )}
          {status === 'empty' && mode === 'daily' && (
            <>
              <span className="text-body font-semibold text-[color:var(--text-2)]">Building daily history</span>
              <span className="text-label text-[color:var(--text-3)] max-w-xs">Daily candles for {name || asset} accumulate one bar per session from the BVMT close — check back after the next close.</span>
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
