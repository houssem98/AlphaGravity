"""L1 / D2 — a cache hit must not resurrect an answer the gate rejected.

`6c72822` moved `FinalGate.check` above the cache write and stored the verdict
in `_provenance`, so a replay can now *report* what the gate said. Reporting is
not enforcement. The read path in `SearchPipeline.search` pops `_provenance`,
yields the answer, and returns — it never looks at `contract_gate.passed`.

The consequence is worse than a stale answer. A failing gate verdict is written
to the cache exactly once, and then served on every subsequent hit for the life
of the entry, each time carrying a `contract_gate.passed: false` that nothing
acts on. The one answer the system knew was bad is the one it repeats cheapest.

Scope of the fix, deliberately narrow:

  passed is False  -> refuse, fall through and recompute
  passed is True   -> serve (the cache must keep working)
  not recorded     -> serve, still labelled `recorded: false`

Refusing unrecorded entries would empty the cache to buy nothing: `recorded:
false` means the verdict is unknown, not that it failed, and `replay_metadata`
already refuses to let unknown read as a pass.
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
    _of,
    _run,
)

from app.core.search_pipeline import SearchPipeline

POISONED = "Revenue for fiscal year 2025 was $999,999,999 million."


class _Cache:
    """The semantic-cache boundary. `stored` is what a hit returns."""

    def __init__(self, stored=None):
        self.stored = stored
        self.gets = 0
        self.writes = []

    async def get(self, query, tickers=None):
        self.gets += 1
        # The pipeline mutates what it gets back (it pops `_provenance`), so
        # hand out a copy — otherwise the second hit in a test sees the first
        # hit's leftovers and the assertion passes for the wrong reason.
        if not self.stored:
            return None
        entry = dict(self.stored)
        if "_provenance" in entry:
            entry["_provenance"] = dict(entry["_provenance"])
        return entry

    async def set(self, query, payload, tickers=None):
        self.writes.append(payload)


def _entry(answer: str, gate: dict | None):
    payload = {
        "answer": answer,
        "citations": [],
        "follow_up_queries": [],
        "structured_data": None,
        "confidence": "HIGH",
        "sources": [],
    }
    prov = {"model_used": "cached-model", "complexity": "simple",
            "retrieval_channels": ["dense"], "channels_dark": [],
            "passages_used": 2}
    if gate is not None:
        prov["contract_gate"] = gate
    payload["_provenance"] = prov
    return payload


def _pipeline_with(cache):
    return SearchPipeline(
        llm_router=_Router(_Client(GOOD_ANSWER)),
        retrieval_orchestrator=_Orchestrator(PASSAGES),
        reranker=None,
        query_understander=_QueryUnderstander(),
        citation_validator=None,
        semantic_cache=cache,
    )


def _answer_text(events):
    answers = _of(events, "answer")
    assert answers, "the pipeline produced no answer event at all"
    data = answers[-1].data
    return str(data.get("answer") or "") if isinstance(data, dict) else str(data)


# ── the defect ────────────────────────────────────────────────────────────


@pytest.mark.asyncio
async def test_a_failed_gate_verdict_is_not_served_from_cache():
    """The entry the gate rejected is the one the cache repeats for free."""
    cache = _Cache(_entry(POISONED, {"passed": False,
                                     "violations": ["uncited_figure"]}))

    events = await _run(_pipeline_with(cache))

    assert POISONED not in _answer_text(events), (
        "an answer whose stored contract_gate.passed is False was replayed to "
        "the client; the recorded verdict was read and ignored"
    )


@pytest.mark.asyncio
async def test_a_refused_entry_is_recomputed_not_dropped():
    """Refusing the entry must fall through to the pipeline, not fail the query."""
    cache = _Cache(_entry(POISONED, {"passed": False, "violations": ["x"]}))

    events = await _run(_pipeline_with(cache))

    assert "130,497" in _answer_text(events), (
        "the refused cache entry did not fall through to a fresh answer"
    )
    types = [e.type for e in events]
    assert "retrieval" in types, "the pipeline short-circuited instead of recomputing"


@pytest.mark.asyncio
async def test_the_replay_metadata_of_a_refused_entry_is_not_a_cache_hit():
    """A recomputed answer must not be billed or labelled as a replay."""
    cache = _Cache(_entry(POISONED, {"passed": False, "violations": ["x"]}))

    events = await _run(_pipeline_with(cache))

    meta = _of(events, "metadata")
    assert meta, "no metadata event"
    assert meta[-1].data.get("cache_hit") is not True, (
        "a refused entry was still reported to the client as a cache hit"
    )


# ── the guards: the cache must keep working ───────────────────────────────


@pytest.mark.asyncio
async def test_a_passing_gate_verdict_is_still_served_from_cache():
    cache = _Cache(_entry("Cached and gated clean.",
                          {"passed": True, "violations": []}))

    events = await _run(_pipeline_with(cache))

    assert "Cached and gated clean." in _answer_text(events), (
        "refusing failed entries also broke replay of the entries that passed"
    )
    assert _of(events, "metadata")[-1].data.get("cache_hit") is True


@pytest.mark.asyncio
async def test_an_entry_with_no_recorded_verdict_is_still_served():
    """`recorded: false` means unknown, not failed. Refusing it buys nothing."""
    cache = _Cache(_entry("Legacy cached answer.", gate=None))

    events = await _run(_pipeline_with(cache))

    assert "Legacy cached answer." in _answer_text(events)
    md = _of(events, "metadata")[-1].data
    assert md.get("cache_hit") is True
    # Still honest about what it does not know.
    assert md["contract_gate"].get("passed") is not True
