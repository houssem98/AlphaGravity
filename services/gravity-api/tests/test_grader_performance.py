"""
Performance guards on the grader, because round 5 made it substantially heavier.

Rounds 4 and 5 added a metric lexicon walk, per-metric span extraction, row-label
boundary detection, citation-marker parsing and a reading-level scale flag —
every one of them regex work, and every one inside the loop that scores a case.
The eval harness runs `score_answer` across a whole case set, so an
order-of-magnitude regression here is felt on every benchmark run.

**These are regression detectors, not benchmarks.** The bounds are roughly ten
times the measured cost so that a loaded or slow machine does not fail them; the
thing they catch is an accidental O(n²) or a regex that backtracks
catastrophically, not a twenty-percent drift.

Measured when written: `score_answer` averages **1.5 ms** on a real filing
excerpt with two claims.

**What this does NOT measure.** It measures the grader, in-process, with no
network. It says nothing about the pipeline's end-to-end latency against real
retrieval and a real model, which needs the live environment this repository
does not have. Claiming otherwise would be the overclaiming these rounds exist
to remove.
"""

from __future__ import annotations

import json
import time
from pathlib import Path

import pytest

from eval.head_to_head.rubric import _claim_is_bound, _is_primary, score_answer
from tests.real_sec_fixtures import UAL_RESULTS

_CASES = json.loads(
    (Path(__file__).resolve().parents[1] / "eval" / "head_to_head" /
     "cases.json").read_text(encoding="utf-8")
)["cases"]
CASE = next(c for c in _CASES if c.get("expect_value"))

ANSWER = ("United operating revenue was $59,070 million [1]. "
          "Operating income was $4,713 million [1].")


def _mean_ms(fn, n: int) -> float:
    for _ in range(10):          # warm the regex caches
        fn()
    start = time.perf_counter()
    for _ in range(n):
        fn()
    return (time.perf_counter() - start) / n * 1000


def test_scoring_one_case_stays_fast():
    """~1.5 ms when written. Ten times that catches a real regression."""
    ms = _mean_ms(
        lambda: score_answer(CASE, ANSWER, citations=[UAL_RESULTS]), 200)
    assert ms < 15.0, (
        f"score_answer averaged {ms:.2f} ms, against ~1.5 ms when this guard "
        f"was written. Something in the scoring path got an order of magnitude "
        f"more expensive."
    )


def test_scoring_scales_roughly_linearly_in_citation_count():
    """
    The real algorithmic risk. `_metric_spans` runs `finditer` for every metric
    in the lexicon against every excerpt, so a careless change makes the cost
    quadratic in citations — invisible on a one-citation fixture and painful on
    a real answer carrying twenty.
    """
    one = _mean_ms(
        lambda: score_answer(CASE, ANSWER, citations=[UAL_RESULTS]), 100)
    twenty = _mean_ms(
        lambda: score_answer(CASE, ANSWER, citations=[UAL_RESULTS] * 20), 50)

    # Linear would be ~20x. Allow 60x for constant overhead and noise; a
    # quadratic term would show as ~400x.
    assert twenty < one * 60 + 5.0, (
        f"one citation {one:.2f} ms, twenty citations {twenty:.2f} ms. That "
        f"growth is steeper than linear and suggests the citation loop gained "
        f"a nested pass."
    )


#: Built inside the test, never parametrised directly: a 32 KB parameter ends
#: up in the pytest node id, which a plugin writes to an environment variable,
#: and Windows caps those at 32767 characters. That surfaced as an
#: INTERNALERROR rather than a failure — a crash in the harness, not the code.
_HOSTILE = {
    "repeated-metric": ("revenue ", 4000),
    "repeated-figure": ("$1,234,567.89 ", 3000),
    "repeated-marker": ("[1]", 5000),
    "repeated-table-row": ("Operating revenue $ 59,070 Operating expense 54,356 ", 400),
}


@pytest.mark.parametrize("shape", sorted(_HOSTILE))
def test_no_catastrophic_backtracking_on_hostile_text(shape):
    """
    Round 5 added `_ROW_LABEL`, `_CITE_MARKER` and the accession pattern, all
    of which run over citation text the grader did not author. A regex that
    backtracks catastrophically would hang the eval rather than fail it, which
    is the worse failure mode.
    """
    unit, count = _HOSTILE[shape]
    hostile = unit * count
    start = time.perf_counter()
    _claim_is_bound("Revenue was $59,070 million [1].", [{"text": hostile}])
    _is_primary([{"source_class": "structured", "id": hostile[:200]}])
    elapsed = time.perf_counter() - start
    assert elapsed < 2.0, (
        f"took {elapsed:.2f}s on {len(hostile)} characters of hostile text; a "
        f"pattern is backtracking rather than scanning."
    )


def test_the_primary_check_is_cheap_enough_to_call_per_citation():
    """`_is_primary` runs on every citation of every case in a benchmark run."""
    ms = _mean_ms(lambda: _is_primary([UAL_RESULTS]), 2000)
    assert ms < 1.0, f"_is_primary averaged {ms:.3f} ms per citation"
