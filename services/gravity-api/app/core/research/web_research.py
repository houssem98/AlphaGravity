"""
The web leg: search, select, fetch, extract, and only then evidence.

The order in that sentence is the whole design. Spec section 10 and section 32
both say a snippet is not evidence, and the reason is that a snippet is written
by the search index to sell the click — it is a summary of the page produced by
a third party with no obligation to be accurate about it. Citing it means citing
something nobody wrote.

So every piece of `WebEvidence` this module produces comes from a page that was
actually fetched over a URL that passed the SSRF guard, with the text sanitized,
the fetch timestamped and the publication date read from the page rather than
from the search result. A source that could not be fetched contributes no
evidence, however good its snippet looked.

`WebResearchChannel` is registered in `RetrievalOrchestrator` like any other
channel, which is what makes web failure non-fatal (the orchestrator already
isolates channel exceptions) and web/SEC parallelism automatic (it already
gathers). No new concurrency machinery is introduced.
"""

from __future__ import annotations

import asyncio
import re
from datetime import datetime, timezone

import structlog

from app.core.research import sanitize
from app.core.research.budget import Deadline, ResearchBudget, ResearchUsage
from app.core.research.evidence import WEB_EVIDENCE, Evidence, parse_date
from app.core.research.providers import (
    ProviderSet,
    SearchResult,
    WebDocument,
    WebSearchProvider,
    default_providers,
)
from app.core.research.source_quality import rank_key, rate
from app.core.research.url_safety import UnsafeURLError, check_url, dedup_key

logger = structlog.get_logger()

# Words that carry no retrieval signal in a search query. Removing them lets the
# generated queries stay inside the length where search engines behave well.
_STOP = frozenset("""
what whats how why when where who which did do does is was were are be been
the a an of for in on at to from by with and or vs versus about into over
tell me show give please can could would should i we you it its their there
that this these those explain describe discuss summarize summarise
""".split())

_YEAR = re.compile(r"\b(?:FY\s?)?((?:19|20)\d{2})\b", re.I)
_QUARTER = re.compile(r"\bQ([1-4])\b", re.I)

# Minimum characters a passage must have to be worth citing. Below this it is a
# heading or a nav item, not evidence.
_MIN_PASSAGE = 120
_MAX_PASSAGE = sanitize.MAX_EVIDENCE_CHARS

# The share of the research deadline the search phase may spend. The remainder
# is reserved for fetching, because a page that was never fetched yields no
# evidence however good the search results looked.
_SEARCH_SHARE = 0.45


def generate_queries(
    query: str,
    *,
    companies: list[str] | None = None,
    question_class: str = "GENERAL",
    limit: int = 4,
) -> list[str]:
    """
    Targeted search queries from one user question (spec section 18).

    Not a paraphrase generator and deliberately not an LLM call: this runs
    before retrieval on every web-routed request, and an LLM here would put a
    model's latency and availability in front of the web leg for no accuracy
    that a template does not already give.

    The templates encode what a research analyst would actually type — the
    entity plus one facet, rather than the whole sentence — because search
    engines rank a five-word query far better than a fifteen-word one.
    """
    raw = str(query or "").strip()
    if not raw:
        return []

    tickers = [t for t in (companies or []) if t]
    entity = tickers[0] if tickers else ""

    years = _YEAR.findall(raw)
    quarters = _QUARTER.findall(raw)
    period = ""
    if years:
        period = f"Q{quarters[0]} {years[0]}" if quarters else years[0]

    # The content words of the question, in order, minus the entity itself.
    terms = [
        w for w in re.findall(r"[A-Za-z][A-Za-z&/'-]+|\d+", raw)
        if w.lower() not in _STOP and w.upper() not in {t.upper() for t in tickers}
    ]
    core = " ".join(terms[:8]).strip()

    out: list[str] = []

    def add(q: str) -> None:
        q = " ".join(str(q).split())
        if len(q) >= 3 and q.lower() not in {x.lower() for x in out}:
            out.append(q)

    # 1. The question itself, trimmed. Always first: a hand-written question is
    #    often already a good query, and a template that never includes it can
    #    lose the one phrasing that finds the right page.
    add(raw if len(raw) <= 120 else core)

    from app.core import question_class as qc

    if entity:
        if question_class == qc.MARKET_NEWS:
            add(f"{entity} {core}"[:120])
            add(f"{entity} stock news latest")
            add(f"{entity} announcement {period}".strip())
        elif question_class in (qc.COMPANY_RESEARCH, qc.MULTI_DOCUMENT_RESEARCH):
            add(f"{entity} {core}"[:120])
            add(f"{entity} customers partners suppliers")
            add(f"{entity} competitive position market share")
            add(f"{entity} investor relations {period}".strip())
        elif question_class in (qc.FINANCIAL_CALCULATION, qc.FILING_QUALITATIVE):
            add(f"{entity} {core} {period}".strip()[:120])
            add(f"{entity} 10-K {core}"[:120])
            add(f"{entity} earnings {period}".strip())
        else:
            add(f"{entity} {core}"[:120])
            add(f"{entity} {period}".strip())
    else:
        add(core)
        if period:
            add(f"{core} {period}"[:120])

    return [q for q in out if q][:max(0, int(limit))]


