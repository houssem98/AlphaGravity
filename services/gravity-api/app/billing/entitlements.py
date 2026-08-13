"""
The missing link: user_id → subscription → tier (docs/PLANS_WORLD_CLASS_ROADMAP.md §1c).

`billing_subscriptions` has been written by the payment webhooks since the billing
system shipped, and read by exactly two endpoints that show it back to the user.
Nothing on the request path ever consulted it, so what a customer paid for and what
the server served them were unrelated facts. This module is the join.

Three things it refuses to do quietly, because each one is a way to sell access that
is not delivered — or deliver access that was not sold:

  * **A subscription that is not active does not entitle.** `canceled`, `past_due`
    and `none` fall to free. Only `active` and `trialing` grant their plan.
  * **An expired period does not entitle.** A row whose `current_period_end` is in
    the past grants free, however good its status column looks. Webhooks fail; a
    stale row must not become a permanent free upgrade.
  * **An unrecognised plan name is logged, not guessed.** `resolve()` raises and this
    module catches it, records the name it could not resolve, and serves free. §3
    rule 3 — the fallback is explicit and visible, never implied by a `.get` default.

Cached for 60 seconds. Long enough that a hot search path does not hit Postgres on
every request; short enough that an upgrade lands within a minute of the webhook,
and a downgrade does too. Webhooks call `invalidate()` to make it immediate.
"""

from __future__ import annotations

import time

import structlog

from app.billing.tiers import DEFAULT_TIER, TIERS, Tier, UnknownTier, resolve

logger = structlog.get_logger()

CACHE_TTL_S = 60.0

# Only these two statuses entitle. Everything else — canceled, past_due, none,
# incomplete, whatever a provider invents next — is not a paying customer today.
ACTIVE_STATUSES = frozenset({"active", "trialing"})

# user_id -> (expires_at, tier_id)
_cache: dict[str, tuple[float, str]] = {}


def invalidate(user_id: str | None = None) -> None:
    """Drop a cached entitlement (or all of them) so the next read hits the DB."""
    if user_id is None:
        _cache.clear()
    else:
        _cache.pop(user_id, None)


def _tier_from_row(user_id: str, plan: str | None, status: str | None,
                   period_end: int | None) -> Tier:
    """Pure decision: given a subscription row, what tier applies right now."""
    if (status or "none").lower() not in ACTIVE_STATUSES:
        return TIERS[DEFAULT_TIER]
    if period_end is not None and period_end < time.time():
        logger.info("subscription_period_expired", user_id=user_id,
                    plan=plan, period_end=period_end)
        return TIERS[DEFAULT_TIER]
    try:
        return resolve(plan)
    except UnknownTier:
        logger.error("subscription_plan_unresolvable", user_id=user_id, plan=plan,
                     served=DEFAULT_TIER)
        return TIERS[DEFAULT_TIER]


async def entitlements_for(pool, user_id: str) -> Tier:
    """
    The tier this user is entitled to right now.

    Never raises: a database that is down must degrade to the free tier, not 500 the
    search endpoint. It logs when it does, because "everyone is suddenly free" is a
    symptom nobody notices without a line in the log saying so.
    """
    now = time.time()
    hit = _cache.get(user_id)
    if hit and hit[0] > now:
        return TIERS[hit[1]]

    tier = TIERS[DEFAULT_TIER]
    if pool is not None:
        try:
            async with pool.acquire() as conn:
                row = await conn.fetchrow(
                    "SELECT plan, status, current_period_end "
                    "FROM billing_subscriptions WHERE user_id=$1", user_id)
            if row:
                tier = _tier_from_row(user_id, row["plan"], row["status"],
                                      row["current_period_end"])
        except Exception as e:
            logger.warning("entitlements_db_error", user_id=user_id, error=str(e),
                           served=DEFAULT_TIER)

    _cache[user_id] = (now + CACHE_TTL_S, tier.id)
    return tier
