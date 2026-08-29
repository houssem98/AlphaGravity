"""
Gravity Search — SEC EDGAR live XBRL channel.

Every other numeric channel answers from whatever ingestion happened to land.
This one calls EDGAR at query time, so a company the corpus never covered still
gets an exact, citable figure. Nothing is indexed; the facts are fetched, shaped
into passages and handed to fusion like any other channel.

Facts carry the `[EXACT FILING FIGURE]` prefix that `search_pipeline` keys its
priority pinning and `has_exact_fact` anchoring off, so an EDGAR number reaches
the LLM as ground truth rather than as one more retrieved opinion.

Period arithmetic (fiscal-year assignment, quarter derivation) is NOT
reimplemented here — it lives in `app.ingestion.sources.sec_quarterly`, where it
is tested against Apple's filed quarters.
"""

import asyncio
import re
import time
from datetime import date

import structlog

from app.core.retrieval import (
    fact_persistence,
    sec_authority,
    sec_filing_resolver,
    sec_telemetry,
)
from app.core.retrieval.citation_provenance import valid_accession
from app.core.retrieval.fact_verification import VERIFIED, verify_fact
from app.core.retrieval.fusion import RetrievalResult
from app.core.retrieval.sec_dimensions import resolve_dimensional_fact
from app.ingestion.sources.sec_quarterly import (
    ANNUAL_MAX_DAYS,
    ANNUAL_MIN_DAYS,
    extract_quarterly_facts,
    fiscal_year_end_month,
    filing_url,
)

logger = structlog.get_logger()

TICKER_MAP_URL = "https://www.sec.gov/files/company_tickers.json"
CONCEPT_URL = (
    "https://data.sec.gov/api/xbrl/companyconcept/CIK{cik:010d}/us-gaap/{tag}.json"
)
TICKER_MAP_TTL_S = 24 * 3600

# SEC asks for <=10 requests/second. One semaphore for the process is enough:
# this channel issues at most a handful of calls per query.
_SEC_SEMAPHORE = asyncio.Semaphore(8)

# Keyword -> us-gaap tag, in the keyword-table style mcp_retrieval uses. Order
# matters: the first entry whose keyword appears in the query wins, so the more
# specific phrases sit above the ones they contain ("gross profit" before
# "profit", "cost of revenue" before "revenue").
_METRIC_TAGS: list[tuple[tuple[str, ...], str, str]] = [
    (("gross profit", "gross margin"), "GrossProfit", "gross profit"),
    (
        ("cost of revenue", "cost of goods", "cogs"),
        "CostOfGoodsAndServicesSold",
        "cost of revenue",
    ),
    (("operating income", "operating profit"), "OperatingIncomeLoss", "operating income"),
    (
        ("net income", "net profit", "net earnings", "bottom line"),
        "NetIncomeLoss",
        "net income",
    ),
    (("eps", "earnings per share"), "EarningsPerShareDiluted", "diluted EPS"),
    (
        ("research and development", "r&d"),
        "ResearchAndDevelopmentExpense",
        "R&D expense",
    ),
    (("total assets", "assets"), "Assets", "total assets"),
    (("total liabilities", "liabilities"), "Liabilities", "total liabilities"),
    (
        ("shareholders equity", "stockholders equity", "book value"),
        "StockholdersEquity",
        "shareholders equity",
    ),
    (("inventory", "inventories"), "InventoryNet", "inventory"),
    (
        ("cash and cash equivalents", "cash balance", "cash"),
        "CashAndCashEquivalentsAtCarryingValue",
        "cash and cash equivalents",
    ),
    (
        ("revenue", "sales", "top line"),
        "RevenueFromContractWithCustomerExcludingAssessedTax",
        "revenue",
    ),
]

# Tried in order when the primary tag yields nothing — pre-ASC606 filers report
# `Revenues`, and some report cost of sales under the older tag.
_TAG_FALLBACKS: dict[str, list[str]] = {
    "RevenueFromContractWithCustomerExcludingAssessedTax": ["Revenues", "SalesRevenueNet"],
    "CostOfGoodsAndServicesSold": ["CostOfRevenue"],
    "EarningsPerShareDiluted": ["EarningsPerShareBasic"],
}

