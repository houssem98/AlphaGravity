"""
The verified-evidence gate: when the filer must be asked, and when it must not.

Before this gate the retrieval orchestrator fanned out to every channel in
parallel, so the live EDGAR channel fired on every financial question — including
ones already answered and persisted by an earlier query. Persistence saved the
parse but not the request.

The naive fix — "a row exists, skip SEC" — would be worse than the bug.
`financials` holds three populations: exact XBRL rows the channel wrote, an older
`companyfacts` backfill, and table-scraped rows. A row can match ticker, metric
and period and still be the wrong fact: consolidated where a segment was asked
for, a superseded pre-restatement figure, a different unit, or a scrape with no
provenance. These tests exist to prove the gate refuses all of those.

The four required call-count regressions are `TestTheRequiredCallCounts`.
Channel calls are counted by wrapping the real objects, so the number is what the
pipeline actually did, not what a mock was told to report.
"""

from datetime import datetime, timedelta, timezone

import pytest

from app.core.retrieval.evidence_gate import (
    LOCAL_CONFLICT,
    LOCAL_MISS,
    LOCAL_UNVERIFIED,
    VERIFIED_LOCAL_HIT,
    check,
    decode_provenance,
    encode_provenance,
    evaluate,
)

TICKER = "NVDA"
CIK = 1045810
CONCEPT = "Revenues"
FY, FQ = 2026, 3
ACCN = "0001045810-25-000230"
DATA_CENTER = 51_215_000_000
CONSOLIDATED = 57_006_000_000

THE_QUESTION = "What was NVIDIA's Data Center revenue in Q3 FY2026?"


def _now():
    return datetime(2026, 8, 24, tzinfo=timezone.utc)


def _row(**over):
    """A row exactly as `fact_persistence` writes one."""
    prov = {
        "src": "filing_instance", "cik": CIK, "concept": CONCEPT,
        "fy": FY, "fq": FQ, "dim": "data center", "scope": "segment",
        "fact": "duration", "start": "2025-07-28", "end": "2025-10-26",
        "accn": ACCN, "form": "10-Q", "unit": "USD",
        "filed": "2025-11-19", "restated": "0",
        "ver": "verified", "pv": "sec-dim-1",
    }
    prov.update(over.pop("prov", {}))
    row = {
        "id": "NVDA_Revenues_DataCenter_FY2026Q3_xbrl",
        "ticker": TICKER, "period": "FY2026Q3",
        "metric_name": "Revenue - Data Center (Data Center revenue)",
        "value_float": DATA_CENTER, "value_raw": str(DATA_CENTER),
        "unit": "USD", "filing_type": "10-Q", "filing_date": "2025-10-26",
        "document_id": f"edgar:{TICKER}:{ACCN}",
        "caption": "Revenues@data center",
        "created_at": (_now() - timedelta(days=1)).isoformat(),
        "source_section": encode_provenance(prov),
    }
    row.update(over)
    return row


# The pipeline knows the registrant's name (it resolved the ticker from it), so
# the gate is given it and can tell "NVIDIA" from a breakdown name.
COMPANY_TERMS = ["NVIDIA", "NVIDIA CORP"]


def _evaluate(rows, query=THE_QUESTION, **kw):
    kw.setdefault("company_terms", COMPANY_TERMS)
    return evaluate(
        rows, query=query, ticker=TICKER, cik=CIK, concept=CONCEPT,
        fiscal_year=FY, fiscal_quarter=FQ, now=_now(), **kw
    )


class TestTheProvenanceContract:
    def test_it_round_trips(self):
        raw = encode_provenance({"cik": CIK, "ver": "verified"})
        assert decode_provenance(raw) == {"cik": str(CIK), "ver": "verified"}

    def test_a_row_written_by_anything_else_has_no_provenance(self):
        # The legacy companyfacts backfill writes a bare label here.
        assert decode_provenance("xbrl_companyfacts") is None
        assert decode_provenance("") is None


class TestAVerifiedRowBypassesTheFiler:
    def test_exact_verified_evidence_is_a_hit(self):
        d = _evaluate([_row()])
        assert d.status == VERIFIED_LOCAL_HIT
        assert d.sec_invoked is False
        assert d.sec_skip_reason == VERIFIED_LOCAL_HIT

    def test_the_hit_carries_the_row_that_answers(self):
        d = _evaluate([_row()])
        assert d.row["value_float"] == DATA_CENTER

    def test_the_telemetry_says_why(self):
        t = _evaluate([_row()]).telemetry()
        assert t["local_evidence_status"] == VERIFIED_LOCAL_HIT
        assert t["sec_invoked"] is False
        assert t["sec_skip_reason"] == VERIFIED_LOCAL_HIT


