"""
V1 — a figure that states its own magnitude keeps it.

The worst defect five audits have produced, and none of them found it. Measured
on `5c4a1a5`:

    _matches(130e9, "revenue was $130 million")             -> True
    _asserts(130e9, "Revenue was $130 million.")            -> True
    _asserts(416161e6, "Net sales were $416,161 thousand.") -> True

    score_answer(expect_value=130e9, "NVIDIA revenue was $130 million [1].")
        correctness = 1.0
        evidence    = 1.0

**An answer wrong by a factor of one thousand scored perfect on both graded
mechanical dimensions.** `_matches` is upstream of `correctness` (30 points) and
of every evidence bind, so this is not a permissive grader — it is a grader
returning the wrong answer about the most heavily weighted thing it measures.

The mechanism. `numbers_in` emits the bare reading beside the scaled one, so
`"$130 million"` yields `{130000000.0, 130.0}`. `_matches` then tries the scale
multipliers `(1e3, 1e6, 1e9)` against every reading, and `130.0 * 1e9` matches
an expected of `130e9`.

**The multiplier loop is not the bug and must survive.** It exists for a real
case: a filing states `"416,161"` in a table denominated in millions, against an
expected recorded in base units. A bare number legitimately carries no magnitude
and may be scaled. A number that already said `million` did not.

So the rule is: **an explicit magnitude is a fact about the figure, not a
starting point for search.**
"""

from __future__ import annotations

import pytest

from eval.head_to_head.rubric import _asserts, _matches, score_answer


# ── V1: a stated magnitude may not be overridden ──────────────────────────


@pytest.mark.parametrize("text", [
    "revenue was $130 million",
    "revenue was $130 thousand",
    "revenue was $130 k",
    "revenue was $130m",
])
def test_a_smaller_stated_magnitude_does_not_match_a_larger_expected(text):
    assert _matches(130e9, text) is False


@pytest.mark.parametrize("text", [
    "revenue was $130 billion",
    "revenue was $130 trillion",
])
def test_a_larger_stated_magnitude_does_not_match_a_smaller_expected(text):
    assert _matches(130e6, text) is False


def test_the_audits_exact_thousandfold_case():
    assert _asserts(130e9, "Revenue was $130 million.") is False


def test_a_thousandfold_wrong_answer_no_longer_scores_correct():
    """The scorecard, end to end. This is what the defect actually cost."""
    case = {"id": "t", "expect_value": 130e9,
            "expect_entity_tokens": ["nvidia"]}
    card = score_answer(
        case, "NVIDIA revenue was $130 million [1].",
        citations=[{"source_class": "sec_filing", "issuer": "NVIDIA CORP",
                    "text": "NVIDIA reported revenue of $130 million for the "
                            "fiscal year then ended."}])
    assert card.scores["correctness"] == 0.0, card.notes.get("correctness")


# ── The case the multiplier loop exists for, which must survive ───────────


def test_a_bare_figure_may_still_be_scaled():
    """
    `"416,161"` in a table denominated in millions, against an expected in base
    units. A bare number carries no magnitude of its own, so scaling it is
    reading it rather than inventing it.
    """
    assert _matches(416161e6, "Net sales were 416,161 for the period") is True


def test_a_bare_figure_scales_at_every_supported_magnitude():
    assert _matches(130e3, "the figure was 130") is True
    assert _matches(130e6, "the figure was 130") is True
    assert _matches(130e9, "the figure was 130") is True


def test_an_explicit_magnitude_still_matches_at_its_own_magnitude():
    assert _matches(416161e6, "Net sales were $416,161 million") is True
    assert _matches(130e9, "revenue was $130 billion") is True
    assert _matches(130e6, "revenue was $130 million") is True


def test_an_explicit_magnitude_still_matches_its_bare_reading():
    """
    `"$416,161 million"` against an expected of `416161` — the case recorded in
    millions rather than base units. The bare reading stays available; what it
    loses is the right to be multiplied further.
    """
    assert _matches(416161, "Net sales were $416,161 million") is True


def test_tolerance_still_applies_within_a_magnitude():
    assert _matches(130.4e9, "revenue was $130.5 billion") is True


def test_a_negative_reading_survives():
    """The sign handling `numbers_in` does must not be lost."""
    assert _matches(-5.48, "margin declined 5.48%") is True


def test_zero_still_behaves():
    assert _matches(0, "the balance was 0") is True
    assert _matches(0, "the balance was 5") is False
