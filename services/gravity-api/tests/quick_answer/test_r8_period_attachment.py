"""
R8 QA-8 / roadmap §7 — period attachment, on a real comparative table.

`UAL_RESULTS` is verbatim from United's 2026 10-K and prints three fiscal
years side by side, which is how filings actually present results:

    (in millions) 2025 2024 2023
    Operating revenue $ 59,070 $ 57,063 $ 53,717

Every figure in that row is a true figure from the filing. Which YEAR each
belongs to is carried by column position alone, and that is the whole
problem: an answer can quote a real number from the filing and hang it on
the wrong year, and nothing in either layer currently objects.

**V17 — the grader never looks at periods, open since round 6.** The period
machinery in this file (`_period_misattributed`, `_figures_attributed_to`)
feeds the `period_entity` SCORE and is not consulted by `_claim_is_bound`,
so evidence and correctness are decided with the period ignored. Measured:

    $57,063 million in FY2025  (the 2024 column) -> bound
    $53,717 million in FY2025  (the 2023 column) -> bound
    $59,070 million in FY2019  (a year absent
                                from the table)  -> bound

**V31 — production's filing-date union narrows instead of widening.** Layer C
says so itself:

    # The filing date is not a period the passage is *about*, so it can only
    # widen what counts as agreement, never narrow it.

It does the opposite. `_periods` does not read a comparative table's column
headers, so `_periods(source_text)` is EMPTY for the passage above. The union
with the filing date then makes `{(2026, None)}` the only source period,
and `_periods_disagree` flips from "one side names none, no decision" to
"none line up, mismatch". The result is a false conflict on a CORRECT answer:

    $59,070 million in FY2025  (right figure,
                                right year)      -> conflicting

Both are recorded here before either is fixed, because a fix to either
changes what the benchmark or production counts as correct.
"""

from __future__ import annotations

import pytest

from app.core.verification.citation_verdict import (
    _periods, _periods_disagree, column_years, verdict_for_citation,
)
from eval.head_to_head.rubric import _claim_is_bound
from tests.real_sec_fixtures import AFL_JAPAN_OPERATIONS, UAL_RESULTS

CITE = [UAL_RESULTS]


class _Passage:
    """The passage shape `verdict_for_citation` resolves against, carrying the
    real filing date so the V31 path is exercised as production runs it."""

    def __init__(self, text: str):
        self.text = text
        self.ticker = "UAL"
        self.filing_date = "2026-02-05"
        self.chunk_id = "c1"


def _verdict(claim: str):
    return verdict_for_citation(
        {"text": claim, "citation_number": 1, "ticker": "UAL"},
        [_Passage(UAL_RESULTS["text"])],
    )


# ── The fixture is what it claims to be ───────────────────────────────────


def test_the_fixture_is_a_three_year_comparative_table():
    t = UAL_RESULTS["text"]
    assert "2025 2024 2023" in t
    assert "$ 59,070 $ 57,063 $ 53,717" in t


# ── V17 — the grader must not bind a figure to the wrong year ─────────────


@pytest.mark.parametrize("claim,column", [
    ("United operating revenue was $57,063 million in FY2025 [1].", "2024"),
    ("United operating revenue was $53,717 million in FY2025 [1].", "2023"),
])
def test_v17_a_figure_from_another_column_does_not_bind(claim, column):
    """Every digit is real and comes from this table. Only the year is wrong,
    which is the single most reachable way to be wrong about a filing."""
    assert _claim_is_bound(claim, CITE) is False, (
        f"the {column} column's figure bound to an FY2025 claim"
    )


def test_v17_a_year_absent_from_the_table_does_not_bind():
    assert _claim_is_bound(
        "United operating revenue was $59,070 million in FY2019 [1].",
        CITE) is False


def test_v17_the_correct_year_still_binds():
    """The control. A period check that refuses the right answer has replaced
    one failure with a worse one."""
    assert _claim_is_bound(
        "United operating revenue was $59,070 million in FY2025 [1].",
        CITE) is True


def test_v17_a_claim_naming_no_period_is_not_penalised():
    """One-directional, like the currency and metric checks. A sentence that
    states no period is not thereby wrong."""
    assert _claim_is_bound(
        "United operating revenue was $59,070 million [1].", CITE) is True


# ── V31 — the filing date may only widen ──────────────────────────────────


def test_v31_a_correct_answer_is_not_a_period_conflict():
    """Right figure, right year, real passage. Production calls it
    `conflicting` on period grounds."""
    v = _verdict("United operating revenue was $59,070 million in FY2025 [1].")
    assert "period_mismatch" not in v.reasons


def test_v31_the_filing_date_can_still_conflict_on_a_passage_with_no_years():
    """
    PINNED RESIDUE, and a deliberate one. Layer C states in its own comment
    that the filing date `can only widen what counts as agreement, never narrow
    it`, and that is still untrue for a passage naming no year at all: the
    date becomes the only source period and `_periods_disagree` fires on `none
    line up`.

    Reading table column headers closed this for tabular passages, which is
    where filings put their figures. Prose passages with no year token remain
    exposed. The owner chose the column-year fix over the widen-only guard, so
    this is recorded rather than closed.
    """
    claim = _periods("revenue in FY2025")
    filing_only = _periods("2026-02-05")
    assert claim and filing_only
    assert _periods_disagree(claim, filing_only) is True, (
        "V31 residue moved: the filing date can no longer create a conflict "
        "alone. Delete this pin and assert the invariant the comment states."
    )


# ── The cause, measured rather than asserted ──────────────────────────────


def test_v31_periods_reads_a_comparative_table_header():
    """
    The fix. The column years ARE the periods a comparative table is about,
    and no `FY` / `fiscal` / `Q3` token appears anywhere in one.
    """
    assert _periods(UAL_RESULTS["text"]) == {
        (2025, None), (2024, None), (2023, None)}


def test_v31_column_years_are_ordered_and_keep_duplicates():
    """Aflac prints `2025 2024 2025 2024` — a dollar pair then a yen pair. The
    POSITION is what says which column a figure sits in, so the list must not
    be deduplicated or sorted."""
    assert column_years(AFL_JAPAN_OPERATIONS["text"]) == [2025, 2024, 2025, 2024]


@pytest.mark.parametrize("text", [
    "revenue grew from 2023 to 2025",
    "in 2025 revenue rose",
    "the 2025 fiscal year was strong",
])
def test_v31_prose_years_are_not_read_as_columns(text):
    """A run of bare years is a table header. A single year, or years with
    words between them, is prose — and reading those as columns would invent
    periods the passage never declared."""
    assert column_years(text) == []
