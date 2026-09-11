"""V2-3 gate. Year-over-year compares to the period the label names.

`_compute_changes` was documented "(4-period lag)" and did `points[i - 4]`.
Four rows back is the same quarter a year earlier only for a DENSE QUARTERLY
series. The company page asks for eight ANNUAL periods, so FY2024's YoY pointed
at FY2020 — a four-year change presented as annual growth.

Every case below is built in memory from period labels and hand-computed values;
nothing here touches the network, so the arithmetic is checkable by eye.

Run from services/gravity-api:
    .venv/Scripts/python.exe ../../docs/company-feature/gates/v2-3-gate.py
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

failures = 0


def check(name: str, ok: bool, detail: str = "") -> None:
    global failures
    if not ok:
        failures += 1
    print(f"{'PASS' if ok else 'FAIL'}  {name}" + (f"\n      {detail}" if detail and not ok else ""))


def pct(now: float, then: float) -> float:
    """The change this gate expects, written out rather than imported."""
    return round(((now - then) / abs(then)) * 100, 2)


def build(pairs) -> MetricSeries:
    series = MetricSeries(
        ticker="ACME", metric_name="revenue", display_name="Revenue", unit="USD M",
        data_points=[PeriodDataPoint(period=p, value=v) for p, v in pairs],
    )
    LongitudinalTracker()._compute_changes(series)
    return series


def by_label(series: MetricSeries) -> dict:
    return {dp.period: dp for dp in series.data_points}


# ── an annual series compares consecutive fiscal years ──────────────────────
ANNUAL = [
    ("FY2019", 100.0), ("FY2020", 110.0), ("FY2021", 150.0), ("FY2022", 200.0),
    ("FY2023", 220.0), ("FY2024", 260.0), ("FY2025", 300.0), ("FY2026", 330.0),
]
annual = by_label(build(ANNUAL))
values = dict(ANNUAL)

ok = True
detail = ""
for i in range(1, len(ANNUAL)):
    period, value = ANNUAL[i]
    want = pct(value, ANNUAL[i - 1][1])
    got = annual[period].yoy_change
    if got != want:
        ok, detail = False, f"{period}: got {got}, want {want} (vs {ANNUAL[i - 1][0]})"
        break
check("an annual series compares each year to the one before it", ok, detail)

check("the first annual point has no prior year and so no change",
      annual["FY2019"].yoy_change is None, f"got {annual['FY2019'].yoy_change}")

# The defect in one number. Under `points[i - 4]`, FY2024 (index 5) compared to
# index 1 — FY2020. If those two answers coincide the case proves nothing, so
# the gate asserts they differ before asserting which one is right.
four_back = pct(values["FY2024"], values["FY2020"])
one_year = pct(values["FY2024"], values["FY2023"])
check("the four-rows-back answer and the prior-year answer differ",
      four_back != one_year, f"both are {one_year} — this fixture discriminates nothing")
check("FY2024 does not report its change against FY2020",
      annual["FY2024"].yoy_change != four_back,
      f"FY2024 yoy is {annual['FY2024'].yoy_change}, which is the FY2020 comparison")
check("FY2024 reports its change against FY2023",
      annual["FY2024"].yoy_change == one_year,
      f"got {annual['FY2024'].yoy_change}, want {one_year}")
print(f"      FY2024: vs FY2023 = {one_year}%   vs FY2020 (the old answer) = {four_back}%")

check("an annual series is given no quarter-over-quarter change",
      all(dp.qoq_change is None for dp in build(ANNUAL).data_points),
      "consecutive fiscal years are being reported as a QoQ")

# ── a quarterly series compares the same quarter a year earlier ─────────────
# Q4 2024 is absent from the window, so index arithmetic and label arithmetic
# disagree: Q3 2025 sits at index 5, and index 5-4 is Q2 2024.
QUARTERLY = [
    ("Q1 2024", 50.0), ("Q2 2024", 55.0), ("Q3 2024", 60.0),
    ("Q1 2025", 70.0), ("Q2 2025", 77.0), ("Q3 2025", 90.0),
]
quarterly = by_label(build(QUARTERLY))
qv = dict(QUARTERLY)

check("the sparse window makes index and label disagree",
      QUARTERLY[5 - 4][0] != "Q3 2024",
      "index 5-4 is already Q3 2024 — this fixture discriminates nothing")
check("Q3 2025 compares to Q3 2024",
      quarterly["Q3 2025"].yoy_change == pct(qv["Q3 2025"], qv["Q3 2024"]),
      f"got {quarterly['Q3 2025'].yoy_change}, want {pct(qv['Q3 2025'], qv['Q3 2024'])}")
check("Q3 2025 does not compare to Q2 2024, which is four rows back",
      quarterly["Q3 2025"].yoy_change != pct(qv["Q3 2025"], qv["Q2 2024"]),
      f"got the index answer {pct(qv['Q3 2025'], qv['Q2 2024'])}")
check("Q1 2025 compares to Q1 2024",
      quarterly["Q1 2025"].yoy_change == pct(qv["Q1 2025"], qv["Q1 2024"]))
check("Q1 2024 has no earlier year in the window and so no change",
      quarterly["Q1 2024"].yoy_change is None, f"got {quarterly['Q1 2024'].yoy_change}")

check("Q2 2025 reports its quarter-over-quarter against Q1 2025",
      quarterly["Q2 2025"].qoq_change == pct(qv["Q2 2025"], qv["Q1 2025"]),
      f"got {quarterly['Q2 2025'].qoq_change}")
check("Q1 2025 has no QoQ because Q4 2024 is not in the window",
      quarterly["Q1 2025"].qoq_change is None,
      f"got {quarterly['Q1 2025'].qoq_change} — it reached past the gap")

# Q1's previous quarter is the PRIOR year's Q4, not Q4 of its own year.
WRAPPED = [("Q4 2024", 80.0), ("Q1 2025", 88.0)]
wrapped = by_label(build(WRAPPED))
check("Q1 2025's previous quarter is Q4 2024",
      wrapped["Q1 2025"].qoq_change == pct(88.0, 80.0),
      f"got {wrapped['Q1 2025'].qoq_change}")

# ── a missing neighbour is absent, not the next one along ───────────────────
GAPPED = [("FY2021", 100.0), ("FY2022", 120.0), ("FY2024", 200.0)]
gapped = by_label(build(GAPPED))
check("a year whose predecessor is missing reports no change",
      gapped["FY2024"].yoy_change is None,
      f"got {gapped['FY2024'].yoy_change} — it reached back to FY2022")

EMPTY = [("FY2023", None), ("FY2024", 200.0)]
emptied = by_label(build(EMPTY))
check("a predecessor present but empty reports no change",
      emptied["FY2024"].yoy_change is None, f"got {emptied['FY2024'].yoy_change}")

ZERO = [("FY2023", 0.0), ("FY2024", 200.0)]
check("a zero predecessor reports no change rather than dividing by it",
      by_label(build(ZERO))["FY2024"].yoy_change is None)

# ── an unreadable label gets no change at all ───────────────────────────────
UNREADABLE = [("TTM", 100.0), ("TTM", 120.0)]
check("a label the parser cannot read gets no positional guess",
      all(dp.yoy_change is None and dp.qoq_change is None
          for dp in build(UNREADABLE).data_points))

# ── a mixed set never compares across bases ─────────────────────────────────
MIXED = [("FY2024", 400.0), ("Q4 2024", 110.0), ("FY2025", 440.0), ("Q4 2025", 120.0)]
mixed = by_label(build(MIXED))
check("FY2025 compares to FY2024, not to a quarter",
      mixed["FY2025"].yoy_change == pct(440.0, 400.0), f"got {mixed['FY2025'].yoy_change}")
check("Q4 2025 compares to Q4 2024, not to a fiscal year",
      mixed["Q4 2025"].yoy_change == pct(120.0, 110.0), f"got {mixed['Q4 2025'].yoy_change}")

# ── source shape, with the comments removed ─────────────────────────────────
# This file's own docstring names `points[i - 4]`, which is exactly the trap
# three gates in the previous ledger fell into.
src = (API / "app/core/analytics/longitudinal_tracker.py").read_text(encoding="utf-8")
code = re.sub(r'"""[\s\S]*?"""', "", src)
code = re.sub(r"^[ \t]*#.*$", "", code, flags=re.M)
body = code[code.index("def _compute_changes"):]
body = body[:re.search(r"\n    (?:async )?def ", body).start()]

check("no four-row offset survives in _compute_changes",
      not re.search(r"\[\s*i\s*-\s*4\s*\]", body), "`points[i - 4]` is still there")
# The concern is addressing the SERIES by offset. `_QUARTERS[i - 1]` is a lookup
# in the four quarter names, which is what "the previous quarter" means; a blanket
# ban on `[i - 1]` would grade that and nothing about this row.
check("no data point is reached by subscript at all",
      not re.search(r"\b(points|data_points)\s*\[", body),
      "a neighbouring point is still addressed by position")
check("the comparison period is derived from the label",
      "_parse_period" in body, "nothing in the body reads the period labels")

print(f"\nRESULT {'PASS' if failures == 0 else f'FAIL ({failures})'}")
raise SystemExit(0 if failures == 0 else 1)
