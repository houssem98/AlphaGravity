"""
V14 — a table that declares its scale must constrain what its bare figures mean.

The sixth audit's P1, and it is right. V1 stopped the grader inventing a
magnitude for a figure that stated one. It did not stop the grader inventing a
magnitude for a bare figure sitting under a header that already declared it.

Measured on `d029f59`, against the real United Airlines fixture:

    answer   "United operating revenue was $59.07 million [1]."
    evidence "(in millions) 2025 2024 2023 Operating revenue $ 59,070 ..."

    correctness = 0.0      <- correct: the answer's explicit unit is wrong
    evidence    = 1.0      <- false: the filing does not support $59.07 million

The benchmark reported **"wrong answer, fully supported by the filing"**, which
is a materially false evidence measurement rather than a lenient one.

The mechanism. `59,070` in that table is bare, so `_matches` is allowed to try
every scale — and `59,070 x 1e3` is `59.07e6`, which is exactly what the wrong
answer claimed. The multiplier search is necessary for bare figures and must
stay. What was missing is that **the table already said which scale applies**,
and the grader threw that away: the declaration sits at the head of the excerpt
while the metric's span begins at the metric's own name.

So the fix is not another restriction on the multiplier. It is reading a fact
the text already states.
"""

from __future__ import annotations

import pytest

from eval.head_to_head.rubric import _claim_is_bound, score_answer
from tests.real_sec_fixtures import LYV_DEFERRED, UAL_RESULTS

CASE = {"id": "t", "expect_value": 59_070e6,
        "expect_entity_tokens": ["united airlines"]}


# ── V14: the declared scale is binding on bare figures ────────────────────


def test_the_audits_exact_case():
    """A thousand-fold-wrong claim must not be reported as supported."""
    assert _claim_is_bound(
        "United operating revenue was $59.07 million [1].",
        [UAL_RESULTS]) is False


def test_the_scorecard_no_longer_says_wrong_but_supported():
    card = score_answer(
        CASE, "United operating revenue was $59.07 million [1].",
        citations=[UAL_RESULTS])
    assert card.scores["correctness"] == 0.0
    assert card.scores["evidence"] != 1.0, (
        "the answer is wrong by a factor of a thousand and the evidence "
        "dimension still called it fully supported"
    )


@pytest.mark.parametrize("claim", [
    "United operating revenue was $59.07 billion [1].",   # correct
    "United operating revenue was $59,070 million [1].",  # correct, face value
])
def test_a_correct_reading_of_a_millions_table_still_binds(claim):
    assert _claim_is_bound(claim, [UAL_RESULTS]) is True


@pytest.mark.parametrize("claim", [
    "United operating revenue was $59.07 thousand [1].",
    "United operating revenue was $59,070 billion [1].",
    "United operating revenue was $59,070 thousand [1].",
])
def test_every_other_reading_of_the_same_figure_is_refused(claim):
    assert _claim_is_bound(claim, [UAL_RESULTS]) is False


def test_a_thousands_table_binds_at_thousands_and_not_at_millions():
    """
    Live Nation reports `(in thousands)`. `3,582,835` is $3.58 billion, and a
    claim of $3.58 trillion must not bind against it.
    """
    assert _claim_is_bound(
        "Deferred revenue was $3,582,835 thousand [1].",
        [LYV_DEFERRED]) is True
    assert _claim_is_bound(
        "Deferred revenue was $3,582,835 million [1].",
        [LYV_DEFERRED]) is False


# ── The multiplier search must survive where nothing is declared ──────────


def test_a_bare_figure_with_no_declared_scale_still_searches():
    """
    The case the multiplier loop exists for. An excerpt stating no scale gives
    the grader nothing to constrain with, and refusing there would be
    over-tightening — the direction this file has undone six times.
    """
    undeclared = [{"text": "Total revenue for the fiscal year was 59,070 "
                           "as reported in the consolidated statements."}]
    assert _claim_is_bound(
        "Revenue was $59.07 billion [1].", undeclared) is True
    assert _claim_is_bound(
        "Revenue was $59.07 million [1].", undeclared) is True


def test_an_explicit_figure_in_the_excerpt_is_unaffected_by_the_header():
    """
    A figure carrying its own unit outranks the table header, because it said
    what it is. V1's rule, unchanged by V14.
    """
    mixed = [{"text": "(in millions) Revenue 59,070. Separately, the company "
                      "paid a dividend of $2.5 billion during the year."}]
    assert _claim_is_bound("The dividend was $2.5 billion [1].", mixed) is True


def test_the_real_fixtures_still_bind_their_own_correct_figures():
    """Nothing in V14 may break the real-filing bindings V13 established."""
    assert _claim_is_bound(
        "United operating revenue was $59,070 million [1].",
        [UAL_RESULTS]) is True
    assert _claim_is_bound(
        "United operating income was $4,713 million [1].",
        [UAL_RESULTS]) is True
