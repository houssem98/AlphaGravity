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

import re
from typing import Any

import structlog
from fastapi import APIRouter, Depends, HTTPException, Query
from fastapi.responses import JSONResponse

from app.api.middleware.auth import require_auth
from app.db import supabase_rest

logger = structlog.get_logger()
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

    # CF-18 · the local index covers 39 tickers. Every other registrant used to
    # get an empty list that read as "this company has filed nothing", which is
    # never true of a company with a ticker. SEC lists them all, and reading that
    # list costs no storage — the binding constraint here is database size, not
    # SEC's rate limit.
    if not documents:
        live, error = await _filings_from_sec(symbol, limit)
        if live:
            return {
                "ticker": symbol,
                "documents": live,
                "total": len(live),
                "truncated": False,
                "source": "sec",
                "unavailable_reason": None,
            }
        # No filings AND a reason we could not get them. Returning the empty
        # index list here would say "this company has filed nothing", which is
        # never true of a registrant and is exactly the confusion the fallback
        # was added to remove.
        if error:
            return {
                "ticker": symbol,
                "documents": [],
                "total": 0,
                "truncated": False,
                "source": "unavailable",
                "unavailable_reason": error,
            }

    # `total` is every distinct filing this ticker has, not the number that fit in
    # one page. `truncated` is only ever true if a ticker exceeds the paging cap,
    # in which case `total` IS a floor and says so rather than pretending.
    return {
        "ticker": symbol,
        "documents": documents,
        "total": len(by_filing),
        "truncated": hit_cap,
        "source": "index",
        "unavailable_reason": None,
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

    CF-15 · the tracker now reads the exact-XBRL `financials` rows first. It used
    to go straight to `SELECT value FROM financial_statements` over the asyncpg
    session — a table that does not exist here, over a session that is a dead stub
    — and swallow the failure per period, so every period came back null with a
    200 and the chart had never drawn a point.

    A series with nothing in it now says WHY, because "we cannot look that metric
    up" and "this company reported no such period" are different answers and an
    empty chart renders them identically.
    """
    from app.api.routes.analytics import _get_longitudinal_tracker
    from app.core.analytics.longitudinal_tracker import METRIC_ALIASES, resolve_metric

    period_list = [p.strip() for p in periods.split(",") if p.strip()]
    if not period_list:
        raise HTTPException(status_code=400, detail="At least one period required")

    series = await _get_longitudinal_tracker().get_metric_series(
        ticker=ticker.upper(), metric_name=metric, periods=period_list,
    )

    unavailable_reason = None
    if not any(dp.value is not None for dp in series.data_points):
        if resolve_metric(metric) is None:
            unavailable_reason = (
                f"No exact figure is stored under the name {metric!r}. "
                f"Known metrics: {', '.join(sorted(METRIC_ALIASES))}."
            )
        else:
            unavailable_reason = (
                f"{ticker.upper()} has no reported {metric} for "
                f"{', '.join(period_list)} in the exact-XBRL rows."
            )

    return {
        "unavailable_reason": unavailable_reason,
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


# ─── CF-18 · filings for any registrant ───────────────────────────────────────
#
# The list above is built from `chunks`, which covers 39 tickers. That is an
# ingestion limit, not a data limit: SEC's submissions API names every filing a
# registrant has ever made, and the corpus does not need to hold any of it. The
# same asymmetry `edgar_text_search` already closed for prose.
#
# Nothing here is indexed, so this costs no database storage — which is the
# binding constraint (0.35 of 0.5 GB in use).

_LISTED_FORMS = ("10-K", "10-K/A", "10-Q", "10-Q/A", "8-K", "20-F", "40-F", "DEF 14A")


async def _filings_from_sec(
    symbol: str, limit: int,
) -> tuple[list[dict[str, Any]], str | None]:
    """Every recent filing SEC lists for a ticker, and why the list is empty.

    Returns (documents, error). An error is NOT an empty list: "SEC lists no
    filings for this registrant" and "we could not ask SEC" are different facts,
    and the first version of this function returned None for both — which the
    route rendered as a company with no filings. That is the same conflation
    CT-7 exists to prevent, reintroduced by the fallback meant to fix coverage.

    Documents carry the same shape the chunk-derived list returns, with
    `chunk_count` 0 and `status` "not_indexed": the filing exists, its prose is
    not in the local index, and neither fact is guessed.
    """
    import asyncio

    from app.core.retrieval.edgar_search import EdgarSearch
    from app.core.retrieval.edgar_text_search import SUBMISSIONS_URL
    from app.core.skills import entity as entity_layer

    try:
        resolved = await entity_layer.resolve(symbol)
        cik = getattr(resolved, "cik", None)
    except Exception as e:  # noqa: BLE001
        logger.warning("sec_entity_resolve_failed", ticker=symbol, error_type=type(e).__name__)
        return [], f"Could not resolve {symbol} against SEC's registrant index."
    if not cik:
        return [], f"{symbol} does not resolve to an SEC registrant."

    # SEC rate-limits at 10 requests/second and `_get_json` raises rather than
    # retrying. One retry, because a throttle is expected traffic here, not an
    # anomaly — and because swallowing it is what produced a silent empty list.
    data = None
    last: Exception | None = None
    for attempt in range(2):
        try:
            data = await EdgarSearch()._get_json(SUBMISSIONS_URL.format(cik=int(cik)))
            last = None
            break
        except Exception as e:  # noqa: BLE001
            last = e
            if attempt == 0:
                await asyncio.sleep(0.5)
    if last is not None:
        logger.warning("sec_filings_fetch_failed", ticker=symbol, error_type=type(last).__name__)
        return [], (
            f"SEC did not answer for {symbol} ({type(last).__name__}). "
            "The filings exist; this list could not be fetched."
        )

    recent = ((data or {}).get("filings") or {}).get("recent") or {}
    rows = list(zip(
        recent.get("form") or [],
        recent.get("accessionNumber") or [],
        recent.get("filingDate") or [],
        recent.get("primaryDocument") or [],
    ))
    out: list[dict[str, Any]] = []
    for form, accn, filed, doc in rows:
        if form not in _LISTED_FORMS:
            continue
        out.append({
            "id": accn,
            "ticker": symbol,
            "title": f"{symbol} {form} {filed}",
            "filing_type": form,
            "filing_date": filed,
            "chunk_count": 0,
            "status": "not_indexed",
            "accession": accn,
            "primary_document": doc,
        })
        if len(out) >= limit:
            break
    return out, None


# ─── CF-24 · verify a ticker before the page loads it ─────────────────────────
#
# A mistyped ticker used to look identical to a company with nothing to show:
# every surface returned empty and the page rendered a full, blank profile of
# nothing. "APPL" is not Apple, and the page should say so before it fetches.
#
# The entity resolver already handles NAMES well — "lululemon" resolves to LULU,
# "Coca Cola" to KO with COKE and CCEP as candidates — across all ~10,400 SEC
# registrants. What it does not handle is a mistyped TICKER: measured 2026-09-09,
# "APPL" and "micrsoft" both return UNKNOWN with no candidates. So a symbol-level
# near-miss search runs after it, over SEC's whole ticker file rather than the
# 500-symbol S&P list the Research Grid checks against.


def _edit_distance(a: str, b: str, cap: int = 2) -> int:
    """Levenshtein, abandoned once it cannot come in under `cap`."""
    if abs(len(a) - len(b)) > cap:
        return cap + 1
    prev = list(range(len(b) + 1))
    for i, ca in enumerate(a, 1):
        cur = [i] + [0] * len(b)
        for j, cb in enumerate(b, 1):
            cur[j] = min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (ca != cb))
        if min(cur) > cap:
            return cap + 1
        prev = cur
    return prev[-1]


async def _near_symbols(query: str, limit: int = 5) -> list[dict[str, str]]:
    """Tickers within edit distance 2 of the query, closest first."""
    from app.core.retrieval.edgar_search import EdgarSearch

    q = query.strip().upper()
    if not q:
        return []
    try:
        es = EdgarSearch()
        await es._load_maps()
        symbols = es._ticker_map
        issuers = es._issuer_by_ticker
    except Exception as e:  # noqa: BLE001
        logger.warning("ticker_suggest_failed", error_type=type(e).__name__)
        return []

    # Both matchers always run, and each symbol keeps its BEST score. Running
    # them in sequence and stopping at the first hit ranked by the wrong thing:
    # "teslla" is edit distance 2 from a dozen four-letter symbols, so TSLA was
    # buried behind ELLA and ESLA on an alphabetical tiebreak — while the issuer
    # name "TESLA" is distance 1 and unambiguous.
    best: dict[str, int] = {}
    # Which symbols the NAME matcher also reached. At equal edit distance that is
    # the stronger signal: "APPL" is one edit from both AAPI and AAPL, and only
    # AAPL is also one edit from its issuer's name. Without this the right answer
    # loses an alphabetical coin toss.
    name_confirmed: set[str] = set()

    # A mistyped SYMBOL, compared against the symbol. Only for inputs short
    # enough to be one — "micrsoft" is not a near-miss of any 4-letter ticker.
    if len(q) <= 6:
        for sym in symbols:
            d = _edit_distance(q, sym)
            if d <= 2 and d < best.get(sym, 99):
                best[sym] = d

    # A mistyped NAME, compared against the issuer's first word — which is what
    # people actually mistype. The rest of a legal name ("CORP", "INC",
    # "athletica inc.") is noise for this purpose.
    if len(q) >= 4:
        cap = 2 if len(q) > 6 else 1
        for sym, name in issuers.items():
            # Punctuation has to go before comparing. "Tesla, Inc." yields the
            # head "TESLA," which is two edits from "TESLLA" rather than one, and
            # "Amazon.com, Inc." yields "AMAZON.COM," — both far enough away to
            # lose to unrelated four-letter symbols on a tie.
            head = re.sub(r"[^A-Z0-9]", "", (name or "").strip().upper().split(" ")[0])
            if len(head) < 4:
                continue
            d = _edit_distance(q, head, cap=cap)
            if d <= cap:
                name_confirmed.add(sym)
                if d < best.get(sym, 99):
                    best[sym] = d

    # Ties are common and head-word distance cannot break them: "APPL" is one
    # edit from both AAPL and AAPI, and BOTH issuers begin with the word "Apple"
    # — Apple Inc. and Apple iSports Group. Distance to the FULL name does
    # separate them (APPLEINC is 4 away, APPLEISPORTSGROUPINC is 17), and it
    # prefers the plainer, likelier registrant without needing a popularity list.
    def full_name_gap(sym: str) -> int:
        full = re.sub(r"[^A-Z0-9]", "", (issuers.get(sym) or "").upper())
        return _edit_distance(q, full, cap=64) if full else 99

    scored = [
        (d, 0 if sym in name_confirmed else 1, full_name_gap(sym), sym)
        for sym, d in best.items()
    ]
    scored.sort()
    return [
        {"ticker": sym, "name": issuers.get(sym, ""), "distance": str(d)}
        for d, _, _, sym in scored[:limit]
    ]


@router.get("/company/resolve")
async def company_resolve(
    q: str = Query(..., min_length=1, description="A ticker, or a company name"),
    auth: dict = Depends(require_auth),
):
    """What company `q` names, and what to do when it names none.

    Never guesses on the caller's behalf. A confident resolution is returned with
    the registrant's legal name so the reader can confirm it is the company they
    meant; anything less comes back as suggestions to choose from.
    """
    from app.core.skills import entity as entity_layer

    text = q.strip()
    try:
        ent = await entity_layer.resolve(text)
    except Exception as e:  # noqa: BLE001
        logger.warning("resolve_failed", q=text[:40], error_type=type(e).__name__)
        return {"query": text, "status": "error", "ticker": None,
                "reason": f"Could not reach SEC's registrant index ({type(e).__name__}).",
                "suggestions": []}

    ticker = getattr(ent, "ticker", None)
    status = str(getattr(ent, "status", "")).split(".")[-1].lower()
    if ticker and status == "resolved":
        return {
            "query": text,
            "status": "resolved",
            "ticker": ticker,
            "legal_name": getattr(ent, "legal_name", "") or getattr(ent, "display_name", ""),
            "cik": getattr(ent, "cik", None),
            "confidence": getattr(ent, "confidence", None),
            "match_type": getattr(ent, "match_type", None),
            # A name can legitimately match several registrants — "Coca Cola"
            # names KO, COKE and CCEP. Offering them is not hedging; picking one
            # silently would be.
            "suggestions": [
                {"ticker": getattr(c, "ticker", ""), "name": getattr(c, "name", "") or getattr(c, "legal_name", "")}
                for c in (getattr(ent, "candidates", None) or [])
            ][:5],
            "reason": None,
        }

    near = await _near_symbols(text)
    return {
        "query": text,
        "status": "unknown",
        "ticker": None,
        "legal_name": None,
        "suggestions": near,
        "reason": (
            f"No SEC registrant matches {text!r}."
            + (f" Did you mean {near[0]['ticker']}?" if near else
               " Check the symbol, or search by company name.")
        ),
    }
