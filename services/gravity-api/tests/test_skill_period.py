"""
Future-period abstention, and the determinism the specification demands.

The defect: asking for an unreported period sometimes abstained and sometimes
answered confidently, because the outcome depended on whether retrieval
happened to surface a passage mentioning the year. The fix is that the verdict
is a pure function of the request, the fiscal calendar, the filed periods and
the date — so the last block of tests runs the same call two hundred times and
asserts one distinct answer.

`as_of` is passed explicitly everywhere. A suite whose verdicts change when the
calendar turns is not testing the rule, it is testing the month.
"""

from __future__ import annotations

from datetime import date

import pytest

from app.core.skills.period import (
    PeriodState,
    RequestedPeriod,
    evaluate,
    fiscal_period_end,
    parse_period,
)

TODAY = date(2026, 8, 29)


# ── Parsing ───────────────────────────────────────────────────────────────


@pytest.mark.parametrize("text,fy,q", [
    ("FY2025", 2025, 0),
    ("fy2025", 2025, 0),
    ("fiscal year 2025", 2025, 0),
    ("in 2025", 2025, 0),
    ("Q3 2025", 2025, 3),
    ("q3 fy2025", 2025, 3),
    ("third quarter 2025", 2025, 3),
    ("Q1", 0, 1),
])
def test_parse_period_reads_year_and_quarter(text, fy, q):
    p = parse_period(text)
    assert p.fiscal_year == fy
    assert p.quarter == q


@pytest.mark.parametrize("text", ["", "latest", "most recent", "current", "revenue"])
def test_a_period_less_request_is_latest_not_an_error(text):
    assert parse_period(text).latest is True


def test_a_named_year_is_never_latest():
    assert parse_period("latest FY2024 figure").latest is False


def test_the_label_round_trips():
    assert parse_period("Q3 2025").label == "FY2025Q3"
    assert parse_period("FY2025").label == "FY2025"
    assert parse_period("").label == "latest"


# ── Fiscal calendars ──────────────────────────────────────────────────────


def test_a_december_filers_year_ends_in_december():
    assert fiscal_period_end(2025, 0, 12) == date(2025, 12, 31)
    assert fiscal_period_end(2025, 1, 12) == date(2025, 3, 31)
    assert fiscal_period_end(2025, 3, 12) == date(2025, 9, 30)


def test_nvidias_fiscal_year_ends_in_january_of_the_named_year():
    """FY2026 ends January 2026 — the case that breaks a calendar-year assumption."""
    assert fiscal_period_end(2026, 0, 1) == date(2026, 1, 31)
    # Q1 FY2026 ends three quarters before that: April 2025.
    assert fiscal_period_end(2026, 1, 1) == date(2025, 4, 30)


def test_apples_september_year_end():
    assert fiscal_period_end(2025, 0, 9) == date(2025, 9, 30)
    assert fiscal_period_end(2025, 1, 9) == date(2024, 12, 31)


def test_a_february_end_is_the_real_last_day():
    assert fiscal_period_end(2024, 0, 2) == date(2024, 2, 29)   # leap
    assert fiscal_period_end(2025, 0, 2) == date(2025, 2, 28)


@pytest.mark.parametrize("fy,q,m", [(0, 0, 12), (2025, 5, 12), (2025, 0, 13), (2025, 0, 0)])
def test_an_unplaceable_period_has_no_end_date(fy, q, m):
    assert fiscal_period_end(fy, q, m) is None


# ── The verdict ───────────────────────────────────────────────────────────


def test_a_future_fiscal_year_must_abstain():
    v = evaluate("FY2028", fy_end_month=12, as_of=TODAY)
    assert v.state is PeriodState.NOT_YET_ENDED
    assert v.must_abstain
    assert "future" in v.reason


def test_a_future_quarter_must_abstain():
    v = evaluate("Q4 2026", fy_end_month=12, as_of=TODAY)
    assert v.state is PeriodState.NOT_YET_ENDED
    assert v.must_abstain


