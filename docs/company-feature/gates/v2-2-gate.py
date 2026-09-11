"""V2-2 gate. A metric is never substituted by position.

`longitudinal_tracker._fetch_metric` did `next(iter(output.ratios.values()))` and
returned whatever came back as the metric that was asked for — CF-20's bug in a
second place, fixed there and walked past here.

Two things were wrong, and this gate holds both shut:

  * `RatioEngineOutput.ratios` is a `list[RatioResult]`, not a dict, so
    `.values()` raised AttributeError straight into a bare `except: pass`. The
    branch had never returned a value to anyone.
  * Had it been a dict, position 1 would have been returned under the requested
    metric's name — asking for revenue and being handed gross margin.

Asserted with a stub engine returning the wrong key, as the row requires.

Run from services/gravity-api:
    .venv/Scripts/python.exe ../../docs/company-feature/gates/v2-2-gate.py
"""
import asyncio
import logging
import os
import re
import sys
from dataclasses import dataclass
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

from app.core.analytics import longitudinal_tracker as lt  # noqa: E402

failures = 0


def check(name: str, ok: bool, detail: str = "") -> None:
    global failures
    if not ok:
        failures += 1
    print(f"{'PASS' if ok else 'FAIL'}  {name}" + (f"\n      {detail}" if detail and not ok else ""))


# ── the stub engine ─────────────────────────────────────────────────────────
# Shaped like the real one: `ratios` is a LIST of objects carrying `ratio_key`
# and `value`. A stub shaped as a dict would let the pre-fix code pass.
@dataclass
class StubRatio:
    ratio_key: str
    value: float | None


@dataclass
class StubOutput:
    ratios: list


class StubEngine:
    """Answers every query with whatever `self.returns` names, ignoring the ask."""

    def __init__(self, returns):
        self.returns = returns
        self.asked = []

    async def compute_from_query(self, ticker: str, query: str, period: str):
        self.asked.append(query)
        return StubOutput(ratios=[StubRatio(k, v) for k, v in self.returns])


class RaisingEngine:
    async def compute_from_query(self, ticker: str, query: str, period: str):
        raise RuntimeError("engine is down")


async def _none(*_a, **_k):
    return None


async def _no_rows(*_a, **_k):
    return []


async def main() -> int:
    # Every source ABOVE and BELOW the RatioEngine is silenced, so what the
    # ladder returns is the RatioEngine branch and nothing else.
    lt._fetch_from_financials = _none
    lt._fetch_from_edgar = _none
    from app.db import supabase_rest
    supabase_rest.sb_select = _no_rows

    # ── the wrong key ───────────────────────────────────────────────────────
    wrong = StubEngine([("gross_margin", 45.0)])
    tracker = lt.LongitudinalTracker(ratio_engine=wrong)
    value, reason = await tracker._fetch_metric("ACME", "revenue", "FY2025")

    check("a returned key that is not the requested metric yields no value",
          value is None, f"got {value!r} — gross margin returned as revenue")
    check("the stub was actually reached", wrong.asked == ["revenue"],
          f"engine saw {wrong.asked!r} — the ladder never got to it, so this gate proved nothing")
    check("the absence carries a stated reason", bool(reason.strip()),
          f"reason is {reason!r}")
    check("the reason names the metric that was asked for", "revenue" in reason.lower(), reason)
    check("the reason names the metric that came back", "gross_margin" in reason.lower(), reason)
    print(f"      reason: {reason}")

    # ── the right key ───────────────────────────────────────────────────────
    right = StubEngine([("revenue", 391_035_000_000.0)])
    value, reason = await lt.LongitudinalTracker(ratio_engine=right)._fetch_metric(
        "ACME", "revenue", "FY2025")
    check("a returned key that IS the requested metric yields its value",
          value == 391_035_000_000.0, f"got {value!r} with reason {reason!r}")
    check("a value that was found carries no reason", reason == "", f"reason={reason!r}")

    # The right key present among several wrong ones is still matched by name,
    # never by position — position 1 here is the wrong metric.
    mixed = StubEngine([("gross_margin", 45.0), ("revenue", 123.0)])
    value, _ = await lt.LongitudinalTracker(ratio_engine=mixed)._fetch_metric(
        "ACME", "revenue", "FY2025")
    check("the match is by name, not by position", value == 123.0,
          f"got {value!r} — position 1 was gross_margin")

    # ── the branch is no longer silently dead ───────────────────────────────
    value, reason = await lt.LongitudinalTracker(ratio_engine=RaisingEngine())._fetch_metric(
        "ACME", "revenue", "FY2025")
    check("an engine that raises is absent WITH a reason, not a swallowed pass",
          value is None and "RuntimeError" in reason, f"reason={reason!r}")

    # ── the absence reaches the series ──────────────────────────────────────
    series = await lt.LongitudinalTracker(
        ratio_engine=StubEngine([("gross_margin", 45.0)]),
    ).get_metric_series(ticker="ACME", metric_name="revenue", periods=["FY2024", "FY2025"])
    check("every period in the series is empty", all(p.value is None for p in series.data_points))
    check("and each states why", all(p.absent_reason.strip() for p in series.data_points),
          f"{[p.absent_reason for p in series.data_points]!r}")

    # ── source shape, with the comments removed ─────────────────────────────
    # Three gates in the previous ledger matched their own explanatory text, and
    # this file's own docstring names the construct it forbids.
    src = (API / "app/core/analytics/longitudinal_tracker.py").read_text(encoding="utf-8")
    code = re.sub(r'"""[\s\S]*?"""', "", src)
    code = re.sub(r"^[ \t]*#.*$", "", code, flags=re.M)

    check("no `.ratios.values()` survives", ".ratios.values()" not in code)
    check("no `next(iter(` over engine output survives", "next(iter(output" not in code)
    check("the RatioEngine result is compared to the requested metric",
          "ratio_key" in code and "wanted" in code,
          "nothing in the code compares the returned key to the asked-for one")
    # Scoped to `_fetch_metric`, which is what this row is about. File-wide this
    # assertion also graded `_load_cache` / `_store_cache`, where swallowing is
    # correct — a cache that cannot be read falls through to the real source and
    # has nothing to state. Those are listed below as a note, not a failure.
    body = code[code.index("async def _fetch_metric"):]
    body = body[:re.search(r"\n    (?:async )?def ", body).start()]
    check("no exception inside _fetch_metric is swallowed without a reason",
          not re.search(r"except[^\n]*:\s*\n\s*pass", body),
          "an exception in the fetch ladder is still discarded silently")
    check("the engine failure path sets a reason",
          re.search(r"except Exception as \w+:[\s\S]{0,400}?reason = ", body) is not None,
          "the try/except around compute_from_query does not record why it failed")
    swallows = len(re.findall(r"except[^\n]*:\s*\n\s*pass", code))
    print(f"      NOTE  {swallows} silent `except: pass` elsewhere in the file "
          f"(cache read/write) — out of this row's scope")

    print(f"\nRESULT {'PASS' if failures == 0 else f'FAIL ({failures})'}")
    return 0 if failures == 0 else 1


if __name__ == "__main__":
    raise SystemExit(asyncio.run(main()))
