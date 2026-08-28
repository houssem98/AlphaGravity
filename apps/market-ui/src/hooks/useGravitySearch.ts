// Gravity Search — shared types, answer cleaner, and initial state. The live
// WebSocket run lives in stores/qaStore.ts (module-level, survives navigation);
// this file is the type/util surface both it and the UI import.

// ─── Types ────────────────────────────────────────────────────────────────────

// Exactly the stages the backend emits, plus the terminal states the client
// itself owns. `validating` used to sit in this union and hold a 93% slot on
// the progress bar; the pipeline never emitted it — grep the API for
// '"status": "validating"' and nothing comes back. A status the server cannot
// send has no business being a stage the user can see.
export type SearchStatus =
    | 'idle'
    | 'understanding'
    | 'searching'
    | 'resolving_primary_source'
    | 'answering_from_verified_evidence'
    | 'reranking'
    | 'reasoning'
    | 'complete'
    | 'cancelled'
    | 'error';

/** Every stage the server may put on screen, in pipeline order. */
export const BACKEND_STAGES: readonly SearchStatus[] = [
    'understanding', 'searching', 'resolving_primary_source',
    'answering_from_verified_evidence', 'reranking', 'reasoning',
] as const;

// The answer's own state, decided by the backend's evidence gate and sent on the
// `answer` event as `answer_state` — a field the UI used to drop, so an answer
// that said "no supporting evidence found" rendered in the same confident frame
// as a fully cited one.
export type AnswerState =
    | 'ANSWERED'
    | 'UNSUPPORTED'
    | 'SOURCE_UNAVAILABLE'
    | 'CONFLICTING_EVIDENCE'
    | 'CANCELLED'
    | 'SYSTEM_ERROR';

// The backend sends confidence as one of these words. It was typed `number`
// here and rendered as `Math.round(confidence * 100)`, which is NaN for every
// value the server actually sends.
export type ConfidenceLabel = 'NONE' | 'LOW' | 'MEDIUM' | 'HIGH' | null;

/** A citation verdict. `verified` requires evidence, not the model's word. */
export type VerificationStatus =
    | 'verified' | 'partially_supported' | 'unsupported'
    | 'conflicting' | 'not_verifiable';

/** What retrieval actually did — measured by the server, never assumed here. */
export interface RetrievalReport {
    channels_used: string[];
    /** Ran and matched nothing. Not the same as failed. */
    channels_dark: string[];
    /** Channel name -> exception type. A provider outage, reported as one
     *  rather than as an honest empty result. */
    channels_failed?: Record<string, string>;
    /** True when at least one channel failed, so the answer rests on less
     *  evidence than a healthy run would have used. */
    degraded?: boolean;
    candidates: number;
    passages_used: number;
    retrieval_ms: number;
    rerank_ms: number;
}

/** One event as it arrived on the socket, kept so the progress view renders the
 *  real stream instead of a scripted one. */
export interface PipelineEvent {
    seq: number;
    type: string;
    stage: SearchStatus | null;
    label: string;
    /** Server clock for the event. The old log printed `new Date()` at render
     *  time, so every row showed the current wall clock, not when it happened. */
    ts: number;
    replayed: boolean;
}

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
    /** True only when `verification_status` is 'verified'. It used to be
     *  whatever the model reported as `entailed`, so a citation the model
     *  invented arrived with no source and a green badge. */
    is_verified: boolean;
    verification_status?: VerificationStatus;
    /** Machine-readable reasons behind the verdict, e.g.
     *  'citation_index_out_of_range', 'numeric_not_in_source'. */
    verification_reasons?: string[];
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
    /** The word the backend actually sent. Rendering it as a percentage was
     *  always NaN; a decorative number is worse than the label itself. */
    confidence: ConfidenceLabel;
    /** Backend's evidence verdict for the whole answer. */
    answerState: AnswerState | null;
    /** The real event stream, in server order. The progress view renders this
     *  and nothing else. */
    events: PipelineEvent[];
    /** What retrieval actually ran. Null until the server says. */
    retrieval: RetrievalReport | null;
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
    confidence: null,
    answerState: null,
    events: [],
    retrieval: null,
    error: null,
    latencyMs: null,
    modelUsed: null,
    cacheHit: false,
    agentSteps: [],
    agentTraceComplete: false,
    totalIterations: 0,
    totalCostUsd: null,
};

// ─── Event projection ─────────────────────────────────────────────────────────
// The progress view is a projection of these events and owns no timeline of its
// own. It used to hold an array of scripted lines — "Dense vector search ·
// Qdrant + voyage-finance-2…", "Knowledge-graph traversal · Neo4j…" — revealed
// on a 650ms interval whether or not those systems were configured, let alone
// reached. Everything shown now comes from a frame the server sent.

