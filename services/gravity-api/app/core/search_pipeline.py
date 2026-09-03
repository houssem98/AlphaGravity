"""
Gravity Search — Main Search Pipeline
The heart of Gravity Search. Orchestrates the full query lifecycle:

  Query → Understanding → Cache Check → Parallel Retrieval → RRF Fusion
  → Reranking → LLM Reasoning → Citation Validation → Streaming Response

Modes:
  reasoning_depth="fast"    — Linear single-pass pipeline (simple queries)
  reasoning_depth="agentic" — Multi-agent loop: Planner→Reader→Extractor→Critic→Writer
  reasoning_depth="auto"    — Auto-select based on query complexity

Target latencies:
  Simple queries (fast): <200ms end-to-end
  Complex multi-hop (agentic): <8s end-to-end
"""

import asyncio
import re
import time
import uuid
from collections import Counter
from dataclasses import dataclass, field
from typing import AsyncIterator

import structlog

from app.config import settings
from app.api.middleware.pii_filter import PIIFilter
from app.core.query_understanding import suppresses_xbrl
from app.core.finance.query_plan import plan_query as plan_finance_query
from app.core.question_class import classify as classify_question
from app.core.question_class import route_channels, route_sources
from app.core.retrieval import citation_provenance, sec_telemetry
from app.core.retrieval.fusion import RetrievalResult, authority_aware_rrf
from app.core.reasoning.prompts import (
    FINANCIAL_ANALYST_SYSTEM,
    build_user_message,
    build_reasoning_system_prompt,
    strip_ai_wording,
)
from app.core.reasoning.numeric_verifier import verify_answer_numerics, format_mismatch_report
from app.core.reasoning.temporal_verifier import verify_temporal_consistency, format_temporal_report
from app.core.reasoning.nli_judge import FinanceNLIJudge
from app.core.verification import citation_verdict
from app.core.feedback.routing_feedback import RoutingFeedbackLoop, FeedbackRecord
from app.llm.base import LLMConfig, LLMMessage
from app.llm.router import LLMRouter, RoutingDecision

_nli_judge = FinanceNLIJudge()  # shared singleton; T5 loaded once if GPU available

logger = structlog.get_logger()

# Complexities that benefit from self-consistency (3 runs → pick majority).
# DISABLED: with DeepSeek (slow, ~15s/call) the 3× generation on math/complex
# queries blew past the latency budget and timed out 23/150 FinanceBench Qs —
# losing more to auto-fail than self-consistency recovered (DeepSeek already
# hallucinates ~18%). Re-enable (add "math","complex") with a fast model.
_SELF_CONSISTENCY_COMPLEXITIES: set[str] = set()
_SELF_CONSISTENCY_RUNS = 3

_pii_filter = PIIFilter()


# ── Answer provenance ───────────────────────────────────────────────────
# A cached reply used to report retrieval_channels [] and model_used "unknown",
# so the cheapest answers in the system were the only ones nobody could audit —
# and a channel that had gone dark was indistinguishable from one never asked.
# Module-level and pure, so both paths can be tested without a Redis or a pipeline.

def cache_provenance_of(retrieval_results, routing_decision, passages_used, trace_id) -> dict:
    """What produced this answer, stored alongside it in the cache."""
    results = retrieval_results or {}
    return {
        "retrieval_channels": [k for k, v in results.items() if v],
        "channels_dark": [k for k, v in results.items() if not v],
        "model_used": routing_decision.primary_model,
        "complexity": routing_decision.complexity.value,
        "estimated_cost_usd": round(routing_decision.estimated_cost, 4),
        "passages_used": passages_used,
        "trace_id": trace_id,
    }


#: When the entity resolver may next be attempted. A list so the closure inside
#: `search()` can write to it without a `global`.
#:
#: The resolver is rebuilt by `get_resolver` whenever its singleton is not
#: ready. With the SEC ticker file unreachable it never becomes ready, so every
#: request paid the full 2s `wait_for` timeout and then silently skipped
#: resolution — a fixed 2-4s tax that the stage trace exposed as a suspiciously
#: CONSTANT `entity` span. Constant time is a timeout, not work.
_RESOLVER_BACKOFF_S = 60.0
_resolver_backoff_until = [0.0]


def gate_verdict_failed(prov: dict | None) -> bool:
    """True unless a stored verdict explicitly says the gate PASSED it.

    Reversed in L3, on new information. Round 1 read an absent verdict as
    UNKNOWN rather than FAILED and served it, reasoning that refusing would
    "empty the cache to buy nothing". That reasoning assumed unverdicted
    entries keep arriving. L2 closed the write path to anything but a passing
    verdict, and this module holds the only `cache.set` in the service, so the
    unverdicted population is now CLOSED: refusing costs one TTL window, once,
    and buys the invariant that everything served was checked before it was
    stored.

    TTL proves expiry, not verification. An entry served today because it will
    expire tomorrow is still an answer nothing checked.

    A refused entry is a MISS, not an error — the caller falls through and
    recomputes, so this declines to replay an answer, never to give one.
    """
    if not isinstance(prov, dict):
        return True
    gate = prov.get("contract_gate")
    return not (isinstance(gate, dict) and gate.get("passed") is True)


def replay_metadata(prov: dict | None, latency_ms: float, trace_id: str) -> dict:
    """Metadata for a cache hit.

    `prov` is None for entries written before provenance was stored. Those report
    `legacy` and keep the unknowns visible — an empty channel list presented as a
    measurement is worse than one labelled as missing.
    """
    # An entry stored before the gate existed cannot claim the gate passed, and
    # an absent key reads as None exactly like a silent pass. Say "not recorded".
    _unrecorded = {"recorded": False, "passed": None,
                   "reason": "cached before the answer contract was checked"}
    base = {"latency_ms": latency_ms, "cache_hit": True, "trace_id": trace_id,
            "estimated_cost_usd": 0.0}
    if not prov:
        return {**base, "cache_provenance": "legacy", "model_used": "unknown",
                "complexity": "unknown", "retrieval_channels": [],
                "channels_dark": [], "passages_used": 0,
                "contract_gate": _unrecorded}
    return {**base, "cache_provenance": "replay",
            "contract_gate": prov.get("contract_gate") or _unrecorded,
            "model_used": prov.get("model_used", "unknown"),
            "complexity": prov.get("complexity", "unknown"),
            "retrieval_channels": prov.get("retrieval_channels", []),
            "channels_dark": prov.get("channels_dark", []),
            "passages_used": prov.get("passages_used", 0)}


# ── Event Types for Progressive Streaming ───────────────────────────────
# The stages a client may be told about. An event naming a stage outside this
# set is a bug in the pipeline, not a new feature of the UI: the progress view
# is a projection of these and may not invent members of its own.
SEARCH_STAGES: frozenset[str] = frozenset({
    "understanding",
    "searching",
    "resolving_primary_source",
    "answering_from_verified_evidence",
    "reranking",
    "reasoning",
    "cancelled",
})


@dataclass
class SearchEvent:
    """Events streamed to the client via WebSocket.

    `event_id` and `ts` exist so a consumer can identify an event and
    reconstruct the order it was produced in. Without them a reconnecting
    client could not tell a replayed frame from a new one, and the UI had no
    measured time to show — which is why it used to animate its own.
    """
    type: str       # "status" | "sources" | "token" | "answer" | "metadata" | "error"
                    # + "agent_trace" | "structured_table" | "agent_trace_complete"
                    # + "retrieval" | "verification" | "cancelled"
    data: dict | str | list | None = None
    trace_id: str = ""
    event_id: str = field(default_factory=lambda: uuid.uuid4().hex[:16])
    ts: float = field(default_factory=time.time)


def _gate_check(contract, *, answer, citations, scope_status, trace_id):
    """Run the final gate and return its verdict, or None if it could not run.

    Called on every path that publishes an answer, and called BEFORE the answer
    is yielded. A verdict computed after the yield is a post-mortem: the reader
    already has the answer, so `contract_gate` can describe what happened but
    can no longer travel with the thing it describes.

    Reported, never enforced by rewriting: a gate that edits an answer to
    satisfy itself is grading its own work. Violations ride on the answer event
    and in the metadata so a caller can see exactly which clause was missed.
    Making the gate refuse is a separate, deliberate product decision.

    Never returns None. An answer the gate did not check carries a LABEL saying
    so, because `contract_gate: null` reads exactly like a gate that passed
    silently — the same mistake `replay_metadata` already fixed on the cache
    path ("an empty channel list presented as a measurement is worse than one
    labelled as missing"), applied to channels but not here.

    The two ways an answer goes unchecked are different facts and report
    different reasons: a caller seeing `no_contract` has a planning problem, one
    seeing `gate_error` has a bug in the gate. Collapsing both to `null` hides
    which. Neither ever reports `passed: True`, and neither carries violations —
    an unchecked answer that listed violations would be claiming it was checked.
    """
    if contract is None:
        return {"recorded": False, "passed": None, "violations": [],
                "reason": "no_contract: finance planning failed, so no answer "
                          "contract was built for this query"}
    try:
        from app.core.finance.answer_contract import FinalGate
        result = FinalGate.check(
            contract,
            answer=str(answer or ""),
            citations=citations or [],
            scope_status=str(scope_status or ""),
        ).as_dict()
        if not result["passed"]:
            logger.warning("answer_contract_violated", trace_id=trace_id,
                           violations=result["violations"])
        return result
    except Exception as _ge:  # noqa: BLE001 — a gate must not lose an answer
        logger.warning("final_gate_failed", trace_id=trace_id,
                       error_type=type(_ge).__name__)
        return {"recorded": False, "passed": None, "violations": [],
                "reason": f"gate_error: the gate could not be evaluated "
                          f"({type(_ge).__name__})"}