def _recency_days(question_class: str) -> int | None:
    """How far back the search provider should look. `None` means no limit."""
    from app.core import question_class as qc

    return {
        qc.MARKET_NEWS: 7,
        qc.MARKET_CONTEXT: 30,
        qc.MACRO: 90,
    }.get(question_class)


def select_sources(
    results: list[SearchResult],
    *,
    limit: int,
    seen: set[str] | None = None,
) -> tuple[list[SearchResult], int]:
    """
    Which search results are worth spending a fetch on.

    Ranked by tier first and relevance second (spec section 8), deduplicated by
    canonical URL and normalized title (spec section 17), and capped at one page
    per domain until the cap is reached — six pages from one site is one source
    with six URLs, and produces exactly the redundant citation list the spec
    forbids.

    Returns the selection and the number of duplicates it dropped.
    """
    seen = seen if seen is not None else set()
    duplicates = 0
    ranked: list[tuple[tuple, SearchResult]] = []
    for r in results:
        if not r.url:
            continue
        key = dedup_key(r.url, r.title)
        if key in seen:
            duplicates += 1
            continue
        seen.add(key)
        rating = rate(r.url, title=r.title)
        ranked.append((rank_key(rating, r.relevance_score), r))

    ranked.sort(key=lambda pair: pair[0])

    chosen: list[SearchResult] = []
    per_domain: dict[str, int] = {}
    # First pass: at most one page per domain, best first.
    for _, r in ranked:
        if len(chosen) >= limit:
            break
        d = r.domain or ""
        if per_domain.get(d, 0) >= 1:
            continue
        per_domain[d] = per_domain.get(d, 0) + 1
        chosen.append(r)
    # Second pass: fill any remaining budget, now allowing a second page from a
    # domain that has already contributed.
    if len(chosen) < limit:
        picked = {id(r) for r in chosen}
        for _, r in ranked:
            if len(chosen) >= limit:
                break
            if id(r) in picked:
                continue
            if per_domain.get(r.domain or "", 0) >= 2:
                continue
            per_domain[r.domain or ""] = per_domain.get(r.domain or "", 0) + 1
            chosen.append(r)

    return chosen, duplicates


def _score_passage(passage: str, terms: set[str]) -> float:
    """How much of the question this passage actually addresses."""
    if not terms:
        return 0.0
    words = set(re.findall(r"[a-z0-9]+", passage.lower()))
    hits = len(words & terms)
    # Length-normalised so a 4000-character wall of text does not beat a
    # focused paragraph purely by containing more words.
    return hits / (len(terms) ** 0.5) * (1.0 + min(len(passage), 1200) / 4000)


