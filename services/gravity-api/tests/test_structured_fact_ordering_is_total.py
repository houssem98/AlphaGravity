"""L9 / R10 — the static half of duplicate-fact selection.

Round 1 marked D4 wholly BLOCKED on "no live DB". The second auditor called that
too wide and was right: **determinism is checkable without production rows**,
and this file proves it the same way `test_structured_ratio_components.py` does
— by capturing the PostgREST filter the channel builds. What rows come back
needs a database; what ordering was ASKED FOR does not.

The channel already orders `period.desc`, added because without any order
"the latest reported fiscal year" was whichever 24 of 460k rows Postgres
happened to yield. But `period` is not unique. Two rows for the same ticker,
metric and period — the exact XBRL row and a backfill row, or two filed labels
for one concept — tie, and the tie is broken by whatever the planner returns.
So the same query can select a different fact on two runs, which is the defect:
the winner is incidental rather than stated.

    AMD_CostOfGoodsAndServicesSold_FY2025_xbrl
    AMD_Cost_of_revenue_2026-05-20_backfill

`id` is unique, so ordering by it after `period` makes the selection total: the
same query now always selects the same row.

**What stays blocked, and why that is not this test's business.** WHICH concept
should win when a company files both `CostOfRevenue` and
`CostOfGoodsAndServicesSold` for one period is a data question — it needs
production rows to answer, and the roadmap escalates it rather than guessing.
That is a separate thing from whether the choice is repeatable. Shipping
determinism does not decide the precedence; it stops the precedence from being
decided by the query planner.
"""

from __future__ import annotations

import pytest

from app.core.retrieval.structured_search import StructuredSearch


@pytest.fixture
def captured(monkeypatch):
    """The PostgREST filter the channel builds. No network."""
    seen: dict = {}

    async def fake_select(table, filters, select="*", limit=10):
        seen["table"] = table
        seen["filters"] = dict(filters)
        seen["limit"] = limit
        return []

    from app.db import supabase_rest
    monkeypatch.setattr(supabase_rest, "sb_select", fake_select)

    async def run(query="NVDA total revenue FY2025", tickers=("NVDA",)):
        entities = {"companies": [{"ticker": t} for t in tickers]}
        await StructuredSearch()._search_supabase(query, entities, None, 10)
        return seen

    return run


def _order(seen) -> str:
    return str(seen["filters"].get("order", ""))


# ── the defect ────────────────────────────────────────────────────────────


@pytest.mark.asyncio
async def test_the_ordering_is_total_not_just_by_period(captured):
    order = _order(await captured())

    keys = [k.split(".")[0] for k in order.split(",") if k]
    assert len(keys) >= 2, (
        f"the order is {order!r}: rows tying on period are left to the query "
        f"planner, so the same query can select a different fact on two runs"
    )
    assert "id" in keys, (
        f"the tiebreak is not a unique column, so the ordering is still not "
        f"total: {order!r}"
    )


@pytest.mark.asyncio
async def test_the_tiebreak_is_the_last_key(captured):
    """A unique column anywhere but last would not settle the earlier keys."""
    keys = [k.split(".")[0] for k in _order(await captured()).split(",") if k]

    assert keys[-1] == "id", f"the unique key is not the final tiebreak: {keys}"


# ── the guard: the reason the order exists must survive ───────────────────


@pytest.mark.asyncio
async def test_newest_period_still_comes_first(captured):
    """`period.desc` is why the order was added; a tiebreak must not displace it."""
    order = _order(await captured())

    assert order.startswith("period.desc"), (
        f"the newest-period-first ordering was displaced: {order!r}"
    )


@pytest.mark.asyncio
async def test_the_order_is_stable_across_identical_calls(captured):
    """Determinism at the level this test can actually observe."""
    first = _order(await captured())
    second = _order(await captured())

    assert first == second and first, (
        "the channel does not ask for the same ordering twice for one query"
    )


@pytest.mark.asyncio
async def test_a_comparison_query_orders_the_same_way(captured):
    """Two tickers must not change the ordering contract."""
    order = _order(await captured("compare NVDA and AMD total revenue FY2025",
                                  ("NVDA", "AMD")))

    assert order.startswith("period.desc")
    assert order.split(",")[-1].split(".")[0] == "id"
