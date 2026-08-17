"""GS-3 — a ratio query must fetch the components the ratio is made of.

Measured on prod 2026-08-17: "Compare NVDA and AMD inventory turnover for the
latest reported fiscal year" retrieved 11 passages (7 NVDA, 4 AMD) and answered
"cost of goods sold is missing from the sources", while
AMD_CostOfGoodsAndServicesSold_FY2025_xbrl = 17,487,000,000 and
NVDA_CostOfRevenue_FY2026_xbrl = 62,475,000,000 both sat in `financials`.

Cause: "inventory turnover" matched the bare term "inventory" first, so the fetch
narrowed to inventory balances and the numerator was never asked for.

These tests capture the PostgREST filter the channel builds, so they need no
network — the point is which rows would be requested, not what comes back.
"""
import pytest

from app.core.retrieval.structured_search import StructuredSearch


@pytest.fixture
def captured(monkeypatch):
    """Run _search_supabase and return the filter dict it sent to PostgREST."""
    seen = {}

    async def fake_select(table, filters, select="*", limit=10):
        seen["table"] = table
        seen["filters"] = dict(filters)
        seen["limit"] = limit
        return []

    from app.db import supabase_rest
    monkeypatch.setattr(supabase_rest, "sb_select", fake_select)

    async def run(query, tickers):
        entities = {"companies": [{"ticker": t} for t in tickers]}
        await StructuredSearch()._search_supabase(query, entities, None, 10)
        return seen

    return run


def _or_terms(filters):
    return filters.get("or", "")


@pytest.mark.asyncio
async def test_inventory_turnover_fetches_cogs_not_just_inventory(captured):
    seen = await captured(
        "Compare NVDA and AMD inventory turnover for the latest reported fiscal year.",
        ["NVDA", "AMD"])

    terms = _or_terms(seen["filters"])
    assert "cost*of*goods" in terms, "the numerator must be requested"
    assert "inventory" in terms, "the denominator must be requested"
    # The narrowing that caused the bug: a single metric_name filter pinned to
    # inventory alone. The derived path must not set one.
    assert "metric_name" not in seen["filters"]


@pytest.mark.asyncio
async def test_both_cogs_labels_are_requested(captured):
    # One concept, two labels, and which one a filing uses changes over time.
    # Verified in the table: NVDA has "Cost of Revenue (COGS)" for FY2016-FY2026
    # and "Cost of Goods Sold (COGS, Cost of Revenue)" only through FY2021 — the
    # label AMD still uses. Matching one pattern retrieved AMD's FY2025 numerator
    # next to NVDA's FY2021 and the comparison stayed unanswerable.
    seen = await captured("NVDA inventory turnover", ["NVDA"])

    terms = _or_terms(seen["filters"])
    assert "cost*of*goods" in terms
    assert "cost*of*revenue" in terms


@pytest.mark.asyncio
async def test_derived_fetch_is_restricted_to_exactly_tagged_rows(captured):
    seen = await captured("AMD inventory turnover fiscal 2025", ["AMD"])

    # NVDA_Cost_of_revenue_2026-05-20_backfill = 39.5 carries the same label as the
    # exact row. A ratio built on it is wrong, not missing.
    assert seen["filters"].get("id") == "like.*_xbrl"


@pytest.mark.asyncio
async def test_rows_are_ordered_newest_period_first(captured):
    seen = await captured("AMD revenue fiscal 2025", ["AMD"])

    # Without this the 24-row budget was filled by whatever Postgres yielded first
    # out of 460k rows, so "the latest fiscal year" was luck.
    assert seen["filters"].get("order") == "period.desc"


@pytest.mark.asyncio
async def test_plain_inventory_query_is_still_a_plain_lookup(captured):
    seen = await captured("What was AMD inventory in fiscal 2025?", ["AMD"])

    # The ratio expansion must not fire for a query that just asks for the balance.
    assert "metric_name" in seen["filters"]
    assert "cost*of*goods" not in _or_terms(seen["filters"])


@pytest.mark.asyncio
async def test_return_on_equity_fetches_both_components(captured):
    seen = await captured("What is AMD return on equity?", ["AMD"])

    terms = _or_terms(seen["filters"])
    assert "net*income" in terms
    assert "holders*equity" in terms


@pytest.mark.asyncio
async def test_no_ratio_is_declared_without_its_labels_in_the_table(captured):
    # `financials` has no "Total Debt" label, so debt-to-equity must NOT be in the
    # derived map — expanding it would request rows that cannot exist and quietly
    # return nothing.
    assert "debt to equity" not in StructuredSearch._DERIVED_METRICS
    for components in StructuredSearch._DERIVED_COMPONENTS.values():
        assert all(c for c in components)
