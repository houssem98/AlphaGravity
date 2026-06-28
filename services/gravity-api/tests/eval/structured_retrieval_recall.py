#!/usr/bin/env python3
"""Structured-retrieval recall — isolate retrieval from extraction/generation.

We already know (extraction_accuracy.py) that core facts are ~86% correctly in
the `financials` table. This asks the NEXT question deterministically:

    for a fact we KNOW is in financials (matches SEC ground truth), does
    /v1/search actually surface it?  Three checkpoints per fact:
      1. RETRIEVED  — the value appears in a returned source / structured_data
      2. ANSWERED   — the value appears in the answer text (end-to-end)

Gap pattern tells us the wall:
  retrieved low                → retrieval is the wall (fact in DB, not fetched)
  retrieved high, answered low  → generation/compute is the wall

Usage:
    GRAVITY_API_URL=https://gravity-api-prod.fly.dev GRAVITY_API_KEY=deep-research-internal \
    SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... \
      python tests/eval/structured_retrieval_recall.py --tickers AAPL MSFT NVDA KO --years 2022 2023
"""

from __future__ import annotations

import argparse
import asyncio
import os
import re
import sys

import httpx

sys.path.insert(0, os.path.dirname(__file__))
from extraction_accuracy import CONCEPTS, _sec_truth, _ticker_to_cik, _matches, _UA  # noqa: E402

# Natural-language phrasing for the query per concept.
_PHRASE = {
    "Revenues": "total revenue (net sales)",
    "NetIncomeLoss": "net income",
    "Assets": "total assets",
    "Liabilities": "total liabilities",
    "StockholdersEquity": "total stockholders equity",
}


def _value_in_text(value: float, text: str) -> bool:
    if not text:
        return False
    for m in re.finditer(r"(\d[\d,]*\.?\d*)\s*(billion|million|trillion|b|m|t)?", text.lower()):
        try:
            mant = float(m.group(1).replace(",", ""))
        except ValueError:
            continue
        suf = (m.group(2) or "").lower()
        scaled = mant * {"billion": 1e9, "b": 1e9, "million": 1e6, "m": 1e6,
                         "trillion": 1e12, "t": 1e12}.get(suf, 1)
        for cand in (mant, scaled):
            if _matches(cand, value):
                return True
    return False


async def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--tickers", nargs="+", default=["AAPL", "MSFT", "NVDA", "KO"])
    ap.add_argument("--years", nargs="+", type=int, default=[2022, 2023])
    ap.add_argument("--concurrency", type=int, default=2)
    args = ap.parse_args()

    api = os.getenv("GRAVITY_API_URL", "http://localhost:8000").rstrip("/")
    api_key = os.getenv("GRAVITY_API_KEY", "deep-research-internal")
    sb_url = os.getenv("SUPABASE_URL"); sb_key = os.getenv("SUPABASE_SERVICE_ROLE_KEY")
    if not (sb_url and sb_key):
        print("ERROR: set SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY"); sys.exit(1)
    years = set(args.years)

    async with httpx.AsyncClient() as client:
        cikmap = await _ticker_to_cik(client)
        sbh = {"apikey": sb_key, "Authorization": f"Bearer {sb_key}"}
        # Build verified facts: SEC truth AND present in our financials.
        facts = []  # (ticker, concept, year, value)
        for tk in [t.upper() for t in args.tickers]:
            cik = cikmap.get(tk)
            if not cik:
                continue
            truth = await _sec_truth(client, cik, years)
            rr = await client.get(f"{sb_url}/rest/v1/financials",
                params={"ticker": f"eq.{tk}", "select": "metric_name,period,value_float", "limit": "5000"},
                headers=sbh, timeout=30)
            rows = rr.json() if rr.status_code == 200 else []
            for (concept, yr), tval in truth.items():
                name_re = CONCEPTS[concept]["name_re"]
                present = any(
                    r.get("value_float") is not None and str(yr) in str(r.get("period", ""))
                    and re.search(name_re, (r.get("metric_name") or "").lower())
                    and _matches(float(r["value_float"]), tval)
                    for r in rows
                )
                if present:
                    facts.append((tk, concept, yr, tval))

        print(f"verified facts (in financials): {len(facts)}")
        sem = asyncio.Semaphore(args.concurrency)
        retrieved = answered = errors = 0

        async def probe(tk, concept, yr, val):
            nonlocal retrieved, answered, errors
            q = f"What was {tk}'s {_PHRASE[concept]} in fiscal year {yr}?"
            async with sem:
                d = None
                for attempt in range(3):  # retry transient empty/timeout responses
                    try:
                        resp = await client.post(f"{api}/v1/search",
                            headers={"Content-Type": "application/json", "X-API-Key": api_key},
                            json={"query": q, "filters": {"companies": [tk]},
                                  "options": {"reasoning_depth": "fast", "stream": False}},
                            timeout=120)
                        if resp.status_code == 200 and resp.text.strip():
                            d = resp.json(); break
                    except Exception:
                        pass
                    await asyncio.sleep(3)
                if d is None:
                    errors += 1
                    print(f"  {tk} {concept} {yr}: ERROR (3 tries)"); return
                src_text = " ".join(s.get("text", "") for s in (d.get("sources") or []))
                struct = " ".join(str(x) for x in (d.get("structured_data") or []))
                ans = d.get("answer", "") or ""
                in_ret = _value_in_text(val, src_text + " " + struct)
                in_ans = _value_in_text(val, ans)
                if in_ret:
                    retrieved += 1
                if in_ans:
                    answered += 1
                print(f"  {tk:5} {concept:18} FY{yr}  retrieved={'Y' if in_ret else 'N'} answered={'Y' if in_ans else 'N'}")

        await asyncio.gather(*[probe(*f) for f in facts])

        ok = len(facts) - errors
        d = ok or 1
        print("\n=== Structured-retrieval recall (over SUCCESSFUL probes) ===")
        print(f"  facts={len(facts)}  errors={errors}  scored={ok}")
        print(f"  RETRIEVED (fact in sources/structured): {retrieved}/{ok} = {retrieved/d:.0%}")
        print(f"  ANSWERED  (fact in answer text):        {answered}/{ok} = {answered/d:.0%}")


if __name__ == "__main__":
    asyncio.run(main())
