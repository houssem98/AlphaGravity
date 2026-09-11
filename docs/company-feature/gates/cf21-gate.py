"""CF-21 gate. A filer that reports no revenue line still reports something —
and whatever is shown is labelled as what it is.

Banks and utilities file no us-gaap Revenue tag. Measured 2026-09-10: MS, DUK and
TFC all return nothing for `revenue`, so the trend card was empty for an entire
sector while MS reports net income ($13.39B FY2024) and DUK operating income
($7.93B).

The dangerous fix is the obvious one. Rendering net income beneath a "Revenue
Trend" heading is a fabricated comparison, so this gate checks BOTH halves: that a
series appears, and that the card cannot label it "Revenue".

Run from services/gravity-api:
    .venv/Scripts/python.exe ../../docs/company-feature/gates/cf21-gate.py
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

from app.api.routes.company import company_trend  # noqa: E402

AUTH = {"user_id": "gate", "tier": "unlimited", "api_key": "gate"}
PERIODS = "FY2023,FY2024"
UI = ROOT / "apps" / "market-ui" / "src" / "components" / "company"
failures = 0


def check(name: str, ok: bool, detail: str = "") -> None:
    global failures
    if not ok:
        failures += 1
    print(f"{'PASS' if ok else 'FAIL'}  {name}" + (f"\n      {detail}" if detail and not ok else ""))


async def main() -> int:
    # ── the two filers the row names ─────────────────────────────────────────
    for ticker, expected in (("MS", "net_income"), ("DUK", "operating_income")):
        r = await company_trend(ticker, metric="revenue", periods=PERIODS, auth=AUTH)
        values = [p["value"] for p in r["data_points"] if p["value"] is not None]

        check(f"{ticker}: the card renders a series", len(values) >= 2,
              f"got {len(values)} values")
        check(f"{ticker}: it is the metric the filer actually reports ({expected})",
              r["metric_used"] == expected, f"metric_used={r['metric_used']!r}")
        check(f"{ticker}: the response says the metric was substituted",
              r["substituted"] is True, f"substituted={r['substituted']!r}")
        check(f"{ticker}: and still reports what was asked for",
              r["metric_requested"] == "revenue")
        check(f"{ticker}: no unavailable_reason when a series was found",
              r.get("unavailable_reason") is None,
              f"reason={r.get('unavailable_reason')!r}")
        if values:
            print(f"      {ticker} {r['metric_used']} = "
                  + ", ".join(f"${v / 1e9:.2f}B" for v in values))

    # ── a filer that reports revenue must be untouched ───────────────────────
    nvda = await company_trend("NVDA", metric="revenue", periods=PERIODS, auth=AUTH)
    check("NVDA still answers with revenue and is not substituted",
          nvda["metric_used"] == "revenue" and nvda["substituted"] is False,
          f"metric_used={nvda['metric_used']!r} substituted={nvda['substituted']!r}")

    # ── a filer that reports none of them still refuses ──────────────────────
    tfc = await company_trend("TFC", metric="revenue", periods=PERIODS, auth=AUTH)
    check("TFC reports none of the ladder and says so",
          all(p["value"] is None for p in tfc["data_points"])
          and bool(tfc.get("unavailable_reason")))
    check("and the reason names the alternatives that were tried",
          "operating_income" in (tfc.get("unavailable_reason") or "")
          and "net_income" in (tfc.get("unavailable_reason") or ""),
          f"reason={tfc.get('unavailable_reason')!r}")

    # ── the card cannot label a substitute "Revenue" ─────────────────────────
    #
    # The server half means nothing if the component hardcodes the heading, which
    # is exactly what it did before this row.
    tab = (UI / "OverviewTab.tsx").read_text(encoding="utf-8")
    hook = (UI / "useCompanyData.ts").read_text(encoding="utf-8")

    check("the chart heading is derived, not the literal 'Revenue Trend'",
          re.search(r"\{trendLabel\}\s*Trend", tab) is not None
          and re.search(r'>\s*Revenue Trend\s*<', tab) is None,
          "a hardcoded 'Revenue Trend' heading is still rendered above the chart")
    check("the label comes from the metric the server returned",
          "trendMetric ?? 'revenue'" in tab)
    check("the series is keyed by that metric, not always `revenue`",
          "[trendKey]" in tab and "'net_income', 'operating_income'" not in tab)
    check("the hook carries metric_used through", "metric_used" in hook)
    check("a filer with no series at all shows the reason instead of no card",
          "data-trend-unavailable" in tab)

    print(f"\nRESULT {'PASS' if failures == 0 else f'FAIL ({failures})'}")
    return 0 if failures == 0 else 1


if __name__ == "__main__":
    raise SystemExit(asyncio.run(main()))
