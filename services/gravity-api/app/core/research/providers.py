"""
Search and fetch, behind interfaces, so no provider is named in the pipeline.

Spec section 3 forbids hard-coding a search provider into `SearchPipeline`. The
reason is not aesthetic: this deployment's Tavily key has been returning HTTP
432 since 2026-07-10, and a pipeline that imports Tavily directly is a pipeline
that has no web research at all until someone edits the pipeline. With an
adapter and a registry, a dead provider is a degraded mode with a stated reason.

Two interfaces, because search and fetch are genuinely different capabilities
with different failure modes: Tavily can search and cannot render JavaScript,
Firecrawl can render and does not index, and GDELT can find news for free and
returns snippets only. A single `WebProvider` would force every adapter to stub
half of itself.

Every adapter returns the same structured shape (spec section 7) and every
fetch goes through the SSRF guard, in `fetch()` rather than in the caller, so a
new adapter cannot forget it.
"""

from __future__ import annotations

import abc
import os
from dataclasses import dataclass, field
from datetime import datetime, timezone

import structlog

from app.core.research.url_safety import (
    UnsafeURLError,
    canonicalize,
    check_url,
    registrable_domain,
)

logger = structlog.get_logger()

_UA = "AlphaGravity-Research/1.0 (+https://alphagravity.ai; research@alphagravity.ai)"

# Anything larger is not an article. Enforced during streaming so a hostile
# server cannot exhaust memory by advertising a small Content-Length and then
# sending gigabytes.
MAX_PAGE_BYTES = 4 * 1024 * 1024


@dataclass
class SearchResult:
    """One search hit. A pointer to a page, explicitly NOT evidence."""

    title: str
    url: str
    snippet: str = ""
    published_at: str = ""
    domain: str = ""
    relevance_score: float = 0.0
    provider: str = ""

    def __post_init__(self):
        if not self.domain:
            self.domain = registrable_domain(self.url)

    @property
    def canonical_url(self) -> str:
        return canonicalize(self.url)


@dataclass
class WebDocument:
    """One fetched page. The raw material evidence is extracted from."""

    url: str
    final_url: str = ""
    title: str = ""
    text: str = ""
    published_at: str = ""
    content_type: str = ""
    status_code: int = 0
    retrieved_at: datetime = field(
        default_factory=lambda: datetime.now(timezone.utc))
    provider: str = ""

    @property
    def domain(self) -> str:
        return registrable_domain(self.final_url or self.url)


class WebSearchProvider(abc.ABC):
    """Discovery. Returns pointers, never evidence."""

    name: str = "abstract"

    @abc.abstractmethod
    async def search(self, query: str, *, max_results: int = 8,
                     recency_days: int | None = None,
                     domains: list[str] | None = None) -> list[SearchResult]:
        ...

    @abc.abstractmethod
    def available(self) -> bool:
        """Whether this provider can be used right now. Cheap and non-network —
        a provider that needs a round trip to answer this would be consulted on
        every request just to be told it is dead."""


class WebFetchProvider(abc.ABC):
    """Retrieval of one page's text, after the SSRF guard has passed it."""

    name: str = "abstract"

    @abc.abstractmethod
    async def fetch(self, url: str, *, timeout_s: float = 12.0) -> WebDocument | None:
        ...

    @abc.abstractmethod
    def available(self) -> bool:
        ...


# ── Search adapters ───────────────────────────────────────────────────────

