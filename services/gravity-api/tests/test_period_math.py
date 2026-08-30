"""
Period-safe financial arithmetic.

The bug class under test is a number that is arithmetically correct and
factually meaningless: growth between two different companies, a margin whose
numerator and denominator are seven years apart, a TTM built from three
quarters, a "0% margin" that is really an absent denominator. Every one of
these runs cleanly through `app/core/financial_calculator.py`, which sees only
floats.

So most tests here assert a REFUSAL. A test suite for this module that only
checked the happy path would pass against a module that never refused anything.
"""

from __future__ import annotations

import math

import pytest

from app.core.finance.period_math import (
    Basis, Computed, FiscalPeriod, Quantity, Refusal, cagr,
    calendar_year_overlap, delta, growth, margin, ttm,
)

FY = lambda y, q=0, m=12: FiscalPeriod(y, q, m)  # noqa: E731


def rev(value, year, quarter=0, *, company="cik:1045810", unit="USD",
        metric="revenue", basis=Basis.FLOW, fy_end=12, cite=None):
    return Quantity(value=value, metric=metric, period=FY(year, quarter, fy_end),
                    company_id=company, unit=unit, basis=basis, citation=cite)


def rate(value, year, quarter=0, *, metric="operating_margin", company="cik:1045810"):
    return Quantity(value=value, metric=metric, period=FY(year, quarter),
                    company_id=company, unit="%", basis=Basis.RATE)


# ── FiscalPeriod ──────────────────────────────────────────────────────────


def test_a_january_filers_fiscal_year_is_not_its_calendar_year():
    """NVIDIA's FY2026 ended 2026-01-25. Eleven of its months are calendar 2025."""
    overlap = calendar_year_overlap(FY(2026, 0, 1))
    assert overlap[2025] == 11
    assert overlap[2026] == 1


def test_a_december_filers_fiscal_year_is_its_calendar_year():
    assert calendar_year_overlap(FY(2025, 0, 12)) == {2025: 12}


def test_a_quarter_covers_three_months():
    assert sum(calendar_year_overlap(FY(2025, 2, 12)).values()) == 3


@pytest.mark.parametrize("a,b,expected", [
    (FY(2025), FY(2024), 4),
    (FY(2024), FY(2025), -4),
    (FY(2025, 1), FY(2024, 4), 1),
    (FY(2025, 4), FY(2025, 1), 3),
    (FY(2026, 1), FY(2025, 1), 4),
])
def test_quarter_distance(a, b, expected):
    assert a.distance_in_quarters(b) == expected


def test_annual_and_quarterly_periods_are_not_on_one_timeline():
    assert FY(2025).distance_in_quarters(FY(2025, 3)) is None


def test_two_fiscal_calendars_are_not_comparable():
    assert FY(2025, 0, 1).distance_in_quarters(FY(2025, 0, 12)) is None


def test_offset_wraps_the_year_boundary():
    assert FY(2025, 4).offset(quarters=1) == FY(2026, 1)
    assert FY(2026, 1).offset(quarters=-1) == FY(2025, 4)
    assert FY(2025, 2).offset(years=1) == FY(2026, 2)


def test_a_non_finite_value_is_rejected_at_construction():
    for bad in (float("inf"), float("-inf"), float("nan")):
        with pytest.raises(ValueError):
            rev(bad, 2025)


# ── growth ────────────────────────────────────────────────────────────────


def test_yoy_growth_on_matching_periods():
    out = growth(rev(5_000, 2025), rev(4_000, 2024), kind="yoy")
    assert isinstance(out, Computed)
    assert out.value == pytest.approx(25.0)
    assert out.unit == "%"
    assert out.periods == ("FY2025", "FY2024")


def test_growth_between_two_companies_is_refused():
    """The headline failure: arithmetically fine, factually nothing."""
    out = growth(rev(4_500_000_000, 2025, company="cik:900075"),
                 rev(1_805_695_000, 2025, company="cik:1045810"))
    assert isinstance(out, Refusal)
    assert out.code == "company_mismatch"
    assert out.value is None


def test_growth_between_two_metrics_is_refused():
    out = growth(rev(5_000, 2025, metric="operating_income"),
                 rev(4_000, 2024, metric="revenue"))
    assert isinstance(out, Refusal)
    assert out.code == "metric_mismatch"


