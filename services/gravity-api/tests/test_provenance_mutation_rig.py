"""
U7 — mutate one provenance dimension at a time and prove the grader notices.

The fourth audit's closing recommendation, and the best thing in it. Four audits
have now produced the same shape of defect: a fixture narrower than the function
under test, where red-then-green was mistaken for proof the hole was shut. T13
was round 3's own instance. U1, U2 and U3 were three more.

Individual tests cannot fix that, because each one is written by someone who has
already decided which branch matters. **A rig can**, by taking a citation that
SHOULD ground an answer, breaking exactly one thing about it, and asserting the
grader's verdict moves. A dimension nobody thought about shows up as a mutation
that changes nothing.

**The base citation is real.** `PIPELINE_SEC_CITATION` is what
`citation_provenance.payload()` actually attaches to a verified SEC citation —
recorded from the producer, not imagined by a test author. A rig built from
invented shapes reproduces the blind spot it exists to find, which is the whole
lesson of R14.

**Negative controls are as important as positive ones.** A dimension the grader
is DOCUMENTED not to read must be asserted not to matter. `cik` is the case:
T5 established that `_ISSUER_FIELDS` omits it deliberately, because an integer
cannot substring-match a name. If mutating `cik` ever starts changing a verdict,
either the documentation or the code has moved.

This rig was proven to fire before it was trusted: run against the rubric as it
stood at `ad75be6`, the mutations for source class, accession, issuer and cited
value all fail to be detected. That run is recorded in the N4 ledger row.
"""

from __future__ import annotations

import pytest

from eval.head_to_head.rubric import (
    _claim_is_bound, _entity_is_bound, _is_primary,
)

#: What `citation_provenance.payload()` writes for a verified SEC citation.
#: Copied from `test_gate_accepts_real_pipeline_citations.py`, which recorded it
#: from the producer rather than guessing it.
PIPELINE_SEC_CITATION = {
    "source_class": "SEC_EVIDENCE",
    "issuer": "NVIDIA CORP",
    "cik": 1045810,
    "form": "10-K",
    "accession": "0001045810-25-000023",
    "verification_status": "verified",
}

EXCERPT = ("NVIDIA reported that revenue was $130 billion for the fiscal year "
           "then ended, as filed in its annual report on Form 10-K.")
ANSWER = "NVIDIA revenue was $130 billion."


def _cite(**overrides) -> dict:
    """The real citation with one dimension changed."""
    return {**PIPELINE_SEC_CITATION, "text": EXCERPT, **overrides}


def _grounded(cite: dict) -> tuple[bool, bool | None, bool | None]:
    """The three verdicts a citation earns: primary, entity, claim."""
    return (_is_primary([cite]),
            _entity_is_bound("nvidia", [cite]),
            _claim_is_bound(ANSWER, [cite]))


# ── The unmutated citation grounds the answer on every dimension ──────────


def test_the_real_citation_grounds_the_answer():
    """If this fails, every mutation below is measuring the wrong baseline."""
    assert _grounded(_cite()) == (True, True, True)


# ── One dimension at a time ───────────────────────────────────────────────
#
# Each row breaks exactly one thing and names which verdict must notice. A
# mutation that changes nothing is a dimension the grader is blind to.

@pytest.mark.parametrize("label,overrides,expect", [
    # source class — a declared non-filing must lose primary status even
    # though the real accession is still attached (U1).
    ("class -> web page",
     {"source_class": "WEB_EVIDENCE"}, "primary"),
    ("class -> corpus chunk",
     {"source_class": "LOCAL_EVIDENCE"}, "primary"),
    ("class -> news article",
     {"source_class": "news"}, "primary"),

    # accession — with the class stripped, a fabricated accession must not
    # carry the citation on its own (T3).
    ("accession fabricated, class stripped",
     {"source_class": "", "accession": "totally-invented"}, "primary"),
    ("accession truncated, class stripped",
     {"source_class": "", "accession": "0001045810-25"}, "primary"),

    # issuer — a different company, and a company that merely CONTAINS the
    # token, must both fail the entity bind (U2).
    ("issuer -> a different company",
     {"issuer": "ADVANCED MICRO DEVICES INC"}, "entity"),
    ("issuer -> a name containing the token",
     {"issuer": "NVIDIAN HOLDINGS LLC"}, "entity"),

    # cited value — a figure that does not support the answer, and a figure
    # attached to a different metric (U3).
    ("excerpt states a different value",
     {"text": "NVIDIA reported revenue of $120 billion for the fiscal year."},
     "claim"),
    ("the number belongs to another metric",
     {"text": "NVIDIA operating expenses were $130 billion while revenue "
              "was $120 billion for the year."},
     "claim"),
])
def test_breaking_one_dimension_changes_the_verdict(label, overrides, expect):
    primary, entity, claim = _grounded(_cite(**overrides))
    got = {"primary": primary, "entity": entity, "claim": claim}[expect]
    assert got is False, (
        f"mutating {label!r} left the {expect} verdict at {got!r}. The grader "
        f"is not reading that dimension, so an answer grounded on a citation "
        f"broken in exactly this way would still score as supported."
    )


# ── Negative controls: dimensions the grader is documented NOT to read ────


def test_mutating_the_cik_changes_nothing():
    """
    T5. `_ISSUER_FIELDS` omits `cik` deliberately — an integer cannot
    substring-match a name token, and including it would imply an identity
    check that never happens.

    If this ever fails, the code and its documentation have diverged again,
    which is the defect T5 recorded rather than the one it fixed.
    """
    assert _grounded(_cite(cik=99999999)) == (True, True, True)
    assert _grounded(_cite(cik=None)) == (True, True, True)


def test_mutating_the_form_type_changes_nothing():
    """Nothing in the rubric reads `form`. Asserted so a future reader knows."""
    assert _grounded(_cite(form="10-Q")) == (True, True, True)


def test_mutating_the_verification_status_changes_nothing():
    """
    A gap worth stating rather than hiding: the rubric does not read
    `verification_status`, so a citation the pipeline marked UNVERIFIED grades
    exactly like a verified one. That is not U1-U3 and is not fixed here — it
    is the next dimension this rig points at.
    """
    assert _grounded(_cite(verification_status="unverified")) == (True, True, True)


# ── The rig must not pass by grading nothing ──────────────────────────────


def test_every_verdict_is_actually_reachable():
    """
    A rig whose verdicts are all `None` would pass every mutation vacuously.
    """
    primary, entity, claim = _grounded(_cite())
    assert primary is not None and entity is not None and claim is not None
