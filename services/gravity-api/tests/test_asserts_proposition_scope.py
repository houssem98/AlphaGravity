"""L6 / R7 — proposition structure. **BLOCKED, with the evidence.**

`_asserts` decides whether a reply ASSERTS a figure or merely contains it, and
it treats exactly one construction as an aside: a parenthetical. Measured:

    True   Net sales were $416,161 million.                        (main clause)
    False  Net sales were $500,000 million (the filing reports $416,161 million).
    True   Net sales were $500,000 million — the filing reports $416,161 million.
    True   Net sales were $500,000 million; the filing reports $416,161 million.
    True   Net sales, $416,161 million, rose sharply.
    True   Net sales were $500,000 million, notably $416,161 million as filed.
    True   Net sales were $500,000 million; in fact $416,161 million was filed.

Rows 3-7 all state a WRONG headline and score as asserting the truth, because
the truth sits in a subordinate span the function cannot see. That is R7, and
it is real.

**Why this is BLOCKED rather than fixed.**

L6 says: do not widen the punctuation list and call it solved. That warning is
correct, and this is the measurement behind it. A rule that treats `;`, `—` or
`,` as aside-introducing breaks all three shapes below, which this file already
protects on purpose:

    "In FY2024 revenue was $60,922M; in FY2025 it was $130,497M."
        first clause carries $60,922 — a first-clause rule scores the wrong
        year. `_asserts` calls this out by name: "Deliberately NOT a
        first-figure rule ... the over-tightening that this file's history
        already paid for once."

    "Revenue rose sharply — to $130,497 million."
        the em-dash COMPLETES the clause; stripping after it loses the only
        figure in the sentence.

    "Net sales, $416,161 million, rose sharply."
        the appositive IS the claim; treating appositives as asides discards
        the assertion outright.

What separates a demoted truth from a legitimate second clause is not the
punctuation. It is whether the two figures are attributed to the SAME period —
"$500,000M; the filing reports $416,161M" competes for one slot, while "FY2024
... ; FY2025 ..." does not. Deciding that requires attaching periods to clauses,
which is the same proposition-extraction problem one level down. Hence:

    BLOCKED — needs sentence parsing.

**What this file therefore pins.** Not the defect: asserting the buggy outcomes
would make them load-bearing and a future fix would have to delete tests to
proceed. It pins the CONSTRAINTS any fix must satisfy — the three protected
shapes above, plus the parenthetical behaviour that already works. A future
attempt at R7 runs these first; if they stay green, it has not re-broken what
the file already paid to learn.
"""

from __future__ import annotations

import pytest

from eval.head_to_head.rubric import _asserts

TRUE = 416161.0
NVDA = 130497.0


# ── the parenthetical rule, which does work ───────────────────────────────


def test_a_main_clause_figure_is_asserted():
    assert _asserts(TRUE, "Net sales were $416,161 million.") is True


def test_a_truth_demoted_into_a_parenthetical_is_not_asserted():
    """The one aside form `_asserts` can see. Must keep working."""
    assert _asserts(
        TRUE,
        "Net sales were $500,000 million (the filing reports $416,161 million)."
    ) is False


def test_a_lone_parenthetical_is_still_the_claim():
    """No competing figure outside, so the aside is all the answer said."""
    assert _asserts(TRUE, "Net sales ($416,161 million) for the year.") is True


# ── the constraints any R7 fix must not break ─────────────────────────────
#
# These are the counterexamples that make a naive widening wrong. They are the
# deliverable of a BLOCKED loop: the next attempt starts with them green.


def test_a_second_clause_naming_a_later_period_is_the_assertion():
    """The regression this file already paid for once.

    A rule that treats `;` as aside-introducing, or that scores the first
    figure, marks this answer wrong for stating the year it was asked about.
    """
    assert _asserts(
        NVDA,
        "In FY2024 revenue was $60,922 million; in FY2025 it was $130,497 million."
    ) is True


def test_an_em_dash_that_completes_the_clause_is_the_assertion():
    """`—` is not a parenthesis. Here it introduces the figure, not an aside."""
    assert _asserts(NVDA, "Revenue rose sharply — to $130,497 million.") is True


def test_an_appositive_is_the_claim_not_an_aside():
    assert _asserts(TRUE, "Net sales, $416,161 million, rose sharply.") is True


def test_a_trailing_derived_clause_does_not_unassert_the_headline():
    assert _asserts(
        NVDA,
        "Revenue was $130,497 million, up 114% from the prior year."
    ) is True


# ── the shapes R7 leaves open, recorded without cementing them ────────────


@pytest.mark.parametrize("text", [
    "Net sales were $500,000 million — the filing reports $416,161 million.",
    "Net sales were $500,000 million; the filing reports $416,161 million.",
    "Net sales were $500,000 million, notably $416,161 million as filed.",
    "Net sales were $500,000 million; in fact $416,161 million was filed.",
])
def test_a_wrong_headline_is_detectable_as_a_competing_claim(text):
    """
    R7's open shapes, pinned at the level that IS decidable without a parser.

    `_asserts` cannot yet tell that the truth is subordinate here, so it scores
    these as asserted. This test deliberately does NOT assert that outcome —
    doing so would make the defect load-bearing and force a future fix to
    delete a test.

    What it pins instead is the precondition a fix will rely on: the answer
    really does carry a COMPETING financial figure outside any parenthetical,
    which is the signal `_asserts` already uses for the parenthetical case and
    the one a clause-level rule would extend. If this ever stops being true,
    the shape of the problem has changed and the analysis above is stale.
    """
    from eval.head_to_head.rubric import _financial_figures

    competing = _financial_figures(text)
    assert len(competing) >= 2, (
        f"the wrong headline and the demoted truth are no longer both visible "
        f"as competing figures: {competing}"
    )
