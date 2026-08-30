"""
Financial arithmetic that knows what its operands are.

`app/core/financial_calculator.py` computes growth, margins and CAGR over bare
floats. Every function there is correct arithmetic and none of them can tell
you whether the two numbers belonged together:

    yoy_growth(4_500_000_000, 1_805_695_000)   ->  149.2

That is a real answer to no question. The operands might be two different
companies, two different metrics, the same metric five years apart, or dollars
against euros — the function cannot see any of it, so it returns a confident
number for all of them. The live Copart run in this repo produced exactly that
shape of error at the retrieval layer: FY2018 revenue beside FY2025 operating
income, both individually cited, together a margin collapse that never
happened.

So this module carries the context into the arithmetic. A `Quantity` knows its
company, metric, period, unit and basis. An operation over two Quantities
either returns a `Computed` — which carries the inputs it used and the periods
it spanned — or a `Refusal` naming what did not line up. There is no third
outcome, and in particular there is no "compute it anyway and hope".

Two rules the older calculator breaks, restated here because they are the
whole point:

**Undefined is not zero.** `gross_margin(revenue=0, cogs=0)` returns `0.0`
there. A 0% gross margin is a claim about a business; an absent denominator is
the absence of a claim. Every operation here returns a Refusal instead, and
`test_a_zero_denominator_is_undefined_not_zero` fails if that changes.

**A margin change is percentage POINTS.** Going from a 20% to a 25% operating
margin is +5 pp, not +25%. Both numbers are computable from the same pair and
only one of them answers "how much did the margin move". `delta()` refuses to
express a rate difference as a percent change unless asked for it by name.
"""

from __future__ import annotations

import math
from dataclasses import dataclass, field, replace
from datetime import date
from enum import Enum

from app.core.skills.period import fiscal_period_end

__all__ = [
    "Basis", "Computed", "FiscalPeriod", "Quantity", "Refusal",
    "calendar_year_overlap", "cagr", "delta", "growth", "margin", "ttm",
]


class Basis(str, Enum):
    """
    What kind of number this is, which decides what may be done to it.

    A `RATE` is already a ratio — a margin, a growth rate, a yield. Two rates
    subtract into percentage points. A `FLOW` accumulates over a period
    (revenue, net income) and may be summed across quarters into a TTM. A
    `STOCK` is a balance at an instant (cash, total debt) and may not: adding
    four quarter-end cash balances produces a number with no meaning.
    """

    FLOW = "flow"
    STOCK = "stock"
    RATE = "rate"
    COUNT = "count"


