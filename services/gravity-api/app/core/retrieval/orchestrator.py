"""
Gravity Search — Retrieval Orchestrator
Dispatches parallel search requests across all 5 retrieval channels using asyncio.gather().
Target: <80ms total retrieval across all channels.

Architecture:
  Orchestrator
    ├─ asyncio.gather() ─┬─ Dense Search (Qdrant)      ~30ms
    │                    ├─ Sparse Search (ES BM25)     ~30ms
    │                    ├─ SPLADE Search (Qdrant)      ~30ms
    │                    ├─ Graph Search (Neo4j)        ~40ms
    │                    ├─ Structured Search (PG)      ~20ms
    │                    ├─ PageIndex Search (VectifyAI) ~variable
    │                    ├─ TurboQuant Search (in-mem)  ~10ms
    │                    ├─ GDELT Search (HTTP)         ~500ms
    │                    └─ MCP Search (FactSet/CapIQ)  ~2-10s
    └─ Returns: dict[channel_name → list[RetrievalResult]]
"""

import asyncio
import time
from typing import Any

import structlog

from app.core.retrieval.fusion import RetrievalResult

logger = structlog.get_logger()


async def _gdelt_to_results(gdelt_client, query: str) -> list[RetrievalResult]:
    """Fetch GDELT articles and convert to RetrievalResult objects."""
    articles = await gdelt_client.search_articles(query=query, max_records=10)
    results = []
    for art in articles:
        text = art.get("snippet", art.get("title", ""))
        if not text:
            continue
        url = art.get("url", "")
        results.append(RetrievalResult(
            document_id=url,
            chunk_id=url,
            text=text,
            score=float(art.get("score", 0.6)),
            document_title=art.get("title", ""),
            document_type="news",
            source_quality=4,  # news < SEC filings in authority scoring
            metadata={
                "title": art.get("title", ""),
                "url": url,
                "source_url": url,
                "published_date": art.get("seendate", ""),
                "domain": art.get("domain", ""),
                "language": art.get("language", "English"),
                "filing_type": "news",
            },
        ))
    return results


class ChannelResults(dict):
    """Channel name -> results, plus the channels that raised while producing them.

    A channel that fails was previously stored as an empty list, which made it
    indistinguishable from a channel that ran and legitimately found nothing.
    Downstream that difference is the whole story: "Elasticsearch returned no
    match for this query" and "Elasticsearch is down" are different answers, and
    reporting the second as the first tells the user the corpus was searched
    when it was not.

    A plain dict subclass so every existing consumer keeps working unchanged.
    """

    #: channel name -> exception class name. Empty when every channel completed.
    failed: dict

    def __init__(self, *args, failed: dict | None = None, **kwargs):
        super().__init__(*args, **kwargs)
        self.failed = failed or {}

    @property
    def degraded(self) -> bool:
        return bool(self.failed)


