"""
S14: the actual AlphaGravity flow, EOG, through the REAL `SearchPipeline`.

    query -> retrieval -> evidence -> citation -> API response -> source click

`test_source_click_url.py` proves the URL policy against the resolver and the
citation builders. It stops short of the pipeline, and a pipeline that computed
the provenance and then emitted a source card without it would pass every test
in that file — which is exactly the shape the original bug had.

So `SearchPipeline`, `RetrievalOrchestrator` and `EdgarSearch` are the real
classes here, and the assertions are made against the events the WebSocket route
actually emits: the `sources` event the user clicks, and the `answer` event's
citations.

Both required runs are here:

  A. local miss -> SEC -> exact EOG 10-K -> accession -> exact URL -> click
  B. the same question again, answered from the row run A persisted, which must
     produce the SAME accession and the SAME exact filing URL

Mocks sit only on boundaries that leave the process — the LLM router, the query
understander, the SEC HTTP client (the recorded EOG fixture) and Supabase.
"""

from __future__ import annotations

import json

import pytest

from app.core.retrieval.edgar_search import EdgarSearch
from app.core.retrieval.evidence_gate import LOCAL_MISS, VERIFIED_LOCAL_HIT
from app.core.retrieval.orchestrator import RetrievalOrchestrator
from app.core.search_pipeline import SearchPipeline
from tests.test_search_pipeline_sec_e2e import Run, _Router, _StructuredChannel
from tests.test_source_click_url import (
    ACCN,
    CIK,
    EXACT_FILING_URL,
    FY2024_REVENUE,
    GENERIC_BROWSE,
    ISSUER,
    QUESTION,
    TICKER,
    _EogSEC,
)


@pytest.fixture(autouse=True)
def _local_corpus_on(local_corpus_channel_enabled):
    """Run B asserts the verified-hit bypass, which only exists when the local
    corpus channel can read the row it is bypassing SEC for."""


class _EogUnderstander:
    """The LLM query-planning call. Its contract is a plain dict."""

    async def analyze(self, query):
        return {
            "intent": "simple_lookup",
            "complexity": "simple",
            "entities": {
                "companies": [{"ticker": TICKER, "name": "EOG Resources"}],
                "people": [], "dates": [], "metrics": ["revenue"], "themes": [],
            },
            "expanded_terms": {"original": [query], "synonyms": [], "concepts": []},
            "filters": {},
            "retrieval_channels": ["structured", "edgar"],
            "temporal_intent": "historical",
            "needs_live_data": False,
        }


async def _run(rows, query=QUESTION):
    """One real `SearchPipeline.search()` with the local corpus set to `rows`."""
    import app.db.supabase_rest as sb
    from app.core.retrieval import fact_persistence

    sec = _EogSEC()
    structured = _StructuredChannel(rows)
    edgar = EdgarSearch(http_client=sec)
    await edgar._load_maps()
    sec.urls.clear()

    pipeline = SearchPipeline(
        llm_router=_Router(),
        retrieval_orchestrator=RetrievalOrchestrator(
            structured_search=structured, edgar_search=edgar
        ),
        reranker=None,
        query_understander=_EogUnderstander(),
        citation_validator=None,
        semantic_cache=None,
    )

    persisted: list[dict] = []

    async def _sb_select(table, filters, select="*", limit=10, offset=0):
        return list(rows) if table == "financials" else []

    async def _sb_insert(table, insert_rows, on_conflict=None):
        persisted.extend(insert_rows)
        return len(insert_rows)

    old = (sb.sb_select, sb.sb_insert, sb.configured)
    sb.sb_select, sb.sb_insert, sb.configured = _sb_select, _sb_insert, lambda: True
    try:
        events = [ev async for ev in pipeline.search(query, stream=False)]
        for t in list(getattr(fact_persistence, "_PENDING", set()) or set()):
            try:
                await t
            except Exception:
                pass
    finally:
        sb.sb_select, sb.sb_insert, sb.configured = old

    return Run(events, list(sec.urls), persisted, structured.calls)


def _as_stored(row):
    """The row as it reads back OUT of `financials` — Postgres assigns
    `created_at`, which the freshness check reads."""
    return {**row, "created_at": "2026-08-26T00:00:00+00:00"}


# ── A. local miss -> SEC -> exact filing -> source click ────────────────────


