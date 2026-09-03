"""
Quarterly rows (FY2023Q1) live in `financials` beside the annual ones (FY2023),
and `period` is TEXT ordered descending under a 24-row budget — so "FY2025Q3"
sorts above "FY2025". Left ungated, four quarters per year per metric would push
the annual figures out of context and silently undo GS-3.

These assert the PostgREST filter, so they need no network.
"""
import pytest

from app.core.retrieval.structured_search import StructuredSearch


@pytest.fixture
def captured(monkeypatch):
    seen = {}

    async def fake_select(table, filters, select="*", limit=10):
        seen["filters"] = dict(filters)
        return []

    from app.db import supabase_rest
    monkeypatch.setattr(supabase_rest, "sb_select", fake_select)

    async def run(query, tickers=("AAPL",)):
        entities = {"companies": [{"ticker": t} for t in tickers]}
        await StructuredSearch()._search_supabase(query, entities, None, 10)
        return seen["filters"]

    return run


class TestAnnualQueriesStayAnnual:
    @pytest.mark.asyncio
    async def test_a_query_with_no_year_excludes_quarters_by_shape(self, captured):
        flt = await captured("What was Apple's revenue?")
        assert flt["period"] == "not.like.FY*Q*"

    @pytest.mark.asyncio
    async def test_the_exclusion_is_scoped_to_the_fy_prefix(self, captured):
        # non-xbrl rows carry periods like "2026-05-20"; a bare *Q* pattern would
        # be free to match junk elsewhere, so the filter is anchored on FY
        flt = await captured("What was Apple's revenue?")
        assert flt["period"].startswith("not.like.FY")

    @pytest.mark.asyncio
    async def test_a_year_query_requests_only_annual_periods(self, captured):
        flt = await captured("Apple revenue in 2023")
        assert "Q" not in flt["period"]
        assert "FY2023" in flt["period"] and "FY2022" in flt["period"]

    @pytest.mark.asyncio
    async def test_newest_period_still_sorts_first(self, captured):
        flt = await captured("Apple revenue in 2023")
        # `id.asc` appended by L9/R10: `period` is not unique, so it ordered
        # without selecting and ties went to the query planner. Newest period
        # first is unchanged and still leads.
        assert flt["order"] == "period.desc,id.asc"


class TestQuarterIntentOptsIn:
    @pytest.mark.asyncio
    async def test_quarterly_with_a_year_requests_all_four_quarters(self, captured):
        flt = await captured("Apple quarterly revenue in 2023")
        for q in (1, 2, 3, 4):
            assert f"FY2023Q{q}" in flt["period"]

    @pytest.mark.asyncio
    async def test_quarterly_still_requests_the_annual_row_it_derives_from(self, captured):
        # the FY total is what makes a derived Q4 checkable
        flt = await captured("Apple quarterly revenue in 2023")
        assert "FY2023," in flt["period"] or flt["period"].endswith("FY2023")

    @pytest.mark.asyncio
    async def test_quarterly_with_no_year_does_not_exclude_quarters(self, captured):
        flt = await captured("Apple revenue by quarter")
        assert flt.get("period", "") != "not.like.FY*Q*"

    @pytest.mark.parametrize("q", [
        "Apple quarterly revenue",
        "Apple revenue by quarter",
        "Apple Q3 revenue",
        "revenue for each quarter",
    ])
    @pytest.mark.asyncio
    async def test_these_all_read_as_quarter_intent(self, captured, q):
        flt = await captured(q)
        assert flt.get("period", "") != "not.like.FY*Q*"

    @pytest.mark.parametrize("q", [
        "Apple annual revenue",
        "Apple headquarters",
        "Apple gross margin",
    ])
    @pytest.mark.asyncio
    async def test_these_do_not(self, captured, q):
        flt = await captured(q)
        assert flt["period"] == "not.like.FY*Q*"
