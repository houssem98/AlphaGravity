"""
The hops after the answer, through the REAL `SearchPipeline.search()`.

`test_search_pipeline_sec_e2e.py` proves the five routing scenarios: which
channels ran, how many SEC requests left, what was persisted. It stops at the
answer. These continue past it, because the failures that survived that file all
live downstream of the routing decision:

  * the accession was resolved, verified and persisted, then dropped one step
    before the citation, and the citation URL degraded to a generic
    `browse-edgar` company listing
  * a local miss that EDGAR answered could still fall into generic document
    ingestion, which downloads the filing and calls the embedding API
  * the request counts were asserted by matching substrings inside one test,
    which is not something an operator can see in production

Everything reuses the real pipeline harness from the sibling file, so nothing
here re-implements a rule it is meant to be checking.
"""

from __future__ import annotations

import pytest

from app.core.retrieval.evidence_gate import LOCAL_MISS, VERIFIED_LOCAL_HIT
from tests.test_evidence_gate import ACCN, DATA_CENTER, _row
from tests.test_search_pipeline_sec_e2e import _run_pipeline
from tests.test_verified_evidence_gate import _as_stored

EXACT_FILING_URL = (
    "https://www.sec.gov/Archives/edgar/data/1045810/"
    "000104581025000230/0001045810-25-000230-index.htm"
)


@pytest.fixture(autouse=True)
def _local_corpus_on(local_corpus_channel_enabled):
    """These tests assert the verified-hit bypass, which only exists when the
    local corpus channel can read the row it is bypassing SEC for."""


class TestCitationProvenanceThroughThePipeline:
    """
    Fails if any hop between the SEC client and the emitted `answer` event drops
    the accession.
    """

    @pytest.mark.asyncio
    async def test_the_citation_carries_the_accession(self):
        r = await _run_pipeline([])
        assert r.citations[0]["accession"] == ACCN

    @pytest.mark.asyncio
    async def test_the_citation_points_at_the_exact_filing(self):
        c = (await _run_pipeline([])).citations[0]
        assert c["url"] == EXACT_FILING_URL
        assert c["filing_url"] == EXACT_FILING_URL
        assert "browse-edgar" not in c["url"], "a company listing, not the filing"

    @pytest.mark.asyncio
    async def test_the_citation_value_period_and_segment_match_the_question(self):
        p = (await _run_pipeline([])).citations[0]["provenance"]
        assert p["value"] == DATA_CENTER
        assert (p["fiscal_year"], p["fiscal_quarter"]) == (2026, 3)
        assert (p["period_start"], p["period_end"]) == ("2025-07-28", "2025-10-26")
        assert p["unit"] == "USD"
        assert p["scope"] == "segment"
        assert "datacenter" in " ".join(map(str, p["dimension_value"])).lower()
        assert p["verification_status"] == "verified"

    @pytest.mark.asyncio
    async def test_the_locally_answered_citation_also_names_the_filing(self):
        """
        The second ask is served from the row the first ask persisted. If
        provenance stopped at the database that answer would be uncitable, which
        would make persistence a latency trick rather than a corpus.
        """
        corpus: list[dict] = []
        first = await _run_pipeline(corpus)
        corpus.append(_as_stored(first.persisted[0]))

        second = await _run_pipeline(corpus)
        assert second.gate_status == VERIFIED_LOCAL_HIT
        assert second.sec_http_calls == 0
        c = second.citations[0]
        assert c["accession"] == ACCN
        assert c["filing_url"] == EXACT_FILING_URL
        assert c["provenance"]["xbrl_concept"] == "Revenues"


class TestOnDemandIngestionIsolation:
    """
    S17. A missing structured financial fact must not fall into the generic
    document ingestion pipeline: download the filing, chunk it, call the
    embedding API. The only guard is `if not top_passages` at Stage 4b, and
    `on_demand_ingest_enabled` defaults to True, so nothing but the EDGAR answer
    stands between an empty corpus and that path.
    """

    @pytest.mark.asyncio
    async def test_an_empty_corpus_answered_by_sec_never_ingests(self, monkeypatch):
        import app.ingestion.on_demand as od

        def _never(*a, **k):
            raise AssertionError(
                "exact financial-fact resolution fell into generic ingestion"
            )

        monkeypatch.setattr(od, "get_on_demand_ingestor", _never)

        r = await _run_pipeline([])
        assert r.gate_status == LOCAL_MISS
        assert r.answer, "the answer came from the filing, not from ingestion"
        assert f"{DATA_CENTER:,}" in " ".join(str(s) for s in r.sources)

    @pytest.mark.asyncio
    async def test_a_verified_local_hit_never_ingests_either(self, monkeypatch):
        import app.ingestion.on_demand as od

        monkeypatch.setattr(
            od, "get_on_demand_ingestor",
            lambda *a, **k: (_ for _ in ()).throw(
                AssertionError("ingestion path entered on a verified local hit")
            ),
        )
        r = await _run_pipeline([_row()])
        assert r.gate_status == VERIFIED_LOCAL_HIT
        assert r.answer


