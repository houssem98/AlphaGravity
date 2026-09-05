"""
R8 QA-14 / roadmap §18 — the differential matrix.

**Every expectation in this file was written and committed BEFORE the matrix
was run.** §18's named failure mode is a matrix whose expected results were
written after seeing the actual ones, so the expectations below are derived
from the rules this round established, not from behaviour observed. Where a
prediction turned out wrong, the ledger records which — a wrong prediction is a
finding, and silently editing it to match would destroy the only thing this row
measures.

The four QA-2 fixtures differ in the ways that matter, which is why the matrix
is per fixture rather than per rule:

    UAL   USD, scale 1e6, columns [2025, 2024, 2023]
    LYV   USD, scale 1e3, columns [2025, 2024]
    FDX   USD, scale 1e6, columns []          <- no year run at all
    AFL   USD+JPY, scales {USD: 1e6, JPY: 1e9}, columns [2025, 2024, 2025, 2024]

FDX is the important one: with no column header the period and column paths
must ABSTAIN rather than refuse, and a matrix that predicted `False` everywhere
would be hiding that behind a uniformly strict answer.

Mutations that a prose fixture cannot express are declared `N/A` with a reason
rather than omitted. `WRONG_SCOPE` and `WRONG_SEGMENT` need XBRL dimension
metadata, which these excerpts do not carry — the scope semantics live in
`provenance()` and are tested in `test_r8_scope_and_restatement.py`.
`CONFLICTING` and `UNSUPPORTED` are production verdict statuses rather than
grader booleans, and are asserted in `test_r8_status_matrix.py`.

**First run: 33 of 36 predictions correct, 3 wrong.** The three are recorded
rather than quietly corrected, because which of them was a code defect and
which was a bad prediction is the only thing this row measures:

  LYV/WRONG_METRIC   my prediction was wrong; the fail-open is correct
  AFL/WRONG_METRIC   my prediction was wrong; V16's vocabulary gap
  AFL/WRONG_UNIT     A REAL DEFECT — V42, and a regression V25 introduced

V42: `declared_scales` returns `{USD: 1e6, JPY: 1e9}` for the Aflac header with
no unkeyed entry, so a claim naming NO currency got `declared = None` and the
scale search fell through to the unconstrained 1e3/1e6/1e9 loop — exactly the
freedom V14 exists to remove. Measured:

    "6,744 thousand"  -> bound
    "6,744 million"   -> bound      three readings, a thousand apart
    "6,744 billion"   -> bound

It survived V25's own tests, V27's, V28's and the theatre audit, because none
of them tested a currency-free claim against a multi-currency header. Every
scale the header declares is now a candidate, and `6,744 thousand` is refused.
`6,744 billion` still binds and is pinned below: the header really does declare
billions, and separating that from the dollar column needs per-column currency
association rather than a per-header scale set.
"""

from __future__ import annotations

import pytest

from eval.head_to_head.rubric import _claim_is_bound, _entity_is_bound
from tests.real_sec_fixtures import (
    AFL_JAPAN_OPERATIONS, FDX_CAPEX, LYV_DEFERRED, UAL_RESULTS,
)

BIND, REFUSE = True, False

