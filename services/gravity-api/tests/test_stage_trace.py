"""
The latency instrument.

The bug it exists to prevent is subtle: an *unmeasured* stage and a *fast*
stage look identical in a report. The pipeline timed three boundaries, measured
~27s end to end, and the three plus the separately-measured model calls summed
to ~3.4s. The missing ~23s was invisible precisely because nothing was watching
it, and no amount of refining the three existing numbers would have found it.

So the tests here are mostly about the tracer's honesty rather than its
accuracy: that it names the gap instead of absorbing it, that it cannot turn a
measurement failure into a request failure, and that overlapping spans do not
produce an attribution larger than the wall clock.
"""

from __future__ import annotations

import asyncio
import time

import pytest

from app.core.finance.stage_trace import STAGES, StageTrace


def burn(ms: float) -> None:
    """Busy-wait. `sleep` is fine too, but this keeps the unit tests quick."""
    end = time.perf_counter() + ms / 1000.0
    while time.perf_counter() < end:
        pass


# ── Recording ─────────────────────────────────────────────────────────────


def test_a_stage_is_timed():
    t = StageTrace("x")
    with t.stage("retrieval"):
        burn(20)
    r = t.report()
    assert r["stages"][0]["stage"] == "retrieval"
    assert r["stages"][0]["ms"] >= 15


def test_stages_are_ordered_slowest_first():
    t = StageTrace()
    with t.stage("fast"):
        burn(2)
    with t.stage("slow"):
        burn(30)
    names = [s["stage"] for s in t.report()["stages"]]
    assert names[0] == "slow"


def test_the_same_stage_entered_twice_accumulates_and_counts():
    t = StageTrace()
    for _ in range(3):
        with t.stage("verification"):
            burn(5)
    span = next(s for s in t.report()["stages"] if s["stage"] == "verification")
    assert span["count"] == 3
    assert span["ms"] >= 12


def test_a_span_measured_elsewhere_can_be_added():
    """The pipeline already has perf_counter pairs; they must be adoptable."""
    t = StageTrace()
    t.add("rerank", 1509.4, provider="cohere")
    span = next(s for s in t.report()["stages"] if s["stage"] == "rerank")
    assert span["ms"] == 1509.4
    assert span["detail"]["provider"] == "cohere"


def test_detail_travels_with_the_span():
    t = StageTrace()
    with t.stage("retrieval", channels=5, candidates=120):
        pass
    span = next(s for s in t.report()["stages"] if s["stage"] == "retrieval")
    assert span["detail"]["channels"] == 5
    assert span["detail"]["candidates"] == 120


# ── The gap is named, not absorbed ────────────────────────────────────────


def test_unattributed_time_is_reported_rather_than_hidden():
    """The whole reason this module exists."""
    t = StageTrace()
    with t.stage("planning"):
        burn(5)
    burn(40)                     # time nobody measured
    r = t.report()
    assert r["unattributed_ms"] >= 30
    assert r["unattributed_pct"] > 50


def test_a_fully_instrumented_request_has_a_small_gap():
    t = StageTrace()
    for name in ("planning", "retrieval", "generation"):
        with t.stage(name):
            burn(10)
    r = t.report()
    assert r["unattributed_ms"] < 15


def test_attributed_plus_unattributed_equals_the_wall_clock():
    t = StageTrace()
    with t.stage("a"):
        burn(10)
    burn(10)
    r = t.report()
    assert r["attributed_ms"] + r["unattributed_ms"] == pytest.approx(
        r["total_ms"], abs=5)


def test_stages_that_never_ran_are_listed_as_missing():
    """An absent stage must look different from a fast one."""
    t = StageTrace()
    with t.stage("planning"):
        pass
    missing = t.report()["missing_stages"]
    assert "generation" in missing
    assert "planning" not in missing
    assert set(missing) <= set(STAGES)


def test_the_declared_stage_list_covers_the_roadmap_boundaries():
    for required in ("planning", "entity", "retrieval", "merge_dedup", "rerank",
                     "context", "generation", "verification", "provenance",
                     "serialization"):
        assert required in STAGES


# ── Concurrency is not summed ─────────────────────────────────────────────


@pytest.mark.asyncio
async def test_overlapping_channels_do_not_inflate_the_total():
    """
    Five channels under asyncio.gather take about as long as the slowest one.

    Summing them would report ~150ms of retrieval inside a ~40ms request, an
    attribution that is not merely imprecise but arithmetically impossible.
    """
    t = StageTrace()

    async def chan(name, ms):
        with t.channel(name):
            await asyncio.sleep(ms / 1000)

    with t.concurrent_group("retrieval"):
        await asyncio.gather(
            chan("dense", 30), chan("bm25", 25), chan("splade", 20),
            chan("graph", 15), chan("structured", 10),
        )

    r = t.report()
    parent = next(s for s in r["stages"] if s["stage"] == "retrieval")
    channel_sum = sum(c["ms"] for c in r["channels"])

    assert parent["ms"] < 60           # wall time, near the slowest child
    assert channel_sum > parent["ms"]  # children genuinely overlap
    assert parent["ms"] <= r["total_ms"] + 1
    assert r["attributed_ms"] <= r["total_ms"] + 1


@pytest.mark.asyncio
async def test_each_channel_still_reports_its_own_cost():
    t = StageTrace()

    async def chan(name, ms):
        with t.channel(name):
            await asyncio.sleep(ms / 1000)

    with t.concurrent_group("retrieval"):
        await asyncio.gather(chan("dense", 40), chan("bm25", 5))

    chans = {c["stage"]: c["ms"] for c in t.report()["channels"]}
    assert chans["dense"] > chans["bm25"]
    assert all(c["concurrent"] for c in t.report()["channels"])


def test_a_channel_span_is_marked_concurrent_so_nobody_sums_it():
    t = StageTrace()
    with t.channel("dense"):
        burn(5)
    assert t.report()["channels"][0]["concurrent"] is True


# ── It cannot break the request ───────────────────────────────────────────


def test_an_exception_in_the_body_still_records_the_time():
    """How long a stage ran before failing is exactly what a timeout needs."""
    t = StageTrace()
    with pytest.raises(ValueError):
        with t.stage("retrieval"):
            burn(10)
            raise ValueError("provider down")
    span = next(s for s in t.report()["stages"] if s["stage"] == "retrieval")
    assert span["ms"] >= 5


def test_the_body_exception_is_not_swallowed():
    """Hiding a pipeline failure would turn an outage into a wrong answer."""
    t = StageTrace()
    with pytest.raises(RuntimeError):
        with t.stage("generation"):
            raise RuntimeError("boom")


def test_a_broken_detail_payload_does_not_raise():
    """Instrumentation must never be the thing that fails."""
    class Hostile:
        def __repr__(self):
            raise RuntimeError("nope")

    t = StageTrace()
    with t.stage("planning", bad=Hostile()):
        pass
    t.report()
    t.log()


def test_logging_never_raises():
    t = StageTrace()
    with t.stage("planning"):
        pass
    t.log(query_class="EXACT_FINANCIAL_FACT")


def test_an_empty_trace_reports_cleanly():
    r = StageTrace().report()
    assert r["stages"] == []
    assert r["channels"] == []
    assert r["slowest_stage"] == ""
    assert set(r["missing_stages"]) == set(STAGES)


def test_the_report_is_json_serializable():
    import json

    t = StageTrace("abc")
    with t.stage("planning", n=1):
        pass
    with t.channel("dense"):
        pass
    json.dumps(t.report())