def test_growth_across_currencies_is_refused_rather_than_converted():
    out = growth(rev(5_000, 2025, unit="EUR"), rev(4_000, 2024, unit="USD"))
    assert isinstance(out, Refusal)
    assert out.code == "unit_mismatch"


def test_yoy_asked_for_but_periods_a_quarter_apart_is_refused():
    """Asking YoY and silently receiving QoQ is the error `kind` prevents."""
    out = growth(rev(5_000, 2025, 2), rev(4_800, 2025, 1), kind="yoy")
    assert isinstance(out, Refusal)
    assert out.code == "wrong_interval"


def test_qoq_asked_for_but_periods_a_year_apart_is_refused():
    out = growth(rev(5_000, 2025, 2), rev(4_000, 2024, 2), kind="qoq")
    assert isinstance(out, Refusal)
    assert out.code == "wrong_interval"


def test_auto_labels_a_four_quarter_gap_as_yoy():
    out = growth(rev(5_000, 2025, 2), rev(4_000, 2024, 2))
    assert out.operation == "yoy_growth"


def test_auto_labels_a_one_quarter_gap_as_qoq():
    out = growth(rev(5_000, 2025, 2), rev(4_800, 2025, 1))
    assert out.operation == "qoq_growth"


def test_auto_refuses_to_name_a_seven_year_gap():
    """The Copart shape: two real cited figures, no honest label for the gap."""
    out = growth(rev(1_805_695_000, 2025), rev(1_000_000_000, 2018))
    assert isinstance(out, Refusal)
    assert out.code == "unlabelled_interval"


def test_growth_backwards_in_time_is_refused():
    out = growth(rev(4_000, 2024), rev(5_000, 2025), kind="yoy")
    assert isinstance(out, Refusal)
    assert out.code == "not_ordered"


def test_growth_from_zero_is_undefined_not_infinite():
    """`financial_calculator.percentage_change` returns inf here."""
    out = growth(rev(5_000, 2025), rev(0, 2024))
    assert isinstance(out, Refusal)
    assert out.code == "zero_base"
    assert out.value is None


def test_growth_from_a_loss_to_a_profit_carries_a_warning():
    out = growth(rev(500, 2025, metric="net_income"),
                 rev(-100, 2024, metric="net_income"))
    assert isinstance(out, Computed)
    assert "loss to a profit" in out.note


def test_growth_of_a_rate_is_refused_and_points_at_delta():
    out = growth(rate(25.0, 2025), rate(20.0, 2024))
    assert isinstance(out, Refusal)
    assert out.code == "rate_growth"
    assert "percentage points" in out.reason


def test_growth_carries_the_citations_of_both_operands():
    out = growth(rev(5_000, 2025, cite=0), rev(4_000, 2024, cite=3))
    assert out.citations == (0, 3)


# ── margin ────────────────────────────────────────────────────────────────


def test_margin_on_one_period():
    out = margin(rev(1_500, 2025, metric="operating_income"),
                 rev(6_000, 2025), name="operating_margin")
    assert out.value == pytest.approx(25.0)
    assert out.periods == ("FY2025",)


def test_a_margin_across_two_periods_is_refused():
    """FY2025 operating income over FY2018 revenue — the live Copart defect."""
    out = margin(rev(1_696_714_000, 2025, metric="operating_income"),
                 rev(1_805_695_000, 2018))
    assert isinstance(out, Refusal)
    assert out.code == "period_mismatch"
    assert out.value is None


def test_a_zero_denominator_is_undefined_not_zero():
    """`financial_calculator.gross_margin` returns 0.0 for this."""
    out = margin(rev(500, 2025, metric="gross_profit"), rev(0, 2025))
    assert isinstance(out, Refusal)
    assert out.code == "zero_denominator"
    assert out.value is None
    assert "not 0%" in out.reason


def test_a_margin_between_companies_is_refused():
    out = margin(rev(1_500, 2025, metric="operating_income", company="cik:1"),
                 rev(6_000, 2025, company="cik:2"))
    assert isinstance(out, Refusal)
    assert out.code == "company_mismatch"


