"""
LIVE SEC authority validation. Real sockets to sec.gov. Opt-in only.

Every other SEC test in this repository runs against recorded fixtures. Those
fixtures are genuine — captured from accession 0001045810-25-000230 on
2026-08-23 — and they are the right tool for CI, because they make the suite
assert *our* behaviour rather than SEC's uptime. But a fixture cannot prove that
SEC still serves what it served then, that the endpoints still exist, or that
our resolver still finds the filing in the live archive. Only this file can.

    DETERMINISTIC CI      pytest tests
    LIVE AUTHORITY        GRAVITY_LIVE_SEC=1 pytest tests/live -v

Nothing here is mocked. `EdgarSearch` constructs its own `httpx` client, carries
the configured User-Agent, and talks to data.sec.gov and www.sec.gov.

WHY THE ASSERTED VALUE IS NOT A HARDCODED CONSTANT
--------------------------------------------------
The document names 51,215,000,000 USD as NVIDIA's Q3 FY2026 Data Center revenue.
Asserting our resolver against that literal alone would prove only that two
copies of the same number agree. So `independent_fact` re-derives it from SEC by
a different route — raw httpx, the companyconcept endpoint for the accession,
the filing index, and a stdlib ElementTree read of the instance document — using
none of the resolution logic under test. The resolver is then compared against
that. The literal is asserted too, but as a cross-check on both, and a
restatement SHOULD break it loudly rather than pass silently.

SEC RATE-LIMIT SAFETY (S11)
---------------------------
SEC asks for no more than 10 requests/second and an identifying User-Agent.

  * Every fetch in this module is serial. There is no `asyncio.gather`, no
    parallel parametrisation, and no polling loop anywhere in the file.
  * The identity map (`company_tickers.json`, ~1.2 MB) is downloaded ONCE for
    the whole module and shared, exactly as production does on a long-lived
    channel.
  * The golden resolution runs ONCE at module scope; the twelve assertions
    about it read the cached result rather than re-resolving.
  * The independent re-derivation also runs once and caches its artefacts.
  * `test_the_request_budget_is_respected` fails if the module exceeds
    MAX_LIVE_REQUESTS, so the budget is enforced rather than merely described.

MEASURED REQUEST BUDGET
-----------------------
    1   company_tickers.json                     identity, shared
    2   companyconcept (primary tag, then Revenues)  golden resolution
    1   filing index.json                        golden resolution
    1   XBRL instance document                   golden resolution
    1   companyconcept Revenues                  independent re-derivation
    1   filing index.json                        independent re-derivation
    1   XBRL instance document                   independent re-derivation
    ~12 four live negatives (Q2, annual, consolidated, a different metric)
    ---
    ~20 requests for the entire module, issued serially.

WHAT IS DELIBERATELY *NOT* LIVE (S10)
-------------------------------------
Amended filings and conflicting filing metadata stay fixture-based, and the
reason is stated rather than hidden: a live amendment test needs an issuer that
has restated a specific period, which is a fact about the world that changes
without notice. `tests/test_sec_amendments.py` pins that behaviour against Plug
Power's genuinely restated Q1 2019 (18,593,000 -> 21,579,000 -> 21,510,000),
recorded. Asserting it live would produce a test that goes red for reasons that
have nothing to do with this code.
"""

from __future__ import annotations

import os
import xml.etree.ElementTree as ET

import pytest

LIVE = os.getenv("GRAVITY_LIVE_SEC") == "1"

pytestmark = [
    pytest.mark.live,
    pytest.mark.skipif(
        not LIVE,
        reason="live SEC suite is opt-in: set GRAVITY_LIVE_SEC=1 to run it",
    ),
]

# The golden question, verbatim from the hardening document.
THE_QUESTION = "What was NVIDIA's Data Center revenue in Q3 FY2026?"