# ── Search Pipeline ─────────────────────────────────────────────────────
class SearchPipeline:
    """
    Main search orchestrator.

    Usage:
        pipeline = SearchPipeline(...)
        async for event in pipeline.search(query, filters):
            await websocket.send_json(event)
    """

    def __init__(
        self,
        llm_router: LLMRouter,
        retrieval_orchestrator,   # app.core.retrieval.orchestrator.RetrievalOrchestrator
        reranker,                 # app.core.reranking.cohere_reranker.CohereReranker
        query_understander,       # app.core.query_understanding.QueryUnderstanding
        citation_validator,       # app.core.reasoning.validator.CitationValidator
        semantic_cache,           # app.core.caching.semantic_cache.SemanticCache
        feedback_loop: RoutingFeedbackLoop | None = None,
        ratio_engine=None,        # app.core.finance.ratio_engine.RatioEngine (deterministic)
        audit_logger=None,        # compliance.audit_log.AuditLogger
    ):
        self.llm_router = llm_router
        self.retrieval = retrieval_orchestrator
        self.reranker = reranker
        self.query_understander = query_understander
        self.validator = citation_validator
        self.cache = semantic_cache
        self.feedback = feedback_loop
        self.ratio_engine = ratio_engine
        self.audit_logger = audit_logger

    def _should_use_agentic(self, reasoning_depth: str, query_plan: dict) -> bool:
        """Decide whether to use the multi-agent orchestrator.

        GATED OFF by default: the Planner→Reader→Extractor→Critic→Writer orchestrator
        returns an EMPTY final answer (the Writer's facts never reach it — it has none
        of the structured force-include / multi-metric pinning the single-pass path
        carries) and empty is strictly worse than a grounded single-pass answer. Until
        the orchestrator is rebuilt on the working retrieval, route everything to
        single-pass, which now handles complex/analytical queries with pinned XBRL
        facts + the analyst prompt. Re-enable via settings.agentic_orchestrator_enabled.
        """
        try:
            if not getattr(settings, "agentic_orchestrator_enabled", False):
                return False
        except Exception:
            return False
        if reasoning_depth == "agentic":
            return True
        if reasoning_depth == "fast":
            return False
        complexity = query_plan.get("complexity", "simple")
        intent = query_plan.get("intent", "")
        return complexity in ("complex", "math") or intent in (
            "multi_hop_reasoning",
            "contradiction_detection",
        )

    async def _get_conversation_context(self, conversation_id: str | None) -> str:
        """
        Load prior turns + numeric state from Redis for conversational context.

        Returns two sections (when available):
          1. KNOWN FACTS block (ConvFinQA numeric state)
          2. Prior Q&A turns (last 3)
        """
        if not conversation_id or not self.cache:
            return ""

        parts = []

        # ConvFinQA numeric state: inject known facts first so the LLM
        # sees verified numbers before it reads the new question
        try:
            from app.core.reasoning.numeric_state import get_numeric_state_tracker
            tracker = get_numeric_state_tracker()
            facts_block = await tracker.get_facts_block(conversation_id)
            if facts_block:
                parts.append(facts_block)
        except Exception as e:
            logger.warning("numeric_state_load_failed", error=str(e))

        # Prior Q&A turns
        try:
            from app.db.redis import redis_client
            raw = await redis_client.get(f"conv:{conversation_id}")
            if raw:
                import json
                turns = json.loads(raw)
                turn_parts = []
                for t in turns[-3:]:
                    turn_parts.append(f"Previous Q: {t['query']}\nPrevious A: {t['answer'][:300]}...")
                if turn_parts:
                    parts.append("\n\n".join(turn_parts))
        except Exception as e:
            logger.warning("conversation_context_failed", error=str(e))

        return "\n\n".join(parts)

    async def _save_conversation_turn(
        self, conversation_id: str | None, query: str, answer: str
    ):
        """
        Append this turn to the conversation history in Redis (TTL 2h).
        Also records numeric facts extracted from the answer for ConvFinQA state.
        """
        if not conversation_id:
            return

        # Record numeric facts from answer (fire-and-forget)
        try:
            from app.core.reasoning.numeric_state import get_numeric_state_tracker
            tracker = get_numeric_state_tracker()
            asyncio.create_task(tracker.record_turn(conversation_id, answer))
        except Exception as e:
            logger.warning("numeric_state_record_failed", error=str(e))

        try:
            import json
            from app.db.redis import redis_client
            key = f"conv:{conversation_id}"
            raw = await redis_client.get(key)
            turns = json.loads(raw) if raw else []
            turns.append({"query": query, "answer": answer})
            await redis_client.setex(key, 7200, json.dumps(turns[-10:]))  # keep last 10
        except Exception as e:
            logger.warning("conversation_save_failed", error=str(e))

    async def _self_consistent_generate(
        self,
        client,
        system_msg: LLMMessage,
        user_msg: LLMMessage,
        n_runs: int = _SELF_CONSISTENCY_RUNS,
    ) -> str:
        """
        Run generation N times and return the most self-consistent response.

        Self-consistency (Wang et al. 2022) reduces hallucination by 12-18% on
        quantitative queries. We pick the response whose key numeric values
        appear most frequently across runs.

        Args:
            client:     LLM client already selected by router
            system_msg: System prompt message
            user_msg:   User message with formatted sources
            n_runs:     Number of parallel generation runs (default 3)

        Returns:
            The most consistent response string
        """
        config = LLMConfig(temperature=0.3, max_tokens=4096)  # Higher temp for diversity

        # Run N generations in parallel
        tasks = [
            client.generate(messages=[system_msg, user_msg], config=config)
            for _ in range(n_runs)
        ]
        responses = await asyncio.gather(*tasks, return_exceptions=True)
        valid = [r.content for r in responses if not isinstance(r, Exception) and r.content]

        if not valid:
            return ""
        if len(valid) == 1:
            return valid[0]

        # Extract numeric values from each response and vote for the most consistent
        _NUM_PAT = re.compile(r"\$?[\d,]+(?:\.\d+)?(?:\s*(?:billion|million|%|B|M|K)\b)?")

        def _key_numbers(text: str) -> frozenset[str]:
            """Extract normalised numeric strings as a fingerprint."""
            return frozenset(m.group(0).strip().lower() for m in _NUM_PAT.finditer(text))

        fingerprints = [_key_numbers(v) for v in valid]

        # Score each response by how many of its numbers appear in OTHER responses
        scores = []
        for i, fp_i in enumerate(fingerprints):
            overlap = sum(
                len(fp_i & fingerprints[j])
                for j in range(len(fingerprints)) if j != i
            )
            scores.append((overlap, i))

        best_idx = max(scores, key=lambda x: x[0])[1]

        logger.info(
            "self_consistency_selected",
            n_runs=len(valid),
            best_run=best_idx,
            score=scores[best_idx][0],
        )
        return valid[best_idx]

    async def _evidence_gate(self, query: str, tickers: list, company_terms=None):
        """
        Ask whether exact verified local evidence already answers this question.

        Every input is derived deterministically from the question — the same
        parsers the EDGAR channel uses — so the routing decision never depends on
        an LLM, and never on results that do not exist yet. Returns `None` when
        the question is not pinned enough to be gated (no issuer, or no metric we
        recognise), which routes to SEC exactly like a miss.
        """
        from app.core.retrieval import evidence_gate
        from app.core.retrieval.edgar_search import (
            classify_metric,
            parse_fiscal_years,
            parse_quarter,
        )

        try:
            ticker = (tickers or [None])[0]
            if not ticker:
                return None
            concept, _label = classify_metric(query)
            years = parse_fiscal_years(query)
            cik = None
            edgar = getattr(self.retrieval, "channels", {}).get("edgar")
            if edgar is not None:
                # Resolving the CIK uses SEC's ticker file, which the channel
                # caches for a day. It is identity, not facts — no filing is
                # fetched, so this does not defeat the point of the gate.
                cik = await edgar.ticker_to_cik(ticker)
            return await evidence_gate.check_verified_local_evidence(
                query=query,
                ticker=ticker,
                cik=cik,
                concept=concept,
                fiscal_year=years[-1] if years else None,
                fiscal_quarter=parse_quarter(query),
                company_terms=company_terms,
            )
        except Exception as e:
            # A gate that errors must not become a gate that silently skips SEC.
            logger.warning("evidence_gate_failed", error=str(e)[:160])
            return None

    async def search(
        self,
        query: str,
        filters: dict | None = None,
        stream: bool = True,
        reasoning_depth: str = "auto",
        conversation_id: str | None = None,
        user_id: str | None = None,
        trace_id: str | None = None,
    ) -> AsyncIterator[SearchEvent]:
        """
        Execute the full search pipeline with progressive streaming.

        Yields SearchEvent objects as each stage completes:
          1. status("Analyzing query...")           — instant
          2. status("Searching X documents...")      — <50ms
          3. sources([...])                          — <130ms
          4. token("word ")                          — 200ms+ (streaming)
          5. answer({answer, citations, confidence}) — complete
          6. metadata({latency, model, cost})        — final

        When reasoning_depth="agentic" (or auto-detected complex), delegates
        to the AgentOrchestrator for multi-agent processing.
        """
        # The caller's trace id wins when given. The WebSocket route derives it
        # from the client's own id so that a reconnect addresses this same run
        # rather than starting a second one, and so a cancel can name it.
        trace_id = trace_id or str(uuid.uuid4())
        start = time.perf_counter()
        # Boundary-by-boundary timing. Three stages were timed before this and
        # ~23s of a ~27s request happened in none of them: an unmeasured stage
        # is indistinguishable from a fast one. Every boundary now reports, and
        # the report names any remainder as unattributed rather than absorbing
        # it into whichever stage happens to wrap it.
        from app.core.finance.stage_trace import StageTrace
        _st = StageTrace(trace_id)
        total_cost = 0.0
        # Count what this run asks sec.gov for, split into identity lookups and
        # authoritative fact/filing/archive requests. The evidence gate's claim
        # is about the second kind only, so the two are never summed.
        _sec_log = sec_telemetry.start()
        conversation_context = await self._get_conversation_context(conversation_id)

        # Observability: start Langfuse trace (no-op if not configured)
        from app.core.observability import get_tracer
        _tracer = get_tracer()
        _otrace = _tracer.start_trace(
            trace_id=trace_id,
            query=query,
            session_id=conversation_id or "",
        )

        try:
            # ── Stage 0: PII Stripping ───────────────────────────────────
            query, redacted = _pii_filter.filter(query)
            if redacted:
                logger.info("pii_stripped", trace_id=trace_id, types=redacted)

            # ── Stage 1: Query Understanding (<50ms) ────────────────────
            yield SearchEvent(type="status", data={"status": "understanding", "message": "Analyzing your query..."}, trace_id=trace_id)

            t0 = time.perf_counter()
            try:
                query_plan = await asyncio.wait_for(
                    self.query_understander.analyze(query), timeout=5.0
                )
            except asyncio.TimeoutError:
                import copy as _copy
                from app.core.query_understanding import DEFAULT_QUERY_PLAN
                # deepcopy: .copy() is shallow → the nested `entities` dict would be
                # SHARED across every defaulted request, so the company-recovery
                # fallback's in-place mutation leaked the first query's ticker into
                # all subsequent ones (every query resolved to the first company).
                query_plan = _copy.deepcopy(DEFAULT_QUERY_PLAN)
                # A timeout skips analyze() entirely, so the group expansion inside
                # it never runs. Re-apply it here: the table is a regex lookup with
                # no network call, so "compare FAANG margins" still arrives at
                # retrieval with five tickers instead of none on the one path where
                # the classifier gave us nothing at all.
                from app.core.entities.group_aliases import merge_group_companies
                merge_group_companies(query_plan, query)
                logger.warning(
                    "query_understanding_timeout", trace_id=trace_id, query=query[:60],
                    group_tickers=[
                        c.get("ticker")
                        for c in query_plan.get("entities", {}).get("companies", [])
                    ],
                )
            # Defensive: ensure entities is a per-request dict even on the success
            # path, so downstream in-place enrichment never mutates shared state.
            import copy as _copy2
            query_plan = _copy2.deepcopy(query_plan) if isinstance(query_plan, dict) else query_plan
            understanding_ms = (time.perf_counter() - t0) * 1000
            _st.add("planning", understanding_ms)
            # Init timing metrics so every retrieval path (single-pass, iterative,
            # on-demand) is safe to reference at Stage 10 — the iterative branch
            # never set rerank_ms, raising UnboundLocalError on complex queries.
            retrieval_ms = 0.0
            rerank_ms = 0.0

            # ── Stage 1b: Entity Resolution ──────────────────────────────
            # Disambiguate company mentions → canonical (ticker, CIK, name).
            # Runs fire-and-forget in parallel with cache check (no await needed
            # for the result — we enrich query_plan in place if resolver is ready).
            _t_entity = time.perf_counter()
            _raw_companies = query_plan.get("entities", {}).get("companies", [])
            # A resolver that failed a moment ago will fail again, and paying
            # its 2s timeout on every request buys nothing. `get_resolver`
            # rebuilds whenever the singleton is not ready, so with the ticker
            # file unreachable this was a guaranteed 2-4s tax per query — the
            # single largest fixed cost the stage trace found.
            if _raw_companies and time.time() >= _resolver_backoff_until[0]:
                try:
                    from app.core.entity_resolver import get_resolver
                    from app.db.redis import redis_client as _redis
                    _resolver = await asyncio.wait_for(
                        get_resolver(redis_client=_redis), timeout=2.0
                    )
                    _resolved = await _resolver.resolve_many(
                        [c.get("name", c) if isinstance(c, dict) else str(c)
                         for c in _raw_companies]
                    )
                    for i, entity in enumerate(_resolved):
                        if entity.match_type != "unknown" and entity.ticker:
                            if isinstance(_raw_companies[i], dict):
                                _raw_companies[i]["ticker"] = entity.ticker
                                _raw_companies[i]["cik"] = entity.cik
                                _raw_companies[i]["resolved_name"] = entity.name
                            else:
                                _raw_companies[i] = {
                                    "name": str(_raw_companies[i]),
                                    "ticker": entity.ticker,
                                    "cik": entity.cik,
                                    "resolved_name": entity.name,
                                }
                    logger.debug(
                        "entities_resolved",
                        trace_id=trace_id,
                        resolved=[e.ticker for e in _resolved if e.ticker],
                    )
                except Exception as _er:
                    # The TYPE, not the message. `asyncio.TimeoutError` has an
                    # empty `str()`, so this line read `error=` on every single
                    # request and the stage-trace showed a flat 2s/4s in
                    # `entity` that nothing in the logs explained. Four seconds
                    # per request were being spent failing invisibly.
                    _resolver_backoff_until[0] = time.time() + _RESOLVER_BACKOFF_S
                    logger.warning(
                        "entity_resolution_skipped", trace_id=trace_id,
                        error_type=type(_er).__name__,
                        backoff_s=_RESOLVER_BACKOFF_S,
                    )

            # Deterministic recovery + AUGMENT: query-understanding (gemini) often
            # returns companies=[] ("Coca Cola FY2021 revenue" → no entity) OR drops
            # a company in a comparison ("Compare Tesla and Ford" → just "Compare
            # Tesla", missing Ford → the compare silently answers one side). Pull
            # capitalized name-sequences + ticker tokens straight from the query and
            # MERGE any resolved tickers gemini missed, so every mention is scoped.
            try:
                from app.core.entity_resolver import get_resolver
                from app.db.redis import redis_client as _redis
                _existing = query_plan.get("entities", {}).get("companies", []) or []
                _existing_tickers = {
                    e.get("ticker") for e in _existing
                    if isinstance(e, dict) and e.get("ticker")
                }
                # Same backoff as the resolution above. This is a SECOND
                # independent 2s timeout inside the same stage, which is why
                # `entity` measured a flat 4007ms rather than 2003ms: two
                # unguarded builds of a resolver that cannot become ready.
                if time.time() < _resolver_backoff_until[0]:
                    raise TimeoutError("resolver in backoff")
                _resolver = await asyncio.wait_for(get_resolver(redis_client=_redis), timeout=2.0)
                _cands = _extract_company_mentions(query)
                _found = []
                for _cand in _cands:
                    # Reject finance acronyms / non-company terms that fuzzy-match
                    # random tickers ("R&D"→DHI, contaminating scope).
                    if _cand.lower().replace("&", "").replace(".", "") in _NOT_COMPANY:
                        continue
                    _ent = await _resolver.resolve(_cand)
                    if not (_ent and _ent.match_type != "unknown" and _ent.ticker):
                        continue
                    # Short ALL-CAPS acronyms that fuzzy-match are almost always wrong
                    # (a stray "EPS"/"FCF" not already in _NOT_COMPANY). But normal
                    # Title-case short NAMES must pass: Ford→F, Nike→NKE, Visa→V, Coke→KO
                    # all resolve fuzzy (name ≠ ticker) and were being dropped, so
                    # comparisons silently lost a company. _NOT_COMPANY + single-char
                    # token drop already guard the acronym case.
                    if (len(_cand) <= 4 and _ent.match_type != "exact_ticker"
                            and _cand.isupper()):
                        continue
                    if _ent.ticker in _existing_tickers:
                        continue  # gemini already has it
                    _found.append({"name": _cand, "ticker": _ent.ticker,
                                   "cik": _ent.cik, "resolved_name": _ent.name})
                if _found:
                    # dedupe new finds by ticker, then append to whatever gemini found
                    _seen: set = set()
                    _uniq = [f for f in _found if not (f["ticker"] in _seen or _seen.add(f["ticker"]))]
                    _merged = list(_existing) + _uniq
                    query_plan.setdefault("entities", {})["companies"] = _merged
                    logger.info("companies_recovered", trace_id=trace_id,
                                tickers=[e.get("ticker") for e in _merged if isinstance(e, dict)],
                                added=[f["ticker"] for f in _uniq])
            except Exception as _er2:
                # Type, not message — the same reason as above. This handler
                # also logged `error=` for every TimeoutError, so the second of
                # the two 2s stalls was as invisible as the first.
                if isinstance(_er2, (asyncio.TimeoutError, TimeoutError)):
                    _resolver_backoff_until[0] = time.time() + _RESOLVER_BACKOFF_S
                logger.debug("company_fallback_skipped", trace_id=trace_id,
                             error_type=type(_er2).__name__)

            # Explicit API scope is a contract: a caller that pins
            # filters["companies"] (grid cells, eval harness) means EXACTLY those
            # companies. Query-text entity recovery must never widen it — a Moat
            # prompt containing the literal token "IP" resolved to International
            # Paper (exact ticker) and leaked its chunks into an AFL-scoped cell
            # via the multi-entity comparison path. Clamp entities to the scope.
            _explicit_scope = {
                str(t).upper() for t in (filters or {}).get("companies") or [] if t
            }
            if _explicit_scope:
                _ents = query_plan.get("entities", {}).get("companies", []) or []
                _kept = [
                    e for e in _ents
                    if isinstance(e, dict) and str(e.get("ticker", "")).upper() in _explicit_scope
                ]
                if len(_kept) != len(_ents):
                    logger.info(
                        "entity_scope_clamped", trace_id=trace_id,
                        dropped=[e.get("ticker") if isinstance(e, dict) else str(e)
                                 for e in _ents if e not in _kept],
                        scope=sorted(_explicit_scope),
                    )
                query_plan.setdefault("entities", {})["companies"] = _kept

            logger.info(
                "query_understood",
                trace_id=trace_id,
                intent=query_plan.get("intent"),
                complexity=query_plan.get("complexity"),
                entities=query_plan.get("entities", {}),
                latency_ms=round(understanding_ms, 1),
            )

            _st.add("entity", (time.perf_counter() - _t_entity) * 1000)

            # Resolved company tickers — used to namespace the semantic cache so
            # a query about one company can't return another company's answer.
            _cache_tickers = [
                c.get("ticker") for c in query_plan.get("entities", {}).get("companies", [])
                if isinstance(c, dict) and c.get("ticker")
            ]

            # ── Stage 2: Semantic Cache Check ───────────────────────────
            # Cache failures (e.g. Redis without RediSearch/vector ops) must
            # never break search — treat any error as a cache miss.
            if self.cache:
                try:
                    cached = await self.cache.get(query, tickers=_cache_tickers)
                except Exception as e:
                    logger.warning("cache_get_skip", trace_id=trace_id, error=str(e))
                    cached = None
                prov = None
                if cached:
                    prov = cached.pop("_provenance", None) if isinstance(cached, dict) else None
                    # A stored verdict of False is the one thing a replay must
                    # ACT on rather than report. The gate already judged this
                    # answer bad; serving it again is repeating a known defect
                    # at cache speed, for the life of the entry. Fall through
                    # and recompute — a refusal here is a miss, not an error.
                    if gate_verdict_failed(prov):
                        logger.warning("cache_refused_failed_gate", trace_id=trace_id,
                                       violations=(prov or {}).get(
                                           "contract_gate", {}).get("violations"))
                        cached = None
                if cached:
                    logger.info("cache_hit", trace_id=trace_id, provenance=bool(prov))
                    yield SearchEvent(type="answer", data=cached, trace_id=trace_id)
                    yield SearchEvent(
                        type="metadata",
                        data=replay_metadata(
                            prov, round((time.perf_counter() - start) * 1000, 1), trace_id),
                        trace_id=trace_id,
                    )
                    return

            # ── Route: Agentic vs Linear Pipeline ───────────────────────
            if self._should_use_agentic(reasoning_depth, query_plan):
                logger.info(
                    "pipeline_mode",
                    trace_id=trace_id,
                    mode="agentic",
                    complexity=query_plan.get("complexity"),
                )
                # Best-effort with a hard floor: buffer the orchestrator's events and
                # only commit them if it produced a NON-EMPTY answer without crashing.
                # On exception or empty answer, fall through to single-pass (which now
                # handles analytical/bull-bear queries reliably) — the agentic path must
                # never leave the user with a blank or 500.
                _agentic_ok = False
                try:
                    from app.core.agents.orchestrator import AgentOrchestrator
                    orchestrator = AgentOrchestrator(
                        llm_router=self.llm_router,
                        retrieval_orchestrator=self.retrieval,
                        reranker=self.reranker,
                        query_understander=self.query_understander,
                        semantic_cache=self.cache,
                    )
                    _buf: list = []
                    async for event in orchestrator.run(
                        query=query, query_plan=query_plan, trace_id=trace_id, stream=stream,
                    ):
                        _buf.append(event)
                        if event.type == "answer":
                            _a = (event.data or {}).get("answer", "") if isinstance(event.data, dict) else ""
                            if isinstance(_a, str) and _a.strip():
                                _agentic_ok = True
                    if _agentic_ok:
                        for event in _buf:
                            yield event
                        return
                    logger.warning("agentic_empty_fallback_singlepass", trace_id=trace_id)
                except Exception as _ag_err:
                    logger.warning("agentic_failed_fallback_singlepass", trace_id=trace_id,
                                   error=str(_ag_err)[:200])
                # fall through to single-pass (do NOT return)

            # ── Stage 3: Retrieval (single-pass or iterative) ───────────
            # CoRAG (arXiv 2501.14342): For MEDIUM/COMPLEX queries, use
            # iterative retrieval — each reasoning step can trigger follow-up
            # retrieval on detected gaps. +15-25% on multi-hop QA.
            # For SIMPLE queries, single-pass (lower latency).
            doc_count = "500,000+"
            complexity = query_plan.get("complexity", "simple")
            intent = query_plan.get("intent", "")
            # Fast mode (Quick Answer) ALWAYS uses single-pass: it carries the
            # scoping + period-aware + structured/XBRL force-include + ratio fixes
            # that the iterative (CoRAG) path lacks. Half the cold-battery failures
            # (Apple FCF, Pfizer R&D, JPM) were MEDIUM queries routed to iterative,
            # which drifts to the wrong company/period. Reserve iterative for
            # explicit deep/agentic depth.
            # Multi-entity comparisons (2+ resolved tickers) must NOT go iterative:
            # the CoRAG path only scopes a SINGLE ticker, so a 2-company compare runs
            # unscoped and drifts onto random filings ("Meta or Google" → Match Group
            # + Sweetgreen). The single-pass branch has search_multi_entity (one
            # scoped pass per company + structured facts) which answers them correctly.
            _n_tickers = len([
                e for e in query_plan.get("entities", {}).get("companies", [])
                if isinstance(e, dict) and e.get("ticker")
            ])
            # Reserve the iterative (CoRAG) path for genuinely COMPLEX multi-step
            # reasoning only. Medium numeric/trend queries ("how has R&D changed",
            # "did operating income grow faster than revenue") were routed here and
            # lost facts: the iterative path has none of the structured force-include /
            # multi-period / multi-metric pinning the single-pass path carries. Send
            # them single-pass where the XBRL facts actually reach the LLM.
            _use_iterative = reasoning_depth != "fast" and _n_tickers <= 1 and (
                intent == "multi_hop_reasoning"
            )

            yield SearchEvent(
                type="status",
                data={
                    "status": "searching",
                    "message": (
                        f"Deep search across {doc_count} documents..."
                        if _use_iterative
                        else f"Searching across {doc_count} documents..."
                    ),
                },
                trace_id=trace_id,
            )

            t1 = time.perf_counter()
            retrieval_results: dict = {}  # populated by single-pass; stays {} for iterative

            if _use_iterative:
                # CoRAG: iterative retrieval with gap detection
                from app.core.retrieval.iterative_rag import IterativeRAG
                # Use same routed LLM for gap detection (cheap: gap prompts are short)
                _gap_client, _ = await self.llm_router.route(query)
                irag = IterativeRAG(
                    llm=_gap_client,
                    retrieval_orchestrator=self.retrieval,
                    reranker=self.reranker,
                    max_steps=2,  # Budget: max 2 follow-up steps in fast-path
                )
                # Scope to the resolved company so iterative retrieval can't
                # drift onto another company's filings (same fix as single-pass).
                _irag_filters = dict(filters or {})
                if len(_cache_tickers) == 1 and not _irag_filters.get("companies"):
                    _irag_filters["companies"] = _cache_tickers
                irag_result = await irag.retrieve(
                    query=query,
                    query_plan=query_plan,
                    filters=_irag_filters,
                )
                top_passages = irag_result.all_passages[:settings.max_context_passages]
                total_cost += irag_result.cost_usd
                retrieval_ms = (time.perf_counter() - t1) * 1000
                _st.add("retrieval", retrieval_ms, path="iterative")
                logger.info(
                    "iterative_retrieval_complete",
                    trace_id=trace_id,
                    steps=irag_result.retrieval_steps,
                    passages=len(top_passages),
                    gaps=irag_result.gaps_found,
                    latency_ms=round(retrieval_ms, 1),
                )
            else:
                # Single-pass retrieval for simple queries (faster)
                # Multi-entity: comparison queries ("Apple vs Microsoft") get
                # one independent retrieval pass per company then merged.
                _companies = query_plan.get("entities", {}).get("companies", [])
                _tickers = [e.get("ticker") for e in _companies if isinstance(e, dict) and e.get("ticker")]
                _channels = list(query_plan.get("retrieval_channels", ["dense", "bm25", "splade"]) or [])
                # Always include the core text channels — query understanding
                # sometimes returns a structured-only plan, which never searches
                # the filing text and yields a false "no documents found".
                # Also force `structured`: the XBRL exact-facts channel must run on
                # every query (it's ticker-scoped + gated, so it self-noops when
                # there's no resolved ticker / no facts). Without forcing it, dense
                # alone answers the wrong fiscal year (AMD FY2023 -> FY2025 chunk).
                for _c in ("dense", "bm25", "splade", "structured", "tree_nav"):
                    if _c not in _channels:
                        _channels.append(_c)

                # Deterministic routing, ahead of retrieval. `query_understanding`
                # adds `edgar` only when its LLM labels the intent calculation /
                # simple_lookup or a keyword regex fires — so a slow, quota-limited
                # or simply wrong model call silently skips the authoritative-source
                # path and the user is told there is no evidence for a figure that
                # is in a filing. This decides from the question's own words.
                _ents = query_plan.get("entities")
                _qc = classify_question(query, _ents if isinstance(_ents, dict) else None)
                _channels = route_channels(_qc["question_class"], _channels, query)
                query_plan["question_class"] = _qc["question_class"]

                # What the question asks for, in structured form, decided here
                # rather than re-derived from whatever came back. A plan built
                # after retrieval is shaped by the evidence: a growth question
                # that finds one period quietly answers as a lookup, and a set
                # question that finds five names quietly answers as a census.
                # Emitting it into the plan makes both visible in telemetry and
                # gives the answer stage the metric basis it needs to keep a
                # margin move in percentage points.
                try:
                    _fin = plan_finance_query(
                        query,
                        entities=_ents if isinstance(_ents, dict) else None,
                    )
                    query_plan["finance_plan"] = _fin.as_dict()
                    # What the answer is OBLIGED to do, decided here rather than
                    # argued for inside a prompt. A prompt is a request; this is
                    # a thing `FinalGate` can check the finished answer against.
                    from app.core.finance.answer_contract import build_contract
                    _contract = build_contract(_fin)
                    query_plan["answer_contract"] = _contract.as_dict()
                except Exception as e:  # noqa: BLE001
                    # Advisory only. A planning failure must not take down a
                    # search that would otherwise answer.
                    logger.warning("finance_plan_failed",
                                   trace_id=trace_id, error_type=type(e).__name__)

                # §4: deterministic LOCAL / SEC / WEB routing, decided from the
                # question's own words before anything is retrieved. The plan is
                # advisory for SEC — `evidence_gate` below makes the real call,
                # because only it can see whether the local row is the right
                # fact — and authoritative for WEB, which has no gate of its own.
                _plan = route_sources(_qc["question_class"], query)
                query_plan["source_plan"] = _plan.telemetry()
                if not _plan.web and "web" in _channels:
                    _channels = [c for c in _channels if c != "web"]
                # Authoritative means both directions. The plan could previously
                # only veto web, never enable it, so a question the plan routed
                # to WEB still ran without the web channel whenever the class had
                # not already added it — which is every class outside
                # NEEDS_WEB_RESEARCH and WEB_AUGMENTED.
                elif _plan.web and "web" not in _channels:
                    _channels.append("web")
                logger.info(
                    "question_classified",
                    trace_id=trace_id,
                    question_class=_qc["question_class"],
                    needs_primary_source=_qc["needs_primary_source"],
                    channels=_channels,
                    # `telemetry()` carries `question_class` too, and passing it
                    # twice raises TypeError inside structlog — which the
                    # pipeline catches as `search_error` and turns into an empty
                    # answer. The routing log took down every search until this
                    # was removed.
                    **{k: v for k, v in _plan.telemetry().items()
                       if k != "question_class"},
                )
                _gate = None
                _t_gate = time.perf_counter()
                if _qc["needs_primary_source"]:
                    # The verified-evidence gate. This runs BEFORE the retrieval
                    # fan-out, on one narrow lookup, because the question "must we
                    # ask the filer?" cannot be answered by RRF after the fact —
                    # by then the expensive call has already happened. Only exact,
                    # fully-identified, verified, fresh, unconflicted local
                    # evidence removes `edgar` from the fan-out.
                    _names = [
                        e.get("name", "")
                        for e in (_companies or [])
                        if isinstance(e, dict) and e.get("name")
                    ]
                    from app.core.retrieval import evidence_gate as _eg

                    _gate = await self._evidence_gate(query, _tickers, _names)
                    _st.add("evidence_gate", (time.perf_counter() - _t_gate) * 1000)
                    # SEC is only invoked when no exact verified local evidence
                    # satisfies the financial query.
                    _channels = _eg.channels_after_gate(_channels, _gate)
                    if _gate is not None:
                        query_plan["gate_telemetry"] = _gate.telemetry()
                        logger.info(
                            "evidence_gate", trace_id=trace_id, **_gate.telemetry()
                        )
                    # §14: the user sees source acquisition happening, not a
                    # silent pause followed by an implementation error.
                    yield SearchEvent(
                        type="status",
                        data={
                            "status": (
                                "answering_from_verified_evidence"
                                if _gate is not None and not _gate.sec_invoked
                                else "resolving_primary_source"
                            ),
                            "message": (
                                "Using verified evidence already on file..."
                                if _gate is not None and not _gate.sec_invoked
                                else "Resolving the filing that reports this..."
                            ),
                            "question_class": _qc["question_class"],
                            **(_gate.telemetry() if _gate else {}),
                        },
                        trace_id=trace_id,
                    )

                if len(_tickers) >= 2:
                    # ANY 2+ ticker query is a comparison → one scoped pass per
                    # company. Don't gate on complexity: "Which grew faster, Meta or
                    # Google?" classifies SIMPLE yet still has two entities that, run
                    # unscoped, drift onto unrelated filings.
                    retrieval_results = await self.retrieval.search_multi_entity(
                        query=query,
                        tickers=_tickers,
                        filters=filters or {},
                        channels=_channels,
                        complexity=complexity,
                        question_class=_qc["question_class"],
                    )
                else:
                    # Scope a single-company query to its resolved ticker so
                    # semantic search can't drift onto another company's filings
                    # (e.g. "Amazon revenue growth" matching Kroger's MD&A).
                    _eff_filters = dict(filters or {})
                    if len(_tickers) == 1 and not _eff_filters.get("companies"):
                        _eff_filters["companies"] = _tickers
                    retrieval_results = await self.retrieval.search(
                        query=query,
                        expanded_terms=query_plan.get("expanded_terms", {}),
                        filters=_eff_filters,
                        channels=_channels,
                        complexity=complexity,
                        question_class=_qc["question_class"],
                    )
                retrieval_ms = (time.perf_counter() - t1) * 1000
                _st.add("retrieval", retrieval_ms, path="single_pass")
                # Per-channel wall time. The fan-out costs its SLOWEST channel,
                # not the sum, so one straggler is invisible in the aggregate
                # while setting the floor for the whole request.
                _st.add_channels(
                    getattr(retrieval_results, "timings", None),
                    failed=getattr(retrieval_results, "failed", None),
                    counts={k: len(v) for k, v in (retrieval_results or {}).items()},
                )

                # What the web leg actually did. Read off the channel rather
                # than inferred from the results: "no web evidence" and "the
                # provider was down" produce the same empty list and are
                # completely different answers to give a user (§15, §25, §28).
                _web_usage = {}
                _web_channel = getattr(self.retrieval, "channels", {}).get("web")
                if _web_channel is not None:
                    _run = getattr(_web_channel, "last_run", None) or {}
                    _usage_obj = _run.get("usage")
                    if _usage_obj is not None:
                        _web_usage = _usage_obj.as_dict()
                        query_plan["web_usage"] = _web_usage
                        logger.info("web_research_usage", trace_id=trace_id,
                                    **_web_usage)
                _tracer.record_stage(_otrace, "retrieval", latency_ms=retrieval_ms,
                                     channels=list(retrieval_results.keys()),
                                     total_retrieved=sum(len(v) for v in retrieval_results.values()))

                # ── Stage 4: RRF Fusion + Reranking (<30ms) ────────────
                # Authority-aware RRF (plan §6.4): SEC/IR > sell-side > news > blogs.
                # 0.15 boost makes primary filings outrank tier-2 news at ties without
                # overpowering strong multi-channel news matches.
                t2 = time.perf_counter()
                fused = authority_aware_rrf(retrieval_results, k=settings.rrf_k, authority_weight=0.15)
                _st.add("merge_dedup", (time.perf_counter() - t2) * 1000, fused=len(fused))
                _t_rr = time.perf_counter()
                if self.reranker and len(fused) > 0:
                    reranked = await self.reranker.rerank(
                        query=query,
                        passages=fused[:settings.rerank_top_k],
                    )
                else:
                    reranked = fused
                top_passages = reranked[:settings.max_context_passages]

                # ── Priority-pinned context assembly ─────────────────────────
                # Build ONE deduped priority list so the force-includes never
                # starve each other. The previous code prepended structured, then
                # prepended tree_nav and re-cut to max_context_passages (=6) — so
                # tree_nav's 6 pins EVICTED the structured XBRL facts entirely
                # (MSFT FY2023 revenue: structured returned the fact, yet 0 made it
                # to the LLM → "not found"). Order of authority:
                #   1. structured XBRL exact facts  (the period-matched ground truth)
                #   2. tree_nav navigated sections  (narrative grounding)
                #   3. reranked prose               (fills remaining budget)
                # The budget GROWS to always hold every pin (small max_context_passages
                # must never drop an exact fact); prose then fills to the cap.
                # EDGAR facts are the same kind of evidence as the structured
                # XBRL rows — exact, period-matched, filer-sourced — so they
                # share the top pin tier rather than competing with prose.
                _sf = ((retrieval_results.get("structured") or [])
                       + (retrieval_results.get("edgar") or []))
                _tn = retrieval_results.get("tree_nav") or []

                def _cid(p):
                    return getattr(p, "chunk_id", None)

                # Interleave exact facts by company (round-robin) so a multi-entity
                # comparison keeps EACH company's facts in the pin. They arrive
                # concatenated (all META, then all GOOGL); a flat cap kept only the
                # first company → GOOGL revenue dropped, context was META-only and the
                # model couldn't compare. Round-robin guarantees every company appears.
                if _n_tickers >= 2 and _sf:
                    def _ent(p):
                        md = getattr(p, "metadata", None) or {}
                        return md.get("entity_ticker") or getattr(p, "ticker", "") or ""
                    from collections import OrderedDict as _OD
                    _by_ent = _OD()
                    for _p in _sf:
                        _by_ent.setdefault(_ent(_p), []).append(_p)
                    _lists = list(_by_ent.values())
                    _ordered_sf, _k = [], 0
                    while any(_k < len(_l) for _l in _lists):
                        for _l in _lists:
                            if _k < len(_l):
                                _ordered_sf.append(_l[_k])
                        _k += 1
                    _sf = _ordered_sf
                # Cap exact-fact pins by entity count: a 3-4 way comparison needs ~2
                # facts per company, so a fixed 6 would drop a company. Scale with
                # tickers (×4 → ~4 facts/company). ALSO scale with the requested
                # fiscal-year SPAN: a broad "FY2020-2025 revenue" query needs one pin
                # per year, and a fixed 6 dropped the middle years (the recall gap).
                # Use the span (max-min+1), not the count of years named in text — a
                # range only names its two endpoints. +2 headroom for a prior/derived
                # component row. Capped at 18 to avoid context flooding.
                _yrs = sorted({int(y) for y in re.findall(r"(?:19|20)\d{2}", query)})
                _span = (_yrs[-1] - _yrs[0] + 1) if len(_yrs) >= 2 else len(_yrs)
                _struct_cap = min(18, max(6, 4 * max(_n_tickers, 1),
                                          (_span + 2) * max(_n_tickers, 1)))
                # P0.1: for qualitative-analytical queries (risks/moat/strategy with
                # no numeric ask), exact XBRL rows are noise, not evidence — they
                # crowded out the 10-K risk-factor prose. Don't pin them.
                _struct_pin = [] if suppresses_xbrl(query) else _sf[:_struct_cap]
                _pin_ids = {_cid(p) for p in _struct_pin}
                _tn_pin = [p for p in _tn if _cid(p) not in _pin_ids][:3]
                _pin_ids |= {_cid(p) for p in _tn_pin}
                _pinned = _struct_pin + _tn_pin
                _prose = [p for p in top_passages if _cid(p) not in _pin_ids]

                if _pinned:
                    # Effective budget = whichever is larger: the configured cap, or
                    # enough room for every pin + 3 prose passages. Capped at 18 to
                    # avoid context flooding (which regressed accuracy + timed out).
                    _eff = min(18, max(settings.max_context_passages, len(_pinned) + 3))
                    top_passages = (_pinned + _prose)[:_eff]

                # R2 — period-aware retrieval: when the query names a fiscal year,
                # demote prose chunks from a MUCH later filing period. Dense returns
                # the latest filing (e.g. Q1 FY2026) for "Apple FY2023 revenue" by
                # cosine, and the model then answers "latest data is FY2026 / not
                # found". Keep XBRL/ratio facts (period-tagged) untouched; just push
                # off-period prose to the back so the asked-year content wins.
                _qy_all = re.findall(r"(?:19|20)\d{2}", query)
                if _qy_all:
                    # Use the LATEST year mentioned as the off-period cutoff. A multi-
                    # year query ("R&D over FY2022, FY2023, FY2024") names several; keying
                    # off the FIRST (2022) wrongly demoted the FY2024 fact as "future" →
                    # the latest year went missing from trend answers.
                    _ask = max(int(y) for y in _qy_all)
                    def _off_period(p) -> bool:
                        fd = getattr(p, "filing_date", "") or ""
                        if getattr(p, "metadata", None) and isinstance(p.metadata, dict) \
                                and p.metadata.get("source_channel") in ("structured", "tree_nav"):
                            return False  # exact facts / navigated — keep
                        m = re.match(r"(\d{4})", str(fd))
                        return bool(m) and int(m.group(1)) > _ask + 1
                    _on = [p for p in top_passages if not _off_period(p)]
                    _off = [p for p in top_passages if _off_period(p)]
                    if _on:  # only reorder if on-period content exists
                        # Keep ALL passages — this is a reorder (permutation), not a
                        # trim. Re-cutting to max_context_passages (6) here undid the
                        # pin's budget expansion and dropped a comparison company's 2nd
                        # component (AMD FY2023 gross profit, the 8th pinned fact) →
                        # "gross margin not provided". Preserve the expanded length.
                        top_passages = (_on + _off)[:len(top_passages)]
                rerank_ms = (time.perf_counter() - t2) * 1000
                _st.add("rerank", (time.perf_counter() - _t_rr) * 1000)
                logger.info(
                    "retrieval_complete",
                    trace_id=trace_id,
                    channels=list(retrieval_results.keys()),
                    total_retrieved=sum(len(v) for v in retrieval_results.values()),
                    after_fusion=len(fused),
                    after_rerank=len(top_passages),
                    retrieval_ms=round(retrieval_ms, 1),
                    rerank_ms=round(rerank_ms, 1),
                )

            # ── Stage 4b: No-data early exit ────────────────────────────
            # If retrieval found nothing, return a clear "not indexed" answer
            # instead of sending empty context to the LLM (which causes hallucination
            # or crashes on calculation queries).
            if not top_passages and settings.on_demand_ingest_enabled and reasoning_depth != "fast":
                # On-demand: the company asked about isn't in the corpus yet.
                # Fetch its recent EDGAR filings live, index them, and retry
                # retrieval once. Fully guarded + time-boxed: any failure falls
                # through to the existing "not indexed" message, so this can never
                # make a currently-failing query worse.
                # SKIPPED in explicit "fast" mode: live EDGAR fetch+ingest costs
                # up to ~90s (timeout 75s + retries), which blows fast-mode latency
                # and causes request timeouts. Fast = fast (return not-found now);
                # agentic/auto keep on-demand for uncovered companies.
                _od_tickers = [
                    e.get("ticker") for e in query_plan.get("entities", {}).get("companies", [])
                    if isinstance(e, dict) and e.get("ticker")
                ]
                if _od_tickers:
                    try:
                        from app.ingestion.on_demand import get_on_demand_ingestor
                        _odi = get_on_demand_ingestor()
                        _od_ft = [t.strip() for t in settings.on_demand_ingest_filing_types.split(",") if t.strip()]
                        for _tk in _od_tickers[:3]:
                            yield SearchEvent(
                                type="status",
                                data={"status": "searching", "message": f"Indexing {_tk} SEC filings…"},
                                trace_id=trace_id,
                            )
                            await asyncio.wait_for(
                                _odi.ensure_indexed(_tk, _od_ft, settings.on_demand_ingest_max_filings),
                                timeout=settings.on_demand_ingest_timeout_s,
                            )
                        # Retry retrieval now the filings are indexed. Freshly
                        # written chunks aren't searchable instantly (ES refresh /
                        # Qdrant index lag), so poll the TICKER-SCOPED query a few
                        # times. We never drop the company scope: an unscoped pass
                        # would surface another company's filings and the LLM would
                        # answer the wrong company (e.g. oil&gas text labelled as
                        # "Rocket Lab"). If the scope still finds nothing, return
                        # the not-found message — the chunks are indexed and the
                        # next ask resolves instantly.
                        # Force the text channels: we just ingested filing text.
                        _od_channels = ["dense", "bm25", "splade"]
                        _od_scoped = dict(filters or {})
                        _od_scoped["companies"] = _od_tickers

                        for _attempt in range(max(1, settings.on_demand_retry_attempts)):
                            await asyncio.sleep(settings.on_demand_index_settle_s)
                            _rr = await self.retrieval.search(
                                query=query,
                                expanded_terms=query_plan.get("expanded_terms", {}),
                                filters=_od_scoped,
                                channels=_od_channels,
                                complexity=complexity,
                            )
                            _fused2 = authority_aware_rrf(_rr, k=settings.rrf_k, authority_weight=0.15)
                            if self.reranker and len(_fused2) > 0:
                                top_passages = (await self.reranker.rerank(query=query, passages=_fused2[:settings.rerank_top_k]))[:settings.max_context_passages]
                            else:
                                top_passages = _fused2[:settings.max_context_passages]
                            if top_passages:
                                break
                        logger.info(
                            "on_demand_ingest_retry",
                            trace_id=trace_id, tickers=_od_tickers, found=len(top_passages),
                        )
                    except asyncio.TimeoutError:
                        logger.warning("on_demand_ingest_timeout", trace_id=trace_id, tickers=_od_tickers)
                    except Exception as _od_err:
                        logger.warning("on_demand_ingest_failed", trace_id=trace_id, error=str(_od_err))

            # ── Stage 4b: No-data early exit ────────────────────────────
            if not top_passages:
                # Extract company names from query plan for a helpful message
                companies = [
                    e.get("name", e.get("ticker", ""))
                    for e in query_plan.get("entities", {}).get("companies", [])
                ]
                company_hint = f" for {', '.join(companies)}" if companies else ""
                # "Not indexed" is not "does not exist". The live EDGAR channel
                # queries SEC at request time, so reaching here means the primary
                # source was consulted and did not yield the fact either —
                # telling the user to ingest a filing describes our plumbing and
                # misreports why they got nothing.
                _edgar_ran = "edgar" in (self.retrieval.channels if self.retrieval else {})
                if _edgar_ran:
                    _reason = (
                        f"No supporting evidence found{company_hint}. "
                        "The corpus holds nothing on this, and the SEC filings we could "
                        "resolve for it do not report the figure as asked — check the "
                        "company, the fiscal period, and whether the metric is disclosed "
                        "at that level of detail."
                    )
                    _state = "UNSUPPORTED"
                else:
                    _reason = (
                        f"No supporting evidence found{company_hint}, and the primary-source "
                        "channel is not available on this deployment, so SEC filings could "
                        "not be consulted directly."
                    )
                    _state = "SOURCE_UNAVAILABLE"
                logger.info(
                    "no_evidence_exit",
                    trace_id=trace_id, state=_state, companies=companies,
                )
                yield SearchEvent(
                    type="sources",
                    data={"sources": []},
                    trace_id=trace_id,
                )
                # An early return is still a publication. The contract is bound
                # far upstream, so there is nothing to stop the gate running
                # here — and this is the exit its `must_abstain` clause is
                # actually about. A refusal that carries no verdict is
                # indistinguishable from one nothing checked.
                _exit_gate = _gate_check(
                    locals().get("_contract"),
                    answer=_reason,
                    citations=[],
                    scope_status=query_plan.get("scope_status", ""),
                    trace_id=trace_id,
                )
                yield SearchEvent(
                    type="answer",
                    data={
                        "answer": _reason,
                        "citations": [],
                        "confidence": "NONE",
                        "answer_state": _state,
                        "follow_up_queries": [],
                        "structured_data": [],
                        "contract_gate": _exit_gate,
                    },
                    trace_id=trace_id,
                )
                return

            # ── Stage 5: Yield Sources Early (Progressive Rendering) ───
            source_data = [
                {
                    "id": f"src_{i+1}",
                    "chunk_id": p.chunk_id,
                    "title": p.document_title,
                    "section": p.section,
                    "text": p.text[:2000],  # Source passage (was 500 — too short for evidence display / recall scoring)
                    "ticker": p.ticker,
                    "date": p.filing_date,
                    "document_type": p.document_type,
                    "source_quality": p.source_quality,
                    "score": round(p.rrf_score, 4),
                    "channels": p.source_channels,
                    # A source card is clickable, and it used to carry no URL at
                    # all — so the frontend rebuilt one from the ticker and
                    # landed the user on a company listing instead of on the
                    # filing. The accession is known here; it travels with the
                    # card.
                    # One entry point for every source class: a SEC passage gets
                    # its accession and exact filing URL, a web passage gets its
                    # canonical URL, domain, publication and retrieval times, and
                    # a local prose chunk gets neither rather than an invented
                    # one. Previously only the SEC branch existed, so a web
                    # source would have reached the UI with no URL at all and the
                    # card would have been unclickable.
                    **citation_provenance.source_payload(p.metadata, ticker=p.ticker),
                }
                for i, p in enumerate(top_passages)
            ]
            yield SearchEvent(type="status", data={"status": "reranking", "message": "Reranking results..."}, trace_id=trace_id)
            # Channels that raised, as opposed to channels that simply matched
            # nothing. The orchestrator keeps them apart; everything downstream
            # used to see both as an empty list.
            _channel_failures = dict(getattr(retrieval_results, "failed", {}) or {})
            # What retrieval actually did, measured rather than described. The
            # progress view used to narrate a fixed five-channel sequence naming
            # Qdrant, Elasticsearch, Neo4j and Cohere on every query, including
            # on deployments where those channels are not configured at all. It
            # can now only report the channels named here.
            yield SearchEvent(
                type="retrieval",
                data={
                    "channels_used": sorted(k for k, v in (retrieval_results or {}).items() if v),
                    # Dark means "ran and found nothing". A channel that raised
                    # is reported under channels_failed instead — collapsing the
                    # two would tell the user the corpus was searched when the
                    # channel never answered.
                    "channels_dark": sorted(
                        k for k, v in (retrieval_results or {}).items()
                        if not v and k not in _channel_failures
                    ),
                    "channels_failed": _channel_failures,
                    "degraded": bool(_channel_failures),
                    "candidates": sum(len(v) for v in (retrieval_results or {}).values()),
                    "passages_used": len(top_passages),
                    "retrieval_ms": round(retrieval_ms, 1),
                    "rerank_ms": round(rerank_ms, 1),
                },
                trace_id=trace_id,
            )
            yield SearchEvent(type="sources", data={"sources": source_data}, trace_id=trace_id)

            _t_ctx = time.perf_counter()
            # ── Stage 5b: Deterministic Ratio Pre-Pass ─────────────────
            # For math/valuation queries: compute ratios deterministically
            # from TimescaleDB BEFORE sending to LLM. This injects verified
            # numbers into the prompt so the LLM never needs to compute them.
            # Reduces financial hallucination rate to near-zero for ratio queries.
            ratio_context_block = ""
            if self.ratio_engine:
                try:
                    tickers = [
                        e.get("ticker") for e in query_plan.get("entities", {}).get("companies", [])
                        if e.get("ticker")
                    ]
                    if tickers:
                        # Parse the fiscal year straight from the query (understanding
                        # often misses dates, same as companies) → else FY2025.
                        _ym = re.search(r"((?:19|20)\d{2})", query)
                        period = f"FY{_ym.group(1)}" if _ym else "FY2025"
                        date_entities = query_plan.get("entities", {}).get("dates", [])
                        if not _ym and date_entities:
                            resolved = date_entities[0].get("resolved", "")
                            if resolved:
                                period = resolved
                        # EVERY resolved company, not tickers[0]. This stage used to
                        # compute for the first entity only, so "compare X, Y and Z"
                        # injected one company's ratios and nothing for the rest —
                        # and because a company with no data contributed no text,
                        # the prompt could not tell "no data for Y" apart from "Y was
                        # never asked about". compute_many returns one output per
                        # ticker and names the empty ones explicitly.
                        ratio_output = await self.ratio_engine.compute_many_from_query(
                            tickers=tickers,
                            query=query,
                            period=period,
                        )
                        ratio_context_block = ratio_output.context_block
                        if ratio_context_block:
                            logger.info(
                                "ratio_engine_injected",
                                trace_id=trace_id,
                                tickers=ratio_output.tickers,
                                period=period,
                                missing=ratio_output.missing,
                                ratios_computed=sum(
                                    len(o.ratios) for o in ratio_output.outputs
                                ),
                            )
                except Exception as _re:
                    logger.warning("ratio_engine_failed", trace_id=trace_id, error=str(_re))

            # ── Stage 5c: Deterministic Calculator Pre-Pass ────────────
            # For explicit math queries (YoY growth, margins, CAGR, etc.):
            # detect the calculation type, extract operands from retrieved passages,
            # compute the answer deterministically, and inject it into the prompt.
            # LLMs hallucinate arithmetic — this guarantees correct math at $0 cost.
            calculator_block = ""
            try:
                from app.core.finance import calc_guard
                from app.core.financial_calculator import detect_calculation_type, execute_calculation, parse_financial_number
                calc_type = detect_calculation_type(query)
                if calc_type:
                    # Extract numbers from top passages (first 5 passages, ≤2000 chars each)
                    import re as _re_calc
                    _NUM_PAT = _re_calc.compile(r"[\$€£]?[\d,]+(?:\.\d+)?(?:\s*(?:billion|million|trillion|thousand|B|M|T|K)\b)?(?:\s*%)?", _re_calc.IGNORECASE)
                    candidate_numbers: list[float] = []
                    for p in top_passages[:5]:
                        for m in _NUM_PAT.finditer(p.text[:2000]):
                            v = parse_financial_number(m.group(0))
                            if v is not None and abs(v) > 0:
                                candidate_numbers.append(v)

                    # Attempt calculation with first two distinct candidates
                    # The operands are two arbitrary regex hits from prose. They
                    # carry no metric, no period and no company, so nothing here
                    # can tell revenue from a page number — and the block below
                    # tells the model the result is verified and not to
                    # recompute it. The live benchmark produced exactly the
                    # failure that invites:
                    #
                    #   yoy_growth(current=2026.0, prior_year=10.0) = 20160.0
                    #   "NVIDIA's revenue grew 20,160% year over year"
                    #
                    # 2026 was the FISCAL YEAR, scraped as a revenue figure.
                    # `plausible_operand_pair` refuses the pairs that cannot be
                    # a real year-over-year comparison; when it refuses, no
                    # calculation is injected and the model works from the
                    # passages, which is the honest fallback.
                    uniq = [
                        n for n in dict.fromkeys(candidate_numbers)
                        if not calc_guard.looks_like_a_year(n)
                    ][:4]
                    _calc_ok = len(uniq) >= 2 and calc_guard.plausible_operand_pair(
                        uniq[0], uniq[1], calc_type)
                    if not _calc_ok:
                        # Say so. A silent refusal is the same invisibility that
                        # let a 2s timeout and a 20,160% growth rate both hide
                        # in plain sight: without this line, "the guard is
                        # working" and "the pre-pass never ran" look identical.
                        logger.info(
                            "calculator_refused", trace_id=trace_id,
                            calc_type=calc_type, candidates=len(uniq),
                            operands=uniq[:2],
                        )
                    if _calc_ok:
                        calc_result = execute_calculation(calc_type, {
                            "old": uniq[1], "new": uniq[0],           # percentage_change / yoy_growth
                            "current": uniq[0], "prior_year": uniq[1], # yoy_growth alt params
                            "prior_quarter": uniq[1],
                            "beginning": uniq[1], "ending": uniq[0], "years": 1,
                            "revenue": uniq[0], "cogs": uniq[1],
                            "operating_income": uniq[1], "net_income": uniq[1],
                            "ebitda": uniq[1],
                        }.copy())
                        if calc_result.get("result") is not None:
                            calculator_block = (
                                f"## Deterministic Calculation Result\n"
                                f"Calculation type: {calc_result['calc_type']}\n"
                                f"Formula: {calc_result['formula']}\n"
                                f"Result: {calc_result['result']}\n"
                                f"Description: {calc_result.get('description', '')}\n"
                                # Not "verified". The operands are regex hits
                                # from prose with no metric, period or company
                                # attached, and telling the model otherwise is
                                # how a scraped fiscal year became a reported
                                # 20,160% growth rate.
                                f"(Arithmetic only. The operands were read from the "
                                f"passages above and are NOT period- or metric-verified. "
                                f"If they are not the same line item in two periods, "
                                f"ignore this block and answer from the sources.)\n"
                            )
                            logger.info(
                                "calculator_injected",
                                trace_id=trace_id,
                                calc_type=calc_type,
                                result=calc_result["result"],
                            )
            except Exception as _calc_err:
                logger.warning("calculator_pre_pass_failed", trace_id=trace_id, error=str(_calc_err))

            _st.add("context", (time.perf_counter() - _t_ctx) * 1000)

            # ── Stage 6: LLM Reasoning (200ms–2s) ──────────────────────
            t3 = time.perf_counter()
            yield SearchEvent(type="status", data={"status": "reasoning", "message": "Generating cited answer..."}, trace_id=trace_id)

            # Route to optimal model + build ordered fallback list
            client, routing_decision = await self.llm_router.route(query)
            clients_ordered = self.llm_router.select_models_ordered(routing_decision.complexity)
            # Ensure primary client is first (route() may differ from select_models_ordered index 0)
            if client not in clients_ordered:
                clients_ordered.insert(0, client)

            # Build messages — inject prior conversation context if present
            # Buffer of Thoughts (BoT, NeurIPS 2024): inject relevant financial
            # reasoning template to guide structured analysis (+51% on complex tasks)
            reasoning_system = build_reasoning_system_prompt(
                query=query,
                intent=query_plan.get("intent", ""),
                complexity=complexity,
            )
            system_msg = LLMMessage(role="system", content=reasoning_system)
            # The contract's obligations go to the model as instructions, and
            # the same obligations are checked against the finished answer by
            # `FinalGate` below. Telling without checking is a wish; checking
            # without telling is a trap.
            user_content = build_user_message(
                query, top_passages,
                contract=query_plan.get("answer_contract"),
            )
            # TEMPORAL HONESTY (RESEARCH_ASSISTANT_ROADMAP §0) — the corpus is SEC
            # filings only; we have NO live market data. If the query wants something
            # real-time (current price, today's move, intraday), say so instead of
            # answering from a stale filing. Cite the latest filing date we DO have.
            if query_plan.get("needs_live_data"):
                _dates = [getattr(p, "filing_date", "") for p in top_passages if getattr(p, "filing_date", "")]
                _latest = max(_dates) if _dates else "the latest filing"
                user_content = (
                    "## DATA-COVERAGE NOTICE\n"
                    "This system answers ONLY from SEC filings (no live market data, "
                    "stock price, or intraday feed). The user asked for real-time/current "
                    f"data. State plainly that live market data is not available; the most "
                    f"recent filed data is from {_latest}. Do NOT present any filing figure "
                    "as a current price or today's value. Offer the latest *reported* figure "
                    "only if relevant, clearly labeled with its filing date.\n\n"
                ) + user_content
            # Prepend deterministic data (ratios + calculator) before sources
            # so the LLM sees verified numbers first and never needs to recompute
            if ratio_context_block:
                user_content = ratio_context_block + "\n\n" + user_content
            if calculator_block:
                user_content = calculator_block + "\n\n" + user_content
            if conversation_context:
                user_content = (
                    f"## Conversation Context (prior turns)\n{conversation_context}\n\n"
                    + user_content
                )

            # Memory augmentation — inject semantically-similar past queries
            try:
                from app.core.memory_context import augment_context_with_memory
                memory_ctx = await augment_context_with_memory(query, max_memory_results=3)
                if memory_ctx:
                    user_content = memory_ctx + "\n\n" + user_content
            except Exception as _mem_err:
                logger.debug("memory_augmentation_skipped", trace_id=trace_id, error=str(_mem_err))

            user_msg = LLMMessage(role="user", content=user_content)

            # ── CONTEXT-DUMP INSTRUMENTATION (diagnose "fact retrieved but unused") ──
            # Logs EXACTLY what reaches the LLM: per-passage channel/ticker/period +
            # whether the exact XBRL fact line survived into the final prompt. Lets us
            # see in one trace if the period-matched fact is in context (→ prompt/model
            # issue) or got dropped (→ assembly bug). Gated on a setting; default on.
            try:
                if getattr(settings, "context_dump_enabled", True):
                    _dump = []
                    for _i, _p in enumerate(top_passages[:16]):
                        _md = getattr(_p, "metadata", {}) or {}
                        _ch = _md.get("source_channel") or ("structured" if str(getattr(_p, "chunk_id", "")).startswith("fin_") else "?")
                        _per = _md.get("period") or getattr(_p, "filing_date", "") or ""
                        _dump.append(f"{_i}:{_ch}:{getattr(_p,'ticker','')}:{_per}:{(getattr(_p,'text','') or '')[:70].replace(chr(10),' ')}")
                    logger.info(
                        "llm_context_dump",
                        trace_id=trace_id,
                        query=query[:80],
                        n_passages=len(top_passages),
                        has_exact_fact=("[EXACT FILING FIGURE]" in user_content),
                        has_ratio_block=bool(ratio_context_block),
                        ctx_chars=len(user_content),
                        passages=_dump,
                    )
            except Exception as _dmp_err:
                logger.debug("context_dump_failed", trace_id=trace_id, error=str(_dmp_err))

            # Decide whether to use self-consistency (MATH/COMPLEX, non-streaming)
            use_self_consistency = (
                routing_decision.complexity.value in _SELF_CONSISTENCY_COMPLEXITIES
                and not stream  # Only for non-streaming requests (avoids 3x latency for WS)
            )

            # Complex/iterative answers carry a long <thinking> block + a multi-part
            # JSON answer (bull/bear case, multi-hop). At 4096 the response truncated
            # mid-JSON → parse failed → EMPTY answer returned. Give complex generations
            # room to finish the JSON.
            _max_toks = 8192 if (_use_iterative or complexity in ("complex", "math")) else 4096
            gen_config = LLMConfig(temperature=0.1, max_tokens=_max_toks)
            full_response = ""
            _last_llm_err = None

            if stream:
                # Stream tokens — try each client in fallback order.
                # Credit/rate-limit errors are raised on the first iteration
                # (before any tokens), so fallback is always clean.
                #
                # The model emits a JSON envelope ({"answer":"...", ...}); we must
                # never stream that raw JSON to the client. Extract the prose value
                # of the "answer" field incrementally and stream only its deltas, so
                # the client sees clean markdown as it arrives.
                for _client in clients_ordered:
                    _sent_answer = ""
                    try:
                        async for token in _client.generate_stream(
                            messages=[system_msg, user_msg], config=gen_config
                        ):
                            full_response += token
                            _clean = _extract_partial_answer(full_response)
                            if len(_clean) > len(_sent_answer):
                                _delta = _clean[len(_sent_answer):]
                                _sent_answer = _clean
                                yield SearchEvent(type="token", data={"token": _delta}, trace_id=trace_id)
                        routing_decision = RoutingDecision(
                            complexity=routing_decision.complexity,
                            primary_model=_client.model_id,
                            provider=_client.provider.value,
                            estimated_cost=routing_decision.estimated_cost,
                            reasoning=routing_decision.reasoning,
                        )
                        break  # success
                    except Exception as _e:
                        if full_response:
                            # Already streamed tokens — can't cleanly fall back
                            logger.warning("stream_failed_mid_response", model=_client.model_id, error=str(_e))
                            break
                        logger.warning("llm_stream_failed_trying_next", model=_client.model_id, error=str(_e))
                        _last_llm_err = _e
                        continue

                if not full_response and _last_llm_err:
                    raise RuntimeError(f"All LLM clients failed: {_last_llm_err}")

            elif use_self_consistency:
                yield SearchEvent(
                    type="status",
                    data={"status": "reasoning", "message": "Running self-consistency check (3x)..."},
                    trace_id=trace_id,
                )
                for _client in clients_ordered:
                    try:
                        full_response = await self._self_consistent_generate(
                            _client, system_msg, user_msg, n_runs=_SELF_CONSISTENCY_RUNS
                        )
                        if not full_response:
                            response = await _client.generate(messages=[system_msg, user_msg], config=gen_config)
                            full_response = response.content
                            total_cost += response.cost_usd
                        routing_decision = RoutingDecision(
                            complexity=routing_decision.complexity,
                            primary_model=_client.model_id,
                            provider=_client.provider.value,
                            estimated_cost=routing_decision.estimated_cost,
                            reasoning=routing_decision.reasoning,
                        )
                        break
                    except Exception as _e:
                        logger.warning("llm_generate_failed_trying_next", model=_client.model_id, error=str(_e))
                        _last_llm_err = _e
                        continue

                if not full_response and _last_llm_err:
                    raise RuntimeError(f"All LLM clients failed: {_last_llm_err}")

            else:
                # Non-streaming single-pass with fallback
                for _client in clients_ordered:
                    try:
                        response = await _client.generate(messages=[system_msg, user_msg], config=gen_config)
                        full_response = response.content
                        total_cost += response.cost_usd
                        routing_decision = RoutingDecision(
                            complexity=routing_decision.complexity,
                            primary_model=_client.model_id,
                            provider=_client.provider.value,
                            estimated_cost=routing_decision.estimated_cost,
                            reasoning=routing_decision.reasoning,
                        )
                        break
                    except Exception as _e:
                        logger.warning("llm_generate_failed_trying_next", model=_client.model_id, error=str(_e))
                        _last_llm_err = _e
                        continue

                if not full_response and _last_llm_err:
                    raise RuntimeError(f"All LLM clients failed: {_last_llm_err}")

            reasoning_ms = (time.perf_counter() - t3) * 1000
            _tracer.record_generation(_otrace, model=routing_decision.primary_model,
                                      cost_usd=routing_decision.estimated_cost,
                                      stage="generation")

            # ── AI Wording Check (fast-path) ────────────────────────────
            _, ai_phrases = strip_ai_wording(full_response)
            if ai_phrases:
                logger.warning(
                    "ai_wording_detected_fastpath",
                    phrases=ai_phrases[:5],
                    query=query[:60],
                    trace_id=trace_id,
                )

            _st.add("generation", (time.perf_counter() - t3) * 1000)

            # ── Stage 7: Deterministic Verification (0ms, $0) ───────────
            # Layer 1: Numeric + Temporal verifiers (existing)
            # Layer 2: Logic verifier — checks financial reasoning chains
            # Layer 3: Cross-passage contradiction detector — NEW
            # Based on: CRITIC (2023), step-level PRM validation concepts
            t4 = time.perf_counter()

            from app.core.reasoning.contradiction_detector import (
                detect_contradictions, format_for_response as _fmt_contradictions,
            )

            numeric_mismatches = verify_answer_numerics(full_response, top_passages)
            temporal_mismatches = verify_temporal_consistency(full_response, top_passages)
            cross_passage_contradictions = detect_contradictions(top_passages)

            # NEW: Logic consistency check (no LLM, O(n) rules-based)
            from app.core.reasoning.logic_verifier import verify_logic
            logic_result = verify_logic(full_response, extracted_facts=[])
            # Note: extracted_facts available in agentic mode; in fast-path, pass []
            # Logic verifier will still catch narrative/number conflicts from answer text

            if numeric_mismatches or temporal_mismatches or not logic_result.passed:
                logger.warning(
                    "deterministic_verification_warnings",
                    trace_id=trace_id,
                    numeric=len(numeric_mismatches),
                    temporal=len(temporal_mismatches),
                    logic_errors=logic_result.error_count,
                    logic_warnings=logic_result.warning_count,
                    numeric_report=format_mismatch_report(numeric_mismatches),
                    temporal_report=format_temporal_report(temporal_mismatches),
                    logic_summary=logic_result.summary,
                )

            # ── Stage 7b: NLI Citation Validation + LLM Correction ─────
            # Step 1: NLI sentence-level entailment (numeric pre-check → T5 → Claude).
            #         Replaces the fragile keyword_recall < 0.3 hallucination proxy.
            # Step 2: LLM CitationValidator for claim correction (existing Layer 2).
            validated_answer = full_response
            validation_result = None
            nli_recall = None

            # Fast / Quick-Answer path skips the two model-based validators below
            # (NLI entailment + LLM CitationValidator). They add 5-30s per query and
            # the CitationValidator was hammering an exhausted Groq tier (429 TPD) —
            # pure latency with no payoff on exact-XBRL-fact answers. The deterministic
            # guards (numeric grounding, temporal, contradiction, grounded-or-refuse
            # prompt) stay and cover fast-path hallucinations. Deep modes keep both.
            # Tie deep validation to whether we actually ran the agentic/iterative
            # path — NOT the raw depth string. A "auto" comparison resolves to
            # single-pass yet "auto" != "fast" used to flip deep-validate on, running
            # the NLI + CitationValidator (dead Groq 429) → 110s timeout. Only the
            # genuinely iterative path pays for the heavyweight validators.
            _deep_validate = _use_iterative

            # NLI entailment check: split answer into sentences, score each
            if _deep_validate:
                try:
                    import re as _re
                    _sentences = [s.strip() for s in _re.split(r'(?<=[.!?])\s+(?=[A-Z])', full_response) if s.strip()]
                    _passage_text = " ".join(p.text for p in top_passages[:10])
                    if _sentences and _passage_text:
                        _nli_pairs = [(_passage_text, s) for s in _sentences]
                        _nli_results = await _nli_judge.batch_score(_nli_pairs)
                        _entailed = sum(r.entails for r in _nli_results)
                        nli_recall = _entailed / max(len(_nli_results), 1)
                        logger.info(
                            "nli_citation_check",
                            trace_id=trace_id,
                            sentences=len(_sentences),
                            entailed=_entailed,
                            recall=round(nli_recall, 3),
                            methods=list({r.method for r in _nli_results}),
                        )
                except Exception as _nli_err:
                    logger.warning("nli_check_failed", trace_id=trace_id, error=str(_nli_err))

                if self.validator:
                    try:
                        validation_result = await self.validator.verify(
                            answer=full_response,
                            passages=top_passages,
                        )
                        # If validator found issues, use corrected answer
                        if validation_result and validation_result.get("corrected_answer"):
                            validated_answer = validation_result["corrected_answer"]
                    except Exception as e:
                        logger.warning("validation_failed", trace_id=trace_id, error=str(e))

            # Attach verification results to validation output
            if validation_result is None:
                validation_result = {}
            validation_result["numeric_mismatches"] = len(numeric_mismatches)
            validation_result["temporal_mismatches"] = len(temporal_mismatches)
            validation_result["cross_passage_contradictions"] = len(cross_passage_contradictions)
            if nli_recall is not None:
                validation_result["nli_citation_recall"] = round(nli_recall, 4)

            # ── Stage 7c: Patronus Lynx finance hallucination guardrail ────
            # Plan §3.4: finance-tuned grader. Uses HF inference API when
            # HF_TOKEN is set, else LLM-as-Lynx via the wired sonnet client.
            try:
                from app.core.reasoning.lynx_guardrail import LynxGuardrail
                _lynx_client = getattr(self, "_lynx_client", None) or (
                    self.llm_router.get_client("claude_sonnet")
                    if hasattr(self.llm_router, "get_client") else None
                )
                if _lynx_client is not None and top_passages:
                    grader = LynxGuardrail(llm_client=_lynx_client)
                    _passage_text2 = " ".join(p.text for p in top_passages[:10])[:8000]
                    lynx_score = await grader.score(
                        context=_passage_text2,
                        answer=full_response,
                    )
                    validation_result["lynx_score"] = round(lynx_score.score, 3)
                    validation_result["lynx_method"] = lynx_score.method
                    validation_result["lynx_grounded"] = lynx_score.is_grounded
                    if lynx_score.reasoning:
                        validation_result["lynx_reasoning"] = lynx_score.reasoning[:300]
                    logger.info(
                        "lynx_check",
                        trace_id=trace_id,
                        score=round(lynx_score.score, 3),
                        method=lynx_score.method,
                        grounded=lynx_score.is_grounded,
                    )
            except Exception as _lynx_err:
                logger.warning("lynx_check_failed", trace_id=trace_id, error=str(_lynx_err))

            validation_ms = (time.perf_counter() - t4) * 1000
            _st.add("verification", validation_ms)
            _t_prov = time.perf_counter()

            # ── Stage 8: Parse JSON answer → extract citations, follow-ups ─
            import json as _json
            parsed_answer = validated_answer
            citations_out: list = []
            follow_up_queries: list = []
            caveats: list = []
            contradictions_out: list = []
            confidence_out = "MEDIUM"
            structured_data_out: list = []
            # Hoisted: referenced both in the JSON path and the grounding/confidence
            # block below, which runs even when JSON parsing falls to the except.
            _negative_phrases = [
                "i am unable", "i cannot", "i am sorry", "not available",
                "not found", "no information", "no data", "cannot find",
                "do not have", "none of the provided", "not in the",
            ]
            try:
                # LLM returns JSON per FINANCIAL_ANALYST_SYSTEM prompt.
                # Strip markdown code fences if LLM wrapped the output
                _raw = validated_answer.strip()
                # Strip the reasoning preamble models emit before the JSON output
                _raw = _strip_thinking(_raw)
                if _raw.startswith("```"):
                    _raw = re.sub(r"^```(?:json)?\s*", "", _raw)
                    _raw = re.sub(r"\s*```$", "", _raw.rstrip())
                # Find JSON object if there is leading text before the brace
                if not _raw.startswith("{"):
                    _m = re.search(r"(\{[\s\S]*\})", _raw)
                    if _m:
                        _raw = _m.group(1)
                answer_json = _json.loads(_raw)
                parsed_answer = answer_json.get("answer", validated_answer)
                # Strip fences if LLM nested them inside the answer field value
                if isinstance(parsed_answer, str) and parsed_answer.strip().startswith("```"):
                    parsed_answer = re.sub(r"^```(?:json)?\s*", "", parsed_answer.strip())
                    parsed_answer = re.sub(r"\s*```$", "", parsed_answer.rstrip())
                citations_out = answer_json.get("citations", [])
                follow_up_queries = answer_json.get("follow_up_queries", [])
                caveats = answer_json.get("caveats", [])
                contradictions_out = answer_json.get("contradictions", [])
                # Merge deterministic cross-passage contradictions (Stage 7 Layer 3)
                if cross_passage_contradictions:
                    contradictions_out = contradictions_out + _fmt_contradictions(cross_passage_contradictions)
                confidence_out = answer_json.get("confidence", "MEDIUM")
                structured_data_out = answer_json.get("structured_data", [])
                # Calibrate confidence: override HIGH if answer admits it cannot answer
                if confidence_out == "HIGH" and isinstance(parsed_answer, str):
                    _ans_lower = parsed_answer.lower()
                    if any(p in _ans_lower for p in _negative_phrases):
                        confidence_out = "LOW"
            except (_json.JSONDecodeError, TypeError):
                # Malformed JSON envelope (common with weak fallback models when the
                # primary is rate-limited). Salvage the "answer" field with the
                # streaming extractor so the raw {"answer":...} never leaks to the UI.
                _salv = _extract_partial_answer(validated_answer)
                if _salv and _salv.strip():
                    parsed_answer = _salv
                confidence_out = _extract_confidence(validated_answer)
                if cross_passage_contradictions:
                    contradictions_out = _fmt_contradictions(cross_passage_contradictions)

            # Final guard: never return a raw JSON envelope to the client, whatever
            # path we took above.
            if isinstance(parsed_answer, str):
                _pa = parsed_answer.lstrip()
                if _pa.startswith("{") and '"answer"' in _pa[:200]:
                    _salv2 = _extract_partial_answer(parsed_answer)
                    if _salv2 and _salv2.strip():
                        parsed_answer = _salv2
                # Reasoning can also appear inside the parsed "answer" value
                # itself, which the pre-parse strip above never sees. Assign
                # unconditionally: a response that was *entirely* reasoning
                # (generation truncated before the envelope) leaves nothing, and
                # empty is correct — it falls through to the refusal path below
                # rather than leaking chain-of-thought to the user.
                if "<thinking" in parsed_answer.lower() or "<think>" in parsed_answer.lower():
                    parsed_answer = _strip_thinking(parsed_answer)

            # ── Numeric grounding validator (Phase B) ───────────────────
            # Deterministic anti-hallucination: every $ / % / large figure stated in
            # the answer must trace to a retrieved passage, a structured XBRL fact,
            # or a computed ratio. Unsupported figures → lower confidence + caveat
            # (not hard refuse — that over-refuses). The cardinal virtue for finance:
            # don't state numbers we can't ground.
            if isinstance(parsed_answer, str) and parsed_answer.strip():
                try:
                    _ungrounded = _numeric_grounding_check(
                        parsed_answer, top_passages, ratio_context_block)
                    _pa_l0 = parsed_answer.lower()
                    _anchored = ("[EXACT FILING FIGURE]" in user_content
                                 and not any(p in _pa_l0 for p in _negative_phrases))
                    if _ungrounded:
                        # If the answer is anchored on exact XBRL facts, an "ungrounded"
                        # flag is almost always a derived figure the checker can't trace
                        # (3-way diff, multi-step calc) — NOT a fabrication. Keep MEDIUM +
                        # caveat rather than dropping a correct grounded answer to LOW.
                        # LOW only for genuinely un-anchored floating numbers.
                        confidence_out = "MEDIUM" if _anchored else "LOW"
                        _cav = (f"Unverified figures (not found in sources): "
                                f"{', '.join(_ungrounded[:5])}. Treat with caution.")
                        if isinstance(caveats, list):
                            caveats = caveats + [_cav]
                        logger.info("numeric_grounding_violation", trace_id=trace_id,
                                    ungrounded=_ungrounded[:8], n=len(_ungrounded), anchored=_anchored)
                    else:
                        # Floor confidence at HIGH when the answer is grounded on an
                        # exact SEC XBRL fact and nothing is unsupported and it isn't
                        # a refusal. "$211,915M from the 10-K XBRL" is the highest
                        # authority that exists — labelling it MEDIUM/LOW reads as a
                        # broken tool. The model defaults single-source to MEDIUM.
                        _pa_l = parsed_answer.lower()
                        # Floor LOW/MEDIUM → HIGH: if the validator found nothing
                        # unsupported, an exact XBRL fact is in context, and the answer
                        # isn't a refusal, the answer IS well-grounded. Models self-rate
                        # derived/comparison answers LOW out of caution — that reads as a
                        # broken tool on "$99,584M FCF computed from the 10-K".
                        if ("[EXACT FILING FIGURE]" in user_content
                                and confidence_out in ("LOW", "MEDIUM", "")
                                and not any(p in _pa_l for p in _negative_phrases)):
                            confidence_out = "HIGH"
                except Exception as _gerr:
                    logger.debug("numeric_grounding_check_failed", error=str(_gerr)[:120])

            # ── Temporal grounding gate ─────────────────────────────────
            # verify_temporal_consistency ran at Stage 7a but was log-only: an answer
            # quoting an FY21 passage for an FY23 question still shipped as HIGH with a
            # clean caveat list. Wrong-period figures are the documented failure mode
            # (AAPL FY23 revenue answered $313.7B from an older filing), and the numeric
            # grounding check above cannot catch it — the figure IS in a passage, just
            # the wrong one. Cap confidence and tell the user which periods disagree.
            if temporal_mismatches:
                if confidence_out == "HIGH":
                    confidence_out = "MEDIUM"
                _tm = temporal_mismatches[0]
                _cav_t = (
                    f"Period mismatch: the answer references "
                    f"{_format_periods(_tm.answer_temporal_refs)} but [Source {_tm.source_id}] "
                    f"covers {_format_periods(_tm.source_temporal_refs)}. Verify the fiscal period."
                )
                if isinstance(caveats, list):
                    caveats = caveats + [_cav_t]
                logger.info(
                    "temporal_grounding_violation", trace_id=trace_id,
                    n=len(temporal_mismatches), confidence=confidence_out,
                )

            # ── Stage 8b: ALiiCE Proposition Attribution ────────────────
            # Upgrade chunk-level citations → sentence-level attributed propositions.
            # Runs only for MEDIUM/COMPLEX queries to avoid latency on simple lookups.
            # Falls back silently if unavailable; never blocks the answer.
            alce_props = []
            alce_recall = None
            if complexity in ("medium", "complex") and parsed_answer:
                try:
                    from app.core.reasoning.proposition_extractor import PropositionExtractor
                    _fast_client = None
                    try:
                        _fast_client = self.llm_router.get_fast_client()
                    except Exception:
                        pass
                    _prop_extractor = PropositionExtractor(llm_client=_fast_client)
                    alce_props = await asyncio.wait_for(
                        _prop_extractor.extract_and_attribute(parsed_answer, top_passages),
                        timeout=3.0,  # never delay answer by more than 3s
                    )
                    alce_recall = PropositionExtractor.citation_recall(alce_props)
                    alce_citations = PropositionExtractor.format_citations(alce_props)
                    # Merge ALiiCE sentence citations with LLM-generated chunk citations
                    if alce_citations:
                        citations_out = alce_citations + citations_out
                    if alce_recall is not None and validation_result is not None:
                        validation_result["alce_citation_recall"] = round(alce_recall, 4)
                    logger.info(
                        "alce_attribution_complete",
                        trace_id=trace_id,
                        propositions=len(alce_props),
                        recall=round(alce_recall, 3) if alce_recall is not None else None,
                    )
                except asyncio.TimeoutError:
                    logger.warning("alce_attribution_timeout", trace_id=trace_id)
                except Exception as _alce_err:
                    logger.warning("alce_attribution_failed", trace_id=trace_id, error=str(_alce_err))

            _st.add("provenance", (time.perf_counter() - _t_prov) * 1000)
            _t_ser = time.perf_counter()

            # ── Stage 8c: Yield Complete Answer ─────────────────────────
            # Enrich citations to the frontend shape (document_title/chunk_id/
            # ticker) by joining to the retrieved passages, so the source panel
            # has real content to display.
            citations_out = _normalize_citations(citations_out, top_passages)
            # Resilience: model drops follow_up_queries under rate-limit → "no next
            # question" in the UI. Fall back to deterministic suggestions.
            if not follow_up_queries:
                follow_up_queries = _default_follow_ups(query, query_plan, top_passages)
            chart_specs_out = _auto_chart_specs(structured_data_out)
            # The serialisation span closes HERE, before the yield. Past this
            # point the generator is suspended until the consumer asks for the
            # next event, and that wait is the client's, not the pipeline's.
            _st.add("serialization", (time.perf_counter() - _t_ser) * 1000)

            # ── Final gate: did the answer honour its contract? ─────────
            # ABOVE the yield, deliberately. It used to run 55 lines below it,
            # which made every verdict a post-mortem — the consumer had already
            # rendered the answer by the time the gate had an opinion about it.
            # `parsed_answer` and `citations_out` are both final here, so the
            # check has everything it needs and the verdict can travel with the
            # answer it grades.
            _gate_result = _gate_check(
                locals().get("_contract"),
                answer=parsed_answer,
                citations=citations_out,
                scope_status=query_plan.get("scope_status", ""),
                trace_id=trace_id,
            )

            _t_yield = time.perf_counter()
            yield SearchEvent(
                type="answer",
                data={
                    "answer": parsed_answer,
                    # The verdict rides on the answer, not only on the later
                    # metadata event: a client that renders on `answer` would
                    # otherwise always render ungraded.
                    "contract_gate": _gate_result,
                    "citations": citations_out,
                    "follow_up_queries": follow_up_queries,
                    "caveats": caveats,
                    "contradictions": contradictions_out,
                    "model_used": routing_decision.primary_model,
                    "confidence": confidence_out,
                    # The answer's evidence state, on every answer rather than
                    # only on the no-evidence exit. It was absent here, so the
                    # client saw `answer_state: None` on a successful run and
                    # had to infer "answered" from the field being missing —
                    # indistinguishable from an older server that never sent it.
                    "answer_state": audit_answer_state(citations_out),
                    "validation": validation_result,
                    "structured_data": structured_data_out,
                    "chart_specs": chart_specs_out,
                },
                trace_id=trace_id,
            )
            # How long the consumer took to come back for more. A slow
            # WebSocket drain shows up here now instead of inflating a stage
            # named for CPU work.
            _st.add("answer_yield", (time.perf_counter() - _t_yield) * 1000)
            _t_ser = time.perf_counter()

            # Emit structured table event for frontend DataPanel rendering
            if structured_data_out:
                yield SearchEvent(
                    type="structured_table",
                    data={"rows": structured_data_out},
                    trace_id=trace_id,
                )

            # Save turn to conversation history
            await self._save_conversation_turn(conversation_id, query, parsed_answer)

            # ── Stage 9: Cache Result ───────────────────────────────────
            # Namespace by ticker (no cross-company hits) and cache the CLEAN
            # parsed answer + citations so a cache hit returns the same rich
            # payload as a fresh answer (not the raw JSON envelope).
            # R1 determinism fix: NEVER cache failures/refusals/empty answers. The
            # cache used to store every answer, so an intermittent failure (a channel
            # timeout → empty retrieval → "not found") got cached and then served on
            # ~25% of identical re-queries (the 3s "fail" = a cache hit of the poison).
            # The gate ran above, before the answer was published. Its verdict
            # is `_gate_result` and it gates the cache write below.
            _ans_l = (parsed_answer or "").lower()
            _is_refusal = (not parsed_answer or not source_data
                           or str(confidence_out).upper() in ("NONE", "")
                           or any(p in _ans_l for p in (
                               "not contain", "not found", "not available", "do not contain",
                               "does not contain", "no information", "cannot provide",
                               "sources do not", "not provided", "cannot be calculated",
                               "cannot determine", "insufficient", "cannot be answered",
                               "cannot answer", "contain no", "no revenue data", "no data for",
                               "do not include", "does not include", "not present in")))
            # Timed separately because it is a network write that ONE BRANCH
            # SKIPS: a refusal is never cached, so this cost is present or
            # absent depending on the answer, and folding it into a CPU stage
            # made that stage bimodal rather than slow.
            _st.add("serialization", (time.perf_counter() - _t_ser) * 1000)
            _t_cache = time.perf_counter()
            # An answer the gate never ran on does not enter the cache. The
            # gate is skipped when `_contract` was never bound — finance
            # planning raised and its `except` only logged — and such an answer
            # was previously stored anyway, carrying `contract_gate: null`, to
            # be replayed for the life of the entry.
            #
            # Enforced at the WRITE rather than the read. It satisfies "no
            # answer may escape through a path that bypasses the final gate" at
            # the source, leaves the read path's pass/fail logic alone, and
            # does not require refusing the legacy entries that carry no
            # verdict simply because they predate it — those age out on TTL.
            #
            # `passed`, not merely `is not None`: a FAILED verdict is also "not
            # None", so the answer the gate had just rejected was written and
            # then refused by `gate_verdict_failed` on every subsequent hit —
            # the system recording a defect in order to keep re-detecting it.
            # The read-path refusal stays, because entries written before this
            # are still out there. Two defences, not one moved.
            _gated = _gate_result is not None and bool(_gate_result.get("passed"))
            if self.cache and not _is_refusal and not _gated:
                logger.warning("cache_skip_ungated", trace_id=trace_id,
                               verdict=(_gate_result or {}).get("passed"))
            if self.cache and not _is_refusal and _gated:
                try:
                    await self.cache.set(query, {
                        "answer": parsed_answer,
                        "citations": citations_out,
                        "follow_up_queries": follow_up_queries,
                        "structured_data": structured_data_out,
                        "confidence": confidence_out,
                        "answer_state": audit_answer_state(citations_out),
                        "sources": source_data,
                        # Provenance travels with the answer. Without it a cache hit
                        # reports channels [] and model "unknown", so the cheapest
                        # replies are the ones nobody can audit.
                        # The gate verdict travels with the answer too. Without
                        # it a replay reports no verdict at all, and "passed
                        # silently" and "never checked" become the same value to
                        # anyone reading the metadata.
                        "_provenance": {
                            **cache_provenance_of(
                                retrieval_results, routing_decision,
                                len(top_passages), trace_id),
                            "contract_gate": _gate_result,
                        },
                    }, tickers=_cache_tickers)
                except Exception as e:
                    logger.warning("cache_set_skip", trace_id=trace_id, error=str(e))
            elif _is_refusal:
                logger.info("cache_skip_refusal", trace_id=trace_id)
            # Recorded on BOTH branches, so a skipped write reads as ~0ms
            # rather than as an absent stage. "We did not write" and "we did
            # not measure the write" must not look the same.
            _st.add("cache_write", (time.perf_counter() - _t_cache) * 1000,
                    wrote=bool(self.cache and not _is_refusal))
            _t_ser = time.perf_counter()

            # Store in memory palace (fire-and-forget, non-blocking)
            try:
                from app.core.memory_context import store_search_result
                _answer_text = parsed_answer if isinstance(parsed_answer, str) else str(parsed_answer)[:1000]
                _source_ids = [str(s.get("id", s.get("source_id", ""))) for s in source_data[:5]]
                asyncio.create_task(store_search_result(
                    query=query,
                    answer=_answer_text[:2000],
                    sources=_source_ids,
                    category=query_plan.get("intent", "general"),
                ))
            except Exception as _store_err:
                logger.debug("memory_store_skipped", trace_id=trace_id, error=str(_store_err))

            # ── Stage 10: Yield Metadata ────────────────────────────────
            _st.add("serialization", (time.perf_counter() - _t_ser) * 1000)
            total_ms = (time.perf_counter() - start) * 1000
            # One line per request naming where the time went, and naming what
            # is still unaccounted for rather than implying the measured stages
            # are the whole story.
            _st.log(question_class=query_plan.get("question_class", ""))
            _stage_report = _st.report()
            yield SearchEvent(
                type="metadata",
                data={
                    "trace_id": trace_id,
                    "latency_ms": round(total_ms, 1),
                    "stage_trace": _stage_report,
                    "answer_contract": query_plan.get("answer_contract"),
                    "contract_gate": _gate_result,
                    "understanding_ms": round(understanding_ms, 1),
                    "retrieval_ms": round(retrieval_ms, 1),
                    "rerank_ms": round(rerank_ms, 1),
                    "reasoning_ms": round(reasoning_ms, 1),
                    "validation_ms": round(validation_ms, 1),
                    "model_used": routing_decision.primary_model,
                    "complexity": routing_decision.complexity.value,
                    "estimated_cost_usd": round(routing_decision.estimated_cost, 4),
                    # Honest: report only channels that actually returned data.
                    # A dispatched-but-empty channel (ES down → [], structured gated
                    # → []) used to appear here and falsely imply 5 live channels.
                    "retrieval_channels": [k for k, v in (retrieval_results or {}).items() if v],
                    "channels_dark": [k for k, v in (retrieval_results or {}).items()
                                      if not v and k not in (getattr(retrieval_results, "failed", {}) or {})],
                    # A channel that errored, named as such. Reporting it as
                    # merely dark is how a provider outage came to look like an
                    # honest empty result.
                    "channels_failed": dict(getattr(retrieval_results, "failed", {}) or {}),
                    "degraded": bool(getattr(retrieval_results, "failed", {})),
                    # Which evidence system the question was routed to, decided
                    # deterministically before retrieval rather than by the LLM.
                    "question_class": query_plan.get("question_class", "GENERAL"),
                    # Which of LOCAL / SEC / WEB the router picked, and why.
                    # `sources_skipped` matters as much as `sources_selected`:
                    # "we did not search the web" and "we searched and found
                    # nothing" are different answers and used to look identical.
                    **{k: v for k, v in
                       (query_plan.get("source_plan") or {}).items()
                       if k != "question_class"},
                    # What the web leg actually spent and produced, including
                    # URLs the SSRF guard refused and pages whose text was
                    # shaped like an instruction.
                    **(query_plan.get("web_usage") or {}),
                    # Why the filer was or was not asked. Visible without
                    # exposing anything sensitive — states and counts only.
                    **(_gt if isinstance(_gt := query_plan.get("gate_telemetry"), dict) else {}),
                    # What was actually asked of sec.gov, measured at the socket.
                    # `sec_invoked` above is the gate's intent; these are the
                    # requests that really left, which is what makes the
                    # "verified hit costs no fact request" invariant observable
                    # in production and not only in a test.
                    **_sec_log.telemetry(),
                    # The filing the answer rests on, promoted out of the
                    # citation payload so an operator can see provenance in
                    # telemetry without parsing the answer.
                    **_answer_provenance(citations_out),
                    "passages_used": len(top_passages),
                    "cache_hit": False,
                    "cache_provenance": "live",
                    "self_consistency": use_self_consistency,
                    "numeric_mismatches": len(numeric_mismatches),
                    "temporal_mismatches": len(temporal_mismatches),
                    "deterministic_ratios_injected": bool(ratio_context_block),
                },
                trace_id=trace_id,
            )

            # Finish Langfuse trace (fire-and-forget, never blocks response)
            async def _finish_trace():
                _tracer.finish_trace(
                    _otrace,
                    confidence=confidence_out,
                    nli_recall=nli_recall,
                    alce_recall=validation_result.get("alce_citation_recall") if validation_result else None,
                    numeric_mismatches=len(numeric_mismatches),
                    model_used=routing_decision.primary_model,
                    total_cost_usd=total_cost,
                    output=parsed_answer[:300] if isinstance(parsed_answer, str) else "",
                )
            asyncio.create_task(_finish_trace())

            logger.info(
                "search_complete",
                trace_id=trace_id,
                total_ms=round(total_ms, 1),
                model=routing_decision.primary_model,
                complexity=routing_decision.complexity.value,
            )

            # ── Feedback Recording (fire-and-forget) ─────────────────────
            if self.feedback:
                try:
                    _conf_map = {"HIGH": 0.9, "MEDIUM": 0.6, "LOW": 0.3, "NONE": 0.0}
                    # Derived from the citation verdicts rather than from the
                    # model's own confidence word, which is not evidence.
                    _audit_answer_state = audit_answer_state(citations_out)
                    conf_value = _conf_map.get(confidence_out, 0.6)
                    asyncio.create_task(self.feedback.record(FeedbackRecord(
                        trace_id=trace_id,
                        query=query,
                        complexity=routing_decision.complexity.value,
                        model_used=routing_decision.primary_model,
                        confidence=conf_value,
                        latency_ms=round(total_ms, 1),
                        cache_hit=False,
                        numeric_mismatches=len(numeric_mismatches),
                        temporal_mismatches=len(temporal_mismatches),
                        cost_usd=round(routing_decision.estimated_cost, 6),
                    )))
                except Exception:
                    pass  # Feedback failure must never affect the user

            # ── Audit Log (fire-and-forget, zero latency impact) ─────────
            if self.audit_logger:
                try:
                    from compliance.audit_log import (
                        AuditEvent, QueryContext, RetrievalContext, RetrievedChunk,
                        ModelContext, ResponseContext, PerformanceContext, CostContext,
                        CitationRecord,
                    )
                    _conf_map = {"HIGH": 0.9, "MEDIUM": 0.6, "LOW": 0.3}
                    from compliance.audit_log import UserContext as _UserContext
                    _audit_event = AuditEvent(
                        trace_id=trace_id,
                        session_id=conversation_id or "",
                        request_id=trace_id,
                        user=_UserContext(id=user_id or ""),
                        query=QueryContext(raw=query),
                        retrieval=RetrievalContext(
                            top_k=len(top_passages),
                            retrieved_chunks=[
                                RetrievedChunk(
                                    doc_id=p.document_id,
                                    chunk_id=p.chunk_id,
                                    score=p.score,
                                    source_uri=p.metadata.get("source_url", "") if p.metadata else "",
                                )
                                for p in top_passages[:20]
                            ],
                            # Measured, not assumed. These three fields used to
                            # be left at defaults that named Qdrant, Voyage and
                            # Cohere on every record regardless of deployment.
                            channels_used=sorted(
                                k for k, v in (retrieval_results or {}).items() if v
                            ),
                            channels_failed=dict(
                                getattr(retrieval_results, "failed", {}) or {}
                            ),
                            degraded=bool(getattr(retrieval_results, "failed", {})),
                        ),
                        model=ModelContext(
                            provider=routing_decision.primary_model.split("-")[0],
                            model_id=routing_decision.primary_model,
                            temperature=0.0,
                        ),
                        response=ResponseContext(
                            raw=full_response,
                            confidence_score=_conf_map.get(confidence_out, 0.6),
                            confidence_label=str(confidence_out),
                            # The gate's verdict for the answer as a whole. An
                            # abstention and a confident answer used to be
                            # indistinguishable in the record.
                            answer_state=_audit_answer_state,
                            # Citations were never persisted at all: this list
                            # was left empty on every record, so the one thing
                            # an audit most needs to reconstruct — which source
                            # was cited for what, and whether it checked out —
                            # was the one thing not written down.
                            citations=[
                                CitationRecord(
                                    chunk_id=str(c.get("chunk_id", "")),
                                    char_span=[
                                        int(c.get("char_offset_start") or 0),
                                        int(c.get("char_offset_end") or 0),
                                    ],
                                    source_uri=str(c.get("url", "")),
                                    confidence=1.0 if c.get("is_verified") else 0.0,
                                    verification_status=str(
                                        c.get("verification_status", "not_verifiable")
                                    ),
                                    verification_reasons=list(
                                        c.get("verification_reasons", []) or []
                                    ),
                                    citation_number=int(c.get("citation_number", 0) or 0),
                                )
                                for c in (citations_out or [])[:50]
                            ],
                        ),
                        performance=PerformanceContext(
                            ttft_ms=int(reasoning_ms),
                            e2e_ms=int(total_ms),
                        ),
                        cost=CostContext(
                            total_usd=routing_decision.estimated_cost,
                        ),
                    )
                    asyncio.create_task(self.audit_logger.log(_audit_event))
                except Exception:
                    pass  # Audit failure must never affect the user

        except Exception as e:
            logger.error("search_error", trace_id=trace_id, error=str(e), exc_info=True)
            yield SearchEvent(
                type="error",
                data={"message": "An error occurred during search. Please try again.",
                      "trace_id": trace_id},
                trace_id=trace_id,
            )


