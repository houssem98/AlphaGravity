"""L7 / D9 — correctness must score the figure the answer ASSERTS.

`_matches` iterates `numbers_in(text)` across the entire reply and returns True
on the first value within tolerance. Presence anywhere counts, so an answer can
state a wrong headline and still score 1.0 as long as the right number appears
somewhere in the same reply — in a parenthetical, an aside, a footnote.

Demonstrated on 2026-09-02 and reproduced here: a reply asserting
`$500,000 million` with the true figure in a parenthetical scored correctness
**1.0**. Whether any of the five recorded benchmark runs actually hit this is
unverifiable — their per-case outputs were never persisted — so this pins the
mechanism, and makes no claim about historical scores.

The rule the fix implements, stated so it can be argued with:

  a figure inside a parenthetical is not what the answer asserts, UNLESS the
  text outside the parentheses makes no competing financial claim.

The exception is load-bearing. "Net sales ($416,161 million)" asserts the
figure — there is nothing else it could be doing — while "net sales were
$500,000 million (the filing reports $416,161 million)" is a wrong headline
with the truth demoted to an aside. Scoring both the same is what produced the
defect; scoring the first as a miss would be the over-tightening that this
file's own history warns about, where six of seven grader bugs came from.

The guard tests here matter as much as the defect test. A correct answer that
also quotes a prior-year comparison must still score 1.0, or the rubric starts
training the system to answer with a bare number and no context.
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

CASE = "aapl-fy2025-revenue"
TRUE_FIGURE = "$416,161 million"
WRONG_FIGURE = "$500,000 million"


def _score(answer: str) -> float:
    return score_answer(BY_ID[CASE], answer, citations=SEC).scores["correctness"]


# ── the defect ────────────────────────────────────────────────────────────


def test_a_wrong_headline_is_not_rescued_by_the_truth_in_a_parenthetical():
    """The demonstrated case, reproduced exactly."""
    got = _score(
        f"Apple's FY2025 net sales were {WRONG_FIGURE} (the filing reports "
        f"{TRUE_FIGURE}) [1]."
    )
    assert got == 0.0, (
        "an answer asserting a wrong headline scored as correct because the "
        "true figure appeared in an aside"
    )


def test_a_wrong_headline_is_not_rescued_by_a_trailing_correction():
    got = _score(
        f"Apple's FY2025 net sales were {WRONG_FIGURE} [1]. (Note: some sources "
        f"say {TRUE_FIGURE}.)"
    )
    assert got == 0.0


def test_the_failure_mode_is_recorded_as_false_confidence():
    """A wrong asserted number is the misleading failure, not an abstention."""
    card = score_answer(
        BY_ID[CASE],
        f"Apple's FY2025 net sales were {WRONG_FIGURE} (the filing reports "
        f"{TRUE_FIGURE}) [1].",
        citations=SEC,
    )
    assert card.scores["correctness"] == 0.0
    assert card.notes.get("failure_mode") == "false_confidence"


# ── the guards: context must stay free ────────────────────────────────────


def test_a_correct_answer_quoting_a_prior_year_still_scores_one():
    """L7's stated guard. Punishing this trains answers into bare numbers."""
    got = _score(
        f"Apple's FY2025 net sales were {TRUE_FIGURE}, up from $391,035 million "
        "in FY2024 [1]."
    )
    assert got == 1.0, "a correct answer was punished for providing context"


def test_a_correct_answer_with_a_parenthetical_restatement_scores_one():
    got = _score(f"Apple's FY2025 net sales were $416.2 billion ({TRUE_FIGURE}) [1].")
    assert got == 1.0


def test_a_parenthetical_that_is_the_only_claim_still_counts():
    """
    The exception. With no competing figure outside it, the parenthetical IS
    the assertion, and reading it as an aside would invent a miss.
    """
    got = _score(f"Apple FY2025 net sales ({TRUE_FIGURE}) [1].")
    assert got == 1.0


def test_the_plain_correct_answer_is_unaffected():
    got = _score(f"Apple's FY2025 net sales were {TRUE_FIGURE} [1].")
    assert got == 1.0


def test_the_plain_wrong_answer_is_unaffected():
    got = _score(f"Apple's FY2025 net sales were exactly {WRONG_FIGURE} [1].")
    assert got == 0.0


def test_a_scaled_restatement_of_the_truth_still_scores_one():
    """`$416.2 billion` and `$416,161 million` are the same claim."""
    assert _score("Roughly $416.2 billion [1].") == 1.0


def test_v1_an_explicit_magnitude_is_never_rescaled():
    """
    R8 QA-13. The theatre audit reverted V1's guard and this file still passed,
    so the fix had no isolating test of its own for five rounds.

    V1 is the rule that a figure stating its own magnitude is read at that
    magnitude and no other. Without it the scale loop multiplies `$130 million`
    by 1e3 and matches a claim of $130 billion — an answer wrong by a factor of
    a thousand scoring full marks on correctness.
    """
    from eval.head_to_head.rubric import _matches
    assert _matches(1.3e11, "$130 million") is False
    assert _matches(1.3e8, "$130 million") is True
