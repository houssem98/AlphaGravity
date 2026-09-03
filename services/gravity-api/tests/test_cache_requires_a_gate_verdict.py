"""An answer the gate never ran on must not enter the cache.

`504246f` made the read path refuse an entry whose stored
`contract_gate.passed` is `false`. The external audit asked for something
broader: "the replay path must reject entries that LACK a valid verification
state". That was not implemented, on the reasoning that an unrecorded verdict
means *unknown* rather than *failed*, and that refusing unknown entries would
empty the cache for no gain.

That reasoning assumed unrecorded meant *legacy* — an entry written before the
verdict was stored at all. It no longer does. `FinalGate.check` runs inside
`if _c is not None:`, where `_c` is `locals().get("_contract")`, and
`_contract` is bound inside a `try` whose `except` only logs
`finance_plan_failed`. When finance planning raises, the gate does not run,
`_gate_result` stays `None`, and the answer was cached anyway — carrying
`contract_gate: null`.

So there are two different unrecorded states, and they were being conflated:

  legacy   an old entry, written before verdicts were stored
  ungated  a NEW entry whose gate never ran because planning failed

The second is precisely the audit's "lacks a valid verification state", and it
is the one that matters, because it is still being produced.

The fix is at the WRITE, not the read. An answer that was never gated should
not be cached in the first place — that satisfies the invariant at its source
and leaves the read path's pass/fail logic alone. Legacy entries age out on
their own TTL, so nothing needs to reject them and the cache is not emptied.
"""

from __future__ import annotations

import pytest

from tests.test_quick_answer_pipeline_e2e import (
    GOOD_ANSWER,
    PASSAGES,
    _Client,
    _Orchestrator,
    _QueryUnderstander,
    _Router,
    _run,
)

from app.core import search_pipeline as sp
from app.core.search_pipeline import SearchPipeline


class _Cache:
    def __init__(self):
        self.writes: list[dict] = []

    async def get(self, query, tickers=None):
        return None

    async def set(self, query, payload, tickers=None):
        self.writes.append(payload)


def _pipeline(cache):
    return SearchPipeline(
        llm_router=_Router(_Client(GOOD_ANSWER)),
        retrieval_orchestrator=_Orchestrator(PASSAGES),
        reranker=None,
        query_understander=_QueryUnderstander(),
        citation_validator=None,
        semantic_cache=cache,
    )


# ── the defect ────────────────────────────────────────────────────────────


@pytest.mark.asyncio
async def test_an_answer_whose_gate_never_ran_is_not_cached(monkeypatch):
    """
    Force the exact production path: finance planning raises, the `except`
    logs and moves on, `_contract` is never bound, the gate is skipped.
    """
    def _boom(*a, **kw):
        raise RuntimeError("planning unavailable")

    monkeypatch.setattr(sp, "plan_finance_query", _boom)
    cache = _Cache()

    await _run(_pipeline(cache))

    assert not cache.writes, (
        "an answer that the contract gate never ran on was written to the "
        "cache, where it can be replayed indefinitely with contract_gate null"
    )


@pytest.mark.asyncio
async def test_the_ungated_answer_is_still_returned_to_the_caller(monkeypatch):
    """
    Refusing to CACHE it must not refuse to ANSWER it. A planning failure is
    advisory by design; declining to persist an unverified answer is a
    different decision from declining to give one.
    """
    def _boom(*a, **kw):
        raise RuntimeError("planning unavailable")

    monkeypatch.setattr(sp, "plan_finance_query", _boom)

    events = await _run(_pipeline(_Cache()))

    answers = [e for e in events if e.type == "answer"]
    assert answers, "refusing to cache an ungated answer also dropped it"
    assert "130,497" in str(answers[-1].data.get("answer") or "")


# ── the guard: the cache must keep working ────────────────────────────────


@pytest.mark.asyncio
async def test_a_gated_answer_is_still_cached():
    cache = _Cache()

    await _run(_pipeline(cache))

    assert cache.writes, "a normally gated answer stopped being cached"
    prov = cache.writes[-1].get("_provenance") or {}
    assert prov.get("contract_gate") is not None, (
        "an entry was cached carrying no gate verdict"
    )


@pytest.mark.asyncio
async def test_every_cached_entry_carries_a_verdict():
    """
    The invariant the audit asked for, stated directly: nothing reaches the
    cache without a verification state.
    """
    cache = _Cache()

    await _run(_pipeline(cache))

    for payload in cache.writes:
        gate = (payload.get("_provenance") or {}).get("contract_gate")
        assert isinstance(gate, dict) and "passed" in gate, (
            f"cached entry has no usable gate verdict: {gate!r}"
        )
