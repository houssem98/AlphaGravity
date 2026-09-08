"""
Company intelligence API — every surface the company page reads, in one router,
behind one auth dependency.

GET /v1/company/{ticker}/filings    — distinct indexed filings (from chunks metadata)
GET /v1/company/{ticker}/financials — exact XBRL facts (financials table, document_id xbrl:*)
GET /v1/company/{ticker}/trend      — a metric across periods
GET /v1/company/{ticker}/sentiment  — the sentiment skill for this registrant

CF-10 · the last two are new here and delegate to the existing implementations
rather than reimplementing them. They used to be the page's only unauthenticated
calls — `/v1/analytics/longitudinal/{t}` and `/v1/skills/sentiment` declare no
auth dependency at all — so which half of the company page an anonymous visitor
received depended on which router a given surface happened to live in. Those
routes keep working unchanged for their other callers; what changes is that the
company page now has one door with one lock.

The old GET /v1/documents list depends on the asyncpg get_db session, which is a
dead stub on this deploy → 500. PostgREST with the service-role key is the
productive path (same as structured_search).
"""

from typing import Any

from fastapi import APIRouter, Depends, HTTPException, Query
from fastapi.responses import JSONResponse

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


@router.get("/company/{ticker}/trend")
async def company_trend(
    ticker: str,
    metric: str = Query("revenue", description="Metric name, e.g. 'revenue'"),
    periods: str = Query(..., description="Comma-separated periods, e.g. 'FY2024,FY2025'"),
    auth: dict = Depends(require_auth),
):
    """A metric across periods.

    Delegates to the same LongitudinalTracker `/v1/analytics/longitudinal/{t}`
    uses — the point of this route is the auth dependency and the single company
    surface, not a second implementation of the query.

    KNOWN BROKEN (CF-15): the tracker reads `SELECT value FROM financial_statements`
    over the asyncpg session. That table does not exist in this database and that
    session is a dead stub, so every period comes back null with a 200. Moving the
    route does not fix that, and this docstring is here so the next reader does not
    mistake a null series for a company without revenue.
    """
    from app.api.routes.analytics import _get_longitudinal_tracker

    period_list = [p.strip() for p in periods.split(",") if p.strip()]
    if not period_list:
        raise HTTPException(status_code=400, detail="At least one period required")

    series = await _get_longitudinal_tracker().get_metric_series(
        ticker=ticker.upper(), metric_name=metric, periods=period_list,
    )
    return {
        "ticker": series.ticker,
        "metric_name": series.metric_name,
        "display_name": series.display_name,
        "unit": series.unit,
        "trend_direction": series.trend_direction,
        "cagr": series.cagr,
        "mean": series.mean,
        "data_points": [
            {
                "period": dp.period,
                "value": dp.value,
                "yoy_change": dp.yoy_change,
                "qoq_change": dp.qoq_change,
                "is_anomaly": dp.is_anomaly,
                "anomaly_z_score": dp.anomaly_z_score,
            }
            for dp in series.data_points
        ],
    }


@router.get("/company/{ticker}/sentiment")
async def company_sentiment(
    ticker: str,
    period: str = Query("latest"),
    query: str = Query(""),
    auth: dict = Depends(require_auth),
):
    """The sentiment skill for this registrant.

    Delegates to the same skill `/v1/skills/sentiment` runs, and keeps its status
    mapping: an abstention is a 200 carrying its own account of why, because
    "insufficient evidence" and "route not found" are different answers and the
    old cache-read endpoint conflated them.
    """
    from app.api.routes.skills import SKILLS, _HTTP
    from app.core.skills.contract import SkillRequest

    mod = SKILLS.get("sentiment")
    if mod is None:  # pragma: no cover — the registry is a module constant
        raise HTTPException(status_code=500, detail="sentiment skill not registered")

    result = await mod.run(
        SkillRequest(skill="sentiment", entities=[ticker], period=period, query=query)
    )
    return JSONResponse(
        status_code=_HTTP.get(result.status, 200), content=result.as_dict()
    )
