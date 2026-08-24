"""
Which filing wins when several report the same period, and saying so out loud.

A period is not reported once. A quarter appears in its own 10-Q, again as a
comparative column in next year's 10-Q, again inside the 10-K, and — when the
issuer restates — again in an amendment with a *different number*. Measured on
Plug Power's Q1 2019 revenue:

    10-Q    filed 2019-05-08   18,593,000   as originally reported
    10-Q    filed 2020-05-08   21,579,000   comparative column, after revision
    10-K/A  filed 2022-03-14   21,510,000   the restatement

Three values, one period, all genuinely from SEC. Picking one without saying that
the others exist is the failure `FIX_SECFILING.md` §7 calls mandatory to avoid.

**This module deliberately does not change `sec_quarterly`.** That module states
its own policy — "the 10-Q that reported the quarter beats a later restatement" —
and GS-3 pinned derived ratios to it, so silently inverting it would move numbers
nothing in this task asked to move. Instead the conflict is detected here, the
authoritative version is chosen for the exact-fact answer, and the supersession
is carried in the evidence and stated in the passage. The roadmap forbids
*silently* preferring an older filing; it is the silence this removes.

Authority order, most significant first:

1. **Latest filing date.** A restatement supersedes what it restates.
2. **Amended form at the same date.** A 10-Q/A filed alongside a 10-Q is the
   corrected one.
3. **The form that natively covers the period.** A quarter's own 10-Q beats a
   comparative column in a later 10-K when both were filed the same day.
"""

from __future__ import annotations

import structlog

logger = structlog.get_logger()


def is_amendment(form: str) -> bool:
    return (form or "").upper().endswith("/A")


def base_form(form: str) -> str:
    """`10-Q/A` -> `10-Q`."""
    return (form or "").upper().split("/A")[0]


def _native_rank(form: str, want_quarter: bool) -> int:
    """Does this form report the period directly, or carry it as a comparative?"""
    b = base_form(form)
    if want_quarter:
        return 2 if b == "10-Q" else (1 if b == "10-K" else 0)
    return 2 if b == "10-K" else (1 if b == "10-Q" else 0)


def authority_key(point: dict, want_quarter: bool) -> tuple:
    """Sort key — higher is more authoritative."""
    return (
        point.get("filed") or "",
        1 if is_amendment(point.get("form", "")) else 0,
        _native_rank(point.get("form", ""), want_quarter),
    )


def points_for_period(units: dict, start: str, end: str) -> list[dict]:
    """Every reported point covering exactly this span, across all units."""
    out: list[dict] = []
    for unit, points in (units or {}).items():
        for p in points:
            if p.get("start") == start and p.get("end") == end and p.get("val") is not None:
                out.append({**p, "unit": unit})
    return out


def resolve(units: dict, start: str, end: str, want_quarter: bool) -> dict | None:
    """
    The authoritative reading of one period, and what it supersedes.

    Returns `None` when the period is not reported at all. Otherwise a dict with
    the winning point plus:

      `conflict`     — True when filings disagree on the value
      `superseded`   — the other readings, newest first, for the citation
      `restated`     — True when the winner is an amendment or postdates the
                       original that disagreed with it

    A period reported many times with one value is not a conflict; that is just
    the same fact repeated in comparative columns, which is the common case.
    """
    points = points_for_period(units, start, end)
    if not points:
        return None

    ranked = sorted(points, key=lambda p: authority_key(p, want_quarter), reverse=True)
    winner = ranked[0]
    values = {p["val"] for p in points}

    if len(values) == 1:
        return {"point": winner, "conflict": False, "superseded": [], "restated": False}

    others = [p for p in ranked[1:] if p["val"] != winner["val"]]
    logger.info(
        "sec_period_conflict",
        start=start, end=end, values=sorted(values),
        winner_form=winner.get("form"), winner_filed=winner.get("filed"),
    )
    return {
        "point": winner,
        "conflict": True,
        "superseded": others,
        "restated": bool(
            is_amendment(winner.get("form", ""))
            or (others and (winner.get("filed") or "") > (others[0].get("filed") or ""))
        ),
    }


def describe(resolution: dict) -> str:
    """
    One clause naming what was superseded, for the passage the LLM reads.

    Empty when there is nothing to disclose, so the common case stays clean.
    """
    if not resolution or not resolution.get("conflict"):
        return ""
    winner = resolution["point"]
    others = resolution["superseded"]
    if not others:
        return ""
    prior = others[0]
    return (
        f" (restated - this is the {winner.get('form', 'later')} figure filed "
        f"{winner.get('filed', 'later')}; the {prior.get('form', 'earlier')} filed "
        f"{prior.get('filed', 'earlier')} reported {prior['val']:,.0f})"
    )
