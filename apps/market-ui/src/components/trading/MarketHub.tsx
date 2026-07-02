import React, { useEffect, useState } from 'react';
import { ArrowRight, TrendingUp, TrendingDown, Sparkles } from 'lucide-react';
import { AreaChart, Area, ResponsiveContainer } from 'recharts';
import { motion } from 'motion/react';
import { MARKETS, type MarketDef, type MarketId } from '../../lib/markets';
import { fetchHeadline, fetchCloses, fmtPrice, fmtPct, type AssetRow } from '../../services/marketsHub';

interface MarketHubProps {
  onSelectMarket: (id: MarketId) => void;
  onSelectAsset: (symbol: string) => void;
}

// Static indicative TUNINDEX series (mock — Phase 6 replaces with real BVMT).
const TN_SERIES = [9640, 9710, 9680, 9820, 9790, 9880, 9847].map((v) => ({ v }));

const leadSymbol: Record<MarketId, string> = { us: '^GSPC', crypto: 'BTC-USD', tunisia: 'TUNINDEX' };

const Delta = ({ pct }: { pct: number }) => {
  const up = pct >= 0;
  return (
    <span className={`font-mono text-label inline-flex items-center gap-0.5 ${up ? 'up' : 'down'}`}>
      {up ? <TrendingUp className="w-2.5 h-2.5" /> : <TrendingDown className="w-2.5 h-2.5" />}
      {fmtPct(pct)}
    </span>
  );
};

function MarketCard({
  def,
  rows,
  series,
  onSelectMarket,
  onSelectAsset,
}: {
  def: MarketDef;
  rows: AssetRow[];
  series: { v: number }[];
  onSelectMarket: (id: MarketId) => void;
  onSelectAsset: (symbol: string) => void;
}) {
  const lead = rows[0];
  const up = (lead?.changePct ?? 0) >= 0;
  const stroke = up ? 'var(--up)' : 'var(--down)';
  const gid = `grad-${def.id}`;

  return (
    <div className="bg-[color:var(--surface)] border border-[color:var(--line)] hover:border-[color:var(--line-strong)] rounded-[6px] p-4 transition-colors lux-border flex flex-col">
      <button
        onClick={() => onSelectMarket(def.id)}
        className="flex items-start justify-between mb-3 group text-left"
      >
        <div>
          <h3 className="text-h4 font-display font-semibold text-[color:var(--text)] tracking-tight">{def.label}</h3>
          <p className="text-label text-[color:var(--text-3)] mt-0.5">{def.blurb}</p>
        </div>
        <ArrowRight className="w-4 h-4 text-[color:var(--text-3)] group-hover:text-[color:var(--accent)] group-hover:translate-x-0.5 transition-all shrink-0 mt-1" />
      </button>

      {/* Lead index + sparkline */}
      <div className="flex items-end justify-between mb-3 pb-3 border-b border-[color:var(--line)]">
        <div>
          <div className="font-mono text-h3 text-[color:var(--text)] leading-none">
            {lead ? fmtPrice(lead.price, def.currency) : '—'}
          </div>
          <div className="mt-1 flex items-center gap-2">
            <span className="label">{def.indices[0]?.name}</span>
            {lead && <Delta pct={lead.changePct} />}
          </div>
        </div>
        <div className="w-28 h-12 shrink-0">
          {series.length > 1 && (
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={series} margin={{ top: 2, bottom: 2, left: 0, right: 0 }}>
                <defs>
                  <linearGradient id={gid} x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor={stroke} stopOpacity={0.25} />
                    <stop offset="100%" stopColor={stroke} stopOpacity={0} />
                  </linearGradient>
                </defs>
                <Area type="monotone" dataKey="v" stroke={stroke} strokeWidth={1.5} fill={`url(#${gid})`} isAnimationActive={false} />
              </AreaChart>
            </ResponsiveContainer>
          )}
        </div>
      </div>

      {/* Constituents */}
      <div className="space-y-1.5 flex-1">
        {rows.slice(1, 5).map((r) => (
          <button
            key={r.symbol}
            onClick={() => onSelectAsset(r.symbol)}
            className="w-full flex items-center justify-between px-2 py-1.5 -mx-2 rounded-sm hover:bg-[color:var(--surface-2)] transition-colors"
          >
            <div className="flex items-center gap-2 min-w-0">
              {r.logo ? (
                <img
                  src={r.logo}
                  alt={r.symbol}
                  className="w-5 h-5 rounded-full shrink-0"
                  onError={(e) => { (e.target as HTMLImageElement).style.visibility = 'hidden'; }}
                />
              ) : (
                <span className="w-5 h-5 rounded-full shrink-0 flex items-center justify-center text-[9px] font-bold bg-[color:var(--surface-2)] text-[color:var(--text-2)] border border-[color:var(--line)]">
                  {r.symbol.replace('^', '').slice(0, 2)}
                </span>
              )}
              <span className="text-data font-semibold text-[color:var(--text)]">{r.symbol.replace('^', '')}</span>
              <span className="text-label text-[color:var(--text-3)] truncate hidden sm:inline">{r.name}</span>
            </div>
            <div className="flex items-center gap-3 shrink-0">
              <span className="font-mono text-data text-[color:var(--text)]">{fmtPrice(r.price, def.currency)}</span>
              <span className="w-16 text-right"><Delta pct={r.changePct} /></span>
            </div>
          </button>
        ))}
      </div>

      <button
        onClick={() => onSelectMarket(def.id)}
        className="mt-3 text-label font-semibold text-[color:var(--accent)] hover:underline flex items-center gap-1 self-start"
      >
        See all {def.label} <ArrowRight className="w-3 h-3" />
      </button>
    </div>
  );
}