class TavilySearchProvider(WebSearchProvider):
    """
    Tavily. Returns an LLM-oriented result set with a relevance score.

    Known dead in this deployment (HTTP 432 since 2026-07-10). Kept because the
    key may be restored and because `available()` reporting True while the API
    refuses is exactly the case the registry's fallback exists to handle.
    """

    name = "tavily"
    ENDPOINT = "https://api.tavily.com/search"

    def __init__(self, api_key: str | None = None):
        self._key = api_key or os.getenv("TAVILY_API_KEY", "")

    def available(self) -> bool:
        return bool(self._key)

    async def search(self, query, *, max_results=8, recency_days=None,
                     domains=None) -> list[SearchResult]:
        import httpx

        payload = {
            "api_key": self._key,
            "query": query,
            "max_results": max(1, min(int(max_results), 20)),
            "search_depth": "advanced",
            "include_answer": False,
            "include_raw_content": False,
        }
        if recency_days:
            payload["days"] = int(recency_days)
            payload["topic"] = "news"
        if domains:
            payload["include_domains"] = list(domains)

        async with httpx.AsyncClient(timeout=15.0) as client:
            resp = await client.post(self.ENDPOINT, json=payload,
                                     headers={"User-Agent": _UA})
            resp.raise_for_status()
            data = resp.json()

        return [
            SearchResult(
                title=str(r.get("title") or ""),
                url=str(r.get("url") or ""),
                snippet=str(r.get("content") or ""),
                published_at=str(r.get("published_date") or ""),
                relevance_score=float(r.get("score") or 0.0),
                provider=self.name,
            )
            for r in (data.get("results") or [])
            if r.get("url")
        ]


class GDELTSearchProvider(WebSearchProvider):
    """
    GDELT Doc 2.0 — free, keyless, news-only.

    The fallback that makes web research work with no paid provider at all. It
    reuses the existing `GDELTClient` (which already throttles to one request
    per 3s) rather than opening a second path to the same API.

    Its results are news articles with real URLs, which is exactly what the
    fetch-then-extract path needs. What it must never do is have its *snippet*
    used as evidence — the pre-existing `gdelt` retrieval channel does that, and
    this provider exists partly to give important claims a route that does not.
    """

    name = "gdelt"

    def __init__(self, client=None):
        self._client = client

    def available(self) -> bool:
        return True  # keyless

    async def _get_client(self):
        if self._client is None:
            from app.ingestion.sources.gdelt import GDELTClient

            self._client = GDELTClient()
        return self._client

    async def search(self, query, *, max_results=8, recency_days=None,
                     domains=None) -> list[SearchResult]:
        client = await self._get_client()
        hours = int((recency_days or 30) * 24)
        articles = await client.search_articles(
            query=query,
            max_records=max(1, min(int(max_results), 50)),
            timespan_hours=min(hours, 24 * 365),
            sort="Relevance" if not recency_days else "DateDesc",
        )
        out = []
        for a in articles:
            url = str(a.get("url") or "")
            if not url:
                continue
            if domains and registrable_domain(url) not in set(domains):
                continue
            out.append(SearchResult(
                title=str(a.get("title") or ""),
                url=url,
                snippet=str(a.get("snippet") or ""),
                published_at=str(a.get("seendate") or ""),
                domain=str(a.get("domain") or ""),
                relevance_score=float(a.get("score") or 0.5),
                provider=self.name,
            ))
        return out


# ── Fetch adapters ────────────────────────────────────────────────────────

def _html_to_text(html: str) -> str:
    """
    Readable text out of an HTML document.

    Deliberately dependency-free: `<script>` and `<style>` bodies are removed
    (they are code, not prose, and a script body is the most likely place for an
    injection payload to hide from a human skimming the page), tags are
    stripped, entities are unescaped, whitespace is collapsed.

    Not a readability implementation. It over-collects nav and footer text,
    which costs relevance and never costs correctness — and the extraction step
    downstream selects passages by query relevance anyway, so boilerplate that
    matches nothing is dropped there.
    """
    import html as html_mod
    import re

    text = re.sub(r"(?is)<(script|style|noscript|svg|template)\b.*?</\1\s*>", " ", html or "")
    text = re.sub(r"(?is)<!--.*?-->", " ", text)
    # Block-level tags become newlines so paragraph structure survives, which is
    # what makes passage selection able to return a coherent quote.
    text = re.sub(r"(?i)<(?:br|/p|/div|/li|/h[1-6]|/tr|/section|/article)\s*/?>",
                  "\n", text)
    text = re.sub(r"(?s)<[^>]+>", " ", text)
    text = html_mod.unescape(text)
    text = re.sub(r"[ \t\r\f ]+", " ", text)
    return re.sub(r"\n\s*\n\s*", "\n\n", text).strip()


