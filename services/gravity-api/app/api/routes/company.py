"""
Company intelligence API — thin Supabase-REST reads for the company page.

GET /v1/company/{ticker}/filings    — distinct indexed filings (from chunks metadata)
GET /v1/company/{ticker}/financials — exact XBRL facts (financials table, document_id xbrl:*)

The old GET /v1/documents list depends on the asyncpg get_db session, which is a
dead stub on this deploy → 500. PostgREST with the service-role key is the
productive path (same as structured_search).
"""

from typing import Any

from fastapi import APIRouter, Depends

from app.api.middleware.auth import require_auth
from app.db import supabase_rest

router = APIRouter()


@router.get("/company/{ticker}/filings")
async def company_filings(
    ticker: str,
    limit: int = 20,
    auth: dict = Depends(require_auth),
):
    """Distinct filings for a ticker, newest first, deduped from chunk metadata."""
    symbol = ticker.upper()
    # PostgREST can't DISTINCT, so the chunk metadata is deduped here. It must be
    # PAGED to do that honestly: `limit=4000` did not fetch 4000 rows, because
    # PostgREST caps a response at 1000 and reports nothing. Measured 2026-09-07 —
    # TSLA held 1998 rows over 9 filings and this endpoint returned 4 of them, GS
    # 2 of 6, LHX 3 of 6, while `total` reported the truncated number as the total.
    #
    # `id` is the tiebreaker: ordering by filing_date alone leaves ties in an
    # arbitrary order, which duplicates or skips rows across page boundaries.
    rows, hit_cap = await supabase_rest.sb_select_all(
        "chunks",
        {"ticker": f"eq.{symbol}", "order": "filing_date.desc.nullslast,id.asc"},
        select="document_id,document_title,filing_type,filing_date",
    )
    # Count chunks per ingest, then collapse duplicate ingests of the same
    # filing (same title = same ticker+form+date) keeping the richest copy.
    by_doc: dict[str, dict[str, Any]] = {}
    for r in rows:
        doc_id = r.get("document_id") or ""
        if not doc_id or doc_id.startswith("xbrl:"):
            continue
        doc = by_doc.get(doc_id)
        if doc is None:
            by_doc[doc_id] = doc = {
                "id": doc_id,
                "ticker": symbol,
                "title": r.get("document_title") or "",
                "filing_type": r.get("filing_type") or "",
                "filing_date": r.get("filing_date"),
                "chunk_count": 0,
                "status": "indexed",
            }
        doc["chunk_count"] += 1
    by_filing: dict[str, dict[str, Any]] = {}
    for doc in by_doc.values():
        key = doc["title"] or doc["id"]
        best = by_filing.get(key)
        if best is None or doc["chunk_count"] > best["chunk_count"]:
            by_filing[key] = doc
    documents = list(by_filing.values())[:limit]
    # `total` is every distinct filing this ticker has, not the number that fit in
    # one page. `truncated` is only ever true if a ticker exceeds the paging cap,
    # in which case `total` IS a floor and says so rather than pretending.
    return {
        "ticker": symbol,
        "documents": documents,
        "total": len(by_filing),
        "truncated": hit_cap,
    }


@router.get("/company/{ticker}/financials")
async def company_financials(
    ticker: str,
    limit: int = 60,
    auth: dict = Depends(require_auth),
):
    """Exact reported figures for a ticker — XBRL-sourced rows only (the one
    exact population in the financials table), newest period first."""
    symbol = ticker.upper()
    # The order is a TOTAL order, and has to be. `period.desc,filing_date.desc`
    # alone leaves every row inside a period tied, so "the newest 80" had no
    # defined answer: the cut lands mid-period and which metrics of that period
    # fall inside it was whatever order Postgres happened to return. Measured
    # 2026-09-07 — all 10 heaviest tickers disagreed with an independent read of
    # the same table, every disagreement inside the boundary period.
    #
    # metric_name orders the pairs; id breaks the remaining tie for tickers that
    # hold duplicate rows per (metric, period) — MMM 376 rows over 366 pairs — so
    # which row wins the dedupe is fixed rather than incidental.
    rows, _hit_cap = await supabase_rest.sb_select_all(
        "financials",
        {
            "ticker": f"eq.{symbol}",
            "document_id": "like.xbrl:*",
            "order": "period.desc,filing_date.desc,metric_name.asc,id.asc",
        },
        # CT2-3 · document_id is selected so the client can attempt an id lookup
        # against /filings. CT2-2 measured what it currently holds — one distinct
        # value per ticker, the literal "xbrl:NVDA" over the ticker's rows — so the
        # lookup resolves nothing today and the client renders the honest null.
        # Shipping it anyway is what makes that fact visible instead of assumed.
        select="metric_name,period,value_float,unit,filing_type,filing_date,document_id",
    )
    # One row per metric+period; later filings restate — keep the newest.
    best: dict[tuple[str, str], dict[str, Any]] = {}
    for r in rows:
        key = (r.get("metric_name") or "", r.get("period") or "")
        if key not in best:
            best[key] = {
                "metric": r.get("metric_name") or "",
                "value": r.get("value_float"),
                "unit": r.get("unit") or "USD",
                "period": r.get("period"),
                "ticker": symbol,
                "filing_type": r.get("filing_type") or "",
                "filing_date": r.get("filing_date"),
                "document_id": r.get("document_id"),
            }
    return {"ticker": symbol, "rows": list(best.values())[:limit], "source": "xbrl"}
