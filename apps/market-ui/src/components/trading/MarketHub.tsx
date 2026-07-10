import React, { useEffect, useState } from 'react';
import { ArrowRight, TrendingUp, TrendingDown, PanelLeft, PanelLeftClose } from 'lucide-react';
import { AreaChart, Area, ResponsiveContainer } from 'recharts';
import { motion, useReducedMotion } from 'motion/react';
import { MARKETS, type MarketDef, type MarketId } from '../../lib/markets';
import { fetchHeadline, fetchCloses, fetchTnIndexSeries, fmtPrice, fmtPct, type AssetRow } from '../../services/marketsHub';

interface MarketHubProps {
  onSelectMarket: (id: MarketId) => void;
  onSelectAsset: (symbol: string) => void;
  railOpen?: boolean;
  onToggleRail?: () => void;
}

const leadSymbol: Record<MarketId, string> = {
  us: '^GSPC', crypto: 'BTC-USD', tunisia: 'TUNINDEX',
  commodities: 'GC=F', bonds: '^TNX', forex: 'EURUSD=X',
};

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
            {lead ? fmtPrice(lead.price, def.currency) : <span className="inline-block h-6 w-28 rounded bg-[color:var(--surface-2)] animate-pulse align-middle" />}
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
        {rows.length === 0 &&
          Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="flex items-center justify-between px-2 py-1.5">
              <div className="flex items-center gap-2"><div className="w-5 h-5 rounded-full bg-[color:var(--surface-2)] animate-pulse" /><div className="h-3 w-16 rounded bg-[color:var(--surface-2)] animate-pulse" /></div>
              <div className="h-3 w-20 rounded bg-[color:var(--surface-2)] animate-pulse" />
            </div>
          ))}
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

export const MarketHub: React.FC<MarketHubProps> = ({ onSelectMarket, onSelectAsset, railOpen, onToggleRail }) => {
  const reduce = useReducedMotion();
  const [rowsByMarket, setRowsByMarket] = useState<Record<string, AssetRow[]>>({});
  const [seriesByMarket, setSeriesByMarket] = useState<Record<string, { v: number }[]>>({});

  useEffect(() => {
    let alive = true;
    const loadQuotes = () => {
      MARKETS.forEach((def) => {
        fetchHeadline(def)
          .then((rows) => { if (alive) setRowsByMarket((p) => ({ ...p, [def.id]: rows })); })
          .catch(() => {});
      });
    };
    // Sparklines: fetch once each.
    (['us', 'crypto', 'commodities', 'bonds', 'forex'] as MarketId[]).forEach((id) => {
      fetchCloses(leadSymbol[id]).then((closes) => {
        if (alive && closes.length) setSeriesByMarket((p) => ({ ...p, [id]: closes.map((v) => ({ v })) }));
      });
    });
    fetchTnIndexSeries().then((closes) => {
      if (alive && closes.length) setSeriesByMarket((p) => ({ ...p, tunisia: closes.map((v) => ({ v })) }));
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
          <div className="tape-roll flex w-max items-center py-2 whitespace-nowrap">
            {[0, 1].map((copy) => (
              <div key={copy} className="flex items-center gap-6 pl-6" aria-hidden={copy === 1}>
                {tape.map((r, i) => (
                  <button key={`${r.symbol}-${i}`} onClick={() => onSelectAsset(r.symbol)} tabIndex={copy === 1 ? -1 : 0} className="flex items-center gap-2 shrink-0 hover:opacity-80 transition-opacity">
                    <span className="text-data font-semibold text-[color:var(--text)]">{r.symbol.replace('^', '')}</span>
                    <span className="font-mono text-data text-[color:var(--text-2)]">{fmtPrice(r.price, r.currency)}</span>
                    <Delta pct={r.changePct} />
                  </button>
                ))}
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="max-w-[1280px] mx-auto px-4 py-6">
        {/* Hero header */}
        <div className="section-mark mb-6" data-mark="000 / MARKETS">
          <div className="flex items-center gap-3">
            {onToggleRail && (
              <button
                onClick={onToggleRail}
                title={railOpen ? 'Hide sidebar' : 'Show sidebar'}
                className="w-7 h-7 rounded-sm flex items-center justify-center transition-colors text-[color:var(--text-3)] hover:text-[color:var(--text)] hover:bg-[color:var(--surface-2)]"
              >
                {railOpen ? <PanelLeftClose className="w-4 h-4" /> : <PanelLeft className="w-4 h-4" />}
              </button>
            )}
            <h1 className="text-h2 font-display font-semibold text-[color:var(--text)] tracking-tight leading-[0.95]">
              Markets at a Glance
            </h1>
          </div>
          <p className="text-body text-[color:var(--text-3)] mt-2 max-w-xl">
            Crypto, US equities and the Tunisian market — one desk. Pick a market to explore, or jump straight to any asset.
          </p>
        </div>

        {/* Market cards */}
        <motion.div
          className="grid grid-cols-1 lg:grid-cols-3 gap-4"
          initial="hidden"
          animate="show"
          variants={{ show: { transition: { staggerChildren: reduce ? 0 : 0.06 } } }}
        >
          {MARKETS.map((def) => (
            <motion.div key={def.id} variants={{ hidden: { opacity: reduce ? 1 : 0, y: reduce ? 0 : 12 }, show: { opacity: 1, y: 0 } }}>
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

      </div>
    </div>
  );
};
