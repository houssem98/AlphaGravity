"""
R8 QA-17 / roadmap §23 — telemetry that explains a verdict.

§23 asks for telemetry sufficient to answer four questions. Measured before
this row, on a citation as it reaches the client:

    why was a claim verified          `verification_status` + reasons   YES
    which evidence supported it       chunk_id/document_title/section   YES
    which gate rejected it            the reason codes                  YES
    which entity and period matched   nothing                           NO

The fourth had no answer. `reasons` names a CONFLICT when there is one, so a
rejected citation could always be explained; a verified one could not say which
period was checked, which entity was compared, or which metric narrowed the
search. "Why was this verified" bottomed out at `numeric_grounded_in_source`.

`CitationVerdict.matched` is that answer, and it is telemetry only — nothing
reads it to decide a verdict, so a key added here can never change one. It
carries `UNKNOWN` explicitly where a check did not run, because a check that
did not run is not a check that passed.
"""

from __future__ import annotations

import pytest

from app.core.search_pipeline import _normalize_citations
from tests.real_sec_fixtures import UAL_RESULTS

TRUE_CLAIM = "United operating revenue was $59,070 million in FY2025 [1]."


class _Passage:
    text = UAL_RESULTS["text"]
    ticker = "UAL"
    chunk_id = "c1"
    document_title = "UAL 10-K"
    section = "Results of Operations"
    filing_date = "2026-02-05"
    metadata = None


def _cite(claim: str = TRUE_CLAIM, scope=frozenset({"UAL"})) -> dict:
    raw = [{"citation_number": 1, "chunk_id": "c1", "text": claim}]
    return _normalize_citations(raw, [_Passage()], scope)[0]


# ── §23's four questions, each asserted ───────────────────────────────────


def test_why_a_claim_was_verified():
    c = _cite()
    assert c["verification_status"] == "verified"
    assert "numeric_grounded_in_source" in c["verification_reasons"]


@pytest.mark.parametrize("field", ["chunk_id", "document_title", "section"])
def test_which_evidence_supported_it(field):
    assert _cite()[field]


def test_which_gate_rejected_it():
    c = _cite(scope=frozenset({"MSFT"}))
    assert c["verification_status"] == "conflicting"
    assert "entity_mismatch" in c["verification_reasons"]


@pytest.mark.parametrize("dimension,expected", [
    ("entity", "UAL"),
    ("period", ["2025"]),
    ("metric", ["revenue"]),
])
def test_which_entity_and_period_matched(dimension, expected):
    """The question that had no answer before this row."""
    assert _cite()["verification_matched"][dimension] == expected


# ── UNKNOWN is a state, not a blank ───────────────────────────────────────


def test_a_check_that_did_not_run_says_so():
    """
    A check that could not run is not a check that passed, and a blank field
    reads as the latter. The claim below names no period and no metric this
    vocabulary knows.
    """
    m = _cite("United revenue rose sharply [1].")["verification_matched"]
    assert m["period"] == "UNKNOWN"


def test_an_unknown_metric_is_named_as_unknown():
    """V16's class, made visible: `operating expense` is not in production's
    metric vocabulary, so the search was never narrowed. The telemetry says
    that rather than implying a metric was matched."""
    m = _cite("United operating expense was $54,356 million in FY2025 [1]."
              )["verification_matched"]
    assert m["metric"] == "UNKNOWN"


# ── Telemetry cannot change a verdict ─────────────────────────────────────


def test_matched_is_telemetry_and_never_an_input():
    """
    The invariant that keeps this safe to extend. Two citations with identical
    inputs must have identical STATUS regardless of what `matched` records, and
    nothing in the verdict path reads `matched` back.
    """
    import inspect

    from app.core.verification import citation_verdict

    src = inspect.getsource(citation_verdict.verdict_for_citation)
    # It is written to, never read from, inside the verdict function.
    assert 'matched["' in src, "the field is populated"
    assert "matched.get(" not in src, "matched must never be read as an input"
    assert "if matched" not in src, "matched must never gate a decision"
