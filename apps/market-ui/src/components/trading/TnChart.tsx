import React, { useEffect, useRef, useState } from 'react';
import { createChart, CandlestickSeries, HistogramSeries, LineSeries, LineStyle } from 'lightweight-charts';
import type { IChartApi, ISeriesApi, IPriceLine, Time } from 'lightweight-charts';
import { Bell, BellRing } from 'lucide-react';
import { calculateSMA, calculateRSI } from '../../utils/indicators';

// Compact market-cap axis labels (TND billions/millions).
const fmtCap = (v: number) => (v >= 1e9 ? `${(v / 1e9).toFixed(2)}B` : v >= 1e6 ? `${(v / 1e6).toFixed(1)}M` : v.toFixed(0));

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
const TFS = ['D', 'W', 'M'] as const;
type Tf = (typeof TFS)[number];
const UP = '#00E676';
const DOWN = '#FF1744';

// D→W (ISO week, grouped by Monday) / D→M (calendar month). Bar time = first daily bar's.
const aggDaily = (cs: Candle[], tf: Tf): Candle[] => {
  if (tf === 'D') return cs;
  const out: Candle[] = [];
  let curKey = '';
  for (const c of cs) {
    const d = new Date(c.time * 1000);
    const k = tf === 'M'
      ? `${d.getUTCFullYear()}-${d.getUTCMonth()}`
      : String(Math.floor((c.time - ((d.getUTCDay() + 6) % 7) * 86400) / 86400));
    if (k !== curKey) { curKey = k; out.push({ ...c }); }
    else {
      const b = out[out.length - 1];
      b.high = Math.max(b.high, c.high); b.low = Math.min(b.low, c.low);
      b.close = c.close; b.volume += c.volume;
    }
  }
  return out;
};

