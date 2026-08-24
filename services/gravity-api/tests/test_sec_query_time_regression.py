"""
The empty-corpus regression, and the adversarial cases around it.

The product failure this pins: "What was NVIDIA's Data Center revenue in Q3
FY2026?" returned "No indexed documents found" because the filing had never been
ingested. The fix is not ingestion — it is that the live EDGAR channel resolves
the issuer, the fiscal period and the exact filing at query time, reads the
figure out of the filing's own XBRL, verifies it, and cites it.

**Nothing here touches the network.** Every payload in `tests/fixtures/` was
recorded from the real SEC responses for accession 0001045810-25-000230 on
2026-08-23 — the concept JSON, the filing index, and a trimmed instance document
carrying the genuine contexts and `us-gaap:Revenues` facts. So these tests assert
our behaviour, not SEC's uptime, and they run with an empty database because
there is no database in the path at all.

Ground truth, read out of that filing:

    consolidated revenue          57,006,000,000   (no dimension)
    Data Center revenue           51,215,000,000   srt:ProductOrServiceAxis=nvda:DataCenterMember
    Compute & Networking segment  50,908,000,000   us-gaap:StatementBusinessSegmentsAxis
    Gaming revenue                 4,265,000,000   srt:ProductOrServiceAxis=nvda:GamingMember
    year-to-date through Q3      147,811,000,000   the 272-day span in the same filing

The last two rows are the traps that matter. Compute & Networking sits 0.6% from
Data Center, and the year-to-date figure is the same concept in the same filing —
either one returned confidently with a citation is worse than no answer.
"""

import json
from pathlib import Path

import pytest

from app.core.retrieval.edgar_search import (
    EdgarSearch,
    parse_fiscal_years,
    parse_quarter,
)

FIX = Path(__file__).parent / "fixtures"

CIK = 1045810
ACCN = "0001045810-25-000230"
NODASH = ACCN.replace("-", "")

# Ground truth from the filing.
DATA_CENTER_Q3_FY2026 = 51_215_000_000
CONSOLIDATED_Q3_FY2026 = 57_006_000_000
COMPUTE_AND_NETWORKING_Q3_FY2026 = 50_908_000_000
GAMING_Q3_FY2026 = 4_265_000_000
YTD_THROUGH_Q3_FY2026 = 147_811_000_000

REV = "Revenues"
STALE = "RevenueFromContractWithCustomerExcludingAssessedTax"

TICKER_MAP = {
    "0": {"cik_str": CIK, "ticker": "NVDA", "title": "NVIDIA CORP"},
    "1": {"cik_str": 320193, "ticker": "AAPL", "title": "Apple Inc."},
}


def _load(name):
    return json.loads((FIX / name).read_text(encoding="utf-8"))


class _Resp:
    def __init__(self, payload=None, status=200, content=b""):
        self._payload, self.status_code, self.content = payload, status, content

    def raise_for_status(self):
        if self.status_code >= 400:
            raise RuntimeError(f"HTTP {self.status_code}")

    def json(self):
        return self._payload


class _SECFake:
    """
    Serves the recorded SEC responses, and records every URL asked for so a test
    can assert which endpoints were consulted.
    """

    def __init__(self, concepts=None, ticker_map=None, raises=None, instance=True):
        self.concepts = concepts if concepts is not None else {
            REV: _load("nvda_revenues_concept.json"),
            STALE: _load("nvda_stale_concept.json"),
        }
        self.ticker_map = ticker_map if ticker_map is not None else TICKER_MAP
        self.raises = raises
        self.instance = instance
        self.urls = []

    async def get(self, url):
        self.urls.append(url)
        if self.raises:
            raise self.raises
        if "company_tickers.json" in url:
            return _Resp(self.ticker_map)
        if url.endswith("index.json"):
            return _Resp(_load("nvda_filing_index.json"))
        if url.endswith("_htm.xml"):
            if not self.instance:
                return _Resp(None, 404)
            return _Resp(content=(FIX / "nvda_q3fy2026_instance.xml").read_bytes())
        tag = url.rsplit("/", 1)[-1].removesuffix(".json")
        payload = self.concepts.get(tag)
        return _Resp(payload, 200) if payload else _Resp(None, 404)


def _channel(**kw):
    return EdgarSearch(http_client=_SECFake(**kw))


async def _values(query, **kw):
    out = await _channel(**kw).search(query, top_k=10)
    return [r.metadata.get("value") for r in out], out


THE_QUESTION = "What was NVIDIA's Data Center revenue in Q3 FY2026?"


