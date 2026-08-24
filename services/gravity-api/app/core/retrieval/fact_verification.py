"""
Deterministic checks a financial fact must survive before it is allowed to reach
the LLM as `[EXACT FILING FIGURE]`.

Nothing here asks a model anything. The prefix that `search_pipeline` keys its
answer-anchoring off is a promise that the number came from a filing and means
what the question asked; these functions are what make that promise checkable.

The three traps this is built against are all present in real NVDA data, measured
on the Q3 FY2026 10-Q:

  * **quarterly vs YTD** — the same filing tags a 272-day span at 147,811,000,000
    alongside the 90-day quarter at 57,006,000,000
  * **fiscal vs calendar** — Q3 FY2026 *ends* 2025-10-26, so every calendar-year
    inference about it is wrong
  * **segment vs product line** — Compute & Networking (50,908,000,000) sits 0.6%
    from Data Center (51,215,000,000)

A fact that fails any check is dropped, not downgraded. `UNSUPPORTED` is a
correct answer; a plausible wrong number is not.
"""

from __future__ import annotations

from datetime import date, timedelta

from app.ingestion.sources.sec_quarterly import (
    ANNUAL_MAX_DAYS,
    ANNUAL_MIN_DAYS,
    QUARTER_MAX_DAYS,
    QUARTER_MIN_DAYS,
    assign_period,
)

# Verification outcomes, mirroring the failure states the roadmap requires.
VERIFIED = "verified"
UNSUPPORTED = "unsupported"
CONFLICTING = "conflicting_evidence"


def _parse(d: str) -> date | None:
    try:
        return date.fromisoformat((d or "")[:10])
    except (ValueError, TypeError):
        return None


def verify_period(
    start: str,
    end: str,
    fy_end_month: int,
    want_fy: int | None,
    want_quarter: int | None,
    period_kind: str | None = None,
) -> tuple[bool, list[str]]:
    """
    The span must *be* the period asked for — resolved through the issuer's own
    fiscal calendar, never through calendar-quarter arithmetic.

    `period_kind` is the granularity the *question* asked for ("quarter" or
    "annual"), which is what rejects the year-to-date column sitting in the same
    filing under the same concept. `want_quarter` is the specific quarter, when
    one was named; a quarterly question that names no quarter still gets the
    span check but no equality check.
    """
    reasons: list[str] = []
    d0, d1 = _parse(start), _parse(end)
    if d1 is None:
        return False, ["period end is unparseable"]

    if d0 is None:
        # A balance-sheet instant has no span, so there is nothing for a span or
        # quarter check to contradict. Value and unit checks still apply.
        return True, reasons

    days = (d1 - d0).days
    if period_kind == "quarter" and not QUARTER_MIN_DAYS <= days <= QUARTER_MAX_DAYS:
        return False, [
            f"span is {days} days, not a single quarter "
            f"({QUARTER_MIN_DAYS}-{QUARTER_MAX_DAYS}) — likely a year-to-date column"
        ]
    if period_kind == "annual" and not ANNUAL_MIN_DAYS <= days <= ANNUAL_MAX_DAYS:
        return False, [
            f"span is {days} days, not a full year "
            f"({ANNUAL_MIN_DAYS}-{ANNUAL_MAX_DAYS})"
        ]

    # Same midpoint formula sec_quarterly keys its period assignment off, so the
    # two cannot disagree about which quarter a span belongs to.
    mid = d0 + timedelta(days=days // 2)
    got_fy, got_q = assign_period(mid, fy_end_month)
    if want_fy is not None and got_fy != want_fy:
        reasons.append(f"period falls in FY{got_fy}, not FY{want_fy}")
    if want_quarter is not None and got_q != want_quarter:
        reasons.append(f"period is Q{got_q}, not Q{want_quarter}")
    return (not reasons), reasons


def verify_value(value, unit: str) -> tuple[bool, list[str]]:
    """Value must be a real number in a unit we can state without guessing."""
    try:
        v = float(value)
    except (TypeError, ValueError):
        return False, ["value is not numeric"]
    if v != v or v in (float("inf"), float("-inf")):
        return False, ["value is not finite"]
    if not unit:
        return False, ["value carries no unit"]
    return True, []


def verify_dimension(
    status: str, asked_for_breakdown: bool
) -> tuple[bool, list[str]]:
    """
    A question naming a breakdown must be answered by that breakdown.

    Falling back to the consolidated figure here is the specific failure that
    turns "no answer" into "confident wrong answer", so it is refused.
    """
    if status == "ambiguous":
        return False, ["the named breakdown matches more than one reported line"]
    if asked_for_breakdown and status != "matched":
        return False, ["the filing does not report the breakdown that was asked for"]
    return True, []


def verify_fact(
    *,
    value,
    unit: str,
    start: str,
    end: str,
    fy_end_month: int,
    want_fy: int | None = None,
    want_quarter: int | None = None,
    period_kind: str | None = None,
    dimension_status: str = "consolidated",
    asked_for_breakdown: bool = False,
) -> tuple[str, list[str]]:
    """
    (status, reasons). `VERIFIED` only when every check passes; the reasons are
    what the user is told when it does not.
    """
    reasons: list[str] = []
    for ok, why in (
        verify_value(value, unit),
        verify_period(start, end, fy_end_month, want_fy, want_quarter, period_kind),
        verify_dimension(dimension_status, asked_for_breakdown),
    ):
        if not ok:
            reasons.extend(why)
    return (VERIFIED if not reasons else UNSUPPORTED), reasons