_QUARTER_INTENT = re.compile(r"\bquarter(?:ly|s)?\b|\bq[1-4]\b", re.I)
_QUARTER_NUMBER = re.compile(r"\bq([1-4])\b|\b([1-4])(?:st|nd|rd|th)\s+quarter\b", re.I)
# "FY2026" / "FY 2026" / "fiscal 2026" name a FISCAL year; a bare year does not,
# so the two are kept apart — for a filer whose year ends in January they point
# at different periods.
_FISCAL_YEAR = re.compile(r"\bfy\s*((?:19|20)\d{2})\b|\bfiscal(?:\s+year)?\s+((?:19|20)\d{2})\b", re.I)

# Words that never identify a breakdown, stripped before asking whether the query
# named one. Metric labels and company/period tokens are removed separately.
_PERIOD_TOKEN = re.compile(r"q[1-4]|fy(?:19|20)?\d{0,4}|h[12]", re.I)

# Bumped whenever extraction changes shape, so a persisted fact records which
# code produced it.
PARSER_VERSION = "sec-dim-1"

_RESIDUAL_STOPWORDS: frozenset[str] = frozenset("""
a an the of for in on at to is was were are be been what how much many did do does
and or vs versus report reported reports total s us their its it from by with
company companies fiscal year quarter quarterly annual full latest most recent
figure figures number numbers amount value results result during ended ending
""".split())

_COMMON_NON_TICKERS = {
    "I", "A", "AN", "THE", "AND", "OR", "FOR", "IN", "OF", "TO", "IS", "IT", "AT",
    "ON", "BY", "AS", "IF", "DO", "VS", "EPS", "LTM", "YOY", "DCF", "LBO", "MCP",
    "SEC", "IPO", "CEO", "CFO", "COO", "CTO", "ETF", "Q1", "Q2", "Q3", "Q4", "FY",
    "PE", "PS", "PB", "EV", "GDP", "CPI", "USD", "XBRL", "GAAP",
}


def concept_family(tag: str) -> list[str]:
    """
    Every us-gaap tag that can carry this metric — the primary plus its fallbacks.

    A filer reports one of them, not all: NVIDIA and Wingstop both answer under
    `Revenues` while the primary tag is `RevenueFromContract...`. Anything that
    compares a stored fact's concept against a single tag name has to compare
    against the family instead, or it will never match the rows this channel
    actually wrote.
    """
    return [tag] + _TAG_FALLBACKS.get(tag, [])


def classify_metric(query: str) -> tuple[str, str]:
    """
    (us-gaap tag, human name). Revenue is the default — it is what an unqualified
    "how did X do" question almost always means.
    """
    ql = (query or "").lower()
    for keywords, tag, label in _METRIC_TAGS:
        if any(kw in ql for kw in keywords):
            return tag, label
    return "RevenueFromContractWithCustomerExcludingAssessedTax", "revenue"


def extract_tickers(
    query: str, entities: dict | None = None, filters: dict | None = None
) -> list[str]:
    """
    Tickers from entities/filters, else uppercase tokens from the query.

    Both shapes appear in this codebase: `filters["companies"]` holds the RESOLVED
    ticker (the orchestrator notes entities often lacks it), and entries may be
    plain strings or dicts carrying a "ticker" key.
    """
    out: list[str] = []
    for src in (filters or {}, entities or {}):
        for key in ("companies", "tickers"):
            for item in src.get(key) or []:
                t = item.get("ticker") if isinstance(item, dict) else item
                if isinstance(t, str) and t.strip():
                    out.append(t.strip().upper())
    if not out:
        out = [
            c
            for c in re.findall(r"\b[A-Z]{1,5}\b", query or "")
            if c not in _COMMON_NON_TICKERS and len(c) >= 2
        ]
    seen: set[str] = set()
    return [t for t in out if not (t in seen or seen.add(t))][:5]


def _d(s: str) -> date:
    return date.fromisoformat(s[:10])


