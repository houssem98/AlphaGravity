"""
PL-3 / R4 — the join between a subscription row and the tier it entitles.

Every case here is a way the paywall leaks in one direction or the other: a
cancelled customer keeping their plan, an expired row becoming a permanent
upgrade, a typo in a plan name silently promoting someone, or a database blip
promoting everyone at once.
"""

import time

import pytest

from app.billing import entitlements as ent
from app.billing.tiers import UnknownTier, resolve


@pytest.fixture(autouse=True)
def _clear_cache():
    ent.invalidate()
    yield
    ent.invalidate()


FUTURE = int(time.time()) + 86_400
PAST = int(time.time()) - 86_400


class TestTierFromRow:
    def test_active_paid_plan_entitles_it(self):
        assert ent._tier_from_row("u", "professional", "active", FUTURE).id == "professional"

    def test_trialing_entitles_too(self):
        assert ent._tier_from_row("u", "analyst", "trialing", FUTURE).id == "analyst"

    @pytest.mark.parametrize("status", ["canceled", "past_due", "none", "incomplete", ""])
    def test_non_active_status_falls_to_free(self, status):
        assert ent._tier_from_row("u", "institutional", status, FUTURE).id == "free"

    def test_expired_period_falls_to_free_however_good_the_status(self):
        assert ent._tier_from_row("u", "professional", "active", PAST).id == "free"

    def test_no_period_end_is_treated_as_open_ended(self):
        assert ent._tier_from_row("u", "professional", "active", None).id == "professional"

    def test_legacy_plan_name_maps_forward(self):
        assert ent._tier_from_row("u", "pro", "active", FUTURE).id == "professional"
        assert ent._tier_from_row("u", "team", "active", FUTURE).id == "institutional"

    def test_unresolvable_plan_serves_free_rather_than_guessing(self):
        assert ent._tier_from_row("u", "platinum", "active", FUTURE).id == "free"

    def test_the_underlying_resolver_still_raises(self):
        # The fallback above is a decision this module makes in the open. The
        # vocabulary itself must keep refusing, or R4 means nothing.
        with pytest.raises(UnknownTier):
            resolve("platinum")


class _FakePool:
    """Minimal asyncpg-pool shape: acquire() as an async context manager."""

    def __init__(self, row=None, raises=False):
        self.row, self.raises, self.calls = row, raises, 0

    def acquire(self):
        pool = self

        class _Ctx:
            async def __aenter__(self):
                if pool.raises:
                    raise RuntimeError("connection refused")
                return self

            async def __aexit__(self, *a):
                return False

            async def fetchrow(self, _sql, _uid):
                pool.calls += 1
                return pool.row

        return _Ctx()


@pytest.mark.asyncio
class TestEntitlementsFor:
    async def test_reads_the_subscription(self):
        pool = _FakePool({"plan": "professional", "status": "active", "current_period_end": FUTURE})
        assert (await ent.entitlements_for(pool, "u1")).id == "professional"

    async def test_no_row_is_free(self):
        assert (await ent.entitlements_for(_FakePool(None), "u2")).id == "free"

    async def test_no_pool_is_free(self):
        assert (await ent.entitlements_for(None, "u3")).id == "free"

    async def test_a_database_failure_degrades_to_free_instead_of_raising(self):
        assert (await ent.entitlements_for(_FakePool(raises=True), "u4")).id == "free"

    async def test_the_second_read_is_cached(self):
        pool = _FakePool({"plan": "analyst", "status": "active", "current_period_end": FUTURE})
        await ent.entitlements_for(pool, "u5")
        await ent.entitlements_for(pool, "u5")
        assert pool.calls == 1

    async def test_invalidate_forces_a_reread(self):
        pool = _FakePool({"plan": "analyst", "status": "active", "current_period_end": FUTURE})
        await ent.entitlements_for(pool, "u6")
        ent.invalidate("u6")
        await ent.entitlements_for(pool, "u6")
        assert pool.calls == 2

    async def test_a_downgrade_lands_once_the_cache_expires(self):
        pool = _FakePool({"plan": "professional", "status": "active", "current_period_end": FUTURE})
        assert (await ent.entitlements_for(pool, "u7")).id == "professional"
        pool.row = {"plan": "professional", "status": "canceled", "current_period_end": FUTURE}
        ent._cache["u7"] = (time.time() - 1, "professional")  # simulate TTL expiry
        assert (await ent.entitlements_for(pool, "u7")).id == "free"
