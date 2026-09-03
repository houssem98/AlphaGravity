"""L6 / D8 — bind the stated figure to a citation that actually contains it.

Grader bug 7 stopped the rubric paying a PERFECT score for a property it never
verified: `_is_primary` is an ANY over the list, so one filing among four news
articles scored the full 20 points with nothing checking that the stated figure
came from the filing. `6c72822` demoted that to 0.8 and said so in the note.

0.8 is a haircut, not a verification. It is the same 0.8 whether the figure is
in the cited filing or nowhere near it.

**On the hard constraint.** The roadmap says claim-level binding is blocked
because recorded excerpts truncate at 220 characters. Checked: the truncation
is at `run_benchmark.py`'s `"answer_excerpt": (got["answer"] or "")[:220]`,
which is what gets WRITTEN TO THE RESULTS FILE. Two lines above,
`score_answer(case, got["answer"], citations=got["citations"], ...)` receives
the untruncated answer, and each citation carries its own `text`. So the
constraint blocks RE-SCORING FROM SAVED RESULTS — which is what the discarded
rescore attempted — and does not block scoring at run time. The binding is
reachable; only the historical re-derivation is not.

**What is deliberately not done.** The check engages only when citations
actually carry excerpts. When they do not, the question cannot be asked, and an
unanswerable question is not a failed one — the existing 1.0 / 0.8 behaviour is
left exactly as it was. Six of seven grader bugs in this file came from
tightening past what the data supports, and a citation whose excerpt is a
section header rather than the sentence with the number would be punished by a
stricter rule for no fault of the answer.
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

CASE = "aapl-fy2025-revenue"
TRUE = "$416,161 million"

FILING_TEXT = ("Total net sales for fiscal 2025 were $416,161 million, "
               "compared to $391,035 million in fiscal 2024.")
UNRELATED_TEXT = ("Apple's Board of Directors declared a cash dividend of "
                  "$0.26 per share of the Company's common stock.")


def _cite(cls="sec_filing", text=""):
    return {"source_class": cls, "text": text}


def _ev(answer: str, cites: list[dict]) -> float:
    return score_answer(BY_ID[CASE], answer, citations=cites).scores["evidence"]


# ── the defect ────────────────────────────────────────────────────────────


def test_a_primary_citation_that_does_not_contain_the_figure_is_not_full_marks():
    """The exact hole grader bug 7 left open: cited, primary, and unsupporting."""
    got = _ev(f"Apple's FY2025 net sales were {TRUE} [1].",
              [_cite(text=UNRELATED_TEXT)])
    assert got < 1.0, (
        "a filing that never mentions the stated figure scored the same as one "
        "that states it; the citation was counted, not read"
    )


def test_a_mixed_list_whose_filing_does_not_support_the_claim_drops_below_the_haircut():
    got = _ev(f"Apple's FY2025 net sales were {TRUE} [1].",
              [_cite(text=UNRELATED_TEXT), _cite("news", text=UNRELATED_TEXT)])
    assert got < 0.8, (
        "the blind 0.8 haircut was applied to a claim we can see is unsupported"
    )


def test_the_note_says_the_figure_was_not_found_in_the_excerpts():
    card = score_answer(BY_ID[CASE],
                        f"Apple's FY2025 net sales were {TRUE} [1].",
                        citations=[_cite(text=UNRELATED_TEXT)])
    assert "none of the cited" in card.notes["evidence"].lower()


# ── the guards ────────────────────────────────────────────────────────────


def test_a_primary_citation_that_contains_the_figure_scores_full_marks():
    got = _ev(f"Apple's FY2025 net sales were {TRUE} [1].",
              [_cite(text=FILING_TEXT)])
    assert got == 1.0, "a verified, supported claim was not paid in full"


def test_a_scaled_restatement_still_binds():
    """The answer says billions, the filing says millions. Same claim."""
    got = _ev("Apple's FY2025 net sales were $416.2 billion [1].",
              [_cite(text=FILING_TEXT)])
    assert got == 1.0


def test_citations_without_excerpts_keep_the_existing_behaviour():
    """
    The question cannot be asked, so it is not answered against the system.
    This is the shape every existing rubric test uses.
    """
    got = _ev(f"Apple's FY2025 net sales were {TRUE} [1].", [_cite()])
    assert got == 1.0


def test_a_mixed_list_without_excerpts_keeps_the_recorded_haircut():
    got = _ev(f"Apple's FY2025 net sales were {TRUE} [1].",
              [_cite(), _cite("news")])
    assert got == 0.8


def test_an_answer_asserting_no_figure_is_not_penalised():
    """Nothing to bind. Absence of a claim is not an unsupported claim."""
    got = _ev("Apple's net sales are discussed in the cited filing [1].",
              [_cite(text=UNRELATED_TEXT)])
    assert got == 1.0


def test_a_prior_year_figure_in_the_excerpt_still_binds_the_headline():
    """The excerpt carries both years; the headline is the one that must bind."""
    got = _ev(f"Apple's FY2025 net sales were {TRUE}, up from $391,035 million "
              "in FY2024 [1].", [_cite(text=FILING_TEXT)])
    assert got == 1.0