class TestTheRequestsThatActuallyLeft:
    """
    S18 / S21. `sec_invoked` is the gate's intent; these are the requests that
    really left, counted at the client the channel wraps and reported in the
    `metadata` event so an operator sees them without reading a test.
    """

    @pytest.mark.asyncio
    async def test_a_verified_hit_costs_no_fact_filing_or_archive_request(self):
        m = (await _run_pipeline([_row()])).metadata
        assert m["sec_fact_requests"] == 0
        assert m["sec_filing_requests"] == 0
        assert m["sec_archive_requests"] == 0

    @pytest.mark.asyncio
    async def test_a_cold_verified_hit_costs_one_identity_request_and_nothing_else(self):
        """
        Stated rather than rounded to zero: resolving the CIK reads SEC's ticker
        file. That is the phone book, not a fact about a period, and production
        caches it for a day on one long-lived channel.
        """
        m = (await _run_pipeline([_row()], warm=False)).metadata
        assert m["sec_identity_requests"] == 1
        assert m["sec_fact_requests"] == 0
        assert m["sec_filing_requests"] == 0
        assert m["sec_archive_requests"] == 0

    @pytest.mark.asyncio
    async def test_a_local_miss_measures_what_the_filing_cost(self):
        m = (await _run_pipeline([])).metadata
        # Measured, not a target: the concept endpoint, the filing index, and
        # the instance document. S21 asks for the number, not a bound.
        assert m["sec_fact_requests"] >= 1
        assert m["sec_filing_requests"] == 1
        assert m["sec_archive_requests"] == 1

    @pytest.mark.asyncio
    async def test_the_second_query_costs_nothing_again(self):
        corpus: list[dict] = []
        first = await _run_pipeline(corpus)
        assert first.metadata["sec_fact_requests"] >= 1
        corpus.append(_as_stored(first.persisted[0]))

        second = await _run_pipeline(corpus)
        assert second.metadata["sec_fact_requests"] == 0
        assert second.metadata["sec_filing_requests"] == 0
        assert second.metadata["sec_archive_requests"] == 0

    @pytest.mark.asyncio
    async def test_telemetry_names_the_filing_the_answer_rests_on(self):
        m = (await _run_pipeline([])).metadata
        assert m["source_accession"] == ACCN
        assert m["source_filing_url"] == EXACT_FILING_URL
        assert m["verification_status"] == "verified"


class TestTheBypassIsRefusedWhenNothingCanReadTheRow:
    """
    The gate proves the row is exactly right. Dropping `edgar` additionally
    requires that something will read it, and `structured_search` returns `[]`
    unconditionally when `structured_facts_enabled` is off, which is the default.
    Bypassing anyway removes the exact figure and answers from prose instead.
    """

    @pytest.mark.asyncio
    async def test_the_filer_is_asked_even_on_a_verified_hit(self, monkeypatch):
        from app.config import settings

        monkeypatch.setattr(settings, "structured_facts_enabled", False)
        r = await _run_pipeline([_row()])
        assert r.gate_status == VERIFIED_LOCAL_HIT, "the evidence is still a hit"
        assert r.sec_invoked is True, "and the filer is still asked"
        assert r.sec_http_calls > 0

    @pytest.mark.asyncio
    async def test_the_telemetry_says_the_bypass_was_blocked_and_why(self, monkeypatch):
        from app.config import settings

        monkeypatch.setattr(settings, "structured_facts_enabled", False)
        m = (await _run_pipeline([_row()])).metadata
        assert m["sec_skip_reason"] is None
        assert "not enabled" in m["gate_bypass_blocked"]