def _title_from_html(html: str) -> str:
    import html as html_mod
    import re

    m = re.search(r"(?is)<title[^>]*>(.*?)</title>", html or "")
    if not m:
        m = re.search(r'(?is)<meta[^>]+property=["\']og:title["\'][^>]+content=["\'](.*?)["\']',
                      html or "")
    return html_mod.unescape(re.sub(r"\s+", " ", m.group(1))).strip()[:300] if m else ""


def _published_from_html(html: str) -> str:
    """The publication date a page declares about itself, if any."""
    import re

    for pattern in (
        r'(?is)<meta[^>]+property=["\']article:published_time["\'][^>]+content=["\'](.*?)["\']',
        r'(?is)<meta[^>]+name=["\'](?:pubdate|publishdate|date|dc\.date)["\'][^>]+content=["\'](.*?)["\']',
        r'(?is)<time[^>]+datetime=["\'](.*?)["\']',
        r'(?is)"datePublished"\s*:\s*"(.*?)"',
    ):
        m = re.search(pattern, html or "")
        if m and m.group(1).strip():
            return m.group(1).strip()[:64]
    return ""


class HttpFetchProvider(WebFetchProvider):
    """
    Direct HTTPS fetch with the SSRF guard applied to every redirect hop.

    `follow_redirects=False` is the load-bearing detail. httpx's automatic
    redirect following would take a guard-approved URL to a guard-rejected one
    without ever consulting the guard again, which is the standard way an SSRF
    filter is bypassed. Each hop is checked before it is taken.
    """

    name = "http"
    MAX_REDIRECTS = 4

    def available(self) -> bool:
        return True

    async def fetch(self, url: str, *, timeout_s: float = 12.0) -> WebDocument | None:
        import httpx

        current = str(url or "")
        try:
            for hop in range(self.MAX_REDIRECTS + 1):
                check_url(current).raise_if_blocked()
                async with httpx.AsyncClient(
                    timeout=timeout_s, follow_redirects=False,
                ) as client:
                    async with client.stream(
                        "GET", current,
                        headers={"User-Agent": _UA,
                                 "Accept": "text/html,application/xhtml+xml,"
                                           "text/plain;q=0.9,*/*;q=0.5"},
                    ) as resp:
                        if resp.is_redirect:
                            location = resp.headers.get("location", "")
                            if not location:
                                return None
                            current = str(httpx.URL(current).join(location))
                            continue
                        if resp.status_code != 200:
                            logger.debug("web_fetch_status", url=current[:200],
                                         status=resp.status_code)
                            return None

                        ctype = resp.headers.get("content-type", "").lower()
                        if not any(t in ctype for t in
                                   ("text/html", "text/plain", "application/xhtml",
                                    "application/json", "text/xml", "application/xml")):
                            logger.debug("web_fetch_skipped_type", url=current[:200],
                                         content_type=ctype)
                            return None

                        buf = bytearray()
                        async for chunk in resp.aiter_bytes(chunk_size=65536):
                            buf.extend(chunk)
                            if len(buf) > MAX_PAGE_BYTES:
                                logger.warning("web_fetch_too_large",
                                               url=current[:200], cap=MAX_PAGE_BYTES)
                                return None

                        raw = bytes(buf).decode(
                            resp.encoding or "utf-8", errors="replace")
                        is_html = "html" in ctype or raw.lstrip()[:1] == "<"
                        return WebDocument(
                            url=url,
                            final_url=current,
                            title=_title_from_html(raw) if is_html else "",
                            text=_html_to_text(raw) if is_html else raw,
                            published_at=_published_from_html(raw) if is_html else "",
                            content_type=ctype,
                            status_code=resp.status_code,
                            provider=self.name,
                        )
            logger.debug("web_fetch_redirect_limit", url=url[:200])
            return None
        except UnsafeURLError as e:
            # Not an error condition — the guard doing its job. Raised so the
            # caller can count it as blocked rather than as failed.
            raise
        except Exception as e:
            logger.debug("web_fetch_failed", url=str(url)[:200], error=str(e)[:200])
            return None


