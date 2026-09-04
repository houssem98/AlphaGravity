"""
T4 — unknown issuer identity is UNGRADED, not credited.

`_entity_is_bound` has three outcomes and the scorer only ever heard two.
`True` is bound, `False` is misbound, and `None` means the question could not be
asked: no citation carries any issuer identity, so there is nothing to check the
name against. `score_answer` penalised only on `False`, so `None` kept the full
presence credit — the helper saying "cannot check" and the scorer recording
"passed".

An answer naming Apple and citing sources with no issuer field scored exactly as
well as one citing Apple's own 10-K. That is the defect this dimension was
rewritten to catch, surviving in the one branch nobody scored.

**This changes what the benchmark counts as correct**, which the roadmap
requires be agreed before implementation rather than decided by the loop. It was
put as three options — credit it and document, leave it ungraded, or fail it —
and ungraded was chosen. Ungraded is the only one where the scorer and the
helper agree, and it is the discipline this module's own docstring already
states: what cannot be scored is "left `None` and reported as ungraded rather
than guessed".

The direction NOT taken is failure. The rubric refuses to punish an unanswerable
question, and the note in `test_entity_attachment.py` calls that refusal the
reason six grader bugs did not become seven.

**Presence stays graded.** A token the reply never names is a presence failure,
and presence needs no citation to check. Only the *binding* half goes ungraded.
"""

from __future__ import annotations

from eval.head_to_head.rubric import score_answer

ANSWER = "Apple net sales were $416,161 million [1]."
CASE = {"id": "t", "expect_value": 416161.0, "expect_entity_tokens": ["apple"]}

BOUND = {"source_class": "SEC_EVIDENCE", "issuer": "APPLE INC",
         "document_title": "Apple 10-K FY2025",
         "text": "Net sales were $416,161 million in fiscal 2025 as filed."}
MISBOUND = {"source_class": "SEC_EVIDENCE", "issuer": "NVIDIA CORP",
            "document_title": "NVIDIA 10-K FY2025",
            "text": "Revenue for fiscal year 2025 was $130,497 million."}
NO_IDENTITY = {"source_class": "web",
               "text": "A sufficiently long excerpt carrying no issuer field."}


def _card(cites, answer=ANSWER, case=CASE):
    return score_answer(case, answer, citations=cites)


# ── T4: the third outcome is no longer scored as the first ────────────────


def test_unknown_identity_leaves_the_entity_mark_ungraded():
    assert _card([NO_IDENTITY]).scores["period_entity"] is None


def test_no_citations_at_all_leaves_the_entity_mark_ungraded():
    assert _card([]).scores["period_entity"] is None


def test_an_ungraded_entity_mark_says_why():
    """A silent None is the same failure as a silent 1.0, one step quieter."""
    note = _card([NO_IDENTITY]).notes.get("period_entity", "")
    assert "identity" in note.lower(), note


def test_an_ungraded_dimension_does_not_count_toward_the_weighted_total():
    """The renormalisation the module already does must actually see it."""
    card = _card([NO_IDENTITY])
    assert "period_entity" not in card.graded_keys


# ── The guards: the two outcomes that WERE scored still are ───────────────


def test_a_bound_entity_still_scores_full():
    assert _card([BOUND]).scores["period_entity"] == 1.0


def test_a_misbound_entity_still_scores_zero():
    """Naming Apple while citing only NVIDIA is graded, and graded wrong."""
    assert _card([MISBOUND]).scores["period_entity"] == 0.0


def test_one_bound_citation_among_identity_less_ones_is_enough():
    assert _card([NO_IDENTITY, BOUND]).scores["period_entity"] == 1.0


# ── Presence needs no citation, so it stays graded ────────────────────────


def test_a_company_never_named_still_fails_even_with_no_identity_anywhere():
    """
    The distinction that keeps T4 from swallowing the presence check: whether
    the reply NAMES the entity is answerable without any citation at all, so it
    is graded whatever the citations carry.
    """
    card = _card([NO_IDENTITY], answer="Net sales were $416,161 million [1].")
    assert card.scores["period_entity"] == 0.0


def test_a_company_never_named_still_fails_with_no_citations():
    card = _card([], answer="Net sales were $416,161 million [1].")
    assert card.scores["period_entity"] == 0.0


# ── The period half is independent and must not be ungraded with it ───────


def test_a_period_token_is_still_graded_when_the_entity_is_unknown():
    """
    `period_entity` is one dimension over two questions. An unanswerable entity
    must not drag a perfectly answerable period into ungraded with it.
    """
    case = {"id": "t", "expect_value": 416161.0,
            "expect_entity_tokens": ["apple"],
            "expect_period_tokens": ["fiscal 2025"]}
    card = score_answer(
        case, "Apple net sales were $416,161 million in fiscal 2025 [1].",
        citations=[NO_IDENTITY])
    assert card.scores["period_entity"] == 1.0


def test_a_wrong_period_still_fails_when_the_entity_is_unknown():
    case = {"id": "t", "expect_value": 416161.0,
            "expect_entity_tokens": ["apple"],
            "expect_period_tokens": ["fiscal 2025"]}
    card = score_answer(
        case, "Apple net sales were $416,161 million [1].",
        citations=[NO_IDENTITY])
    assert card.scores["period_entity"] == 0.0