def _auto_chart_specs(structured_data: list[dict]) -> list[dict]:
    """
    Auto-generate chart_specs from structured data rows (fast-path pipeline).

    Logic:
      - Line chart: same metric + same entity, 3+ distinct periods
      - Bar chart: same metric, 2+ distinct entities, 1 period

    Returns a list of chart_spec dicts (empty list if no chartable data).
    """
    if not structured_data:
        return []

    from collections import defaultdict

    # Group rows by (entity, metric) → list of (period, value, row_id)
    entity_metric: dict = defaultdict(list)
    for row in structured_data:
        entity = row.get("entity", "")
        metric = row.get("metric", "")
        period = row.get("period", "")
        value = row.get("value")
        row_id = row.get("row_id", "")
        if entity and metric and period and value is not None:
            entity_metric[(entity, metric)].append((period, value, row_id))

    # Group rows by (metric, period) → list of (entity, value, row_id)
    metric_period: dict = defaultdict(list)
    for row in structured_data:
        entity = row.get("entity", "")
        metric = row.get("metric", "")
        period = row.get("period", "")
        value = row.get("value")
        row_id = row.get("row_id", "")
        if entity and metric and period and value is not None:
            metric_period[(metric, period)].append((entity, value, row_id))

    charts = []

    # Line charts: same entity+metric across 3+ periods
    for (entity, metric), rows in entity_metric.items():
        if len(rows) >= 3:
            unit = next(
                (r.get("unit", "") for r in structured_data
                 if r.get("entity") == entity and r.get("metric") == metric),
                "",
            )
            chart_id = f"{entity.lower().replace(' ', '_')}_{metric.lower().replace(' ', '_')}_trend"
            charts.append({
                "chart_id": chart_id,
                "chart_type": "line",
                "title": f"{entity} — {metric} Trend",
                "x_axis": "period",
                "y_axis": "value",
                "y_label": unit,
                "series": [{"entity": entity, "metric": metric}],
                "data_refs": [r[2] for r in rows],
            })

    # Bar charts: same metric across 2+ entities in the same period
    for (metric, period), rows in metric_period.items():
        if len(rows) >= 2:
            # Only create if we haven't already made a line chart covering same metric
            existing_ids = {c["chart_id"] for c in charts}
            chart_id = f"{metric.lower().replace(' ', '_')}_{period.lower().replace(' ', '_')}_comparison"
            if chart_id not in existing_ids:
                unit = next(
                    (r.get("unit", "") for r in structured_data
                     if r.get("metric") == metric),
                    "",
                )
                charts.append({
                    "chart_id": chart_id,
                    "chart_type": "bar",
                    "title": f"{metric} Comparison — {period}",
                    "x_axis": "entity",
                    "y_axis": "value",
                    "y_label": unit,
                    "series": [{"entity": e, "metric": metric} for e, _, _ in rows],
                    "data_refs": [r[2] for r in rows],
                })

    return charts[:4]  # Cap at 4 charts per answer