TICKER = "NVDA"
CIK = 1045810
EXPECTED_VALUE = 51_215_000_000        # S9, cross-checked against a live re-derivation
EXPECTED_UNIT = "USD"
EXPECTED_FORM = "10-Q"
EXPECTED_FY, EXPECTED_FQ = 2026, 3
EXPECTED_START, EXPECTED_END = "2025-07-28", "2025-10-26"

# Figures in the same filing that a wrong resolution would plausibly return.
CONSOLIDATED = 57_006_000_000
COMPUTE_AND_NETWORKING = 50_908_000_000
YTD_THROUGH_Q3 = 147_811_000_000

MAX_LIVE_REQUESTS = 30      # budget ceiling; the module measures ~20

_REQUESTS: list[str] = []


# ── one shared, counted, live channel ───────────────────────────────────────


_IDENTITY: dict = {}


@pytest.fixture
def channel():
    """
    A live `EdgarSearch`, sharing the identity map with every other test.

    The map itself (`company_tickers.json`, ~1.2 MB) is downloaded ONCE for the
    module and copied into each channel, exactly as production does on one
    long-lived channel; re-downloading it per assertion is the aggressive
    polling S11 forbids.

    The *client* is deliberately not shared. `pytest-asyncio` gives each test
    its own event loop, and an `httpx.AsyncClient` is bound to the loop that
    created it, so a module-scoped client fails with "Event loop is closed" on
    the second test that actually reaches the network. Sharing the expensive
    part and rebuilding the cheap part is what keeps the budget without that
    coupling.
    """
    from app.core.retrieval.edgar_search import EdgarSearch

    ch = EdgarSearch()
    if _IDENTITY:
        ch._ticker_map = _IDENTITY["tickers"]
        ch._title_map = _IDENTITY["titles"]
        ch._issuer_by_ticker = _IDENTITY["issuers"]
        ch._ticker_map_at = _IDENTITY["at"]

    original = ch._client

    async def _counting():
        client = await original()
        return _Counted(client)

    ch._client = _counting
    return ch


async def _warm(channel):
    """Load the identity map once, then share it with every later channel."""
    await channel._load_maps()
    if not _IDENTITY and channel._ticker_map:
        _IDENTITY.update({
            "tickers": channel._ticker_map,
            "titles": channel._title_map,
            "issuers": channel._issuer_by_ticker,
            "at": channel._ticker_map_at,
        })


class _Counted:
    """Records every live URL so the budget can be asserted, not just claimed."""

    def __init__(self, inner):
        self._inner = inner

    async def get(self, url, *a, **kw):
        _REQUESTS.append(url)
        return await self._inner.get(url, *a, **kw)

    def __getattr__(self, name):
        return getattr(self._inner, name)


async def _raw_get(url: str):
    """A direct SEC read that shares none of the resolver's code."""
    import httpx

    from app.config import settings

    _REQUESTS.append(url)
    async with httpx.AsyncClient(
        headers={"User-Agent": settings.sec_user_agent}, timeout=30.0
    ) as c:
        r = await c.get(url)
        r.raise_for_status()
        return r


@pytest.fixture(scope="module")
def anyio_backend():
    return "asyncio"


# ── the resolver's answer, resolved once ────────────────────────────────────


_GOLDEN: dict = {}


async def _golden(channel):
    """The real channel's answer to the golden question. Resolved once."""
    if "result" not in _GOLDEN:
        await _warm(channel)
        out = await channel.search(THE_QUESTION, top_k=5)
        _GOLDEN["all"] = out
        _GOLDEN["result"] = out[0] if out else None
    return _GOLDEN["result"]


_INDEPENDENT: dict = {}