def test_a_negative_margin_is_computed_not_refused():
    """A loss-making quarter has a real, negative margin."""
    out = margin(rev(-300, 2025, metric="net_income"), rev(6_000, 2025))
    assert isinstance(out, Computed)
    assert out.value == pytest.approx(-5.0)


# ── delta: points, not percent ────────────────────────────────────────────


def test_a_margin_move_is_measured_in_percentage_points():
    """20% -> 25% is +5 pp. Calling it +25% is the classic finance error."""
    out = delta(rate(25.0, 2025), rate(20.0, 2024))
    assert out.value == pytest.approx(5.0)
    assert out.unit == "pp"


def test_the_same_move_in_basis_points():
    out = delta(rate(25.0, 2025), rate(20.0, 2024), in_bps=True)
    assert out.value == pytest.approx(500.0)
    assert out.unit == "bps"


def test_delta_refuses_amounts_so_it_cannot_disguise_growth():
    out = delta(rev(5_000, 2025), rev(4_000, 2024))
    assert isinstance(out, Refusal)
    assert out.code == "not_a_rate"


def test_delta_requires_the_periods_in_order():
    out = delta(rate(20.0, 2024), rate(25.0, 2025))
    assert isinstance(out, Refusal)
    assert out.code == "not_ordered"


# ── cagr ──────────────────────────────────────────────────────────────────


def test_cagr_derives_its_exponent_from_the_periods():
    out = cagr(rev(1_000, 2020), rev(2_000, 2025))
    assert isinstance(out, Computed)
    assert out.value == pytest.approx(14.8698, abs=1e-3)   # 5 years
    assert "5 year" in out.note


def test_cagr_cannot_be_given_a_year_count_that_contradicts_the_periods():
    """There is no `years` parameter to disagree with — by construction."""
    import inspect
    assert "years" not in inspect.signature(cagr).parameters


def test_cagr_over_a_loss_is_refused_not_reported_as_zero_growth():
    """`financial_calculator.cagr` returns 0.0 for a negative endpoint."""
    out = cagr(rev(-500, 2020, metric="net_income"),
               rev(2_000, 2025, metric="net_income"))
    assert isinstance(out, Refusal)
    assert out.code == "non_positive"
    assert out.value is None


def test_cagr_on_quarters_is_refused():
    out = cagr(rev(1_000, 2020, 1), rev(2_000, 2025, 1))
    assert isinstance(out, Refusal)
    assert out.code == "not_annual"


def test_cagr_backwards_is_refused():
    out = cagr(rev(2_000, 2025), rev(1_000, 2020))
    assert isinstance(out, Refusal)
    assert out.code == "not_ordered"


# ── ttm ───────────────────────────────────────────────────────────────────


def _four(start_year=2025, start_q=1, **kw):
    p = FiscalPeriod(start_year, start_q)
    out = []
    for _ in range(4):
        out.append(rev(1_000, p.fiscal_year, p.quarter, **kw))
        p = p.offset(quarters=1)
    return out


def test_ttm_sums_four_consecutive_quarters():
    out = ttm(_four())
    assert isinstance(out, Computed)
    assert out.value == 4_000
    assert out.periods == ("FY2025Q1", "FY2025Q2", "FY2025Q3", "FY2025Q4")


def test_ttm_spanning_a_year_boundary():
    out = ttm(_four(2025, 3))
    assert isinstance(out, Computed)
    assert out.periods == ("FY2025Q3", "FY2025Q4", "FY2026Q1", "FY2026Q2")


def test_ttm_accepts_its_quarters_in_any_order():
    q = _four()
    assert ttm(list(reversed(q))).value == 4_000


@pytest.mark.parametrize("n", [0, 1, 2, 3, 5])
def test_ttm_needs_exactly_four_quarters(n):
    out = ttm(_four()[:n] if n <= 4 else _four() + [rev(1_000, 2026, 2)])
    assert isinstance(out, Refusal)
    assert out.code == "wrong_quarter_count"


def test_ttm_with_a_gap_is_refused_rather_than_labelled_twelve_months():
    q = _four()
    q[2] = rev(1_000, 2026, 2)          # skips FY2025Q3
    out = ttm(q)
    assert isinstance(out, Refusal)
    assert out.code == "non_consecutive"


