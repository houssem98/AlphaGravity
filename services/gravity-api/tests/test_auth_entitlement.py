"""
PL-4 / R5 — a token proves identity; the subscription decides the tier.

The defect this grades: auth.py's Supabase branch filled in `tier: "free"` as a
literal, production authenticates through Supabase, and nothing downstream ever
consulted `billing_subscriptions`. Every paying customer was served the free tier's
limits. These tests drive the real dependency chain — require_auth →
_apply_entitlement → entitlements_for → check_rate_limit — and read the number off
the response header, which is the same thing R5 asserts against a live API.
"""

import time

import pytest
from fastapi import Depends, FastAPI
from fastapi.testclient import TestClient

from app.api.middleware import auth as auth_mod
from app.api.middleware.auth import require_auth
from app.api.middleware.rate_limit import check_rate_limit
from app.billing import entitlements as ent
from app.config import Environment

FUTURE = int(time.time()) + 86_400


class _FakePool:
    """asyncpg-pool shape returning one canned billing_subscriptions row."""

    def __init__(self, row):
        self.row = row

    def acquire(self):
        pool = self

        class _Ctx:
            async def __aenter__(self):
                return self

            async def __aexit__(self, *a):
                return False

            async def fetchrow(self, _sql, _uid):
                return pool.row

        return _Ctx()


def _client(monkeypatch, row):
    """An app with one guarded route, a stubbed subscription row, and no real JWT."""
    ent.invalidate()
    # Production mode, or require_auth short-circuits to the dev bypass.
    monkeypatch.setattr(auth_mod.settings, "app_env", Environment.PRODUCTION, raising=False)

    # A validated Supabase token, shaped exactly as _to_auth_dict builds it —
    # including the placeholder tier the fix has to override.
    async def _fake_validate(_token):
        return {"user_id": "u-1", "email": "a@b.c", "org_id": "",
                "role": "authenticated", "entitlements": ["public"], "tier": "free"}

    monkeypatch.setattr(auth_mod, "_validate_jwt", _fake_validate)

    app = FastAPI()
    app.state.pg_pool = _FakePool(row)

    @app.get("/guarded")
    async def guarded(auth: dict = Depends(require_auth)):
        headers = await check_rate_limit(auth["user_id"], auth.get("tier", "free"))
        return {"tier": auth["tier"], "headers": headers}

    return TestClient(app)


def _get(client):
    return client.get("/guarded", headers={"Authorization": "Bearer stub"})


class TestTierReachesTheLimiter:
    def test_professional_subscription_is_served_professional_limits(self, monkeypatch):
        c = _client(monkeypatch, {"plan": "professional", "status": "active",
                                  "current_period_end": FUTURE})
        body = _get(c).json()
        # The defect in one assertion: this was 10 for every paying customer.
        assert body["tier"] == "professional"
        assert body["headers"]["X-RateLimit-Limit"] == "120"
        assert body["headers"]["X-RateLimit-Daily-Limit"] == "2000"

    def test_a_legacy_pro_row_gets_the_same_treatment(self, monkeypatch):
        c = _client(monkeypatch, {"plan": "pro", "status": "active",
                                  "current_period_end": FUTURE})
        body = _get(c).json()
        assert body["tier"] == "professional"
        assert body["headers"]["X-RateLimit-Limit"] == "120"

    def test_no_subscription_stays_on_the_free_limits(self, monkeypatch):
        c = _client(monkeypatch, None)
        body = _get(c).json()
        assert body["tier"] == "free"
        assert body["headers"]["X-RateLimit-Limit"] == "10"

    def test_a_cancelled_subscription_does_not_keep_its_limits(self, monkeypatch):
        c = _client(monkeypatch, {"plan": "institutional", "status": "canceled",
                                  "current_period_end": FUTURE})
        body = _get(c).json()
        assert body["tier"] == "free"
        assert body["headers"]["X-RateLimit-Limit"] == "10"

    def test_institutional_has_no_daily_ceiling(self, monkeypatch):
        c = _client(monkeypatch, {"plan": "institutional", "status": "active",
                                  "current_period_end": FUTURE})
        body = _get(c).json()
        assert body["tier"] == "institutional"
        assert body["headers"]["X-RateLimit-Limit"] == "600"
        assert "X-RateLimit-Daily-Limit" not in body["headers"]


class TestTheLiteralIsGone:
    def test_the_token_claim_does_not_decide_the_tier(self, monkeypatch):
        """
        The stubbed token always claims `free`. If the served tier can differ from
        the claim, the literal is no longer authoritative — which is the whole fix.
        """
        c = _client(monkeypatch, {"plan": "analyst", "status": "active",
                                  "current_period_end": FUTURE})
        assert _get(c).json()["tier"] == "analyst"

    def test_api_keys_keep_their_own_tier(self, monkeypatch):
        """Service keys are not subscribers; _apply_entitlement must not touch them."""
        monkeypatch.setattr(auth_mod.settings, "app_env", Environment.PRODUCTION, raising=False)

        async def _fake_key(_k):
            return {"user_id": "svc:x", "tier": "unlimited", "api_key": "k",
                    "entitlements": ["public"]}

        monkeypatch.setattr(auth_mod, "_validate_api_key", _fake_key)
        app = FastAPI()
        app.state.pg_pool = _FakePool({"plan": "free", "status": "active",
                                       "current_period_end": FUTURE})

        @app.get("/guarded")
        async def guarded(auth: dict = Depends(require_auth)):
            return {"tier": auth["tier"]}

        r = TestClient(app).get("/guarded", headers={"X-API-Key": "k"})
        assert r.json()["tier"] == "unlimited"