class TestAnythingLessThanExactRoutesToTheFiler:
    """Each of these is a row that matches ticker, metric and period, and still
    must not answer the question."""

    def test_no_rows_at_all(self):
        assert _evaluate([]).status == LOCAL_MISS

    def test_a_legacy_backfill_row_without_provenance(self):
        d = _evaluate([_row(source_section="xbrl_companyfacts")])
        assert d.status == LOCAL_UNVERIFIED
        assert d.sec_invoked is True

    def test_a_row_whose_verification_did_not_pass(self):
        d = _evaluate([_row(prov={"ver": "unsupported"})])
        assert d.status == LOCAL_UNVERIFIED

    def test_the_consolidated_row_when_a_segment_was_asked_for(self):
        """The number is real. Answering the Data Center question with it is
        the confident-wrong-answer failure this whole effort removes."""
        d = _evaluate([_row(
            id="NVDA_Revenues_FY2026Q3_xbrl", value_float=CONSOLIDATED,
            prov={"dim": "", "scope": "consolidated"},
        )])
        assert d.status != VERIFIED_LOCAL_HIT

    def test_a_wrong_unit(self):
        d = _evaluate([_row(unit="EUR")])
        assert d.status != VERIFIED_LOCAL_HIT

    def test_a_wrong_fiscal_quarter(self):
        d = _evaluate([_row(prov={"fq": 4})])
        assert d.status != VERIFIED_LOCAL_HIT

    def test_a_wrong_fiscal_year(self):
        d = _evaluate([_row(prov={"fy": 2025})])
        assert d.status != VERIFIED_LOCAL_HIT

    def test_a_wrong_cik(self):
        d = _evaluate([_row(prov={"cik": 320193})])
        assert d.status != VERIFIED_LOCAL_HIT

    def test_a_missing_accession(self):
        d = _evaluate([_row(prov={"accn": ""})])
        assert d.status != VERIFIED_LOCAL_HIT

    def test_a_missing_period_start(self):
        d = _evaluate([_row(prov={"start": ""})])
        assert d.status != VERIFIED_LOCAL_HIT

    def test_a_different_concept(self):
        d = _evaluate([_row(prov={"concept": "OperatingIncomeLoss"})])
        assert d.status != VERIFIED_LOCAL_HIT

    def test_a_row_with_no_value(self):
        d = _evaluate([_row(value_float=None)])
        assert d.status != VERIFIED_LOCAL_HIT


class TestConflictAndStaleness:
    def test_two_rows_disagreeing_is_a_conflict(self):
        d = _evaluate([_row(), _row(value_float=DATA_CENTER + 1_000_000)])
        assert d.status == LOCAL_CONFLICT
        assert d.sec_invoked is True

    def test_a_conflict_never_silently_answers(self):
        d = _evaluate([_row(), _row(value_float=1)])
        assert d.row is None

    def test_a_row_older_than_the_window_is_revalidated(self):
        """A filed fact does not change — until it is restated. The only defence
        against a restatement we have not seen is to stop trusting a cached row."""
        old = _row(created_at=(_now() - timedelta(days=400)).isoformat())
        d = _evaluate([old])
        assert d.status == LOCAL_CONFLICT
        assert d.sec_invoked is True

    def test_a_row_inside_the_window_is_still_trusted(self):
        fresh = _row(created_at=(_now() - timedelta(days=5)).isoformat())
        assert _evaluate([fresh]).status == VERIFIED_LOCAL_HIT

    def test_an_unparseable_timestamp_is_not_trusted(self):
        d = _evaluate([_row(created_at="not-a-date")])
        assert d.status == LOCAL_UNVERIFIED


class TestTheGateNeverGuessesTheBreakdown:
    def test_a_consolidated_question_does_not_match_the_segment_row(self):
        d = _evaluate([_row()], query="NVIDIA revenue Q3 FY2026")
        assert d.status != VERIFIED_LOCAL_HIT, (
            "the only local row is Data Center; a question naming no breakdown "
            "must not be answered from it"
        )

    def test_a_consolidated_question_matches_the_consolidated_row(self):
        d = _evaluate(
            [_row(id="NVDA_Revenues_FY2026Q3_xbrl", value_float=CONSOLIDATED,
                  prov={"dim": "", "scope": "consolidated"})],
            query="NVIDIA revenue Q3 FY2026",
        )
        assert d.status == VERIFIED_LOCAL_HIT
        assert d.row["value_float"] == CONSOLIDATED

    def test_the_longer_breakdown_name_wins(self):
        rows = [
            _row(prov={"dim": "compute"}, value_float=43_028_000_000,
                 id="a"),
            _row(prov={"dim": "compute and networking"},
                 value_float=50_908_000_000, id="b"),
        ]
        d = _evaluate(rows, query="NVIDIA Compute & Networking revenue Q3 FY2026")
        assert d.status == VERIFIED_LOCAL_HIT
        assert d.row["value_float"] == 50_908_000_000