def _format_periods(refs: list[tuple[int, int | None]]) -> str:
    """Render TemporalMismatch (year, quarter) refs as 'Q3 2025, 2024'."""
    return ", ".join(f"Q{q} {y}" if q else str(y) for y, q in refs[:3]) or "an unstated period"


def _extract_confidence(answer: str) -> str:
    """Extract confidence level from the generated answer."""
    answer_lower = answer.lower()
    if '"confidence": "high"' in answer_lower or '"confidence":"high"' in answer_lower:
        return "HIGH"
    elif '"confidence": "low"' in answer_lower or '"confidence":"low"' in answer_lower:
        return "LOW"
    return "MEDIUM"


_CAP_SEQ_RE = re.compile(r"\b([A-Z][a-zA-Z.&'\-]+(?:\s+[A-Z][a-zA-Z.&'\-]+){0,3})\b")
_CAP_STOP = {"what", "how", "is", "the", "does", "did", "do", "are", "was", "were",
             "which", "based", "considering", "assume", "answer", "question", "note",
             "fy", "q1", "q2", "q3", "q4", "us", "usd", "gaap", "non", "sec", "you",
             "for", "of", "in", "and", "a", "an", "as", "give", "calculate", "we",
             # comparison/filler words gemini bundles into a company name
             "compare", "compared", "comparing", "versus", "vs", "than", "or",
             "between", "higher", "lower", "faster", "grew", "vs.", "did"}


