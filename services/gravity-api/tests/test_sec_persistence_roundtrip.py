"""
Write the fact, read it back, and prove nothing was lost on the way.

`test_sec_fact_persistence.py` checks the shape of the row the writer produces.
That is one half. The half that matters to a user is the other one: the fact
comes back out of `financials` days later and has to be enough, on its own, to
(a) satisfy the evidence gate so SEC is not re-asked, and (b) rebuild a citation
that names the same filing, period, dimension, unit and value as the original.

If either half fails, persistence is not a corpus. It is a latency trick that
answers the second ask worse than the first.

The round trip here is the real one:

    live EDGAR result
      -> fact_persistence.fact_row      (the row inserted)
      -> `created_at` assigned by Postgres
      -> evidence_gate.evaluate         (does it bypass SEC?)
      -> citation_provenance.provenance (can it still be cited?)

`_as_stored` is used rather than the writer's dict directly because `fact_row`
deliberately omits `created_at` — the column carries a database default — and the
gate reads that field to judge freshness. Asserting against the pre-insert dict
would be asserting against a row shape that never reaches the gate.
"""

from __future__ import annotations

import pytest

from app.core.retrieval import citation_provenance as cp
from app.core.retrieval.edgar_search import EdgarSearch
from app.core.retrieval.evidence_gate import (
    VERIFIED_LOCAL_HIT,
    decode_provenance,
    evaluate,
)
from app.core.retrieval.fact_persistence import fact_row
from tests.test_evidence_gate import (
    ACCN,
    CIK,
    COMPANY_TERMS,
    CONCEPT,
    DATA_CENTER,
    FQ,
    FY,
    THE_QUESTION,
    TICKER,
    _now,
)
from tests.test_sec_query_time_regression import _SECFake
from tests.test_verified_evidence_gate import _as_stored


async def _resolved():
    """The Data Center fact exactly as the live channel resolves it."""
    out = await EdgarSearch(http_client=_SECFake()).search(THE_QUESTION, top_k=5)
    assert out
    return out[0]


async def _round_trip():
    """(original result, row as it reads back out of `financials`)."""
    result = await _resolved()
    return result, _as_stored(fact_row(result), at=_now())


class TestTheRowSatisfiesTheGateItWasWrittenFor:
    @pytest.mark.asyncio
    async def test_the_persisted_fact_bypasses_sec_on_the_next_ask(self):
        _r, stored = await _round_trip()
        d = evaluate(
            [stored], query=THE_QUESTION, ticker=TICKER, cik=CIK, concept=CONCEPT,
            fiscal_year=FY, fiscal_quarter=FQ, now=_now(),
            company_terms=COMPANY_TERMS,
        )
        assert d.status == VERIFIED_LOCAL_HIT, d.reason
        assert d.sec_invoked is False

    @pytest.mark.asyncio
    async def test_the_row_the_gate_returns_is_the_row_that_answers(self):
        _r, stored = await _round_trip()
        d = evaluate(
            [stored], query=THE_QUESTION, ticker=TICKER, cik=CIK, concept=CONCEPT,
            fiscal_year=FY, fiscal_quarter=FQ, now=_now(),
            company_terms=COMPANY_TERMS,
        )
        assert d.row["value_float"] == DATA_CENTER


class TestEveryProvenanceFieldSurvivesTheDatabase:
    """
    S16 names the minimum: value, metric, period, dimensions, unit, accession,
    filing, source, verification state, evidence location. Each is asserted
    against the ORIGINAL live result rather than against a literal, so a change
    to the resolver that stops emitting one of them fails here too.
    """

    @pytest.mark.asyncio
    async def test_the_value_survives(self):
        r, stored = await _round_trip()
        assert stored["value_float"] == r.metadata["value"] == DATA_CENTER
        assert stored["value_raw"] == str(DATA_CENTER)

    @pytest.mark.asyncio
    async def test_the_metric_and_concept_survive(self):
        r, stored = await _round_trip()
        prov = decode_provenance(stored["source_section"])
        assert prov["concept"] == r.metadata["tag"]
        assert stored["metric_name"].startswith("Revenue")

    @pytest.mark.asyncio
    async def test_the_period_survives_as_a_span_not_only_a_label(self):
        """
        The label alone is not the period. The same filing tags a 272-day
        year-to-date column under the same concept, and only the span separates
        them.
        """
        r, stored = await _round_trip()
        prov = decode_provenance(stored["source_section"])
        assert stored["period"] == "FY2026Q3"
        assert prov["fy"] == str(r.metadata["fiscal_year"])
        assert prov["fq"] == str(r.metadata["fiscal_quarter"])
        assert prov["start"] == r.metadata["period_start"]
        assert prov["end"] == r.metadata["period_end"]

    @pytest.mark.asyncio
    async def test_the_dimension_survives(self):
        r, stored = await _round_trip()
        prov = decode_provenance(stored["source_section"])
        assert prov["scope"] == "segment"
        assert prov["dim"] == r.metadata["row_label"]

    @pytest.mark.asyncio
    async def test_the_unit_survives(self):
        r, stored = await _round_trip()
        prov = decode_provenance(stored["source_section"])
        assert stored["unit"] == prov["unit"] == r.metadata["unit"] == "USD"

    @pytest.mark.asyncio
    async def test_the_accession_and_filing_survive(self):
        r, stored = await _round_trip()
        prov = decode_provenance(stored["source_section"])
        assert prov["accn"] == r.metadata["accn"] == ACCN
        assert prov["form"] == r.metadata["form"] == "10-Q"
        assert prov["filed"] == r.metadata["filed"]
        assert ACCN in stored["document_id"]

    @pytest.mark.asyncio
    async def test_the_source_and_issuer_survive(self):
        r, stored = await _round_trip()
        prov = decode_provenance(stored["source_section"])
        assert prov["src"] == "filing_instance"
        assert prov["issuer"] == r.metadata["issuer"]

    @pytest.mark.asyncio
    async def test_the_verification_state_survives(self):
        r, stored = await _round_trip()
        prov = decode_provenance(stored["source_section"])
        assert prov["ver"] == r.metadata["verification_status"] == "verified"
        assert prov["pv"] == r.metadata["parser_version"]

    @pytest.mark.asyncio
    async def test_the_evidence_location_survives(self):
        """Which artefact, and where inside it. CIK and accession rebuild the
        archive path, so the filename and the XBRL context element are the only
        two that have to be stored."""
        r, stored = await _round_trip()
        prov = decode_provenance(stored["source_section"])
        assert prov["meth"] == r.metadata["extraction_method"] == "filing_instance"
        assert prov["ctx"] == r.metadata["context_id"]
        assert r.metadata["document_url"].endswith(prov["loc"])