export const TnChart: React.FC<TnChartProps> = ({ asset, name }) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const candleRef = useRef<ISeriesApi<'Candlestick'> | null>(null);
  const volRef = useRef<ISeriesApi<'Histogram'> | null>(null);
  const priceLineRef = useRef<IPriceLine | null>(null);
  // TNV-5: SMA overlays + RSI sub-scale + PRICE/MCAP toggle (crypto CP-4/CP-5 parity).
  const sma20Ref = useRef<ISeriesApi<'Line'> | null>(null);
  const sma50Ref = useRef<ISeriesApi<'Line'> | null>(null);
  const rsiRef = useRef<ISeriesApi<'Line'> | null>(null);
  const [showMA, setShowMA] = useState(true);
  const [showRSI, setShowRSI] = useState(false);
  const [priceMode, setPriceMode] = useState<'price' | 'mcap'>('price');
  const [shares, setShares] = useState<number | null>(null);
  useEffect(() => {
    setPriceMode('price');
    fetch('/api/tn/ref').then((r) => r.json()).then((d) => {
      const s = d?.ref?.[asset]?.shares;
      setShares(typeof s === 'number' && s > 0 ? s : null);
    }).catch(() => setShares(null));
  }, [asset]);
  const [interval, setInterval_] = useState<number>(5);
  const [mode, setMode] = useState<'intraday' | 'daily'>('intraday');
  const [tf, setTf] = useState<Tf>('D');
  // C2: once the user picks a mode, auto-switching (illiquid names → daily) is disabled.
  const userPickedMode = useRef(false);
  useEffect(() => { if (!userPickedMode.current) setMode('intraday'); }, [asset]);
  const [status, setStatus] = useState<'loading' | 'ready' | 'empty' | 'error'>('loading');
  const [meta, setMeta] = useState<Intraday | null>(null);
  const [hover, setHover] = useState<{ o: number; h: number; l: number; c: number; v: number } | null>(null);
  // TND prices: 2 decimals, 3 only for sub-dinar names.
  const fmtP = (v: number) => v.toFixed(v < 1 ? 3 : 2);

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
    // TNV-5: SMA overlays (price pane) + RSI on the left scale (crypto parity).
    sma20Ref.current = chart.addSeries(LineSeries, { color: '#2962FF', lineWidth: 1, crosshairMarkerVisible: false, lastValueVisible: false, priceLineVisible: false });
    sma50Ref.current = chart.addSeries(LineSeries, { color: '#FF6D00', lineWidth: 1, crosshairMarkerVisible: false, lastValueVisible: false, priceLineVisible: false });
    rsiRef.current = chart.addSeries(LineSeries, { color: '#E040FB', lineWidth: 1, priceScaleId: 'left', crosshairMarkerVisible: false, lastValueVisible: false, priceLineVisible: false });
    chart.priceScale('left').applyOptions({ visible: false, scaleMargins: { top: 0.7, bottom: 0 } });
    chart.subscribeCrosshairMove((param) => {
      const cd: any = candleRef.current && param.seriesData.get(candleRef.current);
      if (cd && cd.open !== undefined) {
        const vd: any = volRef.current && param.seriesData.get(volRef.current);
        setHover({ o: cd.open, h: cd.high, l: cd.low, c: cd.close, v: vd?.value ?? 0 });
      } else setHover(null);
    });
    return () => { chart.remove(); chartRef.current = null; candleRef.current = null; volRef.current = null; sma20Ref.current = null; sma50Ref.current = null; rsiRef.current = null; };
  }, []);

  // TNV-5: toggle indicator visibility without reloading data.
  useEffect(() => {
    sma20Ref.current?.applyOptions({ visible: showMA });
    sma50Ref.current?.applyOptions({ visible: showMA });
    rsiRef.current?.applyOptions({ visible: showRSI });
    chartRef.current?.priceScale('left').applyOptions({ visible: showRSI });
  }, [showMA, showRSI]);

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
        const cs = mode === 'daily' ? aggDaily(d.candles, tf) : d.candles;
        const p0 = d.last || cs[0].close;
        // TNV-5: PRICE/MCAP — mcap = close × shares (linear), only when shares known.
        const mult = priceMode === 'mcap' && shares ? shares : 1;
        candleRef.current.applyOptions(
          mult === 1
            ? { priceFormat: { type: 'price', precision: p0 < 1 ? 3 : 2, minMove: p0 < 1 ? 0.001 : 0.01 } }
            : { priceFormat: { type: 'custom', formatter: fmtCap, minMove: 1 } },
        );
        type Bar = { time: Time; open: number; high: number; low: number; close: number } | { time: Time };
        const bars: Bar[] = cs.map((c) => ({
          time: c.time as Time, open: c.open * mult, high: c.high * mult, low: c.low * mult, close: c.close * mult,
        }));
        // Frame the whole session with whitespace so a lone candle doesn't fill the width.
        if (mode === 'intraday' && d.sessionStart && d.sessionEnd) {
          const step = interval * 60;
          const seen = new Set(cs.map((c) => c.time));
          for (let t = Math.floor(d.sessionStart / step) * step; t <= d.sessionEnd; t += step)
            if (!seen.has(t)) bars.push({ time: t as Time });
          bars.sort((a, b) => (a.time as number) - (b.time as number));
        }
        candleRef.current.setData(bars);
        volRef.current.setData(cs.map((c) => ({
          time: c.time as Time, value: c.volume, color: c.close >= c.open ? `${UP}55` : `${DOWN}55`,
        })));
        // TNV-5: SMA 20/50 on the (mcap-scaled) close; RSI on raw close (unitless).
        const closesScaled = cs.map((c) => ({ time: c.time as Time, close: c.close * mult }));
        sma20Ref.current?.setData(cs.length >= 20 ? calculateSMA(closesScaled, 20) : []);
        sma50Ref.current?.setData(cs.length >= 50 ? calculateSMA(closesScaled, 50) : []);
        rsiRef.current?.setData(cs.length > 15 ? calculateRSI(cs.map((c) => ({ time: c.time as Time, close: c.close })), 14) : []);
        if (priceLineRef.current) { candleRef.current.removePriceLine(priceLineRef.current); priceLineRef.current = null; }
        if (mode === 'intraday' && d.prevClose) {
          priceLineRef.current = candleRef.current.createPriceLine({
            price: d.prevClose * mult, color: '#5A6478', lineWidth: 1,
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
  }, [asset, interval, mode, tf, priceMode, shares]);

  return (
    <div className="relative w-full h-full bg-[#0A0E17]">
      <div className="absolute top-3 left-4 z-10 font-mono pointer-events-none">
        {meta && status === 'ready' && (
          <>
            <div className="flex items-baseline gap-2">
              <span className="text-body font-semibold text-[color:var(--text)]">{name || asset}</span>
              <span className="text-label text-[color:var(--text-3)]">
                {mode === 'daily'
                  ? `${tf === 'D' ? 'Daily' : tf === 'W' ? 'Weekly' : 'Monthly'} · BVMT`
                  : `${interval}m · BVMT intraday${meta.seance ? ` · ${meta.seance}` : ''}`}
              </span>
            </div>
            {hover && (
              <div className={`mt-0.5 text-[11px] tracking-tight ${hover.c >= hover.o ? 'text-[#00E676]' : 'text-[#FF1744]'}`}>
                O {fmtP(hover.o)}  H {fmtP(hover.h)}  L {fmtP(hover.l)}  C {fmtP(hover.c)}
                <span className="text-[#8A92A6]">  V {hover.v.toLocaleString('en-US')}</span>
              </div>
            )}
          </>
        )}
      </div>

      {/* Timeframe selector: 1m 5m 15m · D W M */}
      <div className="absolute top-3 right-4 z-20 flex items-center gap-2">
        <div className="flex items-center gap-1 p-0.5 rounded-md bg-[#0F1420] border border-[#1B2236]">
          {INTERVALS.map((n) => (
            <button key={n} onClick={() => { userPickedMode.current = true; setMode('intraday'); setInterval_(n); }}
              className={`px-2 py-0.5 rounded text-[11px] font-medium transition-colors ${
                mode === 'intraday' && interval === n ? 'bg-[#1B2236] text-white' : 'text-[#5A6478] hover:text-white'
              }`}>
              {n}m
            </button>
          ))}
          <div className="w-px h-3.5 bg-[#1B2236]" />
          {TFS.map((t) => (
            <button key={t} onClick={() => { userPickedMode.current = true; setMode('daily'); setTf(t); }}
              className={`px-2 py-0.5 rounded text-[11px] font-medium transition-colors ${
                mode === 'daily' && tf === t ? 'bg-[#1B2236] text-white' : 'text-[#5A6478] hover:text-white'
              }`}>
              {t}
            </button>
          ))}
        </div>

        {/* TNV-5: indicator + price/mcap toggles */}
        <div className="flex items-center gap-1 p-0.5 rounded-md bg-[#0F1420] border border-[#1B2236]">
          <button onClick={() => setShowMA((v) => !v)} title="SMA 20 / SMA 50"
            className={`px-2 py-0.5 rounded text-[11px] font-medium transition-colors ${showMA ? 'bg-[#1B2236] text-white' : 'text-[#5A6478] hover:text-white'}`}>
            MA
          </button>
          <button onClick={() => setShowRSI((v) => !v)} title="Relative Strength Index (14)"
            className={`px-2 py-0.5 rounded text-[11px] font-medium transition-colors ${showRSI ? 'bg-[#1B2236] text-white' : 'text-[#5A6478] hover:text-white'}`}>
            RSI
          </button>
          {shares && (
            <>
              <div className="w-px h-3.5 bg-[#1B2236]" />
              <button onClick={() => setPriceMode((m) => (m === 'price' ? 'mcap' : 'price'))} title="Toggle price / market cap (close × shares)"
                className="px-2 py-0.5 rounded text-[11px] font-medium text-[#5A6478] hover:text-white transition-colors">
                {priceMode === 'price' ? 'PRICE' : 'MCAP'}
              </button>
            </>
          )}
        </div>

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
          {status === 'loading' && (
            <div className="w-full max-w-md space-y-3 animate-pulse motion-reduce:animate-none">
              <div className="h-4 w-1/3 rounded bg-[#151B29]" />
              <div className="h-40 rounded bg-[#101522]" />
              <div className="h-3 w-2/3 rounded bg-[#151B29]" />
            </div>
          )}
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
