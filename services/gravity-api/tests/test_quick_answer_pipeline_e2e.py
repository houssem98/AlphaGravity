"""Quick Answer through the REAL `SearchPipeline.search()` (roadmap Phases 8, 9).

`test_quick_answer_eval_gate.py` grades the verification layer in isolation, and
`test_search_stream_contract.py` drives the real WebSocket route with a
substituted pipeline. Neither proves the thing in the middle: that the pipeline
the route actually drives runs retrieval, generation, citation binding and
verdict computation in one pass and emits a truthful stream.

Nothing here substitutes for the pipeline. `SearchPipeline` is the real class,
`_normalize_citations` and `citation_verdict` run where the pipeline runs them,
and the events are the ones a browser would receive.

Doubles sit only on boundaries that leave the process, and each is unavailable
in this environment for a reason recorded in FINAL_VERIFICATION.md:

  retrieval channel  — Qdrant :6333 / Elasticsearch :9200 refuse connections
                       (Docker daemon is not running); fixture passages instead
  LLM router         — a network call to an inference API; a fixed answer keeps
                       the run deterministic
  query understander — an LLM call whose contract is a plain dict
  reranker / cache   — Cohere and Redis, passed as None (the pipeline supports it)

The decisive test is `test_a_fabricated_citation_is_caught_end_to_end`: the
model emits a citation to a passage that does not exist, and the assertion is
that it reaches the client marked `unsupported`, not verified. That is the
original defect, checked through the whole machine rather than against the
verdict function alone.
"""

import pytest

from app.core.retrieval.fusion import RetrievalResult
from app.core.retrieval.orchestrator import ChannelResults
from app.core.search_pipeline import SearchPipeline
from app.llm.base import LLMResponse
from app.llm.router import QueryComplexity, RoutingDecision

TICKER = "NVDA"
REVENUE_TEXT = "Revenue for fiscal year 2025 was $130,497 million."
DC_TEXT = "Data Center revenue for fiscal 2025 was $115,186 million."
FILING_URL = "https://www.sec.gov/Archives/edgar/data/1045810/000104581025000023/nvda-20250126.htm"


def _passage(i, chunk_id, text, url=FILING_URL):
    return RetrievalResult(
        document_id=f"doc-{i}",
        chunk_id=chunk_id,
        text=text,
        score=0.9 - i * 0.1,
        document_title="NVIDIA 10-K FY2025",
        document_type="10-K",
        source_quality=1,
        metadata={
            "ticker": TICKER,
            "source_url": url,
            "filing_url": url,
            # `accn` is the discriminator citation_provenance keys on — a
            # passage without one cannot name its filing, so it gets no
            # provenance rather than an invented URL.
            "accn": "0001045810-25-000023",
            "cik": 1045810,
            "form": "10-K",
            "filing_date": "2025-02-26",
            "issuer": "NVIDIA CORP",
            "verification_status": "verified",
        },
    )


PASSAGES = [
    _passage(0, "c1", REVENUE_TEXT),
    _passage(1, "c2", DC_TEXT),
]


# ── boundary doubles ────────────────────────────────────────────────────────

class _Provider:
    value = "test"


class _Client:
    model_id = "test-model"
    provider = _Provider()

    def __init__(self, answer_json: str):
        self._answer = answer_json

    async def generate(self, messages, config=None):
        return LLMResponse(content=self._answer, model=self.model_id, cost_usd=0.0)

    async def generate_stream(self, messages, config=None):
        # The pipeline streams by default; yielding in chunks also exercises the
        # partial-answer extraction that drives the `token` events.
        for i in range(0, len(self._answer), 40):
            yield self._answer[i:i + 40]


class _Router:
    def __init__(self, client):
        self.client = client

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
    async def analyze(self, query):
        return {
            "intent": "simple_lookup",
            "complexity": "simple",
            "entities": {
                "companies": [{"ticker": TICKER, "name": "NVIDIA"}],
                "people": [], "dates": [], "metrics": ["revenue"], "themes": [],
            },
            "expanded_terms": {"original": [query], "synonyms": [], "concepts": []},
            "filters": {},
            "retrieval_channels": ["dense"],
            "temporal_intent": "historical",
            "needs_live_data": False,
        }


class _Orchestrator:
    """The retrieval boundary. Returns fixture passages and records the failure
    state, so the pipeline's degraded reporting is exercised for real."""

    def __init__(self, passages, failed=None):
        self.passages = passages
        self.failed = failed or {}

    async def search(self, **kwargs):
        return ChannelResults({"dense": list(self.passages)}, failed=dict(self.failed))

    async def search_multi_entity(self, **kwargs):
        return await self.search(**kwargs)


