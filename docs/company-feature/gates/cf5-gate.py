"""CF-5 gate. Checks /company/{ticker}/financials against an unlimited read.

Two assertions:
  1. CORRECTNESS — the rows returned for limit=80 are the 80 newest distinct
     metric+period pairs, compared against every row paged out of the table.
  2. STABILITY — two identical calls return identical values. The dedupe keeps
     the first row seen per (metric, period); if the ordering has no unique
     tiebreaker, which row that is can differ per request, so the same metric can
     report different numbers on consecutive loads.

Run from services/gravity-api:
    .venv/Scripts/python.exe ../../docs/company-feature/gates/cf5-gate.py
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

from app.api.routes.company import company_financials  # noqa: E402
from app.db import supabase_rest  # noqa: E402

AUTH = {"user_id": "gate", "tier": "unlimited", "api_key": "gate"}
LIMIT = 80

# The heaviest tickers, plus the ones whose row count exceeds their distinct
# metric+period count — those are the only ones where the dedupe actually fires,
# so they are where a non-deterministic winner would show up.
TICKERS = ["NTAP", "DELL", "CSCO", "MCHP", "NVDA", "MMM", "SNPS", "WST", "AMAT", "RMD"]


async def unlimited(ticker: str) -> list[tuple[str, str]]:
    """The true newest-80 distinct (metric, period) pairs, paged without a cap."""
    rows, offset = [], 0
    while True:
        batch = await supabase_rest.sb_select(
            "financials",
            # The same TOTAL order the endpoint declares. That order is the
            # contract — the point of the gate is that two independent readers of
            # the table agree under it, which they cannot do while ties inside a
            # period are resolved arbitrarily.
            {"ticker": f"eq.{ticker}", "document_id": "like.xbrl:*",
             "order": "period.desc,filing_date.desc,metric_name.asc,id.asc"},
            select="metric_name,period,value_float",
            limit=1000,
            offset=offset,
        )
        rows.extend(batch)
        if len(batch) < 1000:
            break
        offset += 1000

    seen, out = set(), []
    for r in rows:
        key = (r.get("metric_name") or "", r.get("period") or "")
        if key in seen:
            continue
        seen.add(key)
        out.append(key)
    return out[:LIMIT]


async def main() -> int:
    if not supabase_rest.configured():
        print("BLOCKED: SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY not set")
        return 2

    print(f"{'ticker':<8}{'returned':>10}{'correct':>9}{'stable':>9}  verdict")
    failures = 0
    for t in TICKERS:
        want = await unlimited(t)
        a = await company_financials(t, limit=LIMIT, auth=AUTH)
        b = await company_financials(t, limit=LIMIT, auth=AUTH)

        got = [(r["metric"], r["period"] or "") for r in a["rows"]]
        correct = got == want

        # Same pairs AND same numbers, across two identical calls.
        va = {(r["metric"], r["period"]): r["value"] for r in a["rows"]}
        vb = {(r["metric"], r["period"]): r["value"] for r in b["rows"]}
        stable = va == vb

        ok = correct and stable
        if not ok:
            failures += 1
        print(f"{t:<8}{len(a['rows']):>10}{str(correct):>9}{str(stable):>9}  "
              f"{'PASS' if ok else 'FAIL'}")
        if not correct:
            extra = [p for p in got if p not in want][:3]
            missing = [p for p in want if p not in got][:3]
            print(f"          missing={missing} unexpected={extra}")

    print(f"\nRESULT {len(TICKERS) - failures}/{len(TICKERS)} tickers correct and stable")
    return 0 if failures == 0 else 1


if __name__ == "__main__":
    raise SystemExit(asyncio.run(main()))
