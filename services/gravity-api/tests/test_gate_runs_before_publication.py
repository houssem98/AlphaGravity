"""L1 / R1, R5 — the gate must run BEFORE the answer is published.

Round 1 verified that `FinalGate.check` is *invoked* and stopped there. It never
asked whether the gate runs *before publication*, which is the property that
actually matters. It does not:

    line 2030   yield SearchEvent(type="answer", ...)   <- answer leaves here
    line 2085   _gate_result = FinalGate.check(...)     <- gate runs here

Fifty-five lines late. By the time the verdict exists the consumer already has
the answer, so the verdict can only ever be a post-mortem. A gate that grades an
answer after the reader has read it is a log line, not a gate.

R5 is the same defect on a second exit that neither audit found: the no-evidence
refusal at line 1257 yields an answer and `return`s before the contract is ever
consulted. The contract's `must_abstain` clause is precisely about the shape of
a refusal, so this is the one exit where the gate has something specific to say.

**Scope.** This pins ORDER and REPORTING only. The gate stays report-only — it
does not refuse, rewrite or suppress anything, and
`test_the_gate_never_rewrites_the_answer` continues to pin that. Making the gate
block is a product decision of the same class as D7, which the owner already
decided (advisory), and is an escalation rather than a loop action.
"""

from __future__ import annotations

import inspect

import pytest

from app.core.search_pipeline import SearchPipeline
from tests.test_quick_answer_pipeline_e2e import (
    GOOD_ANSWER,
    PASSAGES,
    _Client,
    _Orchestrator,
    _QueryUnderstander,
    _Router,
)

FINANCE_QUERY = "What was NVIDIA revenue in FY2025?"


class _OrchestratorWithChannels(_Orchestrator):
    """The no-evidence exit reads `self.retrieval.channels` to tell "not indexed"
    from "SEC was consulted and had nothing". The shared fake has no such
    attribute, so reaching that exit at all needs one here."""

    channels: dict = {}


def _pipeline(passages=PASSAGES, answer=GOOD_ANSWER):
    return SearchPipeline(
        llm_router=_Router(_Client(answer)),
        retrieval_orchestrator=_OrchestratorWithChannels(passages),
        reranker=None,
        query_understander=_QueryUnderstander(),
        citation_validator=None,
        semantic_cache=None,
    )


async def _trace(pipeline, monkeypatch, query=FINANCE_QUERY):
    """Interleaved record of gate calls and answer yields, in execution order.

    The pipeline is an async generator, so it suspends at each yield: appending
    to one list from both the spy and the consumer records the true order rather
    than a reconstruction of it.
    """
    from app.core.finance import answer_contract

    order: list[str] = []
    real = answer_contract.FinalGate.check

    def spy(*a, **kw):
        order.append("gate")
        return real(*a, **kw)

    monkeypatch.setattr(answer_contract.FinalGate, "check", staticmethod(spy))

    events = []
    async for e in pipeline.search(query=query, stream=True,
                                   reasoning_depth="fast", user_id="u1",
                                   trace_id="gate-order"):
        if e.type == "answer":
            order.append("answer")
        events.append(e)
    return order, events


# ── R1: the main answer path ──────────────────────────────────────────────


@pytest.mark.asyncio
async def test_no_answer_event_is_published_before_the_gate_has_run(monkeypatch):
    """The property round 1 never asked about."""
    order, _ = await _trace(_pipeline(), monkeypatch)

    assert "gate" in order, (
        "the gate never ran at all on a finance query; the ordering question "
        "is moot until it does"
    )
    assert order.index("gate") < order.index("answer"), (
        f"the answer was published before the gate ran (order: {order}); the "
        f"verdict can only be a post-mortem"
    )


