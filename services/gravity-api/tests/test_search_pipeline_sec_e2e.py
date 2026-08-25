"""
The verified-evidence gate through the REAL `SearchPipeline.search()`.

`test_verified_evidence_gate.py` proves the gate and the routing rule against
real objects, but stops short of the pipeline: it calls the gate directly and
then dispatches the EDGAR channel itself. That leaves one thing unproven — that
`SearchPipeline.search()`, the coroutine the WebSocket route actually drives,
honours the decision. A pipeline that computed the gate and then ignored it would
pass every test in that file.

So nothing here substitutes for the pipeline. `SearchPipeline` is the real class,
`RetrievalOrchestrator` is the real orchestrator, `EdgarSearch` is the real
channel, and the gate runs where the pipeline runs it.

Mocks sit only on boundaries that leave the process:

  LLM router        — a network call to an inference API
  query understander— an LLM call (its output is a plain dict contract)
  SEC HTTP          — `EdgarSearch(http_client=...)`, recorded fixtures
  Supabase          — `sb_select` (the gate's lookup) and `sb_insert` (persistence)
  structured channel— reads Supabase; returns the same rows the gate sees

`reranker`, `citation_validator` and `semantic_cache` are passed as None, which
the pipeline already supports (`if self.reranker`, `if self.validator`,
`if self.cache`) — they are Cohere and Redis, and neither participates in the
SEC decision.

SEC calls are counted on the injected HTTP client, underneath the channel, so the
number is requests that actually left for sec.gov.
"""

from datetime import timedelta

import pytest

from app.core.retrieval.edgar_search import EdgarSearch
from app.core.retrieval.evidence_gate import (
    LOCAL_CONFLICT,
    LOCAL_MISS,
    LOCAL_UNVERIFIED,
    VERIFIED_LOCAL_HIT,
)
from app.core.retrieval.fusion import RetrievalResult
from app.core.retrieval.orchestrator import RetrievalOrchestrator
from app.core.search_pipeline import SearchPipeline
from app.llm.base import LLMResponse
from app.llm.router import QueryComplexity, RoutingDecision
from tests.test_evidence_gate import (
    ACCN,
    CIK,
    DATA_CENTER,
    THE_QUESTION,
    TICKER,
    _now,
    _row,
)
from tests.test_sec_query_time_regression import _SECFake
from tests.test_verified_evidence_gate import _as_stored

ANSWER = f"NVIDIA reported Data Center revenue of ${DATA_CENTER:,} in Q3 FY2026."

@pytest.fixture(autouse=True)
def _local_corpus_on(local_corpus_channel_enabled):
    """These tests assert the verified-hit bypass, which only exists when the
    local corpus channel can read the row it is bypassing SEC for."""


# ── boundary doubles ────────────────────────────────────────────────────────


class _Provider:
    value = "test"


class _Client:
    """An inference API. Returns a fixed answer so the run is deterministic."""

    model_id = "test-model"
    provider = _Provider()

    async def generate(self, messages, config=None):
        return LLMResponse(content=ANSWER, model=self.model_id, cost_usd=0.0)


class _Router:
    def __init__(self):
        self.client = _Client()

    async def route(self, query):
        return self.client, RoutingDecision(
            complexity=QueryComplexity.SIMPLE,
            primary_model=self.client.model_id,
            provider="test",
            estimated_cost=0.0,
            reasoning="test",
        )

    def select_models_ordered(self, complexity):
        return [self.client]

    def get_client(self, name):
        return self.client

    def get_fast_client(self):
        return self.client


class _QueryUnderstander:
    """The LLM query-planning call. Its contract is a plain dict."""

    async def analyze(self, query):
        return {
            "intent": "simple_lookup",
            "complexity": "simple",
            "entities": {
                "companies": [{"ticker": TICKER, "name": "NVIDIA"}],
                "people": [],
                "dates": [],
                "metrics": ["revenue"],
                "themes": [],
            },
            "expanded_terms": {"original": [query], "synonyms": [], "concepts": []},
            "filters": {},
            "retrieval_channels": ["structured", "edgar"],
            "temporal_intent": "historical",
            "needs_live_data": False,
        }


class _StructuredChannel:
    """
    The local corpus channel, returning the rows the gate also reads.

    It must return real passages, not an empty list: the pipeline treats
    zero retrieval results as "this company is not indexed" and falls through to
    on-demand ingestion, which downloads filings and calls the embedding API.
    An empty stub here would test that path instead of this one.
    """

    def __init__(self, rows):
        self.rows = rows
        self.calls = 0

    async def search(self, *a, **k):
        self.calls += 1
        out = []
        for row in self.rows:
            out.append(
                RetrievalResult(
                    chunk_id=str(row.get("id")),
                    document_id=str(row.get("document_id") or row.get("id")),
                    text=f"{row.get('metric_name')}: {row.get('value_raw')}",
                    score=1.0,
                    ticker=str(row.get("ticker") or ""),
                    document_title=str(row.get("metric_name") or ""),
                    # `structured_search` sets `metadata=r` — the whole row. The
                    # provenance a locally-answered citation is built from lives
                    # in that row, so a double that summarised it would hide the
                    # very hop this file exists to prove.
                    metadata={**row, "source": "structured"},
                )
            )
        return out