# Legal-form noise that carries no identity — "NVIDIA Corp" and "NVIDIA" are the
# same company, and a question uses the short form.
_CORP_SUFFIXES = frozenset(
    "inc incorporated corp corporation co company plc ltd limited lp llc "
    "holdings holding group sa nv ag the class common stock".split()
)


def _norm_name(s: str) -> str:
    """Lowercase, punctuation-free company name for matching."""
    return re.sub(r"[^a-z0-9]+", " ", (s or "").lower()).strip()


def _covers_years(units: dict, years: list[int]) -> bool:
    """
    True when the concept reports anything in the fiscal years asked about.

    A fiscal year can end in the previous calendar year — NVDA's FY2026 ends
    2026-01-25 while its Q3 ends 2025-10-26 — so the calendar years either side
    of each requested year both count.
    """
    wanted: set[int] = set()
    for y in years:
        wanted.update((y - 1, y, y + 1))
    for points in units.values():
        for p in points:
            end = p.get("end") or ""
            if len(end) >= 4 and end[:4].isdigit() and int(end[:4]) in wanted:
                return True
    return False


def _all_points(units: dict) -> list[dict]:
    """
    Every duration point in `sec_quarterly`'s shape, so the issuer's fiscal
    year-end month can be measured from its own annual spans rather than assumed
    to be December.
    """
    out: list[dict] = []
    for points in units.values():
        for p in points:
            start, end = p.get("start"), p.get("end")
            if not start or not end:
                continue
            try:
                d0, d1 = _d(start), _d(end)
            except ValueError:
                continue
            out.append({"start": d0, "end": d1, "days": (d1 - d0).days})
    return out


def parse_quarter(query: str) -> int | None:
    """The quarter a question names, if it names one."""
    m = _QUARTER_NUMBER.search(query or "")
    if not m:
        return None
    return int(m.group(1) or m.group(2))


def parse_fiscal_years(query: str) -> list[int]:
    """
    Years the question names, fiscal ones first.

    "FY2026" and a bare "2026" are not interchangeable for a January filer, so
    an explicit fiscal marker takes precedence when both appear.
    """
    fiscal = [int(a or b) for a, b in _FISCAL_YEAR.findall(query or "")]
    if fiscal:
        return sorted(set(fiscal))
    return sorted({int(y) for y in re.findall(r"(?:19|20)\d{2}", query or "")})


