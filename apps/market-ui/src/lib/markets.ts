// Market registry — one source of truth for the multi-market hub.
// Adding a market = one entry here. Swapping a data source = change `source`.
// See docs/TRADING_MARKETS_ROADMAP.md.

import sp500 from './sp500.json';

export type MarketId = 'crypto' | 'us' | 'tunisia' | 'commodities' | 'bonds' | 'forex';
export type MarketSource = 'crypto' | 'yahoo' | 'tunisia';
// How a quote reads: $ price, TND price, % yield (bonds), or bare rate (forex).
export type Unit = 'USD' | 'TND' | 'PCT' | 'RATE';

export interface SymbolDef {
  symbol: string;
  name: string;
}

export interface MarketDef {
  id: MarketId;
  label: string;
  blurb: string;
  currency: Unit;
  source: MarketSource;
  indices: SymbolDef[]; // headline instruments shown on the hub card
  symbols: SymbolDef[]; // full drill-down list (crypto pulls its own)
}

const US_INDICES: SymbolDef[] = [
  { symbol: '^GSPC', name: 'S&P 500' },
  { symbol: '^IXIC', name: 'Nasdaq Composite' },
  { symbol: '^DJI', name: 'Dow Jones' },
  { symbol: '^RUT', name: 'Russell 2000' },
];

// Full S&P 500 constituents (generated from datahub CSV; dots→dashes for Yahoo).
const US_STOCKS: SymbolDef[] = sp500 as SymbolDef[];

// ponytail: mock BVMT list — swap fetchTunisiaMock→/api/tn/markets in Phase 6.
const TN_STOCKS: SymbolDef[] = [
  { symbol: 'BIAT', name: 'Banque Internationale Arabe de Tunisie' },
  { symbol: 'SFBT', name: 'Société Frigorifique et Brasserie de Tunis' },
  { symbol: 'BNA', name: 'Banque Nationale Agricole' },
  { symbol: 'ATB', name: 'Arab Tunisian Bank' },
  { symbol: 'PGH', name: 'Poulina Group Holding' },
  { symbol: 'DELICE', name: 'Délice Holding' },
  { symbol: 'TLNET', name: 'Telnet Holding' },
  { symbol: 'SAH', name: 'SAH Lilas' },
  { symbol: 'ATTIJARI', name: 'Attijari Bank' },
  { symbol: 'CELLCOM', name: 'Cellcom' },
];

const COMMODITIES: SymbolDef[] = [
  { symbol: 'GC=F', name: 'Gold' },
  { symbol: 'SI=F', name: 'Silver' },
  { symbol: 'CL=F', name: 'Crude Oil (WTI)' },
  { symbol: 'BZ=F', name: 'Brent Crude' },
  { symbol: 'NG=F', name: 'Natural Gas' },
  { symbol: 'HG=F', name: 'Copper' },
  { symbol: 'PL=F', name: 'Platinum' },
  { symbol: 'ZC=F', name: 'Corn' },
];

const BONDS: SymbolDef[] = [
  { symbol: '^TNX', name: 'US 10Y Treasury' },
  { symbol: '^TYX', name: 'US 30Y Treasury' },
  { symbol: '^FVX', name: 'US 5Y Treasury' },
  { symbol: '^IRX', name: 'US 13W T-Bill' },
];

const FOREX: SymbolDef[] = [
  { symbol: 'EURUSD=X', name: 'Euro / US Dollar' },
  { symbol: 'GBPUSD=X', name: 'British Pound / US Dollar' },
  { symbol: 'USDJPY=X', name: 'US Dollar / Japanese Yen' },
  { symbol: 'USDCHF=X', name: 'US Dollar / Swiss Franc' },
  { symbol: 'AUDUSD=X', name: 'Australian Dollar / US Dollar' },
  { symbol: 'USDCAD=X', name: 'US Dollar / Canadian Dollar' },
  { symbol: 'USDTND=X', name: 'US Dollar / Tunisian Dinar' },
];

export const MARKETS: MarketDef[] = [
  {
    id: 'us',
    label: 'US Markets',
    blurb: 'S&P 500, Nasdaq & blue-chip equities',
    currency: 'USD',
    source: 'yahoo',
    indices: US_INDICES,
    symbols: US_STOCKS,
  },
  {
    id: 'crypto',
    label: 'Crypto',
    blurb: 'Bitcoin, Ethereum & 100+ digital assets',
    currency: 'USD',
    source: 'crypto',
    indices: [
      { symbol: 'BTC', name: 'Bitcoin' },
      { symbol: 'ETH', name: 'Ethereum' },
    ],
    symbols: [],
  },
  {
    id: 'tunisia',
    label: 'Tunisian Market',
    blurb: 'TUNINDEX & Bourse de Tunis (BVMT)',
    currency: 'TND',
    source: 'tunisia',
    indices: [{ symbol: 'TUNINDEX', name: 'TUNINDEX' }],
    symbols: TN_STOCKS,
  },
  {
    id: 'commodities',
    label: 'Commodities',
    blurb: 'Gold, oil, metals & agriculture',
    currency: 'USD',
    source: 'yahoo',
    indices: [COMMODITIES[0], COMMODITIES[2]],
    symbols: COMMODITIES,
  },
  {
    id: 'bonds',
    label: 'Bonds',
    blurb: 'US Treasury yields across the curve',
    currency: 'PCT',
    source: 'yahoo',
    indices: [BONDS[0], BONDS[1]],
    symbols: BONDS,
  },
  {
    id: 'forex',
    label: 'Forex',
    blurb: 'Major currency pairs',
    currency: 'RATE',
    source: 'yahoo',
    indices: [FOREX[0], FOREX[2]],
    symbols: FOREX,
  },
];

export const getMarket = (id: MarketId): MarketDef =>
  MARKETS.find((m) => m.id === id)!;
