"""V2-7 gate. An internal key resolves a stated tier and a limit that binds.

CF-12 metered the PROXY, which was the option chosen at the time. `auth.py` still
handed every internal key `tier: "unlimited"` while deliberately skipping
`_apply_entitlement`, so any caller reaching gravity-api DIRECTLY with the key
string held that tier — whatever the proxy in front of it counted.

The row's first clause needs reading carefully, and this gate reads it strictly.
A tier and a limit already existed before the fix: `unlimited` resolves to
100_000/min with no daily and no monthly ceiling. That is a limit in name only,
and a gate satisfied by it would grade nothing. So the assertions below require
the resolved limit to be FINITE and to be meaningfully below the old one, not
merely present.

Owner chose the finite-service-tier branch over route scoping, 2026-09-11, after
the consumer grep: 12 call sites across the Vercel TN function, the market-server
proxy, the scheduled-grid routes and ten eval/probe harnesses.

Run from services/gravity-api:
    .venv/Scripts/python.exe ../../docs/company-feature/gates/v2-7-gate.py
"""
import asyncio
import logging
import os
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[3]
API = ROOT / "services" / "gravity-api"
sys.path.insert(0, str(API))

for env_file in (API / ".env", ROOT / ".env"):
    if env_file.exists():
        for line in env_file.read_text(encoding="utf-8").splitlines():
            line = line.strip()
            if line and not line.startswith("#") and "=" in line:
                k, v = line.split("=", 1)
                os.environ.setdefault(k.strip(), v.strip())

import structlog  # noqa: E402
structlog.configure(wrapper_class=structlog.make_filtering_bound_logger(logging.CRITICAL))

from app.api.middleware.auth import _internal_keys, _validate_api_key  # noqa: E402
from app.billing import capabilities as caps  # noqa: E402
from app.billing.tiers import TIERS, UnknownTier, resolve, sold_tiers  # noqa: E402

failures = 0


def check(name: str, ok: bool, detail: str = "") -> None:
    global failures
    if not ok:
        failures += 1
    print(f"{'PASS' if ok else 'FAIL'}  {name}" + (f"\n      {detail}" if detail and not ok else ""))


async def main() -> int:
    keys = sorted(_internal_keys())
    check("the internal allowlist still holds the two keys the row names",
          {"deep-research-internal", "eval-unlimited-fb-2026"} <= set(keys), f"got {keys}")

    for key in ("deep-research-internal", "eval-unlimited-fb-2026"):
        auth = await _validate_api_key(key)
        check(f"{key}: still authenticates", auth is not None)
        if auth is None:
            continue

        # ── a STATED tier ───────────────────────────────────────────────────
        named = auth.get("tier")
        check(f"{key}: carries a tier name", bool(named), f"tier={named!r}")
        try:
            tier = resolve(named)
            resolved = True
        except UnknownTier as e:
            tier, resolved = None, False
            check(f"{key}: its tier resolves against the tier table", False, str(e))
        if not resolved:
            continue
        check(f"{key}: its tier resolves against the tier table", True)

        # ── and a limit that BINDS ──────────────────────────────────────────
        check(f"{key}: the tier is not 'unlimited'", tier.id != "unlimited",
              "unlimited is 100_000/min with no daily or monthly ceiling — "
              "a stated limit that never refuses anything")
        check(f"{key}: has a finite per-minute limit",
              isinstance(tier.per_minute, int) and tier.per_minute > 0,
              f"per_minute={tier.per_minute!r}")
        check(f"{key}: has a finite per-DAY limit", tier.per_day is not None,
              "no daily ceiling means a slow caller can still spend without bound")
        check(f"{key}: its limit is materially below the old one",
              tier.per_minute <= TIERS["unlimited"].per_minute // 10,
              f"{tier.per_minute}/min vs the old {TIERS['unlimited'].per_minute}/min")

        # ── but not below what the measured consumers need ──────────────────
        # FinanceBench runs FB_CONCURRENCY=4 against 10-60s queries; the proxy is
        # capped at 20/min per anonymous viewer. A ceiling under those is a
        # different outage, so the gate holds the floor as well as the roof.
        check(f"{key}: the limit clears the measured consumers",
              tier.per_minute >= 60 and (tier.per_day or 0) >= 1_000,
              f"{tier.per_minute}/min, {tier.per_day}/day is below what the "
              "eval harnesses and the proxy already do")

        # ── it is internal, not something the pricing table sells ───────────
        check(f"{key}: its tier is not sold", not tier.sold)
        check(f"{key}: and does not appear in the pricing table",
              tier.id not in {t.id for t in sold_tiers()})

        # ── the capability matrix knows it ──────────────────────────────────
        # Every capability is defined for the four sold tiers only. A tier id the
        # matrix cannot answer for raises KeyError on the first paywalled route,
        # which would turn a rate-limit change into a 500.
        missing = []
        for cap in caps.CAPABILITIES:
            try:
                cap.for_tier(tier.id)
            except KeyError:
                missing.append(cap.key)
        check(f"{key}: every capability answers for its tier",
              not missing, f"{len(missing)} capabilities raise: {missing[:5]}")

        # It must not be more restricted than a paying customer on capabilities;
        # the ceiling this row adds is a RATE limit, not a feature downgrade.
        top = "institutional"
        differs = [c.key for c in caps.CAPABILITIES if c.for_tier(tier.id) != c.for_tier(top)]
        check(f"{key}: it is no more restricted than {top} on capabilities",
              not differs, f"differs on {differs[:5]}")

    # ── the dev bypass is untouched ─────────────────────────────────────────
    # It runs on a laptop with APP_ENV=development. Narrowing it was not asked for
    # and would be a separate change.
    check("the development bypass still resolves 'unlimited'",
          "unlimited" in TIERS and TIERS["unlimited"].per_day is None)

    # ── source shape, with the comments removed ─────────────────────────────
    # This file's own docstring quotes the string it forbids.
    src = (API / "app/api/middleware/auth.py").read_text(encoding="utf-8")
    code = re.sub(r'"""[\s\S]*?"""', "", src)
    code = re.sub(r"^[ \t]*#.*$", "", code, flags=re.M)
    body = code[code.index("async def _validate_api_key"):]
    body = body[:re.search(r"\n(?:async )?def |\n_JWKS", body).start()]

    check("the internal-key branch no longer hands out 'unlimited'",
          '"unlimited"' not in body and "'unlimited'" not in body,
          "the literal is still in _validate_api_key")
    check("the tier it hands out is the finite service tier",
          '"service"' in body or "'service'" in body)

    print(f"\nRESULT {'PASS' if failures == 0 else f'FAIL ({failures})'}")
    return 0 if failures == 0 else 1


if __name__ == "__main__":
    raise SystemExit(asyncio.run(main()))