def extract_evidence(
    doc: WebDocument,
    *,
    query: str,
    result: SearchResult | None = None,
    max_passages: int = 3,
) -> list[Evidence]:
    """
    The passages of a fetched page that bear on the question, as evidence.

    Selection is by lexical overlap with the question rather than by position:
    the answer to "what drove the revenue decline" is somewhere in the middle of
    an article, and taking the first N characters reliably returns the
    boilerplate header instead.

    Every passage is sanitized before it becomes evidence, and the injection
    flags travel with it — a page that tried something is still citable (an
    analyst may need to see exactly that), it is simply marked.
    """
    text = str(doc.text or "")
    if not text.strip():
        return []

    terms = {
        w for w in re.findall(r"[a-z0-9]+", str(query or "").lower())
        if w not in _STOP and len(w) > 2
    }

    # Paragraphs, then merged into windows large enough to be quotable.
    paragraphs = [p.strip() for p in re.split(r"\n\s*\n", text) if p.strip()]
    windows: list[str] = []
    buffer = ""
    for para in paragraphs:
        if len(buffer) + len(para) + 2 <= _MAX_PASSAGE:
            buffer = f"{buffer}\n\n{para}" if buffer else para
        else:
            if len(buffer) >= _MIN_PASSAGE:
                windows.append(buffer)
            buffer = para[:_MAX_PASSAGE]
    if len(buffer) >= _MIN_PASSAGE:
        windows.append(buffer)
    if not windows and len(text) >= _MIN_PASSAGE:
        windows = [text[:_MAX_PASSAGE]]

    scored = sorted(
        ((_score_passage(w, terms), i, w) for i, w in enumerate(windows)),
        key=lambda t: (-t[0], t[1]),
    )

    url = doc.final_url or doc.url
    published = parse_date(doc.published_at) or parse_date(
        result.published_at if result else "")
    rating = rate(url, title=doc.title or (result.title if result else ""))

    out: list[Evidence] = []
    for rank, (score, index, window) in enumerate(scored[:max(1, max_passages)]):
        if score <= 0 and rank > 0:
            break  # nothing else on this page addresses the question
        clean, flags = sanitize.sanitize(window)
        if len(clean) < _MIN_PASSAGE:
            continue
        out.append(Evidence(
            kind=WEB_EVIDENCE,
            text=clean,
            title=doc.title or (result.title if result else "") or url,
            url=url,
            source_type="web_page",
            published_at=published,
            retrieved_at=doc.retrieved_at,
            location=f"paragraph {index + 1}",
            relevance=round(float(score), 4),
            rating=rating,
            injection_flags=flags,
            provenance=web_provenance(doc, result=result, location=f"paragraph {index + 1}"),
        ))
    return out


def web_provenance(
    doc: WebDocument,
    *,
    result: SearchResult | None = None,
    location: str = "",
) -> dict:
    """
    The provenance object for a web source.

    Deliberately the same *shape* as `citation_provenance.provenance()` — a flat
    dict of stated fields with nothing invented and empties omitted — so both
    kinds of citation travel through one code path to the wire. Building it here
    rather than in `citation_provenance` keeps the SEC module free of web
    concepts; `citation_provenance.web_payload()` is the join.
    """
    from app.core.research.url_safety import canonicalize, registrable_domain

    url = doc.final_url or doc.url
    published = parse_date(doc.published_at) or parse_date(
        result.published_at if result else "")
    out = {
        "source_class": WEB_EVIDENCE,
        "url": url,
        "canonical_url": canonicalize(url),
        "requested_url": doc.url if doc.url != url else "",
        "title": doc.title or (result.title if result else ""),
        "domain": registrable_domain(url),
        "published_at": published.isoformat() if published else "",
        "retrieved_at": doc.retrieved_at.isoformat() if doc.retrieved_at else "",
        "source_type": "web_page",
        "evidence_location": location,
        "fetch_provider": doc.provider,
        "search_provider": result.provider if result else "",
        "http_status": doc.status_code or "",
    }
    return {k: v for k, v in out.items() if v not in ("", None)}