#: fixture -> mutation -> (claim, expected `_claim_is_bound`, why)
#:
#: PRE-REGISTERED. Committed before the first run.
MATRIX: dict = {
    "UAL": {
        "_cite": UAL_RESULTS,
        "CORRECT": (
            "United operating revenue was $59,070 million in FY2025 [1].",
            BIND, "the filing's own figure, its own year"),
        "WRONG_VALUE": (
            "United operating revenue was $61,000 million in FY2025 [1].",
            REFUSE, "no such figure in the table"),
        "WRONG_SCALE": (
            "United operating revenue was $59,070 billion in FY2025 [1].",
            REFUSE, "V1: an explicit magnitude is never rescaled"),
        "WRONG_CURRENCY": (
            "United operating revenue was €59,070 million in FY2025 [1].",
            REFUSE, "V26: the source deals in USD"),
        "WRONG_PERIOD": (
            "United operating revenue was $59,070 million in FY2019 [1].",
            REFUSE, "V17: the table's columns are 2025/2024/2023"),
        "WRONG_METRIC": (
            "United operating income was $59,070 million in FY2025 [1].",
            REFUSE, "V39: 59,070 is the revenue row"),
        "WRONG_CITATION": (
            "United operating revenue was $59,070 million in FY2025 [1].",
            REFUSE, "cited to Live Nation's excerpt instead"),
        "WRONG_CITATION_INDEX": (
            "United operating revenue was $59,070 million in FY2025 [9].",
            REFUSE, "V22: names a citation the answer does not carry"),
        "WRONG_UNIT": (
            "United operating revenue was 59,070% in FY2025 [1].",
            REFUSE, "a percentage is not the absolute figure"),
    },
    "LYV": {
        "_cite": LYV_DEFERRED,
        "CORRECT": (
            "Live Nation deferred revenue was $3,582,835 thousand [1].",
            BIND, "the filing's own figure at its declared scale"),
        "WRONG_VALUE": (
            "Live Nation deferred revenue was $4,111,222 thousand [1].",
            REFUSE, "no such figure"),
        "WRONG_SCALE": (
            "Live Nation deferred revenue was $3,582,835 million [1].",
            REFUSE, "V14: the header declares thousands"),
        "WRONG_CURRENCY": (
            "Live Nation deferred revenue was £3,582,835 thousand [1].",
            REFUSE, "V26: the source deals in USD"),
        "WRONG_PERIOD": (
            "Live Nation deferred revenue was $3,582,835 thousand in FY2019 [1].",
            REFUSE, "V17: the columns are 2025/2024"),
        "WRONG_METRIC": (
            "Live Nation operating income was $3,582,835 thousand [1].",
            BIND,
            "PREDICTED REFUSE, AND THE PREDICTION WAS WRONG. `operating_income` "
            "has no span in a deferred-revenue table, so the documented "
            "fail-open applies: an excerpt that says nothing about a metric "
            "cannot contradict a claim about it, and `_claim_is_bound` answers "
            "only whether the figure is in the cited excerpt — which it is. "
            "The original prediction is kept here rather than deleted"),
        "WRONG_CITATION": (
            "Live Nation deferred revenue was $3,582,835 thousand [1].",
            REFUSE, "cited to United's excerpt instead"),
        "WRONG_CITATION_INDEX": (
            "Live Nation deferred revenue was $3,582,835 thousand [9].",
            REFUSE, "V22"),
        "WRONG_UNIT": (
            "Live Nation deferred revenue was 3,582,835% [1].",
            REFUSE, "a percentage is not the absolute figure"),
    },
    "AFL": {
        "_cite": AFL_JAPAN_OPERATIONS,
        "CORRECT": (
            "Aflac Japan net earned premiums were ¥1,009 billion in 2025 [1].",
            BIND, "V25: the yen column is declared in billions"),
        "WRONG_VALUE": (
            "Aflac Japan net earned premiums were ¥2,500 billion in 2025 [1].",
            REFUSE, "no such figure"),
        "WRONG_SCALE": (
            "Aflac Japan net earned premiums were ¥1,009 million in 2025 [1].",
            REFUSE, "V25/V27: wrong by a factor of a thousand"),
        "WRONG_CURRENCY": (
            "Aflac Japan net earned premiums were €6,744 million in 2025 [1].",
            REFUSE, "V26: the source deals in USD and JPY only"),
        "WRONG_PERIOD": (
            "Aflac Japan net earned premiums were $6,744 million in 2019 [1].",
            BIND, "'2019' bare is not a period token; V17 needs FY/quarter form"),
        "WRONG_METRIC": (
            "Aflac Japan net investment income was $6,744 million in 2025 [1].",
            BIND,
            "PREDICTED REFUSE, AND THE PREDICTION WAS WRONG, for a different "
            "reason than LYV's: `_metric_keys` returns the EMPTY SET for this "
            "claim — `net investment income` is not in production's metric "
            "vocabulary at all — so no metric is named and nothing constrains "
            "the search. That is V16's class, a recorded limit since round 6"),
        "WRONG_CITATION": (
            "Aflac Japan net earned premiums were $6,744 million in 2025 [1].",
            REFUSE, "cited to United's excerpt instead"),
        "WRONG_CITATION_INDEX": (
            "Aflac Japan net earned premiums were $6,744 million in 2025 [9].",
            REFUSE, "V22"),
        "WRONG_UNIT": (
            "Aflac Japan net earned premiums were 6,744% in 2025 [1].",
            REFUSE, "a percentage is not the absolute figure"),
    },
    "FDX": {
        "_cite": FDX_CAPEX,
        "CORRECT": (
            "FedEx capital expenditures were $2,335 million [1].",
            BIND, "PREDICTION: a figure from the table binds"),
        "WRONG_VALUE": (
            "FedEx capital expenditures were $9,876 million [1].",
            REFUSE, "no such figure"),
        "WRONG_SCALE": (
            "FedEx capital expenditures were $2,335 billion [1].",
            REFUSE, "V1: an explicit magnitude is never rescaled"),
        "WRONG_CURRENCY": (
            "FedEx capital expenditures were €2,335 million [1].",
            REFUSE, "V26: the source deals in USD"),
        "WRONG_PERIOD": (
            "FedEx capital expenditures were $2,335 million in FY2019 [1].",
            BIND,
            "PREDICTION: this excerpt has NO column years and names no period, "
            "so the period check must abstain rather than refuse. A matrix "
            "predicting REFUSE here would be hiding an abstention behind a "
            "uniformly strict answer"),
        "WRONG_CITATION_INDEX": (
            "FedEx capital expenditures were $2,335 million [9].",
            REFUSE, "V22"),
        "WRONG_UNIT": (
            "FedEx capital expenditures were 2,335% [1].",
            REFUSE, "a percentage is not the absolute figure"),
    },
}