def test_a_quarter_that_has_ended_is_not_future_even_in_the_current_year():
    v = evaluate("Q1 2026", fy_end_month=12, as_of=TODAY)
    assert v.state is not PeriodState.NOT_YET_ENDED


def test_a_period_that_ended_but_was_never_filed_abstains_separately():
    v = evaluate("Q2 2026", fy_end_month=12, reported_periods={(2026, 1)}, as_of=TODAY)
    assert v.state is PeriodState.NOT_YET_FILED
    assert v.must_abstain
    assert "no filing" in v.reason


def test_a_filed_period_is_answerable():
    v = evaluate("Q1 2026", fy_end_month=12, reported_periods={(2026, 1)}, as_of=TODAY)
    assert v.state is PeriodState.REPORTED
    assert not v.must_abstain


def test_unknown_coverage_does_not_claim_a_past_period_is_missing():
    v = evaluate("FY2024", fy_end_month=12, reported_periods=None, as_of=TODAY)
    assert v.state is PeriodState.REPORTED
    assert not v.must_abstain


def test_latest_is_always_answerable_and_never_future():
    for text in ["", "latest", "most recent revenue"]:
        v = evaluate(text, fy_end_month=12, as_of=TODAY)
        assert v.state is PeriodState.REPORTED
        assert not v.must_abstain


def test_the_fiscal_calendar_changes_the_verdict():
    """NVIDIA's FY2027 ends Jan 2027; a December filer's ends Dec 2027."""
    jan = evaluate("FY2027", fy_end_month=1, as_of=date(2027, 3, 1))
    dec = evaluate("FY2027", fy_end_month=12, as_of=date(2027, 3, 1))
    assert jan.state is PeriodState.REPORTED
    assert dec.state is PeriodState.NOT_YET_ENDED


def test_the_boundary_day_itself_is_not_future():
    v = evaluate("FY2026", fy_end_month=12, as_of=date(2026, 12, 31))
    assert v.state is not PeriodState.NOT_YET_ENDED


def test_the_day_before_the_boundary_is_future():
    v = evaluate("FY2026", fy_end_month=12, as_of=date(2026, 12, 30))
    assert v.state is PeriodState.NOT_YET_ENDED


def test_the_verdict_serializes_with_the_abstention_flag():
    d = evaluate("FY2028", fy_end_month=12, as_of=TODAY).as_dict()
    assert d["must_abstain"] is True
    assert d["state"] == "not_yet_ended"
    assert d["period"] == "FY2028"
    assert d["period_end"] == "2028-12-31"


# ── Determinism ───────────────────────────────────────────────────────────


@pytest.mark.parametrize("text", ["FY2028", "Q4 2026", "FY2024", "latest", "Q2 2026"])
def test_two_hundred_runs_give_exactly_one_answer(text):
    seen = {
        evaluate(text, fy_end_month=12, reported_periods={(2026, 1), (2024, 0)},
                 as_of=TODAY).state
        for _ in range(200)
    }
    assert len(seen) == 1


def test_the_same_request_object_reused_is_stable():
    p = RequestedPeriod(fiscal_year=2028, quarter=0, raw="FY2028")
    verdicts = [evaluate(p, fy_end_month=12, as_of=TODAY) for _ in range(50)]
    assert len({v.state for v in verdicts}) == 1
    assert len({v.reason for v in verdicts}) == 1


def test_ordering_of_the_reported_set_cannot_change_the_verdict():
    a = evaluate("Q1 2026", fy_end_month=12,
                 reported_periods={(2026, 1), (2025, 4), (2024, 0)}, as_of=TODAY)
    b = evaluate("Q1 2026", fy_end_month=12,
                 reported_periods={(2024, 0), (2026, 1), (2025, 4)}, as_of=TODAY)
    assert a.state is b.state is PeriodState.REPORTED