# Finance acronyms / terms that look like capitalized tokens but are NOT companies;
# they fuzzy-match random tickers and poison company scope ("R&D"→DHI).
_NOT_COMPANY: frozenset[str] = frozenset({
    "rd", "ceo", "cfo", "coo", "cto", "eps", "roe", "roa", "roic", "roce",
    "ebitda", "ebit", "gaap", "sec", "ipo", "ma", "sga", "capex", "fcf", "yoy",
    "qoq", "pe", "ps", "pb", "ev", "dcf", "wacc", "irr", "npv", "usd", "gdp",
    "ttm", "ytd", "ltm", "cagr", "dso", "dpo", "dio", "nda", "etf", "ai", "it",
    "usa", "us", "uk", "eu", "fy", "q1", "q2", "q3", "q4", "id",
})


def _extract_company_mentions(query: str) -> list[str]:
    """Pull candidate company mentions from raw query text (capitalized name
    sequences + bare ticker tokens), stripping sentence-start/filler caps. Each is
    fed to the entity resolver. Deterministic fallback for when query-understanding
    returns companies=[]."""
    cands: list[str] = []
    for m in _CAP_SEQ_RE.findall(query or ""):
        toks = [t for t in m.split() if not re.match(r"^(FY\d*|Q[1-4]|H[12]|\d+)$", t)]
        while toks and toks[0].lower() in _CAP_STOP:
            toks = toks[1:]
        while toks and toks[-1].lower() in _CAP_STOP:
            toks = toks[:-1]
        if toks:
            cands.append(" ".join(toks))
    for m in re.findall(r"\b([A-Z]{1,5})\b", query or ""):
        if m.lower() not in _CAP_STOP and len(m) >= 2:
            cands.append(m)
    seen: set = set()
    out: list[str] = []
    for c in cands:
        k = c.lower()
        if k not in seen:
            seen.add(k)
            out.append(c)
    return out[:6]


