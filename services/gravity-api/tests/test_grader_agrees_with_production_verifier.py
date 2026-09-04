"""
Differential contract: the benchmark grader may not be laxer than production.

The sixth audit named this as the real antidote, and it is right about why.
Every previous round fixed the defects someone thought to write a test for, and
every round after found more. Hand-written cases are bounded by the author's
imagination, which is the mechanism behind R14, T13, U1, V11 and V15 alike.

The shape:

                     one financial fact
                            |
              +-------------+-------------+
              v                           v
      production verifier          benchmark grader
     (citation_verdict)          (rubric._claim_is_bound)
              |                           |
              +-------------+-------------+
                            v
                    must not disagree

**Ground truth is independent of both.** `Fact` below is a hand-declared record
of what a real United Airlines table says — entity, metric, printed figure,
declared scale, period. Neither implementation produces it, and neither is
consulted to decide what the right answer is. The claim sentence and the
evidence excerpt are both rendered *from the Fact*, so a mutation changes the
world rather than changing one grader's opinion of it.

**The invariant is one-directional, deliberately.** The two graders do not have
identical jobs: production checks entity, period and unit conflicts across a
whole citation, while the rubric asks whether a figure is bound. Demanding
identical verdicts would be demanding they be the same function. What round 3
established, and what this pins, is the asymmetry:

    production says UNSUPPORTED  =>  the grader must not call it bound

A benchmark more permissive than the system it grades cannot certify it. That
sentence has been the thesis of three rounds; this file is the first thing that
tests it mechanically rather than one case at a time.
"""

from __future__ import annotations

from dataclasses import dataclass, replace

import pytest

from app.core.verification.citation_verdict import (
    UNSUPPORTED, verdict_for_citation,
)
from eval.head_to_head.rubric import _claim_is_bound
from tests.real_sec_fixtures import FDX_CAPEX, LYV_DEFERRED, UAL_RESULTS


# ── An independent representation of a real filing fact ───────────────────


@dataclass(frozen=True)
class Fact:
    """What the filing says. Declared, not derived from either grader."""

    entity: str = "United Airlines Holdings, Inc."
    ticker: str = "UAL"
    metric: str = "operating revenue"
    face: str = "59,070"        # as printed in the table
    scale_word: str = "millions"  # as the table header declares it
    unit_word: str = "million"    # the singular, for prose
    period: str = "2025"

    def evidence(self) -> str:
        return (
            f"Results of Operations for fiscal {self.period}.\n\n"
            f"(in {self.scale_word}) {self.period} Operating revenue "
            f"$ {self.face} Operating expense 54,356 Operating income 4,713"
        )

    def claim(self) -> str:
        return (f"{self.entity} {self.metric} was ${self.face} "
                f"{self.unit_word} in fiscal {self.period} [1].")


TRUE = Fact()


class _Passage:
    def __init__(self, fact: Fact):
        self.text = fact.evidence()
        self.ticker = fact.ticker
        self.filing_date = f"{fact.period}-12-31"
        self.chunk_id = "c1"


def _production_says_unsupported(claim: str, source: Fact) -> bool:
    v = verdict_for_citation(
        {"text": claim, "citation_number": 1, "ticker": source.ticker},
        [_Passage(source)],
    )
    return v.status == UNSUPPORTED


def _grader_says_bound(claim: str, source: Fact) -> bool:
    return _claim_is_bound(
        claim, [{"text": source.evidence(), "issuer": source.entity,
                 "ticker": source.ticker}]) is True


# ── The undisturbed fact: both must accept it ─────────────────────────────


def test_the_true_fact_is_accepted_by_both():
    """
    Without this, every mutation below could pass because one grader rejects
    everything.
    """
    claim = TRUE.claim()
    assert not _production_says_unsupported(claim, TRUE)
    assert _grader_says_bound(claim, TRUE)


# ── One dimension wrong at a time ─────────────────────────────────────────
#
# Each case mutates the CLAIM away from the fact the evidence states. The
# evidence is always the true filing. The invariant is that wherever production
# calls the result unsupported, the grader may not call it bound.

_MUTATIONS = {
    "unit-too-small": lambda f: replace(f, unit_word="thousand"),
    "unit-too-large": lambda f: replace(f, unit_word="billion"),
    "value-wrong": lambda f: replace(f, face="54,356"),      # the expense row
    "value-transposed": lambda f: replace(f, face="59,700"),
    "period-wrong": lambda f: replace(f, period="2019"),
    "metric-wrong": lambda f: replace(f, metric="operating expense"),
}


