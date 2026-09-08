// Shapes the company page and its tabs pass between each other.
// Extracted verbatim from CompanyPage.tsx (CF-9) — no field changed.

export interface MarketOverview {
    Symbol: string;
    Name: string;
    Sector: string;
    Industry: string;
    Description: string;
    MarketCapitalization: string;
    PERatio: string;
    EPS: string;
    DividendYield: string;
    '52WeekHigh': string;
    '52WeekLow': string;
    AnalystTargetPrice: string;
    ReturnOnEquityTTM: string;
    ProfitMargin: string;
    RevenueGrowthYOY: string;
    OperatingMarginTTM: string;
    GrossProfitTTM: string;
    RevenueTTM: string;
    EBITDA: string;
    // CT-5 · Alpha Vantage OVERVIEW carries these two. They are the only real
    // source of a fiscal-year-end in this payload; absent them, a period-end is
    // rendered as an honest unknown rather than guessed.
    FiscalYearEnd?: string;   // e.g. "January"
    LatestQuarter?: string;   // e.g. "2025-10-31"
}

export interface Quote {
    price: number;
    changePct: number;
    volume: number;
    marketCap: number;
}

export interface GravityDocument {
    id: string;
    ticker: string;
    filing_type: string;
    filing_date: string | null;
    title: string;
    chunk_count: number;
    status: string;
}

export interface GravityMetric {
    metric: string;
    value: string | number;
    unit?: string;
    period?: string;
    ticker?: string;
    // CT2-3 · optional on purpose. CT2-2 measured 0 of 60 rows carrying it, and
    // the marker exists because the id can be missing — narrowing this to string
    // would delete the state the page has to render honestly.
    document_id?: string;
}

export interface SentimentResult {
    ticker: string;
    overall_score: number;       // -1 to +1
    label: string;               // 'bullish' | 'neutral' | 'bearish'
    confidence: number;
    document_count: number;
    period?: string;
    breakdown?: { category: string; score: number; count: number }[];
}

export interface SentimentDelta {
    ticker: string;
    current_score: number;
    previous_score: number;
    delta: number;
    direction: 'improving' | 'deteriorating' | 'stable';
    significant_shifts: { topic: string; change: number; direction: string }[];
}

export interface LongitudinalPoint {
    period: string;
    revenue?: number;
    net_income?: number;
    operating_income?: number;
    eps?: number;
    gross_margin?: number;
    [key: string]: string | number | undefined;
}

// CT-3 · the tabs are addressable. `tab` is the DEFAULT, not a controlled value:
// every existing mount passes nothing and keeps landing on Overview.
export type CompanyTab = 'overview' | 'filings' | 'data' | 'sentiment';
