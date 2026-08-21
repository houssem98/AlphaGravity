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

from app.core.retrieval.fusion import RetrievalResult
from app.ingestion.sources.sec_quarterly import (
    ANNUAL_MAX_DAYS,
    ANNUAL_MIN_DAYS,
    extract_quarterly_facts,
    filing_url,
)

logger = structlog.get_logger()

TICKER_MAP_URL = "https://www.sec.gov/files/company_tickers.json"
CONCEPT_URL = (
    "https://data.sec.gov/api/xbrl/companyconcept/CIK{cik:010d}/us-gaap/{tag}.json"
)
COMPANYFACTS_URL = "https://data.sec.gov/api/xbrl/companyfacts/CIK{cik:010d}.json"
SUBMISSIONS_URL = "https://data.sec.gov/submissions/CIK{cik:010d}.json"
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

# When the asked-for metric is absent from a filer's XBRL entirely, these are the
# tags worth reporting instead, most explanatory first. A pre-merger SPAC is the
# motivating case: it has no revenue because it has no operating business, and
# what it does have — money in trust, interest earned on it, G&A burn — is the
# actual answer to "what are this company's financials". Human labels, since the
# tag names themselves are not what an answer should quote.
_PROFILE_TAGS: list[tuple[str, str]] = [
    ("AssetsHeldInTrustNoncurrent", "assets held in trust"),
    ("AssetsHeldInTrust", "assets held in trust"),
    ("AssetsHeldInTrustCurrent", "assets held in trust (current)"),
    ("InvestmentIncomeInterest", "interest/investment income earned on the trust"),
    ("InterestIncomeOther", "other interest income"),
    ("GeneralAndAdministrativeExpense", "general and administrative expense"),
    ("OperatingIncomeLoss", "operating income (loss)"),
    ("NetIncomeLoss", "net income (loss)"),
    ("Assets", "total assets"),
    ("Liabilities", "total liabilities"),
    ("StockholdersEquity", "shareholders equity"),
    ("Cash", "cash"),
    ("CashAndCashEquivalentsAtCarryingValue", "cash and cash equivalents"),
    ("NetCashProvidedByUsedInOperatingActivities", "net cash used in operating activities"),
]
_MAX_PROFILE_FACTS = 8
# Enough filings to show how new the filer is and how it got public (S-1 → EFFECT
# → 424B4 → 8-K → first 10-Q is the whole SPAC arc), without pasting a filing index.
_MAX_TIMELINE_FILINGS = 8
# Filed by shareholders/insiders ABOUT the company, not by the company. Forms 3/4/5
# and the 13D/13G family say who owns it, never what it does.
_OWNERSHIP_FORM = re.compile(r"^(SC\s|SCHEDULE\s?13|13[DGF]|[345](/A)?$)", re.I)

_COMMON_NON_TICKERS = {
    "I", "A", "AN", "THE", "AND", "OR", "FOR", "IN", "OF", "TO", "IS", "IT", "AT",
    "ON", "BY", "AS", "IF", "DO", "VS", "EPS", "LTM", "YOY", "DCF", "LBO", "MCP",
    "SEC", "IPO", "CEO", "CFO", "COO", "CTO", "ETF", "Q1", "Q2", "Q3", "Q4", "FY",
    "PE", "PS", "PB", "EV", "GDP", "CPI", "USD", "XBRL", "GAAP",
}


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


def _edgar_filings_url(cik: int) -> str:
    """Filer's filing index — the citable landing page when no single accession
    owns the statement (the profile passage spans whatever the filer reports)."""
    return (
        "https://www.sec.gov/cgi-bin/browse-edgar"
        f"?action=getcompany&CIK={cik:010d}&type=&dateb=&owner=include&count=40"
    )