class TestTheEmptyCorpusRegression:
    """The exact reported failure. No local evidence exists; the answer must
    still be the filed figure, with the filing that proves it."""

    @pytest.mark.asyncio
    async def test_it_answers_at_all(self):
        _vals, out = await _values(THE_QUESTION)
        assert out, "the question that used to return 'No indexed documents found'"

    @pytest.mark.asyncio
    async def test_it_returns_the_filed_data_center_figure(self):
        vals, _ = await _values(THE_QUESTION)
        assert vals[0] == DATA_CENTER_Q3_FY2026

    @pytest.mark.asyncio
    async def test_it_does_not_answer_with_consolidated_revenue(self):
        vals, _ = await _values(THE_QUESTION)
        assert CONSOLIDATED_Q3_FY2026 not in vals, (
            "answering a segment question with the consolidated total is the "
            "confident-wrong-answer failure"
        )

    @pytest.mark.asyncio
    async def test_it_cites_the_exact_filing(self):
        _vals, out = await _values(THE_QUESTION)
        m = out[0].metadata
        assert m["accn"] == ACCN
        assert m["form"] == "10-Q"
        assert m["cik"] == CIK

    @pytest.mark.asyncio
    async def test_it_cites_the_evidence_inside_the_filing(self):
        _vals, out = await _values(THE_QUESTION)
        m = out[0].metadata
        assert m["dimensions"] == [
            {"axis": "srt:ProductOrServiceAxis", "member": "nvda:DataCenterMember"}
        ]
        assert m["period_start"] == "2025-07-28"
        assert m["column_label"] == "2025-07-28 to 2025-10-26"
        assert m["context_id"]
        assert NODASH in m["document_url"]

    @pytest.mark.asyncio
    async def test_the_fact_is_marked_verified(self):
        _vals, out = await _values(THE_QUESTION)
        assert out[0].metadata["verification_status"] == "verified"
        assert out[0].metadata["parser_version"]

    @pytest.mark.asyncio
    async def test_the_period_is_resolved_to_the_issuers_fiscal_calendar(self):
        _vals, out = await _values(THE_QUESTION)
        m = out[0].metadata
        assert (m["fiscal_year"], m["fiscal_quarter"]) == (2026, 3)

    @pytest.mark.asyncio
    async def test_the_passage_reaches_the_llm_as_an_exact_figure(self):
        _vals, out = await _values(THE_QUESTION)
        # search_pipeline pins passages carrying this prefix and anchors the
        # answer on them; without it the number is just another retrieved opinion.
        assert out[0].text.startswith("[EXACT FILING FIGURE]")
        assert "51,215,000,000" in out[0].text


class TestFiscalYearIsNotCalendarYear:
    @pytest.mark.asyncio
    async def test_q3_fy2026_ends_in_calendar_2025(self):
        _vals, out = await _values(THE_QUESTION)
        m = out[0].metadata
        assert m["fiscal_year"] == 2026
        assert m["period_end"].startswith("2025-"), (
            "NVIDIA's Q3 FY2026 ends 2025-10-26 — a calendar-quarter assumption "
            "puts this in 2025 Q3 and answers the wrong period"
        )

    def test_an_explicit_fiscal_marker_beats_a_bare_year(self):
        assert parse_fiscal_years("Data Center revenue in Q3 FY2026") == [2026]

    def test_the_quarter_is_read_from_the_question(self):
        assert parse_quarter("Q3 FY2026") == 3
        assert parse_quarter("3rd quarter FY2026") == 3
        assert parse_quarter("NVIDIA revenue FY2026") is None


class TestTheWrongQuarterIsNeverReturned:
    @pytest.mark.asyncio
    async def test_a_q3_question_returns_only_q3(self):
        _vals, out = await _values(THE_QUESTION)
        assert all(r.metadata["fiscal_quarter"] == 3 for r in out)

    @pytest.mark.asyncio
    async def test_a_period_predating_the_breakdown_never_yields_a_segment_figure(self):
        """
        NVIDIA did not report a Data Center product line in FY2019. The channel
        may still answer with the consolidated figure — that is a true, correctly
        labelled number — but it must not present it as the segment, and the miss
        must be visible to the answer layer.
        """
        vals, out = await _values("NVIDIA Data Center revenue Q1 FY2019")
        for r in out:
            assert "dimensions" not in r.metadata
            assert r.metadata["breakdown_requested"] is True
            assert r.metadata["breakdown_found"] is False
        assert DATA_CENTER_Q3_FY2026 not in vals


