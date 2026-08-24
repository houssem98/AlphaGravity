"""
Write query-time SEC facts back into the corpus, after the answer has gone out.

The point of the live EDGAR channel is that a question can be answered from a
filing nobody indexed. The point of this module is that it only has to happen
once: the verified fact lands in the same Supabase `financials` table
`structured_search` already reads, so the next ask is a local lookup.

Two constraints shape it.

**It must not make the user wait.** `schedule()` fires a task and returns; a
failed write is logged and costs the answer nothing. Persistence is a cache
warm, not a step in the request.

**It must not grow the database carelessly.** `GRAVITY_SEARCH_ROADMAP` R4 caps
Supabase at 450 MB of the 500 MB free tier and halts the loop above it, so this
writes at most `MAX_ROWS_PER_QUERY` rows, only for facts that passed
verification, and upserts on a deterministic id so re-asking the same question
rewrites one row instead of appending another.

No new table and no new database — reusing `financials` is what keeps the
roadmap's nine proposed tables unnecessary.
"""

from __future__ import annotations

import asyncio
import re

import structlog

logger = structlog.get_logger()

# A single question resolves a handful of facts. Anything beyond this is a bulk
# ingestion job wearing a query's clothes, and belongs in the ingestion pipeline.
MAX_ROWS_PER_QUERY = 8

_ID_SAFE = re.compile(r"[^A-Za-z0-9]+")


def _slug(s: str) -> str:
    return _ID_SAFE.sub("", (s or "").title())


def fact_row(result) -> dict | None:
    """
    One `financials` row from a verified EDGAR result, or `None` if the result
    is not an exact filing figure.

    The id follows the convention already in the table — `{TICKER}_{Tag}_{Period}_xbrl`
    — because `structured_search` distinguishes exact XBRL rows from the rest by
    that `_xbrl` suffix. A dimensional fact carries its breakdown in the id so
    Data Center and consolidated revenue cannot collide on one key.
    """
    m = getattr(result, "metadata", None) or {}
    if not m.get("accn") or m.get("value") is None:
        return None

    ticker = (getattr(result, "ticker", "") or m.get("ticker") or "").upper()
    tag = m.get("tag") or ""
    if not ticker or not tag:
        return None

    fy, q = m.get("fiscal_year"), m.get("fiscal_quarter")
    period = f"FY{fy}" + (f"Q{q}" if q else "")
    breakdown = _slug(m.get("row_label", ""))
    parts = [ticker, tag] + ([breakdown] if breakdown else []) + [period, "xbrl"]

    value = float(m["value"])
    return {
        "id": "_".join(parts),
        "ticker": ticker,
        # `company` is deliberately not written: the channel carries a document
        # title ("NVDA 10-Q"), not a registrant name, and a wrong name in the
        # column is worse than an absent one.
        "metric_name": _metric_name(m),
        "period": period,
        "value_float": value,
        # Integer-valued facts are stored without a trailing ".0" — the column is
        # text and existing rows read as plain integers.
        "value_raw": str(int(value)) if value.is_integer() else str(value),
        "unit": m.get("unit", "USD"),
        "filing_type": m.get("form", ""),
        "filing_date": m.get("period_end") or None,
        "document_id": f"edgar:{ticker}:{m.get('accn')}",
        # The existing exact rows put the XBRL concept in `caption`; a dimensional
        # fact appends its member so the two are distinguishable in the table.
        "caption": tag + (f"@{m['row_label']}" if m.get("row_label") else ""),
        "source_section": (
            "xbrl_filing_instance" if m.get("dimensions") else "xbrl_companyconcept"
        ),
    }


def _metric_name(m: dict) -> str:
    """
    The label `structured_search`'s `ilike` patterns match against.

    Two constraints, and they pull in opposite directions. That channel anchors
    revenue synonyms to the *start* of the label (`ilike.Revenue*`) so that
    "revenue" cannot pull cost-of-revenue rows, and it matches breakdown words
    anywhere. A persisted segment fact therefore has to lead with the concept and
    carry its breakdown after it:

        Revenue - Data Center (Data Center revenue)

    Leading with "Data Center revenue" instead would store a correct fact the
    existing selector can never find, which is the same as not persisting it.
    """
    from app.ingestion.sources.sec_xbrl import CONCEPT_LABELS

    tag = m.get("tag", "")
    base = CONCEPT_LABELS.get(tag, "") or tag
    row_label = (m.get("row_label") or "").strip()
    if not row_label:
        return base
    head = base.split(" (", 1)[0].strip() or tag        # "Revenue"
    pretty = row_label.title()                           # "Data Center"
    return f"{head} - {pretty} ({pretty} {head.lower()})"


async def persist(results: list) -> int:
    """Upsert verified facts. Returns rows written; 0 when Supabase is unset."""
    from app.db import supabase_rest

    if not supabase_rest.configured():
        return 0
    rows: list[dict] = []
    seen: set[str] = set()
    for r in results[:MAX_ROWS_PER_QUERY]:
        if (getattr(r, "metadata", {}) or {}).get("derived"):
            # A derived Q4 is arithmetic, not a filed figure. It is fine to show
            # with its derivation stated; it is not fine to store as a fact.
            continue
        row = fact_row(r)
        if row and row["id"] not in seen:
            seen.add(row["id"])
            rows.append(row)
    if not rows:
        return 0
    n = await supabase_rest.sb_insert("financials", rows, on_conflict="id")
    logger.info("edgar_facts_persisted", rows=n, ids=[r["id"] for r in rows][:8])
    return n


def schedule(results: list) -> None:
    """
    Fire-and-forget persistence. Never awaited by the request path — the answer
    ships first, and the corpus catches up behind it.
    """
    if not results:
        return
    try:
        loop = asyncio.get_running_loop()
    except RuntimeError:
        return
    task = loop.create_task(persist(list(results)))
    # Without a reference the task can be garbage-collected mid-flight, and
    # without a done-callback its exception is never retrieved.
    _PENDING.add(task)
    task.add_done_callback(_finish)


_PENDING: set = set()


def _finish(task) -> None:
    _PENDING.discard(task)
    if not task.cancelled() and task.exception() is not None:
        logger.warning("edgar_persist_failed", error=str(task.exception())[:160])
