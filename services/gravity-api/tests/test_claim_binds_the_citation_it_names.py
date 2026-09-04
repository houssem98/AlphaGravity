"""
V2 — a claim must bind against the citation the answer actually pointed at.

The fifth audit's top-ranked finding, and it is right about why it matters: this
is an EDGE, not a field. Every citation in the list can be perfectly valid —
real accession, right issuer, verified status — while the edge

    claim ──[1]──> citation[0]

is wrong. A rig that mutates fields cannot see it, and `_claim_is_bound`
searched every excerpt and never read the bracket.

Measured on `5c4a1a5`:

    answer   "NVIDIA revenue was $130 billion [1]."
    cites[0] "This filing discusses risk factors ... with no revenue figure."
    cites[1] "NVIDIA reported revenue of $130 billion for the fiscal year."
    -> True

The answer cited [1]. The number lives only in [2]. The grader found it anyway
and called the claim grounded.

**Fails open, and that is the whole safety of it.** A sentence naming no marker
searches everything, exactly as before. A marker pointing past the end of the
list searches everything. A marker pointing at an excerpt too short to use
searches everything. Six of seven historical grader bugs in this file came from
over-tightening, and the strict reading — "no marker, no bind" — would rescore
every answer on its formatting rather than its correctness.
"""

from __future__ import annotations

import pytest

from eval.head_to_head.rubric import _claim_is_bound

FOUND = ("NVIDIA reported revenue of $130 billion for the fiscal year then "
         "ended, as filed in its annual report.")
ABSENT = ("This filing discusses competition and risk factors at considerable "
          "length, and states no revenue figure at all.")


# ── V2: the edge is wrong while every field is fine ───────────────────────


def test_the_audits_exact_case():
    """Answer cites [1]; the figure lives only in [2]."""
    assert _claim_is_bound(
        "NVIDIA revenue was $130 billion [1].",
        [{"text": ABSENT}, {"text": FOUND}]) is False


def test_citing_the_right_marker_still_binds():
    assert _claim_is_bound(
        "NVIDIA revenue was $130 billion [2].",
        [{"text": ABSENT}, {"text": FOUND}]) is True


def test_naming_several_markers_binds_on_any_of_them():
    assert _claim_is_bound(
        "NVIDIA revenue was $130 billion [1][2].",
        [{"text": ABSENT}, {"text": FOUND}]) is True


def test_each_sentence_carries_its_own_markers():
    """
    Two claims, two citations, crossed. Neither sentence may borrow the other's
    evidence — which is precisely the edge this fixes.
    """
    answer = ("NVIDIA revenue was $130 billion [1]. "
              "Operating margin was 62 percent [2].")
    cites = [{"text": "NVIDIA operating margin was 62 percent for the year."},
             {"text": FOUND}]
    assert _claim_is_bound(answer, cites) is False


# ── Fails open: the three ways the rule declines to fire ──────────────────


def test_a_sentence_with_no_marker_searches_everything():
    """Unchanged behaviour, and the reason this fix is safe to land."""
    assert _claim_is_bound(
        "NVIDIA revenue was $130 billion.",
        [{"text": ABSENT}, {"text": FOUND}]) is True


def test_a_marker_past_the_end_of_the_list_searches_everything():
    """An out-of-range marker is a broken answer, not evidence of a bad claim."""
    assert _claim_is_bound(
        "NVIDIA revenue was $130 billion [9].",
        [{"text": ABSENT}, {"text": FOUND}]) is True


def test_a_marker_pointing_at_an_unusable_excerpt_searches_everything():
    """
    Excerpts under 20 characters are already dropped as unusable. A marker
    naming one must not turn that into a failed claim.
    """
    assert _claim_is_bound(
        "NVIDIA revenue was $130 billion [1].",
        [{"text": "short"}, {"text": FOUND}]) is True


# ── Everything the function already did, unchanged ────────────────────────


def test_a_single_citation_answer_is_unaffected():
    assert _claim_is_bound(
        "NVIDIA revenue was $130 billion [1].", [{"text": FOUND}]) is True


def test_no_usable_excerpt_is_still_unanswerable():
    assert _claim_is_bound("Revenue was $130 billion [1].",
                           [{"text": "short"}]) is None
    assert _claim_is_bound("Revenue was $130 billion [1].", []) is None


def test_an_answer_asserting_no_figure_is_still_unanswerable():
    assert _claim_is_bound("NVIDIA is a semiconductor company [1].",
                           [{"text": FOUND}]) is None


def test_the_contradiction_rule_still_applies_within_the_cited_excerpt():
    """U3 and V2 compose: the right citation, still contradicting."""
    assert _claim_is_bound(
        "NVIDIA revenue was $130 billion [1].",
        [{"text": "NVIDIA reported revenue of $120 billion for the year."}]
    ) is False


def test_scale_invention_stays_fixed_under_the_cited_excerpt():
    """V1 and V2 compose."""
    assert _claim_is_bound(
        "NVIDIA revenue was $130 billion [1].",
        [{"text": "NVIDIA reported revenue of $130 million for the year."}]
    ) is False
