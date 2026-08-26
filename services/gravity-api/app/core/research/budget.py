"""
How much research one question is allowed to do, and what it actually did.

Spec section 19 asks for caps; spec section 28 asks for a record of usage; spec
section 29 asks that not every query perform a web search. All three are the
same object, because a cap nobody counts against is a comment and a count with
no cap is a bill.

The caps are per-request and deliberately small. Web research is the slowest and
least authoritative leg of the pipeline: the value is in *a few* well-chosen
pages that were actually read, not in many that were skimmed. A budget that
allows twenty fetches produces twenty shallow citations, which is the failure
spec section 17 describes from the other direction.
"""

from __future__ import annotations

import time
from dataclasses import dataclass, field


@dataclass(frozen=True)
class ResearchBudget:
    """The ceiling. Immutable — a run cannot raise its own limits."""

    max_search_queries: int = 4
    max_results_per_query: int = 8
    max_pages_fetched: int = 6
    per_fetch_timeout_s: float = 12.0
    total_deadline_s: float = 25.0
    max_evidence_per_page: int = 3

    @classmethod
    def for_class(cls, question_class: str, *, fresh: bool = False) -> "ResearchBudget":
        """
        The budget appropriate to what was asked.

        A news question needs breadth and recency, so it gets more searches and
        fewer pages. A research question needs depth, so the reverse. An exact
        financial fact gets nothing at all — the answer is in a filing, and
        spending a web round trip to confirm it is both slower and, per spec
        section 9, inadmissible as the source of the figure.

        `fresh` is `SourcePlan.fresh`, and it exists because the class alone gets
        this wrong. "What happened with NVIDIA's latest earnings?" classifies as
        EXACT_FINANCIAL_FACT — it names a company and a metric — so the class
        rule zeroes the budget, while `route_sources` correctly turns the web on
        because the question asks about *now*. Without this parameter the router
        selected WEB and the budget silently spent nothing on it, which is the
        worst of both: a source class reported as used that did no work. Caught
        by running golden question 3 against the live provider stack.

        The SEC leg is unaffected — a fresh question about a filed figure still
        asks the filer (spec section 2). This only restores the web budget the
        router already decided to use.
        """
        from app.core import question_class as qc

        # The router is the single authority on whether the web leg runs at all;
        # this function only decides how much it may spend once it does. Two
        # places deciding "does the web run" is how the disagreement below got
        # in, twice: EXACT_FINANCIAL_FACT was zeroed while a fresh question
        # routed to WEB, and GENERAL was given a budget the router never asked
        # for. Asking `route_sources` removes the second copy of the rule.
        routed = (
            question_class in qc.NEEDS_WEB_RESEARCH
            or question_class in qc.WEB_AUGMENTED
            or fresh
        )
        if not routed:
            return cls(max_search_queries=0, max_pages_fetched=0,
                       total_deadline_s=0.0)

        if question_class in (qc.EXACT_FINANCIAL_FACT, qc.FINANCIAL_TABLE):
            # Reached only when `fresh` is set — recency is the point of the
            # question, so it gets the news shape: more searches, fewer pages,
            # a short deadline. The SEC leg is untouched and still runs.
            return cls(max_search_queries=3, max_results_per_query=8,
                       max_pages_fetched=3, total_deadline_s=20.0)
        if question_class == qc.MARKET_NEWS:
            return cls(max_search_queries=3, max_results_per_query=10,
                       max_pages_fetched=4, total_deadline_s=20.0)
        if question_class in (qc.MULTI_DOCUMENT_RESEARCH, qc.COMPANY_RESEARCH):
            return cls(max_search_queries=5, max_results_per_query=8,
                       max_pages_fetched=8, total_deadline_s=35.0)
        if question_class in (qc.MACRO, qc.MARKET_CONTEXT,
                              qc.GENERAL_WEB_RESEARCH):
            return cls(max_search_queries=4, max_pages_fetched=6,
                       total_deadline_s=25.0)
        # FINANCIAL_CALCULATION and FILING_QUALITATIVE: SEC leads, web adds
        # context around it, so a narrow budget.
        return cls(max_search_queries=2, max_results_per_query=6,
                   max_pages_fetched=3, total_deadline_s=18.0)


@dataclass
class ResearchUsage:
    """
    What the run spent and produced. Every field in spec section 28 that this
    layer is responsible for; the SEC counters live in `sec_telemetry` and are
    merged at the pipeline.
    """

    search_queries: int = 0
    results_returned: int = 0
    pages_attempted: int = 0
    pages_fetched: int = 0
    pages_blocked: int = 0
    evidence_created: int = 0
    duplicates_dropped: int = 0
    stale_dropped: int = 0
    injection_flags: int = 0
    provider: str = ""
    errors: list[str] = field(default_factory=list)
    started_at: float = field(default_factory=time.perf_counter)
    latency_ms: float = 0.0
    degraded: str = ""

    def note_error(self, message: str) -> None:
        """Record a failure without raising. Spec section 15: web failure must
        never crash the pipeline, but it must never be silent either."""
        text = str(message)[:200]
        if text not in self.errors:
            self.errors.append(text)

    def finish(self) -> "ResearchUsage":
        self.latency_ms = round((time.perf_counter() - self.started_at) * 1000, 1)
        return self

    def as_dict(self) -> dict:
        return {
            "web_search_queries": self.search_queries,
            "web_results_returned": self.results_returned,
            "web_pages_attempted": self.pages_attempted,
            "web_pages_fetched": self.pages_fetched,
            "web_pages_blocked": self.pages_blocked,
            "web_evidence_created": self.evidence_created,
            "web_duplicates_dropped": self.duplicates_dropped,
            "web_stale_dropped": self.stale_dropped,
            "web_injection_flags": self.injection_flags,
            "web_provider": self.provider,
            "web_errors": list(self.errors),
            "web_latency_ms": self.latency_ms,
            "web_degraded": self.degraded,
        }


class Deadline:
    """A wall clock the run checks before starting anything expensive."""

    __slots__ = ("_deadline",)

    def __init__(self, seconds: float):
        self._deadline = time.perf_counter() + max(0.0, float(seconds))

    @property
    def remaining(self) -> float:
        return max(0.0, self._deadline - time.perf_counter())

    @property
    def expired(self) -> bool:
        return self.remaining <= 0.0
