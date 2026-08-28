"""
Gravity Search — SEC EDGAR live filing-TEXT channel.

`edgar_search` made NUMBERS universal: any registrant's XBRL facts are fetched
at query time, so a company the corpus never ingested still gets an exact,
citable figure. Prose stayed local, and the local corpus covers 39 tickers — so
"what risks does AMD disclose" was answerable for a handful of companies and
abstained for every other registrant. The abstention was honest; the coverage
was the bug.

This channel closes that half on the same terms as its numeric sibling: any
ticker → CIK → the latest 10-K/10-Q → Item sections → passages carrying the
accession, so `citation_provenance` resolves the exact filing for a paragraph
exactly as it already does for a figure.

Nothing is indexed. Sections are parsed by the same `SectionDetector` the
ingestion pipeline uses, so an Item boundary means the same thing whether the
filing was ingested last month or fetched a second ago.
"""

import asyncio
import re
import time

import structlog

from app.core.retrieval.citation_provenance import valid_accession
from app.core.retrieval.edgar_search import _SEC_SEMAPHORE, extract_tickers
from app.core.retrieval.fusion import RetrievalResult
from app.ingestion.processing.section_detector import SectionDetector
from app.ingestion.sources.sec_quarterly import filing_url

logger = structlog.get_logger()

SUBMISSIONS_URL = "https://data.sec.gov/submissions/CIK{cik:010d}.json"
ARCHIVE_DOC_URL = "https://www.sec.gov/Archives/edgar/data/{cik}/{nodash}/{doc}"

# A 10-K's primary document runs 5-15 MB of iXBRL-laden HTML. The cap is a
# memory bound, not a correctness one: the Items this channel serves sit well
# inside it, and a filing large enough to be truncated still yields its
# early sections.
MAX_DOC_BYTES = 12_000_000
DOC_TIMEOUT_S = 20.0
WINDOW_CHARS = 1400
MIN_SECTION_CHARS = 400
# One parse of a 10-K costs seconds. The filing itself never changes — an
# accession is immutable — so the TTL only bounds how long a superseded filing
# can stay resident, not how stale a passage can be.
CACHE_TTL_S = 6 * 3600
MAX_CACHED_FILINGS = 24

_ANNUAL_FORMS = ("10-K", "10-K/A", "20-F", "40-F")
_QUARTERLY_FORMS = ("10-Q", "10-Q/A")

# `SectionDetector` names items from the 10-K schedule, because that is what
# ingestion fed it. A 10-Q reuses the same item numbers for entirely different
# content — Item 2 is MD&A, not Properties — so quarterly prose was being cited
# under the annual report's name for that slot.
#
# The 10-Q's own Part I / Part II collision (Item 1 is Financial Statements in
# Part I and Legal Proceedings in Part II) is not resolved here: the detector
# does not track parts. Part I wins because it is the larger section by an order
# of magnitude, and `MIN_SECTION_CHARS` drops the short Part II remnant.
_QUARTERLY_ITEM_NAMES = {
    "item_1": "Financial Statements",
    "item_2": "Management's Discussion and Analysis",
    "item_3": "Quantitative and Qualitative Disclosures About Market Risk",
    "item_4": "Controls and Procedures",
}

_QUARTERLY_INTENT = re.compile(r"\b10-?Q\b|\bquarter(?:ly)?\b|\bQ[1-4]\b", re.I)

# Query intent → the canonical `item_id`s `SectionDetector` assigns, per form.
#
# The two schedules reuse the same numbers for different content, so the pair
# has to be kept apart rather than merged. Boosting the union instead sent "what
# legal proceedings does it disclose" to Item 1 — Legal Proceedings in a 10-Q's
# Part II, but Business in the 10-K actually being read, and by far the larger
# section. Every question below is annual unless the reader asked for a quarter.
#
#                                      annual (10-K)   quarterly (10-Q)
_ITEM_INTENT: list[tuple[re.Pattern, tuple[str, ...], tuple[str, ...]]] = [
    (re.compile(r"risk|headwind|threat|uncertaint|exposure", re.I),
     ("item_1a",), ("item_1a",)),
    (re.compile(r"md&a|management.s discussion|liquidity|results of operation|"
                r"cash flow|margin|growth driver|outlook|guidance", re.I),
     ("item_7",), ("item_2",)),
    (re.compile(r"legal|litigat|lawsuit|proceeding|settlement", re.I),
     ("item_3",), ("item_1",)),
    (re.compile(r"internal control|material weakness|disclosure control", re.I),
     ("item_9a",), ("item_4",)),
    (re.compile(r"propert|facilit|headquarter", re.I), ("item_2",), ()),
    (re.compile(r"compensation|executive pay|say on pay", re.I), ("item_11",), ()),
    (re.compile(r"business|product|segment|competit|strategy|customer|"
                r"supplier|employee|workforce", re.I), ("item_1",), ()),
]

