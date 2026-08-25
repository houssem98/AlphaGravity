"""
Tests A-E of VERIFY_SEC_EVIDENCE_GATE.md: the gate's five routing outcomes,
proven at the SEC client boundary.

`test_evidence_gate.py` proves the routing arithmetic with counting channel
stubs. That is a level above the thing the specification actually asks about:
a stub channel that is never called proves the orchestrator skipped a channel,
not that no HTTP request reached sec.gov. §8 is explicit — "do NOT merely assert
sec_invoked == false if the underlying EDGAR client could still have been
called".

So these tests count differently. `EdgarSearch(http_client=...)` injects the
object `_client()` returns, and BOTH SEC paths go through it: `_get_json` (the
ticker map and companyconcept) and the client handed to `resolve_dimensional_fact`
(the filing index and the XBRL instance). Counting requests on that object counts
every SEC request the code makes, from underneath the channel rather than in
front of it. A regression that dropped the gate but kept the flag would fail
here and pass in the stub-level file.

The gate under test is the real `check_verified_local_evidence`, including its
`financials` lookup — only the row source is substituted, via the `selector`
argument the function already takes. The routing rule is `channels_after_gate`,
the same function `search_pipeline` calls, so this cannot pass against a
pipeline that stopped honouring the decision.
"""

from datetime import timedelta

import pytest

from app.core.retrieval.edgar_search import EdgarSearch
from app.core.retrieval.evidence_gate import (
    LOCAL_CONFLICT,
    LOCAL_MISS,
    LOCAL_UNVERIFIED,
    VERIFIED_LOCAL_HIT,
    channels_after_gate,
    check_verified_local_evidence,
)
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
    _row,
)
from tests.test_sec_query_time_regression import _SECFake


def _as_stored(row, at=None):
    """
    A row as it reads back OUT of `financials`, not as `fact_row` hands it in.

    `fact_row` deliberately omits `created_at`; the column carries a database
    default and Postgres assigns it on insert. Verified against the live table on
    2026-08-25 — every query-time row (CROX, DUOL, FIVE, WING) has a non-null
    `created_at` none of them were given by the writer. The gate reads that field
    to judge freshness, so a test that appends the pre-insert dict is testing a
    row shape that never reaches the gate in production.
    """
    return {**row, "created_at": (at or _now()).isoformat()}


class Routed:
    """What one question actually did."""

    __slots__ = ("decision", "edgar_invocations", "sec_http_requests", "urls", "results")

    def __init__(self, decision, edgar_invocations, urls, results):
        self.decision = decision
        self.edgar_invocations = edgar_invocations
        self.sec_http_requests = len(urls)
        self.urls = urls
        self.results = results


async def _ask(rows, query=THE_QUESTION, max_age_days=90):
    """
    Run one financial question end to end: the real gate against the supplied
    corpus, the real routing rule, and the real EDGAR channel when — and only
    when — the gate leaves it enabled.
    """

    async def _selector(table, filters, limit=50, **kw):
        assert table == "financials"
        return list(rows)

    decision = await check_verified_local_evidence(
        query=query,
        ticker=TICKER,
        cik=CIK,
        concept=CONCEPT,
        fiscal_year=FY,
        fiscal_quarter=FQ,
        max_age_days=max_age_days,
        company_terms=COMPANY_TERMS,
        selector=_selector,
    )

    channels = channels_after_gate(["structured", "edgar"], decision)

    sec = _SECFake()
    results, invocations = [], 0
    if "edgar" in channels:
        invocations = 1
        results = await EdgarSearch(http_client=sec).search(query, top_k=5)

    return Routed(decision, invocations, sec.urls, results)


class TestA_VerifiedLocalHit:
    """Exact verified evidence on file → the filer is not asked at all."""

    @pytest.mark.asyncio
    async def test_no_sec_request_is_made(self):
        r = await _ask([_row()])
        assert r.decision.status == VERIFIED_LOCAL_HIT
        assert r.decision.sec_invoked is False
        assert r.edgar_invocations == 0
        assert r.sec_http_requests == 0, f"SEC was contacted: {r.urls}"

    @pytest.mark.asyncio
    async def test_the_skip_reason_is_reported(self):
        r = await _ask([_row()])
        assert r.decision.telemetry() == {
            "local_evidence_status": VERIFIED_LOCAL_HIT,
            "sec_invoked": False,
            "sec_skip_reason": VERIFIED_LOCAL_HIT,
            "gate_reason": r.decision.reason,
            "gate_conflicts": 0,
        }


class TestB_EmptyLocalCorpus:
    """Nothing on file → the filer is asked, and answers with a cited fact."""

    @pytest.mark.asyncio
    async def test_sec_is_called(self):
        r = await _ask([])
        assert r.decision.status == LOCAL_MISS
        assert r.edgar_invocations == 1
        assert r.sec_http_requests > 0

    @pytest.mark.asyncio
    async def test_the_exact_filing_and_fact_come_back_verified(self):
        r = await _ask([])
        assert r.results, "the gate routed to SEC; SEC must answer"
        m = r.results[0].metadata
        assert m["value"] == DATA_CENTER
        assert m["accn"] == ACCN
        assert m["cik"] == CIK
        assert m["form"] == "10-Q"
        assert m["verification_status"] == "verified"
        assert m["dimensions"] == [
            {"axis": "srt:ProductOrServiceAxis", "member": "nvda:DataCenterMember"}
        ]

    @pytest.mark.asyncio
    async def test_the_instance_document_was_actually_fetched(self):
        """The segment figure exists only in the filing's XBRL instance —
        companyconcept cannot carry it. If no instance was fetched, the number
        did not come from where the citation says it did."""
        r = await _ask([])
        assert any(u.endswith("_htm.xml") for u in r.urls), r.urls

    @pytest.mark.asyncio
    async def test_the_answer_is_persistable(self):
        from app.core.retrieval.fact_persistence import fact_row

        r = await _ask([])
        row = fact_row(r.results[0])
        assert row is not None
        assert row["id"].endswith("_xbrl")