class TestRunA_SecPath:
    @pytest.mark.asyncio
    async def test_the_question_reaches_sec_and_resolves_the_filing(self):
        r = await _run([])
        assert r.gate_status == LOCAL_MISS
        assert r.sec_http_calls > 0

    @pytest.mark.asyncio
    async def test_the_source_card_click_target_is_the_exact_filing(self):
        """The object the user clicks. It used to carry no URL at all."""
        r = await _run([])
        assert r.sources, "a source card must be emitted"
        s = r.sources[0]
        assert s["accession"] == ACCN
        assert s["accession_number"] == ACCN
        assert s["canonical_url"] == EXACT_FILING_URL
        assert s["filing_url"] == EXACT_FILING_URL

    @pytest.mark.asyncio
    async def test_no_source_card_carries_a_company_listing(self):
        r = await _run([])
        assert GENERIC_BROWSE not in json.dumps(r.sources, default=str)

    @pytest.mark.asyncio
    async def test_the_source_card_names_the_filing_it_opens(self):
        """S12: issuer, form, fiscal period, accession."""
        s = (await _run([])).sources[0]
        assert s["issuer"] == ISSUER
        assert s["ticker"] == TICKER
        assert s["cik"] == CIK
        assert s["form"] == "10-K"
        assert s["fiscal_period"] == "FY2024"
        assert s["verification_status"] == "verified"

    @pytest.mark.asyncio
    async def test_the_citation_click_target_is_the_same_exact_filing(self):
        r = await _run([])
        c = r.citations[0]
        assert c["url"] == EXACT_FILING_URL
        assert c["filing_url"] == EXACT_FILING_URL
        assert c["accession"] == ACCN

    @pytest.mark.asyncio
    async def test_the_source_and_the_citation_do_not_disagree(self):
        r = await _run([])
        assert r.sources[0]["canonical_url"] == r.citations[0]["canonical_url"]

    @pytest.mark.asyncio
    async def test_the_value_is_the_one_the_filing_reports(self):
        r = await _run([])
        assert r.citations[0]["provenance"]["value"] == FY2024_REVENUE

    @pytest.mark.asyncio
    async def test_the_filing_is_persisted_for_the_next_ask(self):
        r = await _run([])
        assert r.persisted, "the verified fact must be written back"
        assert ACCN in r.persisted[0]["document_id"]

    @pytest.mark.asyncio
    async def test_telemetry_names_the_filing_the_answer_rests_on(self):
        m = (await _run([])).metadata
        assert m["source_accession"] == ACCN
        assert m["source_filing_url"] == EXACT_FILING_URL


# ── B. the same question, answered from the persisted row ───────────────────


class TestRunB_PersistedLocalPath:
    """
    S10, the critical one: an exact URL on the SEC path and a company listing on
    the local path would be worse than either alone, because it is invisible
    until someone clicks the second answer.
    """

    @pytest.mark.asyncio
    async def test_the_second_ask_is_answered_locally(self):
        corpus: list[dict] = []
        first = await _run(corpus)
        corpus.append(_as_stored(first.persisted[0]))

        second = await _run(corpus)
        assert second.gate_status == VERIFIED_LOCAL_HIT
        assert second.sec_http_calls == 0, f"SEC re-contacted: {second.sec_urls}"

    @pytest.mark.asyncio
    async def test_the_local_source_card_opens_the_same_exact_filing(self):
        corpus: list[dict] = []
        first = await _run(corpus)
        corpus.append(_as_stored(first.persisted[0]))
        second = await _run(corpus)

        s = second.sources[0]
        assert s["accession"] == ACCN
        assert s["canonical_url"] == EXACT_FILING_URL
        assert GENERIC_BROWSE not in json.dumps(second.sources, default=str)

    @pytest.mark.asyncio
    async def test_the_local_citation_opens_the_same_exact_filing(self):
        corpus: list[dict] = []
        first = await _run(corpus)
        corpus.append(_as_stored(first.persisted[0]))
        second = await _run(corpus)

        c = second.citations[0]
        assert c["url"] == EXACT_FILING_URL
        assert c["filing_url"] == EXACT_FILING_URL
        assert c["accession"] == ACCN

    @pytest.mark.asyncio
    async def test_both_runs_agree_on_the_click_target(self):
        """The assertion S10 exists for, stated directly."""
        corpus: list[dict] = []
        first = await _run(corpus)
        corpus.append(_as_stored(first.persisted[0]))
        second = await _run(corpus)

        assert (
            first.sources[0]["canonical_url"]
            == second.sources[0]["canonical_url"]
            == EXACT_FILING_URL
        )
        assert (
            first.citations[0]["accession"]
            == second.citations[0]["accession"]
            == ACCN
        )
