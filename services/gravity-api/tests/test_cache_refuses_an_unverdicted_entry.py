"""L3 / R3 — an entry with no verdict is a miss, not a hit.

**This reverses a round-1 decision, on new information.**

Round 1 argued that refusing entries with no recorded verdict "would empty the
cache to buy nothing": an absent verdict means UNKNOWN rather than FAILED, and
`replay_metadata` already stops unknown from reading as a pass. The second
auditor called that *operationally convenient, not logically sufficient*, and
was right — TTL proves expiry, not verification. An entry served today because
it will expire tomorrow is still an answer nothing checked.

What makes the reversal correct NOW, rather than merely arguable:

L2 (`4ce93b9`) closed the write path to anything but a PASSING verdict, and
`search_pipeline` holds the only `cache.set` call in the service. So the set of
unverdicted entries is **closed** — no new one can be created. Round 1's premise
was that such entries keep arriving, which made refusal a permanent tax on the
hit rate. It is now a one-TTL-window cost that buys a permanent invariant:

    everything served from the cache was checked before it was stored

That is new information, not a re-argument of the same facts, which is the bar
the standing-decisions rule sets for reopening.

**This is not an answer refusal.** A refused entry falls through and recomputes;
the caller still gets an answer. The escalation rule covers making *FinalGate*
refuse, which this is not.
"""

from __future__ import annotations

import pytest

from app.core.search_pipeline import SearchPipeline, gate_verdict_failed
from tests.test_quick_answer_pipeline_e2e import (
    GOOD_ANSWER,
    PASSAGES,
    _Client,
    _Orchestrator,
    _QueryUnderstander,
    _of,
    _QueryUnderstander as _QU,  # noqa: F401  (kept explicit for readability)
    _Router,
    _run,
)

STALE = "Revenue for fiscal year 2025 was $111,111 million."


class _Cache:
    def __init__(self, stored=None):
        self.stored = stored

    async def get(self, query, tickers=None):
        if not self.stored:
            return None
        entry = dict(self.stored)
        if "_provenance" in entry:
            entry["_provenance"] = dict(entry["_provenance"])
        return entry

    async def set(self, query, payload, tickers=None):
        pass


def _entry(answer, prov="omit"):
    payload = {"answer": answer, "citations": [], "follow_up_queries": [],
               "structured_data": None, "confidence": "HIGH", "sources": []}
    if prov != "omit":
        payload["_provenance"] = prov
    return payload


def _pipeline(cache):
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
    d = answers[-1].data
    return str(d.get("answer") or "") if isinstance(d, dict) else str(d)


# ── the unit ──────────────────────────────────────────────────────────────


def test_an_absent_verdict_is_treated_as_a_miss():
    assert gate_verdict_failed(None) is True, (
        "an entry with no provenance at all was accepted; nothing ever checked "
        "the answer it carries"
    )


def test_provenance_without_a_gate_key_is_treated_as_a_miss():
    assert gate_verdict_failed({"model_used": "x", "passages_used": 2}) is True, (
        "an entry whose provenance records no verdict was accepted"
    )


def test_a_verdict_that_is_not_a_dict_is_treated_as_a_miss():
    """A malformed verdict is not a passing one."""
    for junk in ("passed", True, 1, [], {"violations": []}):
        assert gate_verdict_failed({"contract_gate": junk}) is True, (
            f"a malformed verdict was accepted as usable: {junk!r}"
        )


# ── through the pipeline ──────────────────────────────────────────────────


@pytest.mark.asyncio
async def test_a_legacy_entry_with_no_provenance_is_not_served():
    events = await _run(_pipeline(_Cache(_entry(STALE))))

    assert STALE not in _answer_text(events), (
        "an entry carrying no verdict was replayed to the client; TTL proves "
        "expiry, not verification"
    )


@pytest.mark.asyncio
async def test_a_refused_unverdicted_entry_recomputes():
    """Refusing must fall through, not fail the query."""
    events = await _run(_pipeline(_Cache(_entry(STALE))))

    assert "130,497" in _answer_text(events), (
        "the refused entry did not fall through to a fresh answer"
    )
    assert "retrieval" in [e.type for e in events], (
        "the pipeline short-circuited instead of recomputing"
    )


@pytest.mark.asyncio
async def test_a_recomputed_answer_is_not_reported_as_a_cache_hit():
    events = await _run(_pipeline(_Cache(_entry(STALE))))

    meta = _of(events, "metadata")
    assert meta and meta[-1].data.get("cache_hit") is not True, (
        "a refused entry was still billed and labelled as a replay"
    )


# ── the guard: the cache must keep working ────────────────────────────────


@pytest.mark.asyncio
async def test_a_passing_verdict_is_still_served():
    """Without this, L3 is indistinguishable from turning the cache off."""
    prov = {"model_used": "cached-model", "complexity": "simple",
            "retrieval_channels": ["dense"], "channels_dark": [],
            "passages_used": 2,
            "contract_gate": {"passed": True, "violations": []}}
    events = await _run(_pipeline(_Cache(_entry("Cached and gated clean.", prov))))

    assert "Cached and gated clean." in _answer_text(events), (
        "refusing unverdicted entries also broke replay of entries that passed"
    )
    assert _of(events, "metadata")[-1].data.get("cache_hit") is True


def test_a_passing_verdict_is_not_a_miss_at_the_unit_boundary():
    assert gate_verdict_failed(
        {"contract_gate": {"passed": True, "violations": []}}) is False


def test_an_explicitly_failed_verdict_is_still_a_miss():
    """The original behaviour, unchanged: this widens the rule, never narrows it."""
    assert gate_verdict_failed(
        {"contract_gate": {"passed": False, "violations": ["x"]}}) is True
