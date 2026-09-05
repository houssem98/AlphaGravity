"""
R8 QA-11 / roadmap §6 — metric to value binding.

**V21 is closed, by QA-10 rather than by this row.** It was
`edge-metric-figure-transposed`, pinned in `KNOWN_SHARED_EDGE_GAPS` since round
6: both figures real, both metrics real, each attached to the other's row. Its
recorded cause was the T9 caveat, and V38's rule — every asserted figure must
be grounded — removed it. The rig reported its own closure and that set is now
empty. Note the asymmetry, which is recorded rather than smoothed: the GRADER
now refuses it; production still does not notice.

**V39 — a metric whose name contains another metric's name was silently
unconstrained.** `_metric_spans` runs a metric's span from its own mention to
the next metric mention, and the boundary search was `s > h.start()`. So:

    'Operating income'  matches at 218..234
    a rival metric      matches at 228   <- INSIDE the name
    span                'Operating '     <- no figures, dropped
    _metric_spans       None

`_binds` then took its no-span path and searched the WHOLE excerpt, so a claim
about operating income bound against the income-before-taxes row beside it.
Measured on United's real table before the fix:

    "operating income was $4,306 million"   -> bound   (that is income before taxes)
    "net income was $953 million"           -> bound   (that is income tax expense)

Both figures are real and both belong to the wrong metric — exactly the class
§6 names. The boundary is now the end of the metric's NAME.

**V40 — a per-share figure is not extracted as an asserted level, and is NOT
fixed here.** `_ASSERTED` does not match a bare `$10.12`, so a fabricated EPS
beside a true revenue figure is invisible to the grader: the sentence's levels
are `{59070000000.0}` alone. Widening extraction would make every bare currency
amount required-to-bind under V38's rule, which is a large blast radius stacked
directly on a large one. It is pinned with its measurement instead.
"""

from __future__ import annotations

import pytest

from eval.head_to_head.rubric import _asserted_split, _claim_is_bound, _metric_spans
from tests.real_sec_fixtures import UAL_RESULTS

CITE = [UAL_RESULTS]
TEXT = UAL_RESULTS["text"]

# (in millions) 2025 2024 2023
#   Operating revenue   59,070  57,063  53,717
#   Operating expense   54,356  51,967  49,506
#   Operating income     4,713   5,096   4,211
#   Nonoperating expense  (408)   (928)   (824)
#   Income before taxes  4,306   4,168   3,387
#   Income tax expense     953   1,019     769
#   Net income           3,353   3,149   2,618


# ── V39 — every metric in the table gets a span ───────────────────────────


@pytest.mark.parametrize("key", ["revenue", "operating_income", "net_income"])
def test_v39_a_metric_present_in_the_table_has_a_span(key):
    """`operating_income` and `net_income` both returned None, though both are
    labelled rows with figures. A metric with no span is a metric with no
    constraint."""
    spans = _metric_spans(TEXT, key)
    assert spans, f"{key} is in the table and produced no span"


def test_v39_the_span_stops_at_the_next_row():
    """It must reach its own figures and not the next row's."""
    span = _metric_spans(TEXT, "operating_income")[0]
    assert "4,713" in span
    assert "4,306" not in span, "income before taxes leaked into operating income"


@pytest.mark.parametrize("claim,taken_from", [
    ("United operating income was $4,306 million in FY2025 [1].",
     "income before income taxes"),
    ("United net income was $953 million in FY2025 [1].",
     "income tax expense"),
])
def test_v39_a_real_figure_from_the_wrong_row_does_not_bind(claim, taken_from):
    """Both figures are real and in this table. Both belong to another
    metric."""
    assert _claim_is_bound(claim, CITE) is False, taken_from


@pytest.mark.parametrize("claim", [
    "United operating revenue was $59,070 million in FY2025 [1].",
    "United operating income was $4,713 million in FY2025 [1].",
    "United net income was $3,353 million in FY2025 [1].",
])
def test_v39_the_correct_row_still_binds(claim):
    """The control, one per metric that was broken. A span rule that reaches
    nothing has replaced one failure with another."""
    assert _claim_is_bound(claim, CITE) is True


def test_v39_a_margin_beside_an_absolute_is_not_penalised():
    """A percentage stated alongside a figure is a rate, graded separately, and
    must not be demanded of the table."""
    assert _claim_is_bound(
        "United operating revenue was $59,070 million at a 8.0% operating "
        "margin in FY2025 [1].", CITE) is True


# ── V21 — closed by QA-10, recorded here because this row owns it ─────────


def test_v21_the_transposed_metric_claim_no_longer_binds():
    """
    Both figures real, each on the other's row — the shape §6 exists for, and
    `KNOWN_SHARED_EDGE_GAPS`'s only member from round 6 until this round.
    """
    assert _claim_is_bound(
        "United Airlines operating revenue was $54,356 million and operating "
        "expense was $59,070 million in 2025 [1].", CITE) is False


# ── V40 — a per-share figure is not asserted. PINNED, NOT FIXED ───────────


def test_v40_a_bare_per_share_figure_is_not_an_asserted_level():
    """
    PINNED DEFECT. `_ASSERTED` does not match `$10.12`, so a sentence's EPS
    claim never becomes a value the grader checks.
    """
    levels, _ = _asserted_split(
        "United operating revenue was $59,070 million and diluted EPS was "
        "$10.12 in FY2025.")
    assert levels == {59_070_000_000.0}, (
        "V40 moved: per-share figures are now extracted. Delete this pin and "
        "assert the EPS claim is checked."
    )


def test_v40_a_fabricated_eps_beside_a_true_figure_still_binds():
    """
    The consequence, and why it is recorded rather than left implicit. EPS
    appears nowhere in this table, so `$10.12` is fabricated as far as this
    citation goes, and the sentence binds on the revenue figure alone.

    Not fixed here: widening `_ASSERTED` to bare currency amounts would make
    every such figure required-to-bind under V38's rule, which is a large blast
    radius stacked directly on a large one in the same round.
    """
    assert _claim_is_bound(
        "United operating revenue was $59,070 million and diluted EPS was "
        "$10.12 in FY2025 [1].", CITE) is True, (
        "V40 moved: the fabricated EPS is now caught. Delete this pin and "
        "assert False."
    )
