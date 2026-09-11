"""CF-15 gate. The revenue trend has data, or the card says why it does not.

Checks the endpoint's values against the `financials` table read independently,
and checks that a metric it genuinely cannot source comes back with a stated
reason rather than a row of nulls.

Run from services/gravity-api:
    .venv/Scripts/python.exe ../../docs/company-feature/gates/cf15-gate.py
"""
import asyncio
import os
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

from app.api.routes.company import company_trend  # noqa: E402
from app.core.analytics.longitudinal_tracker import resolve_metric  # noqa: E402
from app.db import supabase_rest  # noqa: E402

AUTH = {"user_id": "gate", "tier": "unlimited", "api_key": "gate"}

# Tickers whose exact-XBRL rows actually carry revenue for these periods. The row
# originally named AAPL; measured 2026-09-08, AAPL's corpus holds
# `Revenue (Total Revenue, Net Sales)` only for FY2017 and FY2018 — from FY2019 it
# has COGS and no revenue row at all. That is a gap in the corpus, not in this
# code, so AAPL moved to the two cases below that test exactly that.
TICKERS = ["NVDA", "TSLA", "CRM", "DELL"]
PERIODS = ["FY2021", "FY2022", "FY2023", "FY2024", "FY2025"]

failures = 0


def check(name: str, ok: bool, detail: str = "") -> None:
    global failures
    if not ok:
        failures += 1
    print(f"{'PASS' if ok else 'FAIL'}  {name}" + (f"\n      {detail}" if detail and not ok else ""))


async def truth(ticker: str, metric: str, period: str):
    """The stored fact, read straight from the table."""
    stored = resolve_metric(metric)
    rows = await supabase_rest.sb_select(
        "financials",
        {"ticker": f"eq.{ticker}", "metric_name": f"eq.{stored}", "period": f"eq.{period}",
         "document_id": "like.xbrl:*", "order": "filing_date.desc,id.asc"},
        select="value_float", limit=1,
    )
    return rows[0].get("value_float") if rows else None


