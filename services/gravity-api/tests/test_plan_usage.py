"""
PL-9 / R17 — the meter reads the gate's own counter.

The failure this prevents is specific and common: a usage display fed by its own
tally, drifting from the enforcer, so a user reads "3 of 5 used" and is refused on
the next click. Every assertion here checks the meter against a count produced by
actually calling `enforce()`, never against a number computed twice.
"""

import pytest
from fastapi import HTTPException

from app.api.middleware import rate_limit as rl
from app.billing import capabilities as caps
from app.billing import enforce as enf


@pytest.fixture(autouse=True)
def _isolate_counters(monkeypatch):
    class _Broken:
        async def incrby(self, *a, **k):
            raise RuntimeError("no redis in tests")

        async def expire(self, *a, **k):
            raise RuntimeError("no redis in tests")

        async def get(self, *a, **k):
            raise RuntimeError("no redis in tests")

    monkeypatch.setattr(enf, "redis_client", _Broken())
    rl._MEM_COUNTERS.clear()
    yield
    rl._MEM_COUNTERS.clear()


@pytest.mark.asyncio
class TestPeekMatchesTheEnforcer:
    async def test_a_fresh_capability_reads_zero_used(self):
        p = await enf.peek("grid_runs_per_day", "free", "u-fresh")
        assert p["used"] == 0 and p["limit"] == 2 and p["remaining"] == 2

    async def test_peeking_does_not_consume(self):
        for _ in range(5):
            await enf.peek("grid_runs_per_day", "free", "u-peek")
        # If peek incremented, the free ceiling of 2 would already be gone.
        await enf.enforce("grid_runs_per_day", "free", "u-peek")
        assert (await enf.peek("grid_runs_per_day", "free", "u-peek"))["used"] == 1

    async def test_the_meter_tracks_real_consumption(self):
        await enf.enforce("document_uploads_per_month", "free", "u-track")
        await enf.enforce("document_uploads_per_month", "free", "u-track")
        p = await enf.peek("document_uploads_per_month", "free", "u-track")
        assert p["used"] == 2 and p["remaining"] == 3

    async def test_the_meter_and_the_gate_agree_at_the_boundary(self):
        # The exact drift this endpoint exists to prevent: remaining hits 0 on the
        # same call that the next request is refused on.
        for _ in range(2):
            await enf.enforce("grid_runs_per_day", "free", "u-edge")
        assert (await enf.peek("grid_runs_per_day", "free", "u-edge"))["remaining"] == 0
        with pytest.raises(HTTPException) as e:
            await enf.enforce("grid_runs_per_day", "free", "u-edge")
        assert e.value.status_code == 402

    async def test_counters_are_per_identity(self):
        await enf.enforce("grid_runs_per_day", "free", "u-x")
        assert (await enf.peek("grid_runs_per_day", "free", "u-y"))["used"] == 0

    async def test_unlimited_reports_no_ceiling(self):
        p = await enf.peek("grid_runs_per_day", "institutional", "u-inf")
        assert p["unlimited"] is True and p["limit"] is None and p["remaining"] is None

    async def test_a_flag_reports_allowed_not_a_quota(self):
        assert (await enf.peek("sso_saml", "free", "u1")) == {
            "capability": "sso_saml", "label": "SSO (SAML)", "group": "research",
            "enforcement": "server", "kind": "flag", "allowed": False,
        }
        assert (await enf.peek("sso_saml", "institutional", "u1"))["allowed"] is True


@pytest.mark.asyncio
class TestSnapshot:
    async def test_it_covers_every_capability_in_order(self):
        snap = await enf.snapshot("analyst", "u-snap")
        assert len(snap) == len(caps.CAPABILITIES)
        assert [s["capability"] for s in snap] == [c.key for c in caps.CAPABILITIES]

    async def test_every_entry_carries_its_enforcement_location(self):
        # So the UI can mark which ceilings are real and which are advisory.
        snap = await enf.snapshot("free", "u-snap2")
        assert all(s["enforcement"] in ("server", "client") for s in snap)
        assert sum(1 for s in snap if s["enforcement"] == "client") == 14

    async def test_it_reflects_consumption_made_through_the_gate(self):
        await enf.enforce("grid_runs_per_day", "analyst", "u-snap3")
        entry = next(s for s in await enf.snapshot("analyst", "u-snap3")
                     if s["capability"] == "grid_runs_per_day")
        assert entry["used"] == 1 and entry["limit"] == 50

    async def test_categorical_rows_report_their_value_not_a_quota(self):
        # "7 days", "headlines", "all 6" have no counter. Asking capabilities for a
        # numeric limit raises there — correct — so the meter must not ask.
        snap = {s["capability"]: s for s in await enf.snapshot("free", "u-cat")}
        assert snap["history_retention"] == {
            "capability": "history_retention", "label": "History retention",
            "group": "research", "enforcement": "server",
            "kind": "categorical", "value": "7 days",
        }
        assert snap["news_terminal"]["value"] == "headlines"
        assert snap["markets"]["value"] == "1 (crypto)"

    async def test_every_entry_declares_one_of_three_kinds(self):
        kinds = {s["kind"] for s in await enf.snapshot("professional", "u-kinds")}
        assert kinds <= {"flag", "quota", "categorical"}

    async def test_a_higher_tier_shows_higher_ceilings(self):
        free = {s["capability"]: s for s in await enf.snapshot("free", "u-a")}
        pro = {s["capability"]: s for s in await enf.snapshot("professional", "u-b")}
        assert free["grid_runs_per_day"]["limit"] == 2
        assert pro["grid_runs_per_day"]["limit"] == 250
