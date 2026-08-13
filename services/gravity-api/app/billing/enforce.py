"""
The denial path (docs/PLANS_WORLD_CLASS_ROADMAP.md gap E6).

Before this module the product had no way to say "you are over your plan limit".
Nothing anywhere returned that, which is why §1e found zero upgrade prompts: there
was no moment at which one could be shown.

`enforce()` is that moment. It counts a capability's use against the tier's ceiling
and raises **402 Payment Required** when the ceiling is passed — not 429, which means
"slow down and retry", and not 500, which means "we broke". 402 carries a machine
readable body so the UI can name the capability and the tier that lifts it without
parsing prose:

    {"error": "plan_limit_exceeded", "capability": "document_uploads_per_month",
     "label": "Document uploads / mo", "plan": "Free", "plan_id": "free",
     "limit": 5, "used": 6, "period": "month", "upgrade_to": "analyst"}

Rules it holds to:

  * **Unlimited means no counter.** A tier with no ceiling costs no Redis round trip.
  * **A flag is not a quota.** `capabilities.limit_for` raises for boolean rows, and
    `require()` handles those separately — asking "how many SSO logins are left" is
    a bug, and returning None would grant an unlimited one.
  * **Counting failure does not open the gate silently.** Redis down falls back to
    the per-process counter that `rate_limit` already uses, and says so in the log.
"""

from __future__ import annotations

import time
from datetime import datetime, timezone

import structlog
from fastapi import HTTPException

from app.api.middleware.rate_limit import _mem_incr, _month_ttl
from app.billing import capabilities as caps
from app.billing.tiers import TIERS, resolve
from app.db.redis import redis_client

logger = structlog.get_logger()

DAY = "day"
MONTH = "month"

# Which window each countable capability is measured over. A capability absent from
# here is not metered by this module — its ceiling lives elsewhere (the per-minute
# and per-day search limits are enforced in rate_limit.py) or it is client-side.
PERIODS: dict[str, str] = {
    "grid_runs_per_day": DAY,
    "deep_research_per_day": DAY,
    "document_uploads_per_month": MONTH,
    "hermes_asks_per_day": DAY,
    "dexter_runs_per_day": DAY,
    "scheduled_grids": MONTH,
    "api_keys": MONTH,
}


def _period_key(period: str) -> tuple[str, int]:
    now = datetime.now(timezone.utc)
    if period == DAY:
        end = now.replace(hour=0, minute=0, second=0, microsecond=0)
        return now.strftime("%Y-%m-%d"), max(1, int(end.timestamp() + 86_400 - now.timestamp()))
    return f"{now.year}-{now.month:02d}", _month_ttl()


def _next_tier_with_more(key: str, tier_id: str) -> str | None:
    """The cheapest tier that raises this ceiling — what the CTA should offer."""
    order = caps.SOLD_TIER_IDS
    try:
        start = order.index(tier_id)
    except ValueError:
        start = 0
    current = caps.value_for(key, tier_id)
    for candidate in order[start + 1:]:
        nxt = caps.value_for(key, candidate)
        if nxt == caps.UNLIMITED:
            return candidate
        if isinstance(nxt, bool) and nxt and not current:
            return candidate
        if isinstance(nxt, int) and not isinstance(nxt, bool) \
                and isinstance(current, int) and not isinstance(current, bool) and nxt > current:
            return candidate
    return None


def _deny(key: str, tier_id: str, limit: int | None, used: int, period: str | None):
    cap = caps.capability(key)
    raise HTTPException(
        status_code=402,
        detail={
            "error": "plan_limit_exceeded",
            "capability": key,
            "label": cap.label,
            "plan": TIERS[tier_id].name,
            "plan_id": tier_id,
            "limit": limit,
            "used": used,
            "period": period,
            "upgrade_to": _next_tier_with_more(key, tier_id),
        },
    )


def _counter_key(key: str, identity: str, period: str) -> tuple[str, int]:
    stamp, ttl = _period_key(period)
    return f"plan:{key}:{identity}:{stamp}", ttl


