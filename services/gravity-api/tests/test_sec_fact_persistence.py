"""
Persisting a query-time SEC fact back into the corpus.

The channel answers from EDGAR when the corpus is empty; this is what stops it
from having to do that twice. A verified fact becomes a row in the same Supabase
`financials` table `structured_search` already reads — no new table, no new
database, and no blocking work on the request path.

The shape of the row is not cosmetic. `structured_search` finds exact facts by
the `_xbrl` suffix on `id` and anchors revenue synonyms to the *start* of
`metric_name` (`ilike.Revenue*`), so a row that leads with "Data Center revenue"
is a correct fact the reader can never select. These tests pin both.

Verified against the live table on 2026-08-23: the row below upserts, reads back
byte-identical, and ranks first for an NVDA revenue selection.
"""

import pytest

from app.core.retrieval.fact_persistence import (
    MAX_ROWS_PER_QUERY,
    fact_row,
    persist,
)
from app.core.retrieval.fusion import RetrievalResult

ACCN = "0001045810-25-000230"


def _result(**meta):
    base = {
        "accn": ACCN,
        "cik": 1045810,
        "tag": "Revenues",
        "unit": "USD",
        "form": "10-Q",
        "fiscal_year": 2026,
        "fiscal_quarter": 3,
        "period_start": "2025-07-28",
        "period_end": "2025-10-26",
        "value": 51_215_000_000,
        "derived": False,
    }
    base.update(meta)
    return RetrievalResult(
        chunk_id="edgar:NVDA:Revenues:FY2026Q3",
        document_id=f"edgar:NVDA:{ACCN}",
        text="[EXACT FILING FIGURE] NVDA data center revenue for FY2026 Q3 (10-Q): $51,215,000,000",
        score=1.0,
        document_title="NVDA 10-Q — FY2026 Q3",
        ticker="NVDA",
        metadata=base,
    )


DIMENSIONAL = dict(
    row_label="data center",
    dimensions=[{"axis": "srt:ProductOrServiceAxis", "member": "nvda:DataCenterMember"}],
)


class TestTheRowTheReaderCanActuallyFind:
    def test_the_id_carries_the_xbrl_suffix(self):
        row = fact_row(_result(**DIMENSIONAL))
        assert row["id"].endswith("_xbrl"), (
            "structured_search selects exact facts by this suffix"
        )

    def test_the_id_separates_a_segment_from_the_consolidated_total(self):
        seg = fact_row(_result(**DIMENSIONAL))["id"]
        con = fact_row(_result())["id"]
        assert seg != con, "one key for both would overwrite the total with a segment"
        assert seg == "NVDA_Revenues_DataCenter_FY2026Q3_xbrl"
        assert con == "NVDA_Revenues_FY2026Q3_xbrl"

    def test_the_metric_name_starts_with_the_concept(self):
        row = fact_row(_result(**DIMENSIONAL))
        assert row["metric_name"].startswith("Revenue"), (
            "structured_search anchors revenue synonyms with ilike.Revenue* — a "
            "label starting with 'Data Center' is unreachable"
        )

    def test_the_metric_name_still_carries_the_breakdown(self):
        row = fact_row(_result(**DIMENSIONAL))
        assert "Data Center" in row["metric_name"]

    def test_the_value_is_stored_without_a_float_tail(self):
        row = fact_row(_result(**DIMENSIONAL))
        assert row["value_raw"] == "51215000000"
        assert row["value_float"] == 51_215_000_000

    def test_the_filing_identity_travels_with_the_row(self):
        row = fact_row(_result(**DIMENSIONAL))
        assert ACCN in row["document_id"]
        assert row["filing_type"] == "10-Q"
        assert row["filing_date"] == "2025-10-26"

    def test_the_concept_and_member_are_recorded_in_the_caption(self):
        row = fact_row(_result(**DIMENSIONAL))
        assert row["caption"] == "Revenues@data center"

    def test_the_row_carries_the_identity_the_evidence_gate_requires(self):
        """`source_section` holds structured provenance, not just a label. The
        gate refuses to bypass SEC for any row that cannot prove this much, so a
        row missing a field here is a row that can never serve a second query."""
        from app.core.retrieval.evidence_gate import decode_provenance

        prov = decode_provenance(fact_row(_result(**DIMENSIONAL))["source_section"])
        assert prov is not None
        assert prov["src"] == "filing_instance"
        assert prov["cik"] == "1045810"
        assert prov["concept"] == "Revenues"
        assert prov["fy"] == "2026"
        assert prov["fq"] == "3"
        assert prov["dim"] == "data center"
        assert prov["scope"] == "segment"
        assert prov["start"] == "2025-07-28"
        assert prov["end"] == "2025-10-26"
        assert prov["accn"] == ACCN
        assert prov["form"] == "10-Q"
        assert prov["unit"] == "USD"
        assert prov["ver"] == "verified"

    def test_a_consolidated_fact_records_its_scope_and_source(self):
        from app.core.retrieval.evidence_gate import decode_provenance

        prov = decode_provenance(fact_row(_result())["source_section"])
        assert prov["src"] == "companyconcept"
        assert prov["scope"] == "consolidated"
        assert "dim" not in prov, "a consolidated row must carry no breakdown"

    def test_only_columns_the_table_has_are_written(self):
        # Measured against the live table on 2026-08-23. `source_url` was in the
        # first draft and every insert 400'd on PGRST204.
        actual = {
            "caption", "company", "created_at", "document_id", "filing_date",
            "filing_type", "id", "metric_name", "period", "source_section",
            "ticker", "unit", "value_float", "value_raw",
        }
        assert set(fact_row(_result(**DIMENSIONAL))) <= actual


