"""
E3 — the verifier grades from the fact's fields when the citation carries them.

Row E1 put the canonical evidence object's fields on the citation. This is what
they are for: `verdict_for_citation` compares a claim's figure against the value
XBRL holds, instead of against a rendering of it.

**Why that is not a cosmetic difference.** `structured_search._fmt_value` prints
a fact as `${v/1e6:,.0f} million`, so the absolute rounding error is up to half a
million dollars — nothing against $416B, and a third of the number against
$1.5M. `close_enough` is a 0.5% RELATIVE test, so below roughly $120M the
rendered text no longer contains the figure the filing states. Measured, with
claims quoting the filing's own exact value:

    fact 416,161,000,000  "$416,161 million"  verified
    fact      12,499,000  "$12 million"       conflicting / numeric_not_in_source
    fact       2,500,000  "$2 million"        conflicting / numeric_not_in_source
    fact       1,499,999  "$1 million"        conflicting / numeric_not_in_source

Every fact between about $1M and $120M was a false rejection of a correct claim,
on the channel the fusion weights treat as ground truth.

**Rendering more decimals would be the symptom fix.** The class of defect is
that financial meaning is recovered from prose, and each round of this work has
found another instance. The structural answer is the one the sixth audit named:
read the field.

**Fields decide, the text path still runs.** A claim naming three figures where
the fact covers one still gets the text check for the other two, so no citation
is graded on less than it was before.

**What this row does NOT close.** V16 — the metric. The fact carries
`xbrl_concept`, an XBRL tag; the claim carries English. Comparing them needs a
concept-to-English mapping, which is the parallel vocabulary R14, T1, T2 and
V16 itself are each an instance of. The metric question needs the CLAIM to
carry its own metric, which is the other half of the audit's diagram and is not
built here. V16 stays open, deliberately.
"""

from __future__ import annotations

import pytest

from app.core.retrieval.structured_search import StructuredSearch
from app.core.verification.citation_verdict import verdict_for_citation


class _Passage:
    def __init__(self, text: str):
        self.text = text
        self.ticker = "XYZ"
        self.filing_date = "2025-11-01"
        self.chunk_id = "c1"


def _row(value: float) -> dict:
    return {"ticker": "XYZ", "period": "FY2025", "metric_name": "Revenues",
            "value_float": value, "unit": "USD", "caption": "",
            "filing_type": "10-K"}


def _rendered(value: float) -> _Passage:
    return _Passage(StructuredSearch._fact_line(_row(value)))


def _cite(claim: str, *, fact: float | None = None, **over) -> dict:
    c = {"text": claim, "citation_number": 1, "ticker": "XYZ", **over}
    if fact is not None:
        c.update({"value": fact, "unit": "USD", "xbrl_concept": "Revenues",
                  "fiscal_year": "2025", "period_end": "2025-09-27"})
    return c


def _status(claim: str, value: float, *, fact: float | None = None, **over) -> str:
    return verdict_for_citation(
        _cite(claim, fact=fact, **over), [_rendered(value)]).status


# ── The figure the rendering loses ────────────────────────────────────────


@pytest.mark.parametrize("value", [12_499_000, 2_500_000, 1_499_999, 1_050_000])
def test_a_claim_quoting_the_exact_figure_is_verified_from_the_field(value):
    """
    Each case carries its own control, so the row is pinned as a VERDICT
    CHANGE and not merely as a passing assertion. If the renderer ever becomes
    lossless the control stops failing, and this test says so.
    """
    claim = f"XYZ revenues were ${value:,.0f} in fiscal 2025 [1]."

    assert _status(claim, value) == "conflicting", (
        "the control no longer reproduces the defect: the rendered passage now "
        "contains the exact figure, so this row's evidence needs restating"
    )
    assert _status(claim, value, fact=value) == "verified"


def test_a_large_fact_was_never_affected_and_still_is_not():
    """The rounding is relative-harmless at scale; nothing may change here."""
    v = 416_161_000_000
    claim = f"XYZ revenues were ${v:,.0f} in fiscal 2025 [1]."
    assert _status(claim, v) == "verified"
    assert _status(claim, v, fact=v) == "verified"


# ── The field path must not become a rubber stamp ─────────────────────────


def test_a_wrong_figure_is_still_caught_on_the_field_path():
    """
    The whole risk of grading from fields is that the fact is treated as
    agreement rather than as evidence. A claim stating a figure the fact does
    not hold must still fail.
    """
    assert _status("XYZ revenues were $9,900,000 in fiscal 2025 [1].",
                   2_500_000, fact=2_500_000) == "conflicting"


def test_a_claim_the_fact_does_not_cover_is_uncovered_not_contradicted():
    """
    An exact fact states ONE figure, for one metric, in one period. A claim
    naming a second period is not contradicted by it — absence is not
    contradiction, which is the distinction this layer already draws at length
    for the text path.
    """
    assert _status(
        "XYZ revenues grew to $2,500,000 from $1,900,000 [1].",
        2_500_000, fact=2_500_000) == "partially_supported"


# ── Period comes from the fact, not from a regex over prose ───────────────


def test_the_facts_own_period_answers_the_period_question():
    """
    The fact declares its fiscal year, so a claim naming that year agrees with
    it whatever the passage's prose happens to mention.
    """
    v = 2_500_000
    assert _status(f"XYZ revenues were ${v:,.0f} in fiscal 2025 [1].",
                   v, fact=v) == "verified"


def test_a_claim_about_a_period_the_fact_denies_still_conflicts():
    """Widening the period evidence may not switch the check off."""
    v = 2_500_000
    assert _status(f"XYZ revenues were ${v:,.0f} in fiscal 2019 [1].",
                   v, fact=v) == "conflicting"


# ── A citation with no fields is graded exactly as before ─────────────────


def test_a_citation_without_fields_is_unchanged():
    """
    Most retrieval is prose and carries nothing. The text path is the honest
    fallback for it and this row may not disturb it.
    """
    passage = _Passage("XYZ reported revenues of $2,500,000 for fiscal 2025.")
    claim = "XYZ revenues were $2,500,000 in fiscal 2025 [1]."
    assert verdict_for_citation(
        {"text": claim, "citation_number": 1, "ticker": "XYZ"},
        [passage]).status == "verified"
