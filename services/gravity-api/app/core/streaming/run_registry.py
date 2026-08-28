"""One search run per trace id, shared by every connection that asks for it.

Two defects motivated this module, and both were invisible from the browser.

*Reconnect duplicated the search.* The client generated a `trace_id`, sent it,
and reconnected up to three times on a dropped socket — re-sending the whole
query each time. The server never read the field, so every reconnect started a
second full retrieval-and-generation run and billed it. The registry makes the
trace id the identity of the work: a second connection quoting the same id
attaches to the run already in flight, replays what it missed, and follows the
rest live.

*Cancel never reached the server.* Closing a browser socket is not cancellation,
and the old handler could not have heard one anyway — it sat inside
`async for event in pipeline.search(...)` and never read from the socket while a
search was running. Here the search is a task, so it can be cancelled, and the
cancellation lands on the real retrieval and generation coroutines.

Deliberately in-process: a single-process asyncio registry is honest about what
it covers, and a cross-process one would need a broker this deployment does not
have. Runs are dropped once finished and drained.
"""

from __future__ import annotations

import asyncio
import time
import uuid
from typing import AsyncIterator, Awaitable, Callable

import structlog

logger = structlog.get_logger()

# How long a finished run stays available for a late reconnect to replay.
FINISHED_TTL_S = 120.0
# Cap on buffered events per run, so a very long token stream cannot grow
# without bound. Replay past the cap is partial, and says so.
MAX_BUFFER = 5000
# Hard ceiling on a single run. Past this the search is cancelled and dropped:
# no answer is worth pinning a task forever, and the finished-run TTL never
# fires for a run that never finishes.
MAX_RUN_LIFETIME_S = 600.0


class SearchRun:
    """A single in-flight or recently finished search, addressed by trace id."""

    def __init__(self, trace_id: str, query: str, user_id: str) -> None:
        self.trace_id = trace_id
        self.query = query
        self.user_id = user_id
        self.events: list[dict] = []
        self.subscribers: list[asyncio.Queue] = []
        self.done = asyncio.Event()
        self.task: asyncio.Task | None = None
        self.cancelled = False
        self.overflowed = False
        self.finished_at: float | None = None
        self.started_at = time.time()
        # Monotonic per-run sequence. The client uses it to order events and to
        # tell a replayed frame from a new one.
        self._seq = 0

    # ── production ──────────────────────────────────────────────────────
    def _publish(self, event: dict) -> None:
        self._seq += 1
        event = {**event, "seq": self._seq}
        if len(self.events) < MAX_BUFFER:
            self.events.append(event)
        else:
            self.overflowed = True
        for q in list(self.subscribers):
            q.put_nowait(event)

    async def run(self, source: AsyncIterator) -> None:
        """Drain the pipeline generator into the buffer and every subscriber."""
        try:
            async for event in source:
                self._publish({
                    "type": event.type,
                    "data": event.data,
                    "trace_id": event.trace_id or self.trace_id,
                    "event_id": getattr(event, "event_id", ""),
                    "ts": getattr(event, "ts", time.time()),
                })
        except asyncio.CancelledError:
            self.cancelled = True
            # A cancelled run has a terminal state of its own. It is never
            # "complete", and nothing downstream may persist it as an answer.
            self._publish({
                "type": "cancelled",
                "data": {"status": "cancelled", "reason": "client_cancelled"},
                "trace_id": self.trace_id,
                "ts": time.time(),
            })
            raise
        except Exception as e:  # noqa: BLE001 — surfaced to the client as an error event
            logger.error("run_failed", trace_id=self.trace_id, error=str(e))
            self._publish({
                "type": "error",
                "data": {"message": "An error occurred during search. Please try again.",
                         "trace_id": self.trace_id},
                "trace_id": self.trace_id,
                "ts": time.time(),
            })
        finally:
            self.finished_at = time.time()
            self.done.set()
            for q in list(self.subscribers):
                q.put_nowait(None)  # end-of-stream sentinel

    # ── consumption ─────────────────────────────────────────────────────
    async def subscribe(self) -> AsyncIterator[dict]:
        """Replay everything already emitted, then follow the run live.

        A reconnecting client therefore sees the whole stream exactly once,
        without the server doing the work twice.
        """
        q: asyncio.Queue = asyncio.Queue()
        replay = list(self.events)
        already_done = self.done.is_set()
        self.subscribers.append(q)
        try:
            for event in replay:
                yield {**event, "replayed": True}
            if already_done:
                return
            seen = len(replay)
            while True:
                event = await q.get()
                if event is None:
                    return
                # Anything that landed in the buffer between the snapshot and
                # the subscribe would otherwise be sent twice.
                if event.get("seq", 0) <= seen:
                    continue
                yield event
        finally:
            if q in self.subscribers:
                self.subscribers.remove(q)

    def cancel(self) -> bool:
        if self.task is not None and not self.task.done():
            self.task.cancel()
            return True
        return False