class TestWhatIsNotPersisted:
    def test_a_result_without_a_filing_is_not_stored(self):
        assert fact_row(_result(accn="")) is None

    def test_a_result_without_a_value_is_not_stored(self):
        assert fact_row(_result(value=None)) is None

    @pytest.mark.asyncio
    async def test_a_derived_quarter_is_never_stored_as_a_filed_fact(self):
        """A backed-out Q4 is arithmetic. It may be shown with its derivation
        stated; storing it makes it indistinguishable from a filed figure."""
        written = []

        async def _fake_insert(table, rows, on_conflict=None):
            written.extend(rows)
            return len(rows)

        import app.db.supabase_rest as sb

        old_insert, old_conf = sb.sb_insert, sb.configured
        sb.sb_insert, sb.configured = _fake_insert, lambda: True
        try:
            n = await persist([_result(derived=True, derivation="FY minus Q1-Q3")])
        finally:
            sb.sb_insert, sb.configured = old_insert, old_conf
        assert n == 0 and written == []

    @pytest.mark.asyncio
    async def test_nothing_is_written_when_supabase_is_unconfigured(self):
        import app.db.supabase_rest as sb

        old = sb.configured
        sb.configured = lambda: False
        try:
            assert await persist([_result(**DIMENSIONAL)]) == 0
        finally:
            sb.configured = old

    @pytest.mark.asyncio
    async def test_a_single_query_cannot_bulk_load_the_table(self):
        """R4 of the GRAVITY ledger caps Supabase at 450 MB. A query persists a
        handful of facts; anything more is an ingestion job in disguise."""
        written = []

        async def _fake_insert(table, rows, on_conflict=None):
            written.extend(rows)
            return len(rows)

        import app.db.supabase_rest as sb

        old_insert, old_conf = sb.sb_insert, sb.configured
        sb.sb_insert, sb.configured = _fake_insert, lambda: True
        try:
            many = [
                _result(fiscal_year=2000 + i, **DIMENSIONAL) for i in range(40)
            ]
            await persist(many)
        finally:
            sb.sb_insert, sb.configured = old_insert, old_conf
        assert len(written) <= MAX_ROWS_PER_QUERY

    @pytest.mark.asyncio
    async def test_the_same_fact_twice_upserts_rather_than_duplicating(self):
        rows = [fact_row(_result(**DIMENSIONAL)), fact_row(_result(**DIMENSIONAL))]
        assert rows[0]["id"] == rows[1]["id"]

        written = []

        async def _fake_insert(table, rows_, on_conflict=None):
            written.append(on_conflict)
            return len(rows_)

        import app.db.supabase_rest as sb

        old_insert, old_conf = sb.sb_insert, sb.configured
        sb.sb_insert, sb.configured = _fake_insert, lambda: True
        try:
            await persist([_result(**DIMENSIONAL), _result(**DIMENSIONAL)])
        finally:
            sb.sb_insert, sb.configured = old_insert, old_conf
        assert written == ["id"], "must upsert on the primary key, not append"


class TestPersistenceNeverBlocksTheAnswer:
    @pytest.mark.asyncio
    async def test_schedule_returns_before_the_write_completes(self):
        import asyncio

        from app.core.retrieval import fact_persistence

        started = asyncio.Event()
        released = asyncio.Event()

        async def _slow(table, rows, on_conflict=None):
            started.set()
            await released.wait()
            return len(rows)

        import app.db.supabase_rest as sb

        old_insert, old_conf = sb.sb_insert, sb.configured
        sb.sb_insert, sb.configured = _slow, lambda: True
        try:
            fact_persistence.schedule([_result(**DIMENSIONAL)])
            # schedule() has already returned while the write is still parked.
            await asyncio.wait_for(started.wait(), timeout=1)
            assert not released.is_set()
        finally:
            released.set()
            await asyncio.sleep(0)
            sb.sb_insert, sb.configured = old_insert, old_conf

    def test_scheduling_outside_an_event_loop_is_a_no_op_not_a_crash(self):
        from app.core.retrieval import fact_persistence

        fact_persistence.schedule([_result(**DIMENSIONAL)])  # must not raise