def _pipeline(answer_json, passages=PASSAGES, failed=None):
    return SearchPipeline(
        llm_router=_Router(_Client(answer_json)),
        retrieval_orchestrator=_Orchestrator(passages, failed),
        reranker=None,
        query_understander=_QueryUnderstander(),
        citation_validator=None,
        semantic_cache=None,
    )


async def _run(pipeline, query="What was NVIDIA revenue in FY2025?"):
    events = []
    async for e in pipeline.search(query=query, stream=True,
                                   reasoning_depth="fast", user_id="u1",
                                   trace_id="e2e-trace"):
        events.append(e)
    return events


def _of(events, type_):
    return [e for e in events if e.type == type_]


GOOD_ANSWER = (
    '{"answer": "Revenue for fiscal year 2025 was $130,497 million [1].",'
    ' "citations": [{"id": 1, "chunk_id": "c1", "text": "Revenue for fiscal year 2025 was $130,497 million.", "entailed": true}],'
    ' "confidence": "HIGH"}'
)

FABRICATED_ANSWER = (
    '{"answer": "Revenue for fiscal year 2025 was $999,999 million [99].",'
    ' "citations": [{"id": 99, "text": "Revenue for fiscal year 2025 was $999,999 million.", "entailed": true}],'
    ' "confidence": "HIGH"}'
)

WRONG_PERIOD_ANSWER = (
    '{"answer": "Revenue for fiscal year 2023 was $130,497 million [1].",'
    ' "citations": [{"id": 1, "chunk_id": "c1", "text": "Revenue for fiscal year 2023 was $130,497 million.", "entailed": true}],'
    ' "confidence": "HIGH"}'
)


# ── the stream is well formed and truthful ──────────────────────────────────

@pytest.mark.asyncio
async def test_the_pipeline_emits_a_complete_ordered_stream():
    events = await _run(_pipeline(GOOD_ANSWER))
    types = [e.type for e in events]

    assert "status" in types
    assert "retrieval" in types, "the retrieval event never reached the client"
    assert "sources" in types
    assert _of(events, "answer"), "no answer event"

    # Identity on every event, so a client can order and deduplicate them.
    for e in events:
        assert e.trace_id == "e2e-trace"
        assert e.event_id
        assert e.ts > 0


@pytest.mark.asyncio
async def test_only_declared_stages_are_emitted():
    """A stage the UI cannot render is a bug in the pipeline, not a feature."""
    from app.core.search_pipeline import SEARCH_STAGES

    events = await _run(_pipeline(GOOD_ANSWER))
    for e in _of(events, "status"):
        stage = (e.data or {}).get("status", "")
        assert stage in SEARCH_STAGES, f"undeclared stage emitted: {stage}"


@pytest.mark.asyncio
async def test_the_retrieval_event_reports_the_channel_that_actually_ran():
    events = await _run(_pipeline(GOOD_ANSWER))
    d = _of(events, "retrieval")[0].data
    assert d["channels_used"] == ["dense"]
    assert d["channels_failed"] == {}
    assert d["degraded"] is False
    assert d["passages_used"] == 2


@pytest.mark.asyncio
async def test_a_failed_channel_is_reported_as_failed_not_as_empty():
    pipe = _pipeline(GOOD_ANSWER, failed={"bm25": "ConnectionError"})
    events = await _run(pipe)
    d = _of(events, "retrieval")[0].data
    assert d["channels_failed"] == {"bm25": "ConnectionError"}
    assert d["degraded"] is True
    assert "bm25" not in d["channels_dark"], "an errored channel was reported as merely empty"


# ── provenance survives the whole pipeline ──────────────────────────────────

@pytest.mark.asyncio
async def test_the_source_url_reaches_the_client_intact():
    events = await _run(_pipeline(GOOD_ANSWER))
    sources = _of(events, "sources")[-1].data["sources"]
    assert sources, "no sources emitted"
    urls = [s.get("canonical_url") or s.get("filing_url") or s.get("url") for s in sources]
    assert FILING_URL in urls, f"the exact filing URL was dropped; got {urls}"
    assert sources[0]["chunk_id"] == "c1"


# ── the decisive one: a fabricated citation, caught by the whole machine ────

