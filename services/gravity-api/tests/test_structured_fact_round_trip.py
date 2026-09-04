"""
V23 — the exact-fact channel rendered its own figures ambiguously.

`structured_search` holds every field the sixth audit asks a canonical evidence
object to carry: ticker, period, `metric_name`, `value_float`, `unit`, caption,
section. `_fact_line` flattens them into prose, and `citation_verdict` and the
benchmark grader then recover financial meaning by re-parsing that prose. The
round trip is `fields -> text -> regex -> fields`, and every defect from V1
through V22 lives inside it.

This file measures the round trip on the channel fusion weights treat as ground
truth. The value survives; the NOTATION did not. Parentheses around a figure
mean negative in a filing — `(408)` in a United Airlines table is minus 408 —
and the renderer used the same brackets for "also expressed as".

Kept narrow on purpose. It pins the notation the readers depend on, not the
whole rendering, so the eventual canonical object can replace `_fact_line`
without this file objecting to the replacement.
"""

from __future__ import annotations

import pytest

from app.core.retrieval.structured_search import StructuredSearch
from app.core.verification.citation_verdict import (
    _extract_numbers, _scrub, verdict_for_citation,
)

ROW = {
    "ticker": "AAPL",
    "period": "FY2025",
    "metric_name": "Revenues",
    "value_float": 416_161_000_000,
    "unit": "USD",
    "caption": "",
    "filing_type": "10-K",
}


class _Passage:
    def __init__(self, text: str):
        self.text = text
        self.ticker = "AAPL"
        self.filing_date = "2025-11-01"
        self.chunk_id = "c1"


def _verdict(claim: str, passage_text: str) -> str:
    return verdict_for_citation(
        {"text": claim, "citation_number": 1, "ticker": "AAPL"},
        [_Passage(passage_text)],
    ).status


# ── The notation ──────────────────────────────────────────────────────────


def test_an_exact_fact_states_no_negative_figure():
    """
    The whole defect in one assertion. On the unfixed renderer this passage
    parsed to `{416161000000.0, -416160000000.0, 2025.0}` — a negative Apple has
    never reported, manufactured by the renderer itself.
    """
    line = StructuredSearch._fact_line(ROW)
    numbers = _extract_numbers(_scrub(line))
    assert not [n for n in numbers if n < 0], (
        f"the exact-fact channel emitted a negative figure: {sorted(numbers)}\n"
        f"  rendered: {line}"
    )


def test_the_restatement_is_still_there_and_still_agrees():
    """
    Removing the ambiguity may not remove the restatement. It is what lets an
    answer quote either `$416,161 million` or `$416.16 billion` and still ground.
    """
    line = StructuredSearch._fact_line(ROW)
    assert "$416.16B" in line
    assert "$416,161 million" in line


# ── The verdict the notation was changing ─────────────────────────────────


def test_a_partly_covered_claim_is_not_called_a_contradiction():
    """
    The measured consequence, with the restatement stripped as the control.

    An exact fact covers one period. A claim naming two is partly grounded and
    partly uncovered, which is `partially_supported` — absence is not
    contradiction, and `citation_verdict` says so at length. The manufactured
    negative was an unaccounted source figure, so it promoted every such claim
    to `conflicting`, the harshest verdict the layer issues.
    """
    claim = "Apple revenue grew to $416,161 million from $391,035 million [1]."
    line = StructuredSearch._fact_line(ROW)
    control = line.replace(" = $416.16B", "")

    assert _verdict(claim, control) == "partially_supported"
    assert _verdict(claim, line) == "partially_supported", (
        "the rendered restatement still changes the verdict relative to a "
        "passage that omits it"
    )


@pytest.mark.parametrize("claim", [
    "Apple total revenue was $416,161 million in fiscal 2025 [1].",
    "Apple total revenue was $416.16 billion in fiscal 2025 [1].",
])
def test_both_readings_of_the_restated_figure_still_verify(claim):
    """Unchanged behaviour, and the reason the restatement is kept at all."""
    assert _verdict(claim, StructuredSearch._fact_line(ROW)) == "verified"


# ── A real filing's negatives must keep meaning negative ──────────────────


def test_parentheses_in_actual_filing_text_are_still_negative():
    """
    The convention is correct where a filing uses it. V23 is that OUR renderer
    borrowed it to mean something else, not that the convention is wrong — so
    the reader must be untouched.
    """
    filing = ("Nonoperating expense, net (408) (928) (824) "
              "Income before income taxes 4,306 4,168 3,387")
    assert -408.0 in _extract_numbers(_scrub(filing))
