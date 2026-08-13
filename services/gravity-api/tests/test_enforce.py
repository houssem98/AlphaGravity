"""
PL-6 / R8 — the denial path.

Gap E6 was that nothing anywhere returned "you are over your plan limit", which is
why there were no upgrade prompts to find: there was no moment to show one at. These
tests pin the shape of that moment, because the UI in PL-11 reads it.
"""

import pytest
from fastapi import HTTPException

from app.billing import enforce as enf
from app.billing.tiers import UnknownTier


@pytest.fixture(autouse=True)
def _isolate_counters(monkeypatch):
    """Force the in-memory counter path so tests never touch a real Redis."""
    from app.api.middleware import rate_limit as rl

    class _Broken:
        async def incrby(self, *a, **k):
            raise RuntimeError("no redis in tests")

        async def expire(self, *a, **k):
            raise RuntimeError("no redis in tests")

    monkeypatch.setattr(enf, "redis_client", _Broken())
    rl._MEM_COUNTERS.clear()
    yield
    rl._MEM_COUNTERS.clear()


class TestFlagCapabilities:
    def test_require_denies_a_tier_that_lacks_the_row(self):
        with pytest.raises(HTTPException) as e:
            enf.require("sso_saml", "free")
        assert e.value.status_code == 402

    def test_require_passes_a_tier_that_has_it(self):
        enf.require("sso_saml", "institutional")  # must not raise

    @pytest.mark.asyncio
    async def test_enforce_denies_a_flag_the_tier_lacks(self):
        with pytest.raises(HTTPException) as e:
            await enf.enforce("audit_log", "analyst", "u1")
        assert e.value.status_code == 402
        assert e.value.detail["capability"] == "audit_log"

    @pytest.mark.asyncio
    async def test_enforce_allows_a_flag_the_tier_has(self):
        assert await enf.enforce("audit_log", "professional", "u1") == {}


@pytest.mark.asyncio
class TestQuotas:
    async def test_under_the_ceiling_returns_meter_headers(self):
        h = await enf.enforce("document_uploads_per_month", "free", "u-under")
        assert h["X-Plan-document_uploads_per_month-Limit"] == "5"
        assert h["X-Plan-document_uploads_per_month-Remaining"] == "4"

    async def test_the_ceiling_is_the_last_allowed_call(self):
        for _ in range(5):  # free = 5 uploads / month
            await enf.enforce("document_uploads_per_month", "free", "u-edge")
        with pytest.raises(HTTPException) as e:
            await enf.enforce("document_uploads_per_month", "free", "u-edge")
        assert e.value.status_code == 402

    async def test_remaining_reaches_zero_before_it_denies(self):
        h = {}
        for _ in range(5):
            h = await enf.enforce("document_uploads_per_month", "free", "u-zero")
        assert h["X-Plan-document_uploads_per_month-Remaining"] == "0"

    async def test_unlimited_costs_no_counter(self):
        h = await enf.enforce("document_uploads_per_month", "institutional", "u-inf")
        assert h == {"X-Plan-document_uploads_per_month": "unlimited"}

    async def test_a_higher_tier_gets_a_higher_ceiling(self):
        h = await enf.enforce("grid_runs_per_day", "professional", "u-pro")
        assert h["X-Plan-grid_runs_per_day-Limit"] == "250"

    async def test_counters_do_not_leak_between_users(self):
        for _ in range(5):
            await enf.enforce("document_uploads_per_month", "free", "u-a")
        h = await enf.enforce("document_uploads_per_month", "free", "u-b")
        assert h["X-Plan-document_uploads_per_month-Remaining"] == "4"

    async def test_redis_being_down_still_counts(self):
        # The fixture broke Redis for every test in this file. If the in-memory
        # fallback were not wired, counting would silently stop and the gate would
        # fail open — which is exactly how a paywall becomes decorative.
        with pytest.raises(HTTPException):
            for _ in range(5):                                  # free = 2 / day
                await enf.enforce("grid_runs_per_day", "free", "u-fallback")


@pytest.mark.asyncio
class TestTheDenialBodyIsUsableByTheUI:
    async def test_it_names_the_plan_the_row_and_the_upgrade(self):
        for _ in range(2):  # free = 2 grid runs / day
            await enf.enforce("grid_runs_per_day", "free", "u-body")
        with pytest.raises(HTTPException) as e:
            await enf.enforce("grid_runs_per_day", "free", "u-body")
        d = e.value.detail
        assert e.value.status_code == 402
        assert d["error"] == "plan_limit_exceeded"
        assert d["capability"] == "grid_runs_per_day"
        assert d["label"] == "Research Grid runs / day"   # matches the §4 row label
        assert d["plan"] == "Free" and d["plan_id"] == "free"
        assert d["limit"] == 2 and d["used"] == 3
        assert d["period"] == "day"
        assert d["upgrade_to"] == "analyst"               # the cheapest tier with more

    async def test_the_upgrade_target_skips_tiers_that_add_nothing(self):
        # audit_log: free ✗, analyst ✗, professional ✓ — so free upgrades to
        # professional, not to analyst.
        with pytest.raises(HTTPException) as e:
            await enf.enforce("audit_log", "free", "u-skip")
        assert e.value.detail["upgrade_to"] == "professional"

    async def test_the_top_tier_has_nothing_to_upgrade_to(self):
        assert enf._next_tier_with_more("grid_runs_per_day", "institutional") is None


@pytest.mark.asyncio
class TestItRefusesNonsense:
    async def test_an_unknown_tier_raises_rather_than_metering(self):
        with pytest.raises(UnknownTier):
            await enf.enforce("grid_runs_per_day", "platinum", "u9")

    async def test_an_unknown_capability_raises(self):
        with pytest.raises(KeyError):
            await enf.enforce("teleportation", "free", "u9")


class TestSizeCeilings:
    """
    `enforce_size` guards a per-request SIZE, which is a different question from a
    quota. The grid endpoint is the case that forced it: one request is N questions
    x M documents and every cell is an LLM call, so ten small grids and one large
    grid are not the same spend and cannot share a counter.
    """

    def test_a_request_within_the_ceiling_passes(self):
        enf.enforce_size("grid_columns_per_run", "free", 5)      # free ceiling is 5

    def test_one_over_the_ceiling_is_refused(self):
        with pytest.raises(HTTPException) as e:
            enf.enforce_size("grid_columns_per_run", "free", 6)
        assert e.value.status_code == 402
        assert e.value.detail["capability"] == "grid_columns_per_run"
        assert e.value.detail["limit"] == 5
        assert e.value.detail["used"] == 6
        assert e.value.detail["upgrade_to"] == "analyst"

    def test_a_higher_tier_allows_a_bigger_request(self):
        enf.enforce_size("grid_columns_per_run", "professional", 50)
        with pytest.raises(HTTPException):
            enf.enforce_size("grid_columns_per_run", "professional", 51)

    def test_unlimited_accepts_any_size(self):
        enf.enforce_size("grid_columns_per_run", "institutional", 10_000)

    @pytest.mark.asyncio
    async def test_size_checks_consume_no_quota(self):
        # If enforce_size counted, five legal requests would exhaust a ceiling of 5
        # and the sixth legal request would be refused for the wrong reason.
        for _ in range(20):
            enf.enforce_size("grid_columns_per_run", "free", 5)
        assert (await enf.peek("grid_runs_per_day", "free", "u-size"))["used"] == 0
