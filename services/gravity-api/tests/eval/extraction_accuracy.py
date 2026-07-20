#!/usr/bin/env python3
"""Labeled extraction-accuracy eval — deterministic, no LLM, no FinanceBench noise.

Ground truth = SEC XBRL `companyfacts` API (the authoritative structured values
companies file). We compare it against what our table parser extracted into the
Supabase `financials` table:

    for each (ticker, core concept, fiscal year) with a known SEC value,
    does `financials` hold a row whose value matches (within tolerance)?

This isolates EXTRACTION quality (the suspected numeric wall) from retrieval /
LLM / scorer effects. Output: per-concept and overall match rate.

Usage (reads Supabase via service-role key + public SEC API; no deploy needed):
    SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... \
      python tests/eval/extraction_accuracy.py --tickers AAPL MSFT NVDA --years 2021 2022 2023 2024
"""

from __future__ import annotations

import argparse
import asyncio
import os
import sys

import httpx

_UA = {"User-Agent": "GravitySearch-eval/1.0 (eval@alphagravity.ai)"}
_SEC_TICKERS = "https://www.sec.gov/files/company_tickers.json"
_FACTS = "https://data.sec.gov/api/xbrl/companyfacts/CIK{cik}.json"

# Core income-statement / balance-sheet concepts → regex for our free-text
# metric_name (table parser writes "Total net sales", "Net income", etc.).
CONCEPTS: dict[str, dict] = {
    "Revenues": {
        "xbrl": ["RevenueFromContractWithCustomerExcludingAssessedTax", "Revenues", "SalesRevenueNet"],
        "name_re": r"(net sales|total revenue|net revenue|revenue|total net sales)",
    },
    "NetIncomeLoss": {
        "xbrl": ["NetIncomeLoss"],
        "name_re": r"net income|net earnings|net loss",
    },
    "Assets": {
        "xbrl": ["Assets"],
        "name_re": r"total assets",
    },
    "Liabilities": {
        "xbrl": ["Liabilities"],
        "name_re": r"total liabilities",
    },
    "StockholdersEquity": {
        "xbrl": ["StockholdersEquity", "StockholdersEquityIncludingPortionAttributableToNoncontrollingInterest"],
        "name_re": r"(total )?(stockholders|shareholders).{0,3} equity",
    },
}

TOL = 0.01  # 1% — extraction should be near-exact vs filed XBRL


async def _ticker_to_cik(client: httpx.AsyncClient) -> dict[str, str]:
    r = await client.get(_SEC_TICKERS, headers=_UA, timeout=30)
    r.raise_for_status()
    out = {}
    for e in r.json().values():
        out[str(e["ticker"]).upper()] = str(e["cik_str"]).zfill(10)
    return out


def _annual(row: dict) -> bool:
    """Duration rows (income/revenue) must span ~1 year; instant rows (balance
    sheet) have no 'start'. Filters out quarterly figures."""
    s, e = row.get("start"), row.get("end")
    if not s:
        return True  # instant (balance sheet)
    if not e:
        return False
    try:
        from datetime import date
        d = (date.fromisoformat(e) - date.fromisoformat(s)).days
        return 330 <= d <= 400
    except Exception:
        return False


async def _sec_truth(client: httpx.AsyncClient, cik: str, years: set[int]) -> dict[tuple[str, int], float]:
    """Return {(concept, year): value} keyed by the PERIOD-END year (not SEC's
    `fy` field — a 10-K tags 3 comparative years under one fy). Annual rows only."""
    r = await client.get(_FACTS.format(cik=cik), headers=_UA, timeout=40)
    if r.status_code != 200:
        return {}
    facts = r.json().get("facts", {}).get("us-gaap", {})
    truth: dict[tuple[str, int], float] = {}
    for concept, spec in CONCEPTS.items():
        # Collect (year -> (end_date, val)); keep the LATEST end per year = the
        # fiscal-year-end value (avoids picking a quarter-end for instant
        # balance-sheet concepts, or a comparative period for income).
        best: dict[int, tuple[str, float]] = {}
        for tag in spec["xbrl"]:
            node = facts.get(tag)
            if not node:
                continue
            for unit_rows in node.get("units", {}).values():
                for row in unit_rows:
                    end = row.get("end")
                    if (not end or row.get("val") is None
                            or row.get("form") != "10-K" or not _annual(row)):
                        continue
                    yr = int(end[:4])
                    if yr in years and (yr not in best or end > best[yr][0]):
                        best[yr] = (end, float(row["val"]))
            if best:
                break  # first XBRL tag with data wins
        for yr, (_end, val) in best.items():
            truth[(concept, yr)] = val
    return truth


def _matches(extracted: float, truth: float) -> bool:
    """Compare allowing for unit scale (our value may be in millions/thousands)."""
    if truth == 0:
        return abs(extracted) < 1
    for scale in (1.0, 1e3, 1e6, 1e9):
        if abs(extracted * scale - truth) / abs(truth) <= TOL:
            return True
    return False


async def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--tickers", nargs="+", default=["AAPL", "MSFT", "NVDA"])
    ap.add_argument("--years", nargs="+", type=int, default=[2021, 2022, 2023, 2024])
    args = ap.parse_args()

    sb_url = os.getenv("SUPABASE_URL")
    sb_key = os.getenv("SUPABASE_SERVICE_ROLE_KEY")
    if not (sb_url and sb_key):
        print("ERROR: set SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY")
        sys.exit(1)

    years = set(args.years)
    import re
    per_concept = {c: [0, 0] for c in CONCEPTS}  # concept -> [hits, total]

    async with httpx.AsyncClient() as client:
        cikmap = await _ticker_to_cik(client)
        sbh = {"apikey": sb_key, "Authorization": f"Bearer {sb_key}"}
        for tk in [t.upper() for t in args.tickers]:
            cik = cikmap.get(tk)
            if not cik:
                print(f"{tk}: no CIK"); continue
            truth = await _sec_truth(client, cik, years)
            # our extracted rows for this ticker
            rr = await client.get(
                f"{sb_url}/rest/v1/financials",
                params={"ticker": f"eq.{tk}", "select": "metric_name,period,value_float", "limit": "5000"},
                headers=sbh, timeout=30,
            )
            rows = rr.json() if rr.status_code == 200 else []
            for (concept, fy), tval in truth.items():
                per_concept[concept][1] += 1
                name_re = CONCEPTS[concept]["name_re"]
                hit = False
                for row in rows:
                    if row.get("value_float") is None:
                        continue
                    if str(fy) not in str(row.get("period", "")):
                        continue
                    if not re.search(name_re, (row.get("metric_name") or "").lower()):
                        continue
                    if _matches(float(row["value_float"]), tval):
                        hit = True
                        break
                if hit:
                    per_concept[concept][0] += 1
            await asyncio.sleep(0.2)

    print("\n=== Extraction accuracy vs SEC XBRL ground truth ===")
    th = tt = 0
    for c, (h, t) in per_concept.items():
        th += h; tt += t
        rate = f"{h/t:.0%}" if t else "—"
        print(f"  {c:22} {h}/{t}  {rate}")
    print(f"  {'OVERALL':22} {th}/{tt}  {th/tt:.0%}" if tt else "  no labeled points")


if __name__ == "__main__":
    asyncio.run(main())
