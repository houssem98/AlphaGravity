// Gravity Search — shared types, answer cleaner, and initial state. The live
// WebSocket run lives in stores/qaStore.ts (module-level, survives navigation);
// this file is the type/util surface both it and the UI import.

// ─── Types ────────────────────────────────────────────────────────────────────

export type SearchStatus =
    | 'idle' | 'understanding' | 'searching' | 'reranking'
    | 'reasoning' | 'validating' | 'complete' | 'error';

// Verified SEC filing provenance, present on a source or citation whose figure
// came out of a filing. The backend resolves and verifies every field before
// the answer is generated, so the UI never reconstructs a SEC URL itself — that
// reconstruction is what sent source clicks to a generic company listing.
export interface SecFilingProvenance {
    issuer?: string;
    cik?: number | null;
    form?: string;
    filing_date?: string;
    fiscal_period?: string;
    accession?: string;
    accession_number?: string;
    filing_url?: string;
    document_url?: string;
    source_url?: string;
    evidence_location?: string;
    verification_status?: string;
    /** The exact SEC URL a source click must open. Empty when no verified
     *  filing provenance exists — which is a reason to show no filing link,
     *  never a reason to open a company page. */
    canonical_url?: string;
}

// Provenance for a source that came off the live web rather than out of a
// filing. Emitted by the same backend module as `SecFilingProvenance` — one
// citation architecture, two dialects — so a source card branches on
// `source_class` instead of probing for an accession.
export interface WebSourceProvenance {
    source_class?: 'SEC_EVIDENCE' | 'LOCAL_EVIDENCE' | 'WEB_EVIDENCE';
    /** The exact page a web source click must open. */
    url?: string;
    domain?: string;
    /** Present only when the page declared one. An absent date is shown as
     *  unknown, never filled in with the retrieval time. */
    published_at?: string;
    retrieved_at?: string;
    source_type?: string;
    /** UI grouping: sec_filings | company | web | news. */
    category?: string;
    /** 1 = primary/official, 4 = unknown. Drives ordering and the tier badge. */
    tier?: number;
    tier_label?: string;
    evidence_kind?: string;
    /** Non-empty when the fetched page contained instruction-shaped text. The
     *  passage is still shown; it is marked rather than hidden. */
    injection_flags?: string[];
}

export interface GravitySource extends SecFilingProvenance, WebSourceProvenance {
    chunk_id: string;
    document_id: string;
    text: string;
    ticker: string;
    document_title: string;
    section: string;
    filing_date: string;
    page: number | null;
    score: number;
    retrieval_method: string;
}

export interface GravityCitation extends SecFilingProvenance, WebSourceProvenance {
    citation_number: number;
    chunk_id: string;
    text: string;
    document_title: string;
    ticker: string;
    section: string;
    is_verified: boolean;
    url?: string;
    char_offset_start?: number;
    char_offset_end?: number;
}

export interface GravityMetric {
    metric: string;
    value: string | number;
    unit?: string;
    period?: string;
    ticker?: string;
    entity?: string;
    row_id?: string;
    source_id?: string;
}

export interface ChartSpec {
    chart_id: string;
    chart_type: 'line' | 'bar' | 'stacked_bar' | 'area';
    title: string;
    x_axis: string;
    y_axis: string;
    y_label?: string;
    series: Array<{ entity?: string; metric: string }>;
    data_refs: string[];
}

export interface AgentTraceStep {
    agent: 'Planner' | 'Reader' | 'Extractor' | 'Critic' | 'Verifier' | 'Writer';
    action: string;
    detail: string;
    iteration: number;
    quality_score?: number;
    timestamp: number;
}

export interface GravitySearchState {
    status: SearchStatus;
    streamingAnswer: string;       // tokens as they arrive
    finalAnswer: string;           // complete answer after streaming
    sources: GravitySource[];
    citations: GravityCitation[];
    structuredData: GravityMetric[];
    chartSpecs: ChartSpec[];
    followUpQueries: string[];
    confidence: number;
    error: string | null;
    latencyMs: number | null;
    modelUsed: string | null;
    cacheHit: boolean;
    // Agentic mode: live reasoning trace
    agentSteps: AgentTraceStep[];
    agentTraceComplete: boolean;
    totalIterations: number;
    totalCostUsd: number | null;
}

export const INITIAL_SEARCH_STATE: GravitySearchState = {
    status: 'idle',
    streamingAnswer: '',
    finalAnswer: '',
    sources: [],
    citations: [],
    structuredData: [],
    chartSpecs: [],
    followUpQueries: [],
    confidence: 0,
    error: null,
    latencyMs: null,
    modelUsed: null,
    cacheHit: false,
    agentSteps: [],
    agentTraceComplete: false,
    totalIterations: 0,
    totalCostUsd: null,
};

// ─── Filter types ─────────────────────────────────────────────────────────────

export interface SearchFilters {
    document_types?: string[];   // e.g. ['10-K', '10-Q', 'earnings_transcript']
    companies?: string[];        // ticker symbols
    date_range?: { from?: string; to?: string };
    sections?: string[];
}

// ─── Answer cleaner ─────────────────────────────────────────────────────────
// Some models wrap their output as a JSON object ({"answer":"...\\n\\n| … |"})
// or emit literal escape sequences instead of real newlines. Unwrap to clean
// markdown so the renderer can parse tables/headings. Handles complete payloads
// and partial (mid-stream) ones.

function decodeEscapes(s: string): string {
    if (s.includes('\\n') || s.includes('\\t') || s.includes('\\"') || s.includes('\\r')) {
        return s
            .replace(/\\r\\n/g, '\n')
            .replace(/\\n/g, '\n')
            .replace(/\\r/g, '\n')
            .replace(/\\t/g, '\t')
            .replace(/\\"/g, '"')
            .replace(/\\\\/g, '\\');
    }
    return s;
}

export function cleanAnswer(raw: string): string {
    if (!raw) return raw;
    const trimmed = raw.trimStart();
    if (trimmed.startsWith('{')) {
        // Complete JSON object → pull the answer-like field.
        try {
            const o = JSON.parse(trimmed);
            const inner = o.answer ?? o.response ?? o.text ?? o.content ?? o.markdown;
            if (typeof inner === 'string') return decodeEscapes(inner);
        } catch { /* partial/streaming or trailing junk — fall through */ }
        // Live/partial extraction of the answer string value.
        const key = trimmed.match(/"(?:answer|response|text|content|markdown)"\s*:\s*"/);
        if (key) {
            let rest = trimmed.slice((key.index ?? 0) + key[0].length);
            // Cut at the closing unescaped quote that ends the value, if present.
            const end = rest.search(/(?<!\\)"\s*[,}]/);
            if (end >= 0) rest = rest.slice(0, end);
            return decodeEscapes(rest);
        }
    }
    return decodeEscapes(raw);
}