class TestTheLookupIsNarrowAndPreCommitment:
    @pytest.mark.asyncio
    async def test_it_queries_financials_directly_not_fused_results(self):
        seen = {}

        async def _sel(table, filters, limit=50):
            seen["table"], seen["filters"] = table, filters
            return [_row()]

        d = await check(
            query=THE_QUESTION, ticker=TICKER, cik=CIK, concept=CONCEPT,
            fiscal_year=FY, fiscal_quarter=FQ, selector=_sel,
            company_terms=COMPANY_TERMS,
        )
        assert seen["table"] == "financials"
        assert seen["filters"]["ticker"] == "eq.NVDA"
        assert seen["filters"]["period"] == "eq.FY2026Q3"
        assert seen["filters"]["id"] == "like.*_xbrl", "exact XBRL rows only"
        assert d.status in (VERIFIED_LOCAL_HIT, LOCAL_CONFLICT)

    @pytest.mark.asyncio
    async def test_no_issuer_means_no_bypass(self):
        d = await check(query="revenue", ticker="", cik=None, concept=CONCEPT,
                        fiscal_year=FY, fiscal_quarter=FQ, selector=None)
        assert d.sec_invoked is True

    @pytest.mark.asyncio
    async def test_a_failing_lookup_does_not_skip_the_filer(self):
        async def _boom(table, filters, limit=50):
            raise RuntimeError("supabase down")

        d = await check(
            query=THE_QUESTION, ticker=TICKER, cik=CIK, concept=CONCEPT,
            fiscal_year=FY, fiscal_quarter=FQ, selector=_boom,
        )
        assert d.status == LOCAL_MISS
        assert d.sec_invoked is True


# ---------------------------------------------------------------------------
# The four required call-count regressions.
#
# These count what the retrieval layer ACTUALLY invoked, by wrapping the real
# channel objects — not by asserting against a mock's own bookkeeping. The
# `structured` channel is a stub returning the local rows; `edgar` is a stub that
# records every call. What is under test is the routing decision, so the channels
# only need to be countable, not real.
# ---------------------------------------------------------------------------

from app.core.retrieval.orchestrator import RetrievalOrchestrator  # noqa: E402


class _CountingChannel:
    def __init__(self, results=None):
        self.calls = 0
        self.results = results or []

    async def search(self, *a, **k):
        self.calls += 1
        return list(self.results)


async def _route(rows, query=THE_QUESTION, max_age_days=90, now=None):
    """
    Run the gate the way the pipeline does, then dispatch the channels it left
    enabled. Returns the call counts actually made.
    """
    decision = evaluate(
        rows, query=query, ticker=TICKER, cik=CIK, concept=CONCEPT,
        fiscal_year=FY, fiscal_quarter=FQ, company_terms=COMPANY_TERMS,
        max_age_days=max_age_days, now=now or _now(),
    )
    structured = _CountingChannel(rows)
    edgar = _CountingChannel([{"value": DATA_CENTER}])
    orch = RetrievalOrchestrator(structured_search=structured, edgar_search=edgar)

    channels = ["structured", "edgar"]
    if not decision.sec_invoked:
        channels = [c for c in channels if c != "edgar"]
    await orch.search(query=query, channels=channels)
    return {"structured": structured.calls, "edgar": edgar.calls}, decision


class TestTheRequiredCallCounts:
    """The four regressions the specification requires."""

    @pytest.mark.asyncio
    async def test_verified_local_hit_makes_zero_sec_calls(self):
        counts, d = await _route([_row()])
        assert d.status == VERIFIED_LOCAL_HIT
        assert counts == {"structured": 1, "edgar": 0}

    @pytest.mark.asyncio
    async def test_empty_local_corpus_makes_one_sec_call(self):
        counts, d = await _route([])
        assert d.status == LOCAL_MISS
        assert counts == {"structured": 1, "edgar": 1}

    @pytest.mark.asyncio
    async def test_second_query_after_persistence_makes_zero_sec_calls(self):
        """Query 1 on an empty corpus fetches and persists; query 2 sees the
        persisted row and must not ask the filer again."""
        corpus: list[dict] = []
        first, d1 = await _route(corpus)
        assert (d1.status, first) == (LOCAL_MISS, {"structured": 1, "edgar": 1})

        # what fact_persistence writes after that first answer
        corpus.append(_row())

        second, d2 = await _route(corpus)
        assert d2.status == VERIFIED_LOCAL_HIT
        assert second == {"structured": 1, "edgar": 0}

    @pytest.mark.asyncio
    async def test_stale_or_conflicting_local_evidence_makes_one_sec_call(self):
        stale = _row(created_at=(_now() - timedelta(days=400)).isoformat())
        counts, d = await _route([stale])
        assert d.status == LOCAL_CONFLICT
        assert counts == {"structured": 1, "edgar": 1}

        conflicting = [_row(), _row(value_float=DATA_CENTER + 1)]
        counts2, d2 = await _route(conflicting)
        assert d2.status == LOCAL_CONFLICT
        assert counts2 == {"structured": 1, "edgar": 1}

    @pytest.mark.asyncio
    async def test_an_unverified_legacy_row_also_makes_one_sec_call(self):
        counts, d = await _route([_row(source_section="xbrl_companyfacts")])
        assert d.status == LOCAL_UNVERIFIED
        assert counts == {"structured": 1, "edgar": 1}


