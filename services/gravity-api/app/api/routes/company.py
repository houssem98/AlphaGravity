"""
Company intelligence API — thin Supabase-REST reads for the company page.

GET /v1/company/{ticker}/filings — distinct indexed filings (from chunks metadata)

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
