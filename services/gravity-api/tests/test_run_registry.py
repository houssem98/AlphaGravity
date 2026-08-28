"""Cancellation and reconnect-idempotency (roadmap Phases 5 and 6).

These drive the registry directly with a fake pipeline generator, so the number
of times the expensive work actually ran is observable — which is the whole
claim being tested. No network, no model.
"""

import asyncio

import pytest

from app.core.streaming.run_registry import RunRegistry


class Ev:
    def __init__(self, type_, data=None, trace_id="t"):
        self.type = type_
        self.data = data or {}
        self.trace_id = trace_id
        self.event_id = f"e-{type_}"
        self.ts = 0.0


@pytest.fixture
def reg():
    r = RunRegistry()
    yield r
    r.clear()


def make_source(counter, *, hang_after=None, n_tokens=3):
    """A fake pipeline run. `counter` counts how many times it was started."""
    async def gen():
        counter.append(1)
        yield Ev("status", {"status": "understanding"})
        yield Ev("sources", {"sources": [{"id": "src_1"}]})
        for i in range(n_tokens):
            if hang_after is not None and i >= hang_after:
                await asyncio.sleep(3600)  # parked until cancelled
            yield Ev("token", {"token": f"w{i} "})
        yield Ev("answer", {"answer": "done"})
    return gen


async def drain(run, limit=None):
    out = []
    async for e in run.subscribe():
        out.append(e)
        if limit and len(out) >= limit:
            break
    return out


# ── Phase 6: reconnect is idempotent ─────────────────────────────────────
@pytest.mark.asyncio
async def test_second_connection_with_same_trace_id_does_not_rerun(reg):
    started = []
    src = make_source(started)

    run1 = reg.start("trace-1", "q", "u1", src)
    first = await drain(run1)

    # The browser reconnects and re-sends the same query with the same trace id.
    run2 = reg.start("trace-1", "q", "u1", src)
    second = await drain(run2)

    assert started == [1], "the expensive search ran more than once"
    assert run1 is run2
    # The reconnecting client still receives the whole stream.
    assert [e["type"] for e in second] == [e["type"] for e in first]
    assert all(e.get("replayed") for e in second)


@pytest.mark.asyncio
async def test_reconnect_midway_replays_then_follows_live(reg):
    started = []
    run = reg.start("trace-2", "q", "u1", make_source(started, n_tokens=5))

    # Read two events, then "drop the connection".
    partial = await drain(run, limit=2)
    assert len(partial) == 2

    late = await drain(run)
    assert started == [1]
    assert [e["type"] for e in late][:2] == ["status", "sources"]
    assert [e["type"] for e in late][-1] == "answer"


@pytest.mark.asyncio
async def test_one_terminal_result_per_trace(reg):
    started = []
    run = reg.start("trace-3", "q", "u1", make_source(started))
    events = await drain(run)
    assert [e["type"] for e in events].count("answer") == 1


@pytest.mark.asyncio
async def test_sequence_numbers_are_monotonic_and_unique(reg):
    run = reg.start("trace-4", "q", "u1", make_source([]))
    events = await drain(run)
    seqs = [e["seq"] for e in events]
    assert seqs == sorted(seqs)
    assert len(seqs) == len(set(seqs))


# ── Phase 5: cancellation is real ────────────────────────────────────────
@pytest.mark.asyncio
async def test_cancel_during_generation_yields_cancelled_and_no_answer(reg):
    started = []
    run = reg.start("trace-5", "q", "u1", make_source(started, hang_after=1))

    seen = []

    async def reader():
        async for e in run.subscribe():
            seen.append(e)

    reader_task = asyncio.create_task(reader())
    await asyncio.sleep(0.05)          # let it reach the parked token
    assert reg.cancel("trace-5", "u1") is True
    await asyncio.wait_for(reader_task, timeout=2)

    types = [e["type"] for e in seen]
    assert "cancelled" in types, "no cancelled event reached the client"
    assert "answer" not in types, "a cancelled run still produced an answer"
    assert run.cancelled is True


