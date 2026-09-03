"""L4 / R2 — an ungated answer is permitted, and says so.

R2: `_contract` is bound inside a `try` whose `except` only logs
`finance_plan_failed`, so a planning failure produces an answer the gate never
ran on. The roadmap put three options on the table and asked for a decision.

**Decided: permit it, and label it explicitly on the wire.** The other two are
rejected for stated reasons, not preference:

*Refuse the answer* is the escalation class — making the gate withhold an
answer is a product decision of the same class as D7, which the owner already
decided (advisory). Not the loop's to take.

*Build a deterministic fallback contract and grade against it* is rejected on
evidence. When `plan_finance_query` raises, `query_plan["answer_contract"]` is
never set, and the prompt's directives come from exactly that key. Measured:

    contract_directives(None) == ''
    'ANSWER CONTRACT' in build_user_message('q', [], contract=None) is False

So the model receives no contract directives at all on this path. Grading it
against a contract invented afterwards would fail it for rules it was never
given — precisely what `test_every_gate_clause_has_a_matching_directive`
exists to prevent: *"if the gate can fail an answer for a rule the model was
never given, the system is punishing the model for a secret."*

What remained was that the label was not honest. `_gate_check` returned a bare
`None` for two different facts:

    no contract was built   (finance planning raised)
    the gate itself raised  (a bug in the check)

Both reached the client as `contract_gate: null`, which is the same mistake
`replay_metadata` already fixed on the cache path — "an empty channel list
presented as a measurement is worse than one labelled as missing" — applied to
channels but not here. A caller cannot act on a distinction it cannot see.
"""

from __future__ import annotations

import pytest

from app.core import search_pipeline as sp
from app.core.search_pipeline import SearchPipeline
from tests.test_quick_answer_pipeline_e2e import (
    GOOD_ANSWER,
    PASSAGES,
    _Client,
    _Orchestrator,
    _QueryUnderstander,
    _Router,
    _of,
    _run,
)


class _Cache:
    def __init__(self):
        self.writes: list[dict] = []

    async def get(self, query, tickers=None):
        return None

    async def set(self, query, payload, tickers=None):
        self.writes.append(payload)


def _pipeline(cache=None):
    return SearchPipeline(
        llm_router=_Router(_Client(GOOD_ANSWER)),
        retrieval_orchestrator=_Orchestrator(PASSAGES),
        reranker=None,
        query_understander=_QueryUnderstander(),
        citation_validator=None,
        semantic_cache=cache,
    )


def _boom(*a, **kw):
    raise RuntimeError("planning unavailable")


def _gate_of(events):
    answers = _of(events, "answer")
    assert answers, "no answer event"
    return answers[-1].data.get("contract_gate")


# ── the decision: permitted ───────────────────────────────────────────────


@pytest.mark.asyncio
async def test_a_planning_failure_still_answers(monkeypatch):
    """Permitted, deliberately. Advisory means advisory."""
    monkeypatch.setattr(sp, "plan_finance_query", _boom)

    events = await _run(_pipeline())

    answers = _of(events, "answer")
    assert answers, "a planning failure cost the caller their answer"
    assert "130,497" in str(answers[-1].data.get("answer") or "")


# ── the decision: labelled ────────────────────────────────────────────────


@pytest.mark.asyncio
async def test_an_ungated_answer_says_it_was_not_checked(monkeypatch):
    monkeypatch.setattr(sp, "plan_finance_query", _boom)

    gate = _gate_of(await _run(_pipeline()))

    assert gate is not None, (
        "an ungated answer reached the client as contract_gate: null, which is "
        "indistinguishable from a gate that passed silently"
    )
    assert gate.get("recorded") is False
    assert gate.get("passed") is not True
    assert gate.get("reason"), "the label names no reason it was not checked"


@pytest.mark.asyncio
async def test_the_two_ungated_causes_are_distinguishable(monkeypatch):
    """"No contract" and "the gate raised" are different facts.

    A caller that sees the first has a planning problem; one that sees the
    second has a bug in the gate. Collapsing them to `null` hides which.
    """
    monkeypatch.setattr(sp, "plan_finance_query", _boom)
    no_contract = _gate_of(await _run(_pipeline()))

    # Planning must SUCCEED for the second case, or the contract is None and
    # `_gate_check` returns `no_contract` before it ever reaches the gate —
    # which would compare the first reason against itself.
    monkeypatch.undo()

    class _Exploding:
        @staticmethod
        def check(*a, **kw):
            raise RuntimeError("gate is broken")

    import app.core.finance.answer_contract as ac
    monkeypatch.setattr(ac, "FinalGate", _Exploding)
    gate_raised = _gate_of(await _run(_pipeline()))

    assert "no_contract" in no_contract.get("reason", "")
    assert "gate_error" in gate_raised.get("reason", ""), (
        f"the crashed-gate path did not report gate_error: {gate_raised}"
    )

    assert no_contract.get("reason") != gate_raised.get("reason"), (
        "a missing contract and a crashed gate report the same reason, so a "
        "caller cannot tell a planning problem from a broken gate"
    )
    for g in (no_contract, gate_raised):
        assert g.get("passed") is not True


# ── the guards ────────────────────────────────────────────────────────────


@pytest.mark.asyncio
async def test_an_ungated_answer_is_still_not_cached(monkeypatch):
    """L2's invariant must survive the label becoming a dict rather than None."""
    monkeypatch.setattr(sp, "plan_finance_query", _boom)
    cache = _Cache()

    await _run(_pipeline(cache))

    assert not cache.writes, (
        "labelling the ungated answer also made it cacheable; a label is not a "
        "verdict"
    )


@pytest.mark.asyncio
async def test_a_normal_answer_still_reports_a_real_verdict():
    gate = _gate_of(await _run(_pipeline()))

    assert gate.get("passed") is True, f"the normal path regressed: {gate}"
    assert "recorded" not in gate or gate.get("recorded") is not False


@pytest.mark.asyncio
async def test_the_label_never_reads_as_a_pass(monkeypatch):
    """The whole point: absent must not be mistakable for clean."""
    monkeypatch.setattr(sp, "plan_finance_query", _boom)

    gate = _gate_of(await _run(_pipeline()))

    assert gate.get("passed") is not True
    assert not gate.get("violations"), (
        "an unchecked answer reported violations, implying it was checked"
    )