def test_ttm_of_a_balance_sheet_item_is_refused():
    """Four quarter-end cash balances summed is not any company's cash."""
    out = ttm(_four(metric="cash", basis=Basis.STOCK))
    assert isinstance(out, Refusal)
    assert out.code == "not_a_flow"


def test_ttm_across_companies_is_refused():
    q = _four()
    q[3] = rev(1_000, 2025, 4, company="cik:999")
    out = ttm(q)
    assert isinstance(out, Refusal)
    assert out.code == "company_mismatch"


def test_ttm_of_annual_figures_is_refused():
    out = ttm([rev(1_000, y) for y in (2022, 2023, 2024, 2025)])
    assert isinstance(out, Refusal)
    assert out.code == "not_quarterly"


# ── The invariant that covers every operation ─────────────────────────────


ALL_REFUSALS = [
    growth(rev(1, 2025, company="a"), rev(1, 2024, company="b")),
    growth(rev(1, 2025), rev(0, 2024)),
    growth(rate(1, 2025), rate(2, 2024)),
    margin(rev(1, 2025), rev(0, 2025)),
    margin(rev(1, 2025), rev(2, 2018)),
    delta(rev(1, 2025), rev(2, 2024)),
    cagr(rev(-1, 2020), rev(2, 2025)),
    cagr(rev(1, 2020, 1), rev(2, 2025, 1)),
    ttm([]),
]


@pytest.mark.parametrize("out", ALL_REFUSALS)
def test_no_refusal_ever_carries_a_number(out):
    assert isinstance(out, Refusal)
    assert out.value is None
    assert out.ok is False
    assert out.code and out.reason


@pytest.mark.parametrize("out", ALL_REFUSALS)
def test_every_refusal_explains_itself_in_a_sentence(out):
    assert len(out.reason) > 25
    assert out.reason.strip().endswith((".", "%."))


def test_no_operation_ever_returns_inf_or_nan():
    for out in ALL_REFUSALS:
        assert out.value is None
    for out in (growth(rev(5_000, 2025), rev(4_000, 2024)),
                margin(rev(1, 2025), rev(3, 2025)),
                cagr(rev(1_000, 2020), rev(2_000, 2025)),
                delta(rate(25.0, 2025), rate(20.0, 2024)),
                ttm(_four())):
        assert isinstance(out, Computed)
        assert math.isfinite(out.value)


# ── Overflow ──────────────────────────────────────────────────────────────
#
# Found by the adversarial suite, not by the happy path. Guarding the INPUTS is
# not enough: every operand can be finite and the result still overflow, and
# IEEE hands back `inf` without raising. An `inf` reaching an answer renders as
# a real growth rate, which is the same fabrication as a zero standing in for
# an absent metric.


@pytest.mark.parametrize("op,args", [
    ("growth", (1e308, 1e-308)),
    ("margin", (1e300, 1e-300)),
])
def test_an_overflowing_result_becomes_a_refusal_not_infinity(op, args):
    a, b = args
    fn = {"growth": growth, "margin": margin}[op]
    out = fn(rev(a, 2025), rev(b, 2024 if op == "growth" else 2025))
    assert isinstance(out, Refusal)
    assert out.code == "not_representable"
    assert out.value is None


def test_the_overflow_refusal_explains_itself():
    out = growth(rev(1e308, 2025), rev(1e-308, 2024))
    assert "overflows" in out.reason


def test_ordinary_large_numbers_still_compute():
    """The gate must not refuse real megacap figures."""
    out = growth(rev(400_000_000_000, 2025), rev(380_000_000_000, 2024))
    assert isinstance(out, Computed)
    assert out.value == pytest.approx(5.263, abs=1e-3)


def test_every_operation_routes_through_the_finiteness_gate():
    """A new operation that returns Computed directly would bypass it."""
    import inspect

    from app.core.finance import period_math

    src = inspect.getsource(period_math)
    # Every terminal construction of a Computed must be wrapped.
    assert src.count("return Computed(") == 0, \
        "a Computed is returned without passing through _finite()"
    assert src.count("_finite(Computed(") >= 5
