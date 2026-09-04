"""
Injected failures at every boundary the pipeline does not own.

`test_channel_failure_isolation.py` already covers one retrieval channel dying.
This covers the rest of the blast radius: the model, the cache, and retrieval
failing wholesale rather than partially.

**The property under test is the same in every case.** A dependency failing must
produce either an honest answer or no answer. What it must never produce is a
confident answer that looks exactly like a good one — a fabrication is worse
than an outage, because an outage is visible.

**One of these is not hypothetical.** A reasoning model returning
`content=None` while spending its whole budget on hidden reasoning tokens
silently blanked every answer in this project once before. It is injected here
because it happened, not because it was imagined.
"""

from __future__ import annotations

import pytest

from app.llm.base import LLMResponse
from tests.test_quick_answer_pipeline_e2e import (
    GOOD_ANSWER, PASSAGES, _Client, _Orchestrator, _QueryUnderstander, _Router,
    _of, _run,
)
from app.core.search_pipeline import SearchPipeline


class _Boom(Exception):
    """Injected, not incidental."""


# ── The model ─────────────────────────────────────────────────────────────


class _RaisingClient(_Client):
    model_id = "raises"

    async def generate(self, messages, config=None):
        raise _Boom("model unavailable")

    async def generate_stream(self, messages, config=None):
        raise _Boom("model unavailable")
        yield ""            # pragma: no cover — makes this an async generator


class _EmptyContentClient(_Client):
    """
    A reasoning model that spends its whole budget on hidden tokens and returns
    `content=None`. This is a real incident, not a hypothetical.
    """

    model_id = "empty"

    async def generate(self, messages, config=None):
        return LLMResponse(content=None, model=self.model_id, cost_usd=0.0)

    async def generate_stream(self, messages, config=None):
        return
        yield ""            # pragma: no cover


class _GarbageClient(_Client):
    model_id = "garbage"

    async def generate(self, messages, config=None):
        return LLMResponse(content="{not json at all",
                           model=self.model_id, cost_usd=0.0)

    async def generate_stream(self, messages, config=None):
        yield "{not json at all"


class _RaisingOrchestrator:
    async def search(self, **kwargs):
        raise _Boom("retrieval down")

    async def search_multi_entity(self, **kwargs):
        raise _Boom("retrieval down")


class _RaisingCache:
    def __init__(self, on_get=True, on_set=True):
        self.on_get = on_get
        self.on_set = on_set
        self.get_calls = 0
        self.set_calls = 0

    async def get(self, query, tickers=None):
        self.get_calls += 1
        if self.on_get:
            raise _Boom("cache read failed")
        return None

    async def set(self, query, result, tickers=None):
        self.set_calls += 1
        if self.on_set:
            raise _Boom("cache write failed")


def _pipe(client=None, orchestrator=None, cache=None):
    return SearchPipeline(
        llm_router=_Router(client or _Client(GOOD_ANSWER)),
        retrieval_orchestrator=orchestrator or _Orchestrator(PASSAGES),
        reranker=None,
        query_understander=_QueryUnderstander(),
        citation_validator=None,
        semantic_cache=cache,
    )


def _published(events) -> str:
    answers = _of(events, "answer")
    if not answers:
        return ""
    return str((answers[-1].data or {}).get("answer") or "")


# ── A failing model must not yield a confident answer ─────────────────────


@pytest.mark.asyncio
async def test_a_model_that_raises_does_not_publish_a_fabricated_answer():
    events = await _run(_pipe(client=_RaisingClient(GOOD_ANSWER)))
    published = _published(events)
    assert "130,497" not in published, (
        "the model failed and an answer carrying a specific figure was still "
        "published; a fabrication is worse than an outage"
    )


@pytest.mark.asyncio
async def test_a_model_returning_no_content_does_not_publish_a_blank_answer():
    """
    The incident this project actually had: a reasoning model burns its budget
    on hidden tokens, returns `content=None`, and every cell of the output goes
    silently empty while the pipeline reports success.
    """
    events = await _run(_pipe(client=_EmptyContentClient(GOOD_ANSWER)))
    published = _published(events).strip()
    assert published == "" or "not available" in published.lower() or \
        "unable" in published.lower(), (
        f"an empty model response produced {published[:120]!r}; blank output "
        f"must be visible as a failure, not served as an answer"
    )


@pytest.mark.asyncio
async def test_malformed_model_output_does_not_crash_the_stream():
    """Unparseable output is a bad answer, not an exception to the caller."""
    events = await _run(_pipe(client=_GarbageClient(GOOD_ANSWER)))
    assert events, "the stream produced nothing at all"
    assert "130,497" not in _published(events)


# ── Retrieval failing wholesale, not one channel ──────────────────────────


@pytest.mark.asyncio
async def test_total_retrieval_failure_does_not_publish_an_unsourced_figure():
    events = await _run(_pipe(orchestrator=_RaisingOrchestrator()))
    published = _published(events)
    assert "130,497" not in published, (
        "retrieval failed entirely and a figure was still published; the "
        "answer would have come from the model's memory, not from evidence"
    )


# ── The cache is an optimisation and must never be load-bearing ───────────


@pytest.mark.asyncio
async def test_a_cache_that_fails_to_read_still_answers():
    """A cache outage must degrade to a miss, not to an error."""
    cache = _RaisingCache(on_get=True, on_set=False)
    events = await _run(_pipe(cache=cache))
    # The fixture must bite. A mangled constructor once left both flags false,
    # so this passed while nothing was injected at all — the exact shape of
    # failure this whole effort keeps finding.
    assert cache.get_calls > 0, "the cache read was never attempted; nothing was injected"
    assert _of(events, "answer"), "a failing cache read took the whole query down"


@pytest.mark.asyncio
async def test_a_cache_that_fails_to_write_still_answers():
    cache = _RaisingCache(on_get=False, on_set=True)
    events = await _run(_pipe(cache=cache))
    assert cache.set_calls > 0, "the cache write was never attempted; nothing was injected"
    assert _of(events, "answer"), "a failing cache write took the whole query down"


# ── The healthy path still works, so the above prove something ────────────


@pytest.mark.asyncio
async def test_the_uninjured_pipeline_still_publishes_the_figure():
    """
    Without this, every assertion above could pass because the pipeline never
    publishes anything under any circumstances.
    """
    events = await _run(_pipe())
    assert "130,497" in _published(events)