class TestQuarterlyIsNotYearToDate:
    """The same filing tags a 272-day span under the same concept. It must never
    be served to a question about one quarter."""

    @pytest.mark.asyncio
    async def test_the_ytd_figure_is_not_returned_for_a_quarterly_question(self):
        vals, _ = await _values(THE_QUESTION)
        assert YTD_THROUGH_Q3_FY2026 not in vals

    @pytest.mark.asyncio
    async def test_no_returned_span_is_longer_than_a_quarter(self):
        from datetime import date

        _vals, out = await _values(THE_QUESTION)
        for r in out:
            m = r.metadata
            d0 = date.fromisoformat(m["period_start"])
            d1 = date.fromisoformat(m["period_end"])
            assert (d1 - d0).days <= 100


class TestSegmentIsNotConsolidatedAndIsNotAnotherSegment:
    @pytest.mark.asyncio
    async def test_compute_and_networking_is_its_own_figure(self):
        vals, _ = await _values(
            "NVIDIA Compute & Networking segment revenue Q3 FY2026"
        )
        assert vals[0] == COMPUTE_AND_NETWORKING_Q3_FY2026

    @pytest.mark.asyncio
    async def test_data_center_is_not_confused_with_compute_and_networking(self):
        """They differ by 0.6%. Returning one for the other is invisible in review."""
        dc, _ = await _values(THE_QUESTION)
        cn, _ = await _values("NVIDIA Compute & Networking segment revenue Q3 FY2026")
        assert dc[0] != cn[0]
        assert dc[0] == DATA_CENTER_Q3_FY2026
        assert cn[0] == COMPUTE_AND_NETWORKING_Q3_FY2026

    @pytest.mark.asyncio
    async def test_gaming_resolves_to_its_own_member(self):
        vals, out = await _values("NVIDIA Gaming revenue Q3 FY2026")
        assert vals[0] == GAMING_Q3_FY2026
        assert out[0].metadata["dimensions"] == [
            {"axis": "srt:ProductOrServiceAxis", "member": "nvda:GamingMember"}
        ]

    @pytest.mark.asyncio
    async def test_a_question_naming_no_breakdown_gets_the_consolidated_total(self):
        vals, out = await _values("NVIDIA revenue Q3 FY2026")
        assert vals[0] == CONSOLIDATED_Q3_FY2026
        assert "dimensions" not in out[0].metadata


class TestTheStaleTagRegression:
    """
    NVIDIA stopped tagging `RevenueFromContractWithCustomerExcludingAssessedTax`
    after FY2022, but SEC still serves the 28 old points. A fallback chain that
    asks "does this tag have any data" accepts them, never tries `Revenues`, and
    silently answers nothing for every recent period.
    """

    @pytest.mark.asyncio
    async def test_the_stale_tag_does_not_shadow_the_live_one(self):
        vals, _ = await _values(THE_QUESTION)
        assert vals[0] == DATA_CENTER_Q3_FY2026

    @pytest.mark.asyncio
    async def test_the_live_tag_is_the_one_cited(self):
        _vals, out = await _values(THE_QUESTION)
        assert out[0].metadata["tag"] == REV

    @pytest.mark.asyncio
    async def test_the_stale_tag_is_still_used_when_it_covers_the_period(self):
        """The fix must not simply prefer `Revenues` always — the fallback is
        period-driven, so a FY2021 question still resolves through the old tag."""
        ch = _channel()
        out = await ch.search("NVIDIA revenue FY2021", top_k=5)
        assert out, "FY2021 is inside the stale tag's coverage"


class TestTruthfulFailureStates:
    @pytest.mark.asyncio
    async def test_an_unknown_company_yields_nothing_rather_than_a_guess(self):
        out = await _channel().search("Zorblax Industries revenue Q3 FY2026")
        assert out == []

    @pytest.mark.asyncio
    async def test_a_metric_absent_from_the_filing_is_not_invented(self):
        vals, out = await _values(
            "NVIDIA Quantum Teleportation revenue Q3 FY2026"
        )
        assert all(v != DATA_CENTER_Q3_FY2026 for v in vals), (
            "an unreported breakdown must not fall back to another segment"
        )

    @pytest.mark.asyncio
    async def test_sec_being_unreachable_does_not_raise_into_the_fan_out(self):
        ch = EdgarSearch(http_client=_SECFake(raises=RuntimeError("connection reset")))
        assert await ch.search(THE_QUESTION) == []

    @pytest.mark.asyncio
    async def test_an_unreadable_filing_falls_back_rather_than_failing(self):
        """If the instance cannot be fetched, the consolidated figure is still a
        true answer to a related question — but it must not be dressed up as the
        segment that was asked for."""
        vals, out = await _values(THE_QUESTION, instance=False)
        assert DATA_CENTER_Q3_FY2026 not in vals
        for r in out:
            assert "dimensions" not in r.metadata


