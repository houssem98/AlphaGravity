"""CF-18 + CF-19 gate. The company feature works for registrants the corpus
never ingested, at a bounded storage cost.

Database size is the binding constraint (0.35 of 0.5 GB), so the cost is measured
rather than claimed. Listing filings writes nothing. Fetching a fact writes one
row per metric-period — edgar_search persists what it fetches — and a repeat load
of the same company writes nothing more. Measured 2026-09-09: a cold 8-period
revenue load for CROX wrote 5 rows.

Run from services/gravity-api:
    .venv/Scripts/python.exe ../../docs/company-feature/gates/cf18-19-gate.py
"""
import asyncio
import logging
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

import structlog  # noqa: E402
structlog.configure(wrapper_class=structlog.make_filtering_bound_logger(logging.CRITICAL))

from app.api.routes.company import company_filings, company_trend  # noqa: E402
from app.db import supabase_rest  # noqa: E402

AUTH = {"user_id": "gate", "tier": "unlimited", "api_key": "gate"}
failures = 0


def check(name: str, ok: bool, detail: str = "") -> None:
    global failures
    if not ok:
        failures += 1
    print(f"{'PASS' if ok else 'FAIL'}  {name}" + (f"\n      {detail}" if detail and not ok else ""))


async def row_count(table: str) -> int:
    """Exact row count, via PostgREST's count header.

    The first version of this counted rows for `ticker=__gate_probe__` — a ticker
    that does not exist — so it returned 0 whatever happened and asserted nothing.
    It "proved" the live path cost no storage while `edgar_facts_persisted` was
    writing rows in the logs beside it. A gate that cannot fail is not a gate.
    """
    import httpx
    from app.db.supabase_rest import _cfg, _headers

    url, key = _cfg()
    async with httpx.AsyncClient(timeout=30.0) as c:
        r = await c.get(
            f"{url}/rest/v1/{table}",
            headers=_headers(key, {"Prefer": "count=exact", "Range": "0-0"}),
            params={"select": "ticker"},
        )
    return int(r.headers.get("content-range", "0/0").split("/")[-1])


async def main() -> int:
    if not supabase_rest.configured():
        print("BLOCKED: SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY not set")
        return 2

    # ── CF-18 · filings for any registrant ────────────────────────────────────
    for t in ("LULU", "ANET", "MS", "DUK"):
        r = await company_filings(t, limit=10, auth=AUTH)
        docs = r["documents"]
        check(f"{t}: filings are listed for a ticker the corpus never ingested",
              len(docs) >= 5, f"got {len(docs)}")
        check(f"{t}: the payload says the list came from SEC",
              r.get("source") == "sec", f"source={r.get('source')!r}")
        check(f"{t}: every filing carries a form and a date",
              all(d.get("filing_type") and d.get("filing_date") for d in docs))
        check(f"{t}: unindexed filings say so rather than claiming a chunk count",
              all(d.get("status") == "not_indexed" and d.get("chunk_count") == 0 for d in docs))

    # An ingested ticker must keep its richer local list, not silently switch.
    tsla = await company_filings("TSLA", limit=10, auth=AUTH)
    check("TSLA still answers from the local index",
          tsla.get("source") == "index" and tsla["total"] == 9,
          f"source={tsla.get('source')!r} total={tsla['total']}")

    # ── CF-19 · numbers for any registrant ────────────────────────────────────
    # LULU is absent from `financials` entirely; AAPL is present but holds no
    # revenue row after FY2018 (which is what CF-17 was opened for).
    for t, want in (("LULU", (8.11, 9.62)), ("AAPL", (383.29, 391.04))):
        r = await company_trend(t, metric="revenue", periods="FY2023,FY2024", auth=AUTH)
        got = {p["period"]: p["value"] for p in r["data_points"]}
        billions = tuple(round((got.get(p) or 0) / 1e9, 2) for p in ("FY2023", "FY2024"))
        check(f"{t}: revenue is returned for periods the table cannot serve",
              billions == want, f"got {billions}B, expected {want}B")
        check(f"{t}: no unavailable_reason when values were found",
              r.get("unavailable_reason") is None,
              f"reason={r.get('unavailable_reason')!r}")

    # A bank files no us-gaap Revenue tag at all.
    #
    # This asserted that MS refuses. CF-21 changed what the right answer is: MS
    # does report net income, so the card now shows that rather than nothing. The
    # protection this check existed for is unchanged and is now asserted more
    # precisely — a substitute is never handed back under the requested metric's
    # name — and the refusal case is kept, pointed at a filer that genuinely
    # reports none of the ladder. Two assertions where there was one.
    ms = await company_trend("MS", metric="revenue", periods="FY2023,FY2024", auth=AUTH)
    check("MS gets the metric it does report, never labelled as revenue",
          any(p["value"] is not None for p in ms["data_points"])
          and ms["metric_used"] != "revenue"
          and ms["substituted"] is True
          and ms["metric_requested"] == "revenue",
          f"metric_used={ms['metric_used']!r} substituted={ms['substituted']!r}")

    tfc = await company_trend("TFC", metric="revenue", periods="FY2023,FY2024", auth=AUTH)
    check("a filer reporting none of the ladder still refuses rather than inventing one",
          all(p["value"] is None for p in tfc["data_points"])
          and bool(tfc.get("unavailable_reason")),
          f"reason={tfc.get('unavailable_reason')!r}")

    # ── the constraint that motivated all of it ───────────────────────────────
    #
    # Database size is the binding constraint, so what this costs has to be
    # MEASURED rather than asserted. It is not free: edgar_search persists each
    # fact it fetches, so a company's first trend load writes one row per
    # metric-period it resolves. That is a cache, and it is bounded — the second
    # load of the same company writes nothing — but "no storage" was wrong.
    chunks_before = await row_count("chunks")
    fin_before = await row_count("financials")

    # A ticker whose filings come from SEC: the filings path must write nothing.
    await company_filings("ANET", limit=10, auth=AUTH)
    check("listing filings from SEC writes no rows at all",
          await row_count("chunks") == chunks_before
          and await row_count("financials") == fin_before,
          "the filings path grew a table")

    # A full trend load for a company, twice. The first may write; the second
    # must not, or the cache is not a cache and the cost is unbounded.
    periods = ",".join(f"FY{y}" for y in range(2020, 2028))
    await company_trend("CROX", metric="revenue", periods=periods, auth=AUTH)
    after_first = await row_count("financials")
    await company_trend("CROX", metric="revenue", periods=periods, auth=AUTH)
    after_second = await row_count("financials")

    written = after_first - fin_before
    check("a repeat load of the same company writes nothing",
          after_second == after_first,
          f"second load wrote {after_second - after_first} more rows")
    check("a first load costs at most one row per period asked for",
          written <= 8, f"wrote {written} rows for 8 periods")
    print(f"      first load wrote {written} row(s); repeat wrote "
          f"{after_second - after_first}. financials now {after_second} rows.")

    print(f"\nRESULT {'PASS' if failures == 0 else f'FAIL ({failures})'}")
    return 0 if failures == 0 else 1


if __name__ == "__main__":
    raise SystemExit(asyncio.run(main()))