# Words that match every filing and so rank nothing.
_STOP = frozenset(
    "the and for are was were with that this from what which how why who when "
    "does did has have had its their our your they them then than about into "
    "over under more most any all can could would should will shall may might "
    "company companies inc corp report filing filings year years quarter "
    "please tell give show list explain describe".split()
)


def _to_text(raw: bytes) -> str:
    """Filing HTML → readable text, tables flattened rather than dropped.

    Bytes, not `str`: SEC serves iXBRL documents without a charset header, so
    decoding on the HTTP layer picked Latin-1 and turned every curly quote and
    em dash in the filing into a replacement character. BeautifulSoup sniffs the
    document's own declared encoding instead.
    """
    import warnings

    from bs4 import BeautifulSoup, XMLParsedAsHTMLWarning

    with warnings.catch_warnings():
        # iXBRL documents open with an XML declaration. The HTML parser is the
        # right one anyway — the payload is XHTML and we want its text.
        warnings.simplefilter("ignore", XMLParsedAsHTMLWarning)
        try:
            soup = BeautifulSoup(raw, "lxml")
        except Exception:
            soup = BeautifulSoup(raw, "html.parser")
    for el in soup(["script", "style"]):
        el.decompose()
    text = soup.get_text("\n")
    text = re.sub(r"[ \t\xa0  ]+", " ", text)
    return re.sub(r"\n{3,}", "\n\n", text).strip()


def _windows(text: str) -> list[str]:
    """Paragraph-aligned passages. Item 1A alone runs tens of thousands of
    words; a section is a location, not a citable quote."""
    out: list[str] = []
    buf = ""
    for para in text.split("\n"):
        para = para.strip()
        if not para:
            continue
        if buf and len(buf) + len(para) + 1 > WINDOW_CHARS:
            out.append(buf)
            buf = para
        else:
            buf = f"{buf}\n{para}" if buf else para
    if buf:
        out.append(buf)
    return out


def _terms(query: str) -> set[str]:
    return {
        w for w in re.findall(r"[a-z0-9&]{3,}", (query or "").lower())
        if w not in _STOP
    }


def _phrases(query: str) -> list[str]:
    """Adjacent content-word pairs, in the order the question said them.

    Coverage scoring is binary, so a paragraph mentioning water in one clause
    and scarcity in another ties with the paragraph actually about water
    scarcity, and the tie breaks on document order. Adjacency is what separates
    them. Pairs are built from raw adjacency, so "competition and water" does
    not become the phrase "competition water".
    """
    words = re.findall(r"[a-z0-9&]+", (query or "").lower())
    return [
        f"{a} {b}"
        for a, b in zip(words, words[1:])
        if len(a) >= 3 and len(b) >= 3 and a not in _STOP and b not in _STOP
    ]


# Coverage + phrase + density + the Item boost. Scores are divided by this so a
# passage's `score` stays a 0-1 fraction instead of being clipped at the top,
# which would flatten exactly the distinctions the phrase term adds.
_MAX_SCORE = 1.0 + 0.25 + 0.10 + 0.35


def _wanted_items(query: str, quarterly: bool = False) -> set[str]:
    out: set[str] = set()
    for pattern, annual, quarter in _ITEM_INTENT:
        if pattern.search(query or ""):
            out.update(quarter if quarterly else annual)
    return out


def _forms_for(query: str) -> tuple[str, ...]:
    """The quarterly report when the question asks for one, else the annual."""
    return _QUARTERLY_FORMS if _QUARTERLY_INTENT.search(query or "") else _ANNUAL_FORMS


