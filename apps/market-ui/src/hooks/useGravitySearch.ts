// Gravity Search — shared types, answer cleaner, and initial state. The live
// WebSocket run lives in stores/qaStore.ts (module-level, survives navigation);
// this file is the type/util surface both it and the UI import.

// ─── Types ────────────────────────────────────────────────────────────────────

export type SearchStatus =
    | 'idle' | 'understanding' | 'searching' | 'reranking'
    | 'reasoning' | 'validating' | 'complete' | 'error';

export interface GravitySource {
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

export interface GravityCitation {
    citation_number: number;
    chunk_id: string;
    text: string;
    document_title: string;
    ticker: string;
    section: string;
    is_verified: boolean;
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