class RetrievalOrchestrator:
    """Parallel dispatch to all search backends with graceful degradation."""

    def __init__(
        self,
        dense_search=None,
        dense_pg_search=None,     # Channel 1b: pgvector halfvec(512), replaces Qdrant
        sparse_search=None,
        splade_search=None,
        graph_search=None,
        structured_search=None,
        tree_nav_search=None,     # GravityIndex: own vectorless tree-nav (optional)
        page_index_search=None,   # Channel 6: VectifyAI PageIndex (optional)
        turbo_quant_search=None,  # Channel 7: TurboQuant compressed ANN (optional)
        gdelt_search=None,        # Channel 8: GDELT global news (free, no key)
        mcp_search=None,          # Channel 9: MCP financial data (FactSet, CapIQ, etc.)
        edgar_search=None,        # Channel 10: live SEC EDGAR XBRL (free, no key)
        edgar_text_search=None,   # Channel 10b: live SEC filing prose (free, no key)
        web_research=None,        # Channel 11: live web research (search → fetch → extract)
        multi_query=None,         # MultiQueryRetriever — replaces dense for MEDIUM/COMPLEX
    ):
        self.channels = {}
        if dense_search:
            self.channels["dense"] = dense_search
        if dense_pg_search:
            self.channels["dense_pg"] = dense_pg_search
        if sparse_search:
            self.channels["bm25"] = sparse_search
        if splade_search:
            self.channels["splade"] = splade_search
        if graph_search:
            self.channels["graph"] = graph_search
        if structured_search:
            self.channels["structured"] = structured_search
        if tree_nav_search:
            self.channels["tree_nav"] = tree_nav_search
        if page_index_search:
            self.channels["page_index"] = page_index_search
        if turbo_quant_search:
            self.channels["turbo_quant"] = turbo_quant_search
        if gdelt_search:
            self.channels["gdelt"] = gdelt_search
        if mcp_search:
            self.channels["mcp"] = mcp_search
        if edgar_search:
            self.channels["edgar"] = edgar_search
        if edgar_text_search:
            self.channels["edgar_text"] = edgar_text_search
        if web_research:
            self.channels["web"] = web_research

        self._multi_query = multi_query
        logger.info("retrieval_orchestrator_init", channels=list(self.channels.keys()),
                    multi_query=multi_query is not None)

    async def search(
        self,
        query: str,
        expanded_terms: dict | None = None,
        filters: dict | None = None,
        channels: list[str] | None = None,
        entities: dict | None = None,
        complexity: str = "simple",
        question_class: str = "",
    ) -> dict[str, list[RetrievalResult]]:
        """
        Execute all retrieval channels in parallel.

        For MEDIUM/COMPLEX queries, the dense channel is replaced by
        MultiQueryRetriever (4 query variants × dense search → merged).
        This yields +10-20% recall with no latency increase (parallel execution).
        """
        start = time.perf_counter()

        active_channels = channels or list(self.channels.keys())
        active_channels = [c for c in active_channels if c in self.channels]

        if not active_channels:
            logger.warning("no_active_channels")
            return {}

        # For MEDIUM/COMPLEX: replace plain dense with multi-query expansion
        use_multi_query = (
            self._multi_query is not None
            and complexity in ("medium", "complex", "math")
            and "dense" in active_channels
        )

        tasks = {}
        # Collected by the channel coroutines themselves, because `_safe_search`
        # swallows its own timeouts and exceptions: nothing ever reaches the
        # `return_exceptions=True` below, so without this the failure map stayed
        # empty even with three providers refusing connections.
        channel_failures: dict = {}

        for channel_name in active_channels:
            if channel_name == "dense" and use_multi_query:
                # Swap dense → multi-query (runs HyDE × 4 variants internally)
                tasks["dense"] = self._safe_multi_query(query, filters)
            else:
                channel = self.channels[channel_name]
                tasks[channel_name] = self._safe_search(
                    channel_name, channel, query, expanded_terms, filters,
                    entities, question_class, failures=channel_failures,
                )

        task_list = list(tasks.values())
        channel_names = list(tasks.keys())
        results_list = await asyncio.gather(*task_list, return_exceptions=True)

        results = ChannelResults(failed=dict(channel_failures))
        for name, result in zip(channel_names, results_list):
            if isinstance(result, Exception):
                logger.error("channel_failed", channel=name, error=str(result))
                results[name] = []
                # Kept separately so a failure is never reported as an empty
                # result. The exception type only — never the message, which can
                # carry a connection string or a key.
                results.failed[name] = type(result).__name__
            else:
                results[name] = result

        elapsed_ms = (time.perf_counter() - start) * 1000
        logger.info(
            "retrieval_complete",
            channels_queried=channel_names,
            multi_query_used=use_multi_query,
            total_results={k: len(v) for k, v in results.items()},
            channels_failed=results.failed,
            latency_ms=round(elapsed_ms, 1),
        )
        return results

    async def _safe_multi_query(
        self, query: str, filters: dict | None
    ) -> list[RetrievalResult]:
        """Run MultiQueryRetriever with timeout and graceful fallback to plain dense."""
        try:
            results = await asyncio.wait_for(
                self._multi_query.search(query=query, filters=filters),
                timeout=self._CHANNEL_TIMEOUTS["dense"],
            )
            logger.debug("multi_query_search", results=len(results))
            return results
        except asyncio.TimeoutError:
            logger.warning("multi_query_timeout")
        except Exception as e:
            logger.warning("multi_query_failed", error=str(e))
        # Fallback: plain dense search
        if "dense" in self.channels:
            return await self._safe_search(
                "dense", self.channels["dense"], query, None, filters, None
            )
        return []

    # Per-channel timeout budgets (seconds).
    # BM25/dense increased to 8s to handle lazy-client cold-start on first query.
    _CHANNEL_TIMEOUTS: dict[str, float] = {
        "dense":      12.0,
        "bm25":       12.0,
        "splade":      8.0,
        "graph":       4.0,
        "structured":  4.0,
        "tree_nav":   15.0,   # LLM tree navigation + Qdrant node fetch
        "page_index": 30.0,   # PageIndex navigates document trees — allow more time
        "turbo_quant": 2.0,   # in-memory; fast
        "gdelt":       4.0,   # external HTTP; allow extra time
        "mcp":        15.0,   # MCP: external financial data APIs; variable latency
        "edgar":       8.0,   # SEC EDGAR: 2-3 external HTTPS round trips per query
        # Filing prose costs what filing facts do plus one multi-megabyte
        # document download and parse. The parsed Items are cached per
        # accession, so the budget covers a cold filing, not every query.
        "edgar_text": 25.0,
        # Web research is search + N page fetches, each an external round trip
        # to a server we do not control. Its own ResearchBudget deadline is
        # shorter than this; the timeout here is the backstop for a provider
        # that accepts a connection and then never answers.
        "web":        40.0,
    }

    async def _safe_search(
        self,
        name: str,
        channel: Any,
        query: str,
        expanded_terms: dict | None,
        filters: dict | None,
        entities: dict | None,
        question_class: str = "",
        failures: dict | None = None,
    ) -> list[RetrievalResult]:
        """Execute a single channel search with per-channel timeout and error handling.

        `failures` collects the channels that did not complete. Without it a
        channel that timed out or raised was indistinguishable from one that ran
        and matched nothing: both returned `[]` here, and the empty list is all
        the caller ever saw. With Qdrant, Elasticsearch and Neo4j refusing
        connections, every one of them was being reported to the user as a
        channel that had searched and found nothing.
        """
        timeout_s = self._CHANNEL_TIMEOUTS.get(name, 2.0)
        try:
            t0 = time.perf_counter()

            if name == "dense":
                coro = channel.search(query=query, filters=filters)
            elif name == "bm25":
                coro = channel.search(query=query, expanded_terms=expanded_terms, filters=filters)
            elif name == "splade":
                coro = channel.search(query=query, filters=filters)
            elif name == "graph":
                coro = channel.search(query=query, entities=entities)
            elif name == "structured":
                # MUST pass filters: the resolved ticker lives in filters["companies"]
                # (entities often lacks it). Without filters the channel finds no
                # ticker and returns [] — the XBRL exact-facts never reach the LLM.
                coro = channel.search(query=query, entities=entities, filters=filters)
            elif name == "tree_nav":
                coro = channel.search(query=query, entities=entities, filters=filters)
            elif name == "page_index":
                coro = channel.search(query=query, filters=filters)
            elif name == "turbo_quant":
                # TurboQuantSearch needs the embedder; it uses search_text()
                coro = channel.search_text(
                    query=query, embedder=channel._embedder if hasattr(channel, "_embedder") else None,
                    filters=filters,
                )
            elif name == "gdelt":
                # GDELT returns article dicts — convert to RetrievalResult inline
                coro = _gdelt_to_results(channel, query)
            elif name == "mcp":
                # MCP channel accepts entities for ticker extraction
                coro = channel.search(query=query, filters=filters, entities=entities)
            elif name == "edgar":
                # Live SEC XBRL. Needs filters too: the resolved ticker lives in
                # filters["companies"] for the same reason the structured channel does.
                coro = channel.search(query=query, filters=filters, entities=entities)
            elif name == "edgar_text":
                # Live SEC filing prose. Same company resolution as `edgar`.
                coro = channel.search(query=query, filters=filters, entities=entities)
            elif name == "web":
                # Live web research. Takes the question class as well: the class
                # sets the search budget, the recency window and the freshness
                # rule, and defaulting it to GENERAL here would give a "latest
                # news" question a year-wide staleness window.
                coro = channel.search(
                    query=query, filters=filters, entities=entities,
                    question_class=question_class or "GENERAL",
                )
            else:
                return []

            results = await asyncio.wait_for(coro, timeout=timeout_s)

            ms = (time.perf_counter() - t0) * 1000
            logger.debug("channel_search", channel=name, results=len(results), ms=round(ms, 1))
            return results

        except asyncio.TimeoutError:
            logger.warning("channel_timeout", channel=name, timeout_s=timeout_s)
            if failures is not None:
                failures[name] = "TimeoutError"
            return []
        except Exception as e:
            logger.error("channel_error", channel=name, error=str(e))
            if failures is not None:
                # The exception type only — a message can carry a DSN or a key.
                failures[name] = type(e).__name__
            return []

    async def search_multi_entity(
        self,
        query: str,
        tickers: list[str],
        filters: dict | None = None,
        channels: list[str] | None = None,
        complexity: str = "medium",
        question_class: str = "",
    ) -> dict[str, list[RetrievalResult]]:
        """
        Parallel per-entity retrieval for comparison queries.

        Runs the full channel stack once per ticker independently, then merges.
        Each result is tagged with its source ticker so the LLM can attribute
        values correctly ("Apple revenue: $394B vs Microsoft revenue: $211B").

        Used when query_plan["entities"]["companies"] has 2+ entries.
        """
        if not tickers:
            return await self.search(query=query, filters=filters,
                                     channels=channels, complexity=complexity,
                                     question_class=question_class)

        logger.info("multi_entity_retrieval", tickers=tickers)

        # Web research runs ONCE for the whole question, not once per ticker.
        # Per-entity fan-out multiplies every channel by N, which is right for a
        # ticker-scoped lookup and wrong for the web: five tickers would mean
        # five times the search budget, five times the fetches and five sets of
        # near-identical articles about the same comparison. The question is
        # asked once, so the web is asked once.
        per_entity_channels = [c for c in (channels or []) if c != "web"]
        run_web = channels is not None and "web" in channels and "web" in self.channels

        # One full retrieval pass per entity, in parallel
        per_entity_tasks = [
            self.search(
                query=query,
                filters={**(filters or {}), "companies": [ticker]},
                channels=per_entity_channels or None,
                complexity=complexity,
                question_class=question_class,
            )
            for ticker in tickers
        ]
        if run_web:
            per_entity_tasks.append(self.search(
                query=query,
                filters={**(filters or {}), "companies": list(tickers)},
                channels=["web"],
                complexity=complexity,
                question_class=question_class,
            ))
            tickers = list(tickers) + [""]  # the shared web pass has no owning ticker

        per_entity_results = await asyncio.gather(*per_entity_tasks, return_exceptions=True)

        # Merge: label each result with its ticker, combine into channel buckets
        merged: dict[str, list[RetrievalResult]] = {}
        for ticker, entity_result in zip(tickers, per_entity_results):
            if isinstance(entity_result, Exception):
                logger.warning("multi_entity_channel_failed", ticker=ticker, error=str(entity_result))
                continue
            for channel, results in entity_result.items():
                if channel not in merged:
                    merged[channel] = []
                for r in results:
                    # Tag metadata with entity source for LLM attribution. The
                    # shared web pass carries no ticker — an article comparing
                    # five companies is not evidence *about* any one of them,
                    # and labelling it with one would invite the LLM to
                    # attribute its claims to that company alone.
                    if r.metadata is None:
                        r.metadata = {}
                    if ticker:
                        r.metadata["entity_ticker"] = ticker
                    merged[channel].append(r)

        logger.info(
            "multi_entity_merged",
            tickers=tickers,
            total={ch: len(rs) for ch, rs in merged.items()},
        )
        return merged