async def peek(key: str, tier_id: str, identity: str) -> dict:
    """
    What a meter should display for one capability, **without consuming anything**.

    This reads the exact key `enforce()` increments. A meter fed by a separate
    count — a database tally, a client-side tick — drifts from the thing that
    actually denies the request, and a meter that disagrees with the gate is worse
    than no meter: the user sees "3 of 5 used" and is refused anyway.
    """
    tier = resolve(tier_id)
    value = caps.value_for(key, tier.id)
    cap = caps.capability(key)
    base = {"capability": key, "label": cap.label, "group": cap.group,
            "enforcement": cap.enforcement}

    if isinstance(value, bool):
        return {**base, "kind": "flag", "allowed": value}

    # Rows that are neither a flag nor a count: "7 days", "headlines", "all 6".
    # They have no counter to read, and asking `limit_for` for one raises — which is
    # correct there and would be a 500 here. The meter shows the value as written.
    if isinstance(value, str) and value != caps.UNLIMITED:
        return {**base, "kind": "categorical", "value": value}

    limit = caps.limit_for(key, tier.id)
    if limit is None:
        return {**base, "kind": "quota", "limit": None, "used": 0,
                "remaining": None, "unlimited": True}

    period = PERIODS.get(key, DAY)
    redis_key, ttl = _counter_key(key, identity, period)
    used = 0
    try:
        raw = await redis_client.get(redis_key)
        used = int(raw) if raw is not None else 0
    except Exception:
        # Same per-process fallback the enforcer uses, read without incrementing.
        from app.api.middleware.rate_limit import _MEM_COUNTERS
        val, exp = _MEM_COUNTERS.get(redis_key, (0, 0.0))
        used = val if exp > time.time() else 0

    return {**base, "kind": "quota", "limit": limit, "used": used,
            "remaining": max(0, limit - used), "unlimited": False,
            "period": period, "reset_at": int(time.time()) + ttl}


async def snapshot(tier_id: str, identity: str) -> list[dict]:
    """Every capability for this tier, in §4 order, as a meter can render it."""
    return [await peek(c.key, tier_id, identity) for c in caps.CAPABILITIES]


async def caller_identity(request, authorization: str | None) -> tuple[str, str]:
    """
    `(identity, tier_id)` for a route that does not require a session.

    Some endpoints are deliberately open — `/api/trading/markets/ask` answers an
    anonymous POST with 200 today, and closing it is the owner's call (§10 E-T), not
    this loop's. Open is not the same as free, though: an unmetered LLM endpoint is
    an open budget. An anonymous caller is identified by IP and metered at the free
    tier, which leaves the endpoint reachable while giving the spend a ceiling.

    IP is a weak identity — shared NATs undercount, a proxy pool defeats it. It is
    the strongest identity available without a login, and a weak ceiling beats none.
    """
    if authorization and authorization.startswith("Bearer "):
        from app.api.middleware.auth import _validate_jwt
        from app.billing.entitlements import entitlements_for

        user = await _validate_jwt(authorization.split(" ", 1)[1])
        if user:
            pool = getattr(request.app.state, "pg_pool", None)
            tier = await entitlements_for(pool, user.get("user_id", ""))
            return user.get("user_id", "unknown"), tier.id

    client = getattr(request, "client", None)
    ip = getattr(client, "host", None) or "unknown"
    return f"ip:{ip}", "free"


def require(key: str, tier_id: str) -> None:
    """
    Gate a boolean capability. Raises 402 when the tier does not have it at all.

    Used for the rows that are on/off rather than counted — SSO, the audit log,
    report export.
    """
    if not caps.allows(key, tier_id):
        _deny(key, tier_id, limit=0, used=0, period=None)


async def enforce(key: str, tier_id: str, user_id: str, *, cost: int = 1) -> dict:
    """
    Count one use of `key` against `tier_id`'s ceiling and raise 402 if it is passed.

    Returns headers describing the remaining allowance so the UI can render a meter
    without a second request. Callers pass the tier they were already given by
    `require_auth` — this does not re-read the subscription.
    """
    tier = resolve(tier_id)
    value = caps.value_for(key, tier.id)

    # A row the tier simply does not have. No counter, no window — just denied.
    if isinstance(value, bool):
        if not value:
            _deny(key, tier.id, limit=0, used=0, period=None)
        return {}

    limit = caps.limit_for(key, tier.id)
    if limit is None:                      # unlimited: nothing to count
        return {f"X-Plan-{key}": "unlimited"}
    if limit <= 0:
        _deny(key, tier.id, limit=limit, used=0, period=PERIODS.get(key))

    period = PERIODS.get(key, DAY)
    stamp, ttl = _period_key(period)
    redis_key = f"plan:{key}:{user_id}:{stamp}"

    try:
        used = await redis_client.incrby(redis_key, cost)
        if used == cost:
            await redis_client.expire(redis_key, ttl)
    except Exception as e:
        logger.warning("plan_quota_redis_error", capability=key, error=str(e))
        used = _mem_incr(redis_key, ttl_s=ttl)

    headers = {
        f"X-Plan-{key}-Limit": str(limit),
        f"X-Plan-{key}-Remaining": str(max(0, limit - used)),
        f"X-Plan-{key}-Reset": str(int(time.time()) + ttl),
    }
    if used > limit:
        logger.info("plan_limit_exceeded", capability=key, tier=tier.id,
                    user_id=user_id, used=used, limit=limit)
        _deny(key, tier.id, limit=limit, used=used, period=period)
    return headers