class RunRegistry:
    """Trace id -> run, scoped to the user who started it.

    Every lookup takes a `user_id` and refuses a run belonging to someone else.
    The trace id is generated by the browser, so without that check a caller who
    learned or guessed another user's id could attach to their in-flight search
    and be streamed its sources and answer, or cancel it. Attaching is the whole
    feature; scoping it to the owner is what keeps it from being a way to read
    someone else's evidence.
    """

    def __init__(self) -> None:
        self._runs: dict[str, SearchRun] = {}

    def get(self, trace_id: str, user_id: str) -> SearchRun | None:
        self._sweep()
        run = self._runs.get(trace_id)
        if run is None:
            return None
        if run.user_id != user_id:
            # Reported as "not found", never as "not yours": the second answer
            # confirms the trace id exists.
            logger.warning("run_owner_mismatch", trace_id=trace_id)
            return None
        return run

    def start(
        self,
        trace_id: str,
        query: str,
        user_id: str,
        source_factory: Callable[[], AsyncIterator],
    ) -> SearchRun:
        """Return this user's run for `trace_id`, starting one only if none exists.

        This is the idempotency point: two connections quoting one trace id get
        one search between them.
        """
        existing = self.get(trace_id, user_id)
        if existing is not None:
            logger.info("run_attached", trace_id=trace_id,
                        finished=existing.done.is_set())
            return existing
        if trace_id in self._runs:
            # The id is taken by another user. Refusing to reuse it keeps one
            # user from displacing another's run; this caller gets its own.
            trace_id = f"{trace_id}:{uuid.uuid4().hex[:8]}"
        run = SearchRun(trace_id, query, user_id)
        self._runs[trace_id] = run
        run.task = asyncio.create_task(run.run(source_factory()))
        logger.info("run_started", trace_id=trace_id)
        return run

    def cancel(self, trace_id: str, user_id: str) -> bool:
        run = self.get(trace_id, user_id)
        return bool(run and run.cancel())

    def _sweep(self) -> None:
        now = time.time()
        for tid, run in list(self._runs.items()):
            if run.finished_at is not None and now - run.finished_at > FINISHED_TTL_S:
                del self._runs[tid]
            elif run.finished_at is None and now - run.started_at > MAX_RUN_LIFETIME_S:
                # A run whose provider wedged would otherwise hold its task and
                # its buffer for the life of the process: the finished-TTL sweep
                # above only ever sees runs that ended. Nothing may live here
                # unboundedly just because it never returned.
                logger.warning("run_expired", trace_id=tid,
                               age_s=round(now - run.started_at, 1))
                run.cancel()
                del self._runs[tid]

    def clear(self) -> None:
        """Drop every run, cancelling any still in flight.

        Cancelling matters: a dropped reference does not stop an asyncio task,
        so a forgotten run would keep its coroutine alive and, in a test
        process, keep the interpreter from exiting.
        """
        for run in self._runs.values():
            run.cancel()
        self._runs.clear()


registry = RunRegistry()
