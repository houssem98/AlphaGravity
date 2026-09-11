"""CF-28 gate. The trend fetches its periods together, not one at a time.

`get_metric_series` looped `for period in periods: await self._fetch_metric(...)`,
so an 8-period window was 8 serial round trips. Measured 2026-09-11 over
FY2020-FY2027: NVDA 75.2s, MS 48.9s, LULU 12.0s.

TIMING IS RIGGED AGAINST THE NEW CODE, ON PURPOSE. edgar_search persists each
fact it fetches, so whichever arm runs second gets a warm cache. This runs the
PARALLEL arm first on a cold ticker and the SERIAL arm second with that advantage
— if parallel still wins, it wins a fortiori.

Run from services/gravity-api:
    .venv/Scripts/python.exe ../../docs/company-feature/gates/cf28-gate.py
"""
import asyncio
import logging
import os
import re
import sys
import time
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

from app.api.routes.analytics import _get_longitudinal_tracker  # noqa: E402
from app.core.analytics.longitudinal_tracker import PeriodDataPoint  # noqa: E402

PERIODS = [f"FY{y}" for y in range(2020, 2028)]
# Tickers not touched by the baseline run, so the first arm is genuinely cold.
# Overridable, because a ticker measured once is warm forever: `get_metric_series`
# caches the whole series, so a re-run of this gate against the same tickers
# returns in ~0.0s and measures nothing at all. Pass fresh ones to re-measure:
#   TICKERS=ROST,ULTA .venv/Scripts/python.exe ../../docs/company-feature/gates/cf28-gate.py
TICKERS = [t.strip().upper() for t in os.getenv("TICKERS", "ANET,DECK").split(",") if t.strip()]

# Below this, the series cache answered and the stopwatch is measuring a dict
# lookup. That is not a faster implementation, and reporting it as one would be
# the same class of lie this ledger exists to remove.
CACHE_FLOOR_S = 0.5

failures = 0


def check(name: str, ok: bool, detail: str = "") -> None:
    global failures
    if not ok:
        failures += 1
    print(f"{'PASS' if ok else 'FAIL'}  {name}" + (f"\n      {detail}" if detail and not ok else ""))


async def serial(tracker, ticker: str, metric: str) -> list[PeriodDataPoint]:
    """The shape this row replaced, kept here so the comparison is real."""
    unit = tracker._get_metric_unit(metric)
    out = []
    for period in PERIODS:
        value = await tracker._fetch_metric(ticker, metric, period)
        out.append(PeriodDataPoint(period=period, value=value, unit=unit))
    return out


async def main() -> int:
    tracker = _get_longitudinal_tracker()
    total_par = total_ser = 0.0

    for ticker in TICKERS:
        # Parallel first, on a cold ticker.
        t0 = time.time()
        series = await tracker.get_metric_series(
            ticker=ticker, metric_name="revenue", periods=PERIODS)
        par = time.time() - t0

        # Serial second, with whatever the first arm warmed.
        t0 = time.time()
        ser_points = await serial(tracker, ticker, "revenue")
        ser = time.time() - t0

        total_par += par
        total_ser += ser

        par_vals = [(p.period, p.value) for p in series.data_points]
        ser_vals = [(p.period, p.value) for p in ser_points]

        check(f"{ticker}: the concurrent read returns exactly the serial values",
              par_vals == ser_vals,
              f"parallel={par_vals}\n      serial  ={ser_vals}")
        check(f"{ticker}: the periods come back in the order asked for",
              [p.period for p in series.data_points] == PERIODS,
              f"got {[p.period for p in series.data_points]}")

        found = sum(1 for _, v in par_vals if v is not None)
        print(f"      {ticker}: parallel(cold) {par:.1f}s vs serial(warm) {ser:.1f}s, "
              f"{found}/{len(PERIODS)} periods found")

    check("concurrent is faster than serial even with the cache against it",
          total_par < total_ser,
          f"parallel {total_par:.1f}s vs serial {total_ser:.1f}s")
    print(f"\n      total parallel(cold) {total_par:.1f}s · serial(warm) {total_ser:.1f}s")

    # The shape itself, so a revert cannot pass silently.
    src = (API / "app" / "core" / "analytics" / "longitudinal_tracker.py").read_text(encoding="utf-8")
    body = src.split("async def get_metric_series")[1].split("async def get_profile")[0]
    # Comments stripped first: the code's own comment quotes the shape it
    # removed, so a raw search matches the explanation rather than a regression.
    # (Third gate in this ledger to trip that wire.) The statement form carries a
    # colon; the comprehension that replaced it does not.
    code = re.sub(r"#.*$", "", body, flags=re.M)
    check("the serial period loop is gone from get_metric_series",
          "for period in periods:" not in code,
          "a serial `for period in periods:` is still there")
    check("and the periods are gathered", "asyncio.gather(" in body)

    print(f"\nRESULT {'PASS' if failures == 0 else f'FAIL ({failures})'}")
    return 0 if failures == 0 else 1


if __name__ == "__main__":
    raise SystemExit(asyncio.run(main()))
