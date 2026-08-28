"""Retrieval failure isolation (roadmap Phase 7).

One channel failing must not take the query down, and — the part that was
missing — must not be reported as a channel that ran and found nothing. A
provider outage and an honest empty result are different answers to the user.
"""

import asyncio

import pytest

from app.core.retrieval.orchestrator import ChannelResults


class Boom(Exception):
    pass


def test_channel_results_is_a_plain_dict_for_every_existing_consumer():
    r = ChannelResults({"dense": [1, 2], "bm25": []})
    assert dict(r) == {"dense": [1, 2], "bm25": []}
    assert list(r.keys()) == ["dense", "bm25"]
    assert r.failed == {}
    assert r.degraded is False


def test_a_failed_channel_is_recorded_apart_from_an_empty_one():
    r = ChannelResults({"dense": [1], "bm25": [], "graph": []},
                       failed={"bm25": "ConnectionError"})
    dark = [k for k, v in r.items() if not v and k not in r.failed]
    assert dark == ["graph"], "an errored channel was reported as merely empty"
    assert r.failed == {"bm25": "ConnectionError"}
    assert r.degraded is True


def test_the_failure_record_carries_no_message_only_the_type():
    """An exception message can carry a DSN, a host or a key."""
    r = ChannelResults({"bm25": []}, failed={"bm25": type(Boom("postgres://u:p@h/db")).__name__})
    assert r.failed == {"bm25": "Boom"}
    assert "postgres" not in str(r.failed)


@pytest.mark.asyncio
async def test_gather_isolation_keeps_healthy_channels(monkeypatch):
    """The dispatch shape itself: one raising task must not cancel the others."""
    async def ok():
        return ["a", "b"]

    async def fails():
        raise Boom("channel down")

    names = ["dense", "bm25", "graph"]
    out = await asyncio.gather(ok(), fails(), ok(), return_exceptions=True)

    results = ChannelResults()
    for name, res in zip(names, out):
        if isinstance(res, Exception):
            results[name] = []
            results.failed[name] = type(res).__name__
        else:
            results[name] = res

    assert results["dense"] == ["a", "b"]
    assert results["graph"] == ["a", "b"]
    assert results["bm25"] == []
    assert results.failed == {"bm25": "Boom"}
    assert results.degraded is True
    # And the answer is still servable from the healthy channels.
    assert sum(len(v) for v in results.values()) == 4


def test_degraded_is_false_when_every_channel_merely_found_nothing():
    """An all-empty result is not a degraded one — the corpus was searched."""
    r = ChannelResults({"dense": [], "bm25": []})
    assert r.degraded is False


# ── The wiring, not just the mechanism ───────────────────────────────────
# The tests above prove `ChannelResults` can carry a failure. They do not prove
# the orchestrator ever puts one there, and for a while it did not: every
# channel error was caught inside `_safe_search`, which returned `[]`, so
# nothing reached the `asyncio.gather(return_exceptions=True)` that populated
# the map. Three providers were refusing connections in the running system and
# `channels_failed` was still `{}`.

class _Boom:
    async def search(self, **kwargs):
        raise ConnectionRefusedError("connection refused")


class _Slow:
    async def search(self, **kwargs):
        await asyncio.sleep(30)
        return []


class _Fine:
    async def search(self, **kwargs):
        return ["hit"]


class _Empty:
    async def search(self, **kwargs):
        return []


def _orchestrator(channels):
    from app.core.retrieval.orchestrator import RetrievalOrchestrator
    o = RetrievalOrchestrator.__new__(RetrievalOrchestrator)
    o.channels = channels
    o._CHANNEL_TIMEOUTS = {k: 0.2 for k in channels}
    o._multi_query = None
    return o


@pytest.mark.asyncio
async def test_safe_search_records_a_raising_channel():
    o = _orchestrator({"bm25": _Boom()})
    failures: dict = {}
    out = await o._safe_search("bm25", o.channels["bm25"], "q", None, None, None,
                               "", failures=failures)
    assert out == []
    assert failures == {"bm25": "ConnectionRefusedError"}


@pytest.mark.asyncio
async def test_safe_search_records_a_timing_out_channel():
    o = _orchestrator({"dense": _Slow()})
    failures: dict = {}
    out = await o._safe_search("dense", o.channels["dense"], "q", None, None, None,
                               "", failures=failures)
    assert out == []
    assert failures == {"dense": "TimeoutError"}


@pytest.mark.asyncio
async def test_a_channel_that_legitimately_found_nothing_is_not_recorded():
    """The distinction only means something if an empty result stays empty."""
    o = _orchestrator({"graph": _Empty()})
    failures: dict = {}
    out = await o._safe_search("graph", o.channels["graph"], "q", None, None, None,
                               "", failures=failures)
    assert out == []
    assert failures == {}


@pytest.mark.asyncio
async def test_a_healthy_channel_is_not_recorded():
    o = _orchestrator({"dense": _Fine()})
    failures: dict = {}
    out = await o._safe_search("dense", o.channels["dense"], "q", None, None, None,
                               "", failures=failures)
    assert out == ["hit"]
    assert failures == {}


# ── Known limitation, pinned rather than papered over ────────────────────
class _SwallowsItsOwnError:
    """What most real channels do: catch internally and return [].

    `DenseSearch.search` does this at dense_search.py:81 — it logs
    `dense_search_unavailable` and returns an empty list. Every retrieval
    channel has its own version of that handler, written before the failed/dark
    distinction existed.
    """
    async def search(self, **kwargs):
        try:
            raise ConnectionRefusedError("qdrant refused")
        except Exception:
            return []


@pytest.mark.asyncio
async def test_a_channel_that_swallows_its_own_error_is_still_reported_as_dark():
    """The limit of the failed/dark distinction, stated as a test.

    The orchestrator can only record failures that reach it. A channel that
    handles its own exception is indistinguishable, from here, from one that
    searched and found nothing — so with Qdrant down, `dense` is reported as
    dark rather than failed.

    This test exists so that limit is visible and asserted rather than assumed.
    Pushing the distinction all the way down means changing the error handler in
    every retrieval channel, which is a wider change than Quick Answer's scope
    allows; it is recorded in FINAL_VERIFICATION.md as an open item.
    """
    o = _orchestrator({"dense": _SwallowsItsOwnError()})
    failures: dict = {}
    out = await o._safe_search("dense", o.channels["dense"], "q", None, None, None,
                               "", failures=failures)
    assert out == []
    assert failures == {}, (
        "if this now records a failure, the channels have been fixed and "
        "FINAL_VERIFICATION.md's open item should be closed"
    )