_GFIG_RE = re.compile(r"\$?\s?(\d[\d,]*\.?\d*)\s*(billion|million|trillion|%|b|m|t)?", re.I)


def _grounding_numbers(text: str) -> set[float]:
    """Normalized numeric values mentioned in text (scale-aware), for grounding."""
    out: set[float] = set()
    for m in _GFIG_RE.finditer(text or ""):
        try:
            v = float(m.group(1).replace(",", ""))
        except ValueError:
            continue
        suf = (m.group(2) or "").lower()
        mult = {"billion": 1e9, "b": 1e9, "million": 1e6, "m": 1e6,
                "trillion": 1e12, "t": 1e12}.get(suf, 1.0)
        out.add(v * mult)
        out.add(v)  # also the bare value (handles unit-scaled phrasing)
    return out


def _numeric_grounding_check(answer: str, passages: list, ratio_block: str) -> list[str]:
    """Return answer figures NOT found in any source/fact/computed ratio (within 1%).
    Years and small integers (counts) are ignored — only material $/% figures."""
    src = " ".join((getattr(p, "text", "") or "") for p in (passages or [])) + " " + (ratio_block or "")
    src_nums = _grounding_numbers(src)
    if not src_nums:
        return []
    # Pairwise differences/sums of grounded figures are themselves grounded: the
    # system prompt REQUIRES a YoY/QoQ delta alongside every absolute ("$124.3B
    # (+11.8% YoY)"), and the delta amount ($13,645M) is just a−b of two real
    # source figures. Flagging those as "ungrounded" dropped every correct exact-
    # fact answer to LOW confidence. Build the set of derivable values so honest
    # arithmetic on grounded numbers is accepted.
    _sl = [s for s in src_nums if s and s > 100]
    _derived: set[float] = set()
    for _a in _sl:
        for _b in _sl:
            if _a >= _b:
                _derived.add(round(_a - _b, 2))
                _derived.add(round(_a + _b, 2))
    ungrounded: list[str] = []
    for m in re.finditer(r"(\$?\s?\d[\d,]*\.?\d*\s*(?:billion|million|trillion|%|B|M|T)?)", answer or ""):
        token = m.group(1).strip()
        # Percentages are derived (growth rates, margins, payout ratios) — never a
        # hallucinated absolute. Skip them: this check guards fabricated $ figures.
        if "%" in token:
            continue
        nums = _grounding_numbers(token)
        if not nums:
            continue
        val = max(nums)
        # skip years (1900-2099) and tiny integers (counts, list markers)
        if 1900 <= val <= 2099 or (val < 100 and "." not in token):
            continue
        grounded = any(
            (abs(val - s) / s <= 0.01) for s in src_nums if s
        ) or any((abs(v - s) / s <= 0.01) for v in nums for s in src_nums if s)
        # also accept differences/sums of two grounded figures (computed deltas)
        if not grounded:
            grounded = any((d and abs(val - d) / max(abs(d), 1) <= 0.01) for d in _derived)
        if not grounded:
            ungrounded.append(token)
    # dedupe, keep order
    seen: set = set()
    return [t for t in ungrounded if not (t in seen or seen.add(t))]


