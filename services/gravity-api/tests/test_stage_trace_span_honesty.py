"""L13 / latency — `serialization` was not measuring serialization.

The roadmap records the symptom and says the cause was not found:
`serialization` is bimodal at 12 ms / 4069 ms. A stage that is either instant
or four seconds is not one operation, and averaging it produces a number that
describes neither mode.

The cause is the span's extent, not the work inside it. `_t_ser` is taken at
`_st.add("provenance", ...)` and the span closes just before the metadata
yield, so it encloses two things that are not serialization:

  1. `await self.cache.set(...)` — a Redis network round-trip, and one that is
     SKIPPED ENTIRELY on refusals (`if self.cache and not _is_refusal`). One
     branch does no I/O and the other does a network write. That is the
     bimodality, in one `if`.

  2. the `yield` of the answer event. In an async generator the producer is
     suspended at `yield` until the consumer asks for the next item, and every
     millisecond the consumer spends is charged to the producer's wall clock.
     A slow WebSocket drain is billed here as "serialization".

Neither is a serialization cost, and no amount of optimising the serialisation
code would move the number. The fix is to measure the three things separately,
which is why this is worth a loop and squeezing 500 ms off the CPU work is not:
the instrument was reporting a figure nobody could act on.

These are structural assertions on the source. That is the right shape here —
reproducing a 4-second tail needs a live Redis and a real consumer, neither of
which this suite has, and a timing assertion would be flaky. What can be pinned
exactly is that a span named for CPU work does not enclose a network call or a
suspension point.
"""

from __future__ import annotations

import inspect
import re

from app.core.finance.stage_trace import STAGES
from app.core.search_pipeline import SearchPipeline

SRC = inspect.getsource(SearchPipeline.search)


def _between(open_marker: str, close_marker: str) -> str:
    """The source between where a span opens and where it is recorded."""
    start = SRC.index(open_marker)
    end = SRC.index(close_marker, start)
    return SRC[start:end]


# ── the span must not enclose what it cannot control ──────────────────────


def test_the_serialization_span_does_not_enclose_the_cache_write():
    """
    A Redis round-trip inside a CPU stage, on one branch of an `if`, is the
    whole bimodality: refusals skip the write and everything else pays it.
    """
    span = _between("_t_ser = time.perf_counter()",
                    '_st.add("serialization"')
    assert "self.cache.set(" not in span, (
        "the serialization span encloses the cache write; the stage reports "
        "network time under a name that says CPU"
    )


def test_the_serialization_span_does_not_straddle_a_yield():
    """
    An async generator suspended at `yield` bills the consumer's time to the
    producer. A span across a yield measures the client, not the pipeline.
    """
    span = _between("_t_ser = time.perf_counter()",
                    '_st.add("serialization"')
    assert "yield SearchEvent" not in span, (
        "the serialization span spans a yield, so a slow consumer is recorded "
        "as pipeline serialization time"
    )


def test_the_cache_write_is_timed_under_its_own_name():
    """What was hidden must be visible, not merely excluded."""
    assert "cache_write" in STAGES, (
        "the cache write was removed from the serialization span without being "
        "given a stage of its own, so its cost is now unmeasured entirely"
    )
    assert '_st.add("cache_write"' in SRC


def test_the_client_wait_is_timed_under_its_own_name():
    assert "answer_yield" in STAGES
    assert '_st.add("answer_yield"' in SRC


# ── the general rule, so the next stage does not repeat it ────────────────


def test_no_timed_span_encloses_a_network_write():
    """
    The property, not the instance. A future stage that wraps an `await` on an
    external service inherits exactly this defect.
    """
    offenders = []
    for stage in ("serialization", "provenance", "verification"):
        m = re.search(rf'_st\.add\("{stage}"', SRC)
        if not m:
            continue
        # Walk back to the nearest span opening before this record.
        head = SRC[:m.start()]
        opens = [i for i in (head.rfind("= time.perf_counter()"),) if i != -1]
        if not opens:
            continue
        span = SRC[opens[0]:m.start()]
        if "self.cache.set(" in span:
            offenders.append(stage)
    assert not offenders, f"stages enclosing a cache write: {offenders}"


def test_every_declared_stage_is_actually_recorded():
    """
    A declared stage that nothing writes is a hole reported as a measurement.
    `stage_trace` says it declares stages so a missing one shows as a hole —
    this is what checks that the hole is not permanent.
    """
    missing = [s for s in STAGES if f'_st.add("{s}"' not in SRC]
    # `request` is opened by the trace itself rather than added by the pipeline.
    missing = [s for s in missing if s != "request"]
    assert not missing, f"declared but never recorded: {missing}"
