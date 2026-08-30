"""
The finance eval, in-process, as a build gate.

Same three assertions as the skill-coverage gate, for the same reason: a golden
suite that only checks its own score cannot tell a fix from a deletion, and
deleting cases is the cheapest way to turn it green. The floors below rise when
cases are added and must never be lowered to pass.
"""

from __future__ import annotations

import json
from pathlib import Path

import pytest

from eval.finance_quick_answer import run_eval

MIN_CASES = 56
MIN_PLAN = 30
MIN_CALC = 19
MIN_SCOPE = 7
REQUIRED_REFUSALS = {
    "period_mismatch", "company_mismatch", "zero_base", "zero_denominator",
    "rate_growth", "unlabelled_interval", "non_positive", "not_ordered",
    "unit_mismatch", "not_a_rate",
}


def _spec() -> dict:
    return json.loads(Path(run_eval.CASES).read_text(encoding="utf-8"))


@pytest.fixture(scope="module")
def rows():
    spec = _spec()
    out = []
    for case in spec["cases"]:
        kind = case["kind"]
        if kind == "plan":
            failures, over = run_eval._grade_plan(case), False
        elif kind == "calc":
            failures, over = run_eval._grade_calc(case)
        else:
            failures, over = run_eval._grade_scope(case)
        out.append({"id": case["id"], "kind": kind, "failures": failures,
                    "over": over})
    return out


def test_every_case_passes(rows):
    failed = [r for r in rows if r["failures"]]
    assert not failed, "\n".join(
        f"{r['id']}: {'; '.join(r['failures'])}" for r in failed
    )


def test_no_case_produced_false_confidence(rows):
    assert [r["id"] for r in rows if r["over"]] == []


def test_the_suite_has_not_shrunk(rows):
    assert len(rows) >= MIN_CASES
    counts = {k: sum(1 for r in rows if r["kind"] == k)
              for k in ("plan", "calc", "scope")}
    assert counts["plan"] >= MIN_PLAN
    assert counts["calc"] >= MIN_CALC
    assert counts["scope"] >= MIN_SCOPE


def test_every_refusal_class_is_still_exercised():
    """
    A refusal nobody tests is a refusal that can be deleted unnoticed.

    These ten are the ways a finance computation can be arithmetically valid
    and factually meaningless. Dropping any one of them from the suite would
    leave the code free to start answering it with a number.
    """
    codes = {c.get("expect_refusal") for c in _spec()["cases"]}
    assert REQUIRED_REFUSALS <= codes, REQUIRED_REFUSALS - codes


def test_the_exhaustiveness_gate_is_still_tested_from_both_sides():
    """One case must reach EXHAUSTIVE and several must be blocked from it."""
    statuses = [c.get("expect_status") for c in _spec()["cases"]
                if c["kind"] == "scope"]
    assert "confirmed_exhaustive" in statuses
    assert statuses.count("confirmed_partial") >= 3
    assert "insufficient_evidence" in statuses
