"""V2-4 gate. CAGR compounds over elapsed years, not over the row count.

`_compute_statistics` did `n_years = len(values) / 4  # assuming quarterly data`.
The company page asks for eight ANNUAL periods. Eight of those span seven years;
that line called it two, and the compounding root was taken over a quarter of
the real elapsed time.

The row's own arithmetic, written out once and used everywhere below:

    FY2019 = 100, FY2026 = 200, seven years elapsed
    (200 / 100) ** (1 / 7) - 1  =  0.1040895136738123   -> 10.4% a year
    the old answer, over len/4 = 2 years:
    (200 / 100) ** (1 / 2) - 1  =  0.4142135623730951   -> 41.4% a year

Run from services/gravity-api:
    .venv/Scripts/python.exe ../../docs/company-feature/gates/v2-4-gate.py
"""
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

from app.core.analytics.longitudinal_tracker import (  # noqa: E402
    LongitudinalTracker, MetricSeries, PeriodDataPoint,
)

TOL = 1e-6

# Hand-computed, to the digits a calculator gives. Not imported, not derived
# from the code under test.
SEVEN_YEAR_DOUBLING = 0.1040895136738123
TWO_YEAR_DOUBLING = 0.4142135623730951

failures = 0


def check(name: str, ok: bool, detail: str = "") -> None:
    global failures
    if not ok:
        failures += 1
    print(f"{'PASS' if ok else 'FAIL'}  {name}" + (f"\n      {detail}" if detail and not ok else ""))


def near(a, b, tol: float = TOL) -> bool:
    return a is not None and abs(a - b) < tol


def build(pairs) -> MetricSeries:
    series = MetricSeries(
        ticker="ACME", metric_name="revenue", display_name="Revenue", unit="USD M",
        data_points=[PeriodDataPoint(period=p, value=v) for p, v in pairs],
    )
    LongitudinalTracker()._compute_statistics(series)
    return series


# ── the row's own case: FY2019-FY2026, eight annual periods ─────────────────
ANNUAL = [
    ("FY2019", 100.0), ("FY2020", 110.0), ("FY2021", 125.0), ("FY2022", 140.0),
    ("FY2023", 155.0), ("FY2024", 170.0), ("FY2025", 185.0), ("FY2026", 200.0),
]
annual = build(ANNUAL)

check("the fixture is the one the row names: eight periods, FY2019 to FY2026",
      len(ANNUAL) == 8 and ANNUAL[0][0] == "FY2019" and ANNUAL[-1][0] == "FY2026")
check("CAGR over FY2019-FY2026 equals (last/first)**(1/7)-1 within 1e-6",
      near(annual.cagr, SEVEN_YEAR_DOUBLING),
      f"got {annual.cagr!r}, want {SEVEN_YEAR_DOUBLING} (+/- {TOL})")
check("and that is the hand-computed value, not the code's own arithmetic",
      near(annual.cagr, (200.0 / 100.0) ** (1 / 7) - 1),
      f"got {annual.cagr!r}")
check("it is not the len/4 answer",
      not near(annual.cagr, TWO_YEAR_DOUBLING, 1e-4),
      f"got {annual.cagr!r}, which is the two-year root")
print(f"      FY2019-FY2026 100->200:  {annual.cagr:.6f}  "
      f"(the old answer was {TWO_YEAR_DOUBLING:.6f}, "
      f"{TWO_YEAR_DOUBLING / SEVEN_YEAR_DOUBLING:.2f}x too high)")

check("the span itself reads seven years off the labels",
      LongitudinalTracker()._elapsed_years(annual) == 7.0,
      f"got {LongitudinalTracker()._elapsed_years(annual)!r}")

# ── a quarterly series is still measured in years ───────────────────────────
# Q1 2019 to Q3 2026 is seven years and two quarters.
QUARTERLY = [("Q1 2019", 100.0), ("Q2 2019", 101.0), ("Q3 2026", 200.0)]
quarterly = build(QUARTERLY)
check("a quarterly span counts the quarters as fractions of a year",
      LongitudinalTracker()._elapsed_years(quarterly) == 7.5,
      f"got {LongitudinalTracker()._elapsed_years(quarterly)!r}")
check("its CAGR compounds over 7.5 years",
      near(quarterly.cagr, (200.0 / 100.0) ** (1 / 7.5) - 1), f"got {quarterly.cagr!r}")

# Four dense quarters span three quarters, not one year — the old line called
# exactly this case right and every other case wrong.
DENSE = [("Q1 2024", 100.0), ("Q2 2024", 110.0), ("Q3 2024", 120.0), ("Q4 2024", 133.1)]
check("four consecutive quarters span three quarters",
      LongitudinalTracker()._elapsed_years(build(DENSE)) == 0.75,
      f"got {LongitudinalTracker()._elapsed_years(build(DENSE))!r}")

# ── the row count is not the span ───────────────────────────────────────────
# Three values across the same seven years. len/4 would have called it 0.75.
SPARSE = [("FY2019", 100.0), ("FY2022", 140.0), ("FY2026", 200.0)]
sparse = build(SPARSE)
check("three points across seven years still compound over seven",
      near(sparse.cagr, SEVEN_YEAR_DOUBLING),
      f"got {sparse.cagr!r} from {len(SPARSE)} rows")
check("the sparse and dense series over the same span agree",
      near(sparse.cagr, annual.cagr),
      f"{sparse.cagr!r} vs {annual.cagr!r} — the row count is still leaking in")

# Empty periods at the ends do not extend the span; the span is the periods
# that carry a value.
PADDED = [("FY2018", None), ("FY2019", 100.0), ("FY2026", 200.0), ("FY2027", None)]
check("empty periods at the edges do not stretch the span",
      near(build(PADDED).cagr, SEVEN_YEAR_DOUBLING), f"got {build(PADDED).cagr!r}")

# ── a span that cannot be read yields no CAGR ───────────────────────────────
check("an unreadable label yields no CAGR rather than a guessed span",
      build([("TTM", 100.0), ("TTM", 200.0)]).cagr is None)
check("an annual period against a quarterly one yields no CAGR",
      build([("FY2019", 100.0), ("Q3 2026", 200.0)]).cagr is None)
check("a series inside one fiscal year yields no CAGR rather than dividing by zero",
      build([("FY2024", 100.0), ("FY2024", 200.0)]).cagr is None)

# ── source shape, with the comments removed ─────────────────────────────────
# This file's own docstring quotes `len(values) / 4`, which is the trap three
# gates in the previous ledger fell into.
src = (API / "app/core/analytics/longitudinal_tracker.py").read_text(encoding="utf-8")
code = re.sub(r'"""[\s\S]*?"""', "", src)
code = re.sub(r"^[ \t]*#.*$", "", code, flags=re.M)
body = code[code.index("def _compute_statistics"):]
body = body[:re.search(r"\n    (?:async )?def ", body).start()]

check("no row-count divisor survives in _compute_statistics",
      not re.search(r"len\(\s*values\s*\)\s*/\s*\d", body), "`len(values) / 4` is still there")
check("the span comes from a named helper, not an expression on the row count",
      "_elapsed_years" in body)
check("the helper reads the period labels",
      "_parse_period" in code[code.index("def _elapsed_years"):][:900])

print(f"\nRESULT {'PASS' if failures == 0 else f'FAIL ({failures})'}")
raise SystemExit(0 if failures == 0 else 1)
