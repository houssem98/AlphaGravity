"""
Whether a requested period can have been reported yet — decided, not guessed.

The defect this closes: asking for a fiscal year that has not happened
sometimes produced an abstention and sometimes a confident answer, and which
one you got depended on whether the retriever happened to return a passage
mentioning the year. That is a coin flip wearing a citation.

Eligibility is now a pure function of four inputs and nothing else:

    the requested period
    the registrant's fiscal calendar (fiscal year end month)
    the periods the registrant has actually filed
    the date the question is asked

Same inputs, same verdict, every time — which is what the repeated-run tests
assert. No retrieval result, model output, or ranking can move it.

Three states, and only the first may carry a confident answer:

    REPORTED          the period ended and a filing covering it exists
    NOT_YET_ENDED     the period has not finished; no filing can exist
    NOT_YET_FILED     the period ended, but nothing covering it was filed

`NOT_YET_FILED` is deliberately separate from "no evidence". A quarter that
closed nine days ago is not missing data — the 10-Q is not due yet — and
saying "not reported yet" is a different and more accurate statement than
"this company discloses nothing about it".
"""

from __future__ import annotations

import calendar
import re
from dataclasses import dataclass
from datetime import date
from enum import Enum


class PeriodState(str, Enum):
    REPORTED = "reported"
    NOT_YET_ENDED = "not_yet_ended"
    NOT_YET_FILED = "not_yet_filed"
    UNKNOWN = "unknown"


#: States in which a confident numeric answer must not be generated.
MUST_ABSTAIN = frozenset({PeriodState.NOT_YET_ENDED, PeriodState.NOT_YET_FILED})


@dataclass(frozen=True)
class RequestedPeriod:
    """A parsed period request. `fiscal_year` 0 means "latest"."""

    fiscal_year: int = 0
    quarter: int = 0
    latest: bool = False
    raw: str = ""

    @property
    def label(self) -> str:
        if self.latest or not self.fiscal_year:
            return "latest"
        return f"FY{self.fiscal_year}" + (f"Q{self.quarter}" if self.quarter else "")


_FY_RE = re.compile(r"\b(?:fy|fiscal\s+year\s*|fiscal\s*)?((?:19|20)\d{2})\b", re.I)
_Q_RE = re.compile(r"\bq([1-4])\b", re.I)
_QUARTER_WORD_RE = re.compile(
    r"\b(first|second|third|fourth)\s+quarter\b", re.I
)
_WORD_Q = {"first": 1, "second": 2, "third": 3, "fourth": 4}
_LATEST_RE = re.compile(
    r"\b(latest|most recent|current|last reported|newest)\b", re.I
)


def parse_period(text: str) -> RequestedPeriod:
    """
    The period a question asks for.

    Deliberately conservative: a string naming no year and no quarter is
    `latest`, not an error, because "what is NVIDIA's revenue" is a legitimate
    question. What it will not do is invent a year from context.
    """
    raw = (text or "").strip()
    q = 0
    m = _Q_RE.search(raw)
    if m:
        q = int(m.group(1))
    else:
        w = _QUARTER_WORD_RE.search(raw)
        if w:
            q = _WORD_Q[w.group(1).lower()]

    year = 0
    ym = _FY_RE.search(raw)
    if ym:
        year = int(ym.group(1))

    latest = bool(_LATEST_RE.search(raw)) or (year == 0 and q == 0)
    return RequestedPeriod(fiscal_year=year, quarter=q, latest=latest and year == 0, raw=raw)


def _last_day(year: int, month: int) -> date:
    return date(year, month, calendar.monthrange(year, month)[1])


def fiscal_period_end(fiscal_year: int, quarter: int, fy_end_month: int) -> date | None:
    """
    The calendar date a fiscal period ends on, to month precision.

    A fiscal year is named for the calendar year its END falls in for most
    filers, and month-end is close enough: the question this answers is "has
    this period finished", where a few days either way only matters inside a
    window where the filing does not exist yet anyway — and that window is
    `NOT_YET_FILED`, which also abstains.

    NVIDIA's FY2026 ends in January 2026, so `fy_end_month=1` gives
    2026-01-31. Apple's FY2025 ends in September 2025.
    """
    if not (1 <= fy_end_month <= 12) or fiscal_year <= 0:
        return None
    if not quarter:
        return _last_day(fiscal_year, fy_end_month)
    if not 1 <= quarter <= 4:
        return None
    # Q4 ends when the fiscal year does; each earlier quarter is three months
    # before the next.
    months_before = (4 - quarter) * 3
    m = fy_end_month - months_before
    y = fiscal_year
    while m <= 0:
        m += 12
        y -= 1
    return _last_day(y, m)


@dataclass(frozen=True)
class PeriodVerdict:
    state: PeriodState
    period: RequestedPeriod
    period_end: date | None = None
    reason: str = ""

    @property
    def must_abstain(self) -> bool:
        return self.state in MUST_ABSTAIN

    def as_dict(self) -> dict:
        return {
            "state": self.state.value,
            "period": self.period.label,
            "period_end": self.period_end.isoformat() if self.period_end else "",
            "reason": self.reason,
            "must_abstain": self.must_abstain,
        }


def evaluate(
    requested: RequestedPeriod | str,
    *,
    fy_end_month: int = 12,
    reported_periods: set[tuple[int, int]] | None = None,
    as_of: date | None = None,
) -> PeriodVerdict:
    """
    Whether the requested period can be answered from filings.

    `reported_periods` is the set of `(fiscal_year, quarter)` pairs the
    registrant has actually filed, with `quarter=0` meaning the annual period.
    Passing `None` means "unknown coverage": the period's end date is still
    checked, so a future year abstains, but a past year is not claimed missing
    on the strength of a set nobody supplied.

    `as_of` defaults to today. It is a parameter so the tests are not
    time-bombs — a suite that passes in March and fails in April is not a test.
    """
    p = requested if isinstance(requested, RequestedPeriod) else parse_period(requested)
    today = as_of or date.today()

    if p.latest or not p.fiscal_year:
        # "Latest" is whatever exists; it cannot be in the future.
        return PeriodVerdict(PeriodState.REPORTED, p, None, "latest reported period")

    end = fiscal_period_end(p.fiscal_year, p.quarter, fy_end_month)
    if end is None:
        return PeriodVerdict(PeriodState.UNKNOWN, p, None, "period could not be placed on a calendar")

    if end > today:
        return PeriodVerdict(
            PeriodState.NOT_YET_ENDED, p, end,
            f"{p.label} ends {end.isoformat()}, which is in the future",
        )

    if reported_periods is None:
        return PeriodVerdict(
            PeriodState.REPORTED, p, end, "period has ended; filing coverage not checked"
        )

    if (p.fiscal_year, p.quarter) in reported_periods:
        return PeriodVerdict(PeriodState.REPORTED, p, end, "a filing covers this period")

    return PeriodVerdict(
        PeriodState.NOT_YET_FILED, p, end,
        f"{p.label} ended {end.isoformat()} but no filing covering it has been filed",
    )
