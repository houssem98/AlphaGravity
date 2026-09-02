"""
The calculator pre-pass must refuse operands it cannot vouch for.

Found by the live benchmark, run 3:

    yoy_growth(current=2026.0, prior_year=10.0) = 20160.0
    -> "NVIDIA's revenue grew 20,160% year over year in fiscal 2026"

2026 was the fiscal YEAR, scraped out of prose by a regex that takes any number
it finds. The result was then injected into the prompt under the heading
"Deterministic Calculation Result" with the instruction "Use this verified
result in your answer. Do not recompute." The model did as it was told.

This is the exact failure `period_math.py` was built to prevent, arriving
through a path that never had typed quantities to check. The guard here works
with floats alone, so it can only do the negative half of the job: recognise
pairs that CANNOT be a real comparison and refuse them.

The asymmetry is deliberate and is asserted below. A false refusal costs an
injected convenience. A false acceptance costs a fabricated figure presented to
a user as verified.
"""

from __future__ import annotations

import pytest

from app.core.finance.calc_guard import looks_like_a_year, plausible_operand_pair


# ── Years are not figures ─────────────────────────────────────────────────


@pytest.mark.parametrize("year", [1900, 1999, 2018, 2024, 2025, 2026, 2031, 2100])
def test_a_four_digit_year_is_recognised(year):
    assert looks_like_a_year(year)


@pytest.mark.parametrize("value", [
    1899, 2101, 0, 1, 42, 416161, 4646958000, 215938000000,
    2025.4,          # a figure that happens to sit in the year range
    -2025,           # a negative cannot be a year
])
def test_a_figure_is_not_mistaken_for_a_year(value):
    assert not looks_like_a_year(value)


@pytest.mark.parametrize("junk", [None, "", object(), [], {}])
def test_non_numbers_do_not_raise(junk):
    assert looks_like_a_year(junk) is False


def test_a_year_written_as_a_string_is_still_caught():
    """
    Safer than the alternative. Nothing in the pipeline passes a string today,
    but if something ever does, treating "2026" as a year refuses a bad
    calculation whereas treating it as junk would let one through.
    """
    assert looks_like_a_year("2026")
    assert not looks_like_a_year("416161")


# ── The exact failure from the benchmark ──────────────────────────────────


def test_the_nvidia_case_that_produced_twenty_thousand_percent_is_refused():
    """The regression this module exists for."""
    assert not plausible_operand_pair(2026.0, 10.0, "yoy_growth")


def test_a_year_in_either_position_is_refused():
    assert not plausible_operand_pair(2026.0, 130497000000.0, "yoy_growth")
    assert not plausible_operand_pair(215938000000.0, 2025.0, "yoy_growth")


# ── Real comparisons still pass ───────────────────────────────────────────


@pytest.mark.parametrize("cur,pri", [
    (416161000000, 391035000000),    # Apple FY2025 vs FY2024, +6.4%
    (215938000000, 130497000000),    # NVIDIA FY2026 vs FY2025, +65%
    (5496389000, 5814810000),        # Old Dominion, a decline
    (4646958000, 4236823000),        # Copart
    (100, 50),                       # a doubling
    (50, 100),                       # a halving
])
def test_a_real_year_over_year_pair_is_accepted(cur, pri):
    assert plausible_operand_pair(cur, pri, "yoy_growth")


def test_a_genuinely_large_but_believable_jump_is_accepted():
    """NVIDIA's 65% year was extraordinary and must not be refused."""
    assert plausible_operand_pair(215938000000, 130497000000, "yoy_growth")


# ── The pairs that cannot be one metric in two periods ────────────────────


def test_a_hundredfold_jump_between_periods_is_refused():
    assert not plausible_operand_pair(1_000_000_000, 1_000_000, "yoy_growth")


def test_a_hundredfold_collapse_is_refused():
    assert not plausible_operand_pair(1_000_000, 1_000_000_000, "yoy_growth")


def test_a_sign_flip_is_refused_for_a_growth_calculation():
    """
    A loss becoming a profit is real, but the percentage describing it is not a
    growth rate — and two unattributed regex hits are not the evidence for that
    story.
    """
    assert not plausible_operand_pair(500, -100, "yoy_growth")
    assert not plausible_operand_pair(-500, 100, "yoy_growth")