@pytest.mark.asyncio
async def test_the_answer_event_carries_the_gate_verdict(monkeypatch):
    """A verdict that reaches only the metadata event arrives after the answer.

    The consumer renders on `answer`. If the verdict rides only on `metadata`,
    every client that draws the answer when it arrives draws it ungraded.
    """
    _, events = await _trace(_pipeline(), monkeypatch)

    answers = [e for e in events if e.type == "answer"]
    assert answers, "no answer event"
    gate = answers[-1].data.get("contract_gate")
    assert gate is not None, (
        "the answer event carries no contract_gate; the verdict exists only on "
        "the later metadata event"
    )
    assert "passed" in gate


# ── R5: the no-evidence exit ──────────────────────────────────────────────


@pytest.mark.asyncio
async def test_the_no_evidence_refusal_is_also_gated(monkeypatch):
    """Found while checking R1; in neither audit.

    An early `return` is still a publication. The contract is bound long before
    this exit, so there is nothing to stop the gate running here.
    """
    order, events = await _trace(_pipeline(passages=[]), monkeypatch)

    answers = [e for e in events if e.type == "answer"]
    assert answers, "the no-evidence exit emitted no answer event"
    assert "gate" in order, (
        "the no-evidence exit published a refusal with no gate verdict at all "
        f"(order: {order})"
    )
    assert order.index("gate") < order.index("answer"), (
        f"the refusal was published before the gate ran (order: {order})"
    )


@pytest.mark.asyncio
async def test_the_no_evidence_refusal_reports_its_verdict(monkeypatch):
    _, events = await _trace(_pipeline(passages=[]), monkeypatch)

    answers = [e for e in events if e.type == "answer"]
    gate = answers[-1].data.get("contract_gate")
    assert gate is not None, (
        "the refusal carries no contract_gate, so a reader cannot tell a "
        "checked refusal from an unchecked one"
    )
    # Substantive, not a stub: the gate names the clauses it evaluated. Which
    # clauses those are is contract policy and deliberately not pinned here —
    # a refusal that fails `min_citations` today would legitimately pass it if
    # the exit ever built a `must_abstain` contract instead.
    assert gate.get("checked"), (
        "the refusal carries an empty verdict; the gate returned without "
        "evaluating any clause against this answer"
    )


# ── source order, in addition to the behaviour above, never instead of it ──


def test_a_gate_consultation_precedes_every_answer_yield_in_source():
    """Every publication site, not merely the first.

    `search` has three answer yields — cache hit, no-evidence refusal, and the
    generated answer — and each must consult the gate before it publishes. The
    cache hit consults a RECORDED verdict rather than recomputing one, which is
    the right call on a replay: re-running the gate would grade the same text a
    second time and could disagree with the verdict stored beside it.

    Scoped to the window between one yield and the next, so a new ungated yield
    cannot inherit the gate call that belongs to the yield above it.
    """
    src = inspect.getsource(SearchPipeline.search)
    markers = ("_gate_check(", "gate_verdict_failed(")

    sites = []
    at = src.find('type="answer"')
    while at != -1:
        sites.append(at)
        at = src.find('type="answer"', at + 1)
    assert len(sites) >= 3, (
        f"expected the cache-hit, no-evidence and generated answer yields; "
        f"found {len(sites)}"
    )

    for n, end in enumerate(sites):
        window = src[sites[n - 1] if n else 0:end]
        assert any(m in window for m in markers), (
            f"answer yield #{n + 1} publishes with no gate consultation above "
            f"it; nothing in {markers} appears between it and the previous yield"
        )


# ── the guard: report-only survives the move ──────────────────────────────


@pytest.mark.asyncio
async def test_moving_the_gate_does_not_change_the_answer_text(monkeypatch):
    """Reordering preserves the report-only contract. Refusal is an escalation."""
    _, events = await _trace(_pipeline(), monkeypatch)

    answers = [e for e in events if e.type == "answer"]
    assert "130,497" in str(answers[-1].data.get("answer")), (
        "the gate changed, suppressed or replaced the answer; it is report-only"
    )