@pytest.mark.parametrize("name", sorted(_MUTATIONS))
def test_the_grader_is_never_laxer_than_production(name):
    wrong = _MUTATIONS[name](TRUE)
    claim = wrong.claim()

    production_rejects = _production_says_unsupported(claim, TRUE)
    grader_binds = _grader_says_bound(claim, TRUE)

    assert not (production_rejects and grader_binds), (
        f"mutation {name!r}: the production verifier called this citation "
        f"UNSUPPORTED and the benchmark called the claim bound. A grader more "
        f"permissive than the system it grades cannot certify it.\n"
        f"  claim:    {claim}\n"
        f"  evidence: {TRUE.evidence()[:140]}"
    )


# ── The mutations must actually be wrong, or the test above is vacuous ────


#: Mutations that NEITHER layer currently catches. Found by this file on its
#: first run, and recorded as facts rather than hidden behind an invariant they
#: satisfy trivially.
#:
#: **V16 — `metric-wrong`.** U3's metric check only fires when the claim's
#: metric is in `query_plan._METRIC_RES`. `operating expense` is not, so a claim
#: attributing revenue's figure to expenses gets no metric checking at all. The
#: fix is not another regex: it is either widening production's metric
#: vocabulary, which is a production change made for an eval need, or the
#: canonical evidence layer that carries the metric rather than re-deriving it.
#:
#: **V17 — `period-wrong`.** `_claim_is_bound` does not look at periods; the
#: rubric grades period under `period_entity` instead, and production returns
#: `partially_supported` rather than `UNSUPPORTED` for a period conflict. So a
#: figure quoted against the wrong fiscal year still binds as evidence. That
#: split is arguably deliberate, but the consequence is not obvious from either
#: side alone, which is exactly what a differential test is for.
KNOWN_SHARED_GAPS = {"metric-wrong", "period-wrong"}


@pytest.mark.parametrize("name", sorted(_MUTATIONS))
def test_every_mutation_is_rejected_by_at_least_one_grader(name):
    """
    The bite check. A mutation accepted by BOTH graders is either not really a
    mutation, or a hole they share — and a shared hole is invisible to the
    one-directional invariant above, which it satisfies trivially.

    `KNOWN_SHARED_GAPS` pins the two this file found when it was written. A
    THIRD one fails here, loudly, which is the whole point: the next blind spot
    should be reported by a test rather than by a seventh audit.
    """
    wrong = _MUTATIONS[name](TRUE)
    claim = wrong.claim()
    rejected = (_production_says_unsupported(claim, TRUE)
                or not _grader_says_bound(claim, TRUE))

    if name in KNOWN_SHARED_GAPS:
        assert not rejected, (
            f"mutation {name!r} is recorded as a known shared gap but is now "
            f"caught. That is good news — remove it from KNOWN_SHARED_GAPS so "
            f"the improvement is locked in."
        )
        return

    assert rejected, (
        f"mutation {name!r} was accepted by BOTH the production verifier and "
        f"the benchmark grader. Neither layer notices this error, and it is "
        f"not one of the gaps this file already knew about.\n"
        f"  claim: {claim}"
    )


# ── W2: edge mutations — the wiring, not the values ───────────────────────
#
# Every mutation above is a NODE mutation: one field of the fact is made wrong
# and the claim is re-rendered from it. The class that stays invisible to that
# is the EDGE — every component true of the filing, wired to the wrong thing.
# `claim ──[n]──> citation` is one such edge and the reason `_cited_excerpts`
# exists; `claim ──> {metric, unit, scale, period}` are the others.
#
# These run against `tests.real_sec_fixtures`, not against `Fact`, because an
# edge is a relationship between real spans of filing text and there is nothing
# to cross-wire in a one-row synthetic table.


class _FixturePassage:
    def __init__(self, fx: dict, chunk_id: str):
        self.text = fx["text"]
        self.ticker = fx["ticker"]
        self.filing_date = fx["filing_date"]
        self.chunk_id = chunk_id


UAL_P = _FixturePassage(UAL_RESULTS, "c1")
LYV_P = _FixturePassage(LYV_DEFERRED, "c3")
FDX_P = _FixturePassage(FDX_CAPEX, "c2")


