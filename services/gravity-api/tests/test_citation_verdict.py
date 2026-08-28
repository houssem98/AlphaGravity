"""Adversarial citation-verdict tests (roadmap Phase 3).

Each test is one of the eight adversarial cases the Quick Answer roadmap
requires the verifier to catch. They are written against deterministic inputs —
no model, no network — so a failure here is a real regression in the checking
layer and not a flaky provider.
"""

import pytest

from app.core.verification.citation_verdict import (
    CONFLICTING,
    NOT_VERIFIABLE,
    PARTIALLY_SUPPORTED,
    UNSUPPORTED,
    VERIFIED,
    verdict_for_citation,
)


class FakePassage:
    def __init__(self, chunk_id, text, ticker="NVDA", filing_date="2025-02-26",
                 document_title="NVDA 10-K", section="Item 7"):
        self.chunk_id = chunk_id
        self.text = text
        self.ticker = ticker
        self.filing_date = filing_date
        self.document_title = document_title
        self.section = section
        self.metadata = {}


@pytest.fixture
def passages():
    return [
        FakePassage("c1", "Revenue for fiscal year 2025 was $130,497 million."),
        FakePassage("c2", "Data Center revenue for fiscal 2025 was $115,186 million."),
        FakePassage("c3", "Gross margin was 75.0% in fiscal 2025, up from 72.7%."),
    ]


# ── Case 2: fabricated citation index ────────────────────────────────────
def test_fabricated_citation_index_is_not_verified(passages):
    """The exact bug this module was written for: a model inventing [99] against
    three passages used to produce a citation with no source, marked verified."""
    v = verdict_for_citation(
        {"citation_number": 99, "text": "Revenue was $500 billion."},
        passages,
        model_entailed=True,
    )
    assert v.status == UNSUPPORTED
    assert v.is_verified is False
    assert "citation_index_out_of_range" in v.reasons


# ── Case 1: citation points at a source that is not this answer's ────────
def test_citation_to_foreign_chunk_id_is_unsupported(passages):
    v = verdict_for_citation(
        {"citation_number": 1, "chunk_id": "chunk-from-another-answer",
         "text": "Revenue for fiscal year 2025 was $130,497 million."},
        passages,
        model_entailed=True,
    )
    assert v.status == UNSUPPORTED
    assert "citation_chunk_not_in_answer_sources" in v.reasons


# ── Case 3: source is for the wrong company ──────────────────────────────
def test_wrong_company_source_conflicts(passages):
    v = verdict_for_citation(
        {"citation_number": 1, "ticker": "AMD",
         "text": "Revenue for fiscal year 2025 was $130,497 million."},
        passages,
        model_entailed=True,
    )
    assert v.status == CONFLICTING
    assert "entity_mismatch" in v.reasons


# ── Case 4: source is for the wrong quarter/year ─────────────────────────
def test_wrong_period_conflicts(passages):
    v = verdict_for_citation(
        {"citation_number": 1,
         "text": "Revenue for fiscal year 2023 was $130,497 million."},
        passages,
        model_entailed=True,
    )
    assert v.status == CONFLICTING
    assert "period_mismatch" in v.reasons


# ── Case 5: source in millions, answer states billions ───────────────────
def test_million_billion_scale_error_conflicts(passages):
    """$130,497 million is $130.5 billion. Claiming $130,497 billion is a
    thousand-fold error and must not pass."""
    v = verdict_for_citation(
        {"citation_number": 1,
         "text": "Revenue for fiscal year 2025 was $130,497 billion."},
        passages,
        model_entailed=True,
    )
    assert v.status == CONFLICTING
    assert "numeric_not_in_source" in v.reasons


def test_correct_scale_conversion_still_verifies(passages):
    """The same figure restated in billions is the same claim, and must pass —
    otherwise the check above is just banning unit conversion."""
    v = verdict_for_citation(
        {"citation_number": 1,
         "text": "Revenue for fiscal year 2025 was $130.5 billion."},
        passages,
        model_entailed=True,
    )
    assert v.status == VERIFIED


# ── Case 6: percent vs percentage points ─────────────────────────────────
def test_percent_stated_as_percentage_points_conflicts(passages):
    v = verdict_for_citation(
        {"citation_number": 3,
         "text": "Gross margin was 75.0 percentage points in fiscal 2025."},
        passages,
        model_entailed=True,
    )
    assert v.status == CONFLICTING
    assert "percentage_point_unit_mismatch" in v.reasons


# ── Case 7 / 8: the number in the claim is not in the source ─────────────
def test_arithmetic_result_absent_from_source_conflicts(passages):
    v = verdict_for_citation(
        {"citation_number": 2,
         "text": "Data Center revenue for fiscal 2025 was $142,000 million."},
        passages,
        model_entailed=True,
    )
    assert v.status == CONFLICTING
    assert "numeric_not_in_source" in v.reasons


def test_source_contradicts_answer_conflicts(passages):
    v = verdict_for_citation(
        {"citation_number": 1,
         "text": "Revenue for fiscal year 2025 was $85,000 million."},
        passages,
        model_entailed=True,
    )
    assert v.status == CONFLICTING


# ── The honest-pass case ─────────────────────────────────────────────────
def test_grounded_numeric_claim_verifies(passages):
    v = verdict_for_citation(
        {"citation_number": 2, "ticker": "NVDA",
         "text": "Data Center revenue for fiscal 2025 was $115,186 million."},
        passages,
        model_entailed=True,
    )
    assert v.status == VERIFIED
    assert v.is_verified is True
    assert "numeric_grounded_in_source" in v.reasons


def test_chunk_id_match_resolves_regardless_of_number(passages):
    """Binding is by chunk id first; a mismatched ordinal must not silently
    rebind the citation to whatever sits at that index."""
    v = verdict_for_citation(
        {"citation_number": 1, "chunk_id": "c2",
         "text": "Data Center revenue for fiscal 2025 was $115,186 million."},
        passages,
        model_entailed=True,
    )
    assert v.status == VERIFIED


# ── Degenerate inputs stay honest rather than defaulting to verified ─────
def test_no_passages_is_not_verifiable():
    v = verdict_for_citation(
        {"citation_number": 1, "text": "Revenue was $1 billion."}, [],
        model_entailed=True,
    )
    assert v.status == NOT_VERIFIABLE
    assert v.is_verified is False


def test_non_numeric_claim_is_never_verified_on_model_word_alone(passages):
    """A prose claim with nothing to check deterministically tops out at
    partially_supported. `verified` must mean evidence, not model confidence."""
    v = verdict_for_citation(
        {"citation_number": 1, "text": "The company described strong demand."},
        passages,
        model_entailed=True,
    )
    assert v.status == PARTIALLY_SUPPORTED
    assert v.is_verified is False


def test_model_disagreement_downgrades_but_does_not_reject(passages):
    v = verdict_for_citation(
        {"citation_number": 1,
         "text": "Revenue for fiscal year 2025 was $130,497 million."},
        passages,
        model_entailed=False,
    )
    assert v.status == PARTIALLY_SUPPORTED
    assert "model_reported_not_entailed" in v.reasons