class EdgarSearch:
    """Live SEC XBRL facts as a retrieval channel."""

    def __init__(self, http_client=None):
        from app.config import settings

        self._ua = settings.sec_user_agent
        self._http = http_client
        self._ticker_map: dict[str, int] = {}
        self._ticker_map_at: float = 0.0

    async def _client(self):
        if self._http is None:
            import httpx

            self._http = httpx.AsyncClient(
                headers={"User-Agent": self._ua}, timeout=10.0
            )
        return self._http

    async def _get_json(self, url: str) -> dict | None:
        async with _SEC_SEMAPHORE:
            c = await self._client()
            r = await c.get(url)
        if r.status_code == 404:  # concept not reported by this filer
            return None
        r.raise_for_status()
        return r.json()

    async def ticker_to_cik(self, ticker: str) -> int | None:
        """Resolve via SEC's ticker map, cached for a day rather than per request."""
        stale = (time.time() - self._ticker_map_at) > TICKER_MAP_TTL_S
        if not self._ticker_map or stale:
            data = await self._get_json(TICKER_MAP_URL)
            if data:
                self._ticker_map = {
                    str(row["ticker"]).upper(): int(row["cik_str"])
                    for row in data.values()
                    if isinstance(row, dict)
                    and row.get("ticker")
                    and row.get("cik_str") is not None
                }
                self._ticker_map_at = time.time()
        return self._ticker_map.get(ticker.upper())

    async def _fetch_concept(self, cik: int, tag: str) -> tuple[str, dict] | None:
        """Primary tag, then its fallbacks. Returns the tag that actually answered."""
        for candidate in [tag] + _TAG_FALLBACKS.get(tag, []):
            data = await self._get_json(CONCEPT_URL.format(cik=cik, tag=candidate))
            if data and (data.get("units") or {}):
                return candidate, data
        return None

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
                # EDGAR is company-scoped; without one there is nothing to ask for.
                return []
            tag, label = classify_metric(query)
            quarterly = bool(_QUARTER_INTENT.search(query or ""))
            years = sorted({int(y) for y in re.findall(r"(?:19|20)\d{2}", query or "")})

            # A query naming multiple years plus quarterly intent needs room for
            # every period it asked for (up to 4 quarters/year, incl. a derived
            # Q4) — not just the generic `top_k` default. Below this fix, a
            # 3-year quarterly ask (12 periods) silently lost its two oldest
            # quarters to the sorted-descending `rows[:limit]` cut in
            # `_for_ticker`, even though every quarter was correctly fetched
            # and derived. Capped so a garbled query (e.g. a long paragraph
            # whose incidental 4-digit tokens all parse as years) can't blow
            # the fan-out open unbounded.
            num_years = len(years) if years else 1
            periods_wanted = num_years * 4 if quarterly else num_years
            effective_top_k = max(top_k, periods_wanted) if years else top_k
            effective_top_k = min(effective_top_k, 60)

            per_ticker = max(2, effective_top_k // max(len(tickers), 1))
            batches = await asyncio.gather(
                *[
                    self._for_ticker(t, tag, label, quarterly, years, per_ticker)
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
                years=years,
                effective_top_k=effective_top_k,
            )
            return out[:effective_top_k]
        except Exception as e:
            # exc_info so a real failure (bad JSON shape, unexpected SEC
            # response, etc.) is distinguishable in logs from "SEC genuinely
            # had nothing" — both currently look identical as `results=0` to
            # anything outside this process.
            logger.error("edgar_search_failed", error=str(e)[:200], exc_info=True)
            return []

    async def _for_ticker(
        self,
        ticker: str,
        tag: str,
        label: str,
        quarterly: bool,
        years: list[int],
        limit: int,
    ) -> list[RetrievalResult]:
        cik = await self.ticker_to_cik(ticker)
        if cik is None:
            logger.info("edgar_unknown_ticker", ticker=ticker)
            return []
        found = await self._fetch_concept(cik, tag)
        if not found:
            return await self._filer_profile(ticker, cik, label)
        used_tag, payload = found
        units = payload.get("units") or {}

        rows = (
            self._quarterly_rows(units, used_tag, years)
            if quarterly
            else self._annual_rows(units, years)
        )
        if not rows:
            # The tag exists but nothing survived period selection — a filer
            # younger than one fiscal year has no duration long enough to pass
            # the annual window, for instance. Same reasoning as a missing tag:
            # say what IS there rather than returning silence.
            return await self._filer_profile(ticker, cik, label)
        return [self._to_result(ticker, cik, used_tag, label, r) for r in rows[:limit]]

    async def _filer_context(self, cik: int) -> dict:
        """
        SEC's own classification and filing history for this filer.

        companyfacts answers "what numbers does it report"; this answers "what
        KIND of company is it, and what has it filed". For the absent-metric case
        that is the difference between "reports no revenue" and "reports no
        revenue BECAUSE SEC classifies it Blank Checks and it IPO'd two months
        ago" — the classification is SEC's, not an inference we made.

        Best-effort: a failure here must not cost the caller its facts, so
        everything is wrapped and an empty dict is a valid answer.
        """
        try:
            subs = await self._get_json(SUBMISSIONS_URL.format(cik=cik))
        except Exception as e:
            logger.warning("edgar_submissions_failed", cik=cik, error=str(e)[:120])
            return {}
        if not subs:
            return {}
        recent = (subs.get("filings") or {}).get("recent") or {}
        forms = recent.get("form") or []
        dates = recent.get("filingDate") or []
        # SEC returns most-recent-first, and for a newly public company the front
        # of that list is mostly SCHEDULE 13G / Forms 3-4-5 — ownership disclosures
        # filed BY OTHER PARTIES about the company. They crowd out the filings that
        # actually tell the story (S-1 -> EFFECT -> 424B4 -> 8-K -> first 10-Q), so
        # keep only what the company itself filed.
        timeline = [
            f"{f} {d}"
            for f, d in zip(forms, dates)
            if not _OWNERSHIP_FORM.match(str(f or ""))
        ][:_MAX_TIMELINE_FILINGS]
        return {
            "sic_description": subs.get("sicDescription") or "",
            "entity_type": subs.get("entityType") or "",
            "exchanges": sorted({x for x in (subs.get("exchanges") or []) if x}),
            "tickers": subs.get("tickers") or [],
            "fiscal_year_end": subs.get("fiscalYearEnd") or "",
            "timeline": timeline,
        }

    @staticmethod
    def _latest_fact(entry: dict) -> dict | None:
        """Most recently ended fact for one companyfacts tag, across all units."""
        best: dict | None = None
        for unit, points in (entry.get("units") or {}).items():
            for p in points:
                if not p.get("end") or p.get("val") is None:
                    continue
                if best is None or p["end"] > best["end"]:
                    best = {**p, "unit": unit}
        return best

    async def _filer_profile(
        self, ticker: str, cik: int, label: str
    ) -> list[RetrievalResult]:
        """
        The filer does not report the metric that was asked for. Returning []
        here is what made the pipeline answer "No indexed documents found —
        ingest the filings first", which is wrong twice over: EDGAR *was* queried,
        SEC *did* answer, and no amount of ingestion will produce a figure the
        company never filed. So state the absence and hand back what the filer
        actually reports, which is what lets the answer explain *why* the metric
        is missing (a pre-merger SPAC has no revenue because it has no business
        yet — it has money in trust).

        One extra request, and only on a miss: an operating company asked for a
        normal metric never reaches this path.
        """
        facts = await self._get_json(COMPANYFACTS_URL.format(cik=cik))
        if not facts:
            return []
        gaap = (facts.get("facts") or {}).get("us-gaap") or {}
        if not gaap:
            return []
        name = facts.get("entityName") or ticker

        picked: list[tuple[str, str, dict]] = []
        seen_labels: set[str] = set()
        for tag_name, human in _PROFILE_TAGS:
            if tag_name not in gaap or human in seen_labels:
                continue
            fact = self._latest_fact(gaap[tag_name])
            if fact:
                picked.append((tag_name, human, fact))
                seen_labels.add(human)
            if len(picked) >= _MAX_PROFILE_FACTS:
                break
        if not picked:
            return []

        latest_end = max(f["end"] for _t, _h, f in picked)
        # Inline the inventory rather than relying on the answer to assemble it
        # from eight sibling passages. The headline number for a filer like this
        # is the trust balance, and a terse model will skip it if it has to go
        # find it — spelling the position out in one passage is what makes the
        # answer say "no revenue, but $230.3M sits in trust" instead of only the
        # first half.
        inventory = "; ".join(
            f"{human} {self._fmt(f.get('val'), f.get('unit', ''))}"
            for _t, human, f in picked
        )

        # SEC's own classification + filing history. This is what turns "reports
        # no revenue" into "reports no revenue because SEC classifies it Blank
        # Checks and it first filed an S-1 three months ago" — sourced, not
        # inferred from the shape of the numbers.
        ctx = await self._filer_context(cik)
        ctx_sentence = ""
        if ctx.get("sic_description"):
            ctx_sentence += (
                f" SEC classifies this filer under SIC \"{ctx['sic_description']}\"."
            )
        if ctx.get("tickers") and len(ctx["tickers"]) > 1:
            ctx_sentence += (
                f" It has {len(ctx['tickers'])} listed securities "
                f"({', '.join(ctx['tickers'])})"
                + (f" on {'/'.join(ctx['exchanges'])}" if ctx.get("exchanges") else "")
                + " — for a blank-check company these are typically the share, the"
                " unit, and the warrant, which is why a 'Units' ticker resolves to"
                " the same filer."
            )
        if ctx.get("timeline"):
            ctx_sentence += (
                f" Its most recent SEC filings are: {', '.join(ctx['timeline'])}."
            )

        out = [
            RetrievalResult(
                chunk_id=f"edgar:{ticker}:absent:{label.replace(' ', '')}",
                document_id=f"edgar:{ticker}:profile",
                text=(
                    f"{ticker} ({name}, CIK {cik}) reports no {label} in its SEC XBRL "
                    f"data — the tag is absent from its filings, not merely unindexed. "
                    f"A filer with no {label} is typically pre-operating: a blank-check "
                    f"/ SPAC company holding its IPO proceeds in trust while it searches "
                    f"for a merger target, a newly registered filer, or a holding entity. "
                    f"What this filer does report, as of {latest_end} (of "
                    f"{len(gaap)} us-gaap concepts in total): {inventory}."
                    + ctx_sentence
                ),
                score=1.0,
                document_title=f"{ticker} — SEC XBRL filer profile",
                section="XBRL companyfacts",
                filing_date=latest_end,
                ticker=ticker,
                document_type="sec_edgar_xbrl",
                source_quality=10,
                metadata={
                    "cik": cik,
                    "entity_name": name,
                    "sic_description": ctx.get("sic_description", ""),
                    "entity_type": ctx.get("entity_type", ""),
                    "exchanges": ctx.get("exchanges", []),
                    "listed_tickers": ctx.get("tickers", []),
                    "recent_filings": ctx.get("timeline", []),
                    "requested_metric": label,
                    "metric_present": False,
                    "tags_reported": len(gaap),
                    "channel": "edgar",
                    "filing_url": _edgar_filings_url(cik),
                    "source_url": _edgar_filings_url(cik),
                },
            )
        ]
        for tag_name, human, fact in picked:
            out.append(
                self._to_result(
                    ticker,
                    cik,
                    tag_name,
                    human,
                    {
                        "fy": _d(fact["end"]).year,
                        "quarter": None,
                        "value": fact.get("val"),
                        "unit": fact.get("unit", ""),
                        "form": fact.get("form", ""),
                        "accn": fact.get("accn", ""),
                        "end": fact["end"],
                        "derived": False,
                        "derivation": "",
                    },
                )
            )
        logger.info(
            "edgar_filer_profile",
            ticker=ticker,
            cik=cik,
            requested=label,
            facts=len(picked),
            tags_reported=len(gaap),
        )
        return out

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
        url = filing_url(cik, row.get("accn", ""))
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
                "accn": row.get("accn", ""),
                "cik": cik,
                "tag": tag,
                "unit": row.get("unit", ""),
                "form": form,
                "fiscal_year": row.get("fy"),
                "fiscal_quarter": row.get("quarter"),
                "value": row.get("value"),
                "derived": derived,
                "derivation": row.get("derivation", ""),
                "filing_url": url,
                "source_url": url,
                "channel": "edgar",
            },
        )
