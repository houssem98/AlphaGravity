import React, { useEffect, useMemo, useState } from 'react';
import { X, Plus, Search, TrendingUp, TrendingDown } from 'lucide-react';

interface Row {
  symbol: string; name: string; price: number; changePct: number; volume: number;
  high: number; low: number; close: number; turnover: number; bid: number; ask: number; isin: string | null;
  engineScore?: number;
}
interface TnComparatorProps { initial?: string[]; onClose: () => void; onOpenAsset?: (s: string) => void }

const fmt = (n: number, d = 2) => n ? n.toLocaleString('en-US', { minimumFractionDigits: d, maximumFractionDigits: d }) : '—';
const fmtC = (n: number) => n >= 1e6 ? `${(n / 1e6).toFixed(2)}M` : n >= 1e3 ? `${(n / 1e3).toFixed(1)}K` : String(n || '—');

// Metric rows: higher-is-better for green highlighting where it makes sense.
const METRICS: { key: string; label: string; get: (r: Row) => number; fmt: (r: Row) => string; best?: 'hi' | 'lo' }[] = [
  { key: 'price', label: 'Price (TND)', get: (r) => r.price, fmt: (r) => fmt(r.price) },
  { key: 'chg', label: 'Change %', get: (r) => r.changePct, fmt: (r) => `${r.changePct >= 0 ? '+' : ''}${fmt(r.changePct)}%`, best: 'hi' },
  { key: 'range', label: 'Day range', get: (r) => 0, fmt: (r) => r.low && r.high ? `${fmt(r.low)}–${fmt(r.high)}` : '—' },
  { key: 'prev', label: 'Prev close', get: (r) => r.close, fmt: (r) => fmt(r.close) },
  { key: 'vol', label: 'Volume', get: (r) => r.volume, fmt: (r) => fmtC(r.volume), best: 'hi' },
  { key: 'turn', label: 'Turnover (TND)', get: (r) => r.turnover, fmt: (r) => fmtC(r.turnover), best: 'hi' },
  { key: 'spread', label: 'Spread', get: (r) => (r.ask && r.bid ? r.ask - r.bid : NaN), fmt: (r) => r.ask && r.bid ? fmt(r.ask - r.bid) : '—', best: 'lo' },
  { key: 'engine', label: 'Engine score', get: (r) => r.engineScore ?? NaN, fmt: (r) => r.engineScore != null ? String(r.engineScore) : '—', best: 'hi' },
  { key: 'isin', label: 'ISIN', get: () => 0, fmt: (r) => r.isin || '—' },
];

