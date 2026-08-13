"""
Gravity Search — Rate Limiter.

Three-layer enforcement, all of it projected from `app.billing.tiers`:

  Layer 1 — per-minute sliding window (burst protection)
  Layer 2 — per-day quota      (the ceiling §4's matrix sells)
  Layer 3 — per-month quota    (billing enforcement, predates the matrix)

This file used to own two tier tables of its own. It owns none now: the numbers
live in `tiers.py` and this module reads them, because two tables that must agree
are two tables that will not. See docs/PLANS_WORLD_CLASS_ROADMAP.md §1b for what
the disagreement cost.

Every layer fails closed. Counters live in Redis with a TTL matched to the window,
falling back to a per-process in-memory counter when Redis is unreachable.
"""

import time
import structlog
from datetime import datetime, timezone
from fastapi import HTTPException

from app.billing.tiers import DEFAULT_TIER, UnknownTier, resolve
from app.db.redis import redis_client

logger = structlog.get_logger()

# In-memory counter fallback when Redis is unavailable.
# Per-process only; with multiple machines limits will under-count, but
# this is still better than failing fully open (rate_limit disabled).
_MEM_COUNTERS: dict[str, tuple[int, float]] = {}


def _mem_incr(key: str, ttl_s: int) -> int:
    """Increment in-memory counter; auto-expires after ttl_s."""
    now = time.time()
    val, exp = _MEM_COUNTERS.get(key, (0, 0.0))
    if exp <= now:
        val = 0
        exp = now + ttl_s
    val += 1
    _MEM_COUNTERS[key] = (val, exp)
    # Cheap GC: drop a few expired entries each call to bound memory.
    if len(_MEM_COUNTERS) > 1024:
        for k in [k for k, (_, e) in list(_MEM_COUNTERS.items())[:32] if e <= now]:
            _MEM_COUNTERS.pop(k, None)
    return val


def _day_ttl() -> int:
    """Seconds until the next UTC midnight."""
    now = datetime.now(timezone.utc)
    end = now.replace(hour=0, minute=0, second=0, microsecond=0)
    return max(1, int((end.timestamp() + 86_400) - now.timestamp()))


def _month_ttl() -> int:
    """Seconds until midnight UTC on the 1st of next month."""
    now = datetime.now(timezone.utc)
    if now.month == 12:
        next_month = now.replace(year=now.year + 1, month=1, day=1,
                                  hour=0, minute=0, second=0, microsecond=0)
    else:
        next_month = now.replace(month=now.month + 1, day=1,
                                  hour=0, minute=0, second=0, microsecond=0)
    return max(1, int((next_month - now).total_seconds()))


