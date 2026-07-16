import React, { useEffect, useMemo, useState } from 'react';
import { Search, ArrowLeft, TrendingUp, TrendingDown, AlertTriangle, Star, Trophy, Activity, ArrowUpDown, BarChart2, ExternalLink, ArrowUp, ArrowDown, ArrowRight, ChevronsLeft, ChevronsRight, Trash2, Plus, Check, ChevronLeft, Building2, Landmark } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import type { MarketDef } from '../../lib/markets';
import { fetchMarket, fetchQuotes, fetchSparks, fmtPrice, fmtPct, fmtCompact, type AssetRow } from '../../services/marketsHub';
import { TnComparator } from './TnComparator';
import { safeUrl } from '../../lib/safeUrl';
import { TnMarketOverview } from './TnMarketOverview';

// Market-appropriate external links (crypto's COINMARKETCAP/COINGECKO equivalent).
export function assetLinks(market: MarketDef, r: AssetRow): { label: string; url: string }[] {
  const clean = r.symbol.replace('^', '').replace('=F', '').replace('=X', '');
  if (market.id === 'tunisia') {
    const links = [{ label: 'ILBOURSA', url: `https://www.ilboursa.com/marches/cotation_${r.symbol}` }];
    if (r.isin) links.unshift({ label: 'BVMT', url: `https://www.bvmt.com.tn/fr/content/fiche-valeur?isin=${r.isin}` });
    return links;
  }
  const links = [
    { label: 'YAHOO FINANCE', url: `https://finance.yahoo.com/quote/${encodeURIComponent(r.symbol)}` },
    { label: 'TRADINGVIEW', url: `https://www.tradingview.com/chart/?symbol=${encodeURIComponent(clean)}` },
  ];
  if (market.id === 'us') links.push({ label: 'SEC EDGAR', url: `https://www.sec.gov/cgi-bin/browse-edgar?action=getcompany&company=${encodeURIComponent(clean)}&type=10-K` });
  return links;
}

interface MarketListProps {
  market: MarketDef;
  onAssetSelect: (symbol: string) => void;
  onBack: () => void;
}

type SortKey = 'name' | 'price' | 'changePct' | 'volume' | 'marketCap';

// TNV-3 (COLHEAD parity): data columns after star/#, registry-driven so the TN
// list can reorder/hide via a per-column header menu (crypto Markets menuTh).
// Non-TN markets always use DEFAULT_ORDER with nothing hidden → byte-identical.
type ColKey =
  | 'name' | 'price' | 'changePct' | 'sevenD' | 'volume' | 'marketCap' | 'circulating' | 'spark'
  // TNV-7 chooser columns (TN-only, default hidden). Lazy data: ref / fundamentals / engine / intraday.
  | 'sector' | 'isin' | 'turnover' | 'open' | 'high' | 'low'
  | 'per' | 'eps' | 'pb' | 'netIncome' | 'equity' | 'divYield'
  | 'engScore' | 'engLabel' | 'fMomentum' | 'fVolume' | 'fNews' | 'fLiqTrend';
const DEFAULT_ORDER: ColKey[] = [
  'name', 'price', 'changePct', 'sevenD', 'volume', 'marketCap', 'circulating', 'spark',
  'sector', 'isin', 'turnover', 'open', 'high', 'low',
  'per', 'eps', 'pb', 'netIncome', 'equity', 'divYield',
  'engScore', 'engLabel', 'fMomentum', 'fVolume', 'fNews', 'fLiqTrend',
];
// Columns that only exist for the TN market (need TN-only data sources). Default
// hidden; the grouped chooser opts them in. Non-TN markets never render them.
const TN_ONLY_KEYS = new Set<ColKey>([
  'sector', 'isin', 'turnover', 'open', 'high', 'low',
  'per', 'eps', 'pb', 'netIncome', 'equity', 'divYield',
  'engScore', 'engLabel', 'fMomentum', 'fVolume', 'fNews', 'fLiqTrend',
]);
const COLMETA: Record<ColKey, { label: string; cls: string; sort?: SortKey; movable?: boolean }> = {
  name:        { label: 'Name', cls: '', sort: 'name', movable: true },
  price:       { label: 'Price', cls: 'text-right', sort: 'price', movable: true },
  changePct:   { label: '24h %', cls: 'text-right', sort: 'changePct', movable: true },
  sevenD:      { label: '7d %', cls: 'text-right hidden md:table-cell' },
  volume:      { label: 'Volume', cls: 'text-right hidden lg:table-cell', sort: 'volume', movable: true },
  marketCap:   { label: 'Market Cap', cls: 'text-right hidden sm:table-cell', sort: 'marketCap', movable: true },
  circulating: { label: 'Circulating', cls: 'text-right hidden lg:table-cell' },
  spark:       { label: 'Last 7 Days', cls: 'text-right hidden md:table-cell' },
  sector:      { label: 'Sector', cls: 'hidden lg:table-cell' },
  isin:        { label: 'ISIN', cls: 'text-right hidden xl:table-cell' },
  turnover:    { label: 'Turnover', cls: 'text-right hidden lg:table-cell' },
  open:        { label: 'Open', cls: 'text-right hidden xl:table-cell' },
  high:        { label: 'High', cls: 'text-right hidden xl:table-cell' },
  low:         { label: 'Low', cls: 'text-right hidden xl:table-cell' },
  per:         { label: 'PER', cls: 'text-right hidden lg:table-cell' },
  eps:         { label: 'EPS', cls: 'text-right hidden xl:table-cell' },
  pb:          { label: 'P/B', cls: 'text-right hidden xl:table-cell' },
  netIncome:   { label: 'Net Income', cls: 'text-right hidden xl:table-cell' },
  equity:      { label: 'Equity', cls: 'text-right hidden xl:table-cell' },
  divYield:    { label: 'Div Yield', cls: 'text-right hidden lg:table-cell' },
  engScore:    { label: 'Score', cls: 'text-right hidden lg:table-cell' },
  engLabel:    { label: 'Signal', cls: 'text-right hidden lg:table-cell' },
  fMomentum:   { label: 'Momentum', cls: 'text-right hidden xl:table-cell' },
  fVolume:     { label: 'Vol Factor', cls: 'text-right hidden xl:table-cell' },
  fNews:       { label: 'News', cls: 'text-right hidden xl:table-cell' },
  fLiqTrend:   { label: 'Liq/Trend', cls: 'text-right hidden xl:table-cell' },
};
// Grouped column chooser (TN only) — 4 HONEST groups, real data, honest — for gaps.
const TN_COL_GROUPS: { label: string; icon: any; cols: { k: ColKey; label: string }[] }[] = [
  { label: 'Company', icon: Building2, cols: [
    { k: 'sector', label: 'Sector' }, { k: 'isin', label: 'ISIN' }, { k: 'circulating', label: 'Shares outstanding' },
  ] },
  { label: 'Market data', icon: BarChart2, cols: [
    { k: 'price', label: 'Price' }, { k: 'changePct', label: 'Change % today' }, { k: 'sevenD', label: 'Change 7d' },
    { k: 'volume', label: 'Volume' }, { k: 'turnover', label: 'Turnover TND' }, { k: 'marketCap', label: 'Market cap' },
    { k: 'open', label: 'Open' }, { k: 'high', label: 'High' }, { k: 'low', label: 'Low' },
  ] },
  { label: 'Valuation', icon: Landmark, cols: [
    { k: 'per', label: 'PER' }, { k: 'eps', label: 'EPS' }, { k: 'pb', label: 'P/B' },
    { k: 'netIncome', label: 'Net income' }, { k: 'equity', label: 'Equity' }, { k: 'divYield', label: 'Div yield' },
  ] },
  { label: 'Signal', icon: Activity, cols: [
    { k: 'engScore', label: 'Engine score' }, { k: 'engLabel', label: 'Label' }, { k: 'fMomentum', label: 'Momentum' },
    { k: 'fVolume', label: 'Volume factor' }, { k: 'fNews', label: 'News' }, { k: 'fLiqTrend', label: 'Liquidity/Trend' },
  ] },
];
const sanitizeOrder = (o?: string[]): ColKey[] => {
  const known = (o || []).filter((k): k is ColKey => (DEFAULT_ORDER as string[]).includes(k));
  return [...known, ...DEFAULT_ORDER.filter((k) => !known.includes(k))];
};

