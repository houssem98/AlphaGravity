"""L8 / D10 — period/entity scored token presence, not attachment.

The dimension is 10 points for getting the period and entity right. It was
scored as `token.lower() in low` over the whole reply, so a reply that states
the figure for the WRONG year and mentions the right year anywhere else scored
a full 1.0 on the dimension whose entire job is catching that.

`_figures_attributed_to` in the same file already established sentence scope as
the honest granularity for exactly this question, and says why: a figure beside
a period is being offered as that period's, while one in another sentence is
context. The abstention branch used it; this dimension did not.

The rule implemented, stated so it can be argued with:

  an expected period token is a miss when the reply asserts a figure and every
  sentence carrying an asserted figure names a DIFFERENT period and never the
  expected one.

It fires only on a positive competing period. A figure sentence naming no
period at all is left alone rather than punished — the reply may well be
attaching the period from the previous sentence, and this file's history is
mostly grader bugs created by tightening past what the text can support.

Entity attachment is NOT strengthened here, and the ledger says so. Deciding
that a figure sentence names the wrong COMPANY needs a company vocabulary this
grader does not have; `forbid_tokens` remains the mechanism. Inventing a
penalty the data cannot support is the failure mode L6 was warned about.
"""

from __future__ import annotations

import json
from pathlib import Path

from eval.head_to_head.rubric import score_answer

CASES = json.loads(
    (Path(__file__).resolve().parents[1] / "eval" / "head_to_head" /
     "cases.json").read_text(encoding="utf-8")
)
BY_ID = {c["id"]: c for c in CASES["cases"]}
SEC = [{"source_class": "sec_filing"}]

CASE = "aapl-fy2025-revenue"   # period ['2025'], entity ['apple']
TRUE = "$416,161 million"


def _pe(answer: str) -> float:
    return score_answer(BY_ID[CASE], answer, citations=SEC).scores["period_entity"]


# ── the defect ────────────────────────────────────────────────────────────


def test_a_figure_attached_to_the_wrong_year_loses_period_points():
    """The right number, the right company, hung on the wrong year."""
    got = _pe(
        f"Apple's FY2024 net sales were {TRUE} [1]. We also reviewed fiscal 2025."
    )
    assert got < 1.0, (
        "the figure was attributed to FY2024 and the dimension whose job is "
        "catching that scored full marks because '2025' appeared elsewhere"
    )


def test_naming_the_year_far_from_the_figure_is_not_attachment():
    got = _pe(
        f"Apple's FY2023 net sales were {TRUE} [1]. Fiscal 2025 is discussed "
        "in a later section."
    )
    assert got < 1.0


# ── the guards: context must stay free ────────────────────────────────────


def test_the_right_year_on_the_figure_scores_full_marks():
    got = _pe(f"Apple's fiscal 2025 net sales were {TRUE} [1].")
    assert got == 1.0


def test_a_prior_year_comparison_does_not_cost_period_points():
    """The L7 guard again, on this dimension. Context must not be punished."""
    got = _pe(
        f"Apple's fiscal 2025 net sales were {TRUE}, up from $391,035 million "
        "in fiscal 2024 [1]."
    )
    assert got == 1.0, "a correct answer was punished for providing context"


def test_a_figure_sentence_naming_no_period_is_not_punished():
    """
    The deliberate gap. The reply may be carrying the period from the sentence
    before; the text does not say otherwise, so the grader does not guess.
    """
    got = _pe(f"Apple reported net sales of {TRUE} [1]. This covers fiscal 2025.")
    assert got == 1.0


def test_the_ordinary_correct_answer_is_unaffected():
    got = _pe(f"Apple's net sales for fiscal 2025 were {TRUE} [1].")
    assert got == 1.0


def test_an_answer_with_no_figure_at_all_is_scored_on_presence_as_before():
    """No asserted figure means nothing to attach; the old rule is right there."""
    got = _pe("Apple has not yet been analysed for fiscal 2025.")
    assert got == 1.0
