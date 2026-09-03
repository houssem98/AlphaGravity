"""L7 / R8 — the period dimension scores proximity where it means attachment.

**The roadmap's stated test case is falsified, and the defect is real anyway.**

R8 was written as: *"Apple revenue was $416.161B" for a case asking FY2025 must
not score full period marks purely because no competing year appears.* Measured,
that answer scores **0.0**, not full marks — `score_answer` only asks
`_period_misattributed` about a token that is `present` in the reply at all, and
an answer naming no period fails that first test. So the example does not
reproduce.

The hole is one step in. `_period_misattributed` walks the figure sentences and
returns False — *not* misattributed — as soon as it meets one that names no
year, on the reasoning that "the reply may be carrying the period from its
neighbour". That reasoning is sound for a scoping preamble. It is not sound when
the token is already spoken for:

    "FY2025 guidance was $400,000 million. Actual revenue was $130,497 million."

FY2025 is attached to the GUIDANCE figure. The revenue sentence names no period,
so the walk stops and the answer takes full attachment marks — while nothing in
the reply ties $130,497 million to FY2025. Presence near a token is not
attachment to it, and this dimension exists to tell those apart.

**The narrow rule.** A figureless sentence carrying the token still scopes the
answer, exactly as before — "FY2025 guidance was withdrawn. Revenue was
$130,497 million." keeps its 1.0. What changes is only the case where every
sentence naming the token also carries a figure, and none of those figures is
the one the answer asserts: then the token is attached elsewhere, and an
unyeared figure sentence is not inheriting a period from its neighbour, it is
competing with one.

This is the same discipline L5 and L6 needed. The file has undone six grader
bugs caused by tightening past the data, so the guards below pin every shape
that must keep scoring 1.0.
"""

from __future__ import annotations

from eval.head_to_head.rubric import score_answer

CASE = {"id": "t", "expect_value": 130497.0, "expect_period_tokens": ["FY2025"]}
CITES = [{"text": "Revenue for fiscal year 2025 was $130,497 million as reported.",
          "source_class": "SEC_EVIDENCE"}]


def _period(answer: str) -> float | None:
    return score_answer(CASE, answer, citations=CITES).scores.get("period_entity")


# ── the defect ────────────────────────────────────────────────────────────


def test_a_token_attached_to_a_different_figure_is_not_attachment():
    answer = ("FY2025 guidance was $400,000 million. "
              "Actual revenue was $130,497 million.")

    assert _period(answer) != 1.0, (
        "the reply took full period marks while FY2025 was attached to the "
        "guidance figure and nothing tied the stated revenue to it"
    )


def test_the_roadmaps_example_was_already_penalised():
    """Recorded so the falsification is not re-litigated.

    R8's stated case scores 0.0 because the token is absent entirely, which is
    a different mechanism from the one R8 describes.
    """
    assert _period("Apple revenue was $416,161 million.") == 0.0


# ── the guards: every shape that must keep its 1.0 ────────────────────────


def test_the_token_in_the_same_sentence_still_scores_full():
    assert _period("FY2025 revenue was $130,497 million.") == 1.0


def test_a_figureless_scoping_preamble_still_scores_full():
    """The leniency the docstring defends: carrying the period from a neighbour."""
    assert _period("FY2025 guidance was withdrawn. "
                   "Revenue was $130,497 million.") == 1.0


def test_a_figureless_trailing_scope_still_scores_full():
    assert _period("Revenue was $130,497 million. This covers FY2025.") == 1.0


def test_a_colon_preamble_still_scores_full():
    assert _period("For FY2025: revenue was $130,497 million.") == 1.0


def test_a_prior_year_comparison_in_the_same_sentence_still_scores_full():
    """Two periods, one sentence, the expected one attached. Must not fire."""
    assert _period("In FY2025 revenue was $130,497 million, up from "
                   "$60,922 million in FY2024.") == 1.0


def test_the_expected_figure_named_with_its_token_beats_a_competing_sentence():
    """A competing figure elsewhere is harmless once the real one is attached."""
    assert _period("FY2024 revenue was $60,922 million. "
                   "FY2025 revenue was $130,497 million.") == 1.0


def test_an_outright_misattribution_is_still_caught():
    """Unchanged from before: the case the dimension already handled."""
    assert _period("In FY2024 Apple revenue was $130,497 million. "
                   "FY2025 data follows.") == 0.0