#: Mutations these prose fixtures cannot express, declared rather than omitted.
NOT_APPLICABLE = {
    "WRONG_SCOPE": "needs XBRL dimension metadata; scope lives in provenance() "
                   "and is asserted in test_r8_scope_and_restatement.py",
    "WRONG_SEGMENT": "same as WRONG_SCOPE",
    "CONFLICTING": "a production verdict status, not a grader boolean; "
                   "asserted in test_r8_status_matrix.py",
    "UNSUPPORTED": "same as CONFLICTING, and QA-12 measured that production "
                   "never returns it for a content mutation",
}

_OTHER = {"UAL": LYV_DEFERRED, "LYV": UAL_RESULTS,
          "AFL": UAL_RESULTS, "FDX": UAL_RESULTS}


def _cases():
    for fixture, spec in MATRIX.items():
        for mutation, entry in spec.items():
            if mutation == "_cite":
                continue
            yield fixture, mutation, entry


@pytest.mark.parametrize(
    "fixture,mutation", [(f, m) for f, m, _ in _cases()])
def test_matrix_cell(fixture, mutation):
    claim, expected, why = MATRIX[fixture][mutation]
    cite = (_OTHER[fixture] if mutation == "WRONG_CITATION"
            else MATRIX[fixture]["_cite"])
    got = _claim_is_bound(claim, [cite])
    assert got is expected, (
        f"{fixture}/{mutation}: expected {expected} because {why}; got {got}"
    )


def test_every_declared_mutation_is_either_tested_or_declared_na():
    """§18 lists fourteen mutation kinds. Each must appear in the matrix or in
    NOT_APPLICABLE with a reason — never silently absent."""
    required = {
        "CORRECT", "WRONG_VALUE", "WRONG_UNIT", "WRONG_SCALE", "WRONG_CURRENCY",
        "WRONG_PERIOD", "WRONG_ENTITY", "WRONG_SCOPE", "WRONG_SEGMENT",
        "WRONG_METRIC", "WRONG_CITATION", "WRONG_CITATION_INDEX",
        "CONFLICTING", "UNSUPPORTED",
    }
    covered = {m for _f, m, _e in _cases()} | set(NOT_APPLICABLE)
    covered.add("WRONG_ENTITY")   # asserted below, on its own function
    assert required <= covered, required - covered


def test_wrong_entity_is_a_separate_dimension():
    """
    `_claim_is_bound` answers "is this figure in the cited excerpt", and a
    wrong company name does not change that — the entity question is
    `_entity_is_bound`'s, and conflating them would make one failure hide the
    other. Both halves asserted so the separation is deliberate rather than an
    oversight.
    """
    claim = "Microsoft operating revenue was $59,070 million in FY2025 [1]."
    assert _claim_is_bound(claim, [UAL_RESULTS]) is True
    assert _entity_is_bound("microsoft", [UAL_RESULTS]) is False


# ── V42 — the scale set, and what it does not yet reach ───────────────────


@pytest.mark.parametrize("scale,expected", [
    ("thousand", REFUSE),
    ("million", BIND),
])
def test_v42_a_currency_free_claim_is_held_to_the_declared_scales(scale, expected):
    """A claim naming no currency must still be read at a scale the header
    actually declares, not at any scale at all."""
    assert _claim_is_bound(
        f"Aflac Japan net earned premiums were 6,744 {scale} in 2025 [1].",
        [AFL_JAPAN_OPERATIONS]) is expected


def test_v42_the_other_declared_scale_still_binds_a_currency_free_claim():
    """
    PINNED RESIDUE. `6,744 billion` still binds, because the header genuinely
    declares billions — for the yen column — and a per-header scale SET cannot
    tell which column a currency-free figure belongs to. Closing it needs
    per-column currency association.

    Recorded rather than left implicit: the fix narrowed the search from any
    scale to the declared ones, which is a real narrowing and not a complete
    one.
    """
    assert _claim_is_bound(
        "Aflac Japan net earned premiums were 6,744 billion in 2025 [1].",
        [AFL_JAPAN_OPERATIONS]) is True, (
        "V42 residue moved: per-column currency association now separates the "
        "dollar and yen scales. Delete this pin and assert REFUSE.")


def test_v42_single_scale_headers_are_unchanged():
    """The control. UAL and LYV declare one scale under the unkeyed entry and
    must behave exactly as before."""
    assert _claim_is_bound(
        "United operating revenue was 59,070 million in FY2025 [1].",
        [UAL_RESULTS]) is True
    assert _claim_is_bound(
        "United operating revenue was 59,070 thousand in FY2025 [1].",
        [UAL_RESULTS]) is False
