"""
Gravity Search — API Schemas (Pydantic v2)
Request and response models for the /v1/search endpoint.
"""

from datetime import date, datetime
from pydantic import BaseModel, Field


# ══════════════════════════════════════════════════════════════════════════
# REQUEST SCHEMAS
# ══════════════════════════════════════════════════════════════════════════

class DateRange(BaseModel):
    from_date: date | None = Field(None, alias="from")
    to_date: date | None = Field(None, alias="to")

    model_config = {"populate_by_name": True}


class SearchFilters(BaseModel):
    companies: list[str] = Field(default_factory=list, description="Ticker symbols to filter by")
    date_range: DateRange | None = None
    document_types: list[str] = Field(
        default_factory=list,
        description="e.g., 'earnings_transcript', '10-K', '10-Q', '8-K', 'news', 'broker_report'",
    )
    sections: list[str] = Field(
        default_factory=list,
        description="e.g., 'MD&A', 'Risk Factors', 'prepared_remarks', 'Q&A'",
    )
    sectors: list[str] = Field(default_factory=list, description="GICS sector names")


class SearchOptions(BaseModel):
    max_sources: int = Field(15, ge=1, le=50, description="Maximum source passages to retrieve")
    include_structured_data: bool = Field(True, description="Include financial data tables")
    confidence_threshold: float = Field(0.0, ge=0.0, le=1.0, description="Minimum confidence to return")
    response_format: str = Field("cited_json", description="'cited_json' | 'markdown' | 'plain'")
    stream: bool = Field(True, description="Enable WebSocket streaming")
    reasoning_depth: str = Field("auto", description="'auto' | 'fast' | 'deep' | 'exhaustive'")


class SearchRequest(BaseModel):
    """Main search request body for POST /v1/search."""
    query: str = Field(..., min_length=1, max_length=2000, description="Natural language search query")
    filters: SearchFilters = Field(default_factory=SearchFilters)
    options: SearchOptions = Field(default_factory=SearchOptions)
    conversation_id: str | None = Field(None, description="For follow-up queries in the same thread")

    model_config = {
        "json_schema_extra": {
            "examples": [{
                "query": "What did TSMC say about CapEx in Q4 2025?",
                "filters": {
                    "companies": ["TSM"],
                    "date_range": {"from": "2025-01-01", "to": "2025-12-31"},
                    "document_types": ["earnings_transcript", "10-K"],
                },
                "options": {
                    "max_sources": 15,
                    "include_structured_data": True,
                    "stream": True,
                    "reasoning_depth": "auto",
                },
            }]
        }
    }


# ══════════════════════════════════════════════════════════════════════════
# RESPONSE SCHEMAS
# ══════════════════════════════════════════════════════════════════════════

class Citation(BaseModel):
    id: int
    source: str = Field(..., description="Document title")
    section: str = Field("", description="Section within the document")
    page: int | None = Field(None, description="Page number if available")
    date: str = Field("", description="Document date")
    ticker: str = Field("", description="Company ticker")
    text: str = Field(..., description="Exact source text supporting the claim")
    url: str = Field("", description="Link to the original document")
    chunk_id: str = Field("", description="Qdrant chunk ID for drill-to-source")
    char_offset_start: int | None = Field(None, description="Char offset of cited span in chunk text")
    char_offset_end: int | None = Field(None, description="Char offset end of cited span in chunk text")
    # Authoritative filing provenance, present when the figure came out of a
    # filing. Without these the response model silently stripped the accession
    # the SEC channel had already resolved, and `url` degraded to a generic
    # EDGAR company listing.
    accession: str = Field("", description="EDGAR accession number of the filing cited")
    accession_number: str = Field("", description="Alias of `accession`, the field name the source contract uses")
    issuer: str = Field("", description="Registrant name as SEC records it")
    cik: int | None = Field(None, description="SEC Central Index Key")
    form: str = Field("", description="Filing form, e.g. 10-K")
    filing_date: str = Field("", description="Date the filing was filed")
    fiscal_period: str = Field("", description="Fiscal period the fact covers, e.g. FY2025 or FY2026Q3")
    filing_url: str = Field("", description="Exact filing index URL for that accession")
    document_url: str = Field("", description="The exact document the figure was read from, when SEC served one")
    source_url: str = Field("", description="Authoritative SEC URL the resolver returned")
    evidence_location: str = Field("", description="Document plus XBRL context element, where the fact was read")
    canonical_url: str = Field("", description="The exact SEC URL a source click must open. Empty when no verified filing provenance exists.")
    verification_status: str = Field("", description="Deterministic verification outcome for the cited fact")
    provenance: dict | None = Field(None, description="Full canonical evidence chain: issuer, CIK, period, XBRL concept, dimension, unit, value, evidence location")


