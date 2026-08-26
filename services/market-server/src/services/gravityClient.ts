// Gravity Search API Client
// Connects Kimi's report pipeline to Gravity's pre-indexed financial document corpus.
// Gravity replaces Tavily: instead of scraping the web, we query verified SEC filings,
// earnings transcripts, and structured financial data from the indexed knowledge base.

const GRAVITY_BASE = process.env.GRAVITY_API_URL ?? 'http://localhost:8000';
const GRAVITY_TIMEOUT_MS = 15_000;

// ─── Types (compatible with TavilyResult so swap is drop-in) ──────────────────

export interface GravitySource {
    title: string;
    /** The exact SEC filing URL when the source has verified provenance;
     *  a company listing only when it never named a filing. */
    url: string;
    content: string;
    score: number;
    published_date?: string;
    ticker?: string;
    section?: string;
    document_id?: string;
    retrieval_method?: string;
    // Verified filing provenance, passed through untouched from gravity-api so
    // a downstream consumer never has to rebuild a SEC URL from a ticker.
    accession?: string;
    cik?: number;
    filing_url?: string;
    document_url?: string;
    canonical_url?: string;
}

export interface GravityStructuredRow {
    metric: string;
    value: string | number;
    unit?: string;
    period?: string;
    ticker?: string;
}

export interface GravitySearchResponse {
    sources: GravitySource[];
    structured_data: GravityStructuredRow[];
    answer?: string;
    confidence?: number;
    sql_query?: string;
}

export interface GravityDocument {
    id: string;
    ticker: string;
    company_name: string;
    filing_type: string;
    filing_date: string | null;
    title: string;
    chunk_count: number;
    status: string;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

// Only these hosts are authoritative for a filing citation.
const SEC_HOSTS = new Set(['www.sec.gov', 'sec.gov', 'data.sec.gov', 'efts.sec.gov']);

function isTrustedSecUrl(url?: string | null): boolean {
    if (!url) return false;
    try {
        const u = new URL(url);
        return u.protocol === 'https:' && SEC_HOSTS.has(u.hostname);
    } catch {
        return false;
    }
}

// Last resort only. gravity-api now ships the exact filing URL on every source
// that has an accession, so this is reached only for sources that never named a
// filing -- never as a substitute for one that did.
function buildEdgarUrl(ticker: string, filing_type: string): string {
    return `https://www.sec.gov/cgi-bin/browse-edgar?action=getcompany&company=${encodeURIComponent(ticker)}&type=${encodeURIComponent(filing_type)}&dateb=&owner=include&count=10`;
}

/** The exact filing URL a source carries, or '' when it carries none. */
function exactFilingUrl(s: any): string {
    for (const candidate of [s?.canonical_url, s?.filing_url, s?.document_url, s?.source_url]) {
        if (isTrustedSecUrl(candidate) && !/browse-edgar|getcompany/i.test(candidate)) {
            return candidate as string;
        }
    }
    return '';
}

function normalizeSources(raw: any[]): GravitySource[] {
    return (raw || []).map((s: any) => ({
        title: [s.document_title, s.section].filter(Boolean).join(' · '),
        // The exact filing wins. Substituting a company listing for a filing
        // whose accession is known is the bug this branch used to guarantee.
        url: exactFilingUrl(s)
            || (s.document_id
                ? buildEdgarUrl(s.ticker || '', s.filing_type || '')
                : `https://efts.sec.gov/LATEST/search-index?q=${encodeURIComponent(s.ticker || '')}`),
        accession: s.accession || s.accession_number || undefined,
        cik: s.cik ?? undefined,
        filing_url: s.filing_url || undefined,
        document_url: s.document_url || undefined,
        canonical_url: s.canonical_url || undefined,
        content: s.text || '',
        score: s.score ?? 0,
        published_date: s.filing_date ?? undefined,
        ticker: s.ticker,
        section: s.section,
        document_id: s.document_id,
        retrieval_method: s.retrieval_method,
    }));
}

async function gravityFetch(path: string, body: object): Promise<any> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), GRAVITY_TIMEOUT_MS);
    try {
        const res = await fetch(`${GRAVITY_BASE}${path}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body),
            signal: controller.signal,
        });
        if (!res.ok) throw new Error(`Gravity API ${path} → HTTP ${res.status}`);
        return res.json();
    } finally {
        clearTimeout(timer);
    }
}

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Run multiple search queries against Gravity's hybrid index (dense + BM25 + SPLADE + graph + SQL).
 * Returns deduplicated, relevance-ranked sources compatible with the TavilyResult interface.
 */
export async function searchGravityParallel(
    queries: string[],
    tickers: string[],
    maxPerQuery = 6,
): Promise<GravitySource[]> {
    const settled = await Promise.allSettled(
        queries.slice(0, 12).map(async (query) => {
            try {
                const data = await gravityFetch('/v1/search', {
                    query,
                    filters: {
                        companies: tickers,
                        document_types: ['10-K', '10-Q', '8-K', 'earnings_transcript'],
                    },
                    options: {
                        max_sources: maxPerQuery,
                        stream: false,
                        include_structured_data: false,
                    },
                });
                return normalizeSources(data.sources || []);
            } catch {
                return [] as GravitySource[];
            }
        })
    );

    const allResults: GravitySource[] = [];
    const seenIds = new Set<string>();

    for (const r of settled) {
        if (r.status !== 'fulfilled') continue;
        for (const item of r.value) {
            const key = item.document_id ?? item.url;
            if (!seenIds.has(key)) {
                seenIds.add(key);
                allResults.push(item);
            }
        }
    }

    return allResults.sort((a, b) => (b.score ?? 0) - (a.score ?? 0));
}

/**
 * Query structured financial data (TimescaleDB via NL→SQL) for a set of tickers.
 * Returns financial metrics (revenue, margins, EPS, etc.) with period and source.
 */
export async function fetchGravityStructured(
    query: string,
    tickers: string[],
    limit = 50,
): Promise<GravityStructuredRow[]> {
    try {
        const data = await gravityFetch('/v1/search/structured', {
            query,
            companies: tickers,
            limit,
        });
        return (data.rows || data.structured_data || []) as GravityStructuredRow[];
    } catch {
        return [];
    }
}

/**
 * Fetch indexed documents (filings) for a ticker from Gravity's document index.
 */
export async function fetchGravityDocuments(
    ticker: string,
    limit = 10,
): Promise<GravityDocument[]> {
    try {
        const res = await fetch(
            `${GRAVITY_BASE}/v1/documents?ticker=${encodeURIComponent(ticker)}&limit=${limit}`,
            { signal: AbortSignal.timeout(GRAVITY_TIMEOUT_MS) }
        );
        if (!res.ok) return [];
        const data = await res.json();
        return (data.documents || data || []) as GravityDocument[];
    } catch {
        return [];
    }
}

/**
 * Check whether Gravity backend is reachable.
 */
export async function isGravityAvailable(): Promise<boolean> {
    try {
        const res = await fetch(`${GRAVITY_BASE}/health`, {
            signal: AbortSignal.timeout(3_000),
        });
        return res.ok;
    } catch {
        return false;
    }
}