@dataclass(frozen=True)
class Wiring:
    """One claim and the evidence it is attached to, edges included."""

    claim: str
    citation: dict
    passages: tuple
    cites: tuple


def _wire(claim: str, *, number: int, ticker: str, chunk_id: str,
          passages: tuple, cites: tuple) -> Wiring:
    return Wiring(claim,
                  {"text": claim, "citation_number": number,
                   "ticker": ticker, "chunk_id": chunk_id},
                  passages, cites)


#: The undisturbed wiring: United's own figure, cited to United's own table.
TRUE_WIRING = _wire(
    "United Airlines operating revenue was $59,070 million in 2025 [1].",
    number=1, ticker="UAL", chunk_id="c1",
    passages=(UAL_P,), cites=(UAL_RESULTS,))


_EDGE_MUTATIONS = {
    # The figure, the metric and the issuer are all United's. Only the marker
    # is wrong: it names the FedEx capital-expenditure passage, which carries
    # no revenue figure at all. Nothing about the claim is false; the edge is.
    "edge-marker-points-elsewhere": _wire(
        "United Airlines operating revenue was $59,070 million in 2025 [2].",
        number=2, ticker="UAL", chunk_id="c2",
        passages=(UAL_P, FDX_P), cites=(UAL_RESULTS, FDX_CAPEX)),

    # The figure is Live Nation's own printed total and the metric is its own
    # row label. The scale is borrowed from the neighbouring table: `3,582,835`
    # sits under `(in thousands)` and the claim reads it in millions.
    "edge-scale-borrowed-across-tables": _wire(
        "Live Nation deferred revenue was $3,582,835 million [1].",
        number=2, ticker="LYV", chunk_id="c3",
        passages=(UAL_P, LYV_P), cites=(LYV_DEFERRED,)),

    # Every node is United's own and the evidence is United's own table. The
    # only defect is that the marker names a citation the answer does not have.
    # Production calls that UNSUPPORTED; the grader used to fall back to
    # searching every excerpt and bind it anyway (V22).
    "edge-marker-out-of-range": _wire(
        "United Airlines operating revenue was $59,070 million in 2025 [7].",
        number=7, ticker="UAL", chunk_id="c1",
        passages=(UAL_P,), cites=(UAL_RESULTS,)),

    # Both figures are real, both metrics are real, and each is attached to the
    # other's row. This is the edge mutation in its purest form: no node in the
    # claim is false.
    "edge-metric-figure-transposed": _wire(
        "United Airlines operating revenue was $54,356 million and operating "
        "expense was $59,070 million in 2025 [1].",
        number=1, ticker="UAL", chunk_id="c1",
        passages=(UAL_P,), cites=(UAL_RESULTS,)),
}


def _edge_production_says_unsupported(w: Wiring) -> bool:
    return verdict_for_citation(w.citation, list(w.passages)).status == UNSUPPORTED


def _edge_grader_says_bound(w: Wiring) -> bool:
    return _claim_is_bound(w.claim, [dict(c) for c in w.cites]) is True


def test_the_true_wiring_is_accepted_by_both():
    """
    The edge layer's anchor. Without it every case below could pass because one
    side refuses this fixture outright.

    Writing this anchor is what found V19: production called this correct,
    correctly cited claim `conflicting`, and the assertion below could not be
    made until that was closed. See
    `test_v19_production_reads_a_tables_declared_scale`.
    """
    assert verdict_for_citation(
        TRUE_WIRING.citation, list(TRUE_WIRING.passages)).is_verified
    assert _edge_grader_says_bound(TRUE_WIRING)


@pytest.mark.parametrize("name", sorted(_EDGE_MUTATIONS))
def test_the_grader_is_never_laxer_than_production_on_edges(name):
    w = _EDGE_MUTATIONS[name]
    assert not (_edge_production_says_unsupported(w)
                and _edge_grader_says_bound(w)), (
        f"edge mutation {name!r}: production called the citation UNSUPPORTED "
        f"and the benchmark called the claim bound.\n  claim: {w.claim}"
    )


