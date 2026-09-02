"""
Where the time actually goes, boundary by boundary.

The pipeline already timed three things — query understanding, retrieval and
rerank. Measured end to end it takes ~27s, and those three plus the separately
measured generation, embedding and rerank medians account for about 3.4s. So
roughly 23s was happening somewhere nobody was looking, and no amount of
staring at the three existing numbers could say where: an unmeasured stage is
indistinguishable from a fast one.

This is the instrument that makes that difference visible. It is deliberately
dumb — a dict of named spans and a monotonic clock — because a profiler that
needs its own debugging is not an instrument, and because this runs on every
request in production.

Three properties it has to have, and each one has a test:

**It cannot lose time.** Every span is accounted for against the wall clock,
and `unattributed_ms` is reported explicitly rather than being quietly absorbed
into the parent. A tracer that silently swallows the gap would have hidden the
very 23s it exists to find.

**It cannot fail the request.** Instrumentation that can raise turns a
measurement problem into an outage. Every entry point swallows its own errors;
the worst case is a missing number, never a lost answer.

**It cannot lie about concurrency.** Retrieval channels run under
`asyncio.gather`, so their spans overlap. Summing them would produce a total
larger than the wall time and an attribution that is nonsense. Concurrent spans
are recorded separately, and the parent contributes its *wall* duration while
each channel still reports its own cost.

It lives under `app/core/finance/` for an unglamorous reason: `app/core/`
already contains both `observability.py` and `telemetry.py` as modules, and a
package with either name silently shadows the module. That mistake was made
once during this work and broke `get_tracer` for 51 tests.
"""

from __future__ import annotations

import time
from contextlib import contextmanager
from dataclasses import dataclass, field

import structlog

logger = structlog.get_logger()

__all__ = ["STAGES", "Span", "StageTrace"]

#: The boundaries the roadmap names, in pipeline order. Declared rather than
#: discovered so a stage that never runs is visible as a hole in the report
#: instead of simply being absent.
STAGES = (
    "request",
    "planning",
    "entity",
    "evidence_gate",
    "retrieval",
    "merge_dedup",
    "rerank",
    "context",
    "generation",
    "verification",
    "provenance",
    "serialization",
)


@dataclass
class Span:
    name: str
    ms: float = 0.0
    count: int = 1
    concurrent: bool = False
    detail: dict = field(default_factory=dict)

    def as_dict(self) -> dict:
        d = {"stage": self.name, "ms": round(self.ms, 2)}
        if self.count != 1:
            d["count"] = self.count
        if self.concurrent:
            d["concurrent"] = True
        if self.detail:
            d["detail"] = self.detail
        return d