async def _independent():
    """
    NVIDIA's Q3 FY2026 Data Center revenue, re-derived from SEC by a route that
    shares no code with the resolver under test.

    companyconcept gives the accession of the filing that reports the quarter;
    the filing index gives the instance document; the instance is read with
    stdlib ElementTree here, in this file, rather than by `sec_dimensions`.
    """
    if "value" in _INDEPENDENT:
        return _INDEPENDENT

    concept = (
        await _raw_get(
            f"https://data.sec.gov/api/xbrl/companyconcept/CIK{CIK:010d}"
            f"/us-gaap/Revenues.json"
        )
    ).json()

    accn = None
    for points in (concept.get("units") or {}).values():
        for p in points:
            if p.get("start") == EXPECTED_START and p.get("end") == EXPECTED_END:
                if (p.get("form") or "").startswith("10-Q"):
                    accn = p.get("accn")
    assert accn, "SEC no longer reports a 10-Q covering 2025-07-28..2025-10-26"

    nodash = accn.replace("-", "")
    index = (
        await _raw_get(
            f"https://www.sec.gov/Archives/edgar/data/{CIK}/{nodash}/index.json"
        )
    ).json()
    name = next(
        i["name"] for i in index["directory"]["item"]
        if i.get("name", "").endswith("_htm.xml")
    )
    body = (
        await _raw_get(
            f"https://www.sec.gov/Archives/edgar/data/{CIK}/{nodash}/{name}"
        )
    ).content

    root = ET.fromstring(body)

    def _local(tag):
        return tag.rsplit("}", 1)[-1] if isinstance(tag, str) else ""

    # Contexts spanning exactly the quarter, carrying a Data Center member.
    wanted: set[str] = set()
    for cx in root.iter():
        if _local(cx.tag) != "context":
            continue
        start = end = None
        members: list[str] = []
        for el in cx.iter():
            ln = _local(el.tag)
            if ln == "startDate":
                start = (el.text or "").strip()
            elif ln == "endDate":
                end = (el.text or "").strip()
            elif ln == "explicitMember":
                members.append((el.text or "").strip())
        if start == EXPECTED_START and end == EXPECTED_END and members:
            if any("DataCenter" in m for m in members) and len(members) == 1:
                wanted.add(cx.get("id"))
    assert wanted, "no Data Center context for the quarter in the live filing"

    values = {
        int(float(el.text))
        for el in root.iter()
        if _local(el.tag) == "Revenues"
        and el.get("contextRef") in wanted
        and (el.text or "").strip()
    }
    assert len(values) == 1, f"live filing reports {values} for Data Center"

    _INDEPENDENT.update(
        {"value": values.pop(), "accn": accn, "instance": name, "body": body}
    )
    return _INDEPENDENT


# ── S9: the live NVIDIA golden test ─────────────────────────────────────────