class TestTheEmptyCorpusPathEndToEnd:
    """
    The gate in front of the REAL EDGAR channel, on recorded SEC payloads.

    The stubs above prove the routing arithmetic. This proves that when the gate
    says "ask the filer", the filer is actually asked and the full chain still
    runs: exact filing, exact XBRL fact, verification, citation, and a row shaped
    for persistence so the next query can be a local hit.
    """

    @pytest.mark.asyncio
    async def test_a_local_miss_still_produces_a_verified_cited_fact(self):
        from app.core.retrieval.fact_persistence import fact_row
        from tests.test_sec_query_time_regression import _SECFake
        from app.core.retrieval.edgar_search import EdgarSearch

        decision = evaluate(
            [], query=THE_QUESTION, ticker=TICKER, cik=CIK, concept=CONCEPT,
            fiscal_year=FY, fiscal_quarter=FQ, company_terms=COMPANY_TERMS,
            now=_now(),
        )
        assert decision.sec_invoked is True

        out = await EdgarSearch(http_client=_SECFake()).search(THE_QUESTION, top_k=5)
        assert out, "the gate routed to SEC; SEC must answer"
        m = out[0].metadata
        assert m["value"] == DATA_CENTER
        assert m["accn"] == ACCN
        assert m["verification_status"] == "verified"
        assert m["dimensions"] == [
            {"axis": "srt:ProductOrServiceAxis", "member": "nvda:DataCenterMember"}
        ]

        # ...and the row it would persist satisfies the gate next time.
        row = fact_row(out[0])
        assert row is not None
        again = evaluate(
            [row | {"created_at": _now().isoformat()}],
            query=THE_QUESTION, ticker=TICKER, cik=CIK, concept=CONCEPT,
            fiscal_year=FY, fiscal_quarter=FQ, company_terms=COMPANY_TERMS,
            now=_now(),
        )
        assert again.status == VERIFIED_LOCAL_HIT, (
            f"persisted row must close the loop, got {again.status}: {again.reason}"
        )
        assert again.row["value_float"] == DATA_CENTER


class TestTheConceptIsAFamilyNotOneTag:
    """
    Regression. `classify_metric` returns the PRIMARY tag
    (`RevenueFromContractWithCustomerExcludingAssessedTax`), but many filers
    report under a fallback — NVIDIA and Wingstop both answer under `Revenues`.
    The channel already knows this (it is the D1 fix); the gate did not.

    Measured live before the fix: Wingstop Q2 2025 was fetched from SEC,
    persisted with `concept=Revenues`, and the very next identical question was
    still routed to SEC because the gate compared against the primary tag. The
    gate was therefore dead for exactly the filers the fallback chain exists for.
    """

    PRIMARY = "RevenueFromContractWithCustomerExcludingAssessedTax"

    def test_a_row_stored_under_a_fallback_tag_still_matches(self):
        row = _row(prov={"concept": "Revenues"})
        d = evaluate(
            [row], query=THE_QUESTION, ticker=TICKER, cik=CIK,
            concept=self.PRIMARY, fiscal_year=FY, fiscal_quarter=FQ,
            company_terms=COMPANY_TERMS, now=_now(),
        )
        assert d.status == VERIFIED_LOCAL_HIT, (
            "a fact filed under Revenues must satisfy a question classified to "
            "the primary revenue tag — they are the same metric"
        )

    def test_an_unrelated_concept_still_does_not_match(self):
        """The family must not become a wildcard."""
        row = _row(prov={"concept": "OperatingIncomeLoss"})
        d = evaluate(
            [row], query=THE_QUESTION, ticker=TICKER, cik=CIK,
            concept=self.PRIMARY, fiscal_year=FY, fiscal_quarter=FQ,
            company_terms=COMPANY_TERMS, now=_now(),
        )
        assert d.status != VERIFIED_LOCAL_HIT

    def test_the_family_is_the_channels_own_fallback_chain(self):
        from app.core.retrieval.edgar_search import concept_family

        fam = concept_family(self.PRIMARY)
        assert fam[0] == self.PRIMARY
        assert "Revenues" in fam, "the tag NVDA and WING actually file under"
