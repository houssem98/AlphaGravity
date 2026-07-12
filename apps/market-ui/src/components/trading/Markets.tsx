import React, { useState, useEffect } from 'react';
import { Search, TrendingUp, TrendingDown, Star, ArrowUpDown, ExternalLink, BarChart2, Flame, Trophy, AlertTriangle, Activity, ChevronRight, ChevronDown, ChevronLeft, ArrowUp, ArrowDown, Plus, Check, Info, Database, Gauge } from 'lucide-react';
import { Sparkline } from './Sparkline';
import { motion, AnimatePresence } from 'motion/react';
import { CategoriesTab, ExchangesTab, NFTsTab, ConverterTab } from './MarketsTabs';

interface MarketData {
  id: string;
  symbol: string;
  name: string;
  rank: number;
  priceUsd: string;
  changePercent1Hr: string;
  changePercent24Hr: string;
  changePercent7d: string;
  marketCapUsd: string;
  volumeUsd24Hr: string;
  csupply: string;
  tsupply: string;
  msupply: string;
  // additive fields, present only when the server used CoinGecko (CS-2)
  image?: string;
  ath?: string;
  athChangePct?: string;
  changePercent14d?: string;
  changePercent30d?: string;
  changePercent1y?: string;
  fdvUsd?: string;
}

interface MarketsProps {
  onAssetSelect: (asset: string) => void;
}

const formatCurrency = (num: string | number) => {
  const n = typeof num === 'string' ? parseFloat(num) : num;
  if (n < 0.01) return n.toFixed(6);
  if (n < 1) return n.toFixed(4);
  return n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
};

type ColKey = 'rank' | 'change' | 'p14d' | 'p30d' | 'p1y' | 'athVal' | 'athPct' | 'volume'
  | 'marketCap' | 'fdv' | 'volMcap' | 'circulating' | 'tsupply' | 'msupply' | 'spark'
  | 'rating' | 'rsi' | 'ema20' | 'ema50' | 'ema200' | 'sma20' | 'sma50' | 'sma200' | 'macd' | 'bbU' | 'bbL' | 'atr'
  | 'funding' | 'oi' | 'oiVol';

// ?view=derivatives row shape (CS-7 server).
interface DerivData { symbol: string; fundingRate: number | null; oiUsd: number | null }

const DERIV_KEYS: ColKey[] = ['funding', 'oi', 'oiVol'];

// ?view=technicals row shape (CS-5 server).
interface TechData {
  symbol: string; rsi: number | null; ema20: number | null; ema50: number | null; ema200: number | null;
  sma20: number | null; sma50: number | null; sma200: number | null; macd: number | null; macdSignal: number | null;
  bbUpper: number | null; bbLower: number | null; atr: number | null; rating: string | null;
}

const TECH_KEYS: ColKey[] = ['rating', 'rsi', 'ema20', 'ema50', 'ema200', 'sma20', 'sma50', 'sma200', 'macd', 'bbU', 'bbL', 'atr'];

const fmtTech = (n: number | null | undefined) =>
  n == null ? '—' : Math.abs(n) >= 1000 ? n.toLocaleString(undefined, { maximumFractionDigits: 0 }) : Math.abs(n) >= 1 ? n.toFixed(2) : n.toFixed(6);

const COL_GROUPS: { label: string; icon: any; cols: { k: ColKey; label: string }[] }[] = [
  { label: 'Coin info', icon: Info, cols: [{ k: 'rank', label: 'Rank #' }] },
  {
    label: 'Market data', icon: BarChart2, cols: [
      { k: 'change', label: 'Price change %' },
      { k: 'p14d', label: 'Perf % 14d' },
      { k: 'p30d', label: 'Perf % 30d' },
      { k: 'p1y', label: 'Perf % 1y' },
      { k: 'athVal', label: 'All-Time High' },
      { k: 'athPct', label: 'ATH %' },
      { k: 'volume', label: 'Volume (24h)' },
    ],
  },
  {
    label: 'Valuation', icon: Database, cols: [
      { k: 'marketCap', label: 'Market Cap' },
      { k: 'fdv', label: 'Fully Diluted Mcap' },
      { k: 'volMcap', label: 'Vol / Mkt Cap' },
      { k: 'circulating', label: 'Circulating Supply' },
      { k: 'tsupply', label: 'Total Supply' },
      { k: 'msupply', label: 'Max Supply' },
    ],
  },
  {
    label: 'Technicals', icon: Gauge, cols: [
      { k: 'rating', label: 'Tech Rating' },
      { k: 'rsi', label: 'RSI (14)' },
      { k: 'ema20', label: 'EMA (20)' },
      { k: 'ema50', label: 'EMA (50)' },
      { k: 'ema200', label: 'EMA (200)' },
      { k: 'sma20', label: 'SMA (20)' },
      { k: 'sma50', label: 'SMA (50)' },
      { k: 'sma200', label: 'SMA (200)' },
      { k: 'macd', label: 'MACD' },
      { k: 'bbU', label: 'BB Upper' },
      { k: 'bbL', label: 'BB Lower' },
      { k: 'atr', label: 'ATR (14)' },
    ],
  },
  {
    label: 'Derivatives', icon: Flame, cols: [
      { k: 'funding', label: 'Funding Rate' },
      { k: 'oi', label: 'Open Interest' },
      { k: 'oiVol', label: 'OI / Vol (24h)' },
    ],
  },
  { label: 'Chart', icon: Activity, cols: [{ k: 'spark', label: 'Last 7 Days' }] },
];

const DEFAULT_COLS: Record<ColKey, boolean> = {
  rank: true, change: true, p14d: false, p30d: false, p1y: false, athVal: false, athPct: false,
  marketCap: true, fdv: false, volume: true,
  volMcap: false, circulating: true, tsupply: false, msupply: false, spark: true,
  rating: false, rsi: false, ema20: false, ema50: false, ema200: false,
  sma20: false, sma50: false, sma200: false, macd: false, bbU: false, bbL: false, atr: false,
  funding: false, oi: false, oiVol: false,
};

// Column prefs survive reloads (CS-4).
const loadPrefs = (): { tf?: '1h' | '24h' | '7d'; cols?: Partial<Record<ColKey, boolean>> } => {
  try { return JSON.parse(localStorage.getItem('nexus_crypto_cols') || '{}'); } catch { return {}; }
};

// Colored ±% cell for optional string fields ('—' when the fallback source lacks the metric).
const PctVal = ({ v }: { v?: string }) => {
  const n = v === undefined || v === '' ? NaN : parseFloat(v);
  if (!isFinite(n)) return <span className="text-[color:var(--text-3)]">—</span>;
  return <span className={n >= 0 ? 'up' : 'down'}>{n >= 0 ? '+' : '-'}{Math.abs(n).toFixed(2)}%</span>;
};