class TestLiveNvidiaGolden:
    """
    NVIDIA -> CIK -> FY2026 -> Q3 -> correct filing -> correct accession ->
    correct dimensional XBRL fact -> correct value -> correct unit -> correct
    segment -> verification -> exact citation.
    """

    @pytest.mark.asyncio
    async def test_the_question_resolves_to_a_fact_at_all(self, channel):
        assert await _golden(channel) is not None, (
            "the live resolver returned nothing for the golden question"
        )

    @pytest.mark.asyncio
    async def test_the_issuer_resolves_from_its_name_not_a_ticker(self, channel):
        """The question says "NVIDIA", never "NVDA"."""
        r = await _golden(channel)
        assert r.ticker == TICKER
        assert r.metadata["cik"] == CIK

    @pytest.mark.asyncio
    async def test_the_value_matches_an_independent_read_of_the_filing(self, channel):
        r = await _golden(channel)
        ind = await _independent()
        assert r.metadata["value"] == ind["value"], (
            f"resolver says {r.metadata['value']:,}, "
            f"the filing says {ind['value']:,}"
        )

    @pytest.mark.asyncio
    async def test_the_value_is_the_figure_the_document_names(self, channel):
        """
        Cross-check on both readings. If NVIDIA restates this period, this must
        go red loudly rather than pass on a stale expectation.
        """
        r = await _golden(channel)
        ind = await _independent()
        assert ind["value"] == EXPECTED_VALUE
        assert r.metadata["value"] == EXPECTED_VALUE

    @pytest.mark.asyncio
    async def test_the_accession_matches_the_filing_that_reports_the_quarter(
        self, channel
    ):
        r = await _golden(channel)
        ind = await _independent()
        assert r.metadata["accn"] == ind["accn"]

    @pytest.mark.asyncio
    async def test_the_form_is_the_quarterly_report(self, channel):
        r = await _golden(channel)
        assert r.metadata["form"].startswith(EXPECTED_FORM)

    @pytest.mark.asyncio
    async def test_the_fiscal_period_is_q3_fy2026(self, channel):
        r = await _golden(channel)
        assert r.metadata["fiscal_year"] == EXPECTED_FY
        assert r.metadata["fiscal_quarter"] == EXPECTED_FQ

    @pytest.mark.asyncio
    async def test_the_period_is_the_quarter_span_not_the_year_to_date(self, channel):
        """
        Q3 FY2026 ends 2025-10-26 — a calendar year earlier than the fiscal
        label — and the same filing tags a 272-day span under the same concept.
        """
        r = await _golden(channel)
        assert r.metadata["period_start"] == EXPECTED_START
        assert r.metadata["period_end"] == EXPECTED_END
        days = 90
        from datetime import date

        span = (date.fromisoformat(EXPECTED_END) - date.fromisoformat(EXPECTED_START)).days
        assert abs(span - days) <= 10, span

    @pytest.mark.asyncio
    async def test_the_unit_is_us_dollars(self, channel):
        r = await _golden(channel)
        assert r.metadata["unit"] == EXPECTED_UNIT

    @pytest.mark.asyncio
    async def test_the_segment_is_data_center_and_nothing_adjacent(self, channel):
        """Compute & Networking sits 0.6% away and means something else."""
        r = await _golden(channel)
        members = " ".join(
            str(d.get("member", "")) for d in (r.metadata.get("dimensions") or [])
        )
        assert "DataCenter" in members, members
        assert "ComputeAndNetworking" not in members, members

    @pytest.mark.asyncio
    async def test_the_fact_passed_verification(self, channel):
        r = await _golden(channel)
        assert r.metadata["verification_status"] == "verified"

    @pytest.mark.asyncio
    async def test_the_evidence_came_from_the_filing_instance(self, channel):
        """Not from the companyconcept aggregation — segment facts are not
        in that endpoint at all."""
        r = await _golden(channel)
        ind = await _independent()
        assert r.metadata["extraction_method"] == "filing_instance"
        assert r.metadata["document_url"].endswith(ind["instance"])
        assert r.metadata["context_id"]

    @pytest.mark.asyncio
    async def test_the_citation_names_the_exact_live_filing(self, channel):
        from app.core.search_pipeline import _normalize_citations

        r = await _golden(channel)
        ind = await _independent()
        c = _normalize_citations(
            [{"id": 1, "source": r.document_title, "text": r.text}], [r]
        )[0]
        assert c["accession"] == ind["accn"]
        assert c["url"].startswith("https://www.sec.gov/Archives/edgar/data/")
        assert ind["accn"] in c["url"]
        assert "browse-edgar" not in c["url"]
        assert c["provenance"]["value"] == ind["value"]
        assert c["provenance"]["verification_status"] == "verified"


# ── S10: live negatives ─────────────────────────────────────────────────────