class TestC_SecondQueryAfterPersistence:
    """The point of persisting: the same question, asked again, costs nothing."""

    @pytest.mark.asyncio
    async def test_the_second_ask_makes_no_sec_request(self):
        from app.core.retrieval.fact_persistence import fact_row

        corpus: list[dict] = []

        first = await _ask(corpus)
        assert first.decision.status == LOCAL_MISS
        assert first.edgar_invocations == 1
        assert first.sec_http_requests > 0

        # Persist exactly what the channel produced — not a hand-built row.
        persisted = fact_row(first.results[0])
        assert persisted is not None
        corpus.append(_as_stored(persisted))

        second = await _ask(corpus)
        assert second.decision.status == VERIFIED_LOCAL_HIT
        assert second.edgar_invocations == 0
        assert second.sec_http_requests == 0, f"SEC re-contacted: {second.urls}"


class TestD_UnverifiedLocalData:
    """A row matching metric and period, without provenance, is not evidence."""

    @pytest.mark.asyncio
    async def test_a_legacy_backfill_row_still_calls_sec(self):
        r = await _ask([_row(source_section="xbrl_companyfacts")])
        assert r.decision.status == LOCAL_UNVERIFIED
        assert r.edgar_invocations == 1
        assert r.sec_http_requests > 0

    @pytest.mark.asyncio
    async def test_a_row_marked_unverified_still_calls_sec(self):
        r = await _ask([_row(prov={"ver": "unverified"})])
        assert r.decision.status == LOCAL_UNVERIFIED
        assert r.edgar_invocations == 1
        assert r.sec_http_requests > 0

    @pytest.mark.asyncio
    async def test_a_row_with_no_timestamp_still_calls_sec(self):
        """Freshness cannot be judged without `created_at`, and an unjudgeable
        row must fail closed. This is the state a row would be in if it reached
        the gate before the database assigned its default."""
        undated = {k: v for k, v in _row().items() if k != "created_at"}
        r = await _ask([undated])
        assert r.decision.status == LOCAL_UNVERIFIED
        assert "timestamp" in r.decision.reason
        assert r.edgar_invocations == 1
        assert r.sec_http_requests > 0

    @pytest.mark.asyncio
    async def test_it_is_not_reported_as_a_plain_miss(self):
        """§3: these states must not collapse into one generic miss."""
        r = await _ask([_row(source_section="xbrl_companyfacts")])
        assert r.decision.status != LOCAL_MISS


class TestE_ConflictingLocalData:
    """Two rows that disagree, or one too old to trust, are not evidence."""

    @pytest.mark.asyncio
    async def test_two_disagreeing_rows_call_sec(self):
        r = await _ask([_row(), _row(value_float=DATA_CENTER + 1)])
        assert r.decision.status == LOCAL_CONFLICT
        assert r.decision.conflicts
        assert r.edgar_invocations == 1
        assert r.sec_http_requests > 0

    @pytest.mark.asyncio
    async def test_a_stale_row_calls_sec(self):
        stale = _row(created_at=(_now() - timedelta(days=400)).isoformat())
        r = await _ask([stale])
        assert r.decision.status == LOCAL_CONFLICT
        assert r.edgar_invocations == 1
        assert r.sec_http_requests > 0

    @pytest.mark.asyncio
    async def test_it_is_not_reported_as_a_plain_miss(self):
        r = await _ask([_row(), _row(value_float=DATA_CENTER + 1)])
        assert r.decision.status != LOCAL_MISS


class TestTheRoutingRuleIsTheOneThePipelineUses:
    """
    §5: the gate must actually control execution. `channels_after_gate` is the
    function `search_pipeline.search()` calls, so these assertions are about the
    production rule rather than a restatement of it.
    """

    @pytest.mark.asyncio
    async def test_a_verified_hit_removes_edgar_and_nothing_else(self):
        d = (await _ask([_row()])).decision
        assert channels_after_gate(
            ["dense", "bm25", "structured", "edgar"], d
        ) == ["dense", "bm25", "structured"]

    @pytest.mark.asyncio
    async def test_every_sec_state_leaves_the_fan_out_intact(self):
        """§9: the gate narrows the SEC decision, never the research stack."""
        full = ["dense", "bm25", "splade", "graph", "structured", "tree_nav", "edgar"]
        for rows in (
            [],
            [_row(source_section="xbrl_companyfacts")],
            [_row(), _row(value_float=DATA_CENTER + 1)],
        ):
            d = (await _ask(rows)).decision
            assert d.sec_invoked is True
            assert channels_after_gate(full, d) == full

    def test_an_absent_decision_never_silently_skips_sec(self):
        """A gate that failed to run must not look like a verified hit."""
        assert channels_after_gate(["structured", "edgar"], None) == [
            "structured",
            "edgar",
        ]