@pytest.mark.parametrize("calc", ["yoy_growth", "qoq_growth",
                                  "percentage_change", "cagr"])
def test_a_zero_operand_is_refused_for_every_growth_calculation(calc):
    """`financial_calculator.percentage_change` returns `inf` for this."""
    assert not plausible_operand_pair(100, 0, calc)
    assert not plausible_operand_pair(0, 100, calc)


# ── Margins legitimately mix magnitudes ───────────────────────────────────


@pytest.mark.parametrize("calc", ["gross_margin", "operating_margin",
                                  "net_margin", "pe_ratio"])
def test_a_margin_is_not_held_to_the_period_ratio_test(calc):
    """Operating income over revenue is a 10x gap and entirely normal."""
    assert plausible_operand_pair(1_500_000_000, 6_000_000_000, calc)
    assert plausible_operand_pair(300_000_000, 6_000_000_000, calc)


def test_a_margin_still_refuses_a_year_and_a_zero():
    assert not plausible_operand_pair(2026, 6_000_000_000, "gross_margin")
    assert not plausible_operand_pair(1_500, 0, "gross_margin")


# ── The asymmetry, stated as a test ───────────────────────────────────────


def test_the_guard_is_conservative_by_design():
    """
    It cannot confirm a pair is right — that needs a metric and a period, which
    is what `period_math.Quantity` carries and a regex hit does not. It can only
    reject the impossible ones, and this test records that as the intent rather
    than leaving it as an accident.
    """
    # Two unrelated but similarly-sized figures pass, and that is expected:
    assert plausible_operand_pair(4_000_000_000, 5_000_000_000, "yoy_growth")
    # What must never pass is the shape that produced the 20,160%:
    assert not plausible_operand_pair(2026, 10, "yoy_growth")


def test_non_numeric_operands_are_refused_rather_than_raising():
    for bad in (None, "x", object()):
        assert plausible_operand_pair(bad, 100, "yoy_growth") is False
        assert plausible_operand_pair(100, bad, "yoy_growth") is False


# ── The pipeline actually uses it ─────────────────────────────────────────


def test_the_pipeline_filters_years_out_of_the_candidate_numbers():
    import inspect

    from app.core import search_pipeline

    src = inspect.getsource(search_pipeline.SearchPipeline.search)
    assert "calc_guard.looks_like_a_year" in src


def test_the_pipeline_gates_the_calculation_on_plausible_operands():
    import inspect

    from app.core import search_pipeline

    src = inspect.getsource(search_pipeline.SearchPipeline.search)
    assert "calc_guard.plausible_operand_pair" in src


def test_the_injected_block_no_longer_calls_an_unattributed_result_verified():
    """
    "Use this verified result. Do not recompute." is what made the model report
    a scraped fiscal year as a growth rate.
    """
    import inspect

    from app.core import search_pipeline

    src = inspect.getsource(search_pipeline.SearchPipeline.search)
    assert "Use this verified result" not in src
    assert "NOT period- or metric-verified" in src


def test_a_refusal_is_logged_rather_than_silent():
    """
    Without this, "the guard is working" and "the pre-pass never ran" look
    identical in the logs — which is the same invisibility that let a 2s
    timeout and a 20,160% growth rate both hide in plain sight.
    """
    import inspect

    from app.core import search_pipeline

    src = inspect.getsource(search_pipeline.SearchPipeline.search)
    assert "calculator_refused" in src
    i = src.index("calculator_refused")
    window = src[max(0, i - 400):i + 300]
    assert "calc_type" in window and "operands" in window


def test_the_injection_and_the_refusal_are_mutually_exclusive():
    """One path or the other, never both, never neither."""
    import inspect

    from app.core import search_pipeline

    src = inspect.getsource(search_pipeline.SearchPipeline.search)
    assert "_calc_ok = len(uniq) >= 2 and calc_guard.plausible_operand_pair(" in src
    assert "if not _calc_ok:" in src
    assert "if _calc_ok:" in src
