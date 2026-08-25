"""
When SEC cannot be read, the system says so. It never invents the number.

This is the failure mode with the worst consequences and the least visibility:
retrieval breaks, and the pipeline still has an LLM, a question containing a
company and a period, and a strong prior about what a plausible revenue figure
looks like. A fabricated figure delivered with a citation is worse than an
outage, because an outage is obvious.

So every branch below asserts the same two things — no result, and specifically
no *number* — rather than merely "it did not crash". Returning `[]` is a correct
answer here; `UNSUPPORTED` is a correct answer; a plausible wrong figure is not.

The traps that make this non-trivial are all real and all in the fixture data:
the same filing carries a 272-day year-to-date column under the same concept as
the quarter, and Compute & Networking sits 0.6% from Data Center. A partially
broken read is exactly the situation in which one of those gets returned.
"""

from __future__ import annotations

import asyncio

import httpx
import pytest

from app.core.retrieval.edgar_search import EdgarSearch
from app.core.retrieval.fact_verification import (
    UNSUPPORTED,
    VERIFIED,
    verify_fact,
)
from app.core.retrieval.sec_dimensions import (
    parse_dimensional_facts,
    resolve_dimensional_fact,
)
from tests.test_sec_query_time_regression import (
    CIK,
    ACCN,
    _SECFake,
    _load,
)

QUESTION = "What was NVIDIA's Data Center revenue in Q3 FY2026?"
CONSOLIDATED_QUESTION = "What was NVDA revenue in Q3 FY2026?"

# Every figure that must never be produced by a broken read of this filing.
FORBIDDEN = (
    51_215_000_000,   # Data Center — the right answer, but not from a broken read
    57_006_000_000,   # consolidated
    50_908_000_000,   # Compute & Networking
    147_811_000_000,  # year-to-date through Q3
)


def _values(results):
    return [r.metadata.get("value") for r in results]


def _no_number(results):
    """No result at all, or at least no numeric claim."""
    assert not results, f"a broken SEC read produced results: {_values(results)}"


class _BrokenInstance(_SECFake):
    """Serves the concept and the index normally, but a corrupt instance."""

    def __init__(self, body: bytes, **kw):
        super().__init__(**kw)
        self._body = body

    async def get(self, url):
        if url.endswith("_htm.xml"):
            self.urls.append(url)

            class _R:
                status_code = 200
                content = self._body

            return _R()
        return await super().get(url)


class _Status(_SECFake):
    """Serves a chosen HTTP status for the archive documents."""

    def __init__(self, status: int, **kw):
        super().__init__(**kw)
        self._status = status

    async def get(self, url):
        if "/Archives/" in url:
            self.urls.append(url)

            class _R:
                status_code = self._status
                content = b""

                @staticmethod
                def json():
                    return {}

                def raise_for_status(self):
                    raise RuntimeError(f"HTTP {self.status_code}")

            return _R()
        return await super().get(url)


# ── SEC unavailable / timeout ───────────────────────────────────────────────


class TestSecUnavailable:
    @pytest.mark.asyncio
    async def test_a_connection_error_yields_no_figure(self):
        ch = EdgarSearch(http_client=_SECFake(raises=httpx.ConnectError("dns")))
        _no_number(await ch.search(QUESTION, top_k=5))

    @pytest.mark.asyncio
    async def test_a_5xx_yields_no_figure(self):
        ch = EdgarSearch(http_client=_SECFake(raises=RuntimeError("HTTP 503")))
        _no_number(await ch.search(QUESTION, top_k=5))

    @pytest.mark.asyncio
    async def test_the_channel_does_not_propagate_the_failure_to_the_caller(self):
        """The pipeline dispatches channels in parallel; one channel raising
        must not take the whole answer down with it."""
        ch = EdgarSearch(http_client=_SECFake(raises=RuntimeError("boom")))
        assert await ch.search(QUESTION, top_k=5) == []


class TestTimeout:
    @pytest.mark.asyncio
    async def test_a_read_timeout_yields_no_figure(self):
        ch = EdgarSearch(http_client=_SECFake(raises=httpx.ReadTimeout("slow")))
        _no_number(await ch.search(QUESTION, top_k=5))

    @pytest.mark.asyncio
    async def test_an_asyncio_timeout_yields_no_figure(self):
        ch = EdgarSearch(http_client=_SECFake(raises=asyncio.TimeoutError()))
        _no_number(await ch.search(QUESTION, top_k=5))


