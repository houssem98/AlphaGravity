"""
R8 QA-12 / roadmap §11, §12, §13 — the status compatibility matrix.

**What the rig's invariant was actually worth.** It reads *production says
UNSUPPORTED ⇒ the grader must not bind*. Measured across every node mutation:

    production status distribution   {'verified': 2, 'conflicting': 4}

`UNSUPPORTED` appears ZERO times. `verdict_for_citation` returns it only when a
citation fails to RESOLVE — a bad index, a missing chunk — and every value,
entity and period disagreement returns `CONFLICTING`. So the invariant was
vacuously true for the entire content-mutation set and had never once fired on
one. Round 7 said this and did not fix it.

**V41 — production ground figures by set membership, not metric attachment.**

    claim     "operating revenue was $54,356 million"
    passage   "Operating revenue $ 59,070  Operating expense 54,356 ..."
    verdict   verified ['numeric_grounded_in_source']

The figure is real and belongs to the EXPENSE row. Production certified it
because the number was present somewhere, and its contradiction scan only runs
when a claim is PARTIALLY grounded — a fully grounded but misattributed claim
never reached it. `metric_spans` moved into `app/core/verification/` and
`citation_verdict` now grounds within the claimed metric's own span, which is
the production twin of the fix V39 made to the evaluator.

**This file replaces a vacuous invariant with an exact matrix.** Every cell is
asserted, so a silent change on either side is a failing test rather than a
quiet drift. Roadmap §13's failure mode for this row is widening "rejects" to
include `CONFLICTING` and then pinning the new violations as known gaps — a
matrix that grows exemptions is the ratchet, not the fix. No exemption is added
here. The one that remains, `metric-wrong`, has been `KNOWN_SHARED_GAPS`'
member since round 6 and is V16, which R7 decided to record rather than widen
production's metric vocabulary for.
"""

from __future__ import annotations

import pytest

from app.core.verification.citation_verdict import (
    CONFLICTING, UNSUPPORTED, VERIFIED, verdict_for_citation,
)
from tests.test_grader_agrees_with_production_verifier import (
    _EDGE_MUTATIONS, _MUTATIONS, TRUE, _Passage, _grader_says_bound,
)


def _production(claim: str, ticker: str) -> str:
    return verdict_for_citation(
        {"text": claim, "citation_number": 1, "ticker": ticker},
        [_Passage(TRUE)],
    ).status


#: The full matrix, asserted cell by cell. `grader_binds` False means the
#: evaluator refuses; production's column is its verdict string.
MATRIX = {
    "value-wrong":      (CONFLICTING, False),
    "value-transposed": (CONFLICTING, False),
    "unit-too-large":   (CONFLICTING, False),
    "unit-too-small":   (CONFLICTING, False),
    "period-wrong":     (CONFLICTING, False),
    # V16, KNOWN_SHARED_GAPS' remaining member since round 6: `operating
    # expense` is not in production's metric vocabulary, so the claim names no
    # metric to narrow the search to and both layers accept it. R7 decided to
    # record this rather than widen the vocabulary.
    "metric-wrong":     (VERIFIED, True),
}


def test_the_matrix_covers_every_mutation():
    """A matrix with a hole is a matrix that stops reporting. If a mutation is
    added and not given a row, this fails rather than silently skipping it."""
    assert set(MATRIX) == set(_MUTATIONS)


@pytest.mark.parametrize("name", sorted(MATRIX))
def test_every_cell_of_the_matrix(name):
    expected_status, expected_bound = MATRIX[name]
    w = _MUTATIONS[name](TRUE)
    claim = w.claim()
    assert _production(claim, w.ticker) == expected_status
    assert _grader_says_bound(claim, TRUE) is expected_bound


# ── What the old invariant was worth, asserted so it cannot be re-trusted ──


def test_production_never_returns_unsupported_for_a_content_mutation():
    """
    The measurement that condemns the old invariant, kept as a test rather than
    a note. `UNSUPPORTED` is production's answer to a citation that does not
    RESOLVE; a citation that resolves and disagrees is `CONFLICTING`. So *
    production says UNSUPPORTED ⇒ the grader must not bind* could never fire on
    a wrong value, a wrong unit, a wrong period or a wrong metric.

    If this ever fails, the rig's original invariant has become meaningful and
    this file should say so.
    """
    got = {name: _production(_MUTATIONS[name](TRUE).claim(),
                             _MUTATIONS[name](TRUE).ticker)
           for name in _MUTATIONS}
    assert UNSUPPORTED not in got.values(), got


def test_the_undisturbed_fact_is_still_verified():
    """The control that stops the matrix being satisfied by refusing
    everything."""
    assert _production(TRUE.claim(), TRUE.ticker) == VERIFIED


# ── V41 — the production twin of V39 ──────────────────────────────────────


def test_v41_a_figure_from_the_wrong_row_is_not_verified():
    """
    Before this row, `verified ['numeric_grounded_in_source']`. The claim's
    figure is the expense line; the metric it names is revenue.
    """
    assert _production(
        "United Airlines Holdings, Inc. operating revenue was $54,356 million "
        "in fiscal 2025 [1].", "UAL") != VERIFIED


def test_v41_fails_open_when_the_claim_names_no_known_metric():
    """
    Deliberate, and the reason V41's fix cannot be a general tightening. A
    claim whose metric this vocabulary does not know narrows to nothing, so it
    must fall back to the whole passage rather than refuse everything — which
    is also why `metric-wrong` is still in the matrix as VERIFIED.
    """
    assert _production(
        "United Airlines Holdings, Inc. operating expense was $59,070 million "
        "in fiscal 2025 [1].", "UAL") == VERIFIED


# ── Edge mutations: the relationships, not the fields ─────────────────────


@pytest.mark.parametrize("name", sorted(_EDGE_MUTATIONS))
def test_every_edge_mutation_is_caught_by_a_layer(name):
    """
    §12's edges. Every component is true and the wiring is wrong, so no field
    mutation would surface any of them. `KNOWN_SHARED_EDGE_GAPS` is empty as of
    this round, so this asserts a clean sweep rather than a set with holes.
    """
    from tests.test_grader_agrees_with_production_verifier import (
        _edge_grader_says_bound, _edge_production_says_unsupported,
    )
    w = _EDGE_MUTATIONS[name]
    caught = (_edge_production_says_unsupported(w)
              or not _edge_grader_says_bound(w))
    assert caught, f"edge mutation {name!r} is accepted by both layers"