class TestTheCitationRebuiltFromTheDatabaseNamesTheSameFiling:
    """
    The user-visible half. A stored row has to reconstruct a citation that a
    reader could check by hand against the filing.
    """

    @pytest.mark.asyncio
    async def test_the_rebuilt_citation_matches_the_original_field_for_field(self):
        r, stored = await _round_trip()
        live = cp.provenance(r.metadata, ticker=TICKER)
        rebuilt = cp.provenance(stored, ticker=TICKER)
        assert rebuilt is not None

        for field in (
            "issuer", "ticker", "accession", "filing_form", "filing_date",
            "period_start", "period_end", "unit", "xbrl_concept", "value",
            "verification_status", "filing_url", "parser_version",
            "extraction_method", "scope",
        ):
            assert rebuilt.get(field) == live.get(field), field

    @pytest.mark.asyncio
    async def test_the_rebuilt_citation_points_at_the_exact_filing(self):
        r, stored = await _round_trip()
        rebuilt = cp.provenance(stored, ticker=TICKER)
        assert rebuilt["filing_url"] == r.metadata["filing_url"]
        assert "browse-edgar" not in rebuilt["filing_url"]

    @pytest.mark.asyncio
    async def test_the_rebuilt_citation_names_the_segment(self):
        _r, stored = await _round_trip()
        rebuilt = cp.provenance(stored, ticker=TICKER)
        assert rebuilt["scope"] == "segment"
        assert "data center" in " ".join(map(str, rebuilt["dimension_value"])).lower()

    @pytest.mark.asyncio
    async def test_the_rebuilt_evidence_location_addresses_the_instance(self):
        r, stored = await _round_trip()
        rebuilt = cp.provenance(stored, ticker=TICKER)
        doc, _, ctx = rebuilt["evidence_location"].partition("#")
        assert doc == r.metadata["document_url"]
        assert ctx == r.metadata["context_id"]

    @pytest.mark.asyncio
    async def test_the_fiscal_period_is_still_readable_in_the_chain(self):
        _r, stored = await _round_trip()
        chain = " ".join(cp.provenance(stored, ticker=TICKER)["provenance_chain"])
        assert "fiscal_period=FY2026Q3" in chain
        assert f"accession={ACCN}" in chain


class TestWhatMustNotRoundTrip:
    @pytest.mark.asyncio
    async def test_a_derived_quarter_is_never_written(self):
        """A derived Q4 is arithmetic over other rows, not a filed figure. It is
        fine to show with its derivation stated; it is not a fact to store."""
        from app.core.retrieval.fact_persistence import persist

        r = await _resolved()
        r.metadata["derived"] = True
        assert await persist([r]) == 0

    @pytest.mark.asyncio
    async def test_a_legacy_row_cannot_masquerade_as_a_round_tripped_one(self):
        _r, stored = await _round_trip()
        legacy = {**stored, "source_section": "xbrl_companyfacts"}
        assert decode_provenance(legacy["source_section"]) is None
        assert cp.provenance(legacy, ticker=TICKER) is None
        d = evaluate(
            [legacy], query=THE_QUESTION, ticker=TICKER, cik=CIK, concept=CONCEPT,
            fiscal_year=FY, fiscal_quarter=FQ, now=_now(),
            company_terms=COMPANY_TERMS,
        )
        assert d.sec_invoked is True