class Run:
    """What one real pipeline run actually did."""

    __slots__ = ("events", "sec_urls", "persisted", "structured_calls")

    def __init__(self, events, sec_urls, persisted, structured_calls):
        self.events = events
        self.sec_urls = sec_urls
        self.persisted = persisted
        self.structured_calls = structured_calls

    @property
    def sec_http_calls(self) -> int:
        return len(self.sec_urls)

    @property
    def gate_status(self):
        for e in self.events:
            data = e.data if isinstance(e.data, dict) else {}
            if "local_evidence_status" in data:
                return data["local_evidence_status"]
            meta = data.get("metadata") if isinstance(data.get("metadata"), dict) else None
            if meta and "local_evidence_status" in meta:
                return meta["local_evidence_status"]
        return None

    @property
    def sec_invoked(self):
        for e in self.events:
            data = e.data if isinstance(e.data, dict) else {}
            if "sec_invoked" in data:
                return data["sec_invoked"]
        return None

    @property
    def answer(self) -> str:
        for e in self.events:
            if e.type == "answer":
                d = e.data if isinstance(e.data, dict) else {}
                return d.get("answer") or d.get("text") or ""
        return ""

    @property
    def sources(self) -> list:
        for e in self.events:
            if e.type == "sources":
                return (e.data or {}).get("sources", [])
        return []

    @property
    def metadata(self) -> dict:
        for e in self.events:
            if e.type == "metadata":
                return e.data or {}
        return {}

    @property
    def citations(self) -> list:
        for e in self.events:
            if e.type == "answer":
                return (e.data or {}).get("citations", []) or []
        return []


async def _run_pipeline(rows, query=THE_QUESTION, warm=True):
    """
    One real `SearchPipeline.search()`, with the local corpus set to `rows`.

    Returns the events it emitted, every SEC URL requested, and every row the
    persistence path tried to write.
    """
    import app.db.supabase_rest as sb
    from app.core.retrieval import fact_persistence

    sec = _SECFake()
    structured = _StructuredChannel(rows)
    edgar = EdgarSearch(http_client=sec)

    if warm:
        # Production runs one long-lived EdgarSearch whose ticker map is cached
        # for a day, so a steady-state query does not re-download it. A fresh
        # instance per run would charge every test one identity request that
        # production does not make. Warm it, then start counting.
        await edgar._load_maps()
        sec.urls.clear()

    pipeline = SearchPipeline(
        llm_router=_Router(),
        retrieval_orchestrator=RetrievalOrchestrator(
            structured_search=structured, edgar_search=edgar
        ),
        reranker=None,
        query_understander=_QueryUnderstander(),
        citation_validator=None,
        semantic_cache=None,
    )

    persisted: list[dict] = []

    async def _sb_select(table, filters, select="*", limit=10, offset=0):
        return list(rows) if table == "financials" else []

    async def _sb_insert(table, rows, on_conflict=None):
        persisted.extend(rows)
        return len(rows)

    old = (sb.sb_select, sb.sb_insert, sb.configured)
    sb.sb_select, sb.sb_insert, sb.configured = _sb_select, _sb_insert, lambda: True
    try:
        events = [ev async for ev in pipeline.search(query, stream=False)]
        # persistence is fire-and-forget; let the scheduled task run
        for t in list(getattr(fact_persistence, "_TASKS", []) or []):
            try:
                await t
            except Exception:
                pass
    finally:
        sb.sb_select, sb.sb_insert, sb.configured = old

    return Run(events, list(sec.urls), persisted, structured.calls)


# ── the five required scenarios ─────────────────────────────────────────────


