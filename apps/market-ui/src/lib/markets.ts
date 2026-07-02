// Market registry — one source of truth for the multi-market hub.
// Adding a market = one entry here. Swapping a data source = change `source`.
// See docs/TRADING_MARKETS_ROADMAP.md.

export type MarketId = 'crypto' | 'us' | 'tunisia';
export type MarketSource = 'crypto' | 'yahoo' | 'tunisia-mock';

export interface SymbolDef {
  symbol: string;
  name: string;
}

export interface MarketDef {
  id: MarketId;
  label: string;
  blurb: string;
  currency: 'USD' | 'TND';
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

const US_STOCKS: SymbolDef[] = [
  { symbol: 'AAPL', name: 'Apple' },
  { symbol: 'MSFT', name: 'Microsoft' },
  { symbol: 'NVDA', name: 'NVIDIA' },
  { symbol: 'GOOGL', name: 'Alphabet' },
  { symbol: 'AMZN', name: 'Amazon' },
  { symbol: 'META', name: 'Meta Platforms' },
  { symbol: 'TSLA', name: 'Tesla' },
  { symbol: 'BRK-B', name: 'Berkshire Hathaway' },
  { symbol: 'JPM', name: 'JPMorgan Chase' },
  { symbol: 'V', name: 'Visa' },
  { symbol: 'UNH', name: 'UnitedHealth' },
  { symbol: 'XOM', name: 'Exxon Mobil' },
  { symbol: 'LLY', name: 'Eli Lilly' },
  { symbol: 'JNJ', name: 'Johnson & Johnson' },
  { symbol: 'MA', name: 'Mastercard' },
  { symbol: 'AVGO', name: 'Broadcom' },
  { symbol: 'HD', name: 'Home Depot' },
  { symbol: 'PG', name: 'Procter & Gamble' },
  { symbol: 'COST', name: 'Costco' },
  { symbol: 'NFLX', name: 'Netflix' },
];

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
    source: 'tunisia-mock',
    indices: [{ symbol: 'TUNINDEX', name: 'TUNINDEX' }],
    symbols: TN_STOCKS,
  },
];

export const getMarket = (id: MarketId): MarketDef =>
  MARKETS.find((m) => m.id === id)!;
