// ─── Search Request & Response ───────────────────────────────────────────────

export interface SearchFilters {
  companies?: string[];
  date_range?: { from: string; to: string };
  document_types?: string[];
  sections?: string[];
}

export interface SearchRequest {
  query: string;
  filters?: SearchFilters;
  options?: {
    max_sources?: number;
    reasoning_depth?: "fast" | "agentic" | "auto";
    stream?: boolean;
  };
}

export interface Citation {
  id: number;
  source: string;
  section: string;
  page?: number | null;
  date: string;
  ticker: string;
  text: string;
  /** Exact filing index URL when the figure came from a filing; otherwise an
   *  EDGAR company listing. */
  url?: string;
  /** Authoritative filing provenance, present only for exact SEC facts. The
   *  API resolves and verifies these before the answer is generated; declaring
   *  them here is what lets the UI show the filing rather than the company. */
  accession?: string;
  filing_url?: string;
  verification_status?: string;
  provenance?: CitationProvenance;
}

/** The canonical evidence object behind an exact filing figure. Every field is
 *  read out of the filing itself, so an absent field means "not reported",
 *  never "not looked up". */
export interface CitationProvenance {
  issuer?: string;
  ticker?: string;
  cik?: number;
  filing_form?: string;
  filing_date?: string;
  accession: string;
  fiscal_year?: number;
  fiscal_quarter?: number | null;
  period_start?: string;
  period_end?: string;
  xbrl_concept?: string;
  dimension?: string[];
  dimension_value?: string[];
  unit?: string;
  value?: number;
  verification_status?: string;
  source_url?: string;
  filing_url?: string;
  evidence_location?: string;
  extraction_method?: string;
  parser_version?: string;
  scope?: 'segment' | 'consolidated';
  restated?: boolean;
  is_amendment?: boolean;
  provenance_chain?: string[];
}

export interface SourcePassage {
  id: string;
  title: string;
  passage: string;
  relevance_score: number;
  section: string;
  date: string;
  ticker?: string;
  filing_type?: string;
}

export interface StructuredDataPoint {
  period: string;
  value: number;
  currency?: string;
  is_guidance?: boolean;
}

export interface SearchMetadata {
  trace_id: string;
  latency_ms: number;
  model_used: string;
  complexity: string;
  cost_usd: number;
  channels_used: string[];
  passages_retrieved: number;
  cache_hit: boolean;
}

export interface SearchResponse {
  id: string;
  answer: string;
  citations: Citation[];
  sources: SourcePassage[];
  structured_data?: Record<string, StructuredDataPoint[]>;
  confidence: "HIGH" | "MEDIUM" | "LOW";
  follow_up_queries: string[];
  metadata: SearchMetadata;
}

// ─── WebSocket Events ─────────────────────────────────────────────────────────

export type SearchEventType =
  | "status"
  | "sources"
  | "token"
  | "answer"
  | "metadata"
  | "agent_trace"
  | "error";

export interface SearchEvent {
  type: SearchEventType;
  data: Record<string, unknown>;
}

// ─── Agent Trace ─────────────────────────────────────────────────────────────

export interface AgentTraceStep {
  agent: string;
  action: string;
  input?: string;
  output?: string;
  latency_ms?: number;
  timestamp: string;
}