class TestUnitsAreStatedNotGuessed:
    @pytest.mark.asyncio
    async def test_the_unit_is_carried_with_the_value(self):
        _vals, out = await _values(THE_QUESTION)
        assert out[0].metadata["unit"] == "USD"

    @pytest.mark.asyncio
    async def test_the_value_is_the_full_dollar_amount_not_millions(self):
        vals, _ = await _values(THE_QUESTION)
        # 51,215 in the filing's own table is $ millions; XBRL reports full USD.
        # Storing 51215 here would be off by 10^6 and read as plausible.
        assert vals[0] == 51_215_000_000
        assert vals[0] != 51_215


class TestOnlyGaapTaggedFactsAreServed:
    @pytest.mark.asyncio
    async def test_the_cited_concept_is_a_us_gaap_tag(self):
        _vals, out = await _values(THE_QUESTION)
        # Non-GAAP measures are not in the us-gaap taxonomy, so a channel that
        # only reads us-gaap concepts cannot serve one by accident.
        assert out[0].metadata["tag"] in (REV, STALE)


class TestOnlyGaapConceptsAreServed:
    """
    A filing carries the issuer's own namespace alongside `us-gaap`, and that is
    where non-GAAP measures live. Matching a concept by local name alone would
    serve `nvda:Revenues` as though it were `us-gaap:Revenues`.

    `nvda_nongaap_lookalike.xml` is CONSTRUCTED, not recorded: it is the real Q3
    FY2026 instance with one extra element — `nvda:Revenues` = 99,999,000,000 on
    the same context as the genuine consolidated figure. No real filing was found
    doing this; the fixture exists to prove the guard bites rather than to claim
    NVIDIA does it.
    """

    NON_GAAP = 99_999_000_000

    def _facts(self):
        from app.core.retrieval.sec_dimensions import parse_dimensional_facts

        raw = (FIX / "nvda_nongaap_lookalike.xml").read_bytes()
        return parse_dimensional_facts(raw, {"Revenues"}, "2025-07-28", "2025-10-26")

    def test_the_non_gaap_lookalike_is_not_served(self):
        assert self.NON_GAAP not in [f.value for f in self._facts()]

    def test_the_genuine_gaap_facts_still_are(self):
        vals = [f.value for f in self._facts()]
        assert CONSOLIDATED_Q3_FY2026 in vals
        assert DATA_CENTER_Q3_FY2026 in vals

    def test_the_namespace_test_is_what_rejects_it(self):
        from app.core.retrieval.sec_dimensions import is_us_gaap

        assert is_us_gaap("{http://fasb.org/us-gaap/2025}Revenues")
        assert not is_us_gaap("{http://www.nvidia.com/20251026}Revenues")
        assert not is_us_gaap("Revenues")


class TestCitationsAreCorroborated:
    """
    `corroborate()` opens the filing a figure is cited to and confirms the figure
    is in it, on a context with the cited period and dimensions.

    These tests exist because a verifier that cannot fail is worse than none —
    each case below is a *wrong* citation that must be caught.
    """

    async def _check(self, value, members=None, accn=ACCN):
        from app.core.retrieval.sec_dimensions import corroborate

        return await corroborate(
            _SECFake(), CIK, accn, "Revenues",
            "2025-07-28", "2025-10-26", value, members=members or [],
        )

    @pytest.mark.asyncio
    async def test_a_truthful_consolidated_citation_passes(self):
        assert (await self._check(CONSOLIDATED_Q3_FY2026))["ok"] is True

    @pytest.mark.asyncio
    async def test_a_truthful_segment_citation_passes(self):
        r = await self._check(
            DATA_CENTER_Q3_FY2026,
            members=[("srt:ProductOrServiceAxis", "nvda:DataCenterMember")],
        )
        assert r["ok"] is True

    @pytest.mark.asyncio
    async def test_an_off_by_one_value_is_caught(self):
        r = await self._check(CONSOLIDATED_Q3_FY2026 + 1)
        assert r["ok"] is False
        assert "57,006,000,000" in r["reason"]

    @pytest.mark.asyncio
    async def test_the_ytd_figure_substituted_for_the_quarter_is_caught(self):
        r = await self._check(YTD_THROUGH_Q3_FY2026)
        assert r["ok"] is False

    @pytest.mark.asyncio
    async def test_a_segment_value_cited_without_its_dimensions_is_caught(self):
        """The number is real, but citing it as the consolidated total is not."""
        r = await self._check(DATA_CENTER_Q3_FY2026)
        assert r["ok"] is False