class WebResearchChannel:
    """
    Web research, shaped as a retrieval channel.

    Exposes `.search(query, filters, entities)` and returns `RetrievalResult`
    objects, so `RetrievalOrchestrator` treats it exactly like `dense` or
    `edgar`: parallel dispatch, a timeout budget, and exception isolation. The
    richer `Evidence` objects are kept on `self.last_run` for the pipeline to
    pick up — the orchestrator's contract is a list of passages and this does
    not change it.
    """

    def __init__(self, providers: ProviderSet | None = None):
        self._providers = providers or default_providers()
        self.last_run: dict = {}

    def available(self) -> bool:
        return self._providers.has_search and self._providers.has_fetch

    async def research(
        self,
        query: str,
        *,
        question_class: str = "GENERAL",
        companies: list[str] | None = None,
        budget: ResearchBudget | None = None,
    ) -> tuple[list[Evidence], ResearchUsage]:
        """
        Run the full web leg and return evidence plus what it cost.

        Never raises. Every failure becomes a recorded reason and an empty or
        partial result, because spec section 15 requires that web trouble cannot
        take the SEC pipeline down with it.
        """
        # The fresh-intent flag comes from the same router the pipeline used, so
        # the budget and the source plan cannot disagree about whether the web
        # leg runs. They did before: a "latest earnings" question routed to WEB
        # and then spent nothing on it.
        from app.core.question_class import route_sources

        budget = budget or ResearchBudget.for_class(
            question_class, fresh=route_sources(question_class, query).fresh)
        usage = ResearchUsage()
        evidence: list[Evidence] = []

        if budget.max_search_queries <= 0 or budget.max_pages_fetched <= 0:
            usage.degraded = "not_routed"
            return [], usage.finish()

        search_provider = next(
            (p for p in self._providers.search if p.available()), None)
        if search_provider is None:
            usage.degraded = "no_search_provider"
            usage.note_error("no web search provider is configured")
            return [], usage.finish()
        usage.provider = search_provider.name

        deadline = Deadline(budget.total_deadline_s)
        queries = generate_queries(
            query, companies=companies, question_class=question_class,
            limit=budget.max_search_queries,
        )

        # ── Search ────────────────────────────────────────────────────────
        # Queries run CONCURRENTLY. Run serially they consumed the entire
        # research deadline before a single page was fetched: against the live
        # Tavily endpoint two queries took 20s of a 20s budget and the run
        # reported `no_evidence_extracted` while having found 16 perfectly good
        # results. Searches are independent, so there was never a reason to
        # serialise them, and a search phase that starves the fetch phase
        # produces exactly the snippet-only citation list the whole module
        # exists to avoid.
        #
        # `_SEARCH_SHARE` reserves the rest of the deadline for fetching, so a
        # slow provider can no longer spend the fetch budget.
        results: list[SearchResult] = []
        recency = _recency_days(question_class)
        search_deadline = max(deadline.remaining * _SEARCH_SHARE, 1.0)

        async def _run_query(q: str) -> list[SearchResult]:
            """One query against the first provider that answers it."""
            exhausted: list[WebSearchProvider] = []
            provider = search_provider
            while provider is not None:
                try:
                    return await asyncio.wait_for(
                        provider.search(q, max_results=budget.max_results_per_query,
                                        recency_days=recency),
                        timeout=search_deadline,
                    )
                except asyncio.TimeoutError:
                    # About this query, not the provider.
                    usage.note_error(f"search timed out: {q[:60]}")
                    return []
                except Exception as e:
                    usage.note_error(f"search failed ({provider.name}): {e}")
                    exhausted.append(provider)
                    # Fall back to another provider for THIS query. Moving on to
                    # the next query instead would silently drop the one that
                    # triggered the swap — and when the first query fails, that
                    # is the whole run.
                    provider = next(
                        (p for p in self._providers.search
                         if p.available() and p not in exhausted), None)
                    if provider is not None:
                        logger.warning("web_search_provider_fallback",
                                       failed=exhausted[-1].name, using=provider.name)
                        if provider.name not in usage.provider:
                            usage.provider = f"{usage.provider}->{provider.name}"
            return []

        try:
            batches = await asyncio.wait_for(
                asyncio.gather(*(_run_query(q) for q in queries),
                               return_exceptions=True),
                timeout=search_deadline + 2.0,
            )
        except asyncio.TimeoutError:
            usage.note_error("search phase exceeded its share of the deadline")
            batches = []

        for batch in batches:
            if isinstance(batch, Exception):
                usage.note_error(f"search task failed: {batch}")
                continue
            usage.search_queries += 1
            usage.results_returned += len(batch)
            results.extend(batch)

        if usage.search_queries == 0 and queries:
            usage.degraded = usage.degraded or "all_search_providers_failed"

        if not results:
            usage.degraded = usage.degraded or "no_search_results"
            return [], usage.finish()

        # ── Select ────────────────────────────────────────────────────────
        selected, duplicates = select_sources(
            results, limit=budget.max_pages_fetched)
        usage.duplicates_dropped += duplicates

        # ── Fetch + extract ───────────────────────────────────────────────
        fetch_providers = [p for p in self._providers.fetch if p.available()]

        async def _one(result: SearchResult) -> list[Evidence]:
            verdict = check_url(result.url)
            if not verdict.allowed:
                usage.pages_blocked += 1
                usage.note_error(f"blocked {verdict.host or 'url'}: {verdict.reason}")
                return []
            usage.pages_attempted += 1
            for provider in fetch_providers:
                if deadline.expired:
                    return []
                try:
                    doc = await provider.fetch(
                        result.url,
                        timeout_s=min(budget.per_fetch_timeout_s,
                                      max(deadline.remaining, 1.0)),
                    )
                except UnsafeURLError as e:
                    usage.pages_blocked += 1
                    usage.note_error(str(e))
                    return []
                except Exception as e:
                    usage.note_error(f"fetch failed ({provider.name}): {e}")
                    continue
                if doc is None or not doc.text.strip():
                    continue
                usage.pages_fetched += 1
                found = extract_evidence(
                    doc, query=query, result=result,
                    max_passages=budget.max_evidence_per_page,
                )
                usage.injection_flags += sum(1 for e in found if e.injection_flags)
                return found
            return []

        try:
            batches = await asyncio.wait_for(
                asyncio.gather(*(_one(r) for r in selected),
                               return_exceptions=True),
                timeout=max(deadline.remaining, 0.1),
            )
        except asyncio.TimeoutError:
            usage.note_error("page fetches exceeded the research deadline")
            batches = []

        for batch in batches:
            if isinstance(batch, Exception):
                usage.note_error(f"fetch task failed: {batch}")
                continue
            evidence.extend(batch)

        usage.evidence_created = len(evidence)
        if not evidence and not usage.degraded:
            usage.degraded = "no_evidence_extracted"

        logger.info(
            "web_research_complete",
            question_class=question_class,
            queries=usage.search_queries,
            results=usage.results_returned,
            pages_fetched=usage.pages_fetched,
            pages_blocked=usage.pages_blocked,
            evidence=usage.evidence_created,
            provider=usage.provider,
            degraded=usage.degraded,
        )
        self.last_run = {"evidence": evidence, "usage": usage}
        return evidence, usage.finish()

    async def search(
        self,
        query: str,
        filters: dict | None = None,
        entities: dict | None = None,
        question_class: str = "GENERAL",
    ) -> list:
        """
        The channel interface `RetrievalOrchestrator` calls.

        Converts evidence into `RetrievalResult` so fusion and reranking handle
        web passages with the machinery that already exists, and stashes the
        evidence objects on `self.last_run` for the pipeline's citation stage.
        """
        from app.core.retrieval.fusion import RetrievalResult

        companies = list((filters or {}).get("companies") or [])
        if not companies:
            companies = [
                c.get("ticker") for c in ((entities or {}).get("companies") or [])
                if isinstance(c, dict) and c.get("ticker")
            ]

        evidence, usage = await self.research(
            query, question_class=question_class, companies=companies)
        self.last_run = {"evidence": evidence, "usage": usage}

        out = []
        for i, ev in enumerate(evidence):
            out.append(RetrievalResult(
                document_id=ev.url,
                chunk_id=f"web:{ev.dedup_identity}:{i}",
                text=ev.text,
                score=float(ev.relevance),
                document_title=ev.title,
                document_type="web_page",
                source_quality=ev.rating.score if ev.rating else 4,
                metadata={
                    **ev.provenance,
                    "web_evidence": True,
                    "category": ev.category,
                    "tier": int(ev.tier),
                    "injection_flags": ev.injection_flags,
                },
            ))
        return out