@pytest.mark.asyncio
async def test_cancel_before_any_retrieval_still_terminates(reg):
    async def slow_start():
        await asyncio.sleep(3600)
        yield Ev("status", {"status": "understanding"})

    run = reg.start("trace-6", "q", "u1", slow_start)
    await asyncio.sleep(0.02)
    assert reg.cancel("trace-6", "u1") is True
    await asyncio.wait_for(run.done.wait(), timeout=2)
    assert run.cancelled is True


@pytest.mark.asyncio
async def test_cancelling_an_unknown_trace_is_a_no_op(reg):
    assert reg.cancel("never-started", "u1") is False


@pytest.mark.asyncio
async def test_error_in_pipeline_becomes_an_error_event_not_a_crash(reg):
    async def boom():
        yield Ev("status", {"status": "understanding"})
        raise RuntimeError("provider exploded")

    run = reg.start("trace-7", "q", "u1", boom)
    events = await drain(run)
    assert [e["type"] for e in events] == ["status", "error"]
    # The message must not leak the provider's exception text.
    assert "exploded" not in str(events[-1]["data"])


# ── Ownership: a trace id is a browser UUID, not a capability ─────────────
@pytest.mark.asyncio
async def test_another_user_cannot_attach_to_a_run(reg):
    """Attaching is the reconnect feature. Unscoped, it is also a way to be
    streamed someone else's sources and answer."""
    started = []
    src = make_source(started)

    mine = reg.start("shared-id", "q", "user-a", src)
    theirs = reg.start("shared-id", "q", "user-b", src)

    assert theirs is not mine, "user B attached to user A's run"
    assert theirs.user_id == "user-b"
    assert theirs.trace_id != mine.trace_id, "user B displaced user A's trace id"

    mine_events = await drain(mine)
    theirs_events = await drain(theirs)

    # Two separate searches were executed — B was served its own evidence, not
    # a replay of A's buffer. This is the assertion that matters: with the
    # registry unscoped, `started` was [1] and B read A's stream.
    assert started == [1, 1], "user B did not get a search of their own"
    assert mine.events is not theirs.events
    assert len(mine_events) == len(theirs_events)


@pytest.mark.asyncio
async def test_another_user_cannot_cancel_a_run(reg):
    run = reg.start("victim", "q", "user-a", make_source([], hang_after=1))
    await asyncio.sleep(0.02)

    assert reg.cancel("victim", "user-b") is False
    assert run.cancelled is False

    assert reg.cancel("victim", "user-a") is True
    await asyncio.wait_for(run.done.wait(), timeout=2)
    assert run.cancelled is True


@pytest.mark.asyncio
async def test_lookup_by_another_user_reports_not_found(reg):
    reg.start("t-owned", "q", "user-a", make_source([]))
    assert reg.get("t-owned", "user-b") is None
    assert reg.get("t-owned", "user-a") is not None


# ── Nothing may live forever ─────────────────────────────────────────────
@pytest.mark.asyncio
async def test_clear_cancels_runs_still_in_flight(reg):
    """Dropping a reference does not stop an asyncio task."""
    run = reg.start("t-leak", "q", "u1", make_source([], hang_after=0))
    await asyncio.sleep(0.02)
    assert run.task is not None and not run.task.done()

    reg.clear()
    await asyncio.sleep(0.02)
    assert run.task.cancelled() or run.task.done()


@pytest.mark.asyncio
async def test_a_run_that_never_finishes_is_expired(reg):
    import app.core.streaming.run_registry as rr

    run = reg.start("t-wedged", "q", "u1", make_source([], hang_after=0))
    await asyncio.sleep(0.02)

    # Age the run past the ceiling rather than waiting ten minutes.
    run.started_at -= rr.MAX_RUN_LIFETIME_S + 1
    assert reg.get("t-wedged", "u1") is None, "a wedged run survived the sweep"
    await asyncio.sleep(0.02)
    assert run.task is not None and (run.task.cancelled() or run.task.done())