# ── malformed / unreadable XBRL ─────────────────────────────────────────────


class TestMalformedXbrl:
    @pytest.mark.asyncio
    async def test_truncated_xml_never_becomes_a_segment_figure(self):
        """
        The consolidated rows survive a broken instance read and they are not
        wrong — they are simply not the breakdown that was asked for. So the
        contract is not "return nothing", it is "never present this as the
        segment": no dimensions, and the answer layer is told the breakdown was
        requested and not found.
        """
        ch = EdgarSearch(http_client=_BrokenInstance(
            b'<?xml version="1.0"?><xbrl><context id="c1">'
        ))
        out = await ch.search(QUESTION, top_k=5)
        for r in out:
            assert r.metadata.get("dimensions") in (None, [])
            assert r.metadata.get("breakdown_requested") is True
            assert r.metadata.get("breakdown_found") is False
            assert r.metadata.get("value") != 51_215_000_000, (
                "the Data Center figure cannot come out of unparseable XML"
            )

    @pytest.mark.asyncio
    async def test_xml_that_is_not_xbrl_at_all_yields_no_dimensional_fact(self):
        http = _BrokenInstance(b"<html><body>Service Unavailable</body></html>")
        res = await resolve_dimensional_fact(
            http, CIK, ACCN, {"Revenues"}, "2025-07-28", "2025-10-26", QUESTION
        )
        assert res is None or not res.get("fact")

    def test_a_corrupt_body_raises_nothing_and_finds_nothing(self):
        assert parse_dimensional_facts(b"\x00\x01not xml", {"Revenues"},
                                       "2025-07-28", "2025-10-26") == []

    @pytest.mark.asyncio
    async def test_an_oversized_instance_is_refused_rather_than_parsed(self):
        from app.core.retrieval.sec_dimensions import INSTANCE_MAX_BYTES

        http = _BrokenInstance(b"<xbrl/>" + b"x" * (INSTANCE_MAX_BYTES + 1))
        res = await resolve_dimensional_fact(
            http, CIK, ACCN, {"Revenues"}, "2025-07-28", "2025-10-26", QUESTION
        )
        assert res is None


# ── the filing or the concept is not there ──────────────────────────────────


class TestFilingUnavailable:
    @pytest.mark.asyncio
    async def test_a_missing_instance_document_never_yields_a_segment_figure(self):
        """
        `instance=False` serves a 404 for the instance. The consolidated rows
        are still legitimate, but the answer must not present one of them as the
        Data Center figure.
        """
        ch = EdgarSearch(http_client=_SECFake(instance=False))
        for r in await ch.search(QUESTION, top_k=5):
            assert r.metadata.get("dimensions") in (None, [])
            assert r.metadata.get("breakdown_found") is not True

    @pytest.mark.asyncio
    async def test_an_unreachable_archive_yields_no_dimensional_fact(self):
        ch = EdgarSearch(http_client=_Status(503))
        for r in await ch.search(QUESTION, top_k=5):
            assert r.metadata.get("dimensions") in (None, [])


class TestMissingConcept:
    @pytest.mark.asyncio
    async def test_a_filer_that_reports_no_such_concept_yields_nothing(self):
        ch = EdgarSearch(http_client=_SECFake(concepts={}))
        _no_number(await ch.search(CONSOLIDATED_QUESTION, top_k=5))

    @pytest.mark.asyncio
    async def test_an_unknown_ticker_yields_nothing(self):
        ch = EdgarSearch(http_client=_SECFake(ticker_map={}))
        _no_number(await ch.search(QUESTION, top_k=5))


class TestMissingDimension:
    @pytest.mark.asyncio
    async def test_a_breakdown_the_filing_does_not_report_is_refused(self):
        """
        Falling back to the consolidated figure here is the specific failure
        that turns "no answer" into "confident wrong answer".
        """
        ch = EdgarSearch(http_client=_SECFake())
        out = await ch.search(
            "What was NVIDIA's Automotive Robotaxi revenue in Q3 FY2026?", top_k=5
        )
        for r in out:
            assert r.metadata.get("value") != 57_006_000_000, (
                "the consolidated total was returned as a segment that does not exist"
            )

    def test_verification_refuses_a_missing_breakdown_outright(self):
        status, reasons = verify_fact(
            value=57_006_000_000, unit="USD",
            start="2025-07-28", end="2025-10-26", fy_end_month=1,
            want_fy=2026, want_quarter=3, period_kind="quarter",
            dimension_status="consolidated", asked_for_breakdown=True,
        )
        assert status == UNSUPPORTED
        assert any("breakdown" in r for r in reasons)

    def test_verification_refuses_an_ambiguous_breakdown(self):
        status, reasons = verify_fact(
            value=1, unit="USD", start="2025-07-28", end="2025-10-26",
            fy_end_month=1, want_fy=2026, want_quarter=3, period_kind="quarter",
            dimension_status="ambiguous", asked_for_breakdown=True,
        )
        assert status == UNSUPPORTED
        assert any("more than one" in r for r in reasons)