class TestLiveNegatives:
    """
    Each of these is a wrong answer the resolver could plausibly give. Run live,
    serially, one resolver call each.
    """

    @pytest.mark.asyncio
    async def test_the_year_to_date_column_is_never_returned(self, channel):
        r = await _golden(channel)
        assert r.metadata["value"] != YTD_THROUGH_Q3

    @pytest.mark.asyncio
    async def test_the_consolidated_total_is_never_returned_as_the_segment(
        self, channel
    ):
        r = await _golden(channel)
        assert r.metadata["value"] != CONSOLIDATED

    @pytest.mark.asyncio
    async def test_the_adjacent_segment_is_never_returned(self, channel):
        r = await _golden(channel)
        assert r.metadata["value"] != COMPUTE_AND_NETWORKING

    @pytest.mark.asyncio
    async def test_a_different_quarter_resolves_to_a_different_period(self, channel):
        """Live: asking for Q2 must not return the Q3 answer."""
        await _warm(channel)
        out = await channel.search(
            "What was NVIDIA's Data Center revenue in Q2 FY2026?", top_k=3
        )
        if not out:
            pytest.skip("live SEC returned no Q2 fact; nothing to compare")
        assert out[0].metadata["fiscal_quarter"] == 2
        assert out[0].metadata["period_end"] != EXPECTED_END
        assert out[0].metadata["value"] != EXPECTED_VALUE

    @pytest.mark.asyncio
    async def test_an_annual_question_is_not_answered_with_a_quarter(self, channel):
        await _warm(channel)
        out = await channel.search(
            "What was NVIDIA's total revenue in FY2025?", top_k=3
        )
        if not out:
            pytest.skip("live SEC returned no FY2025 annual fact")
        r = out[0]
        assert r.metadata["fiscal_quarter"] is None
        from datetime import date

        if r.metadata.get("period_start"):
            span = (
                date.fromisoformat(r.metadata["period_end"])
                - date.fromisoformat(r.metadata["period_start"])
            ).days
            assert span > 300, f"an annual question returned a {span}-day span"

    @pytest.mark.asyncio
    async def test_a_consolidated_question_is_not_answered_with_a_segment(
        self, channel
    ):
        await _warm(channel)
        out = await channel.search(
            "What was NVDA total revenue in Q3 FY2026?", top_k=3
        )
        assert out, "live SEC returned no consolidated Q3 figure"
        r = out[0]
        assert not r.metadata.get("dimensions")
        assert r.metadata["value"] != EXPECTED_VALUE

    @pytest.mark.asyncio
    async def test_a_different_metric_resolves_to_a_different_concept(self, channel):
        await _warm(channel)
        out = await channel.search(
            "What was NVDA net income in Q3 FY2026?", top_k=3
        )
        assert out, "live SEC returned no net income figure"
        assert out[0].metadata["tag"] == "NetIncomeLoss"
        assert out[0].metadata["value"] != EXPECTED_VALUE

    @pytest.mark.asyncio
    async def test_a_metric_the_filer_does_not_report_yields_nothing(self, channel):
        """A truthful empty answer, not a plausible substitute."""
        await _warm(channel)
        cik = await channel.ticker_to_cik(TICKER)
        assert cik == CIK
        found = await channel._fetch_concept(cik, "DepositsFromBanks", [2026])
        assert found is None, "NVIDIA does not report a banking deposits concept"


# ── S11: the budget is enforced, not merely documented ──────────────────────


class TestLiveRateLimitSafety:
    @pytest.mark.asyncio
    async def test_the_identity_map_is_downloaded_at_most_once(self, channel):
        await _golden(channel)
        identity = [u for u in _REQUESTS if "company_tickers" in u]
        assert len(identity) <= 1, identity

    @pytest.mark.asyncio
    async def test_an_identifying_user_agent_is_sent(self, channel):
        from app.config import settings

        ua = settings.sec_user_agent
        assert ua and "@" in ua, (
            "SEC requires an identifying User-Agent with contact information"
        )

    @pytest.mark.asyncio
    async def test_the_request_budget_is_respected(self, channel):
        """
        Runs last by name ordering within the class; whatever has executed so
        far must fit the documented budget. A change that starts re-resolving
        per assertion fails here rather than at sec.gov.
        """
        await _golden(channel)
        # Printed so the measured budget is a number in the run output rather
        # than a claim in a docstring. `pytest -s` shows it.
        print("LIVE SEC REQUESTS: " + str(len(_REQUESTS)))
        for u in _REQUESTS:
            print("  " + u)
        assert len(_REQUESTS) <= MAX_LIVE_REQUESTS, (
            f"{len(_REQUESTS)} live SEC requests, budget {MAX_LIVE_REQUESTS}:\n"
            + "\n".join(_REQUESTS)
        )
