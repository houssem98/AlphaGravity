"""
The rubric must not hand out primary-source credit the system itself refuses.

Round 2 tightened `FinalGate` so a corpus prose chunk (`LOCAL_EVIDENCE`) and a
web page (`WEB_EVIDENCE`) are not filed figures, then left the benchmark
asserting the opposite. A grader more permissive than the thing it grades
cannot certify it: every answer the gate would mark unsupported still scores
the full evidence weight.

`structured` is the case that must not be over-corrected. `structured_search`
reads the `financials` table, where a `%_xbrl`-suffixed id is an exactly-tagged
filing fact and everything else is a scrape backfill — the retrieval layer
already splits on this with `flt["id"] = "like.*_xbrl"`. So `structured` is
primary when the row is an `_xbrl` row and not otherwise. Dropping the class
wholesale would blind the rubric to the most authoritative rows it can see.
"""

from __future__ import annotations

import pytest

from app.core.finance.answer_contract import PRIMARY, PRIMARY_ALIASES
from eval.head_to_head.rubric import _is_primary


# ── T1: a corpus prose chunk is not a filed figure ────────────────────────


@pytest.mark.parametrize("cls", ["LOCAL_EVIDENCE", "local_evidence"])
def test_local_evidence_is_not_a_primary_filing(cls):
    """`FinalGate` excludes it by name; the rubric must agree."""
    assert _is_primary([{"source_class": cls}]) is False


def test_web_evidence_is_not_a_primary_filing():
    """Already true. Pinned so the T1 fix cannot drift it back."""
    assert _is_primary([{"source_class": "WEB_EVIDENCE"}]) is False


# ── T2: `structured` is primary only for an exactly-tagged XBRL row ───────


def test_a_structured_backfill_row_is_not_a_primary_filing():
    """A unitless scrape of a filed line is not the filed figure."""
    cite = {"source_class": "structured",
            "id": "AMD_Cost_of_revenue_2026-05-20_backfill"}
    assert _is_primary([cite]) is False


def test_a_structured_xbrl_row_is_a_primary_filing():
    """The guard against over-correcting: `_xbrl` rows ARE filed facts."""
    cite = {"source_class": "structured",
            "id": "AMD_CostOfGoodsAndServicesSold_FY2025_xbrl"}
    assert _is_primary([cite]) is True


def test_a_structured_row_with_no_id_is_not_a_primary_filing():
    """Unknown provenance is unproven provenance, the gate's own rule."""
    assert _is_primary([{"source_class": "structured"}]) is False


# ── The relationship, asserted directly rather than by restating a list ───


@pytest.mark.parametrize(
    "cls",
    sorted({c.value for c in PRIMARY} | set(PRIMARY_ALIASES)),
)
def test_every_class_the_gate_calls_primary_still_scores_primary(cls):
    """
    The fix must not trade a permissive rubric for a blind one.

    Asserted against `answer_contract`'s own sets, so widening the gate cannot
    silently leave the rubric behind — the R14 failure pointing the other way.
    """
    assert _is_primary([{"source_class": cls}]) is True