export const STAGE_LABELS: Record<SearchStatus, string> = {
    idle: 'Idle',
    understanding: 'Understanding the question',
    searching: 'Searching indexed documents',
    resolving_primary_source: 'Resolving the primary source filing',
    answering_from_verified_evidence: 'Answering from evidence already on file',
    reranking: 'Reranking retrieved passages',
    reasoning: 'Generating a cited answer',
    complete: 'Complete',
    cancelled: 'Cancelled',
    error: 'Error',
};

const KNOWN_STAGES = new Set<string>([...BACKEND_STAGES, 'complete', 'cancelled', 'error']);

export function isBackendStage(stage: unknown): stage is SearchStatus {
    return typeof stage === 'string' && KNOWN_STAGES.has(stage);
}

/** Render a retrieval report as one honest operational line. Names only the
 *  channels the server reported, and says plainly when some went dark. */
export function describeRetrieval(r: RetrievalReport): string {
    const used = r.channels_used.length;
    const parts = [
        `Retrieved ${r.candidates} candidate passage${r.candidates === 1 ? '' : 's'} from ` +
        `${used} channel${used === 1 ? '' : 's'} (${r.channels_used.join(', ') || 'none'})`,
    ];
    if (r.channels_dark.length > 0) {
        parts.push(`${r.channels_dark.length} returned nothing: ${r.channels_dark.join(', ')}`);
    }
    const failed = Object.keys(r.channels_failed ?? {});
    if (failed.length > 0) {
        // Said plainly. A failed channel used to arrive as an empty list and be
        // rendered as "returned nothing", which reads as a searched-and-clean
        // result rather than as a channel that never answered.
        parts.push(`${failed.length} failed: ${failed.join(', ')}`);
    }
    parts.push(`kept ${r.passages_used}`);
    return parts.join(' · ');
}

/**
 * Turn one raw WebSocket frame into a log line, or null when the frame carries
 * nothing a user should be shown. Returning null is the point: a frame the
 * server did not send cannot become a line, so the view cannot narrate work
 * that did not happen.
 */
export function toPipelineEvent(msg: unknown): PipelineEvent | null {
    if (!msg || typeof msg !== 'object') return null;
    const m = msg as Record<string, unknown>;
    const type = typeof m.type === 'string' ? m.type : '';
    if (!type) return null;
    const data = (m.data ?? {}) as Record<string, unknown>;
    const seq = typeof m.seq === 'number' ? m.seq : 0;
    const ts = typeof m.ts === 'number' ? m.ts * 1000 : Date.now();
    const replayed = m.replayed === true;

    const line = (stage: SearchStatus | null, label: string): PipelineEvent =>
        ({ seq, type, stage, label, ts, replayed });

    switch (type) {
        case 'status': {
            const stage = data.status;
            // An unrecognised stage is reported as-is rather than dropped. The
            // old map sent anything it did not know to index -1, which silently
            // reset the whole progress display mid-run — and the two stages it
            // did not know, resolving_primary_source and
            // answering_from_verified_evidence, are the ones that fire on
            // exactly the queries that consult a filing.
            if (!isBackendStage(stage)) {
                return typeof stage === 'string' && stage
                    ? line(null, String(stage).replace(/_/g, ' '))
                    : null;
            }
            return line(stage, STAGE_LABELS[stage]);
        }
        case 'retrieval':
            return line('searching', describeRetrieval(data as unknown as RetrievalReport));
        case 'sources': {
            const n = Array.isArray(data.sources) ? data.sources.length : 0;
            return line('reranking', `${n} source${n === 1 ? '' : 's'} ready`);
        }
        case 'agent_trace': {
            const agent = typeof data.agent === 'string' ? data.agent : 'Agent';
            const action = typeof data.action === 'string' ? data.action : '';
            return line('reasoning', `${agent}: ${action}`);
        }
        case 'cancelled':
            return line('cancelled', 'Cancelled — the server stopped this search');
        case 'error':
            return line('error', typeof data.message === 'string' ? data.message : 'Search failed');
        case 'metadata': {
            const model = typeof data.model_used === 'string' ? data.model_used : 'unknown model';
            const ms = typeof data.latency_ms === 'number' ? ` in ${Math.round(data.latency_ms)}ms` : '';
            const cached = data.cache_hit === true ? ' (cached)' : '';
            return line(null, `Answered by ${model}${ms}${cached}`);
        }
        // token / answer / agent_trace_complete carry no operational line.
        default:
            return null;
    }
}

/** Count citations by verdict. Drives the source panel's honest summary in
 *  place of "N citations verified", which counted citations, not verdicts. */
export function verificationSummary(citations: GravityCitation[]): Record<string, number> {
    const out: Record<string, number> = {};
    for (const c of citations) {
        const v = c.verification_status ?? (c.is_verified ? 'verified' : 'not_verifiable');
        out[v] = (out[v] ?? 0) + 1;
    }
    return out;
}

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
