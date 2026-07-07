// Curated sector-peer map for common large-caps. Static by design — the repo
// has no GICS sector source (sp500.json is symbol+name only, Alpha Vantage
// sector is empty on the free tier). Covers the names users actually open;
// unknown tickers fall back to "no suggested peers" (compare still works, user
// types their own). Upgrade path: a real sector feed → derive peers dynamically.

const PEER_GROUPS: string[][] = [
    ['AAPL', 'MSFT', 'GOOGL', 'META', 'AMZN'],          // mega-cap tech/platforms
    ['NVDA', 'AMD', 'INTC', 'AVGO', 'QCOM', 'TSM'],     // semiconductors
    ['TSLA', 'F', 'GM', 'RIVN', 'LCID'],                // autos/EV
    ['JPM', 'BAC', 'WFC', 'C', 'GS', 'MS'],             // money-center banks
    ['V', 'MA', 'AXP', 'PYPL'],                          // payments
    ['XOM', 'CVX', 'COP', 'SLB'],                        // energy
    ['JNJ', 'PFE', 'MRK', 'ABBV', 'LLY'],               // pharma
    ['UNH', 'CVS', 'CI', 'HUM'],                         // managed care
    ['WMT', 'TGT', 'COST', 'KR'],                        // retail
    ['KO', 'PEP', 'PG', 'CL'],                           // consumer staples
    ['DIS', 'NFLX', 'CMCSA', 'WBD'],                     // media
    ['BA', 'LMT', 'RTX', 'NOC', 'GD'],                   // aerospace/defense
    ['CAT', 'DE', 'HON', 'GE'],                          // industrials
    ['NKE', 'LULU', 'ADDYY'],                            // apparel
    ['CRM', 'ORCL', 'SAP', 'ADBE', 'NOW'],              // enterprise software
];

// Peers for a ticker = its group minus itself (capped). Empty when unknown.
export function peersFor(ticker: string, limit = 5): string[] {
    const t = ticker.toUpperCase();
    const group = PEER_GROUPS.find(g => g.includes(t));
    if (!group) return [];
    return group.filter(s => s !== t).slice(0, limit);
}