async def main() -> int:
    if not supabase_rest.configured():
        print("BLOCKED: SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY not set")
        return 2

    for t in TICKERS:
        r = await company_trend(t, metric="revenue", periods=",".join(PERIODS), auth=AUTH)
        got = {p["period"]: p["value"] for p in r["data_points"]}
        nonnull = {k: v for k, v in got.items() if v is not None}

        check(f"{t}: revenue is non-null for at least 3 periods", len(nonnull) >= 3,
              f"got {len(nonnull)}: {got}")

        # CF-19 changed what this asserts, and the change is named rather than
        # quietly relaxed. Before it, `financials` was the only source, so
        # endpoint == table was the whole correctness condition. The endpoint now
        # falls back to live SEC XBRL, so it legitimately returns values for
        # periods the table has never held — NVDA FY2024 and FY2025 among them.
        #
        # Asserting equality would now FORBID the coverage CF-19 was built for.
        # What still grades something real is: the table remains authoritative
        # for every fact it does hold. A divergence there would mean the endpoint
        # is fabricating or preferring a worse source, which is the failure this
        # assertion was always about.
        mismatched, filled = [], []
        for period in PERIODS:
            want = await truth(t, "revenue", period)
            if want is None:
                if got.get(period) is not None:
                    filled.append(period)
                continue
            if got.get(period) != want:
                mismatched.append(f"{period}: endpoint={got.get(period)} table={want}")
        check(f"{t}: every value the table holds is served unchanged", not mismatched,
              "; ".join(mismatched))
        if filled:
            print(f"      {t}: {len(filled)} period(s) served from live SEC that the "
                  f"table does not hold: {', '.join(filled)}")

        check(f"{t}: no unavailable_reason when data was found",
              r.get("unavailable_reason") is None or not nonnull,
              f"reason={r.get('unavailable_reason')!r} while {len(nonnull)} values were returned")

        if nonnull:
            sample = sorted(nonnull.items())[-1]
            print(f"      {t} {sample[0]} revenue = ${sample[1] / 1e9:.2f}B")

    # AAPL, both directions. The periods it HAS must come back with real numbers,
    # and the periods it does not must come back with the reason — an empty chart
    # renders "no data source" and "no such period" identically, which is the whole
    # defect this row was opened for.
    covered = await company_trend("AAPL", metric="revenue", periods="FY2017,FY2018", auth=AUTH)
    vals = {p["period"]: p["value"] for p in covered["data_points"]}
    check("AAPL returns real revenue for the periods its corpus covers",
          vals.get("FY2017") == 229234000000 and vals.get("FY2018") == 265595000000,
          f"got {vals}")
    check("and carries no reason when it found them",
          covered.get("unavailable_reason") is None,
          f"reason={covered.get('unavailable_reason')!r}")

    # AAPL no longer HAS a gap — CF-19 fills FY2019+ from live SEC, which is what
    # CF-17 was opened for. The "states the gap" case therefore moves to a company
    # that still has one.
    #
    # It used to be MS, and CF-21 changed what MS correctly does: a bank files no
    # us-gaap Revenue tag, but it does report net income, so the card now shows
    # that LABELLED rather than refusing. The filer with genuinely nothing to show
    # is one that reports none of the ladder — TFC — and the refusal assertions
    # move there intact. MS gains an assertion of its own, so this is three checks
    # where there were two.
    gap = await company_trend("TFC", metric="revenue", periods="FY2021,FY2022,FY2023", auth=AUTH)
    check("a company that reports none of the ladder states that",
          "no reported revenue" in (gap.get("unavailable_reason") or ""),
          f"reason={gap.get('unavailable_reason')!r}")
    check("and names the periods it was asked for",
          "FY2021" in (gap.get("unavailable_reason") or ""),
          f"reason={gap.get('unavailable_reason')!r}")

    # The filer that DOES report something must not be refused, and must never be
    # handed back under the name of the metric it does not report.
    ms = await company_trend("MS", metric="revenue", periods="FY2023,FY2024", auth=AUTH)
    check("a filer with no revenue line still gets a series, labelled as what it is",
          any(p["value"] is not None for p in ms["data_points"])
          and ms["metric_used"] != "revenue"
          and ms["substituted"] is True,
          f"metric_used={ms['metric_used']!r} substituted={ms['substituted']!r}")

    # And AAPL, the ticker this row originally named, now answers for the periods
    # it could not before.
    fixed = await company_trend("AAPL", metric="revenue", periods="FY2023,FY2024", auth=AUTH)
    vals_fixed = {p["period"]: p["value"] for p in fixed["data_points"]}
    check("AAPL now answers for FY2023 and FY2024 (CF-17 closed by CF-19)",
          all(vals_fixed.get(p) is not None for p in ("FY2023", "FY2024")),
          f"got {vals_fixed}")

    # A metric that genuinely cannot be sourced must SAY so, not return nulls.
    unknown = await company_trend("AAPL", metric="unicorn_count",
                                  periods="FY2024,FY2025", auth=AUTH)
    check("an unmappable metric returns a stated reason, not a row of nulls",
          bool(unknown.get("unavailable_reason")),
          f"unavailable_reason={unknown.get('unavailable_reason')!r}")
    check("that reason names what IS available",
          "revenue" in (unknown.get("unavailable_reason") or ""),
          f"reason={unknown.get('unavailable_reason')!r}")

    # A real metric in a period the company never reported is the OTHER reason.
    old = await company_trend("NVDA", metric="revenue", periods="FY1998,FY1999", auth=AUTH)
    check("a real metric with no facts for those periods says that instead",
          "no reported revenue" in (old.get("unavailable_reason") or ""),
          f"reason={old.get('unavailable_reason')!r}")

    print(f"\nRESULT {'PASS' if failures == 0 else f'FAIL ({failures})'}")
    return 0 if failures == 0 else 1


if __name__ == "__main__":
    raise SystemExit(asyncio.run(main()))