class TestScenario1_VerifiedLocalFact:
    @pytest.mark.asyncio
    async def test_the_pipeline_makes_zero_sec_calls(self):
        r = await _run_pipeline([_row()])
        assert r.gate_status == VERIFIED_LOCAL_HIT
        assert r.sec_invoked is False
        assert r.sec_http_calls == 0, f"SEC was contacted: {r.sec_urls}"

    @pytest.mark.asyncio
    async def test_the_pipeline_still_answers(self):
        r = await _run_pipeline([_row()])
        assert r.answer, "a verified hit must still produce an answer"

    @pytest.mark.asyncio
    async def test_a_cold_channel_costs_one_identity_request_and_no_facts(self):
        """
        Stated exactly rather than rounded to zero: on a cold channel the gate's
        own CIK lookup downloads SEC's ticker file. That is identity, not facts —
        no filing, no companyconcept, no XBRL instance — and production caches it
        for a day on a single long-lived channel. The claim "a verified hit does
        not ask the filer" is about facts, and this pins the difference.
        """
        r = await _run_pipeline([_row()], warm=False)
        assert r.gate_status == VERIFIED_LOCAL_HIT
        assert r.sec_urls == ["https://www.sec.gov/files/company_tickers.json"]
        assert not [u for u in r.sec_urls if "data.sec.gov" in u or "Archives" in u]


class TestScenario2_LocalFactRemoved:
    @pytest.mark.asyncio
    async def test_the_pipeline_calls_sec(self):
        r = await _run_pipeline([])
        assert r.gate_status == LOCAL_MISS
        assert r.sec_invoked is True
        assert r.sec_http_calls > 0

    @pytest.mark.asyncio
    async def test_the_instance_document_is_fetched(self):
        """The segment figure lives only in the filing's XBRL instance."""
        r = await _run_pipeline([])
        assert any(u.endswith("_htm.xml") for u in r.sec_urls), r.sec_urls

    @pytest.mark.asyncio
    async def test_the_exact_verified_fact_reaches_the_answer_path(self):
        """The SEC figure must arrive as a citable source, not just be fetched."""
        r = await _run_pipeline([])
        blob = " ".join(str(s) for s in r.sources)
        assert "EXACT FILING FIGURE" in blob, r.sources
        assert f"{DATA_CENTER:,}" in blob, r.sources
        assert any("10-Q" in str(s.get("title", "")) for s in r.sources), r.sources

    @pytest.mark.asyncio
    async def test_the_citation_names_the_filing_it_came_from(self):
        r = await _run_pipeline([])
        assert r.citations
        c = r.citations[0]
        assert c["ticker"] == TICKER
        assert "10-Q" in c["document_title"]
        assert f"{DATA_CENTER:,}" in c["text"]

    @pytest.mark.asyncio
    async def test_the_fact_is_persisted(self):
        r = await _run_pipeline([])
        assert r.persisted, "a verified SEC fact must be written back"
        ids = [row["id"] for row in r.persisted]
        assert any(i.endswith("_xbrl") for i in ids), ids
        stored = r.persisted[0]
        assert stored["ticker"] == TICKER
        assert str(int(float(stored["value_raw"]))) == str(DATA_CENTER)

    @pytest.mark.asyncio
    async def test_the_persisted_row_carries_verified_provenance(self):
        from app.core.retrieval.evidence_gate import decode_provenance

        r = await _run_pipeline([])
        prov = decode_provenance(r.persisted[0]["source_section"])
        assert prov is not None
        assert prov["ver"] == "verified"
        assert prov["accn"] == ACCN
        assert prov["cik"] == str(CIK)


class TestScenario3_IdenticalQueryAgain:
    @pytest.mark.asyncio
    async def test_the_second_run_makes_zero_sec_calls(self):
        corpus: list[dict] = []

        first = await _run_pipeline(corpus)
        assert first.gate_status == LOCAL_MISS
        assert first.sec_http_calls > 0
        assert first.persisted

        # feed back exactly what the pipeline persisted
        corpus.append(_as_stored(first.persisted[0]))

        second = await _run_pipeline(corpus)
        assert second.gate_status == VERIFIED_LOCAL_HIT
        assert second.sec_invoked is False
        assert second.sec_http_calls == 0, f"SEC re-contacted: {second.sec_urls}"


class TestScenario4_StaleOrUnverifiedLocalFact:
    @pytest.mark.asyncio
    async def test_an_unverified_row_calls_sec(self):
        r = await _run_pipeline([_row(source_section="xbrl_companyfacts")])
        assert r.gate_status == LOCAL_UNVERIFIED
        assert r.sec_http_calls > 0

    @pytest.mark.asyncio
    async def test_a_stale_row_calls_sec(self):
        stale = _row(created_at=(_now() - timedelta(days=400)).isoformat())
        r = await _run_pipeline([stale])
        assert r.gate_status == LOCAL_CONFLICT
        assert r.sec_http_calls > 0


class TestScenario5_ConflictingLocalFact:
    @pytest.mark.asyncio
    async def test_two_disagreeing_rows_call_sec(self):
        r = await _run_pipeline([_row(), _row(value_float=DATA_CENTER + 1)])
        assert r.gate_status == LOCAL_CONFLICT
        assert r.sec_invoked is True
        assert r.sec_http_calls > 0