class StageTrace:
    """
    One request's timing, assembled as it runs.

    Usage is a context manager per boundary::

        with trace.stage("retrieval"):
            ...

    and for the fan-out, where spans genuinely overlap::

        with trace.concurrent_group("retrieval"):
            with trace.channel("dense"):
                ...
    """

    def __init__(self, trace_id: str = "") -> None:
        self.trace_id = trace_id
        self._t0 = time.perf_counter()
        self._spans: dict[str, Span] = {}
        self._channels: dict[str, Span] = {}

    # ── Recording ─────────────────────────────────────────────────────────

    @contextmanager
    def stage(self, name: str, **detail):
        """
        Time one boundary. Never raises on the instrumentation path.

        The body's own exception propagates — swallowing that would turn a
        pipeline failure into a silent wrong answer — but the timing is still
        recorded, because how long a stage took before it failed is exactly
        what you want when diagnosing a timeout.
        """
        t = time.perf_counter()
        try:
            yield
        finally:
            try:
                self._record(name, (time.perf_counter() - t) * 1000, detail)
            except Exception:  # noqa: BLE001 — measurement must not break the request
                pass

    @contextmanager
    def concurrent_group(self, name: str, **detail):
        """
        A stage whose children overlap.

        The group contributes its wall duration to the total; the children are
        reported individually and explicitly marked `concurrent`, so nobody
        sums them and concludes the request took longer than it did.
        """
        t = time.perf_counter()
        try:
            yield
        finally:
            try:
                self._record(name, (time.perf_counter() - t) * 1000,
                             {**detail, "concurrent_children": True})
            except Exception:  # noqa: BLE001
                pass

    @contextmanager
    def channel(self, name: str, **detail):
        """One retrieval channel inside a concurrent group."""
        t = time.perf_counter()
        try:
            yield
        finally:
            try:
                self._channel(name, (time.perf_counter() - t) * 1000, detail)
            except Exception:  # noqa: BLE001
                pass

    def add(self, name: str, ms: float, **detail) -> None:
        """Record a span measured elsewhere (an existing `perf_counter` pair)."""
        try:
            self._record(name, float(ms), detail)
        except Exception:  # noqa: BLE001
            pass

    def add_channels(self, timings: dict | None, *, failed: dict | None = None,
                     counts: dict | None = None) -> None:
        """
        Adopt the orchestrator's per-channel numbers.

        The fan-out costs its SLOWEST channel, not the sum, so a single
        straggler is invisible in the aggregate while setting the floor for the
        whole request. `failed` and `counts` ride along so one row answers "how
        long, how many, and did it work" — the three questions that separate a
        slow channel from a broken one.
        """
        try:
            for name, ms in (timings or {}).items():
                detail = {}
                if failed and name in failed:
                    detail["error_type"] = failed[name]
                if counts is not None and name in counts:
                    detail["results"] = counts[name]
                self._channel(str(name), float(ms), detail, replace=True)
        except Exception:  # noqa: BLE001
            pass

    def _channel(self, name: str, ms: float, detail: dict,
                 replace: bool = False) -> None:
        s = self._channels.get(name)
        if s is None:
            self._channels[name] = Span(name, ms, 1, True, dict(detail or {}))
        elif replace:
            s.ms = ms
            s.detail.update(detail or {})
        else:
            s.ms += ms
            s.count += 1
            s.detail.update(detail or {})

    def _record(self, name: str, ms: float, detail: dict) -> None:
        s = self._spans.get(name)
        if s is None:
            self._spans[name] = Span(name, ms, 1, False, dict(detail or {}))
        else:
            s.ms += ms
            s.count += 1
            if detail:
                s.detail.update(detail)

    # ── Reading ───────────────────────────────────────────────────────────

    @property
    def total_ms(self) -> float:
        return (time.perf_counter() - self._t0) * 1000

    @property
    def attributed_ms(self) -> float:
        """Sum of top-level spans. Channels are excluded — their parent counts."""
        return sum(s.ms for s in self._spans.values())

    def report(self) -> dict:
        """
        The trace, ordered slowest first, with the gap named.

        `unattributed_ms` is the point of the whole module. If it is large, the
        instrumentation is incomplete and the report says so instead of
        implying the measured stages are the whole story.
        """
        total = self.total_ms
        spans = sorted(self._spans.values(), key=lambda s: -s.ms)
        channels = sorted(self._channels.values(), key=lambda s: -s.ms)
        attributed = self.attributed_ms
        unattributed = total - attributed
        return {
            "trace_id": self.trace_id,
            "total_ms": round(total, 2),
            "attributed_ms": round(attributed, 2),
            "unattributed_ms": round(unattributed, 2),
            "unattributed_pct": round(100.0 * unattributed / total, 1) if total > 0 else 0.0,
            "stages": [s.as_dict() for s in spans],
            "channels": [s.as_dict() for s in channels],
            "slowest_stage": spans[0].name if spans else "",
            "slowest_channel": channels[0].name if channels else "",
            "missing_stages": [s for s in STAGES if s not in self._spans],
        }

    def log(self, **extra) -> None:
        """Emit the trace once, at the end of a request."""
        try:
            r = self.report()
            logger.info(
                "stage_trace",
                trace_id=self.trace_id,
                total_ms=r["total_ms"],
                unattributed_ms=r["unattributed_ms"],
                slowest=r["slowest_stage"],
                slowest_channel=r["slowest_channel"],
                stages={s["stage"]: s["ms"] for s in r["stages"]},
                channels={s["stage"]: s["ms"] for s in r["channels"]},
                **extra,
            )
        except Exception:  # noqa: BLE001
            pass