#: Edge mutations neither layer catches. Same contract as `KNOWN_SHARED_GAPS`:
#: recorded as a fact, and asserted to still be true, so that closing one is
#: reported here rather than discovered by the next audit.
#:
#: **V21 — `edge-metric-figure-transposed`.** The grader binds because
#: `_claim_is_bound` works per SENTENCE, not per proposition — the docstring's
#: own T9 caveat — so the true `$59,070 million` sitting beside the transposed
#: figure binds the whole sentence. Production does return `conflicting`, but
#: for V19's reason and not for this one: it rejects the true wiring in exactly
#: the same way, so it is not evidence that this error was noticed.
KNOWN_SHARED_EDGE_GAPS = {"edge-metric-figure-transposed"}


@pytest.mark.parametrize("name", sorted(_EDGE_MUTATIONS))
def test_every_edge_mutation_changes_a_verdict(name):
    """
    The bite check for edges. A mutation that moves neither grader measures
    nothing — the rule that made T8's detector and R4's rig credible.
    """
    w = _EDGE_MUTATIONS[name]
    rejected = (_edge_production_says_unsupported(w)
                or not _edge_grader_says_bound(w))

    if name in KNOWN_SHARED_EDGE_GAPS:
        assert not rejected, (
            f"edge mutation {name!r} is recorded as a known shared gap but is "
            f"now caught. Remove it from KNOWN_SHARED_EDGE_GAPS."
        )
        return

    assert rejected, (
        f"edge mutation {name!r} was accepted by BOTH layers and is not a "
        f"recorded gap.\n  claim: {w.claim}"
    )


# ── What the edge layer found in PRODUCTION ───────────────────────────────
#
# The differential rig was built to find defects in the grader. Its first edge
# run found two in the verifier instead, and both are pinned here in the same
# shape as `KNOWN_SHARED_GAPS`: the current, wrong behaviour is asserted, so
# fixing it fails this file loudly rather than passing unnoticed.


@pytest.mark.parametrize("correct", [
    "United Airlines operating revenue was $59,070 million in 2025.",
    "United Airlines operating revenue was $59.07 billion in 2025.",
    "United Airlines operating revenue was 59,070 in 2025.",
])
def test_v19_production_reads_a_tables_declared_scale(correct):
    """
    **V19 — the exact dual of V14, one layer down, and found by this file.**

    `_IMPLIED_SCALES` lets a bare source figure take its scale from a header
    the passage does not repeat, but the allowance was switched OFF for any
    claim stating its own unit. Real filings declare scale once and print bare
    figures, so a correct claim written the way a good answer writes it —
    `$59,070 million` against `(in millions) ... Operating revenue $ 59,070` —
    was graded `conflicting`, `is_verified` False, and the claim wrong by a
    factor of a thousand received the identical verdict. Measured on the
    unfixed verifier, all three readings below and the wrong one came back
    `conflicting / numeric_not_in_source`.
    """
    v = verdict_for_citation(
        {"text": correct, "citation_number": 1, "ticker": "UAL"}, [UAL_P])
    assert v.status == "verified", v.reasons
    assert v.is_verified


def test_v19_does_not_rescue_the_thousandfold_wrong_reading():
    """The point of reading the header is to tell the two apart, not to accept
    both. Without this, V19's fix would be V14's defect re-introduced."""
    wrong = "United Airlines operating revenue was $59,070 billion in 2025."
    v = verdict_for_citation(
        {"text": wrong, "citation_number": 1, "ticker": "UAL"}, [UAL_P])
    assert v.status == "conflicting"
    assert not v.is_verified


def test_v20_a_citation_marker_is_not_a_claim_figure():
    """
    **V20 — being cited used to cost a citation its verdict.**

    `_scrub` removed form designators and item references, but not `[1]`. The
    marker's integer survived into `claim_nums`, was in no source, and demoted
    an otherwise fully grounded citation from `verified` to
    `partially_supported` — measured, on the unfixed verifier, against the
    identical sentence without its marker, which verified.
    """
    src = _FixturePassage(
        {"text": "Total net sales were $416,161 million for fiscal 2025.",
         "ticker": "AAPL", "filing_date": "2025-11-01"}, "c1")
    marked = "Total net sales were $416,161 million [3]."
    bare = "Total net sales were $416,161 million."

    v_marked = verdict_for_citation(
        {"text": marked, "citation_number": 1, "ticker": "AAPL"}, [src])
    v_bare = verdict_for_citation(
        {"text": bare, "citation_number": 1, "ticker": "AAPL"}, [src])

    assert v_bare.status == "verified"
    assert v_marked.status == "verified", (
        "citing a source may not lower a citation's verdict"
    )