const HighlightCard = ({ title, icon: Icon, data, onSelect }: { title: string, icon: any, data: MarketData[], type: 'gainer' | 'loser' | 'trending', onSelect: (s: string) => void }) => {
  return (
    <div className="bg-[color:var(--surface)] border border-[color:var(--line)] hover:border-[color:var(--line-strong)] rounded-[4px] p-3 transition-colors lux-border">
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <Icon className="w-3.5 h-3.5 text-[color:var(--accent)]" />
          <span className="label">{title}</span>
        </div>
        <button className="text-label font-semibold text-[color:var(--text-3)] hover:text-[color:var(--text)] flex items-center gap-0.5 transition-colors">
          MORE <ChevronRight className="w-3 h-3" />
        </button>
      </div>

      <div className="space-y-1">
        {data.slice(0, 3).map((coin, idx) => {
          const change = parseFloat(coin.changePercent24Hr);
          const isPositive = change >= 0;
          return (
            <div
              key={coin.id}
              onClick={() => onSelect(coin.symbol)}
              className="flex items-center justify-between px-2 py-1.5 -mx-2 rounded-sm cursor-pointer hover:bg-[color:var(--surface-2)] transition-colors"
            >
              <div className="flex items-center gap-2.5">
                <span className="font-mono text-data text-[color:var(--text-3)] w-3">{idx + 1}</span>
                <img src={coin.image || `https://assets.coincap.io/assets/icons/${coin.symbol.toLowerCase()}@2x.png`} alt={coin.symbol} className="w-5 h-5 rounded-full" onError={(e) => { (e.target as HTMLImageElement).src = 'https://assets.coincap.io/assets/icons/btc@2x.png' }} />
                <div className="flex flex-col leading-tight">
                  <span className="text-data font-semibold text-[color:var(--text)]">{coin.symbol}</span>
                  <span className="text-label text-[color:var(--text-3)] truncate w-20">{coin.name}</span>
                </div>
              </div>
              <div className="flex flex-col items-end leading-tight">
                <span className="font-mono text-data text-[color:var(--text)]">${formatCurrency(coin.priceUsd)}</span>
                <span className={`font-mono text-label flex items-center ${isPositive ? 'up' : 'down'}`}>
                  {isPositive ? <TrendingUp className="w-2.5 h-2.5 mr-0.5" /> : <TrendingDown className="w-2.5 h-2.5 mr-0.5" />}
                  {Math.abs(change).toFixed(2)}%
                </span>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
};

export const Markets: React.FC<MarketsProps> = ({ onAssetSelect }) => {
  const [markets, setMarkets] = useState<MarketData[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');
  const [sortConfig, setSortConfig] = useState<{ key: keyof MarketData, direction: 'asc' | 'desc' }>({ key: 'rank', direction: 'asc' });
  const [activeTab, setActiveTab] = useState<'all' | 'watchlist' | 'categories' | 'portfolio' | 'exchanges' | 'nfts' | 'converter'>('all');
  const [expandedCoin, setExpandedCoin] = useState<string | null>(null);
  const [currentPage, setCurrentPage] = useState(1);
  const [itemsPerPage, setItemsPerPage] = useState(20);
  const [fearAndGreed, setFearAndGreed] = useState<{ value: string, classification: string } | null>(null);
  const [watchlist, setWatchlist] = useState<string[]>(() => {
    const saved = localStorage.getItem('nexus_watchlist');
    return saved ? JSON.parse(saved) : [];
  });
  const [changeTf, setChangeTf] = useState<'1h' | '24h' | '7d'>(() => loadPrefs().tf || '24h');
  const [changeMenu, setChangeMenu] = useState(false);
  const [colMenu, setColMenu] = useState(false);
  const [colSearch, setColSearch] = useState('');
  const [openGroup, setOpenGroup] = useState<string | null>(null);
  const [cols, setCols] = useState<Record<ColKey, boolean>>(() => ({ ...DEFAULT_COLS, ...(loadPrefs().cols || {}) }));
  useEffect(() => {
    localStorage.setItem('nexus_crypto_cols', JSON.stringify({ tf: changeTf, cols }));
  }, [changeTf, cols]);

  useEffect(() => {
    localStorage.setItem('nexus_watchlist', JSON.stringify(watchlist));
  }, [watchlist]);

  const toggleWatchlist = (e: React.MouseEvent, symbol: string) => {
    e.stopPropagation();
    setWatchlist(prev =>
      prev.includes(symbol)
        ? prev.filter(s => s !== symbol)
        : [...prev, symbol]
    );
  };

  useEffect(() => {
    const normalizeCoinlore = (coin: any) => ({
      id: coin.nameid,
      symbol: coin.symbol,
      name: coin.name,
      rank: coin.rank,
      priceUsd: coin.price_usd,
      changePercent1Hr: coin.percent_change_1h || '0',
      changePercent24Hr: coin.percent_change_24h || '0',
      changePercent7d: coin.percent_change_7d || '0',
      marketCapUsd: coin.market_cap_usd || '0',
      volumeUsd24Hr: coin.volume24?.toString() || '0',
      csupply: coin.csupply || '0',
      tsupply: coin.tsupply || '0',
      msupply: coin.msupply || '0',
    });

    const fetchMarkets = async () => {
      try {
        const res = await fetch('/api/crypto/markets');
        if (res.ok) {
          const data = await res.json();
          if (Array.isArray(data) && data.length > 0) {
            setMarkets(data);
            setLoading(false);
            return;
          }
        }
      } catch { /* fall through */ }

      try {
        const res = await fetch('https://api.coinlore.net/api/tickers/?start=0&limit=100');
        const data = await res.json();
        if (data?.data && Array.isArray(data.data)) {
          setMarkets(data.data.map(normalizeCoinlore));
        }
      } catch (error) {
        console.error('Failed to fetch markets:', error);
      } finally {
        setLoading(false);
      }
    };

    const fetchFearAndGreed = async () => {
      try {
        const response = await fetch('https://api.alternative.me/fng/');
        const data = await response.json();
        if (data && data.data && data.data.length > 0) {
          setFearAndGreed({
            value: data.data[0].value,
            classification: data.data[0].value_classification
          });
        }
      } catch (error) {
        console.error('Error fetching fear and greed:', error);
      }
    };

    fetchMarkets();
    fetchFearAndGreed();

    const interval = setInterval(fetchMarkets, 10000);
    return () => clearInterval(interval);
  }, []);

  const formatNumber = (num: string | number) => {
    const n = typeof num === 'string' ? parseFloat(num) : num;
    if (n >= 1e12) return (n / 1e12).toFixed(2) + 'T';
    if (n >= 1e9) return (n / 1e9).toFixed(2) + 'B';
    if (n >= 1e6) return (n / 1e6).toFixed(2) + 'M';
    if (n >= 1e3) return (n / 1e3).toFixed(2) + 'K';
    return n.toFixed(2);
  };

  const handleSort = (key: keyof MarketData) => {
    setSortConfig(prev => ({
      key,
      direction: prev.key === key && prev.direction === 'desc' ? 'asc' : 'desc'
    }));
  };

  const sortedMarkets = [...markets].sort((a, b) => {
    let aValue: any = a[sortConfig.key];
    let bValue: any = b[sortConfig.key];

    if (sortConfig.key === 'name' || sortConfig.key === 'symbol') {
      aValue = (aValue || '').toLowerCase();
      bValue = (bValue || '').toLowerCase();
    } else {
      aValue = parseFloat(aValue || '0');
      bValue = parseFloat(bValue || '0');
    }

    if (aValue < bValue) return sortConfig.direction === 'asc' ? -1 : 1;
    if (aValue > bValue) return sortConfig.direction === 'asc' ? 1 : -1;
    return 0;
  });

  const filteredMarkets = sortedMarkets.filter(m => {
    const matchesSearch = (m.name || '').toLowerCase().includes(searchQuery.toLowerCase()) ||
                          (m.symbol || '').toLowerCase().includes(searchQuery.toLowerCase());
    const matchesTab = activeTab === 'all' || watchlist.includes(m.symbol);
    return matchesSearch && matchesTab;
  });

  const totalPages = Math.ceil(filteredMarkets.length / itemsPerPage);
  const paginatedMarkets = filteredMarkets.slice(
    (currentPage - 1) * itemsPerPage,
    currentPage * itemsPerPage
  );

  // Technicals: fetch for the visible page only, and only when a Technicals
  // column is on. Batches of 25 (server cap) chain via the `tech` dep.
  const [tech, setTech] = useState<Record<string, TechData>>({});
  const techWanted = TECH_KEYS.some((k) => cols[k]);
  const pageSymbols = paginatedMarkets.map((m) => m.symbol).join(',');
  useEffect(() => {
    if (!techWanted || !pageSymbols) return;
    const need = pageSymbols.split(',').filter((s) => s && !(s in tech)).slice(0, 25);
    if (need.length === 0) return;
    let alive = true;
    fetch(`/api/crypto/markets?view=technicals&symbols=${need.join(',')}`)
      .then((r) => r.json())
      .then((rows) => {
        if (!alive || !Array.isArray(rows)) return;
        setTech((p) => { const n = { ...p }; rows.forEach((t: TechData) => { n[t.symbol] = t; }); return n; });
      })
      .catch(() => {});
    return () => { alive = false; };
  }, [techWanted, pageSymbols, tech]);

  // Derivatives: same page-only lazy pattern as technicals.
  const [derivs, setDerivs] = useState<Record<string, DerivData>>({});
  const derivWanted = DERIV_KEYS.some((k) => cols[k]);
  useEffect(() => {
    if (!derivWanted || !pageSymbols) return;
    const need = pageSymbols.split(',').filter((s) => s && !(s in derivs)).slice(0, 25);
    if (need.length === 0) return;
    let alive = true;
    fetch(`/api/crypto/markets?view=derivatives&symbols=${need.join(',')}`)
      .then((r) => r.json())
      .then((rows) => {
        if (!alive || !Array.isArray(rows)) return;
        setDerivs((p) => { const n = { ...p }; rows.forEach((d: DerivData) => { n[d.symbol] = d; }); return n; });
      })
      .catch(() => {});
    return () => { alive = false; };
  }, [derivWanted, pageSymbols, derivs]);

  useEffect(() => {
    setCurrentPage(1);
  }, [searchQuery, activeTab]);

  const totalMarketCap = markets.reduce((sum, m) => sum + parseFloat(m.marketCapUsd || '0'), 0);
  const totalVolume24h = markets.reduce((sum, m) => sum + parseFloat(m.volumeUsd24Hr || '0'), 0);
  const btcData = markets.find(m => m.symbol === 'BTC');
  const ethData = markets.find(m => m.symbol === 'ETH');
  const btcDominance = btcData ? (parseFloat(btcData.marketCapUsd) / totalMarketCap) * 100 : 0;
  const ethDominance = ethData ? (parseFloat(ethData.marketCapUsd) / totalMarketCap) * 100 : 0;

  const topGainers = [...markets].sort((a, b) => parseFloat(b.changePercent24Hr || '0') - parseFloat(a.changePercent24Hr || '0'));
  const topLosers = [...markets].sort((a, b) => parseFloat(a.changePercent24Hr || '0') - parseFloat(b.changePercent24Hr || '0'));
  const trending = [...markets].sort((a, b) => parseFloat(b.volumeUsd24Hr || '0') - parseFloat(a.volumeUsd24Hr || '0'));

  if (loading) {
    return (
      <div className="flex-1 flex items-center justify-center bg-[color:var(--bg)]">
        <div className="label text-[color:var(--text-3)]">LOADING MARKETS...</div>
      </div>
    );
  }

  const Stat = ({ label, value }: { label: string; value: React.ReactNode }) => (
    <div className="flex items-baseline gap-1.5">
      <span className="label">{label}</span>
      <span className="font-mono text-data text-[color:var(--text)]">{value}</span>
    </div>
  );

  const tfKey = ({ '1h': 'changePercent1Hr', '24h': 'changePercent24Hr', '7d': 'changePercent7d' } as const)[changeTf] as keyof MarketData;
  const tfLabel = { '1h': '1h %', '24h': '24h %', '7d': '7d %' }[changeTf];
  const tfLong = { '1h': '1 hour', '24h': '24 hours', '7d': '7 days' } as const;
  const colCount = 4 + Object.values(cols).filter(Boolean).length;
  const sortTh = (k: keyof MarketData, label: string, cls: string) => (
    <th className={`py-2 px-4 label cursor-pointer hover:text-[color:var(--text)] transition-colors group ${cls}`} onClick={() => handleSort(k)}>
      <div className={`flex items-center gap-1 ${cls.includes('text-right') ? 'justify-end' : ''}`}>
        {label}
        <ArrowUpDown className="w-2.5 h-2.5 opacity-0 group-hover:opacity-100 transition-opacity" />
      </div>
    </th>
  );

  return (
    <div className="flex-1 bg-[color:var(--bg)] overflow-y-auto">
      {/* Global market stats bar */}
      <div className="border-b border-[color:var(--line)] bg-[color:var(--surface)] px-4 py-2 flex flex-wrap items-center gap-x-5 gap-y-1">
        <Stat label="CRYPTOS" value={markets.length} />
        <span className="w-px h-3 bg-[color:var(--line)]" />
        <Stat label="MCAP" value={`$${formatNumber(totalMarketCap)}`} />
        <span className="w-px h-3 bg-[color:var(--line)]" />
        <Stat label="24H VOL" value={`$${formatNumber(totalVolume24h)}`} />
        <span className="w-px h-3 bg-[color:var(--line)]" />
        <Stat label="BTC DOM" value={`${btcDominance.toFixed(1)}%`} />
        <Stat label="ETH DOM" value={`${ethDominance.toFixed(1)}%`} />
        <span className="w-px h-3 bg-[color:var(--line)]" />
        <div className="flex items-center gap-1.5">
          <Activity className="w-3 h-3 text-[color:var(--text-3)]" />
          <Stat label="ETH GAS" value="12 GWEI" />
        </div>
        <span className="w-px h-3 bg-[color:var(--line)]" />
        <div className="flex items-center gap-2">
          <AlertTriangle className={`w-3 h-3 ${fearAndGreed ? (parseInt(fearAndGreed.value) > 50 ? 'up' : 'text-[color:var(--accent)]') : 'text-[color:var(--text-3)]'}`} />
          <span className="label">FEAR &amp; GREED</span>
          {fearAndGreed ? (
            <div className="flex items-center gap-2">
              <span className={`font-mono text-data ${parseInt(fearAndGreed.value) > 50 ? 'up' : 'text-[color:var(--accent)]'}`}>
                {fearAndGreed.value}/100
              </span>
              <div className="w-16 h-1 bg-[color:var(--line)] overflow-hidden">
                <div
                  className={parseInt(fearAndGreed.value) > 50 ? 'h-full bg-[color:var(--up)]' : 'h-full bg-[color:var(--accent)]'}
                  style={{ width: `${fearAndGreed.value}%` }}
                />
              </div>
              <span className="label">{fearAndGreed.classification}</span>
            </div>
          ) : (
            <span className="label text-[color:var(--text-4)]">LOADING</span>
          )}
        </div>
      </div>

      <div className="px-4 py-4">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-3 mb-4">
          <div className="section-mark" data-mark="001 / MARKETS">
            <h2 className="text-h2 font-display font-semibold text-[color:var(--text)] tracking-tight leading-[0.95]">
              Cryptocurrency Prices <span className="text-[color:var(--text-3)] italic font-normal">by Market Cap</span>
            </h2>
            <p className="text-body text-[color:var(--text-3)] mt-1.5">
              Global cryptocurrency market cap: <span className="font-mono text-[color:var(--text)]">${formatNumber(totalMarketCap)}</span>
            </p>
          </div>
          <div className="flex items-center gap-2">
            <div className="relative">
              <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-[color:var(--text-3)]" />
              <input
                type="text"
                placeholder="Search assets..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="bg-[color:var(--surface)] border border-[color:var(--line)] text-[color:var(--text)] placeholder:text-[color:var(--text-3)] text-body pl-8 pr-3 py-1.5 rounded-sm focus:outline-none focus:border-[color:var(--line-strong)] w-full md:w-72 transition-colors"
              />
            </div>
            <button className="flex items-center gap-1.5 bg-[color:var(--surface)] border border-[color:var(--line)] hover:border-[color:var(--line-strong)] text-[color:var(--text-2)] text-label font-semibold px-3 py-1.5 rounded-sm transition-colors" style={{ letterSpacing: '0.06em' }}>
              FILTERS
            </button>
            <button className="flex items-center gap-1.5 bg-[color:var(--surface)] border border-[color:var(--line)] hover:border-[color:var(--line-strong)] text-[color:var(--text-2)] text-label font-semibold px-3 py-1.5 rounded-sm transition-colors" style={{ letterSpacing: '0.06em' }}>
              CUSTOMIZE
            </button>
          </div>
        </div>

        {/* Highlights */}
        {!searchQuery && activeTab === 'all' && (
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3 mb-4 stagger">
            <HighlightCard title="TRENDING" icon={Flame} data={trending} type="trending" onSelect={onAssetSelect} />
            <HighlightCard title="TOP GAINERS" icon={Trophy} data={topGainers} type="gainer" onSelect={onAssetSelect} />
            <HighlightCard title="TOP LOSERS" icon={TrendingDown} data={topLosers} type="loser" onSelect={onAssetSelect} />
          </div>
        )}

        {/* Tabs */}
        <div className="flex items-center gap-0 mb-0 border-b border-[color:var(--line)] overflow-x-auto">
          {['all', 'watchlist', 'categories', 'portfolio', 'exchanges', 'nfts', 'converter'].map((tab) => {
            const isActive = activeTab === tab;
            const label = tab === 'watchlist' ? `Watchlist (${watchlist.length})` : tab === 'all' ? 'Cryptocurrencies' : tab;
            return (
              <button
                key={tab}
                onClick={() => setActiveTab(tab as any)}
                className={`relative px-3 py-2 text-body font-medium whitespace-nowrap capitalize transition-colors ${
                  isActive
                    ? 'text-[color:var(--text)]'
                    : 'text-[color:var(--text-3)] hover:text-[color:var(--text-2)]'
                }`}
              >
                <div className="flex items-center gap-1.5">
                  {tab === 'watchlist' && <Star className={`w-3.5 h-3.5 ${isActive ? 'text-[color:var(--accent)]' : ''}`} />}
                  {label}
                </div>
                {isActive && <span className="absolute bottom-0 left-0 right-0 h-px bg-[color:var(--accent)]" />}
              </button>
            );
          })}
        </div>

        {/* Table container */}
        <div className="bg-[color:var(--surface)] border border-t-0 border-[color:var(--line)] overflow-hidden">
          <div className="overflow-x-auto">
            {activeTab === 'categories' ? (
              <CategoriesTab />
            ) : activeTab === 'exchanges' ? (
              <ExchangesTab />
            ) : activeTab === 'nfts' ? (
              <NFTsTab />
            ) : activeTab === 'converter' ? (
              <ConverterTab />
            ) : activeTab === 'portfolio' ? (
              <div className="py-16 text-center">
                <div className="flex flex-col items-center gap-2">
                  <Activity className="w-8 h-8 text-[color:var(--text-3)]" />
                  <h3 className="text-h4 font-display font-semibold text-[color:var(--text)]">Portfolio Coming Soon</h3>
                  <p className="text-body text-[color:var(--text-3)] max-w-sm">
                    Detailed portfolio tracker is in development.
                  </p>
                </div>
              </div>
            ) : (
              <table className="w-full text-left border-collapse whitespace-nowrap">
                <thead>
                  <tr className="border-b border-[color:var(--line)] bg-[color:var(--surface-2)]">
                    <th className="py-2 px-4 label w-8" />
                    {cols.rank && sortTh('rank', '#', 'w-10 hidden sm:table-cell')}
                    {sortTh('name', 'Name', '')}
                    {sortTh('priceUsd', 'Price', 'text-right')}
                    {cols.change && (
                      <th className="py-2 px-4 label text-right relative">
                        <button onClick={() => setChangeMenu((v) => !v)} className="inline-flex items-center gap-1 hover:text-[color:var(--text)] transition-colors ml-auto">
                          {tfLabel}
                          <ChevronDown className="w-2.5 h-2.5" />
                        </button>
                        {changeMenu && (
                          <>
                            <div className="fixed inset-0 z-40" onClick={() => setChangeMenu(false)} />
                            <div className="absolute right-4 top-full mt-1 z-50 w-40 bg-[color:var(--surface)] border border-[color:var(--line)] rounded-sm shadow-xl py-1 text-left normal-case">
                              <div className="label px-3 py-1 text-[color:var(--text-3)]">Price change %</div>
                              {(['1h', '24h', '7d'] as const).map((tf) => (
                                <button key={tf} onClick={() => { setChangeTf(tf); setChangeMenu(false); }} className={`w-full flex items-center gap-2 px-3 py-1.5 text-body hover:bg-[color:var(--surface-2)] transition-colors ${changeTf === tf ? 'text-[color:var(--accent)]' : 'text-[color:var(--text-2)]'}`}>
                                  <span className={`w-1.5 h-1.5 rounded-full ${changeTf === tf ? 'bg-[color:var(--accent)]' : 'border border-[color:var(--line-strong)]'}`} />
                                  {tfLong[tf]}
                                </button>
                              ))}
                              <div className="h-px bg-[color:var(--line)] my-1" />
                              <button onClick={() => { setSortConfig({ key: tfKey, direction: 'asc' }); setChangeMenu(false); }} className="w-full flex items-center gap-2 px-3 py-1.5 text-body text-[color:var(--text-2)] hover:bg-[color:var(--surface-2)] transition-colors"><ArrowUp className="w-3 h-3" /> Sort ascending</button>
                              <button onClick={() => { setSortConfig({ key: tfKey, direction: 'desc' }); setChangeMenu(false); }} className="w-full flex items-center gap-2 px-3 py-1.5 text-body text-[color:var(--text-2)] hover:bg-[color:var(--surface-2)] transition-colors"><ArrowDown className="w-3 h-3" /> Sort descending</button>
                            </div>
                          </>
                        )}
                      </th>
                    )}
                    {cols.marketCap && sortTh('marketCapUsd', 'Market Cap', 'text-right hidden sm:table-cell')}
                    {cols.fdv && <th className="py-2 px-4 label text-right hidden xl:table-cell">Fully Diluted</th>}
                    {cols.volume && sortTh('volumeUsd24Hr', 'Volume (24h)', 'text-right hidden lg:table-cell')}
                    {cols.volMcap && <th className="py-2 px-4 label text-right hidden xl:table-cell">Vol/Mkt Cap</th>}
                    {cols.circulating && sortTh('csupply', 'Circulating', 'text-right hidden xl:table-cell')}
                    {cols.tsupply && sortTh('tsupply', 'Total Supply', 'text-right hidden xl:table-cell')}
                    {cols.msupply && sortTh('msupply', 'Max Supply', 'text-right hidden xl:table-cell')}
                    {cols.p14d && sortTh('changePercent14d', '14d %', 'text-right hidden xl:table-cell')}
                    {cols.p30d && sortTh('changePercent30d', '30d %', 'text-right hidden xl:table-cell')}
                    {cols.p1y && sortTh('changePercent1y', '1y %', 'text-right hidden xl:table-cell')}
                    {cols.athVal && sortTh('ath', 'ATH', 'text-right hidden xl:table-cell')}
                    {cols.athPct && sortTh('athChangePct', 'ATH %', 'text-right hidden xl:table-cell')}
                    {cols.rating && <th className="py-2 px-4 label text-right hidden md:table-cell">Tech Rating</th>}
                    {cols.rsi && <th className="py-2 px-4 label text-right hidden md:table-cell">RSI (14)</th>}
                    {cols.ema20 && <th className="py-2 px-4 label text-right hidden xl:table-cell">EMA (20)</th>}
                    {cols.ema50 && <th className="py-2 px-4 label text-right hidden xl:table-cell">EMA (50)</th>}
                    {cols.ema200 && <th className="py-2 px-4 label text-right hidden xl:table-cell">EMA (200)</th>}
                    {cols.sma20 && <th className="py-2 px-4 label text-right hidden xl:table-cell">SMA (20)</th>}
                    {cols.sma50 && <th className="py-2 px-4 label text-right hidden xl:table-cell">SMA (50)</th>}
                    {cols.sma200 && <th className="py-2 px-4 label text-right hidden xl:table-cell">SMA (200)</th>}
                    {cols.macd && <th className="py-2 px-4 label text-right hidden xl:table-cell">MACD</th>}
                    {cols.bbU && <th className="py-2 px-4 label text-right hidden xl:table-cell">BB Upper</th>}
                    {cols.bbL && <th className="py-2 px-4 label text-right hidden xl:table-cell">BB Lower</th>}
                    {cols.atr && <th className="py-2 px-4 label text-right hidden xl:table-cell">ATR (14)</th>}
                    {cols.funding && <th className="py-2 px-4 label text-right hidden md:table-cell">Funding</th>}
                    {cols.oi && <th className="py-2 px-4 label text-right hidden md:table-cell">Open Interest</th>}
                    {cols.oiVol && <th className="py-2 px-4 label text-right hidden xl:table-cell">OI/Vol</th>}
                    {cols.spark && <th className="py-2 px-4 label text-right hidden md:table-cell">Last 7 Days</th>}
                    <th className="py-2 px-4 w-10 relative">
                      <button onClick={() => setColMenu((v) => !v)} title="Edit columns" className="flex items-center justify-center w-6 h-6 rounded-sm text-[color:var(--text-3)] hover:text-[color:var(--text)] hover:bg-[color:var(--surface)] transition-colors ml-auto">
                        <Plus className="w-3.5 h-3.5" />
                      </button>
                      {colMenu && (() => {
                        const closeMenu = () => { setColMenu(false); setOpenGroup(null); setColSearch(''); };
                        const colRow = (c: { k: ColKey; label: string }) => (
                          <button
                            key={c.k}
                            onClick={() => setCols((p) => ({ ...p, [c.k]: !p[c.k] }))}
                            className="w-full flex items-center gap-2 px-3 py-1.5 text-body font-normal text-[color:var(--text-2)] hover:bg-[color:var(--surface-2)] transition-colors"
                          >
                            <span className={`w-3.5 h-3.5 rounded-sm border flex items-center justify-center shrink-0 ${cols[c.k] ? 'bg-[color:var(--accent)] border-[color:var(--accent)]' : 'border-[color:var(--line-strong)]'}`}>
                              {cols[c.k] && <Check className="w-2.5 h-2.5 text-[color:var(--accent-ink)]" />}
                            </span>
                            {c.label}
                          </button>
                        );
                        const searchBox = (
                          <div className="px-2 pb-1.5">
                            <input
                              value={colSearch}
                              onChange={(e) => setColSearch(e.target.value)}
                              placeholder="Search"
                              className="w-full bg-[color:var(--bg)] border border-[color:var(--line)] text-[color:var(--text)] placeholder:text-[color:var(--text-3)] text-body font-normal px-2 py-1 rounded-sm focus:outline-none focus:border-[color:var(--line-strong)]"
                            />
                          </div>
                        );
                        const grp = openGroup ? COL_GROUPS.find((g) => g.label === openGroup) : null;
                        return (
                          <>
                            <div className="fixed inset-0 z-40" onClick={closeMenu} />
                            <div className="absolute right-4 top-full mt-1 z-50 w-56 max-h-80 overflow-y-auto bg-[color:var(--surface)] border border-[color:var(--line)] rounded-sm shadow-xl py-1 text-left normal-case">
                              {grp ? (
                                <>
                                  {/* Level 2: back header + group columns */}
                                  <button
                                    onClick={() => { setOpenGroup(null); setColSearch(''); }}
                                    className="w-full flex items-center gap-1.5 px-3 py-1.5 text-body font-semibold text-[color:var(--text)] hover:bg-[color:var(--surface-2)] transition-colors"
                                  >
                                    <ChevronLeft className="w-3.5 h-3.5" /> {grp.label}
                                  </button>
                                  {searchBox}
                                  {grp.cols.filter((c) => c.label.toLowerCase().includes(colSearch.toLowerCase())).map(colRow)}
                                </>
                              ) : (
                                <>
                                  {/* Level 1: group list (or flat cross-group results while searching) */}
                                  <div className="label px-3 py-1.5 text-[color:var(--text-3)]">Columns</div>
                                  {searchBox}
                                  {colSearch
                                    ? COL_GROUPS.flatMap((g) => g.cols)
                                        .filter((c) => c.label.toLowerCase().includes(colSearch.toLowerCase()))
                                        .map(colRow)
                                    : COL_GROUPS.map((g) => {
                                        const GIcon = g.icon;
                                        return (
                                          <button
                                            key={g.label}
                                            onClick={() => { setOpenGroup(g.label); setColSearch(''); }}
                                            className="w-full flex items-center gap-2 px-3 py-1.5 text-body font-normal text-[color:var(--text-2)] hover:bg-[color:var(--surface-2)] transition-colors"
                                          >
                                            <GIcon className="w-3.5 h-3.5 text-[color:var(--text-3)]" />
                                            <span className="flex-1 text-left">{g.label}</span>
                                            <span className="font-mono text-label text-[color:var(--text-3)]">{g.cols.length}</span>
                                          </button>
                                        );
                                      })}
                                </>
                              )}
                            </div>
                          </>
                        );
                      })()}
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {paginatedMarkets.length === 0 ? (
                    <tr>
                      <td colSpan={colCount} className="py-10 text-center text-body text-[color:var(--text-3)]">
                        {activeTab === 'watchlist' ? 'Your watchlist is empty. Star assets to add them.' : 'No markets found.'}
                      </td>
                    </tr>
                  ) : (
                    paginatedMarkets.map((market, index) => {
                      const chg = parseFloat((market[tfKey] as string) || '0');
                      const chgPos = chg >= 0;
                      const fdvSupply = parseFloat(market.msupply || '0') || parseFloat(market.tsupply || '0');
                      const mcapNum = parseFloat(market.marketCapUsd || '0');
                      const change7d = parseFloat(market.changePercent7d || '0');
                      const isPositive7d = change7d >= 0;
                      const isStarred = watchlist.includes(market.symbol);
                      const isExpanded = expandedCoin === market.id;

                      return (
                        <React.Fragment key={market.id || index}>
                          <tr
                            className={`border-b border-[color:var(--line)] transition-colors hover:bg-[color:var(--surface-2)] group cursor-pointer ${isExpanded ? 'bg-[color:var(--surface-2)]' : ''}`}
                            onClick={() => setExpandedCoin(isExpanded ? null : market.id)}
                          >
                            <td className="py-2.5 px-4" onClick={(e) => {
                              e.stopPropagation();
                              if (market.symbol) toggleWatchlist(e, market.symbol);
                            }}>
                              <Star className={`w-3.5 h-3.5 transition-colors ${isStarred ? 'text-[color:var(--accent)] fill-[color:var(--accent)]' : 'text-[color:var(--text-3)] hover:text-[color:var(--text)]'}`} />
                            </td>
                            {cols.rank && (
                              <td className="py-2.5 px-4 font-mono text-data text-[color:var(--text-3)] hidden sm:table-cell">
                                {market.rank}
                              </td>
                            )}
                            <td className="py-2.5 px-4">
                              <div className="flex items-center gap-2.5">
                                <img
                                  src={market.image || `https://assets.coincap.io/assets/icons/${(market.symbol || 'btc').toLowerCase()}@2x.png`}
                                  alt={market.name}
                                  className="w-6 h-6 rounded-full border border-[color:var(--line)]"
                                  onError={(e) => {
                                    (e.target as HTMLImageElement).src = 'https://assets.coincap.io/assets/icons/btc@2x.png';
                                  }}
                                />
                                <div className="flex items-center gap-2">
                                  <span className="text-body font-semibold text-[color:var(--text)]">{market.name || 'Unknown'}</span>
                                  <span className="font-mono text-label text-[color:var(--text-3)] bg-[color:var(--bg)] border border-[color:var(--line)] px-1.5 py-0.5 rounded-sm">{market.symbol || '???'}</span>
                                </div>
                              </div>
                            </td>
                            <td className="py-2.5 px-4 text-right font-mono text-data text-[color:var(--text)]">
                              ${parseFloat(market.priceUsd || '0').toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 6 })}
                            </td>
                            {cols.change && (
                              <td className={`py-2.5 px-4 text-right font-mono text-data ${chgPos ? 'up' : 'down'}`}>
                                {chgPos ? '+' : '-'}{Math.abs(chg).toFixed(2)}%
                              </td>
                            )}
                            {cols.marketCap && (
                              <td className="py-2.5 px-4 text-right font-mono text-data text-[color:var(--text-2)] hidden sm:table-cell">
                                ${formatNumber(market.marketCapUsd || '0')}
                              </td>
                            )}
                            {cols.fdv && (
                              <td className="py-2.5 px-4 text-right font-mono text-data text-[color:var(--text-2)] hidden xl:table-cell">
                                {market.fdvUsd && parseFloat(market.fdvUsd) > 0
                                  ? '$' + formatNumber(market.fdvUsd)
                                  : fdvSupply > 0 ? '$' + formatNumber(fdvSupply * parseFloat(market.priceUsd || '0')) : '—'}
                              </td>
                            )}
                            {cols.volume && (
                              <td className="py-2.5 px-4 text-right font-mono text-data text-[color:var(--text-2)] hidden lg:table-cell">
                                <div className="flex flex-col items-end leading-tight">
                                  <span>${formatNumber(market.volumeUsd24Hr || '0')}</span>
                                  <span className="text-label text-[color:var(--text-3)]">{formatNumber(parseFloat(market.volumeUsd24Hr || '0') / parseFloat(market.priceUsd || '1'))} {market.symbol}</span>
                                </div>
                              </td>
                            )}
                            {cols.volMcap && (
                              <td className="py-2.5 px-4 text-right font-mono text-data text-[color:var(--text-2)] hidden xl:table-cell">
                                {mcapNum > 0 ? (parseFloat(market.volumeUsd24Hr || '0') / mcapNum).toFixed(4) : '—'}
                              </td>
                            )}
                            {cols.circulating && (
                              <td className="py-2.5 px-4 text-right font-mono text-data text-[color:var(--text-2)] hidden xl:table-cell">
                                <div className="flex flex-col items-end leading-tight">
                                  <span>{formatNumber(market.csupply || '0')} {market.symbol}</span>
                                  {market.msupply && market.msupply !== '0' && (
                                    <div className="w-24 h-0.5 bg-[color:var(--line)] mt-1 overflow-hidden">
                                      <div
                                        className="h-full bg-[color:var(--text-3)]"
                                        style={{ width: `${Math.min(100, (parseFloat(market.csupply) / parseFloat(market.msupply)) * 100)}%` }}
                                      />
                                    </div>
                                  )}
                                </div>
                              </td>
                            )}
                            {cols.tsupply && (
                              <td className="py-2.5 px-4 text-right font-mono text-data text-[color:var(--text-2)] hidden xl:table-cell">
                                {formatNumber(market.tsupply || '0')} {market.symbol}
                              </td>
                            )}
                            {cols.msupply && (
                              <td className="py-2.5 px-4 text-right font-mono text-data text-[color:var(--text-2)] hidden xl:table-cell">
                                {market.msupply && market.msupply !== '0' ? `${formatNumber(market.msupply)} ${market.symbol}` : '∞'}
                              </td>
                            )}
                            {cols.p14d && (
                              <td className="py-2.5 px-4 text-right font-mono text-data hidden xl:table-cell"><PctVal v={market.changePercent14d} /></td>
                            )}
                            {cols.p30d && (
                              <td className="py-2.5 px-4 text-right font-mono text-data hidden xl:table-cell"><PctVal v={market.changePercent30d} /></td>
                            )}
                            {cols.p1y && (
                              <td className="py-2.5 px-4 text-right font-mono text-data hidden xl:table-cell"><PctVal v={market.changePercent1y} /></td>
                            )}
                            {cols.athVal && (
                              <td className="py-2.5 px-4 text-right font-mono text-data text-[color:var(--text-2)] hidden xl:table-cell">
                                {market.ath && parseFloat(market.ath) > 0 ? '$' + formatCurrency(market.ath) : '—'}
                              </td>
                            )}
                            {cols.athPct && (
                              <td className="py-2.5 px-4 text-right font-mono text-data hidden xl:table-cell"><PctVal v={market.athChangePct} /></td>
                            )}
                            {(() => {
                              const t = tech[market.symbol];
                              const num = (v: number | null | undefined, cls = 'text-[color:var(--text-2)]') => (
                                <span className={v == null ? 'text-[color:var(--text-3)]' : cls}>{fmtTech(v)}</span>
                              );
                              return (
                                <>
                                  {cols.rating && (
                                    <td className="py-2.5 px-4 text-right hidden md:table-cell">
                                      {t?.rating ? (
                                        <span className={`text-label font-semibold px-1.5 py-0.5 rounded-sm border border-[color:var(--line)] bg-[color:var(--bg)] ${t.rating.includes('Buy') ? 'up' : t.rating.includes('Sell') ? 'down' : 'text-[color:var(--text-3)]'}`} style={{ letterSpacing: '0.04em' }}>
                                          {t.rating.toUpperCase()}
                                        </span>
                                      ) : <span className="text-[color:var(--text-3)]">—</span>}
                                    </td>
                                  )}
                                  {cols.rsi && (
                                    <td className="py-2.5 px-4 text-right font-mono text-data hidden md:table-cell">
                                      {t?.rsi != null ? (
                                        <span className={t.rsi > 70 ? 'down' : t.rsi < 30 ? 'up' : 'text-[color:var(--text-2)]'}>{t.rsi.toFixed(1)}</span>
                                      ) : <span className="text-[color:var(--text-3)]">—</span>}
                                    </td>
                                  )}
                                  {cols.ema20 && <td className="py-2.5 px-4 text-right font-mono text-data hidden xl:table-cell">{num(t?.ema20)}</td>}
                                  {cols.ema50 && <td className="py-2.5 px-4 text-right font-mono text-data hidden xl:table-cell">{num(t?.ema50)}</td>}
                                  {cols.ema200 && <td className="py-2.5 px-4 text-right font-mono text-data hidden xl:table-cell">{num(t?.ema200)}</td>}
                                  {cols.sma20 && <td className="py-2.5 px-4 text-right font-mono text-data hidden xl:table-cell">{num(t?.sma20)}</td>}
                                  {cols.sma50 && <td className="py-2.5 px-4 text-right font-mono text-data hidden xl:table-cell">{num(t?.sma50)}</td>}
                                  {cols.sma200 && <td className="py-2.5 px-4 text-right font-mono text-data hidden xl:table-cell">{num(t?.sma200)}</td>}
                                  {cols.macd && (
                                    <td className="py-2.5 px-4 text-right font-mono text-data hidden xl:table-cell">
                                      {t?.macd != null ? (
                                        <div className="flex flex-col items-end leading-tight">
                                          <span className={t.macdSignal != null && t.macd > t.macdSignal ? 'up' : 'down'}>{fmtTech(t.macd)}</span>
                                          <span className="text-label text-[color:var(--text-3)]">sig {fmtTech(t.macdSignal)}</span>
                                        </div>
                                      ) : <span className="text-[color:var(--text-3)]">—</span>}
                                    </td>
                                  )}
                                  {cols.bbU && <td className="py-2.5 px-4 text-right font-mono text-data hidden xl:table-cell">{num(t?.bbUpper)}</td>}
                                  {cols.bbL && <td className="py-2.5 px-4 text-right font-mono text-data hidden xl:table-cell">{num(t?.bbLower)}</td>}
                                  {cols.atr && <td className="py-2.5 px-4 text-right font-mono text-data hidden xl:table-cell">{num(t?.atr)}</td>}
                                </>
                              );
                            })()}
                            {(() => {
                              const dv = derivs[market.symbol];
                              const dash = <span className="text-[color:var(--text-3)]">—</span>;
                              const vol = parseFloat(market.volumeUsd24Hr || '0');
                              return (
                                <>
                                  {cols.funding && (
                                    <td className="py-2.5 px-4 text-right font-mono text-data hidden md:table-cell">
                                      {dv?.fundingRate != null ? (
                                        <span className={dv.fundingRate >= 0 ? 'up' : 'down'}>{(dv.fundingRate * 100).toFixed(4)}%</span>
                                      ) : dash}
                                    </td>
                                  )}
                                  {cols.oi && (
                                    <td className="py-2.5 px-4 text-right font-mono text-data text-[color:var(--text-2)] hidden md:table-cell">
                                      {dv?.oiUsd != null ? '$' + formatNumber(dv.oiUsd) : dash}
                                    </td>
                                  )}
                                  {cols.oiVol && (
                                    <td className="py-2.5 px-4 text-right font-mono text-data text-[color:var(--text-2)] hidden xl:table-cell">
                                      {dv?.oiUsd != null && vol > 0 ? (dv.oiUsd / vol).toFixed(2) : dash}
                                    </td>
                                  )}
                                </>
                              );
                            })()}
                            {cols.spark && (
                              <td className="py-2.5 px-4 text-right hidden md:table-cell">
                                <div className="flex items-center justify-end gap-3 relative">
                                  <div className="w-24 h-10 transition-opacity group-hover:opacity-0">
                                    <Sparkline id={market.symbol} color={isPositive7d ? 'var(--up)' : 'var(--down)'} />
                                  </div>
                                  <div className="absolute inset-0 flex items-center justify-end opacity-0 group-hover:opacity-100 transition-opacity">
                                    <button
                                      onClick={(e) => {
                                        e.stopPropagation();
                                        onAssetSelect(market.symbol);
                                      }}
                                      className="bg-[color:var(--accent)] text-[color:var(--accent-ink)] hover:brightness-110 px-3 py-1 rounded-sm text-label font-semibold transition-colors shiny chrome cta-glow press"
                                      style={{ letterSpacing: '0.06em' }}
                                    >
                                      TRADE
                                    </button>
                                  </div>
                                </div>
                              </td>
                            )}
                            <td className="py-2.5 px-4" />
                          </tr>

                          <AnimatePresence>
                            {isExpanded && (
                              <motion.tr
                                initial={{ opacity: 0, height: 0 }}
                                animate={{ opacity: 1, height: 'auto' }}
                                exit={{ opacity: 0, height: 0 }}
                                className="bg-[color:var(--bg)] border-b border-[color:var(--line)] overflow-hidden"
                              >
                                <td colSpan={colCount} className="p-0">
                                  <div className="p-4 grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
                                    <div className="space-y-3">
                                      <div className="flex items-center gap-2.5">
                                        <img
                                          src={market.image || `https://assets.coincap.io/assets/icons/${(market.symbol || 'btc').toLowerCase()}@2x.png`}
                                          alt={market.name}
                                          className="w-8 h-8 rounded-full"
                                          onError={(e) => {
                                            (e.target as HTMLImageElement).src = 'https://assets.coincap.io/assets/icons/btc@2x.png';
                                          }}
                                        />
                                        <div>
                                          <h3 className="text-h4 font-display font-semibold text-[color:var(--text)]">{market.name}</h3>
                                          <div className="flex items-center gap-1.5">
                                            <span className="label">RANK #{market.rank}</span>
                                            <span className="font-mono text-label text-[color:var(--text-3)]">{market.symbol}</span>
                                          </div>
                                        </div>
                                      </div>
                                      <button
                                        onClick={(e) => {
                                          e.stopPropagation();
                                          onAssetSelect(market.symbol);
                                        }}
                                        className="flex items-center gap-1.5 bg-[color:var(--accent)] text-[color:var(--accent-ink)] hover:brightness-110 px-3 py-1.5 rounded-sm text-label font-semibold transition-colors shiny chrome cta-glow press"
                                        style={{ letterSpacing: '0.04em' }}
                                      >
                                        <BarChart2 className="w-3.5 h-3.5" />
                                        ADVANCED CHART
                                      </button>
                                    </div>

                                    <div className="space-y-2">
                                      <div>
                                        <div className="label mb-0.5">MARKET CAP</div>
                                        <div className="font-mono text-data text-[color:var(--text)]">${parseFloat(market.marketCapUsd || '0').toLocaleString()}</div>
                                      </div>
                                      <div>
                                        <div className="label mb-0.5">FULLY DILUTED</div>
                                        <div className="font-mono text-data text-[color:var(--text)]">
                                          {market.msupply && market.msupply !== '0'
                                            ? '$' + (parseFloat(market.msupply) * parseFloat(market.priceUsd)).toLocaleString(undefined, { maximumFractionDigits: 0 })
                                            : '∞'}
                                        </div>
                                      </div>
                                      <div>
                                        <div className="label mb-0.5">VOLUME 24H</div>
                                        <div className="font-mono text-data text-[color:var(--text)]">${parseFloat(market.volumeUsd24Hr || '0').toLocaleString()}</div>
                                      </div>
                                    </div>

                                    <div className="space-y-2">
                                      <div>
                                        <div className="label mb-0.5">CIRCULATING</div>
                                        <div className="font-mono text-data text-[color:var(--text)]">{parseFloat(market.csupply || '0').toLocaleString()} {market.symbol}</div>
                                      </div>
                                      <div>
                                        <div className="label mb-0.5">TOTAL SUPPLY</div>
                                        <div className="font-mono text-data text-[color:var(--text)]">{parseFloat(market.tsupply || '0').toLocaleString()} {market.symbol}</div>
                                      </div>
                                      <div>
                                        <div className="label mb-0.5">MAX SUPPLY</div>
                                        <div className="font-mono text-data text-[color:var(--text)]">
                                          {market.msupply && market.msupply !== '0' ? parseFloat(market.msupply).toLocaleString() + ' ' + market.symbol : '∞'}
                                        </div>
                                      </div>
                                    </div>

                                    <div className="space-y-2">
                                      <div className="label mb-1">LINKS</div>
                                      <div className="flex flex-wrap gap-1.5">
                                        <a
                                          href={`https://coinmarketcap.com/currencies/${market.id}/`}
                                          target="_blank"
                                          rel="noopener noreferrer"
                                          className="flex items-center gap-1 text-label font-semibold bg-[color:var(--surface-2)] hover:bg-[color:var(--surface)] text-[color:var(--text-2)] border border-[color:var(--line)] hover:border-[color:var(--line-strong)] px-2 py-1 rounded-sm transition-colors"
                                          onClick={(e) => e.stopPropagation()}
                                          style={{ letterSpacing: '0.04em' }}
                                        >
                                          COINMARKETCAP <ExternalLink className="w-2.5 h-2.5" />
                                        </a>
                                        <a
                                          href={`https://www.coingecko.com/en/coins/${market.id}`}
                                          target="_blank"
                                          rel="noopener noreferrer"
                                          className="flex items-center gap-1 text-label font-semibold bg-[color:var(--surface-2)] hover:bg-[color:var(--surface)] text-[color:var(--text-2)] border border-[color:var(--line)] hover:border-[color:var(--line-strong)] px-2 py-1 rounded-sm transition-colors"
                                          onClick={(e) => e.stopPropagation()}
                                          style={{ letterSpacing: '0.04em' }}
                                        >
                                          COINGECKO <ExternalLink className="w-2.5 h-2.5" />
                                        </a>
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
            )}
          </div>

          {/* Pagination */}
          {!['categories', 'portfolio', 'exchanges', 'nfts', 'converter'].includes(activeTab) && totalPages > 1 && (
            <div className="flex flex-col sm:flex-row items-center justify-between px-4 py-2.5 border-t border-[color:var(--line)] gap-3">
              <div className="flex items-center gap-3 text-body text-[color:var(--text-3)]">
                <div>
                  Showing <span className="font-mono text-[color:var(--text)]">{(currentPage - 1) * itemsPerPage + 1}</span>–<span className="font-mono text-[color:var(--text)]">{Math.min(currentPage * itemsPerPage, filteredMarkets.length)}</span> of <span className="font-mono text-[color:var(--text)]">{filteredMarkets.length}</span>
                </div>
                <div className="flex items-center gap-1.5">
                  <span className="label">ROWS</span>
                  <select
                    value={itemsPerPage}
                    onChange={(e) => {
                      setItemsPerPage(Number(e.target.value));
                      setCurrentPage(1);
                    }}
                    className="bg-[color:var(--bg)] border border-[color:var(--line)] text-[color:var(--text)] font-mono text-data rounded-sm px-1.5 py-0.5 focus:outline-none focus:border-[color:var(--line-strong)]"
                  >
                    <option value={10}>10</option>
                    <option value={20}>20</option>
                    <option value={50}>50</option>
                    <option value={100}>100</option>
                  </select>
                </div>
              </div>
              <div className="flex items-center gap-1">
                <button
                  onClick={() => setCurrentPage(prev => Math.max(prev - 1, 1))}
                  disabled={currentPage === 1}
                  className="px-2.5 py-1 rounded-sm bg-[color:var(--bg)] border border-[color:var(--line)] text-[color:var(--text-2)] disabled:opacity-40 disabled:cursor-not-allowed hover:border-[color:var(--line-strong)] hover:text-[color:var(--text)] transition-colors text-label font-semibold"
                  style={{ letterSpacing: '0.04em' }}
                >
                  PREV
                </button>
                <div className="flex items-center gap-0.5">
                  {Array.from({ length: Math.min(5, totalPages) }, (_, i) => {
                    let pageNum = i + 1;
                    if (totalPages > 5 && currentPage > 3) {
                      pageNum = currentPage - 2 + i;
                      if (pageNum > totalPages) pageNum = totalPages - 4 + i;
                    }
                    return (
                      <button
                        key={pageNum}
                        onClick={() => setCurrentPage(pageNum)}
                        className={`w-7 h-7 rounded-sm flex items-center justify-center font-mono text-data transition-colors ${
                          currentPage === pageNum
                            ? 'bg-[color:color-mix(in_oklch,var(--accent)_12%,transparent)] text-[color:var(--accent)]'
                            : 'text-[color:var(--text-3)] hover:bg-[color:var(--surface-2)] hover:text-[color:var(--text)]'
                        }`}
                      >
                        {pageNum}
                      </button>
                    );
                  })}
                </div>
                <button
                  onClick={() => setCurrentPage(prev => Math.min(prev + 1, totalPages))}
                  disabled={currentPage === totalPages}
                  className="px-2.5 py-1 rounded-sm bg-[color:var(--bg)] border border-[color:var(--line)] text-[color:var(--text-2)] disabled:opacity-40 disabled:cursor-not-allowed hover:border-[color:var(--line-strong)] hover:text-[color:var(--text)] transition-colors text-label font-semibold"
                  style={{ letterSpacing: '0.04em' }}
                >
                  NEXT
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
