"""
U3 — a citation that contradicts the answer must not bind it.

`_claim_is_bound` asked whether an asserted figure appears anywhere in any
cited excerpt. Presence, not support. The fourth audit's example, measured on
unfixed code:

    answer   "NVIDIA revenue was $130 billion."
    excerpt  "NVIDIA's operating expenses were $130 billion while
              revenue was $120 billion."
    -> True

The excerpt says revenue was $120 billion. It is evidence *against* the answer,
and the grader counted it as evidence *for* it, because the number 130 occurs
somewhere in the text.

**The rule implemented here is narrow on purpose.** It does not attempt to
decide which metric owns each number. It asks one question: *does this excerpt
state a different value for the metric the answer named?* A bind is refused only
when the excerpt names that same metric and **none** of the values it associates
with it match. Everything else is unchanged.

That framing survives the case a naive rule would break — an excerpt carrying
two periods of the same metric still binds, because the answer's value is among
those associated with it.

**It fails open, deliberately.** No metric in the answer, no metric in the
excerpt, or a metric named with no nearby figure all behave exactly as before.
Six of seven historical grader bugs in this file came from over-tightening, and
under-firing is the cheaper direction.

The metric vocabulary is production's own (`query_plan._METRIC_RES`) rather than
a new one declared here. Inventing a parallel vocabulary in the grader is what
produced R14, T1 and T2.
"""

from __future__ import annotations

import pytest

from eval.head_to_head.rubric import _claim_is_bound

ANSWER = "NVIDIA revenue was $130 billion."


def _cite(text: str) -> list[dict]:
    return [{"text": text}]


# ── U3: the excerpt contradicts the claim ─────────────────────────────────


def test_the_audits_exact_case():
    excerpt = ("NVIDIA's operating expenses were $130 billion while "
               "revenue was $120 billion in the period.")
    assert _claim_is_bound(ANSWER, _cite(excerpt)) is False


def test_a_contradicting_value_for_the_named_metric_does_not_bind():
    excerpt = ("Total revenue was $120 billion for the fiscal year, as "
               "reported in the consolidated statements of operations.")
    assert _claim_is_bound(ANSWER, _cite(excerpt)) is False


# ── The case a naive rule would break ─────────────────────────────────────


def test_two_periods_of_the_same_metric_still_bind():
    """
    A filing excerpt routinely carries the prior year beside the current one.
    Refusing because SOME revenue figure differs would fail correct answers,
    which is the over-tightening this file has undone six times.
    """
    excerpt = ("Revenue was $120 billion in fiscal 2024 and $130 billion in "
               "fiscal 2025, an increase driven by data centre demand.")
    assert _claim_is_bound(ANSWER, _cite(excerpt)) is True


def test_a_segment_figure_beside_the_total_still_binds():
    excerpt = ("Data centre revenue was $30 billion and total revenue was "
               "$130 billion for the year then ended.")
    assert _claim_is_bound(ANSWER, _cite(excerpt)) is True


# ── Fails open: the three ways the rule declines to fire ──────────────────


def test_an_answer_naming_no_metric_is_unchanged():
    """Nothing to compare against, so behaviour is exactly as before."""
    assert _claim_is_bound("The figure was $130 billion.",
                           _cite("Some total was $130 billion in the period.")) is True


def test_an_excerpt_not_naming_the_metric_is_unchanged():
    excerpt = "The consolidated total was $130 billion for the fiscal year."
    assert _claim_is_bound(ANSWER, _cite(excerpt)) is True


def test_a_metric_named_with_no_figure_beside_it_is_unchanged():
    """
    A known limit, pinned rather than hidden: a figure stated BEFORE its label
    is not associated with it, so this binds. Under-firing is the deliberate
    direction.
    """
    excerpt = "The company reported $130 billion, its highest revenue ever."
    assert _claim_is_bound(ANSWER, _cite(excerpt)) is True


# ── Everything the function already did, unchanged ────────────────────────


def test_a_supporting_excerpt_still_binds():
    excerpt = "Revenue was $130 billion for the fiscal year then ended."
    assert _claim_is_bound(ANSWER, _cite(excerpt)) is True


def test_any_excerpt_may_be_the_one_that_binds():
    """The refusal is per-excerpt; a good citation elsewhere still counts."""
    cites = [{"text": "Revenue was $120 billion in the prior fiscal year."},
             {"text": "Revenue was $130 billion for the fiscal year ended."}]
    assert _claim_is_bound(ANSWER, cites) is True


def test_no_usable_excerpt_is_still_unanswerable():
    assert _claim_is_bound(ANSWER, [{"text": "short"}]) is None
    assert _claim_is_bound(ANSWER, []) is None


def test_an_answer_asserting_no_figure_is_still_unanswerable():
    assert _claim_is_bound(
        "NVIDIA is a semiconductor company.",
        _cite("Revenue was $130 billion for the fiscal year.")) is None


def test_a_derived_rate_is_still_excused_when_its_level_binds():
    """The rate exemption R6 added must survive U3."""
    answer = ("Revenue was $130 billion. That is a 30% increase over the "
              "prior year.")
    excerpt = ("Revenue was $130 billion for the fiscal year then ended, as "
               "reported in the consolidated statements.")
    assert _claim_is_bound(answer, _cite(excerpt)) is True
