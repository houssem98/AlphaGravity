"""
The one tier vocabulary for this service (docs/PLANS_WORLD_CLASS_ROADMAP.md §4).

Before this module there were three: `billing.py` sold free/pro/team, `rate_limit.py`
enforced free/individual/team/enterprise/unlimited, and the org table allowed
free/pro/enterprise. They never agreed, and the disagreement was silent — a `pro`
subscriber is not a key in the limiter's table, so `MINUTE_LIMITS.get(tier, 10)`
handed them the free-tier limit and nothing raised, logged or alerted. §1b.

Two rules hold this module together:

  1. **Every tier decision in the service reads from here.** A second limits table
     added anywhere is the bug returning, and `R2` fails the build when one appears.
  2. **An unknown tier raises.** `.get(tier, default)` is what turned a paying
     customer into a free one; `resolve()` refuses instead, and the caller decides
     its fallback in the open and logs it. §3 rule 3, checked by `R4`.

Limits never loosen at the cutover. Free keeps the 100/month it already had and
gains a daily ceiling it did not have, so every existing user is capped at least as
tightly as before. The one deliberate increase is `professional`: it was silently
being served the free tier's 10/min, and 120/min is the number §4 sells it.
"""

from __future__ import annotations

from dataclasses import dataclass


class UnknownTier(ValueError):
    """Raised when a tier name resolves to nothing. Never swallowed in here."""


@dataclass(frozen=True)
class Tier:
    id: str
    name: str
    sold: bool          # False = internal only, never rendered in the pricing table
    per_minute: int
    per_day: int | None      # None = unlimited
    per_month: int | None    # None = unlimited


# The four tiers §4 sells, plus one internal tier that predates them.
TIERS: dict[str, Tier] = {
    "free": Tier("free", "Free", True, 10, 10, 100),
    "analyst": Tier("analyst", "Analyst", True, 60, 500, 5_000),
    "professional": Tier("professional", "Professional", True, 120, 2_000, 25_000),
    "institutional": Tier("institutional", "Institutional", True, 600, None, None),
    # Dev bypass and internal service API keys (auth.py). Not purchasable, so it is
    # absent from the pricing table and from `sold_tiers()`.
    "unlimited": Tier("unlimited", "Unlimited (internal)", False, 100_000, None, None),
}

# Every id this service has ever issued, mapped forward. Dropping one of these
# silently downgrades a live subscriber, which is why `R3` counts all four.
LEGACY_ALIASES: dict[str, str] = {
    "pro": "professional",
    "individual": "analyst",
    "team": "institutional",
    # `enterprise` was only ever a rate_limit.py row and an org-table value — the
    # billing config has never sold it — so no subscription can be sitting on it.
    "enterprise": "institutional",
}

DEFAULT_TIER = "free"


def resolve(raw: str | None) -> Tier:
    """
    Canonical tier for a name, following one legacy alias hop.

    Raises UnknownTier for anything else. That is the point: a name this service
    does not recognise is a bug in whatever produced it, and quietly serving it the
    free tier is how §1b went unnoticed for the life of the billing system.
    """
    key = (raw or "").strip().lower()
    if key in TIERS:
        return TIERS[key]
    if key in LEGACY_ALIASES:
        return TIERS[LEGACY_ALIASES[key]]
    raise UnknownTier(f"unknown tier {raw!r}; known: {sorted(TIERS)} + {sorted(LEGACY_ALIASES)}")


def sold_tiers() -> list[Tier]:
    """The tiers a pricing table may render, in ladder order."""
    return [TIERS[t] for t in ("free", "analyst", "professional", "institutional")]