class EdgarSearch:
    """Live SEC XBRL facts as a retrieval channel."""

    def __init__(self, http_client=None):
        from app.config import settings

        self._ua = settings.sec_user_agent
        self._http = http_client
        self._ticker_map: dict[str, int] = {}
        self._title_map: dict[str, str] = {}   # normalized company name -> ticker
        # SEC's own registrant name per ticker. A citation has to name the
        # issuer, and the same download already carries it.
        self._issuer_by_ticker: dict[str, str] = {}
        self._ticker_map_at: float = 0.0

    async def _client(self):
        if self._http is None:
            import httpx

            self._http = httpx.AsyncClient(
                headers={"User-Agent": self._ua}, timeout=10.0
            )
        # Every SEC request leaves through here, including the ones
        # `sec_dimensions` issues on the raw client it is handed. Counting at
        # this one point is what makes "a verified local hit asks the filer for
        # nothing" an instrumented invariant rather than a claim.
        return sec_telemetry.CountingClient(self._http)

    async def _get_json(self, url: str) -> dict | None:
        async with _SEC_SEMAPHORE:
            c = await self._client()
            r = await c.get(url)
        if r.status_code == 404:  # concept not reported by this filer
            return None
        r.raise_for_status()
        return r.json()

    async def _load_maps(self) -> None:
        """SEC's ticker file, cached for a day. Carries company names too — the
        same download already contains them, and a question says "NVIDIA" far
        more often than it says "NVDA"."""
        stale = (time.time() - self._ticker_map_at) > TICKER_MAP_TTL_S
        if self._ticker_map and not stale:
            return
        data = await self._get_json(TICKER_MAP_URL)
        if not data:
            return
        tickers: dict[str, int] = {}
        titles: dict[str, str] = {}
        issuers: dict[str, str] = {}
        for row in data.values():
            if not isinstance(row, dict) or not row.get("ticker"):
                continue
            if row.get("cik_str") is None:
                continue
            t = str(row["ticker"]).upper()
            tickers[t] = int(row["cik_str"])
            title = _norm_name(str(row.get("title") or ""))
            # First ticker wins: the file lists the primary class first, so
            # "ALPHABET INC" resolves to GOOGL rather than a later share class.
            if title and title not in titles:
                titles[title] = t
            if t not in issuers and row.get("title"):
                issuers[t] = str(row["title"])
        self._ticker_map, self._title_map = tickers, titles
        self._issuer_by_ticker = issuers
        self._ticker_map_at = time.time()

    async def ticker_to_cik(self, ticker: str) -> int | None:
        """Resolve via SEC's ticker map, cached for a day rather than per request."""
        await self._load_maps()
        return self._ticker_map.get(ticker.upper())

    async def tickers_from_names(self, query: str) -> list[str]:
        """
        Tickers for company names the query spells out.

        The uppercase-token fallback in `extract_tickers` is bounded at five
        characters, so it can never match "NVIDIA" — six letters — and the
        channel returned nothing for the company it is most often asked about.
        Matching against SEC's own company titles closes that without a second
        resolver or a hand-kept alias list.
        """
        await self._load_maps()
        if not self._title_map:
            return []
        q = f" {_norm_name(query)} "

        # People say "Chipotle", not "Chipotle Mexican Grill", so a leading prefix
        # of the name has to match. Scoring by how MANY of the name's words the
        # query accounts for, with a fully-consumed name breaking ties, is what
        # keeps that from collapsing distinct issuers:
        #
        #   "Apple"              -> Apple Inc            (1 word, complete)
        #                           beats Apple Hospitality (1 word, partial)
        #   "Apple Hospitality"  -> Apple Hospitality    (2 words) beats Apple (1)
        #
        # Matching only the full name loses "Chipotle"; matching only the first
        # word loses "Apple Hospitality". Both are needed.
        # Longest matching prefix of each issuer's name, and whether that
        # consumed the whole name.
        by_prefix: dict[str, list[tuple[bool, str]]] = {}
        for title, ticker in self._title_map.items():
            words = [w for w in title.split() if w not in _CORP_SUFFIXES]
            if not words or len(" ".join(words)) < 4:
                continue
            for n in range(len(words), 0, -1):
                prefix = " ".join(words[:n])
                if len(prefix) >= 4 and f" {prefix} " in q:
                    by_prefix.setdefault(prefix, []).append(
                        (n == len(words), ticker)
                    )
                    break

        # Issuers competing for the SAME text are the ambiguous case. Two issuers
        # matching DIFFERENT text is a comparison ("Apple vs Microsoft"), not
        # ambiguity, so they must not cancel each other out.
        resolved: list[tuple[int, bool, str]] = []
        for prefix, candidates in by_prefix.items():
            complete = [t for done, t in candidates if done]
            if len(complete) == 1:
                # One issuer's whole name IS this text — "Apple" is Apple Inc,
                # not the longer names that merely start with it.
                resolved.append((len(prefix.split()), True, complete[0]))
            elif len(candidates) == 1:
                resolved.append((len(prefix.split()), False, candidates[0][1]))
            else:
                logger.info(
                    "edgar_ambiguous_company_name",
                    text=prefix, tickers=sorted(t for _d, t in candidates)[:6],
                )

        if not resolved:
            return []
        # Only the strongest reading. "Apple Hospitality" matches both that name
        # (2 words) and bare "Apple" (1); keeping the weaker one would fan out to
        # a second company's filings for a question about one.
        top = max(r[:2] for r in resolved)
        return [t for n, c, t in sorted(resolved, reverse=True) if (n, c) == top][:5]

    async def _fetch_concept(
        self, cik: int, tag: str, years: list[int] | None = None
    ) -> tuple[str, dict] | None:
        """
        Primary tag, then its fallbacks. Returns the tag that actually answered.

        A tag is only accepted if it has data covering the years asked about.
        Testing merely for "has any data at all" is what silently broke NVDA:
        it stopped tagging `RevenueFromContractWithCustomerExcludingAssessedTax`
        after FY2022 but the 28 stale points are still served, so the guard
        passed, `Revenues` — where every figure since lives — was never tried,
        and every recent NVDA revenue question returned nothing.
        """
        first: tuple[str, dict] | None = None
        for candidate in [tag] + _TAG_FALLBACKS.get(tag, []):
            data = await self._get_json(CONCEPT_URL.format(cik=cik, tag=candidate))
            if not data:
                continue
            units = data.get("units") or {}
            if not units:
                continue
            if first is None:
                first = (candidate, data)
            if not years or _covers_years(units, years):
                return candidate, data
        # Nothing covered the request; the best available is still better than
        # silence, and verification downstream will reject a wrong period.
        return first

    async def search(
        self,
        query: str,
        filters: dict | None = None,
        entities: dict | None = None,
        top_k: int = 10,
    ) -> list[RetrievalResult]:
        try:
            tickers = extract_tickers(query, entities, filters)
            if not tickers:
                # Nothing upstream resolved the company; try the names SEC itself
                # publishes before giving up.
                tickers = await self.tickers_from_names(query)
            if not tickers:
                # EDGAR is company-scoped; without one there is nothing to ask for.
                return []
            tag, label = classify_metric(query)
            quarter = parse_quarter(query)
            quarterly = quarter is not None or bool(_QUARTER_INTENT.search(query or ""))
            years = parse_fiscal_years(query)

            per_ticker = max(2, top_k // max(len(tickers), 1))
            batches = await asyncio.gather(
                *[
                    self._for_ticker(
                        t, tag, label, quarterly, quarter, years, per_ticker, query
                    )
                    for t in tickers[:3]
                ],
                return_exceptions=True,
            )

            out: list[RetrievalResult] = []
            for b in batches:
                if isinstance(b, Exception):
                    logger.warning("edgar_ticker_failed", error=str(b)[:160])
                    continue
                out.extend(b)
            logger.info(
                "edgar_search",
                results=len(out),
                tag=tag,
                tickers=tickers[:3],
                quarterly=quarterly,
                quarter=quarter,
            )
            out = out[:top_k]
            # Which document of the filing the figure belongs to. The XBRL API
            # names the concept, never the filing's primary document, so
            # "View filing" would otherwise have nothing exact to open — and
            # the specification forbids guessing the filename. One submissions
            # fetch per registrant, cached, and a failure leaves the fields
            # absent rather than wrong.
            await sec_filing_resolver.attach_filing_identity(out)
            # The answer does not wait for this; the next identical question is
            # served from the corpus instead of from EDGAR.
            fact_persistence.schedule(out)
            return out
        except Exception as e:
            logger.error("edgar_search_failed", error=str(e)[:200])
            return []

    async def _for_ticker(
        self,
        ticker: str,
        tag: str,
        label: str,
        quarterly: bool,
        quarter: int | None,
        years: list[int],
        limit: int,
        query: str = "",
    ) -> list[RetrievalResult]:
        cik = await self.ticker_to_cik(ticker)
        if cik is None:
            logger.info("edgar_unknown_ticker", ticker=ticker)
            return []
        found = await self._fetch_concept(cik, tag, years)
        if not found:
            return []
        used_tag, payload = found
        units = payload.get("units") or {}

        rows = (
            self._quarterly_rows(units, used_tag, years)
            if quarterly
            else self._annual_rows(units, years)
        )
        if quarter is not None:
            # A question about Q3 must not be answered with Q4. Without this the
            # rows came back reverse-sorted and the newest quarter led.
            scoped = [r for r in rows if r.get("quarter") == quarter]
            if scoped:
                rows = scoped
            else:
                logger.info(
                    "edgar_quarter_absent", ticker=ticker, quarter=quarter, years=years
                )
                return []

        rows = rows[:limit]
        if not rows:
            return []

        # A period is reported many times — its own 10-Q, later comparative
        # columns, and any amendment that restates it. Pick the authoritative
        # reading and record what it supersedes, so a restatement is disclosed
        # rather than silently resolved either way.
        rows = [self._apply_authority(r, units, quarterly) for r in rows]

        fy_end_month = fiscal_year_end_month(_all_points(units))
        want_fy = years[-1] if years else None
        period_kind = "quarter" if quarterly else "annual"

        # A breakdown ("Data Center", "Compute & Networking") is not in
        # companyconcept at all — only in the filing's own instance document.
        # Fetching one costs two requests, so it happens only when the question
        # carries words that could name a breakdown.
        dim = None
        breakdown_asked = bool(query) and self._names_a_breakdown(query, label, ticker)
        if breakdown_asked:
            dim = await self._dimensional_result(
                ticker, cik, used_tag, label, rows[0], query, fy_end_month,
                want_fy, quarter, period_kind,
            )
            if dim is not None:
                return [dim]

        out: list[RetrievalResult] = []
        for r in rows:
            status, reasons = verify_fact(
                value=r.get("value"),
                unit=r.get("unit", ""),
                start=r.get("start", ""),
                end=r.get("end", ""),
                fy_end_month=fy_end_month,
                want_fy=want_fy,
                want_quarter=quarter,
                period_kind=period_kind,
            )
            if status != VERIFIED:
                logger.info(
                    "edgar_fact_rejected",
                    ticker=ticker, period=self._period_label(r), reasons=reasons,
                )
                continue
            res = self._to_result(ticker, cik, used_tag, label, r)
            # These rows reached here only by passing verify_fact above; record
            # that, because the evidence gate refuses to bypass SEC for any row
            # that cannot show a passing verification state.
            res.metadata["verification_status"] = status
            res.metadata["parser_version"] = PARSER_VERSION
            if breakdown_asked:
                # The question carried words that could name a segment and none
                # resolved. The consolidated figure is still true and is labelled
                # as such, but the answer layer must be able to see that the
                # breakdown was asked for and not found, rather than reading this
                # as the segment figure.
                res.metadata["breakdown_requested"] = True
                res.metadata["breakdown_found"] = False
            out.append(res)
        return out

    @staticmethod
    def _apply_authority(row: dict, units: dict, quarterly: bool) -> dict:
        """
        Replace a row with the authoritative reading of its period, carrying what
        it superseded. A derived Q4 is left alone — it is arithmetic over other
        rows, not a filed point any single filing can restate.
        """
        if row.get("derived") or not (row.get("start") and row.get("end")):
            return row
        res = sec_authority.resolve(units, row["start"], row["end"], quarterly)
        if not res:
            return row
        p, out = res["point"], dict(row)
        out.update({
            "value": p.get("val", row.get("value")),
            "form": p.get("form") or row.get("form", ""),
            "accn": p.get("accn") or row.get("accn", ""),
            "unit": p.get("unit") or row.get("unit", ""),
            "conflict": res["conflict"],
            "restated": res["restated"],
            "superseded": [
                {
                    "value": o.get("val"),
                    "form": o.get("form", ""),
                    "filed": o.get("filed", ""),
                    "accn": o.get("accn", ""),
                }
                for o in res["superseded"][:4]
            ],
            "filed": p.get("filed", ""),
            "disclosure": sec_authority.describe(res),
        })
        return out

    def _names_a_breakdown(self, query: str, label: str, ticker: str) -> bool:
        """
        Whether the question carries words beyond the company, the metric and the
        period — the only case where a segment or product line could be meant.

        Cheap and purely subtractive, so it needs no ontology of segment names
        and stays correct for filers whose breakdowns nobody has enumerated.
        """
        known: set[str] = set(_RESIDUAL_STOPWORDS)
        known.update(_norm_name(label).split())
        known.update(_CORP_SUFFIXES)
        known.add(ticker.lower())
        for title, t in self._title_map.items():
            if t == ticker:
                known.update(title.split())
        residual = [
            w
            for w in _norm_name(query).split()
            if w not in known and not w.isdigit() and not _PERIOD_TOKEN.fullmatch(w)
        ]
        return bool(residual)

    async def _dimensional_result(
        self,
        ticker: str,
        cik: int,
        tag: str,
        label: str,
        row: dict,
        query: str,
        fy_end_month: int,
        want_fy: int | None,
        want_quarter: int | None,
        period_kind: str | None = None,
    ) -> RetrievalResult | None:
        """
        The segment/product-line figure the question names, read from the filing
        the period was already resolved to. `None` when the filing reports no
        such breakdown, which leaves the consolidated rows to answer instead.
        """
        accn, start, end = row.get("accn"), row.get("start"), row.get("end")
        if not (accn and start and end):
            return None
        http = await self._client()
        res = await resolve_dimensional_fact(
            http, cik, accn, {tag}, start, end, query
        )
        if not res or res.get("status") != "matched" or not res.get("fact"):
            if res and res.get("status") == "ambiguous":
                logger.info("edgar_dimension_ambiguous", candidates=res.get("candidates"))
            return None

        fact = res["fact"]
        status, reasons = verify_fact(
            value=fact.value,
            unit=fact.unit or row.get("unit", ""),
            start=fact.start,
            end=fact.end,
            fy_end_month=fy_end_month,
            want_fy=want_fy,
            want_quarter=want_quarter,
            period_kind=period_kind,
            dimension_status="matched",
            asked_for_breakdown=True,
        )
        if status != VERIFIED:
            logger.info("edgar_dimension_rejected", reasons=reasons)
            return None

        breakdown = ", ".join(res["candidates"]) or "segment"
        dim_row = dict(row)
        dim_row.update({
            "value": fact.value,
            "unit": row.get("unit", "USD"),
            "start": fact.start,
            "end": fact.end,
        })
        result = self._to_result(
            ticker, cik, tag, f"{breakdown} {label}", dim_row
        )
        result.metadata.update({
            "dimensions": [{"axis": a, "member": m} for a, m in fact.members],
            "row_label": breakdown,
            "column_label": f"{fact.start} to {fact.end}",
            "period_start": fact.start,
            "context_id": fact.context_id,
            "document_url": res["document_url"],
            "source_url": res["document_url"],
            "extraction_method": "filing_instance",
            "available_breakdowns": res["available"],
            "verification_status": VERIFIED,
            "parser_version": PARSER_VERSION,
        })
        return result

    @staticmethod
    def _annual_rows(units: dict, years: list[int]) -> list[dict]:
        """Annual durations, plus instants for balance-sheet tags (which have no start)."""
        best: dict[int, dict] = {}
        for unit, points in units.items():
            for p in points:
                end = p.get("end", "")
                if not end or p.get("val") is None:
                    continue
                try:
                    d1 = _d(end)
                except ValueError:
                    continue
                start = p.get("start", "")
                if start:
                    try:
                        days = (d1 - _d(start)).days
                    except ValueError:
                        continue
                    if not ANNUAL_MIN_DAYS <= days <= ANNUAL_MAX_DAYS:
                        continue
                fy = d1.year
                cand = {
                    "fy": fy,
                    "quarter": None,
                    "value": p["val"],
                    "unit": unit,
                    "form": p.get("form", ""),
                    "accn": p.get("accn", ""),
                    "start": start,
                    "end": end,
                    "derived": False,
                    "derivation": "",
                }
                cur = best.get(fy)
                if (
                    cur is None
                    or (cand["form"] == "10-K" and cur["form"] != "10-K")
                    or (cand["form"] == cur["form"] and cand["end"] > cur["end"])
                ):
                    best[fy] = cand
        rows = sorted(best.values(), key=lambda r: r["end"], reverse=True)
        if years:
            wanted = (
                set(range(years[0], years[-1] + 1)) if len(years) >= 2 else {years[0]}
            )
            scoped = [r for r in rows if r["fy"] in wanted]
            if scoped:
                return scoped
        return rows

    @staticmethod
    def _quarterly_rows(units: dict, tag: str, years: list[int]) -> list[dict]:
        """
        Per-quarter values, with Q4 derived where no standalone Q4 is filed.

        companyconcept is reshaped into the companyfacts envelope so the tested
        period logic in sec_quarterly is reused verbatim rather than rewritten.
        """
        if years:
            wanted = (
                list(range(years[0], years[-1] + 1)) if len(years) >= 2 else [years[0]]
            )
        else:
            ends = [
                p.get("end", "") for pts in units.values() for p in pts if p.get("end")
            ]
            latest = max((int(e[:4]) for e in ends), default=date.today().year)
            wanted = [latest - 2, latest - 1, latest]
        facts = {"facts": {"us-gaap": {tag: {"units": units}}}}
        rows = extract_quarterly_facts(facts, wanted, [tag])
        return sorted(rows, key=lambda r: (r["fy"], r["quarter"]), reverse=True)

    @staticmethod
    def _period_label(row: dict) -> str:
        return f"FY{row['fy']}" + (f" Q{row['quarter']}" if row.get("quarter") else "")

    @staticmethod
    def _fmt(value, unit: str) -> str:
        try:
            v = float(value)
        except (TypeError, ValueError):
            return str(value)
        if unit == "USD/shares":
            return f"${v:,.2f}"
        prefix = "$" if unit.startswith("USD") else ""
        return f"{prefix}{v:,.0f}"

    def _to_result(
        self, ticker: str, cik: int, tag: str, label: str, row: dict
    ) -> RetrievalResult:
        period = self._period_label(row)
        accn = str(row.get("accn", "") or "")
        # An accession that is not shaped like one is not interpolated into a
        # URL path and is not shown as a citation. The string arrives from a
        # parsed JSON document; "sec.gov sent it" is an assumption about the
        # network, not a property of the value.
        url = filing_url(cik, accn) if valid_accession(accn) else ""
        derived = bool(row.get("derived"))
        form = row.get("form") or "XBRL"
        # The prefix is load-bearing: search_pipeline pins passages carrying it and
        # flags the answer as anchored on an exact figure.
        text = (
            f"[EXACT FILING FIGURE] {ticker} {label} for {period} ({form}): "
            f"{self._fmt(row.get('value'), row.get('unit', ''))}"
        )
        if derived:
            reason = row.get("derivation") or "FY total minus the filed quarters"
            text += f" (derived, not directly filed — {reason})"
        # A restated figure says so in the passage itself. Putting it only in
        # metadata would leave the LLM stating a number whose predecessor is
        # still quoted elsewhere, with nothing to reconcile them.
        text += row.get("disclosure", "")
        return RetrievalResult(
            chunk_id=f"edgar:{ticker}:{tag}:{period.replace(' ', '')}",
            document_id=f"edgar:{ticker}:{row.get('accn', '') or tag}",
            text=text,
            score=1.0,
            document_title=f"{ticker} {form} — {period}",
            section="XBRL companyconcept",
            filing_date=row.get("end", ""),
            ticker=ticker,
            document_type="sec_edgar_xbrl",
            source_quality=10,  # sec.gov authority tier, set explicitly
            metadata={
                "accn": accn,
                "cik": cik,
                # SEC's own registrant name. A citation states the issuer, and
                # a ticker is a market symbol, not an issuer.
                "issuer": self._issuer_by_ticker.get(ticker.upper(), ""),
                "tag": tag,
                "unit": row.get("unit", ""),
                "form": form,
                "fiscal_year": row.get("fy"),
                "fiscal_quarter": row.get("quarter"),
                # Both endpoints travel with the fact: a period is a span, and
                # the end date alone cannot distinguish a quarter from the
                # year-to-date column that shares it.
                "period_start": row.get("start", ""),
                "period_end": row.get("end", ""),
                "value": row.get("value"),
                "derived": derived,
                "derivation": row.get("derivation", ""),
                # Amendment / restatement identity, so a citation can name the
                # version it is quoting and what that version replaced.
                "filed": row.get("filed", ""),
                "is_amendment": sec_authority.is_amendment(form),
                "conflict": bool(row.get("conflict")),
                "restated": bool(row.get("restated")),
                "superseded": row.get("superseded", []),
                "filing_url": url,
                "source_url": url,
                # Which artefact the number was read out of. A consolidated fact
                # comes from SEC's companyconcept aggregation; a dimensional one
                # is overwritten below with the filing's own instance document,
                # because those are genuinely different evidence.
                "extraction_method": "companyconcept",
                "document_url": CONCEPT_URL.format(cik=cik, tag=tag),
                "channel": "edgar",
            },
        )
