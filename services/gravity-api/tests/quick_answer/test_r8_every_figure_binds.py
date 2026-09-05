"""
R8 QA-10 / roadmap §5, §14 — what a sentence asserts.

**This is NOT the whole of QA-10, and this file does not claim to be.** The row
asks for decomposition into atomic claims each carrying entity, metric, value,
currency, unit, scale, period, scope and segment. That is a rewrite of
`_claim_is_bound`'s shape and does not fit one loop; the row's own text says to
say so rather than half-build it.

What this file closes is the specific defect the row exists because of — the
T9 caveat this repository has carried since round 4 — which turned out to have
a clean rule behind it rather than needing the full decomposition.

**V38 — `_binds` asked whether ANY asserted figure was found.** So a sentence
stating one real figure and one fabricated one bound on the strength of the
real one. Measured on United's real comparative table, before the fix:

    "$59,070 million in FY2025 and $57,063 million in FY2024"   -> True   (both real)
    "$59,070 million in FY2025 and $99,999 million in FY2024"   -> True   (half invented)
    "$99,999 million in FY2025 and $57,063 million in FY2024"   -> True   (HEADLINE invented)
    "$11,111 million in FY2025 and $99,999 million in FY2024"   -> False

The third line is the one that matters: the figure a reader takes away is
fabricated, and the sentence bound because the comparative beside it was true.

The rule is that a sentence asserting N figures asserts all N. That is a
statement about meaning, which is what §5 asks for — a fix made of punctuation
would be the wrong shape for it. `_asserted_split` already does the work that
makes it safe: years are not levels, percentages are rates, and a restatement
of one quantity at two scales collapses to a single value.

Rates are deliberately NOT required. They were merged into the level set
because the old check asked for ANY match, so adding them could only help;
requiring them would demand that a growth rate appear literally in the filing.
A rate is a statement about two figures rather than a figure the source states.
"""

from __future__ import annotations

import pytest

from eval.head_to_head.rubric import _asserted_split, _claim_is_bound
from tests.real_sec_fixtures import AFL_JAPAN_OPERATIONS, LYV_DEFERRED, UAL_RESULTS

CITE = [UAL_RESULTS]


# ── V38 — every asserted figure must be found ─────────────────────────────


def test_v38_both_figures_true_still_binds():
    assert _claim_is_bound(
        "United operating revenue was $59,070 million in FY2025 and "
        "$57,063 million in FY2024 [1].", CITE) is True


@pytest.mark.parametrize("claim,which", [
    ("United operating revenue was $59,070 million in FY2025 and "
     "$99,999 million in FY2024 [1].", "the comparative is invented"),
    ("United operating revenue was $99,999 million in FY2025 and "
     "$57,063 million in FY2024 [1].", "the HEADLINE is invented"),
])
def test_v38_one_fabricated_figure_refuses_the_sentence(claim, which):
    """Both bound before the fix. The second is the one that costs a reader
    something: the figure they take away is the fabricated one."""
    assert _claim_is_bound(claim, CITE) is False, which


def test_v38_a_single_true_figure_is_unaffected():
    assert _claim_is_bound(
        "United operating revenue was $59,070 million in FY2025 [1].",
        CITE) is True


# ── The three things that make the rule safe ──────────────────────────────


def test_a_restatement_at_two_scales_is_one_assertion():
    """`$59.07 billion ($59,070 million)` is one quantity written twice. If
    `_asserted_split` returned two values this rule would demand the source
    contain both spellings."""
    levels, _ = _asserted_split(
        "Revenue was $59.07 billion ($59,070 million) in fiscal 2025.")
    assert len(levels) == 1
    assert _claim_is_bound(
        "United operating revenue was $59.07 billion ($59,070 million) in "
        "FY2025 [1].", CITE) is True


def test_a_year_is_not_an_asserted_figure():
    """`in FY2025` must not become a value that has to be found in the table,
    or every dated sentence would refuse."""
    levels, _ = _asserted_split(
        "Operating revenue reached $59,070 million in the year ended "
        "December 31, 2025.")
    assert levels == {59_070_000_000.0}


def test_a_growth_rate_is_not_required_to_appear_in_the_filing():
    """
    The regression this rule introduced on its first attempt, and the reason
    rates are separated rather than merged. A percentage is a statement ABOUT
    two figures; demanding a bare `4` in the source would refuse a correct
    sentence.
    """
    assert _claim_is_bound(
        "United operating revenue was $59,070 million in FY2025, up 4% [1].",
        CITE) is True


def test_a_rate_cannot_rescue_a_fabricated_level():
    """The other direction. Separating rates must not let one stand in for a
    figure that is simply wrong."""
    assert _claim_is_bound(
        "United operating revenue was $99,999 million in FY2025, up 4% [1].",
        CITE) is False


# ── The earlier rounds' fixtures still bind ───────────────────────────────


@pytest.mark.parametrize("claim,cite", [
    ("Aflac Japan net earned premiums were ¥1,009 billion in 2025 [1].",
     AFL_JAPAN_OPERATIONS),
    ("Aflac Japan net earned premiums were $6,744 million in 2025 [1].",
     AFL_JAPAN_OPERATIONS),
    ("Live Nation deferred revenue was $3,582,835 thousand [1].",
     LYV_DEFERRED),
])
def test_the_rounds_earlier_fixtures_are_unaffected(claim, cite):
    assert _claim_is_bound(claim, [cite]) is True


# ── QA-13: the `_all_grounded` half, isolated ─────────────────────────────


def test_v38_all_grounded_decides_when_the_column_path_abstains():
    """
    R8 QA-13. The theatre audit reverted `_all_grounded` to ANY and this file
    still passed, because V38's other half — the column verdict — also requires
    every value and was carrying the fixture cases on its own. A guard that
    only fails when BOTH halves are reverted isolates neither.

    This claim names no period, so `years` is empty, the column path is skipped
    entirely, and `_all_grounded` is the only thing that can refuse it.
    """
    assert _claim_is_bound(
        "Live Nation deferred revenue was $3,582,835 thousand and "
        "$9,999,999 thousand [1].", [LYV_DEFERRED]) is False
    assert _claim_is_bound(
        "Live Nation deferred revenue was $3,582,835 thousand [1].",
        [LYV_DEFERRED]) is True