export const TnComparator: React.FC<TnComparatorProps> = ({ initial = [], onClose, onOpenAsset }) => {
  const [board, setBoard] = useState<Row[]>([]);
  const [picks, setPicks] = useState<string[]>(initial.slice(0, 4));
  const [q, setQ] = useState('');
  const [adding, setAdding] = useState(initial.length === 0);
  const [scores, setScores] = useState<Record<string, number>>({});

  useEffect(() => { fetch('/api/tn/markets').then((r) => r.json()).then((j) => setBoard(j.rows || [])).catch(() => {}); }, []);

  // Engine score (V2.3): fetch the 8-factor score per pick, once per symbol.
  useEffect(() => {
    for (const s of picks) {
      if (s in scores) continue;
      fetch(`/api/tn/engine?symbol=${encodeURIComponent(s)}`).then((r) => r.json())
        .then((j) => { if (typeof j.score === 'number') setScores((prev) => ({ ...prev, [s]: j.score })); })
        .catch(() => {});
    }
  }, [picks]);

  const rows = useMemo(
    () => picks.map((s) => board.find((r) => r.symbol === s)).filter(Boolean).map((r) => ({ ...r, engineScore: scores[r!.symbol] })) as Row[],
    [picks, board, scores],
  );
  const options = useMemo(
    () => board.filter((r) => !picks.includes(r.symbol) && (r.symbol.toLowerCase().includes(q.toLowerCase()) || r.name.toLowerCase().includes(q.toLowerCase()))).slice(0, 8),
    [board, picks, q],
  );

  // Best value per metric for highlighting.
  const bestBy = useMemo(() => {
    const m: Record<string, number> = {};
    for (const met of METRICS) {
      if (!met.best || rows.length < 2) continue;
      const vals = rows.map(met.get).filter((v) => !isNaN(v));
      if (!vals.length) continue;
      m[met.key] = met.best === 'hi' ? Math.max(...vals) : Math.min(...vals);
    }
    return m;
  }, [rows]);

  const add = (s: string) => { if (picks.length < 4) setPicks([...picks, s]); setQ(''); setAdding(false); };
  const remove = (s: string) => setPicks(picks.filter((p) => p !== s));

  return (
    <div className="fixed inset-0 z-[9998] flex items-center justify-center bg-black/60 p-4" onClick={onClose}>
      <div className="w-full max-w-4xl max-h-[85vh] overflow-hidden flex flex-col rounded-lg bg-[#0B0E14] border border-[#1B2236] shadow-2xl" onClick={(e) => e.stopPropagation()}>
        {/* Header */}
        <div className="flex items-center gap-2 px-4 py-3 border-b border-[#1B2236] shrink-0">
          <span className="text-[14px] font-bold text-white">Compare · BVMT</span>
          <span className="text-[11px] text-[#5A6478]">up to 4 stocks</span>
          <button onClick={onClose} className="ml-auto p-1.5 rounded-md hover:bg-[#1B2236] text-[#5A6478]"><X className="w-4 h-4" /></button>
        </div>

        {/* Picker */}
        <div className="flex flex-wrap items-center gap-2 px-4 py-3 border-b border-[#1B2236] shrink-0">
          {picks.map((s) => (
            <span key={s} className="flex items-center gap-1.5 pl-2.5 pr-1.5 py-1 rounded-md bg-[#151B29] text-[12px] font-semibold text-white">
              {s}
              <button onClick={() => remove(s)} className="text-[#5A6478] hover:text-white"><X className="w-3 h-3" /></button>
            </span>
          ))}
          {picks.length < 4 && (
            adding ? (
              <div className="relative">
                <div className="flex items-center gap-1.5 px-2 py-1 rounded-md bg-[#151B29] border border-[#2962FF]/40">
                  <Search className="w-3 h-3 text-[#5A6478]" />
                  <input autoFocus value={q} onChange={(e) => setQ(e.target.value)} placeholder="ticker or name…"
                    className="bg-transparent text-[12px] text-white placeholder:text-[#5A6478] focus:outline-none w-36" />
                </div>
                {q && options.length > 0 && (
                  <div className="absolute top-full mt-1 left-0 z-10 w-56 rounded-md bg-[#0F1420] border border-[#1B2236] shadow-xl overflow-hidden">
                    {options.map((o) => (
                      <button key={o.symbol} onClick={() => add(o.symbol)} className="flex items-center justify-between w-full px-3 py-2 text-left hover:bg-[#151B29]">
                        <span className="text-[12px] font-semibold text-white">{o.symbol}</span>
                        <span className="text-[10px] text-[#5A6478] truncate ml-2">{o.name}</span>
                      </button>
                    ))}
                  </div>
                )}
              </div>
            ) : (
              <button onClick={() => setAdding(true)} className="flex items-center gap-1 px-2 py-1 rounded-md border border-dashed border-[#2A3347] text-[12px] text-[#5A6478] hover:text-white hover:border-[#5A6478]">
                <Plus className="w-3 h-3" /> Add
              </button>
            )
          )}
        </div>

        {/* Table */}
        <div className="flex-1 overflow-auto">
          {rows.length === 0 ? (
            <div className="flex items-center justify-center h-40 text-[12px] text-[#5A6478]">Add stocks to compare.</div>
          ) : (
            <table className="w-full text-[12px]">
              <thead className="sticky top-0 bg-[#0B0E14]">
                <tr className="border-b border-[#1B2236]">
                  <th className="text-left font-medium text-[#5A6478] px-4 py-2.5 w-36">Metric</th>
                  {rows.map((r) => (
                    <th key={r.symbol} className="text-right px-4 py-2.5">
                      <button onClick={() => onOpenAsset?.(r.symbol)} className="inline-flex flex-col items-end group">
                        <span className="text-[13px] font-bold text-white group-hover:text-[#2962FF]">{r.symbol}</span>
                        <span className="text-[10px] text-[#5A6478] font-normal truncate max-w-[120px]">{r.name}</span>
                      </button>
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {METRICS.map((met) => (
                  <tr key={met.key} className="border-b border-[#151B29]">
                    <td className="px-4 py-2.5 text-[#8A92A6]">{met.label}</td>
                    {rows.map((r) => {
                      const v = met.get(r);
                      const isBest = met.best && !isNaN(v) && bestBy[met.key] === v && rows.length > 1;
                      const chgColor = met.key === 'chg' ? (r.changePct >= 0 ? '#00C853' : '#FF3D3D') : undefined;
                      return (
                        <td key={r.symbol} className="px-4 py-2.5 text-right font-mono" style={{ color: chgColor }}>
                          <span className={isBest ? 'font-bold' : ''} style={isBest && !chgColor ? { color: '#00C853' } : undefined}>
                            {met.key === 'chg' && (r.changePct >= 0 ? <TrendingUp className="inline w-3 h-3 mr-0.5" /> : <TrendingDown className="inline w-3 h-3 mr-0.5" />)}
                            {met.fmt(r)}
                          </span>
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>
    </div>
  );
};