class EdgarTextSearch:
    """Live SEC filing prose as a retrieval channel."""

    def __init__(self, edgar_search):
        # Composed rather than subclassed: the SEC ticker map, the user agent,
        # the shared HTTP client and the request counter all already live in
        # `EdgarSearch`, and a second copy of the ticker file is a second cache
        # to go stale.
        self._edgar = edgar_search
        self._detector = SectionDetector()
        self._cache: dict[tuple[int, str], tuple[float, list]] = {}

    async def _get_doc(self, url: str) -> bytes:
        async with _SEC_SEMAPHORE:
            client = await self._edgar._client()
            # `EdgarSearch`'s client is configured for small JSON responses. A
            # filing's primary document is megabytes, and the shared 10s budget
            # was aborting the download of the larger ones mid-read — which
            # surfaced as a company with no qualitative coverage at all, only
            # intermittently.
            r = await client.get(url, timeout=DOC_TIMEOUT_S)
        if r.status_code == 404:
            return b""
        r.raise_for_status()
        return r.content[:MAX_DOC_BYTES]

    async def _latest_filing(self, cik: int, forms: tuple[str, ...]) -> dict | None:
        """The newest filing of the most preferred form in `forms`.

        `forms` is a PREFERENCE ORDER, not a set, and the whole index is scanned
        for each in turn. Matching any of them and taking the newest reads the
        amendment whenever one exists: AMD filed a 10-K/A on the same day as its
        FY2025 10-K, and a 10-K/A is usually a narrow re-filing — no Item 1A, no
        MD&A — so a risk-factors question came back with exhibit boilerplate from
        a document that does not contain the answer.

        `filings.recent` is newest-first, so within a form the first match wins.
        """
        data = await self._edgar._get_json(SUBMISSIONS_URL.format(cik=cik))
        recent = ((data or {}).get("filings") or {}).get("recent") or {}
        rows = list(zip(
            recent.get("form") or [],
            recent.get("accessionNumber") or [],
            recent.get("primaryDocument") or [],
            recent.get("filingDate") or [],
            recent.get("reportDate") or [],
        ))
        for wanted in forms:
            for form, accn, doc, filed, report in rows:
                # An accession that is not shaped like one is never interpolated
                # into an archive path — the same rule the XBRL channel applies.
                if form != wanted or not doc or not valid_accession(accn):
                    continue
                return {
                    "form": form,
                    "accn": accn,
                    "filed": filed or "",
                    "report": report or "",
                    "document_url": ARCHIVE_DOC_URL.format(
                        cik=int(cik), nodash=accn.replace("-", ""), doc=doc
                    ),
                }
        return None

    async def _sections(self, cik: int, filing: dict) -> list:
        key = (cik, filing["accn"])
        hit = self._cache.get(key)
        if hit and (time.time() - hit[0]) < CACHE_TTL_S:
            return hit[1]

        raw = await self._get_doc(filing["document_url"])
        if not raw:
            return []
        detected = self._detector.detect_sections(_to_text(raw), filing["form"])
        # A filing's table of contents parses as sections too — the same item
        # ids, one line of text each — so a plain length filter was the only
        # thing keeping them out, and it took real content with it: Cheesecake
        # Factory's Item 3 is 158 characters and is still the entire answer to a
        # question about its legal proceedings. Keeping the longest section per
        # item id drops the contents listing without dropping a terse Item.
        best: dict = {}
        unnamed: list = []
        for s in detected:
            if not s.item_id:
                if len(s.text) >= MIN_SECTION_CHARS:
                    unnamed.append(s)
                continue
            prev = best.get(s.item_id)
            if prev is None or len(s.text) > len(prev.text):
                best[s.item_id] = s
        sections = list(best.values()) + unnamed
        if filing["form"].startswith("10-Q"):
            for s in sections:
                s.name = _QUARTERLY_ITEM_NAMES.get(s.item_id, s.name)
        if len(self._cache) >= MAX_CACHED_FILINGS:
            self._cache.pop(next(iter(self._cache)))
        self._cache[key] = (time.time(), sections)
        return sections

    async def search(
        self,
        query: str,
        filters: dict | None = None,
        entities: dict | None = None,
        top_k: int = 8,
    ) -> list[RetrievalResult]:
        try:
            tickers = extract_tickers(query, entities, filters)
            if not tickers:
                tickers = await self._edgar.tickers_from_names(query)
            if not tickers:
                # EDGAR is company-scoped; without one there is nothing to read.
                return []
            terms = _terms(query)
            if not terms:
                return []

            phrases = _phrases(query)
            forms = _forms_for(query)
            wanted = _wanted_items(query, quarterly=forms is _QUARTERLY_FORMS)
            # Two tickers, not five: each one costs an index fetch plus a
            # multi-megabyte document parse, where the XBRL channel costs a
            # small JSON response.
            chosen = tickers[:2]
            per_ticker = max(2, top_k // len(chosen))
            batches = await asyncio.gather(
                *[
                    self._for_ticker(t, forms, wanted, terms, phrases, per_ticker)
                    for t in chosen
                ],
                return_exceptions=True,
            )

            out: list[RetrievalResult] = []
            for b in batches:
                if isinstance(b, Exception):
                    logger.warning("edgar_text_ticker_failed", error=str(b)[:160])
                    continue
                out.extend(b)
            out.sort(key=lambda r: -r.score)
            logger.info(
                "edgar_text_search",
                results=len(out), tickers=chosen, forms=forms[0],
                wanted_items=sorted(wanted),
            )
            return out[:top_k]
        except Exception as e:
            logger.error("edgar_text_search_failed", error=str(e)[:200])
            return []

    async def _for_ticker(
        self,
        ticker: str,
        forms: tuple[str, ...],
        wanted: set[str],
        terms: set[str],
        phrases: list[str],
        limit: int,
    ) -> list[RetrievalResult]:
        cik = await self._edgar.ticker_to_cik(ticker)
        if cik is None:
            logger.info("edgar_text_unknown_ticker", ticker=ticker)
            return []
        filing = await self._latest_filing(cik, forms)
        if filing is None:
            return []
        sections = await self._sections(cik, filing)
        if not sections:
            return []

        prepared = [
            (section, window, window.lower())
            for section in sections
            for window in _windows(section.text)
        ]
        if not prepared:
            return []

        # Weight each query term by how rare it is INSIDE THIS FILING. Asking
        # what Coca-Cola discloses about water scarcity carries "coca", "cola"
        # and "risk", and all three appear on nearly every page of Coca-Cola's
        # 10-K; counting them equally with "scarcity" ranked the filing's most
        # generic paragraphs first, which is exactly what it did.
        n = len(prepared)
        weights = {
            t: 1.0 - (df / n)
            for t, df in ((t, sum(1 for _, _, low in prepared if t in low)) for t in terms)
            if df
        }
        total = sum(weights.values())
        if total <= 0:
            return []

        scored: list[tuple[float, object, str]] = []
        for section, window, low in prepared:
            # The Item the question is about outranks a passing mention of the
            # same words elsewhere in the filing: "risk" appears in the MD&A of
            # every 10-K ever filed, and Item 1A is still the answer.
            boost = 0.35 if wanted and section.item_id in wanted else 0.0
            hit = sum(w for t, w in weights.items() if t in low) / total
            if hit <= 0 and not boost:
                continue
            phrase = (
                sum(1 for p in phrases if p in low) / len(phrases) if phrases else 0.0
            )
            # Saturating, because a passage is not ten times more relevant for
            # repeating the term ten times — it is just on topic.
            density = min(sum(low.count(t) for t in weights) / 12.0, 1.0)
            scored.append((hit + 0.25 * phrase + 0.10 * density + boost, section, window))

        scored.sort(key=lambda x: -x[0])
        issuer = self._edgar._issuer_by_ticker.get(ticker.upper(), "")
        return [
            self._to_result(ticker, cik, issuer, filing, section, window, score, i)
            for i, (score, section, window) in enumerate(scored[:limit])
        ]

    def _to_result(
        self, ticker: str, cik: int, issuer: str, filing: dict,
        section, window: str, score: float, rank: int,
    ) -> RetrievalResult:
        accn = filing["accn"]
        period = filing["report"] or filing["filed"]
        return RetrievalResult(
            chunk_id=f"edgar_text:{ticker}:{accn}:{section.item_id or 'sec'}:{rank}",
            document_id=f"edgar_text:{ticker}:{accn}",
            text=window,
            score=round(min(score / _MAX_SCORE, 1.0), 4),
            document_title=f"{ticker} {filing['form']} — {period}",
            section=section.name,
            filing_date=filing["filed"],
            ticker=ticker,
            document_type=filing["form"],
            source_quality=10,  # sec.gov authority tier, set explicitly
            metadata={
                # The accession is what `citation_provenance` discriminates on:
                # with it a paragraph carries the same evidence object a figure
                # does, and a source click opens the filing it was read from.
                "accn": accn,
                "cik": cik,
                "issuer": issuer,
                "form": filing["form"],
                "filed": filing["filed"],
                "period_end": filing["report"],
                "item_id": section.item_id,
                "section": section.name,
                "filing_url": filing_url(cik, accn),
                "document_url": filing["document_url"],
                "source_url": filing["document_url"],
                "extraction_method": "sec_filing_text",
            },
        )
