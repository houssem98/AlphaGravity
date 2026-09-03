"""L2 / R4 — the cache stores on `gate_ran`, not on `gate_passed`.

`test_cache_requires_a_gate_verdict.py` closed the case where the gate never
ran. This is its sibling, and the one still open: the gate DOES run, it returns
`passed: false`, and the answer is written to the cache anyway because the write
is guarded by

    _gated = _gate_result is not None

A failing verdict is very much "not None". So the entry is stored, and the read
path then refuses it on every subsequent hit via `gate_verdict_failed`. The
system therefore knows the answer is bad, writes it down, and re-refuses it for
the life of the entry — spending a write and a read to enforce something it
could have declined to record in the first place.

That is a defence at the wrong end. Refusing on read is necessary for entries
already in the cache; it is not a reason to keep adding more.

**Both defences stay.** This closes the write; `gate_verdict_failed` on the read
path is not moved, because entries written before this change are still out
there and still have to be refused.
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
    _run,
)

# A real violation rather than a contrived one: a margin move stated as a
# percent change instead of in percentage points. 20% -> 25% is +5pp, and
# reporting it as +25% is the classic finance error the contract exists to
# catch. Properly cited and confident, so it stays well clear of the refusal
# heuristics — a refusal is skipped by a DIFFERENT branch, which would make
# these tests pass for the wrong reason.
MARGIN_QUERY = "What was NVIDIA operating margin year over year?"

PERCENT_MARGIN_ANSWER = (
    '{"answer": "Operating margin grew 25% year over year [1].",'
    ' "citations": [{"id": 1, "chunk_id": "c1", "text": "Revenue for fiscal'
    ' year 2025 was $130,497 million.", "entailed": true}],'
    ' "confidence": "HIGH"}'
)


class _Cache:
    def __init__(self):
        self.writes: list[dict] = []

    async def get(self, query, tickers=None):
        return None

    async def set(self, query, payload, tickers=None):
        self.writes.append(payload)


def _pipeline(cache, answer=GOOD_ANSWER):
    return SearchPipeline(
        llm_router=_Router(_Client(answer)),
        retrieval_orchestrator=_Orchestrator(PASSAGES),
        reranker=None,
        query_understander=_QueryUnderstander(),
        citation_validator=None,
        semantic_cache=cache,
    )


def _verdict(events):
    answers = [e for e in events if e.type == "answer"]
    assert answers, "no answer event"
    return answers[-1].data.get("contract_gate")


# ── the defect ────────────────────────────────────────────────────────────


@pytest.mark.asyncio
async def test_a_failed_verdict_is_not_written_to_the_cache():
    cache = _Cache()

    events = await _run(_pipeline(cache, PERCENT_MARGIN_ANSWER),
                        query=MARGIN_QUERY)

    # The premise: this really did fail the gate. Without it a green result
    # could mean "the write was refused" or merely "the answer passed".
    gate = _verdict(events)
    assert gate is not None and gate["passed"] is False, (
        f"the fixture no longer produces a failing verdict, so this test is "
        f"not exercising the defect; got {gate!r}"
    )

    assert not cache.writes, (
        "an answer whose gate verdict FAILED was written to the cache; the "
        "read path will now refuse it on every hit for the life of the entry"
    )


# ── the guards ────────────────────────────────────────────────────────────


@pytest.mark.asyncio
async def test_the_answer_is_still_returned_when_its_verdict_failed():
    """Declining to persist an answer is not declining to give one.

    The gate is report-only. Refusing the WRITE is a caching decision; it must
    not become the answer-suppression the escalation rule reserves for the
    owner.
    """
    events = await _run(_pipeline(_Cache(), PERCENT_MARGIN_ANSWER),
                        query=MARGIN_QUERY)

    answers = [e for e in events if e.type == "answer"]
    assert answers, "refusing to cache a failed answer also dropped it"
    assert "25%" in str(answers[-1].data.get("answer") or ""), (
        "the answer was altered or suppressed; the gate is report-only and the "
        "write-path change is a caching decision, not an answer decision"
    )


@pytest.mark.asyncio
async def test_a_passing_verdict_is_still_cached():
    """The cache must keep working, or this trades one defect for a worse one."""
    cache = _Cache()

    events = await _run(_pipeline(cache))

    assert _verdict(events)["passed"] is True, "fixture no longer passes the gate"
    assert cache.writes, "refusing failed verdicts also stopped caching good ones"


@pytest.mark.asyncio
async def test_every_cached_entry_now_carries_a_PASSING_verdict():
    """The invariant, stated as the property rather than as the branch."""
    cache = _Cache()

    for answer, query in ((GOOD_ANSWER, "What was NVIDIA revenue in FY2025?"),
                          (PERCENT_MARGIN_ANSWER, MARGIN_QUERY)):
        await _run(_pipeline(cache, answer), query=query)

    assert cache.writes, "nothing was cached at all; the assertion below is vacuous"
    for payload in cache.writes:
        gate = (payload.get("_provenance") or {}).get("contract_gate")
        assert isinstance(gate, dict) and gate.get("passed") is True, (
            f"a cached entry does not carry a passing verdict: {gate!r}"
        )


def test_the_read_path_refusal_is_not_moved_but_kept():
    """Two defences, not one relocated.

    Entries written before this change are still in Redis and still have to be
    refused on read. Closing the write is only a promise about new entries.
    """
    src = inspect.getsource(SearchPipeline.search)
    assert "gate_verdict_failed(" in src, (
        "the read-path refusal was removed when the write-path check was "
        "added; entries already in the cache are now served unchecked"
    )
