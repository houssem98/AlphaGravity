"""R14 — the gate and the pipeline disagree about what a filing is called.

Found while writing L2's guard test, and in neither audit.

`FinalGate` decides `primary_source` by comparing a citation's `source_class`
against `PRIMARY`, which is `{"sec_filing", "sec_xbrl"}`. The pipeline stamps
its citations in `citation_provenance.payload()`, which writes
`source_class: "SEC_EVIDENCE"` — a different vocabulary for the same idea:

    contract layer     sec_filing · sec_xbrl · earnings_call · analyst · news · web
    provenance layer   SEC_EVIDENCE · LOCAL_EVIDENCE · WEB_EVIDENCE

The two were never reconciled, so a citation to a real 10-K, with an accession,
a CIK and `verification_status: verified`, does not satisfy "contract requires a
primary filing". Every SEC-cited answer fails that clause.

This survived because the gate's own tests supply the literal string the gate
wants — `[{"source_class": "sec_filing"}]` — which the pipeline never produces.
The gate was tested against a vocabulary that does not exist upstream of it.

Two consequences, and the second is why this blocks L2:

1. `answer_contract_violated` has been logging on essentially every finance
   answer, so the warning carries no signal.
2. L2 makes the cache store only answers whose verdict PASSED. On top of this
   defect that refuses ~every finance answer, which would disable the cache
   rather than tighten it.

The fix normalises at the gate boundary rather than changing what the pipeline
emits: `SEC_EVIDENCE` is a wire value that the frontend, the API schema and the
research layer all already branch on, and rewriting it to satisfy an internal
check would be a wide, outward-facing change to close a narrow one.
"""

from __future__ import annotations

import pytest

from app.core.finance.answer_contract import FinalGate, build_contract
from app.core.finance.query_plan import plan_query
from tests.test_quick_answer_pipeline_e2e import (
    GOOD_ANSWER,
    PASSAGES,
    _Client,
    _Orchestrator,
    _QueryUnderstander,
    _Router,
    _run,
)


def _contract(q="Copart revenue FY2025"):
    return build_contract(plan_query(q))


# What `citation_provenance.payload()` actually attaches to a verified SEC
# citation. Not a hand-written guess: these are the keys that function writes.
PIPELINE_SEC_CITATION = {
    "source_class": "SEC_EVIDENCE",
    "issuer": "NVIDIA CORP",
    "cik": 1045810,
    "form": "10-K",
    "accession": "0001045810-25-000023",
    "verification_status": "verified",
}


# ── the defect, at the unit boundary ──────────────────────────────────────


def test_the_gate_accepts_the_source_class_the_pipeline_actually_emits():
    r = FinalGate.check(_contract(), answer="Revenue was $4.6B in FY2025 [1].",
                        citations=[PIPELINE_SEC_CITATION])
    assert r.passed, (
        f"a citation to a real filing was rejected as non-primary because the "
        f"pipeline spells the class SEC_EVIDENCE and the gate expects "
        f"sec_filing: {r.violations}"
    )


# ── the defect, through the pipeline ──────────────────────────────────────


@pytest.mark.asyncio
async def test_a_normal_sec_backed_answer_passes_the_gate_end_to_end():
    """The property that matters: the gate passes an answer that did nothing wrong."""
    pipeline_ = __import__("app.core.search_pipeline", fromlist=["SearchPipeline"])
    pipe = pipeline_.SearchPipeline(
        llm_router=_Router(_Client(GOOD_ANSWER)),
        retrieval_orchestrator=_Orchestrator(PASSAGES),
        reranker=None,
        query_understander=_QueryUnderstander(),
        citation_validator=None,
        semantic_cache=None,
    )

    events = await _run(pipe)
    answers = [e for e in events if e.type == "answer"]
    gate = answers[-1].data.get("contract_gate")

    assert gate is not None, "no verdict on the answer event"
    assert gate["passed"], (
        f"a well-formed, correctly cited SEC answer fails its own contract, so "
        f"the gate's verdict carries no signal: {gate['violations']}"
    )


# ── the guards: the clause must still mean something ──────────────────────


def test_a_web_citation_is_still_not_a_primary_filing():
    """Normalising must not turn the clause into a rubber stamp."""
    r = FinalGate.check(_contract(), answer="Revenue was $4.6B [1].",
                        citations=[{"source_class": "WEB_EVIDENCE"}])
    assert not r.passed
    assert any("primary filing" in v for v in r.violations)


def test_a_local_prose_citation_is_still_not_a_primary_filing():
    """`LOCAL_EVIDENCE` is a corpus chunk, which is not a filed figure."""
    r = FinalGate.check(_contract(), answer="Revenue was $4.6B [1].",
                        citations=[{"source_class": "LOCAL_EVIDENCE"}])
    assert not r.passed
    assert any("primary filing" in v for v in r.violations)


def test_news_and_analyst_classes_are_unaffected():
    for cls in ("news", "analyst", "earnings_call"):
        r = FinalGate.check(_contract(), answer="Revenue was $4.6B [1].",
                            citations=[{"source_class": cls}])
        assert not r.passed, f"{cls} was accepted as a primary filing"


def test_the_contract_vocabulary_still_works():
    """The existing spelling must keep passing; this widens, never replaces."""
    for cls in ("sec_filing", "sec_xbrl"):
        r = FinalGate.check(_contract(), answer="Revenue was $4.6B in FY2025 [1].",
                            citations=[{"source_class": cls}])
        assert r.passed, f"{cls} stopped counting as primary: {r.violations}"


def test_an_unknown_source_class_is_not_primary():
    r = FinalGate.check(_contract(), answer="Revenue was $4.6B [1].",
                        citations=[{"source_class": "SOMETHING_NEW"}])
    assert not r.passed
