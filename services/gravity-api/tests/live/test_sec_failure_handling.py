"""
LIVE failure handling: what happens when the real network refuses.

`tests/test_sec_error_handling.py` proves the truthful-failure contract against
fixtures — 30 cases, deterministic, run in CI. What a fixture cannot prove is
that the contract survives the *real* client stack: real `httpx`, real DNS, real
sockets, real SEC status codes, and the real exception types those produce
rather than the ones a fake was told to raise.

This file closes as much of that gap as can be closed without abusing sec.gov.

WHAT IS GENUINELY LIVE HERE
---------------------------
  * A real 404 from `data.sec.gov` for a us-gaap concept NVIDIA does not report.
  * A real 404 from `www.sec.gov/Archives` for a well-formed accession that
    does not exist.
  * A real DNS failure, against an RFC 2606 `.invalid` hostname.
  * A real connect timeout, against an RFC 5737 TEST-NET-1 address
    (192.0.2.0/24), which is reserved and guaranteed unroutable.

The last two put ZERO load on SEC: no packet reaches sec.gov. They are not mocks
either — nothing serves a fake response, the real socket layer really fails, and
the code under test sees the genuine `httpx` exception. Redirecting the endpoint
constant is what makes the client fail; the failure itself is not simulated.

WHAT STILL CANNOT BE PROVEN LIVE, AND WHY
-----------------------------------------
A real SEC **outage** — 500s, throttling, a truncated body mid-transfer — cannot
be induced without either sending malformed requests or hammering the endpoint
until it refuses, and section 11 forbids both. Those paths stay fixture-proven in
`tests/test_sec_error_handling.py`, and this limit is stated in the audit rather
than papered over.

REQUEST COST
------------
Two live SEC requests total, both single 404s, issued serially. The DNS and
timeout cases cost SEC nothing.
"""

from __future__ import annotations

import os

import pytest

LIVE = os.getenv("GRAVITY_LIVE_SEC") == "1"

pytestmark = [
    pytest.mark.live,
    pytest.mark.skipif(
        not LIVE,
        reason="live SEC suite is opt-in: set GRAVITY_LIVE_SEC=1 to run it",
    ),
]

CIK = 1045810
QUESTION = "What was NVIDIA's Data Center revenue in Q3 FY2026?"

# RFC 2606 reserves `.invalid` — guaranteed NXDOMAIN, so this resolves fast
# instead of hanging.
DEAD_HOST = "https://sec-gov-does-not-exist.invalid"

# RFC 5737 reserves 192.0.2.0/24 (TEST-NET-1) for documentation. Nothing routes
# there, so a connect attempt times out without touching any real host.
BLACKHOLE = "https://192.0.2.1"

# Well-formed, and not a filing. The shape is valid so the accession validator
# passes it through and the ARCHIVE fetch is genuinely attempted.
NONEXISTENT_ACCN = "0001045810-25-999999"


def _short_client(timeout: float = 3.0):
    """A real httpx client with a short timeout, so a dead host fails quickly."""
    import httpx

    from app.config import settings

    return httpx.AsyncClient(
        headers={"User-Agent": settings.sec_user_agent}, timeout=timeout
    )


class TestLiveSecSaysNo:
    """Real 404s from real SEC hosts. Two requests, both single."""

    @pytest.mark.asyncio
    async def test_a_concept_the_filer_does_not_report_is_a_real_404(self):
        """
        `data.sec.gov` answers 404 for a us-gaap tag the filer never used.
        `_get_json` must read that as "not reported", not as an error to raise
        and not as a reason to substitute a different concept.
        """
        from app.core.retrieval.edgar_search import CONCEPT_URL, EdgarSearch

        ch = EdgarSearch(http_client=_short_client(timeout=15.0))
        try:
            payload = await ch._get_json(
                CONCEPT_URL.format(cik=CIK, tag="DepositsFromBanks")
            )
        finally:
            await ch._http.aclose()
        assert payload is None

    @pytest.mark.asyncio
    async def test_a_filing_that_does_not_exist_yields_no_instance(self):
        """
        A well-formed accession that names no filing. The archive answers 404
        and `find_instance_name` returns None rather than guessing a filename.
        """
        from app.core.retrieval.citation_provenance import valid_accession
        from app.core.retrieval.sec_dimensions import find_instance_name

        assert valid_accession(NONEXISTENT_ACCN), (
            "the point is a VALID accession that is not a filing"
        )
        http = _short_client(timeout=15.0)
        try:
            assert await find_instance_name(http, CIK, NONEXISTENT_ACCN) is None
        finally:
            await http.aclose()


class TestLiveNetworkFailure:
    """
    Real DNS and real connect failures through the real client stack. No packet
    reaches sec.gov.
    """

    @pytest.mark.asyncio
    async def test_an_unresolvable_host_yields_no_figure(self, monkeypatch):
        from app.core.retrieval import edgar_search as es

        monkeypatch.setattr(es, "TICKER_MAP_URL", f"{DEAD_HOST}/company_tickers.json")
        monkeypatch.setattr(
            es, "CONCEPT_URL", DEAD_HOST + "/CIK{cik:010d}/{tag}.json"
        )
        ch = es.EdgarSearch(http_client=_short_client())
        try:
            out = await ch.search(QUESTION, top_k=5)
        finally:
            await ch._http.aclose()
        assert out == [], f"a dead host produced results: {out}"

    @pytest.mark.asyncio
    async def test_a_connect_timeout_yields_no_figure(self, monkeypatch):
        from app.core.retrieval import edgar_search as es

        monkeypatch.setattr(es, "TICKER_MAP_URL", f"{BLACKHOLE}/company_tickers.json")
        monkeypatch.setattr(
            es, "CONCEPT_URL", BLACKHOLE + "/CIK{cik:010d}/{tag}.json"
        )
        ch = es.EdgarSearch(http_client=_short_client(timeout=2.0))
        try:
            out = await ch.search(QUESTION, top_k=5)
        finally:
            await ch._http.aclose()
        assert out == [], f"an unroutable address produced results: {out}"

    @pytest.mark.asyncio
    async def test_nothing_is_fabricated_and_nothing_is_citable(self, monkeypatch):
        """
        The failure that matters. Retrieval is down, and the pipeline still has
        an LLM, a company, a period and a strong prior about what a plausible
        revenue figure looks like. No value, and nothing that could be cited.
        """
        from app.core.retrieval import citation_provenance as cp
        from app.core.retrieval import edgar_search as es
        from app.core.retrieval.fact_persistence import persist

        monkeypatch.setattr(es, "TICKER_MAP_URL", f"{DEAD_HOST}/company_tickers.json")
        monkeypatch.setattr(
            es, "CONCEPT_URL", DEAD_HOST + "/CIK{cik:010d}/{tag}.json"
        )
        ch = es.EdgarSearch(http_client=_short_client())
        try:
            out = await ch.search(QUESTION, top_k=5)
        finally:
            await ch._http.aclose()

        assert [r.metadata.get("value") for r in out] == []
        assert [cp.provenance(r.metadata) for r in out] == []
        assert await persist(out) == 0