class FirecrawlFetchProvider(WebFetchProvider):
    """
    Firecrawl — renders JavaScript, returns markdown.

    Used where the direct fetch returns a shell (single-page apps, sites behind
    a JS paywall gate). Still guarded: Firecrawl fetches server-side on our
    behalf, so a URL we would refuse to fetch ourselves is one we must not ask
    Firecrawl to fetch either.
    """

    name = "firecrawl"
    ENDPOINT = "https://api.firecrawl.dev/v1/scrape"

    def __init__(self, api_key: str | None = None):
        self._key = api_key or os.getenv("FIRECRAWL_API_KEY", "")

    def available(self) -> bool:
        return bool(self._key)

    async def fetch(self, url: str, *, timeout_s: float = 12.0) -> WebDocument | None:
        import httpx

        check_url(url).raise_if_blocked()
        try:
            async with httpx.AsyncClient(timeout=timeout_s + 10.0) as client:
                resp = await client.post(
                    self.ENDPOINT,
                    headers={"Authorization": f"Bearer {self._key}",
                             "Content-Type": "application/json",
                             "User-Agent": _UA},
                    json={"url": url, "formats": ["markdown"],
                          "onlyMainContent": True,
                          "timeout": int(timeout_s * 1000)},
                )
                if resp.status_code != 200:
                    logger.debug("firecrawl_status", url=url[:200],
                                 status=resp.status_code)
                    return None
                body = resp.json()
        except Exception as e:
            logger.debug("firecrawl_failed", url=str(url)[:200], error=str(e)[:200])
            return None

        data = body.get("data") or {}
        text = str(data.get("markdown") or data.get("content") or "")
        if not text.strip():
            return None
        meta = data.get("metadata") or {}
        return WebDocument(
            url=url,
            final_url=str(meta.get("sourceURL") or url),
            title=str(meta.get("title") or ""),
            text=text,
            published_at=str(meta.get("publishedTime")
                             or meta.get("modifiedTime") or ""),
            content_type="text/markdown",
            status_code=200,
            provider=self.name,
        )


# ── Registry ──────────────────────────────────────────────────────────────

@dataclass
class ProviderSet:
    """The providers this deployment actually has, in preference order."""

    search: list[WebSearchProvider] = field(default_factory=list)
    fetch: list[WebFetchProvider] = field(default_factory=list)

    @property
    def has_search(self) -> bool:
        return any(p.available() for p in self.search)

    @property
    def has_fetch(self) -> bool:
        return any(p.available() for p in self.fetch)

    def describe(self) -> str:
        s = ",".join(p.name for p in self.search if p.available()) or "none"
        f = ",".join(p.name for p in self.fetch if p.available()) or "none"
        return f"search={s} fetch={f}"


def default_providers() -> ProviderSet:
    """
    What this deployment can do, decided from configuration alone.

    Preference order is deliberate: Tavily first because a purpose-built search
    index beats a news archive for non-news questions, GDELT always present
    because it needs no key and is therefore the thing that keeps web research
    working when every paid key is dead. Direct HTTP before Firecrawl because it
    is free and usually sufficient; Firecrawl is the escalation for pages that
    return a JavaScript shell.
    """
    search: list[WebSearchProvider] = []
    tavily = TavilySearchProvider()
    if tavily.available():
        search.append(tavily)
    search.append(GDELTSearchProvider())

    fetch: list[WebFetchProvider] = [HttpFetchProvider()]
    firecrawl = FirecrawlFetchProvider()
    if firecrawl.available():
        fetch.append(firecrawl)

    return ProviderSet(search=search, fetch=fetch)