// Tiny inline sparkline from a close series (no per-row fetch).
const MiniSpark = ({ data }: { data: number[] }) => {
  if (data.length < 2) return <span className="text-[color:var(--text-3)]">—</span>;
  const min = Math.min(...data);
  const max = Math.max(...data);
  const range = max - min || 1;
  const w = 96, h = 32;
  const pts = data.map((v, i) => `${(i / (data.length - 1)) * w},${h - ((v - min) / range) * h}`).join(' ');
  const up = data[data.length - 1] >= data[0];
  return (
    <svg width={w} height={h} className="overflow-visible">
      <polyline points={pts} fill="none" stroke={up ? 'var(--up)' : 'var(--down)'} strokeWidth="1.5" strokeLinejoin="round" strokeLinecap="round" />
    </svg>
  );
};

const Delta = ({ pct }: { pct: number }) => {
  const up = pct >= 0;
  return (
    <span className={`inline-flex items-center gap-0.5 font-mono ${up ? 'up' : 'down'}`}>
      {up ? <TrendingUp className="w-2.5 h-2.5" /> : <TrendingDown className="w-2.5 h-2.5" />}
      {fmtPct(pct)}
    </span>
  );
};

// Real logos for BVMT names (no logo API for TN) — company site favicon via
// DuckDuckGo's icon service (no key, permissive CORS). Unmapped tickers and
// failed loads fall back to the initials placeholder.
export const TN_DOMAINS: Record<string, string> = {
  // Banks
  BIAT: 'biat.com.tn', BT: 'bt.com.tn', ATB: 'atb.com.tn', STB: 'stb.com.tn', BH: 'bh.com.tn',
  BNA: 'bna.com.tn', UIB: 'uib.com.tn', UBCI: 'ubci.tn', AB: 'amenbank.com.tn', TJARI: 'attijaribank.com.tn',
  WIFAK: 'wifakbank.com', BTE: 'bte.com.tn',
  // Leasing / finance
  ATL: 'atl.com.tn', CIL: 'cil.com.tn', TLS: 'tunisieleasing.tn', BL: 'bestlease.com.tn', TJL: 'attijarileasing.com.tn',
  // Insurance
  STAR: 'star.com.tn', AST: 'astree.com.tn', ASSMA: 'maghrebia.com.tn', AMV: 'maghrebia.com.tn',
  BHASS: 'bhassurance.com.tn', BNASS: 'bna-assurances.com.tn', TRE: 'tunisre.com.tn',
  // Consumer / holdings / industrials
  SFBT: 'sfbt.tn', PGH: 'poulinagroupholding.com', DH: 'delice.tn', SAH: 'sah.com.tn', TLNET: 'telnet.tn',
  ARTES: 'artesautomobile.com', MNP: 'monoprix.tn', TAIR: 'tunisair.com', SOTUV: 'sotuver.tn',
  ALKIM: 'alkimia.com.tn', NAKL: 'ennakl.com.tn', CC: 'carthagecement.com.tn', CITY: 'citycars.com.tn',
  SOTET: 'sotetel.com.tn', MGR: 'sotumag.com.tn', OTH: 'onetech-group.com', AL: 'airliquide.com',
  MAG: 'magasingeneral.tn', LNDOR: 'landor.com.tn', ECYCL: 'eurocycles.com.tn', ASSAD: 'assad.com.tn',
  CELL: 'cellcom.tn', SMART: 'smart.com.tn', TPR: 'tpr.com.tn', UMED: 'unimed.com.tn',
  SIPHA: 'siphat.com.tn', SITEX: 'sitex.com.tn', SIAME: 'siame.com.tn', SMD: 'sanimed.com.tn',
  STIP: 'stip.com.tn', SCB: 'cimentsdebizerte.com.tn', MPBS: 'mpbs.com.tn', SOTEM: 'sotemail.com.tn',
  ICF: 'icf.com.tn', SOKNA: 'essoukna.com.tn', PLAST: 'officeplast.com.tn', AETEC: 'aetech.com.tn',
  HL: 'hannibalease.com.tn',
};

const AssetIcon = ({ r, size = 6 }: { r: AssetRow; size?: 5 | 6 }) => {
  const cls = size === 5 ? 'w-5 h-5' : 'w-6 h-6';
  const sym = r.symbol.replace('^', '');
  const domain = TN_DOMAINS[sym];
  const src = r.logo || (domain ? `https://icons.duckduckgo.com/ip3/${domain}.ico` : null);
  const [failed, setFailed] = useState(false);
  return src && !failed ? (
    <img src={src} alt={r.symbol} className={`${cls} rounded-full border border-[color:var(--line)] shrink-0 bg-white object-contain`} onError={() => setFailed(true)} />
  ) : (
    <span className={`${cls} rounded-full flex items-center justify-center text-[10px] font-bold bg-[color:var(--bg)] text-[color:var(--text-2)] border border-[color:var(--line)] shrink-0`}>
      {sym.slice(0, 2)}
    </span>
  );
};

// TRENDING/GAINERS/LOSERS-style card matching the crypto Markets page.
const HighlightCard = ({ title, icon: Icon, data, onSelect }: { title: string; icon: any; data: AssetRow[]; onSelect: (s: string) => void }) => (
  <div className="bg-[color:var(--surface)] border border-[color:var(--line)] hover:border-[color:var(--line-strong)] rounded-[4px] p-3 transition-colors lux-border">
    <div className="flex items-center gap-2 mb-3">
      <Icon className="w-3.5 h-3.5 text-[color:var(--accent)]" />
      <span className="label">{title}</span>
    </div>
    <div className="space-y-1">
      {data.length === 0 && (
        <div className="text-label text-[color:var(--text-3)] px-2 py-1.5">Loading…</div>
      )}
      {data.slice(0, 3).map((r, idx) => (
        <div
          key={r.symbol}
          onClick={() => onSelect(r.symbol)}
          className="flex items-center justify-between px-2 py-1.5 -mx-2 rounded-sm cursor-pointer hover:bg-[color:var(--surface-2)] transition-colors"
        >
          <div className="flex items-center gap-2.5 min-w-0">
            <span className="font-mono text-data text-[color:var(--text-3)] w-3">{idx + 1}</span>
            <AssetIcon r={r} size={5} />
            <div className="flex flex-col leading-tight min-w-0">
              <span className="text-data font-semibold text-[color:var(--text)]">{r.symbol.replace('^', '')}</span>
              <span className="text-label text-[color:var(--text-3)] truncate w-24">{r.name}</span>
            </div>
          </div>
          <div className="flex flex-col items-end leading-tight shrink-0">
            <span className="font-mono text-data text-[color:var(--text)]">{fmtPrice(r.price, r.currency)}</span>
            <span className="text-label"><Delta pct={r.changePct} /></span>
          </div>
        </div>
      ))}
    </div>
  </div>
);