export const MarketHub: React.FC<MarketHubProps> = ({ onSelectMarket, onSelectAsset }) => {
  const [rowsByMarket, setRowsByMarket] = useState<Record<string, AssetRow[]>>({});
  const [seriesByMarket, setSeriesByMarket] = useState<Record<string, { v: number }[]>>({
    tunisia: TN_SERIES,
  });

  useEffect(() => {
    let alive = true;
    const loadQuotes = () => {
      MARKETS.forEach((def) => {
        fetchHeadline(def)
          .then((rows) => { if (alive) setRowsByMarket((p) => ({ ...p, [def.id]: rows })); })
          .catch(() => {});
      });
    };
    // Sparklines: fetch once (Yahoo intraday); TN is static.
    (['us', 'crypto'] as MarketId[]).forEach((id) => {
      fetchCloses(leadSymbol[id]).then((closes) => {
        if (alive && closes.length) setSeriesByMarket((p) => ({ ...p, [id]: closes.map((v) => ({ v })) }));
      });
    });
    loadQuotes();
    const t = setInterval(loadQuotes, 15000);
    return () => { alive = false; clearInterval(t); };
  }, []);

  // Ticker tape across the top (headline instruments from every market).
  const tape = MARKETS.flatMap((m) => (rowsByMarket[m.id] || []).slice(0, 3).map((r) => ({ ...r, currency: m.currency })));

  return (
    <div className="flex-1 bg-[color:var(--bg)] overflow-y-auto">
      {/* Ticker tape */}
      {tape.length > 0 && (
        <div className="border-b border-[color:var(--line)] bg-[color:var(--surface)] overflow-hidden">
          <div className="flex items-center gap-6 px-4 py-2 whitespace-nowrap overflow-x-auto scrollbar-hide">
            {tape.map((r, i) => (
              <button key={`${r.symbol}-${i}`} onClick={() => onSelectAsset(r.symbol)} className="flex items-center gap-2 shrink-0 hover:opacity-80 transition-opacity">
                <span className="text-data font-semibold text-[color:var(--text)]">{r.symbol.replace('^', '')}</span>
                <span className="font-mono text-data text-[color:var(--text-2)]">{fmtPrice(r.price, r.currency)}</span>
                <Delta pct={r.changePct} />
              </button>
            ))}
          </div>
        </div>
      )}

      <div className="max-w-[1280px] mx-auto px-4 py-6">
        {/* Hero header */}
        <div className="section-mark mb-6" data-mark="000 / MARKETS">
          <h1 className="text-h2 font-display font-semibold text-[color:var(--text)] tracking-tight leading-[0.95]">
            Markets at a Glance
          </h1>
          <p className="text-body text-[color:var(--text-3)] mt-2 max-w-xl">
            Crypto, US equities and the Tunisian market — one desk. Pick a market to explore, or jump straight to any asset.
          </p>
        </div>

        {/* Market cards */}
        <motion.div
          className="grid grid-cols-1 lg:grid-cols-3 gap-4"
          initial="hidden"
          animate="show"
          variants={{ show: { transition: { staggerChildren: 0.06 } } }}
        >
          {MARKETS.map((def) => (
            <motion.div key={def.id} variants={{ hidden: { opacity: 0, y: 12 }, show: { opacity: 1, y: 0 } }}>
              <MarketCard
                def={def}
                rows={rowsByMarket[def.id] || []}
                series={seriesByMarket[def.id] || []}
                onSelectMarket={onSelectMarket}
                onSelectAsset={onSelectAsset}
              />
            </motion.div>
          ))}
        </motion.div>

        {/* Coming soon */}
        <div className="mt-6">
          <p className="label mb-2">MORE MARKETS</p>
          <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
            {['Commodities', 'Bonds', 'Forex'].map((label) => (
              <div key={label} className="bg-[color:var(--surface)] border border-dashed border-[color:var(--line)] rounded-[6px] p-4 flex items-center justify-between opacity-60">
                <div className="flex items-center gap-2">
                  <Sparkles className="w-4 h-4 text-[color:var(--text-3)]" />
                  <span className="text-body font-medium text-[color:var(--text-2)]">{label}</span>
                </div>
                <span className="label text-[color:var(--text-3)]">SOON</span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
};