def _default_follow_ups(query: str, query_plan: dict, passages: list) -> list[str]:
    """Deterministic follow-up suggestions for when the model (degraded under
    rate-limit) drops follow_up_queries, so the UI always offers a next question."""
    name = ""
    try:
        for e in (query_plan or {}).get("entities", {}).get("companies", []) or []:
            if isinstance(e, dict) and (e.get("ticker") or e.get("name")):
                name = e.get("ticker") or e.get("name")
                break
    except Exception:
        pass
    if not name:
        for p in passages or []:
            if getattr(p, "ticker", ""):
                name = p.ticker
                break
    subj = name or "this company"
    return [
        f"What are the main risks for {subj}?",
        f"How has {subj}'s revenue grown over the last 3 years?",
        f"What is {subj}'s profit margin versus peers?",
    ]


def _edgar_browse_url(ticker: str, filing_type: str = "") -> str:
    """P0.2: derive an EDGAR filing-list URL from ticker (+ filing type). EDGAR's
    browse-edgar resolves ticker symbols in the CIK field, so this lands the user
    on the company's real filings without needing the accession number (which the
    index doesn't store yet). Empty when there's no ticker to key on."""
    t = (ticker or "").strip().upper()
    if not t:
        return ""
    url = f"https://www.sec.gov/cgi-bin/browse-edgar?action=getcompany&CIK={t}&dateb=&owner=include&count=40"
    ft = (filing_type or "").strip()
    if ft:
        url += f"&type={ft}"
    return url


