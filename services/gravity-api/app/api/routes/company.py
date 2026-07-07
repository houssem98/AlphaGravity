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
    # ponytail: PostgREST can't DISTINCT — pull a capped page of chunk metadata
    # and dedupe server-side. Move to a SQL RPC if per-ticker chunk counts grow.
    rows = await supabase_rest.sb_select(
        "chunks",
        {"ticker": f"eq.{symbol}", "order": "filing_date.desc.nullslast"},
        select="document_id,document_title,filing_type,filing_date",
        limit=4000,
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
    return {"ticker": symbol, "documents": documents, "total": len(by_filing)}


@router.get("/company/{ticker}/financials")
async def company_financials(
    ticker: str,
    limit: int = 60,
    auth: dict = Depends(require_auth),
):
    """Exact reported figures for a ticker — XBRL-sourced rows only (the one
    exact population in the financials table), newest period first."""
    symbol = ticker.upper()
    rows = await supabase_rest.sb_select(
        "financials",
        {
            "ticker": f"eq.{symbol}",
            "document_id": "like.xbrl:*",
            "order": "period.desc,filing_date.desc",
        },
        select="metric_name,period,value_float,unit,filing_type,filing_date",
        limit=max(limit * 3, 120),
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
            }
    return {"ticker": symbol, "rows": list(best.values())[:limit], "source": "xbrl"}