# ── invalid period / invalid unit ───────────────────────────────────────────


class TestInvalidPeriod:
    def test_a_year_to_date_span_is_not_a_quarter(self):
        """The 272-day column and the 90-day quarter share a filing, a concept
        and an end date. Only the span separates them."""
        status, reasons = verify_fact(
            value=147_811_000_000, unit="USD",
            start="2025-01-27", end="2025-10-26", fy_end_month=1,
            want_fy=2026, want_quarter=3, period_kind="quarter",
        )
        assert status == UNSUPPORTED
        assert any("year-to-date" in r or "quarter" in r for r in reasons)

    def test_the_wrong_quarter_is_refused(self):
        status, reasons = verify_fact(
            value=1, unit="USD", start="2025-04-28", end="2025-07-27",
            fy_end_month=1, want_fy=2026, want_quarter=3, period_kind="quarter",
        )
        assert status == UNSUPPORTED
        assert any("Q2" in r for r in reasons)

    def test_the_wrong_fiscal_year_is_refused(self):
        status, reasons = verify_fact(
            value=1, unit="USD", start="2024-07-29", end="2024-10-27",
            fy_end_month=1, want_fy=2026, want_quarter=3, period_kind="quarter",
        )
        assert status == UNSUPPORTED
        assert any("FY" in r for r in reasons)

    def test_an_unparseable_period_end_is_refused(self):
        status, _ = verify_fact(
            value=1, unit="USD", start="2025-07-28", end="not-a-date",
            fy_end_month=1, want_fy=2026, want_quarter=3, period_kind="quarter",
        )
        assert status == UNSUPPORTED

    @pytest.mark.asyncio
    async def test_a_quarter_the_filer_never_reported_yields_nothing(self):
        ch = EdgarSearch(http_client=_SECFake())
        _no_number(await ch.search("NVDA revenue in Q3 FY1999", top_k=5))


class TestInvalidUnit:
    def test_a_fact_with_no_unit_is_refused(self):
        status, reasons = verify_fact(
            value=1, unit="", start="2025-07-28", end="2025-10-26",
            fy_end_month=1, want_fy=2026, want_quarter=3, period_kind="quarter",
        )
        assert status == UNSUPPORTED
        assert any("unit" in r for r in reasons)

    @pytest.mark.parametrize("bad", [None, "", "n/a", float("nan"), float("inf")])
    def test_a_value_that_is_not_a_finite_number_is_refused(self, bad):
        status, _ = verify_fact(
            value=bad, unit="USD", start="2025-07-28", end="2025-10-26",
            fy_end_month=1, want_fy=2026, want_quarter=3, period_kind="quarter",
        )
        assert status == UNSUPPORTED

    def test_the_correct_fact_still_passes(self):
        """The negatives above are only meaningful if the positive is reachable."""
        status, reasons = verify_fact(
            value=51_215_000_000, unit="USD",
            start="2025-07-28", end="2025-10-26", fy_end_month=1,
            want_fy=2026, want_quarter=3, period_kind="quarter",
            dimension_status="matched", asked_for_breakdown=True,
        )
        assert (status, reasons) == (VERIFIED, [])


# ── nothing that failed is ever persisted or cited ──────────────────────────


class TestAFailedReadLeavesNoTrace:
    @pytest.mark.asyncio
    async def test_a_failed_read_persists_nothing(self):
        from app.core.retrieval.fact_persistence import persist

        ch = EdgarSearch(http_client=_SECFake(raises=RuntimeError("down")))
        out = await ch.search(QUESTION, top_k=5)
        assert await persist(out) == 0

    @pytest.mark.asyncio
    async def test_a_failed_read_produces_no_citable_provenance(self):
        from app.core.retrieval import citation_provenance as cp

        ch = EdgarSearch(http_client=_SECFake(raises=RuntimeError("down")))
        for r in await ch.search(QUESTION, top_k=5):
            assert cp.provenance(r.metadata) is None