@pytest.mark.asyncio
async def test_a_fabricated_citation_is_caught_end_to_end():
    """The original defect, through the real pipeline rather than the verdict
    function: the model cites [99] against two passages and reports it entailed."""
    events = await _run(_pipeline(FABRICATED_ANSWER))
    answer = _of(events, "answer")[-1].data
    cites = answer["citations"]

    assert cites, "the fabricated citation vanished instead of being graded"
    bad = [c for c in cites if c["citation_number"] == 99]
    assert bad, f"citation 99 not present; got {[c['citation_number'] for c in cites]}"
    assert bad[0]["is_verified"] is False, "a fabricated citation reached the client verified"
    assert bad[0]["verification_status"] == "unsupported"
    assert "citation_index_out_of_range" in bad[0]["verification_reasons"]


@pytest.mark.asyncio
async def test_a_wrong_period_citation_is_marked_conflicting_end_to_end():
    events = await _run(_pipeline(WRONG_PERIOD_ANSWER))
    cites = _of(events, "answer")[-1].data["citations"]
    graded = [c for c in cites if c["chunk_id"] == "c1"]
    assert graded, "the citation did not bind to its passage"
    assert graded[0]["verification_status"] == "conflicting"
    assert graded[0]["is_verified"] is False


@pytest.mark.asyncio
async def test_a_sound_citation_is_still_verified_end_to_end():
    """Without this, everything above is satisfied by rejecting all citations."""
    events = await _run(_pipeline(GOOD_ANSWER))
    cites = _of(events, "answer")[-1].data["citations"]
    good = [c for c in cites if c["chunk_id"] == "c1"]
    assert good, "the sound citation did not bind"
    assert good[0]["verification_status"] == "verified"
    assert good[0]["is_verified"] is True


# ── metadata tells the truth about what ran ─────────────────────────────────

@pytest.mark.asyncio
async def test_metadata_names_the_model_that_actually_answered():
    events = await _run(_pipeline(GOOD_ANSWER))
    meta = _of(events, "metadata")
    if not meta:                      # fast path may end at `answer`
        pytest.skip("no metadata event on this path")
    d = meta[-1].data
    assert d["model_used"] == "test-model"
    assert d["retrieval_channels"] == ["dense"]
    assert d["trace_id"] == "e2e-trace"


@pytest.mark.asyncio
async def test_a_passage_with_no_filing_gets_no_invented_url():
    """The mirror of the test above, and the one that matters for honesty: a
    local prose chunk has no accession, so it must reach the client with no
    filing URL rather than a reconstructed company listing."""
    bare = RetrievalResult(
        document_id="doc-x", chunk_id="cx",
        text="Management discussed demand trends during the period.",
        score=0.5, document_title="Internal note", document_type="note",
        source_quality=3, metadata={"ticker": TICKER},
    )
    events = await _run(_pipeline(GOOD_ANSWER, passages=[bare]))
    src = _of(events, "sources")[-1].data["sources"][0]

    assert not src.get("canonical_url"), f"invented a URL: {src.get('canonical_url')}"
    assert not src.get("filing_url")
    assert not src.get("accession")
    # And it is still shown — honestly, as an indexed source.
    assert src["chunk_id"] == "cx"
    assert src["text"].startswith("Management discussed")


@pytest.mark.asyncio
async def test_filing_provenance_cannot_overwrite_the_citation_verdict():
    """A named regression.

    The SEC provenance payload carries its own `verification_status`, meaning
    "this filing was verified against the filer". Applying it with
    `citation.update(...)` overwrote the citation verdict, so a citation whose
    period contradicted its passage arrived marked `verified` while still
    listing `period_mismatch` among its reasons — a false-verified produced by
    two fields sharing a name.
    """
    events = await _run(_pipeline(WRONG_PERIOD_ANSWER))
    cite = [c for c in _of(events, "answer")[-1].data["citations"]
            if c["chunk_id"] == "c1"][0]

    assert cite["verification_status"] == "conflicting"
    assert cite["is_verified"] is False
    # The status and the reasons must describe the same verdict.
    assert "period_mismatch" in cite["verification_reasons"]
    # The filing's own state is preserved, under a name that cannot collide.
    assert cite.get("filing_verification_status") == "verified"
    # And the exact filing is still reachable.
    assert cite["canonical_url"] == FILING_URL


@pytest.mark.asyncio
async def test_a_verified_citation_keeps_one_consistent_status():
    events = await _run(_pipeline(GOOD_ANSWER))
    cite = [c for c in _of(events, "answer")[-1].data["citations"]
            if c["chunk_id"] == "c1"][0]
    assert cite["verification_status"] == "verified"
    assert cite["is_verified"] is True
    # No stale second opinion left on the object.
    assert "filing_verification_status" not in cite