export const MarketList: React.FC<MarketListProps> = ({ market, onAssetSelect, onBack }) => {
  // Large Yahoo lists (S&P 500) fetch page-by-page so we never quote 500 symbols
  // at once. Small lists (crypto ~100, TN) load fully.
  const paged = market.source === 'yahoo' && market.symbols.length > 60;

  const [fullRows, setFullRows] = useState<AssetRow[]>([]);
  const [quotes, setQuotes] = useState<Record<string, AssetRow>>({});
  const [sparks, setSparks] = useState<Record<string, number[]>>({});
  const [loading, setLoading] = useState(!paged);
  const [error, setError] = useState(false);
  const [reloadKey, setReloadKey] = useState(0);
  const [query, setQuery] = useState('');
  const [page, setPage] = useState(1);
  const [perPage, setPerPage] = useState(25);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [sort, setSort] = useState<{ key: SortKey; dir: 'asc' | 'desc' }>(
    paged ? { key: 'name', dir: 'asc' } : { key: 'marketCap', dir: 'desc' },
  );
  // TNV-3: TN-only column order + hidden set, persisted to `tn-cols`.
  const isTN = market.id === 'tunisia';
  const [headMenu, setHeadMenu] = useState<ColKey | null>(null);
  const [tnOrder, setTnOrder] = useState<ColKey[]>(() => {
    try { return sanitizeOrder(JSON.parse(localStorage.getItem('tn-cols') || '{}').order); } catch { return DEFAULT_ORDER; }
  });
  const [tnHidden, setTnHidden] = useState<Record<string, boolean>>(() => {
    // TN-only chooser columns start hidden; stored prefs override.
    const base = Object.fromEntries([...TN_ONLY_KEYS].map((k) => [k, true]));
    try { return { ...base, ...(JSON.parse(localStorage.getItem('tn-cols') || '{}').hidden || {}) }; } catch { return base; }
  });
  useEffect(() => {
    if (isTN) localStorage.setItem('tn-cols', JSON.stringify({ order: tnOrder, hidden: tnHidden }));
  }, [isTN, tnOrder, tnHidden]);
  // TNV-7 grouped chooser + lazy data maps (fetched only when a group's col is on).
  const [colMenu, setColMenu] = useState(false);
  const [openGroup, setOpenGroup] = useState<string | null>(null);
  const [colSearch, setColSearch] = useState('');
  const [refMap, setRefMap] = useState<Record<string, any>>({});
  const [fundMap, setFundMap] = useState<Record<string, any>>({});
  const [engineMap, setEngineMap] = useState<Record<string, any>>({});
  const [ohlMap, setOhlMap] = useState<Record<string, { open: number; high: number; low: number }>>({});
  const WKEY = `hub_watchlist_${market.id}`;
  const [watchlist, setWatchlist] = useState<string[]>(() => {
    try { return JSON.parse(localStorage.getItem(WKEY) || '[]'); } catch { return []; }
  });
  const [watchOnly, setWatchOnly] = useState(false);
  const [showCompare, setShowCompare] = useState(false);
  const [tnHighs, setTnHighs] = useState<Record<string, { highRatio: number; high: number; last: number }>>({});
  useEffect(() => {
    if (market.id !== 'tunisia') return;
    fetch('/api/tn/highs').then((r) => r.json()).then((j) => setTnHighs(j.byIsin || {})).catch(() => {});
  }, [market.id]);
  useEffect(() => {
    try { setWatchlist(JSON.parse(localStorage.getItem(WKEY) || '[]')); } catch { setWatchlist([]); }
    setWatchOnly(false);
  }, [WKEY]);
  useEffect(() => { localStorage.setItem(WKEY, JSON.stringify(watchlist)); }, [WKEY, watchlist]);
  const toggleWatch = (e: React.MouseEvent, sym: string) => {
    e.stopPropagation();
    setWatchlist((p) => (p.includes(sym) ? p.filter((s) => s !== sym) : [...p, sym]));
  };

  // Full load (non-paged sources).
  useEffect(() => {
    if (paged) return;
    let alive = true;
    setLoading(true); setError(false);
    const load = () =>
      fetchMarket(market)
        .then((r) => { if (alive) { setFullRows(r); setLoading(false); setError(false); } })
        .catch(() => { if (alive) { setLoading(false); if (fullRows.length === 0) setError(true); } });
    load();
    const t = setInterval(load, 15000);
    return () => { alive = false; clearInterval(t); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [market, paged, reloadKey]);

  useEffect(() => { setPage(1); setExpanded(null); }, [query, market, watchOnly, perPage]);

  const baseRows: AssetRow[] = useMemo(
    () =>
      paged
        ? market.symbols.map((s) => {
            const q = quotes[s.symbol];
            return q || { symbol: s.symbol, name: s.name, price: 0, changePct: 0, currency: market.currency };
          })
        : fullRows,
    [paged, market, fullRows, quotes],
  );

  const hasMcap = baseRows.some((r) => r.marketCap);
  const hasVol = baseRows.some((r) => r.volume);
  const hasCirc = baseRows.some((r) => r.circulating);
  const showSpark = market.source === 'yahoo' || market.source === 'tunisia';
  // CMC shows "$1.26T"; TND has no symbol so it goes after the number.
  const fmtCap = (v: number, cur: string) => (cur === 'TND' ? `${fmtCompact(v)} TND` : '$' + fmtCompact(v));

  // 7d % — from the batch sparkline series (first vs last close).
  const pct7d = (r: AssetRow): number | null => {
    if (typeof r.changePct7d === 'number') return r.changePct7d;
    const s = sparks[r.symbol];
    if (s && s.length > 1 && s[0] !== 0) return ((s[s.length - 1] - s[0]) / s[0]) * 100;
    return null;
  };

  // TNV-3: which columns exist for this market, then the visible ordered set.
  const availableCol = (k: ColKey): boolean =>
    TN_ONLY_KEYS.has(k) ? isTN
      : k === 'volume' ? hasVol : k === 'marketCap' ? hasMcap : k === 'circulating' ? hasCirc : k === 'spark' ? showSpark : true;
  const order = isTN ? tnOrder : DEFAULT_ORDER;
  const visibleCols = order.filter((k) => availableCol(k) && !(isTN && tnHidden[k]));
  const nColSpan = 2 + visibleCols.length + (isTN ? 1 : 0); // star + # + data cols + TN chooser th

  const moveColumn = (kk: ColKey, where: 'left' | 'right' | 'start' | 'end') => {
    setTnOrder((prev) => {
      const o = [...prev];
      const i = o.indexOf(kk);
      if (i < 0) return prev;
      if (where === 'start') { o.splice(i, 1); o.unshift(kk); return o; }
      if (where === 'end') { o.splice(i, 1); o.push(kk); return o; }
      const dir = where === 'left' ? -1 : 1;
      let j = i + dir;
      while (j >= 0 && j < o.length && !(availableCol(o[j]) && !tnHidden[o[j]])) j += dir;
      if (j < 0 || j >= o.length) return prev;
      [o[i], o[j]] = [o[j], o[i]];
      return o;
    });
  };

  // TN per-column header menu (crypto menuTh parity): sort / move / hide.
  const menuTh = (kk: ColKey) => {
    const m = COLMETA[kk];
    return (
      <th key={kk} className={`py-2 px-4 label cursor-pointer hover:text-[color:var(--text)] transition-colors group relative ${m.cls}`} onClick={() => setHeadMenu(headMenu === kk ? null : kk)}>
        <div className={`flex items-center gap-1 ${m.cls.includes('text-right') ? 'justify-end' : ''}`}>
          {m.label}
          <ArrowUpDown className="w-2.5 h-2.5 opacity-0 group-hover:opacity-100 transition-opacity" />
        </div>
        {headMenu === kk && (
          <>
            <div className="fixed inset-0 z-40" onClick={(e) => { e.stopPropagation(); setHeadMenu(null); }} />
            <div className="absolute right-4 top-full mt-1 z-50 w-44 bg-[color:var(--surface)] border border-[color:var(--line)] rounded-sm shadow-xl py-1 text-left normal-case" onClick={(e) => e.stopPropagation()}>
              <button onClick={() => { setSort({ key: m.sort!, dir: 'asc' }); setHeadMenu(null); }} className="w-full flex items-center gap-2 px-3 py-1.5 text-body font-normal text-[color:var(--text-2)] hover:bg-[color:var(--surface-2)] transition-colors"><ArrowUp className="w-3 h-3" /> Sort ascending</button>
              <button onClick={() => { setSort({ key: m.sort!, dir: 'desc' }); setHeadMenu(null); }} className="w-full flex items-center gap-2 px-3 py-1.5 text-body font-normal text-[color:var(--text-2)] hover:bg-[color:var(--surface-2)] transition-colors"><ArrowDown className="w-3 h-3" /> Sort descending</button>
              <div className="h-px bg-[color:var(--line)] my-1" />
              <button onClick={() => { moveColumn(kk, 'left'); setHeadMenu(null); }} className="w-full flex items-center gap-2 px-3 py-1.5 text-body font-normal text-[color:var(--text-2)] hover:bg-[color:var(--surface-2)] transition-colors"><ArrowLeft className="w-3 h-3" /> Move left</button>
              <button onClick={() => { moveColumn(kk, 'right'); setHeadMenu(null); }} className="w-full flex items-center gap-2 px-3 py-1.5 text-body font-normal text-[color:var(--text-2)] hover:bg-[color:var(--surface-2)] transition-colors"><ArrowRight className="w-3 h-3" /> Move right</button>
              <button onClick={() => { moveColumn(kk, 'start'); setHeadMenu(null); }} className="w-full flex items-center gap-2 px-3 py-1.5 text-body font-normal text-[color:var(--text-2)] hover:bg-[color:var(--surface-2)] transition-colors"><ChevronsLeft className="w-3 h-3" /> Move to the start</button>
              <button onClick={() => { moveColumn(kk, 'end'); setHeadMenu(null); }} className="w-full flex items-center gap-2 px-3 py-1.5 text-body font-normal text-[color:var(--text-2)] hover:bg-[color:var(--surface-2)] transition-colors"><ChevronsRight className="w-3 h-3" /> Move to the end</button>
              <div className="h-px bg-[color:var(--line)] my-1" />
              <button
                disabled={visibleCols.length <= 1}
                onClick={() => { if (visibleCols.length > 1) setTnHidden((p) => ({ ...p, [kk]: true })); setHeadMenu(null); }}
                className="w-full flex items-center gap-2 px-3 py-1.5 text-body font-normal text-[color:var(--text-2)] hover:bg-[color:var(--surface-2)] transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
              ><Trash2 className="w-3 h-3" /> Hide column</button>
            </div>
          </>
        )}
      </th>
    );
  };

  const headerFor = (kk: ColKey) => {
    const m = COLMETA[kk];
    if (isTN && m.movable) return menuTh(kk);
    return (
      <th
        key={kk}
        onClick={() => m.sort && toggleSort(m.sort)}
        className={`py-2 px-4 label transition-colors group ${m.cls} ${m.sort ? 'cursor-pointer hover:text-[color:var(--text)]' : ''}`}
      >
        <div className={`flex items-center gap-1 ${m.cls.includes('text-right') ? 'justify-end' : ''}`}>
          {m.label}
          {m.sort && <ArrowUpDown className="w-2.5 h-2.5 opacity-0 group-hover:opacity-100 transition-opacity" />}
        </div>
      </th>
    );
  };

  const cellFor = (kk: ColKey, r: AssetRow, ctx: { loaded: boolean; up: boolean; p7: number | null; s: number[] }) => {
    const { loaded, up, p7 } = ctx;
    switch (kk) {
      case 'name': return (
        <td key={kk} className="py-2.5 px-4">
          <div className="flex items-center gap-2.5">
            <AssetIcon r={r} />
            <span className="text-body font-semibold text-[color:var(--text)]">{r.name}</span>
            <span className="font-mono text-label text-[color:var(--text-3)] bg-[color:var(--bg)] border border-[color:var(--line)] px-1.5 py-0.5 rounded-sm">{r.symbol.replace('^', '')}</span>
          </div>
        </td>
      );
      case 'price': return <td key={kk} className="py-2.5 px-4 text-right font-mono text-data text-[color:var(--text)]">{loaded ? fmtPrice(r.price, r.currency) : '—'}</td>;
      case 'changePct': return (
        <td key={kk} className={`py-2.5 px-4 text-right text-data ${loaded ? (up ? 'up' : 'down') : 'text-[color:var(--text-3)]'}`}>
          {loaded ? <Delta pct={r.changePct} /> : '—'}
        </td>
      );
      case 'sevenD': return (
        <td key={kk} className={`py-2.5 px-4 text-right text-data hidden md:table-cell ${p7 !== null ? (p7 >= 0 ? 'up' : 'down') : 'text-[color:var(--text-3)]'}`}>
          {p7 !== null ? <span className="font-mono">{fmtPct(p7)}</span> : '—'}
        </td>
      );
      case 'volume': return (
        <td key={kk} className="py-2.5 px-4 text-right font-mono text-data text-[color:var(--text-2)] hidden lg:table-cell">
          {r.turnover ? (
            <div className="flex flex-col items-end leading-tight">
              <span>{fmtCompact(r.turnover)} {r.currency}</span>
              <span className="text-label text-[color:var(--text-3)]">{fmtCompact(r.volume || 0)} {r.symbol.replace('^', '')}</span>
            </div>
          ) : r.volume ? fmtCompact(r.volume) : '—'}
        </td>
      );
      case 'marketCap': return (
        <td key={kk} className="py-2.5 px-4 text-right font-mono text-data text-[color:var(--text-2)] hidden sm:table-cell">
          {r.marketCap ? fmtCap(r.marketCap, r.currency) : '—'}
        </td>
      );
      case 'circulating': return (
        <td key={kk} className="py-2.5 px-4 text-right font-mono text-data text-[color:var(--text-2)] hidden lg:table-cell">
          {r.circulating ? `${fmtCompact(r.circulating)} ${r.symbol.replace('^', '')}` : '—'}
        </td>
      );
      case 'spark': return (
        <td key={kk} className="py-2.5 px-4 text-right hidden md:table-cell">
          <div className="flex items-center justify-end gap-3 relative">
            <div className="w-24 h-8 transition-opacity group-hover:opacity-0 flex items-center justify-end">
              <MiniSpark data={ctx.s} />
            </div>
            <div className="absolute inset-0 flex items-center justify-end opacity-0 group-hover:opacity-100 transition-opacity">
              <button
                onClick={(e) => { e.stopPropagation(); onAssetSelect(r.symbol); }}
                className="bg-[color:var(--accent)] text-[color:var(--accent-ink)] hover:brightness-110 px-3 py-1 rounded-sm text-label font-semibold transition-colors shiny chrome cta-glow press"
                style={{ letterSpacing: '0.06em' }}
              >
                TRADE
              </button>
            </div>
          </div>
        </td>
      );
      default: {
        // TNV-7 chooser columns — honest '—' when the source lacks the datum.
        const sym = r.symbol.replace('^', '');
        const rf = refMap[sym]; const fu = fundMap[sym]; const en = engineMap[sym]; const oh = ohlMap[sym];
        const f = COLMETA[kk];
        const dash = <span className="text-[color:var(--text-3)]">—</span>;
        let body: React.ReactNode = dash;
        const numTd = (n: number | null | undefined, fmt: (x: number) => React.ReactNode) =>
          (typeof n === 'number' && isFinite(n) ? fmt(n) : dash);
        switch (kk) {
          case 'sector': body = rf?.sector ? <span className="text-[color:var(--text-2)] truncate">{rf.sector}</span> : dash; break;
          case 'isin': body = (r.isin || rf?.isin) ? <span className="text-[color:var(--text-3)]">{r.isin || rf.isin}</span> : dash; break;
          case 'turnover': body = r.turnover ? <>{fmtCompact(r.turnover)} {r.currency}</> : dash; break;
          case 'open': body = numTd(oh?.open, (v) => fmtPrice(v, r.currency)); break;
          case 'high': body = numTd(oh?.high, (v) => fmtPrice(v, r.currency)); break;
          case 'low': body = numTd(oh?.low, (v) => fmtPrice(v, r.currency)); break;
          case 'per': body = numTd(fu?.per, (v) => v.toFixed(2)); break;
          case 'eps': body = numTd(fu?.eps, (v) => v.toFixed(3)); break;
          case 'pb': body = numTd(fu?.pb, (v) => v.toFixed(2)); break;
          case 'netIncome': body = numTd(fu?.netIncome, (v) => <>{fmtCompact(v)} TND</>); break;
          case 'equity': body = numTd(fu?.equity, (v) => <>{fmtCompact(v)} TND</>); break;
          case 'divYield': body = numTd(fu?.yield, (v) => `${v.toFixed(2)}%`); break;
          case 'engScore': body = numTd(en?.score, (v) => <span className={v >= 60 ? 'up' : v <= 40 ? 'down' : 'text-[color:var(--text-2)]'}>{v}</span>); break;
          case 'engLabel': body = en?.label ? <span className={en.label === 'bullish' ? 'up' : en.label === 'bearish' ? 'down' : 'text-[color:var(--text-2)]'}>{en.label}</span> : dash; break;
          case 'fMomentum': body = numTd(en?.factors?.momentum?.score, (v) => v); break;
          case 'fVolume': body = numTd(en?.factors?.volume?.score, (v) => v); break;
          case 'fNews': body = numTd(en?.factors?.news?.score, (v) => v); break;
          case 'fLiqTrend': body = (en?.factors?.liquidity || en?.factors?.trend)
            ? <>{en.factors.liquidity?.score ?? '—'}/{en.factors.trend?.score ?? '—'}</> : dash; break;
        }
        return <td key={kk} className={`py-2.5 px-4 font-mono text-data text-[color:var(--text-2)] ${f.cls}`}>{body}</td>;
      }
    }
  };

  const view = useMemo(() => {
    const q = query.toLowerCase();
    const filtered = baseRows.filter(
      (r) =>
        (!watchOnly || watchlist.includes(r.symbol)) &&
        (r.symbol.toLowerCase().includes(q) || r.name.toLowerCase().includes(q)),
    );
    const dir = sort.dir === 'asc' ? 1 : -1;
    return filtered.sort((a, b) => {
      if (sort.key === 'name') return a.name.localeCompare(b.name) * dir;
      return (((a[sort.key] as number) || 0) - ((b[sort.key] as number) || 0)) * dir;
    });
  }, [baseRows, query, sort, watchOnly, watchlist]);

  const totalPages = Math.max(1, Math.ceil(view.length / perPage));
  const pageView = view.slice((page - 1) * perPage, page * perPage);

  // TNV-7: lazy-load a group's data only when ≥1 of its columns is visible.
  const visibleSet = new Set(visibleCols);
  const needRef = isTN && (visibleSet.has('sector') || visibleSet.has('isin'));
  const needFund = isTN && ['per', 'eps', 'pb', 'netIncome', 'equity', 'divYield'].some((k) => visibleSet.has(k as ColKey));
  const needOHL = isTN && (visibleSet.has('open') || visibleSet.has('high') || visibleSet.has('low'));
  const needEngine = isTN && ['engScore', 'engLabel', 'fMomentum', 'fVolume', 'fNews', 'fLiqTrend'].some((k) => visibleSet.has(k as ColKey));
  useEffect(() => {
    if (!needRef || Object.keys(refMap).length) return;
    fetch('/api/tn/ref').then((r) => r.json()).then((d) => setRefMap(d?.ref || {})).catch(() => {});
  }, [needRef, refMap]);
  useEffect(() => {
    if (!needFund || Object.keys(fundMap).length) return;
    fetch('/api/tn/fundamentals').then((r) => r.json()).then((d) => setFundMap(d?.fundamentals || {})).catch(() => {});
  }, [needFund, fundMap]);
  useEffect(() => {
    if (!needOHL) return;
    const miss = pageView.map((r) => r.symbol).filter((s) => !(s in ohlMap));
    if (!miss.length) return;
    let alive = true;
    Promise.all(miss.map((s) =>
      fetch(`/api/tn/intraday?symbol=${encodeURIComponent(s)}`).then((r) => r.json()).then((d) => {
        const cs = d?.candles || [];
        if (!cs.length) return null;
        return [s, { open: cs[0].open, high: Math.max(...cs.map((c: any) => c.high)), low: Math.min(...cs.map((c: any) => c.low)) }] as const;
      }).catch(() => null),
    )).then((rows) => {
      if (!alive) return;
      const add = Object.fromEntries(rows.filter(Boolean) as [string, any][]);
      if (Object.keys(add).length) setOhlMap((p) => ({ ...p, ...add }));
    });
    return () => { alive = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [needOHL, page, perPage, query, sort.key, sort.dir]);
  useEffect(() => {
    if (!needEngine) return;
    const miss = pageView.map((r) => r.symbol).filter((s) => !(s in engineMap));
    if (!miss.length) return;
    let alive = true;
    Promise.all(miss.map((s) =>
      fetch(`/api/tn/engine?symbol=${encodeURIComponent(s)}`).then((r) => r.json()).then((d) => (d?.score != null ? [s, d] as const : null)).catch(() => null),
    )).then((rows) => {
      if (!alive) return;
      const add = Object.fromEntries(rows.filter(Boolean) as [string, any][]);
      if (Object.keys(add).length) setEngineMap((p) => ({ ...p, ...add }));
    });
    return () => { alive = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [needEngine, page, perPage, query, sort.key, sort.dir]);

  // Paged: fetch quotes for the visible page.
  useEffect(() => {
    if (!paged || pageView.length === 0) return;
    let alive = true;
    const need = pageView.map((r) => ({ symbol: r.symbol, name: r.name }));
    fetchQuotes(need).then((qs) => {
      if (!alive) return;
      setQuotes((p) => { const n = { ...p }; qs.forEach((q) => (n[q.symbol] = q)); return n; });
    });
    return () => { alive = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [paged, page, query, sort.key, sort.dir, perPage]);

  // Sparklines for the visible page. TN closes arrive bundled with the row fetch
  // (fetchTunisia → /api/tn/board); Yahoo sources need a separate batch request.
  useEffect(() => {
    if (market.source !== 'tunisia' || pageView.length === 0) return;
    const next: Record<string, number[]> = {};
    for (const r of pageView) if (r.sevenDayCloses?.length) next[r.symbol] = r.sevenDayCloses;
    if (Object.keys(next).length) setSparks((p) => ({ ...p, ...next }));
  }, [market.source, pageView]);

  useEffect(() => {
    if (market.source !== 'yahoo' || !showSpark || pageView.length === 0) return;
    let alive = true;
    const need = pageView.map((r) => r.symbol).filter((s) => !(s in sparks));
    if (!need.length) return;
    fetchSparks(need).then((m) => {
      if (alive && Object.keys(m).length) setSparks((p) => ({ ...p, ...m }));
    });
    return () => { alive = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [showSpark, page, query, sort.key, sort.dir, perPage, market.id, loading]);

  const toggleSort = (key: SortKey) =>
    setSort((p) => ({ key, dir: p.key === key && p.dir === 'desc' ? 'asc' : 'desc' }));

  // Stats + highlights from whatever is quoted so far.
  const loadedRows = (paged ? Object.values(quotes) : fullRows).filter((r) => r.price > 0);
  const gainers = [...loadedRows].sort((a, b) => b.changePct - a.changePct);
  const losers = [...loadedRows].sort((a, b) => a.changePct - b.changePct);
  const active = [...loadedRows].sort((a, b) => (b.volume || 0) - (a.volume || 0));
  // TN breakout monitor: stocks within 2% of their ~5-month high (≥20d history).
  const nearHighs = market.id === 'tunisia'
    ? loadedRows
        .filter((r) => r.isin && tnHighs[r.isin] && tnHighs[r.isin].highRatio >= 0.98)
        .sort((a, b) => tnHighs[b.isin!].highRatio - tnHighs[a.isin!].highRatio)
    : [];
  const nUp = loadedRows.filter((r) => r.changePct > 0).length;
  const nDown = loadedRows.filter((r) => r.changePct < 0).length;

  const Stat = ({ label, value }: { label: string; value: React.ReactNode }) => (
    <div className="flex items-baseline gap-1.5">
      <span className="label">{label}</span>
      <span className="font-mono text-data text-[color:var(--text)]">{value}</span>
    </div>
  );

  return (
    <div className="flex-1 bg-[color:var(--bg)] overflow-y-auto">
      {/* Market stats bar (mirrors the crypto global bar) */}
      <div className="border-b border-[color:var(--line)] bg-[color:var(--surface)] px-4 py-2 flex flex-wrap items-center gap-x-5 gap-y-1">
        <Stat label="ASSETS" value={market.symbols.length || loadedRows.length} />
        <span className="w-px h-3 bg-[color:var(--line)]" />
        <Stat label="GAINERS" value={<span className="up">{nUp}</span>} />
        <Stat label="LOSERS" value={<span className="down">{nDown}</span>} />
        <span className="w-px h-3 bg-[color:var(--line)]" />
        <div className="flex items-center gap-1.5">
          <Activity className="w-3 h-3 text-[color:var(--text-3)]" />
          <Stat label="UNIT" value={market.currency} />
        </div>
      </div>

      <div className="max-w-[1280px] mx-auto px-4 py-4">
        {/* Header */}
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-3 mb-4">
          <div className="flex items-center gap-3">
            <button
              onClick={onBack}
              className="w-8 h-8 rounded-sm flex items-center justify-center text-[color:var(--text-3)] hover:text-[color:var(--text)] hover:bg-[color:var(--surface-2)] transition-colors"
              title="Back to markets"
            >
              <ArrowLeft className="w-4 h-4" />
            </button>
            <div className="section-mark" data-mark="001 / MARKETS">
              <h2 className="text-h2 font-display font-semibold text-[color:var(--text)] tracking-tight leading-[0.95]">
                {market.label} <span className="text-[color:var(--text-3)] italic font-normal">Prices &amp; Movers</span>
              </h2>
              <p className="text-body text-[color:var(--text-3)] mt-1.5">{market.blurb}</p>
            </div>
          </div>
          <div className="relative">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-[color:var(--text-3)]" />
            <input
              type="text"
              placeholder="Search assets..."
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              className="bg-[color:var(--surface)] border border-[color:var(--line)] text-[color:var(--text)] placeholder:text-[color:var(--text-3)] text-body pl-8 pr-3 py-1.5 rounded-sm focus:outline-none focus:border-[color:var(--line-strong)] w-full md:w-72 transition-colors"
            />
          </div>
        </div>

        {market.id === 'tunisia' && (
          <div className="mb-3 flex items-center gap-2 text-label text-[color:var(--text-3)] bg-[color:var(--surface)] border border-[color:var(--line)] rounded-sm px-3 py-2">
            <AlertTriangle className="w-3.5 h-3.5 text-[color:var(--accent)]" />
            Live from the BVMT feed — quotes (15-min cache) and the official TUNINDEX.
          </div>
        )}

        {/* Live indices + market breadth (official BVMT feed) */}
        {market.id === 'tunisia' && !query && !watchOnly && <TnMarketOverview />}

        {/* Highlights */}
        {!query && !watchOnly && (
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3 mb-4 stagger">
            <HighlightCard title="TOP GAINERS" icon={Trophy} data={gainers} onSelect={onAssetSelect} />
            <HighlightCard title="TOP LOSERS" icon={TrendingDown} data={losers} onSelect={onAssetSelect} />
            {market.id === 'tunisia' && nearHighs.length > 0
              ? <HighlightCard title="NEAR HIGHS" icon={TrendingUp} data={nearHighs} onSelect={onAssetSelect} />
              : <HighlightCard title="MOST ACTIVE" icon={Activity} data={hasVol ? active : gainers.slice(3)} onSelect={onAssetSelect} />}
          </div>
        )}

        {/* Tabs (mirrors the crypto tab bar) */}
        <div className="flex items-center gap-0 mb-0 border-b border-[color:var(--line)]">
          {([
            { id: false, label: market.label },
            { id: true, label: `Watchlist (${watchlist.length})` },
          ] as { id: boolean; label: string }[]).map((tab) => {
            const isActive = watchOnly === tab.id;
            return (
              <button
                key={String(tab.id)}
                onClick={() => setWatchOnly(tab.id)}
                className={`relative px-3 py-2 text-body font-medium whitespace-nowrap transition-colors ${
                  isActive ? 'text-[color:var(--text)]' : 'text-[color:var(--text-3)] hover:text-[color:var(--text-2)]'
                }`}
              >
                <div className="flex items-center gap-1.5">
                  {tab.id && <Star className={`w-3.5 h-3.5 ${isActive ? 'text-[color:var(--accent)]' : ''}`} />}
                  {tab.label}
                </div>
                {isActive && <span className="absolute bottom-0 left-0 right-0 h-px bg-[color:var(--accent)]" />}
              </button>
            );
          })}
          {market.id === 'tunisia' && (
            <button
              onClick={() => setShowCompare(true)}
              className="press ml-auto mb-1 flex items-center gap-1.5 px-3 py-1.5 rounded-sm text-body font-medium text-[color:var(--text-3)] hover:text-[color:var(--text)] hover:bg-[color:var(--surface-2)] transition-colors"
            >
              <ArrowUpDown className="w-3.5 h-3.5" /> Compare
            </button>
          )}
        </div>

        {/* Table */}
        <div className="bg-[color:var(--surface)] border border-t-0 border-[color:var(--line)] overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse whitespace-nowrap">
              <thead>
                <tr className="border-b border-[color:var(--line)] bg-[color:var(--surface-2)]">
                  <th className="py-2 px-4 w-8" />
                  <th className="py-2 px-4 label w-10 hidden sm:table-cell">#</th>
                  {visibleCols.map(headerFor)}
                  {isTN && (
                    <th className="py-2 px-4 w-10 relative">
                      <button onClick={() => setColMenu((v) => !v)} title="Edit columns" className="flex items-center justify-center w-6 h-6 rounded-sm text-[color:var(--text-3)] hover:text-[color:var(--text)] hover:bg-[color:var(--surface)] transition-colors ml-auto">
                        <Plus className="w-3.5 h-3.5" />
                      </button>
                      {colMenu && (() => {
                        const closeMenu = () => { setColMenu(false); setOpenGroup(null); setColSearch(''); };
                        const isVis = (k: ColKey) => availableCol(k) && !tnHidden[k];
                        const toggleCol = (k: ColKey) => {
                          if (isVis(k) && visibleCols.length <= 1) return; // keep ≥1
                          setTnHidden((p) => ({ ...p, [k]: !p[k] }));
                        };
                        const colRow = (c: { k: ColKey; label: string }) => (
                          <button key={c.k} onClick={() => toggleCol(c.k)} className="w-full flex items-center gap-2 px-3 py-1.5 text-body font-normal text-[color:var(--text-2)] hover:bg-[color:var(--surface-2)] transition-colors">
                            <span className={`w-3.5 h-3.5 rounded-sm border flex items-center justify-center shrink-0 ${isVis(c.k) ? 'bg-[color:var(--accent)] border-[color:var(--accent)]' : 'border-[color:var(--line-strong)]'}`}>
                              {isVis(c.k) && <Check className="w-2.5 h-2.5 text-[color:var(--accent-ink)]" />}
                            </span>
                            {c.label}
                          </button>
                        );
                        const searchBox = (
                          <div className="px-2 pb-1.5">
                            <input value={colSearch} onChange={(e) => setColSearch(e.target.value)} placeholder="Search"
                              className="w-full bg-[color:var(--bg)] border border-[color:var(--line)] text-[color:var(--text)] placeholder:text-[color:var(--text-3)] text-body font-normal px-2 py-1 rounded-sm focus:outline-none focus:border-[color:var(--line-strong)]" />
                          </div>
                        );
                        const grp = openGroup ? TN_COL_GROUPS.find((g) => g.label === openGroup) : null;
                        return (
                          <>
                            <div className="fixed inset-0 z-40" onClick={closeMenu} />
                            <div className="absolute right-4 top-full mt-1 z-50 w-60 max-h-80 overflow-y-auto bg-[color:var(--surface)] border border-[color:var(--line)] rounded-sm shadow-xl py-1 text-left normal-case">
                              {grp ? (
                                <>
                                  <button onClick={() => { setOpenGroup(null); setColSearch(''); }} className="w-full flex items-center gap-1.5 px-3 py-1.5 text-body font-semibold text-[color:var(--text)] hover:bg-[color:var(--surface-2)] transition-colors">
                                    <ChevronLeft className="w-3.5 h-3.5" /> {grp.label}
                                  </button>
                                  {searchBox}
                                  {grp.cols.filter((c) => c.label.toLowerCase().includes(colSearch.toLowerCase())).map(colRow)}
                                </>
                              ) : (
                                <>
                                  <div className="label px-3 py-1.5 text-[color:var(--text-3)]">Columns</div>
                                  {searchBox}
                                  {colSearch
                                    ? TN_COL_GROUPS.flatMap((g) => g.cols).filter((c) => c.label.toLowerCase().includes(colSearch.toLowerCase())).map(colRow)
                                    : TN_COL_GROUPS.map((g) => {
                                        const GIcon = g.icon;
                                        return (
                                          <button key={g.label} onClick={() => { setOpenGroup(g.label); setColSearch(''); }} className="w-full flex items-center gap-2 px-3 py-1.5 text-body font-normal text-[color:var(--text-2)] hover:bg-[color:var(--surface-2)] transition-colors">
                                            <GIcon className="w-3.5 h-3.5 text-[color:var(--text-3)]" />
                                            <span className="flex-1 text-left">{g.label}</span>
                                            <span className="font-mono text-label text-[color:var(--text-3)]">{g.cols.length}</span>
                                          </button>
                                        );
                                      })}
                                  {!colSearch && (
                                    <>
                                      <div className="h-px bg-[color:var(--line)] my-1" />
                                      <button onClick={() => { setTnHidden(Object.fromEntries([...TN_ONLY_KEYS].map((k) => [k, true]))); setTnOrder(DEFAULT_ORDER); }} className="w-full px-3 py-1.5 text-body font-normal text-left text-[color:var(--text-3)] hover:text-[color:var(--text)] hover:bg-[color:var(--surface-2)] transition-colors">
                                        Reset columns
                                      </button>
                                    </>
                                  )}
                                </>
                              )}
                            </div>
                          </>
                        );
                      })()}
                    </th>
                  )}
                </tr>
              </thead>
              <tbody>
                {loading ? (
                  Array.from({ length: 10 }).map((_, i) => (
                    <tr key={i} className="border-b border-[color:var(--line)]">
                      <td className="py-3 px-4"><div className="w-3.5 h-3.5 rounded-sm bg-[color:var(--surface-2)] animate-pulse" /></td>
                      <td className="py-3 px-4 hidden sm:table-cell"><div className="h-3 w-4 rounded bg-[color:var(--surface-2)] animate-pulse" /></td>
                      {visibleCols.map((k) => (
                        <td key={k} className={`py-3 px-4 ${COLMETA[k].cls}`}>
                          {k === 'name'
                            ? <div className="flex items-center gap-2.5"><div className="w-6 h-6 rounded-full bg-[color:var(--surface-2)] animate-pulse" /><div className="h-3 w-40 rounded bg-[color:var(--surface-2)] animate-pulse" /></div>
                            : k === 'spark'
                            ? <div className="h-6 w-24 rounded bg-[color:var(--surface-2)] animate-pulse ml-auto" />
                            : <div className="h-3 w-16 rounded bg-[color:var(--surface-2)] animate-pulse ml-auto" />}
                        </td>
                      ))}
                    </tr>
                  ))
                ) : error ? (
                  <tr><td colSpan={nColSpan} className="py-10 text-center">
                    <div className="text-body text-[color:var(--text-3)] mb-2">Couldn't load {market.label}.</div>
                    <button onClick={() => { setError(false); setLoading(true); setReloadKey((k) => k + 1); }} className="px-3 py-1.5 rounded-sm text-label font-semibold bg-[color:var(--surface-2)] border border-[color:var(--line)] text-[color:var(--text-2)] hover:text-[color:var(--text)] hover:border-[color:var(--line-strong)] transition-colors">RETRY</button>
                  </td></tr>
                ) : pageView.length === 0 ? (
                  <tr><td colSpan={nColSpan} className="py-10 text-center text-body text-[color:var(--text-3)]">
                    {watchOnly ? 'Your watchlist is empty. Star assets to add them.' : 'No assets found.'}
                  </td></tr>
                ) : (
                  pageView.map((r, i) => {
                    const loaded = r.price > 0;
                    const up = r.changePct >= 0;
                    const isExpanded = expanded === r.symbol;
                    const p7 = pct7d(r);
                    const s = sparks[r.symbol] || [];
                    const prevClose = loaded ? r.price / (1 + r.changePct / 100) : null;
                    return (
                      <React.Fragment key={r.symbol}>
                      <tr
                        onClick={() => setExpanded(isExpanded ? null : r.symbol)}
                        className={`border-b border-[color:var(--line)] hover:bg-[color:var(--surface-2)] cursor-pointer transition-colors group ${isExpanded ? 'bg-[color:var(--surface-2)]' : ''}`}
                      >
                        <td className="py-2.5 px-4" onClick={(e) => toggleWatch(e, r.symbol)}>
                          <Star className={`w-3.5 h-3.5 transition-colors ${watchlist.includes(r.symbol) ? 'text-[color:var(--accent)] fill-[color:var(--accent)]' : 'text-[color:var(--text-3)] hover:text-[color:var(--text)]'}`} />
                        </td>
                        <td className="py-2.5 px-4 font-mono text-data text-[color:var(--text-3)] hidden sm:table-cell">
                          {(page - 1) * perPage + i + 1}
                        </td>
                        {visibleCols.map((k) => cellFor(k, r, { loaded, up, p7, s }))}
                      </tr>

                      <AnimatePresence>
                        {isExpanded && (
                          <motion.tr
                            initial={{ opacity: 0 }}
                            animate={{ opacity: 1 }}
                            exit={{ opacity: 0 }}
                            className="bg-[color:var(--bg)] border-b border-[color:var(--line)]"
                          >
                            <td colSpan={nColSpan} className="p-0">
                              <div className="p-4 grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
                                <div className="space-y-3">
                                  <div className="flex items-center gap-2.5">
                                    <AssetIcon r={r} />
                                    <div>
                                      <h3 className="text-h4 font-display font-semibold text-[color:var(--text)]">{r.name}</h3>
                                      <div className="flex items-center gap-1.5">
                                        <span className="label">RANK #{(page - 1) * perPage + i + 1}</span>
                                        <span className="font-mono text-label text-[color:var(--text-3)]">{r.symbol.replace('^', '')}</span>
                                      </div>
                                    </div>
                                  </div>
                                  <button
                                    onClick={(e) => { e.stopPropagation(); onAssetSelect(r.symbol); }}
                                    className="flex items-center gap-1.5 bg-[color:var(--accent)] text-[color:var(--accent-ink)] hover:brightness-110 px-3 py-1.5 rounded-sm text-label font-semibold transition-colors shiny chrome cta-glow press"
                                    style={{ letterSpacing: '0.04em' }}
                                  >
                                    <BarChart2 className="w-3.5 h-3.5" />
                                    ADVANCED CHART
                                  </button>
                                </div>

                                <div className="space-y-2">
                                  <div>
                                    <div className="label mb-0.5">PRICE</div>
                                    <div className="font-mono text-data text-[color:var(--text)]">{loaded ? fmtPrice(r.price, r.currency) : '—'}</div>
                                  </div>
                                  <div>
                                    <div className="label mb-0.5">PREV CLOSE</div>
                                    <div className="font-mono text-data text-[color:var(--text)]">{prevClose ? fmtPrice(prevClose, r.currency) : '—'}</div>
                                  </div>
                                  <div>
                                    <div className="label mb-0.5">DAY CHANGE</div>
                                    <div className="font-mono text-data">{loaded ? <Delta pct={r.changePct} /> : '—'}</div>
                                  </div>
                                </div>

                                <div className="space-y-2">
                                  <div>
                                    <div className="label mb-0.5">MARKET CAP</div>
                                    <div className="font-mono text-data text-[color:var(--text)]">{r.marketCap ? fmtCap(r.marketCap, r.currency) : '—'}</div>
                                  </div>
                                  <div>
                                    <div className="label mb-0.5">VOLUME</div>
                                    <div className="font-mono text-data text-[color:var(--text)]">{r.volume ? fmtCompact(r.volume) : '—'}</div>
                                  </div>
                                  <div>
                                    <div className="label mb-0.5">7D RANGE</div>
                                    <div className="font-mono text-data text-[color:var(--text)]">
                                      {s.length > 1 ? `${fmtPrice(Math.min(...s), r.currency)} — ${fmtPrice(Math.max(...s), r.currency)}` : '—'}
                                    </div>
                                  </div>
                                </div>

                                <div className="space-y-2">
                                  <div className="label mb-1">LINKS</div>
                                  <div className="flex flex-wrap gap-1.5">
                                    {assetLinks(market, r).map((l) => (
                                      <a
                                        key={l.label}
                                        href={safeUrl(l.url)}
                                        target="_blank"
                                        rel="noopener noreferrer"
                                        onClick={(e) => e.stopPropagation()}
                                        className="flex items-center gap-1 text-label font-semibold bg-[color:var(--surface-2)] hover:bg-[color:var(--surface)] text-[color:var(--text-2)] border border-[color:var(--line)] hover:border-[color:var(--line-strong)] px-2 py-1 rounded-sm transition-colors"
                                        style={{ letterSpacing: '0.04em' }}
                                      >
                                        {l.label} <ExternalLink className="w-2.5 h-2.5" />
                                      </a>
                                    ))}
                                  </div>
                                </div>
                              </div>
                            </td>
                          </motion.tr>
                        )}
                      </AnimatePresence>
                      </React.Fragment>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>

          {/* Pagination (crypto-style footer) */}
          {!loading && !error && view.length > 0 && (
            <div className="flex flex-col sm:flex-row items-center justify-between px-4 py-2.5 border-t border-[color:var(--line)] gap-3">
              <div className="flex items-center gap-3 text-body text-[color:var(--text-3)]">
                <div>
                  Showing <span className="font-mono text-[color:var(--text)]">{(page - 1) * perPage + 1}</span>–<span className="font-mono text-[color:var(--text)]">{Math.min(page * perPage, view.length)}</span> of <span className="font-mono text-[color:var(--text)]">{view.length}</span>
                </div>
                <div className="flex items-center gap-1.5">
                  <span className="label">ROWS</span>
                  <select
                    value={perPage}
                    onChange={(e) => setPerPage(Number(e.target.value))}
                    className="bg-[color:var(--bg)] border border-[color:var(--line)] text-[color:var(--text)] font-mono text-data rounded-sm px-1.5 py-0.5 focus:outline-none focus:border-[color:var(--line-strong)]"
                  >
                    <option value={25}>25</option>
                    <option value={50}>50</option>
                    <option value={100}>100</option>
                  </select>
                </div>
              </div>
              {totalPages > 1 && (
                <div className="flex items-center gap-1">
                  <button
                    onClick={() => setPage((p) => Math.max(1, p - 1))}
                    disabled={page === 1}
                    className="px-2.5 py-1 rounded-sm bg-[color:var(--bg)] border border-[color:var(--line)] text-[color:var(--text-2)] disabled:opacity-40 disabled:cursor-not-allowed hover:border-[color:var(--line-strong)] hover:text-[color:var(--text)] transition-colors text-label font-semibold"
                  >
                    PREV
                  </button>
                  <span className="px-2 font-mono text-data text-[color:var(--text-3)]">{page} / {totalPages}</span>
                  <button
                    onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                    disabled={page === totalPages}
                    className="px-2.5 py-1 rounded-sm bg-[color:var(--bg)] border border-[color:var(--line)] text-[color:var(--text-2)] disabled:opacity-40 disabled:cursor-not-allowed hover:border-[color:var(--line-strong)] hover:text-[color:var(--text)] transition-colors text-label font-semibold"
                  >
                    NEXT
                  </button>
                </div>
              )}
            </div>
          )}
        </div>
      </div>
      {showCompare && (
        <TnComparator
          onClose={() => setShowCompare(false)}
          onOpenAsset={(s) => { setShowCompare(false); onAssetSelect(s); }}
        />
      )}
    </div>
  );
};