class RateLimiter:
    """
    Three-layer Redis rate limiter, all limits read from `app.billing.tiers`:
      Layer 1 — per-minute sliding window (burst)
      Layer 2 — per-day quota (the matrix ceiling)
      Layer 3 — per-month quota (billing)
    """

    async def check(self, user_id: str, tier: str = "free") -> dict:
        """
        Enforce the minute, day and month limits for `tier`.
        Returns response headers dict. Raises HTTP 429 if any limit is exceeded.
        """
        headers: dict[str, str] = {}
        plan = resolve(tier)

        # ── Layer 1: Per-minute sliding window ──────────────────────────
        minute_limit = plan.per_minute
        window_epoch = int(time.time() // 60)
        minute_key = f"ratelimit:minute:{user_id}:{window_epoch}"

        try:
            minute_count = await redis_client.incr(minute_key)
            if minute_count == 1:
                await redis_client.expire(minute_key, 120)
        except Exception as e:
            # Redis down — fall back to per-process in-memory counter so we
            # don't silently fail open (10/min becomes unlimited).
            logger.warning("rate_limit_redis_error", error=str(e))
            minute_count = _mem_incr(minute_key, ttl_s=120)

        reset_at = (window_epoch + 1) * 60
        headers.update({
            "X-RateLimit-Limit": str(minute_limit),
            "X-RateLimit-Remaining": str(max(0, minute_limit - minute_count)),
            "X-RateLimit-Reset": str(reset_at),
        })

        if minute_count > minute_limit:
            logger.warning("minute_rate_exceeded", user_id=user_id, tier=tier, count=minute_count)
            raise HTTPException(
                status_code=429,
                detail=f"Rate limit exceeded: {minute_limit} requests/minute. "
                       f"Resets in {reset_at - int(time.time())}s.",
                headers={"Retry-After": str(reset_at - int(time.time())), **headers},
            )

        # ── Layer 2: Daily quota ─────────────────────────────────────────
        daily_limit = plan.per_day
        if daily_limit is not None:
            today = datetime.now(timezone.utc).strftime("%Y-%m-%d")
            day_key = f"ratelimit:daily:{user_id}:{today}"
            try:
                daily_count = await redis_client.incr(day_key)
                if daily_count == 1:
                    await redis_client.expire(day_key, _day_ttl())
            except Exception as e:
                logger.warning("daily_quota_redis_error", error=str(e))
                daily_count = _mem_incr(day_key, ttl_s=_day_ttl())

            headers.update({
                "X-RateLimit-Daily-Limit": str(daily_limit),
                "X-RateLimit-Daily-Remaining": str(max(0, daily_limit - daily_count)),
            })

            if daily_count > daily_limit:
                logger.warning("daily_quota_exceeded",
                               user_id=user_id, tier=plan.id, count=daily_count)
                raise HTTPException(
                    status_code=429,
                    detail=(
                        f"Daily quota exceeded: {daily_limit} searches/day on the "
                        f"'{plan.name}' plan. Resets at 00:00 UTC."
                    ),
                    headers={"Retry-After": str(_day_ttl()), **headers},
                )

        # ── Layer 3: Monthly quota ───────────────────────────────────────
        monthly_limit = plan.per_month
        if monthly_limit is not None:
            now = datetime.now(timezone.utc)
            month_key = f"ratelimit:monthly:{user_id}:{now.year}:{now.month:02d}"
            try:
                monthly_count = await redis_client.incr(month_key)
                if monthly_count == 1:
                    await redis_client.expire(month_key, _month_ttl())
            except Exception as e:
                logger.warning("monthly_quota_redis_error", error=str(e))
                monthly_count = _mem_incr(month_key, ttl_s=_month_ttl())

            headers.update({
                "X-RateLimit-Monthly-Limit": str(monthly_limit),
                "X-RateLimit-Monthly-Remaining": str(max(0, monthly_limit - monthly_count)),
            })

            if monthly_count > monthly_limit:
                logger.warning("monthly_quota_exceeded",
                               user_id=user_id, tier=tier, count=monthly_count)
                raise HTTPException(
                    status_code=429,
                    detail=(
                        f"Monthly quota exceeded: {monthly_limit} queries/month for "
                        f"'{tier}' tier. Resets 1st of next month. "
                        f"Upgrade at alphagravity.ai/pricing."
                    ),
                    headers={"Retry-After": str(_month_ttl()), **headers},
                )

        return headers


# Singleton
rate_limiter = RateLimiter()


async def check_rate_limit(user_id: str, tier: str = "free") -> dict:
    """
    FastAPI Depends convenience wrapper.

    This is the one place allowed to decide what an unrecognised tier means, and it
    says so out loud. `resolve()` raises rather than defaulting (§3 rule 3) so the
    fallback cannot be invisible the way `MINUTE_LIMITS.get(tier, 10)` was: a name
    this service does not know is a bug upstream, it gets logged at error level with
    the name attached, and the request is served at the most restrictive tier rather
    than being failed outright — a mis-tagged token should not take the API down.
    """
    try:
        resolve(tier)
    except UnknownTier:
        logger.error("unknown_tier_downgraded", user_id=user_id,
                     requested=tier, served=DEFAULT_TIER)
        tier = DEFAULT_TIER
    return await rate_limiter.check(user_id, tier)
