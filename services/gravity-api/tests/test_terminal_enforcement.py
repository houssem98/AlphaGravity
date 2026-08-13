"""
PL-7 — enforcing the Terminal rows, and recording how few of them can be.

Eleven of the twelve §4 Terminal rows are enforced in the browser. Those are not
paywalls; they are suggestions the client can decline. This file asserts the one row
that is genuinely held server-side, and pins the count of the ones that are not — so
that moving a row server-side is a visible change, and so that nobody reads the
pricing table as a claim about enforcement it does not have.
"""

import pytest
from fastapi import FastAPI, HTTPException
from fastapi.testclient import TestClient

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

    monkeypatch.setattr(enf, "redis_client", _Broken())
    rl._MEM_COUNTERS.clear()
    yield
    rl._MEM_COUNTERS.clear()


TERMINAL = [c for c in caps.CAPABILITIES if c.group == caps.TERMINAL]


class TestHowMuchOfTheTerminalIsActuallyChargeable:
    def test_the_terminal_has_twelve_rows(self):
        assert len(TERMINAL) == 12

    def test_only_one_terminal_row_is_server_enforced(self):
        # The honest number. If this changes, a row moved server-side and the
        # ledger's §8 should say which one and why.
        server = [c.key for c in TERMINAL if c.enforcement == caps.SERVER]
        assert server == ["hermes_asks_per_day"]

    def test_the_other_eleven_are_declared_client_enforced_not_hidden(self):
        client = [c.key for c in TERMINAL if c.enforcement == caps.CLIENT]
        assert len(client) == 11
        # Named so the list is reviewable rather than a count nobody can check.
        assert set(client) == {
            "markets", "watchlist_symbols", "chart_indicators", "screener_columns",
            "order_book", "news_terminal", "portfolio", "comparator",
            "dexter_runs_per_day", "dexter_debate", "dexter_journal",
        }


@pytest.mark.asyncio
class TestHermesIsMetered:
    async def test_free_tier_gets_five_asks_a_day(self):
        for _ in range(5):
            await enf.enforce("hermes_asks_per_day", "free", "ip:1.2.3.4")
        with pytest.raises(HTTPException) as e:
            await enf.enforce("hermes_asks_per_day", "free", "ip:1.2.3.4")
        assert e.value.status_code == 402
        assert e.value.detail["label"] == "Ask Hermes / day"
        assert e.value.detail["upgrade_to"] == "analyst"

    async def test_two_anonymous_callers_are_metered_separately(self):
        for _ in range(5):
            await enf.enforce("hermes_asks_per_day", "free", "ip:1.1.1.1")
        h = await enf.enforce("hermes_asks_per_day", "free", "ip:2.2.2.2")
        assert h["X-Plan-hermes_asks_per_day-Remaining"] == "4"

    async def test_a_paying_tier_gets_more(self):
        h = await enf.enforce("hermes_asks_per_day", "professional", "u-pro")
        assert h["X-Plan-hermes_asks_per_day-Limit"] == "500"


class TestAnonymousIdentity:
    def _app(self):
        from fastapi import Header, Request
        from typing import Optional

        app = FastAPI()
        app.state.pg_pool = None

        @app.get("/who")
        async def who(request: Request, authorization: Optional[str] = Header(None)):
            identity, tier = await enf.caller_identity(request, authorization)
            return {"identity": identity, "tier": tier}

        return TestClient(app)

    def test_an_anonymous_caller_is_identified_by_ip_at_the_free_tier(self):
        body = self._app().get("/who").json()
        assert body["identity"].startswith("ip:")
        assert body["tier"] == "free"

    def test_a_garbage_token_does_not_grant_a_tier(self):
        # An unparseable Authorization header must not fall through to anything
        # better than anonymous.
        body = self._app().get("/who", headers={"Authorization": "Bearer nonsense"}).json()
        assert body["identity"].startswith("ip:")
        assert body["tier"] == "free"