class SourcePassage(BaseModel):
    id: str
    chunk_id: str
    title: str
    section: str = ""
    text: str
    ticker: str = ""
    date: str = ""
    document_type: str = ""
    source_quality: int = Field(5, ge=1, le=10, description="Authority score: 10=SEC filing, 9=transcript, 7=broker, 5=news")
    relevance_score: float = 0.0
    source_channels: list[str] = Field(default_factory=list)
    # Filing provenance, present when the passage came out of an SEC filing.
    # A source card is clickable; without these it had no URL to click and the
    # frontend rebuilt a generic company listing from the ticker.
    issuer: str = ""
    cik: int | None = None
    form: str = ""
    filing_date: str = ""
    fiscal_period: str = ""
    accession: str = ""
    accession_number: str = ""
    filing_url: str = ""
    document_url: str = ""
    source_url: str = ""
    evidence_location: str = ""
    verification_status: str = ""
    canonical_url: str = Field("", description="The exact SEC URL a source click must open. Empty when no verified filing provenance exists.")


class StructuredDataPoint(BaseModel):
    metric: str
    value: float | str
    period: str
    currency: str = "USD"
    source: str = ""


class SearchMetadata(BaseModel):
    trace_id: str
    latency_ms: float
    model_used: str
    complexity: str
    estimated_cost_usd: float = 0.0
    retrieval_channels: list[str] = Field(default_factory=list)
    # Channels that were dispatched and came back empty. retrieval_channels alone
    # cannot distinguish "we asked and it had nothing" from "we never asked" —
    # ten channels are registered and two answer, and the response used to look
    # identical either way.
    channels_dark: list[str] = Field(default_factory=list)
    passages_used: int = 0
    cache_hit: bool = False
    # live = produced by this request. replay = served from cache, and the channel
    # and model fields describe the ORIGINAL run. legacy = a cache entry written
    # before provenance was stored, so those fields are genuinely unknown.
    cache_provenance: str = "live"
    # Why the filer was or was not asked, and what was actually asked of it.
    # These reached the WebSocket metadata event but were dropped by this model,
    # so the REST caller could not see the routing decision at all.
    question_class: str = ""
    local_evidence_status: str = ""
    sec_invoked: bool | None = None
    sec_skip_reason: str | None = None
    sec_identity_requests: int = 0
    sec_fact_requests: int = 0
    sec_filing_requests: int = 0
    sec_archive_requests: int = 0
    source_accession: str = ""
    source_filing_url: str = ""
    verification_status: str = ""
    # Per-stage latency breakdown (P4.3 observability) — 0 when not measured.
    understanding_ms: float = 0.0
    retrieval_ms: float = 0.0
    rerank_ms: float = 0.0
    reasoning_ms: float = 0.0
    validation_ms: float = 0.0


class Contradiction(BaseModel):
    source_a: str
    source_b: str
    claim: str
    value_a: str
    value_b: str


class SearchResponse(BaseModel):
    """Complete search response (non-streaming)."""
    id: str = Field(..., description="Unique search result ID")
    answer: str = Field(..., description="AI-generated answer with inline [Source N] citations")
    citations: list[Citation] = Field(default_factory=list)
    sources: list[SourcePassage] = Field(default_factory=list)
    structured_data: list[StructuredDataPoint] = Field(default_factory=list)
    contradictions: list[Contradiction] = Field(default_factory=list)
    confidence: str = Field("MEDIUM", description="HIGH | MEDIUM | LOW")
    caveats: list[str] = Field(default_factory=list)
    follow_up_queries: list[str] = Field(default_factory=list)
    metadata: SearchMetadata | None = None

    model_config = {
        "json_schema_extra": {
            "examples": [{
                "id": "search_abc123",
                "answer": "TSMC guided FY2025 CapEx of $32B [1], up 12% YoY...",
                "citations": [{"id": 1, "source": "TSM Q4 2025 Transcript", "section": "Prepared Remarks",
                               "text": "We expect capital expenditure for 2025 to be approximately $32 billion..."}],
                "confidence": "HIGH",
                "follow_up_queries": ["How does TSMC's CapEx compare to Samsung?"],
                "metadata": {"trace_id": "abc-123", "latency_ms": 1240, "model_used": "claude-sonnet-4.5"},
            }]
        }
    }


# ══════════════════════════════════════════════════════════════════════════
# FEEDBACK SCHEMAS
# ══════════════════════════════════════════════════════════════════════════

class FeedbackRequest(BaseModel):
    """User thumbs-up / thumbs-down signal for a completed search."""
    search_id: str = Field(..., description="trace_id of the search to rate")
    rating: str = Field(..., pattern="^(up|down)$", description="'up' or 'down'")
    comment: str | None = Field(None, max_length=1000, description="Optional free-text comment")


class FeedbackResponse(BaseModel):
    success: bool
    search_id: str