def _answer_provenance(citations: list) -> dict:
    """
    The filing the answer rests on, for telemetry.

    Read off the citations the user is actually shown rather than off the
    passages, so telemetry and the answer cannot disagree about which filing was
    cited. Empty strings when nothing authoritative was cited — which is itself
    the signal that the answer came from prose rather than from a filing.
    """
    for c in citations or []:
        if isinstance(c, dict) and c.get("accession"):
            return {
                "source_accession": c.get("accession", ""),
                "source_filing_url": c.get("filing_url", ""),
                "verification_status": c.get("verification_status", ""),
            }
    return {"source_accession": "", "source_filing_url": "", "verification_status": ""}


def audit_answer_state(citations: list) -> str:
    """The answer's evidence state, derived from citation verdicts.

    Deliberately not the model's confidence word: "HIGH" is a self-report, and
    the audit record is the artifact a reviewer trusts months later. Conflicting
    evidence outranks everything — one citation that contradicts its source is
    enough to stop calling the answer supported.
    """
    verdicts = {str(c.get("verification_status", "")) for c in (citations or [])}
    if not verdicts:
        return "ANSWERED"
    if "conflicting" in verdicts:
        return "CONFLICTING_EVIDENCE"
    if verdicts <= {"unsupported", "not_verifiable"}:
        return "UNSUPPORTED"
    return "ANSWERED"


def _normalize_citations(raw_citations: list, passages: list) -> list[dict]:
    """
    Enrich citations into the shape the frontend expects
    ({citation_number, chunk_id, text, document_title, ticker, section,
    is_verified}) by joining each one to the retrieved passage it points at.

    The LLM emits citations as {id, source, section, text}; ALiiCE emits
    {chunk_id, claim, sentence, entailed}. Neither carries document_title /
    ticker / chunk_id consistently, so the source side-panel had nothing to show.
    Match by chunk_id first, else by the 1-based citation number (sources are
    numbered in passage order), and backfill from the passage.
    """
    by_chunk = {}
    for p in passages or []:
        cid = getattr(p, "chunk_id", None)
        if cid:
            by_chunk[cid] = p

    out: list[dict] = []
    seen: set = set()
    for idx, c in enumerate(raw_citations or [], start=1):
        if not isinstance(c, dict):
            continue
        num = c.get("id") or c.get("citation_number") or idx
        try:
            num = int(num)
        except (ValueError, TypeError):
            num = idx

        p = by_chunk.get(c.get("chunk_id"))
        if p is None and 1 <= num <= len(passages or []):
            p = passages[num - 1]

        def _pf(attr: str, default: str = "") -> str:
            return (getattr(p, attr, default) or default) if p is not None else default

        doc_title = c.get("source") or c.get("document_title") or _pf("document_title")
        text = c.get("text") or c.get("sentence") or (_pf("text")[:500])
        chunk_id = c.get("chunk_id") or _pf("chunk_id")

        key = (num, chunk_id)
        if key in seen:
            continue
        seen.add(key)

        _tk = c.get("ticker") or _pf("ticker")
        _sec = c.get("section") or _pf("section")
        _ftype = c.get("document_type") or _pf("document_type") or _pf("filing_type")
        # The filing identity the SEC channel already resolved. It lives on the
        # passage's `metadata` dict, which this function used to skip entirely —
        # every field was resolved, verified and persisted, then dropped one step
        # before the user could see it.
        _prov = citation_provenance.provenance(
            getattr(p, "metadata", None) if p is not None else None, ticker=_tk
        )
        _meta = (getattr(p, "metadata", None) if p is not None else None) or {}
        _is_web = bool(_meta.get("web_evidence")
                       or _meta.get("source_class") == "WEB_EVIDENCE")
        _web_prov = citation_provenance.web_payload(_meta) if _is_web else {}
        # An exact filing URL outranks anything else, including a URL the model
        # emitted: the resolver read the accession out of the filing, the model
        # did not. Falling back to the generic company-listing URL while an exact
        # filing is known is the specific downgrade this ordering forbids.
        #
        # A web citation never reaches that fallback. `_edgar_browse_url` would
        # hand a Reuters article a `browse-edgar?action=getcompany` link — a
        # source card that opens a company filing list while claiming to be the
        # article it quoted, which is the same class of bug as the SEC one this
        # ordering was written to fix, pointed the other way.
        _url = (
            citation_provenance.citation_url(_prov)
            or _web_prov.get("url", "")
            or c.get("url")
            or _pf("url")
            or ("" if _is_web else _edgar_browse_url(_tk, _ftype))
        )
        _offset_start = c.get("char_offset_start") or (getattr(p, "char_offset_start", None) if p is not None else None)
        _offset_end = c.get("char_offset_end") or (getattr(p, "char_offset_end", None) if p is not None else None)

        # `is_verified` used to be whatever the model reported as `entailed`,
        # so a citation the model invented — index 99 against five passages —
        # reached the UI with no source and a green verified badge. The verdict
        # is now derived from the retrieved evidence; the model's opinion can
        # only raise a citation that already resolves and does not contradict
        # its passage.
        _model_entailed = c.get("entailed", c.get("is_verified"))
        _verdict = citation_verdict.verdict_for_citation(
            {"citation_number": num, "chunk_id": chunk_id, "text": text, "ticker": _tk},
            passages or [],
            model_entailed=(bool(_model_entailed) if _model_entailed is not None else None),
        )

        citation = {
            # Frontend/WS shape …
            "citation_number": num,
            "chunk_id": chunk_id,
            "text": text,
            "document_title": doc_title,
            "ticker": _tk,
            "section": _sec,
            "is_verified": _verdict.is_verified,
            "verification_status": _verdict.status,
            "verification_reasons": _verdict.reasons,
            # … plus REST SearchResponse.Citation required fields (id, source).
            "id": num,
            "source": doc_title,
            "date": c.get("filing_date") or _pf("filing_date"),
            "url": _url,
        }

        # The accession and the exact filing, promoted to top-level fields so a
        # consumer does not have to know the provenance object exists, plus the
        # full canonical chain for one that does.
        if _prov:
            citation.update(citation_provenance.payload(_prov))
            citation["provenance"] = _prov
        elif _web_prov:
            # Same treatment for a web source, through the same module: the
            # canonical URL, domain, publication date, retrieval timestamp and
            # evidence location promoted to top level, and the whole object
            # under `provenance` for a consumer that wants the chain. §11's
            # required web fields, none of them invented — a page that declared
            # no publication date carries none.
            citation.update(_web_prov)
            citation["provenance"] = _web_prov

        # The provenance payloads above each carry a `verification_status` of
        # their own, meaning "was this FILING verified against the filer" — a
        # different question from "does this source support this claim". Their
        # `.update()` was overwriting the citation verdict, so a citation with a
        # period mismatch against a verified filing came out marked `verified`
        # with `period_mismatch` still listed in its reasons. That is the exact
        # false-verified this module exists to prevent, so the verdict is
        # re-applied last and the filing's own state keeps a distinct name.
        _filing_status = citation.get("verification_status")
        if _filing_status and _filing_status != _verdict.status:
            citation["filing_verification_status"] = _filing_status
        citation["verification_status"] = _verdict.status
        citation["verification_reasons"] = _verdict.reasons
        citation["is_verified"] = _verdict.is_verified

        # Add char offsets for span-level citation highlighting
        if _offset_start is not None and _offset_end is not None:
            citation["char_offset_start"] = _offset_start
            citation["char_offset_end"] = _offset_end

        out.append(citation)

    # Resilience: the model degrades under rate-limit and drops the citations
    # array entirely, leaving the source panel empty even though passages WERE
    # retrieved. Synthesize citations from the top passages so sources always show.
    #
    # This branch builds citations without going through the loop above, so it
    # needs the same provenance join — otherwise the exact-filing citation is
    # correct only while the model is healthy, and degrades to a generic company
    # listing exactly when the answer is most in need of its source.
    if not out and passages:
        for i, p in enumerate(passages[:6], start=1):
            _tk = getattr(p, "ticker", "") or ""
            _prov = citation_provenance.provenance(
                getattr(p, "metadata", None), ticker=_tk
            )
            citation = {
                "citation_number": i,
                "chunk_id": getattr(p, "chunk_id", "") or "",
                "text": (getattr(p, "text", "") or "")[:500],
                "document_title": getattr(p, "document_title", "") or _tk or "Source",
                "ticker": _tk,
                "section": getattr(p, "section", "") or "",
                # Synthesized from a passage rather than cited by the model:
                # the source is real, but nothing asserted that it supports a
                # claim, so it is not verifiable rather than merely unverified.
                "is_verified": False,
                "verification_status": citation_verdict.NOT_VERIFIABLE,
                "verification_reasons": ["synthesized_from_passage_not_model_cited"],
                "id": i,
                "source": getattr(p, "document_title", "") or _tk or "Source",
                "date": getattr(p, "filing_date", "") or "",
                "url": citation_provenance.citation_url(
                    _prov,
                    _edgar_browse_url(_tk, getattr(p, "document_type", "") or ""),
                ),
            }
            if _prov:
                citation.update(citation_provenance.payload(_prov))
                citation["provenance"] = _prov
            out.append(citation)
        return out

    out.sort(key=lambda x: x["citation_number"])
    return out


_ANSWER_KEY_RE = re.compile(r'"answer"\s*:\s*"')


def _strip_thinking(raw: str) -> str:
    """
    Remove the model's reasoning preamble so it never reaches the UI.

    Handles both the closed form (``<thinking>...</thinking>``) and the
    truncated form (an opening tag the generation ran out of tokens before
    closing) — the prompt puts reasoning strictly *before* the JSON envelope,
    so an unclosed tag means everything after it is reasoning. ``<think>`` is
    the same thing under the name reasoning models emit.
    """
    if not raw:
        return raw
    s = re.sub(r"<(thinking|think)>[\s\S]*?</\1>", "", raw, flags=re.IGNORECASE)
    s = re.sub(r"<(thinking|think)>[\s\S]*$", "", s, flags=re.IGNORECASE)
    return s.strip()


def _extract_partial_answer(raw: str) -> str:
    """
    Pull the prose value of the JSON ``"answer"`` field out of a possibly
    partial (mid-stream) LLM envelope, decoding escape sequences to real text.

    The model is prompted to emit a JSON object ({"answer": "...", ...}); we must
    never stream that envelope to the client. Given the response accumulated so
    far, return the clean answer text available so far. If the response is plain
    text (not a JSON envelope), return it unchanged.

    The reasoning preamble is stripped first: it precedes the envelope, so
    leaving it in would both hide the ``{`` from the check below and leak raw
    chain-of-thought into the answer.
    """
    raw = _strip_thinking(raw)
    s = raw.lstrip()
    if not s.startswith("{"):
        return raw  # plain-text answer — stream as-is
    m = _ANSWER_KEY_RE.search(s)
    if not m:
        return ""  # JSON started but the answer field hasn't appeared yet
    rest = s[m.end():]
    out: list[str] = []
    i = 0
    closed = False
    _esc = {"n": "\n", "t": "\t", "r": "\n", '"': '"', "\\": "\\", "/": "/"}
    while i < len(rest):
        ch = rest[i]
        if ch == "\\" and i + 1 < len(rest):
            out.append(_esc.get(rest[i + 1], rest[i + 1]))
            i += 2
            continue
        if ch == '"':  # unescaped quote ends the answer value
            closed = True
            break
        out.append(ch)
        i += 1
    res = "".join(out)
    # Hold back a dangling escape backslash at the buffer boundary so we don't
    # emit a stray '\' that the next chunk will complete into an escape.
    if not closed and res.endswith("\\"):
        res = res[:-1]
    return res
