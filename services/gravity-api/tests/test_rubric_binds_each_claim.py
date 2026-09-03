"""L5 / R6 — evidence binding is any-claim/any-excerpt, not per-claim.

`_claim_is_bound` pools every figure in the answer into one set and asks whether
ANY of them appears in ANY cited excerpt. So the audit's counterexample scores
as bound:

    "Revenue was $130,497 million [1]. Data centre was $115,186 million.
     Gaming was $11,350 million."

with a single citation whose excerpt carries only the first figure. Two of the
three claims are supported by nothing, and the rubric calls the answer bound.

**This is the file where over-tightening lives.** Its own docstrings say six of
seven grader bugs came from tightening past what the data supports, so the fix
keeps every documented leniency and changes exactly one thing: the scope of the
`any` moves from the whole answer to each claim.

Preserved deliberately:

* a sentence asserting no figure is not an unsupported claim — it is not a
  claim at all, and is skipped
* within a claim it is still ANY excerpt and ANY reading, not the primary
  citation or the headline number
* no usable excerpt, or no asserted figure anywhere, still returns `None` —
  an unanswerable question is not a failed one

And one case that must NOT become stricter: a derived rate. "Revenue grew from
$100B to $130B [1]. That is a 30% increase." — 30% appears in no excerpt because
it was computed, not quoted. Penalising it would punish a correct computed
answer, which is the documented failure mode. A rate-only claim is excused when
the levels it was derived from are themselves bound; standing alone with nothing
else bound, it must still bind on its own, exactly as today.

Sentence scope is the granularity this file already settled on for this same
question — see `_period_misattributed`, which builds its `claims` list the same
way and says so.
"""

from __future__ import annotations

from eval.head_to_head.rubric import _claim_is_bound

EXCERPT_REVENUE = (
    "Revenue for fiscal year 2025 was $130,497 million, compared with "
    "$60,922 million for fiscal year 2024."
)
EXCERPT_LEVELS = (
    "Total revenue rose from $100,000 million in the prior year to "
    "$130,000 million in the current year, as reported."
)


def _cite(text):
    return [{"text": text, "source_class": "SEC_EVIDENCE"}]


# ── the defect ────────────────────────────────────────────────────────────


def test_unsupported_claims_are_not_carried_by_one_supported_claim():
    """The audit's counterexample, stated exactly."""
    answer = ("Revenue was $130,497 million [1]. Data centre was $115,186 "
              "million. Gaming was $11,350 million.")

    assert _claim_is_bound(answer, _cite(EXCERPT_REVENUE)) is False, (
        "two claims supported by nothing rode in on a third that was cited; "
        "binding is pooled across the whole answer instead of per claim"
    )


def test_every_claim_bound_still_reads_as_bound():
    answer = ("Revenue was $130,497 million [1], up from $60,922 million "
              "the year before [1].")

    assert _claim_is_bound(answer, _cite(EXCERPT_REVENUE)) is True


# ── the leniencies that must survive ──────────────────────────────────────


def test_a_sentence_with_no_figure_is_not_an_unsupported_claim():
    answer = ("Revenue was $130,497 million [1]. The company attributed the "
              "increase to data centre demand. Management expects this to "
              "continue.")

    assert _claim_is_bound(answer, _cite(EXCERPT_REVENUE)) is True, (
        "prose sentences were counted as claims and marked unsupported"
    )


def test_no_usable_excerpt_is_still_unanswerable():
    assert _claim_is_bound("Revenue was $130,497 million [1].", [{"text": ""}]) is None
    assert _claim_is_bound("Revenue was $130,497 million [1].", []) is None
    # Below the 20-character floor: not enough text to ask the question of.
    assert _claim_is_bound("Revenue was $130,497 million [1].",
                           _cite("Revenue.")) is None


def test_an_answer_asserting_no_figure_is_still_unanswerable():
    assert _claim_is_bound("The filing does not break this out.",
                           _cite(EXCERPT_REVENUE)) is None


def test_a_parenthetical_aside_is_still_not_a_claim():
    """`_asserted_values` strips asides; per-claim scope must not undo that."""
    answer = "Revenue was $130,497 million [1] (up from $60,922 million)."

    assert _claim_is_bound(answer, _cite(EXCERPT_REVENUE)) is True


def test_any_excerpt_and_any_reading_still_count_within_a_claim():
    """Not the primary citation, not the headline figure. Unchanged."""
    answer = "Revenue was $130.497 billion [2]."
    cites = [{"text": "An unrelated but sufficiently long excerpt of prose."},
             {"text": EXCERPT_REVENUE}]

    assert _claim_is_bound(answer, cites) is True


# ── the over-tightening this fix must not cause ───────────────────────────


def test_a_derived_rate_is_excused_when_its_levels_are_bound():
    """A computed figure appears in no excerpt because it was computed."""
    answer = ("Revenue grew from $100,000 million to $130,000 million [1]. "
              "That is a 30% increase.")

    assert _claim_is_bound(answer, _cite(EXCERPT_LEVELS)) is True, (
        "a correct computed answer was marked unbound because the arithmetic "
        "it performed is not quoted in the excerpt it was derived from"
    )


def test_a_lone_unmatched_rate_is_still_unbound():
    """The excuse is not a blanket exemption: unchanged from today."""
    answer = "Operating margin rose 5 percentage points."

    assert _claim_is_bound(answer, _cite(EXCERPT_REVENUE)) is False, (
        "a rate claim with no supporting excerpt and no bound levels beside it "
        "escaped binding entirely"
    )


def test_an_entirely_unsupported_answer_is_still_unbound():
    answer = "Revenue was $999,999 million [1]."

    assert _claim_is_bound(answer, _cite(EXCERPT_REVENUE)) is False