@dataclass(frozen=True)
class FiscalPeriod:
    """
    One reporting period on one registrant's calendar.

    `quarter == 0` means the full fiscal year. `fy_end_month` is the month the
    fiscal year closes, which is why this is not just a pair of integers:
    NVIDIA's FY2026 ended in January 2026, so its "FY2026" overlaps calendar
    2025 for eleven of its twelve months. A comparison that treats fiscal
    labels as calendar years silently compares different spans of time.
    """

    fiscal_year: int
    quarter: int = 0
    fy_end_month: int = 12

    @property
    def label(self) -> str:
        return f"FY{self.fiscal_year}" + (f"Q{self.quarter}" if self.quarter else "")

    @property
    def is_annual(self) -> bool:
        return self.quarter == 0

    @property
    def end_date(self) -> date | None:
        return fiscal_period_end(self.fiscal_year, self.quarter, self.fy_end_month)

    @property
    def months(self) -> int:
        return 12 if self.is_annual else 3

    def offset(self, *, years: int = 0, quarters: int = 0) -> "FiscalPeriod":
        """The period this many years or quarters away on the same calendar."""
        if quarters and self.is_annual:
            raise ValueError("cannot offset an annual period by quarters")
        if not quarters:
            return replace(self, fiscal_year=self.fiscal_year + years)
        total = (self.fiscal_year * 4 + (self.quarter - 1)) + quarters + years * 4
        return replace(self, fiscal_year=total // 4, quarter=total % 4 + 1)

    def distance_in_quarters(self, other: "FiscalPeriod") -> int | None:
        """Signed quarters from `other` to `self`, or None if incomparable."""
        if self.is_annual != other.is_annual:
            return None
        if self.fy_end_month != other.fy_end_month:
            return None
        if self.is_annual:
            return (self.fiscal_year - other.fiscal_year) * 4
        return ((self.fiscal_year * 4 + self.quarter)
                - (other.fiscal_year * 4 + other.quarter))


def calendar_year_overlap(period: FiscalPeriod) -> dict[int, int]:
    """
    Months of each calendar year this fiscal period covers.

    The honest answer to "what was their 2025 revenue" for a January-ending
    filer is that their FY2026 covers eleven months of calendar 2025 — not
    that FY2025 is calendar 2025. Callers use this to say which calendar span
    a fiscal figure actually describes rather than asserting they are the same.
    """
    end = period.end_date
    if end is None:
        return {}
    months = period.months
    out: dict[int, int] = {}
    y, m = end.year, end.month
    for _ in range(months):
        out[y] = out.get(y, 0) + 1
        m -= 1
        if m == 0:
            y, m = y - 1, 12
    return out


@dataclass(frozen=True)
class Quantity:
    """
    One number with everything needed to know whether it may be combined.

    `citation` is an index into the caller's citation list, carried through so
    a computed figure can name the filings it came from. A Quantity with no
    citation is legal — an intermediate — but `Computed.citations` will then be
    short, and callers that require provenance can check it.
    """

    value: float
    metric: str
    period: FiscalPeriod
    company_id: str = ""
    unit: str = "USD"
    basis: Basis = Basis.FLOW
    citation: int | None = None

    def __post_init__(self) -> None:
        if not math.isfinite(self.value):
            raise ValueError(f"{self.metric}: value must be finite, got {self.value!r}")


@dataclass(frozen=True)
class Refusal:
    """
    Why no number was produced. Never carries a value — not even a zero.

    `code` is stable and machine-checkable; `reason` is the sentence a user
    reads. Both exist because a UI that renders the reason and a test that
    asserts on the code want different things, and formatting drift in the
    prose must not break the test.
    """

    code: str
    reason: str
    ok: bool = field(default=False, init=False)

    @property
    def value(self) -> None:
        return None


@dataclass(frozen=True)
class Computed:
    """A number, its unit, and the evidence and periods behind it."""

    value: float
    unit: str
    operation: str
    inputs: tuple[Quantity, ...] = ()
    periods: tuple[str, ...] = ()
    note: str = ""
    ok: bool = field(default=True, init=False)

    @property
    def citations(self) -> tuple[int, ...]:
        return tuple(q.citation for q in self.inputs if q.citation is not None)


Outcome = Computed | Refusal


def _finite(out: Outcome) -> Outcome:
    """
    The last gate: a result that overflowed is not a result.

    Guarding the *inputs* is not enough. Every operand here can be finite and
    the answer still not be — growth from 1e-308 to 1e308 overflows the
    division, and IEEE hands back `inf` without raising. An `inf` that reaches
    an answer renders as "inf%" if you are lucky and as a real growth rate if
    you are not, which is the same fabrication as a zero standing in for an
    absent metric. Found by the adversarial suite, not by the happy path.
    """
    if isinstance(out, Computed) and not math.isfinite(out.value):
        return Refusal(
            "not_representable",
            f"The {out.operation.replace('_', ' ')} of these figures overflows "
            "double-precision arithmetic, so no finite result exists to report.",
        )
    return out


# ── Compatibility ─────────────────────────────────────────────────────────


def _same_subject(a: Quantity, b: Quantity, *, metric_must_match: bool) -> Refusal | None:
    """The checks every binary operation shares."""
    if a.company_id and b.company_id and a.company_id != b.company_id:
        return Refusal(
            "company_mismatch",
            f"These figures are from different companies ({a.company_id} and "
            f"{b.company_id}); they cannot be combined into one number.",
        )
    if a.unit != b.unit:
        return Refusal(
            "unit_mismatch",
            f"{a.metric} is in {a.unit} and {b.metric} is in {b.unit}. "
            "No conversion is applied, because guessing an exchange rate would "
            "invent precision the filings do not have.",
        )
    if metric_must_match and a.metric != b.metric:
        return Refusal(
            "metric_mismatch",
            f"{a.metric!r} and {b.metric!r} are different metrics; comparing "
            "them as one series would be a growth rate of nothing.",
        )
    if a.period.fy_end_month != b.period.fy_end_month:
        return Refusal(
            "calendar_mismatch",
            "These periods sit on different fiscal calendars, so the labels do "
            "not describe comparable spans of time.",
        )
    return None


# ── Operations ────────────────────────────────────────────────────────────


def growth(current: Quantity, prior: Quantity, *, kind: str = "auto") -> Outcome:
    """
    Growth from `prior` to `current`, as a percentage.

    `kind` is `yoy`, `qoq` or `auto`. It is not decoration: asking for YoY and
    receiving a quarter-over-quarter number is the error this parameter exists
    to make impossible. With `auto` the distance decides, and any distance that
    is neither one year nor one quarter is refused rather than labelled.

    A prior of zero is refused. The percent change from zero is infinite, and
    an infinity rendered into an answer reads as a formatting bug at best and
    as a real growth rate at worst.
    """
    bad = _same_subject(current, prior, metric_must_match=True)
    if bad:
        return bad
    if current.basis is Basis.RATE or prior.basis is Basis.RATE:
        return Refusal(
            "rate_growth",
            f"{current.metric} is a rate. The change between two rates is "
            "measured in percentage points — use delta() — because the percent "
            "change of a percentage is almost never what a reader means.",
        )

    q = current.period.distance_in_quarters(prior.period)
    if q is None:
        return Refusal(
            "incomparable_periods",
            f"{current.period.label} and {prior.period.label} cannot be placed "
            "on one timeline (one is annual and the other quarterly).",
        )
    if q <= 0:
        return Refusal(
            "not_ordered",
            f"{prior.period.label} does not come before {current.period.label}, "
            "so there is no growth from one to the other.",
        )

    expected = {"yoy": 4, "qoq": 1}
    if kind in expected and q != expected[kind]:
        return Refusal(
            "wrong_interval",
            f"{kind.upper()} needs periods {expected[kind]} quarter(s) apart; "
            f"{current.period.label} and {prior.period.label} are {q} apart.",
        )
    if kind == "auto":
        if q == 4:
            kind = "yoy"
        elif q == 1:
            kind = "qoq"
        else:
            return Refusal(
                "unlabelled_interval",
                f"{current.period.label} and {prior.period.label} are {q} "
                "quarters apart, which is neither year-over-year nor "
                "quarter-over-quarter. Name the interval explicitly.",
            )

    if prior.value == 0:
        return Refusal(
            "zero_base",
            f"{prior.metric} was zero in {prior.period.label}. Growth from zero "
            "is undefined, not infinite.",
        )

    pct = ((current.value - prior.value) / abs(prior.value)) * 100.0
    note = ""
    if prior.value < 0 < current.value:
        note = ("The base period was negative, so this percentage describes a "
                "move from a loss to a profit rather than ordinary growth.")
    return _finite(Computed(
        value=pct, unit="%", operation=f"{kind}_growth",
        inputs=(current, prior),
        periods=(current.period.label, prior.period.label), note=note,
    ))


def margin(numerator: Quantity, denominator: Quantity, *, name: str = "") -> Outcome:
    """
    `numerator / denominator` as a percentage, both from the same period.

    The period check is the reason this exists. Operating income from FY2025
    over revenue from FY2018 is arithmetic that runs cleanly and describes
    nothing, and it is what the retrieval layer actually produced before the
    profile was pinned to one period.
    """
    bad = _same_subject(numerator, denominator, metric_must_match=False)
    if bad:
        return bad
    if numerator.period != denominator.period:
        return Refusal(
            "period_mismatch",
            f"{numerator.metric} is from {numerator.period.label} and "
            f"{denominator.metric} is from {denominator.period.label}. A ratio "
            "across two periods is not a margin.",
        )
    if denominator.value == 0:
        return Refusal(
            "zero_denominator",
            f"{denominator.metric} is zero in {denominator.period.label}, so "
            f"{name or 'this margin'} is undefined. It is not 0%.",
        )
    return _finite(Computed(
        value=(numerator.value / denominator.value) * 100.0,
        unit="%", operation=name or "margin",
        inputs=(numerator, denominator),
        periods=(numerator.period.label,),
    ))


def delta(current: Quantity, prior: Quantity, *, in_bps: bool = False) -> Outcome:
    """
    The change between two rates, in percentage points or basis points.

    Margins move in points. A margin going 20% -> 25% is +5 pp; calling it
    "+25% growth" is a different, larger-sounding, and wrong statement, and it
    is the single most common numeric error in finance summaries. Both
    quantities must be rates, so this cannot be used to disguise a growth rate.
    """
    bad = _same_subject(current, prior, metric_must_match=True)
    if bad:
        return bad
    if current.basis is not Basis.RATE or prior.basis is not Basis.RATE:
        return Refusal(
            "not_a_rate",
            f"{current.metric} is not a rate, so the difference between two of "
            "them is an amount, not a number of percentage points.",
        )
    q = current.period.distance_in_quarters(prior.period)
    if q is None or q <= 0:
        return Refusal(
            "not_ordered",
            f"{prior.period.label} does not come before {current.period.label}.",
        )
    diff = current.value - prior.value
    return _finite(Computed(
        value=diff * 100.0 if in_bps else diff,
        unit="bps" if in_bps else "pp",
        operation="basis_point_change" if in_bps else "percentage_point_change",
        inputs=(current, prior),
        periods=(current.period.label, prior.period.label),
    ))


def cagr(first: Quantity, last: Quantity) -> Outcome:
    """
    Compound annual growth between two annual figures.

    The number of years comes from the periods, never from a caller-supplied
    count that can disagree with them. A CAGR whose exponent does not match the
    span it claims to cover is wrong in a way no reader can detect.

    Refused when either endpoint is non-positive: the root of a negative is not
    real, and the older implementation's `return 0.0` for that case reports no
    growth where the truth is that the measure does not apply.
    """
    bad = _same_subject(last, first, metric_must_match=True)
    if bad:
        return bad
    if not (first.period.is_annual and last.period.is_annual):
        return Refusal(
            "not_annual",
            "CAGR is an annual measure; give it two fiscal years.",
        )
    q = last.period.distance_in_quarters(first.period)
    if q is None or q <= 0:
        return Refusal(
            "not_ordered",
            f"{first.period.label} does not come before {last.period.label}.",
        )
    years = q / 4
    if first.value <= 0 or last.value <= 0:
        return Refusal(
            "non_positive",
            f"CAGR needs two positive endpoints; {first.metric} was "
            f"{first.value:,.0f} and {last.value:,.0f}. A compound rate across "
            "a loss is not defined.",
        )
    rate = ((last.value / first.value) ** (1.0 / years) - 1.0) * 100.0
    return _finite(Computed(
        value=rate, unit="%", operation="cagr",
        inputs=(last, first),
        periods=(first.period.label, last.period.label),
        note=f"Compounded over {years:g} year(s).",
    ))


def ttm(quarters: list[Quantity]) -> Outcome:
    """
    Trailing twelve months: exactly four consecutive quarters, summed.

    Every condition here has been a real bug somewhere. Fewer than four
    quarters produces a number smaller than a year that gets compared against
    annual figures. A gap in the sequence produces a nine-month total labelled
    as twelve. And summing a STOCK — four quarter-end cash balances — produces
    a number that is not any company's cash at any time.
    """
    if len(quarters) != 4:
        return Refusal(
            "wrong_quarter_count",
            f"A trailing-twelve-month figure needs exactly 4 quarters; "
            f"{len(quarters)} were supplied.",
        )
    base = quarters[0]
    if base.basis is not Basis.FLOW:
        return Refusal(
            "not_a_flow",
            f"{base.metric} is a {base.basis.value}, which does not accumulate. "
            "Summing four of them produces a figure that describes no point in "
            "time and no span of time.",
        )
    for q in quarters[1:]:
        bad = _same_subject(q, base, metric_must_match=True)
        if bad:
            return bad
        if q.period.is_annual:
            return Refusal("not_quarterly", "TTM is built from quarters.")
    if base.period.is_annual:
        return Refusal("not_quarterly", "TTM is built from quarters.")

    ordered = sorted(quarters, key=lambda x: (x.period.fiscal_year, x.period.quarter))
    for a, b in zip(ordered, ordered[1:]):
        if b.period.distance_in_quarters(a.period) != 1:
            return Refusal(
                "non_consecutive",
                f"{a.period.label} and {b.period.label} are not consecutive, so "
                "these four quarters do not cover twelve months.",
            )
    return _finite(Computed(
        value=sum(q.value for q in ordered), unit=base.unit, operation="ttm",
        inputs=tuple(ordered),
        periods=tuple(q.period.label for q in ordered),
        note=f"Trailing twelve months, {ordered[0].period.label} through "
             f"{ordered[-1].period.label}.",
    ))
