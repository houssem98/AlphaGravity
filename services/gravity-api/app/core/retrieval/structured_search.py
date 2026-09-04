"""
Gravity Search — Structured Data Search (Channel 5)

Exact financial facts from the `gravity_financials` Elasticsearch index, which
holds XBRL/table-extracted (ticker × metric × period → value) triples produced
by the ingestion TableIndexer.

This replaces the previous NL→SQL path: that queried a PostgreSQL/TimescaleDB
session that is a permanent `None` stub on the deployment (asyncpg/uvicorn
deadlock), so it always returned nothing. Querying the ES index gives the LLM
exact tagged figures (e.g. "AAPL — Total Revenue (FY2022): $394,328M") so it
stops guessing the wrong period/line-item from prose.
"""

import re

import structlog

from app.core.retrieval.fusion import RetrievalResult

logger = structlog.get_logger()

FINANCIALS_INDEX = "gravity_financials"


class StructuredSearch:
    """Exact financial-fact lookup over the gravity_financials ES index."""

    def __init__(self, llm_client=None):
        self.llm = llm_client  # kept for interface compatibility; unused
        self._es = None

    def _es_client(self):
        if self._es is None:
            try:
                from app.db.elasticsearch import get_es_client
                self._es = get_es_client()
            except Exception as e:
                logger.warning("structured_es_unavailable", error=str(e))
                self._es = None
        return self._es

    @staticmethod
    def _fmt_value(s: dict) -> str:
        """Human-readable value: 211915000000 USD -> '$211,915 million = $211.9B'.

        **The restatement is not parenthesised, and that is load-bearing (V23).**
        In filings, parentheses around a figure mean NEGATIVE — `(408)` in a
        United Airlines table is minus 408 million — and every downstream number
        reader implements that convention correctly. This renderer used the same
        brackets to mean "also expressed as", so each exact fact injected a
        spurious negative twin of itself into the passage:

            "$416,161 million ($416.16B)"  ->  {416161000000.0, -416160000000.0}

        The twin is a source figure no claim can account for, so it lands in
        `citation_verdict`'s `source_leftover` and turns "the source does not
        cover the other year" into "the source contradicts the claim". Measured,
        with the restatement removed as the control:

            "Apple revenue grew to $416,161 million from $391,035 million [1]."
              with parentheses  ->  conflicting / numeric_contradicts_source
              without           ->  partially_supported

        `conflicting` is the harshest verdict the layer issues, and it was being
        issued against a correct claim citing the exact-fact channel — the one
        channel fusion weights treat as ground truth.
        """
        vf = s.get("value_float")
        unit = (s.get("unit", "") or "").upper()
        if vf is None:
            return f"{s.get('value_raw', '')} {unit}".strip()
        try:
            vf = float(vf)
        except (TypeError, ValueError):
            return f"{s.get('value_raw', '')} {unit}".strip()
        if unit in ("USD", "") and abs(vf) >= 1e6:
            return f"${vf/1e6:,.0f} million = ${vf/1e9:.2f}B"
        if unit == "USD/SHARES" or "PERSHARE" in (s.get("caption", "") or "").upper():
            return f"${vf:,.2f} per share"
        if unit in ("SHARES",):
            return f"{vf:,.0f} shares"
        return f"{vf:,.2f} {unit}".strip()

    @classmethod
    def _fact_line(cls, s: dict) -> str:
        # Period-forward + plain metric + human value, so the LLM can't miss that
        # this is the exact figure for the asked fiscal year.
        return (
            f"[EXACT FILING FIGURE] {s.get('ticker', '')} {s.get('period', '')} — "
            f"{s.get('metric_name', '')}: {cls._fmt_value(s)} "
            f"(SEC XBRL, {s.get('filing_type', '')})"
        )

    async def _search_supabase(self, query, entities, filters, top_k) -> list[RetrievalResult]:
        import re
        from app.db import supabase_rest
        tickers = self._tickers(entities, filters)

        # Ticker scope is MANDATORY. Without it, a metric-only filter ("revenue")
        # returns OTHER companies' facts (e.g. a Coca-Cola query surfacing Apple/
        # Tesla/Nike revenue rows) — the exact cross-company contamination we kill
        # everywhere else. No resolved ticker → no structured facts.
        if not tickers:
            return []
        flt: dict = {}
        if len(tickers) == 1:
            flt["ticker"] = f"eq.{tickers[0]}"
        else:
            flt["ticker"] = "in.(" + ",".join(tickers) + ")"

        # Filter to the asked fiscal year(s). Single year → + one prior (change/CAGR/
        # growth). Multi-year → EVERY year in the span, not just the endpoints: a
        # "FY2020-2025" query only names 2020 & 2025 in text, so the old per-year
        # (y, y-1) expansion fetched FY2019,2020,2024,2025 and dropped 2021-2023 —
        # the measured "3 of 6 years" recall gap. This keeps facts on the right
        # periods without flooding (the metric filter below still narrows the rows).
        years = sorted({int(y) for y in re.findall(r"((?:19|20)\d{2})", query or "")})
        # Quarterly rows are stored as FY2023Q1 alongside the annual FY2023. They
        # are opt-in: `period` is text and "FY2025Q3" sorts ABOVE "FY2025", so
        # without this gate the 24-row budget below would fill with quarters and
        # push the annual figures — what almost every query actually wants — out
        # of context entirely.
        quarterly = bool(self._QUARTER_INTENT.search(query or ""))
        if years:
            if len(years) >= 2:
                wanted: set[int] = set(range(years[0], years[-1] + 1))
            else:
                wanted = {years[0], years[0] - 1}
            periods = [f"FY{y}" for y in sorted(wanted)]
            if quarterly:
                periods += [f"FY{y}Q{q}" for y in sorted(wanted) for q in (1, 2, 3, 4)]
            flt["period"] = "in.(" + ",".join(periods) + ")"
        elif not quarterly:
            # No year named: exclude quarters by shape. Scoped to the FY prefix so
            # the non-xbrl rows, whose periods are dates like "2026-05-20", are
            # untouched.
            flt["period"] = "not.like.FY*Q*"

        # When the query names a metric, narrow to it (precise lookup). Otherwise
        # (ratio queries — "quick ratio", "ROA") return the year's core items so the
        # LLM has the components to compute, but capped to keep context tight/fast.
        ql = (query or "").lower()
        metric = next((m for m in self._METRIC_TERMS if m in ql), None)
        # Derived metrics have no single XBRL row (FCF = operating cash flow − capex;
        # they are COMPUTED). Narrowing to the literal name ("free cash flow") returned
        # 0 rows → "not found". Fetch the exact COMPONENTS via an OR filter so all the
        # pinned context slots are the right rows — a broad fetch returned 24 mixed
        # rows and the top-6 pin kept only P&L items, dropping OCF/capex so FCF still
        # couldn't be computed.
        if metric in self._DERIVED_METRICS:
            _comp = self._DERIVED_COMPONENTS.get(metric or "")
            if _comp:
                flt["or"] = "(" + ",".join(f"metric_name.ilike.*{p}*" for p in _comp) + ")"
                # Components only, and only the exactly-tagged rows. Measured
                # 2026-08-17: NVDA_CostOfRevenue_FY2026_xbrl = 62,475,000,000 shares
                # the label "Cost of Goods Sold (COGS, Cost of Revenue)" with
                # NVDA_Cost_of_revenue_2026-05-20_backfill = 39.5 — a unitless
                # scrape of the same line. A ratio built from the second number is
                # wrong rather than missing, so the derived path takes `_xbrl` rows
                # or nothing. 501 of 527 tickers have them; the other 26 now answer
                # "not available" instead of confidently dividing by garbage.
                flt["id"] = "like.*_xbrl"
            metric = None
        else:
            # Multi-metric queries ("did operating income grow faster than revenue?")
            # need BOTH metrics — the single first-match fetched only operating income,
            # so revenue went missing and the comparison couldn't be made. If the query
            # names 2+ DISTINCT metrics, OR-fetch each so all reach context.
            _present: dict[str, str] = {}
            for _term, (_ck, _pat) in self._METRIC_PATTERNS.items():
                if _term in ql:
                    _present[_ck] = _pat   # dedupe synonyms by concept key
            if len(_present) >= 2:
                flt["or"] = "(" + ",".join(f"metric_name.ilike.{p}" for p in _present.values()) + ")"
                metric = None
        if metric:
            # "revenue"/"net sales" must NOT also match "Cost of Revenue": the bare
            # pattern *revenue* pulled cost-of-revenue rows, and in a comparison the
            # pin kept those instead of total revenue → "Meta's revenue not provided"
            # (yet the model still guessed a winner). The total-revenue label starts
            # with "Revenue (Total…", so anchor revenue synonyms to the label start.
            if metric in ("revenue", "total revenue", "net sales"):
                flt["metric_name"] = "ilike.Revenue*"
            elif metric in self._METRIC_PATTERNS:
                # Prefer the CURATED ilike pattern over a literal word-replace.
                # The query may say "stockholders equity" while the filed label
                # is "shareholders' equity" — the literal *stockholders*equity*
                # matched 0 rows (structured channel silently didn't fire); the
                # curated *holders*Equity* matches both.
                flt["metric_name"] = f"ilike.{self._METRIC_PATTERNS[metric][1]}"
            else:
                flt["metric_name"] = f"ilike.*{metric.replace(' ', '*')}*"

        # No specific metric AND no component filter (qualitative/analytical query —
        # "bull/bear case", "did profitability improve while capex rose"). A bare
        # metric=None fetched 24 mixed rows and the top-6 pin kept arbitrary ones,
        # dropping net income / capex → "no profitability data". Pin the KEY financials
        # via an OR filter so the headline metrics always reach context.
        if "metric_name" not in flt and "or" not in flt:
            flt["or"] = "(" + ",".join(
                f"metric_name.ilike.{p}" for p in self._KEY_METRIC_PATTERNS
            ) + ")"

        # Newest period first. Without an order the PostgREST call took whatever 24
        # rows Postgres yielded from 460k, so "the latest reported fiscal year" was
        # luck — and in a two-company comparison the budget was spent on whichever
        # ticker happened to sort first. `period` is text, and "FY2026" > "FY2025"
        # lexically, which is the ordering we want; the non-xbrl rows store dates
        # like "2026-05-20" and sort below every FY row because "F" > "2".
        # `period` is not unique, so it orders but does not SELECT. Two rows for
        # one ticker/metric/period tie — the exact XBRL row and a backfill row,
        # or two filed labels for one concept — and the tie was left to the
        # query planner, so the same question could select a different fact on
        # two runs:
        #
        #     AMD_CostOfGoodsAndServicesSold_FY2025_xbrl
        #     AMD_Cost_of_revenue_2026-05-20_backfill
        #
        # `id` is unique, so appending it makes the ordering TOTAL and the
        # selection repeatable. This decides only that the winner is stable, not
        # that it is the right one: WHICH label should win when a company files
        # both is a data question needing production rows, and it stays
        # escalated rather than guessed at here.
        flt["order"] = "period.desc,id.asc"
        rows = await supabase_rest.sb_select("financials", flt, limit=max(top_k, 24))
        out: list[RetrievalResult] = []
        for r in rows:
            if r.get("value_raw") is None and r.get("value_float") is None:
                continue
            out.append(RetrievalResult(
                chunk_id=f"fin_{r.get('id', '')}"[:48],
                document_id=str(r.get("document_id", "financials")),
                text=self._fact_line(r),
                score=5.0,  # exact tagged facts outrank prose
                metadata=r,
                ticker=r.get("ticker", ""),
            ))
        logger.info("structured_search_supabase", results=len(out), tickers=tickers, metric=metric)
        return out

    @staticmethod
    def _tickers(entities: dict | None, filters: dict | None) -> list[str]:
        out: list[str] = []
        for src in (entities or {}).get("companies", []) or []:
            if isinstance(src, dict) and src.get("ticker"):
                out.append(str(src["ticker"]).upper())
        for t in (filters or {}).get("companies", []) or []:
            if t:
                out.append(str(t).upper())
        return list(dict.fromkeys(out))  # dedupe, keep order

    # Metric keywords → narrow the exact-facts lookup when the query names one.
    # Order matters: the first term found in the query wins, so put multi-word /
    # more-specific terms before their substrings ("net sales" before "sales").
    _METRIC_TERMS = [
        # Ratio phrases FIRST, because the scan takes the first term found in the
        # query and every one of these contains a shorter term further down the
        # list: "inventory turnover" would otherwise match "inventory" and fetch
        # only the denominator. No bare "roa"/"dso" — three-letter substrings match
        # inside ordinary words ("broad") and would expand a query nobody asked to
        # expand. "roe" is already here and stays.
        "inventory turnover", "asset turnover", "receivables turnover",
        "days sales outstanding", "return on assets",
        "net sales", "total revenue", "net income", "operating income", "gross profit",
        "cost of revenue", "cost of goods", "cogs", "revenue",
        "gross margin", "operating margin", "net margin", "profit margin",
        "operating cash flow", "free cash flow", "cash flow",
        "capital expenditure", "capex", "total assets", "total liabilities", "long-term debt",
        "total debt", "inventory", "accounts receivable", "accounts payable", "cash and",
        "total stockholders equity", "total shareholders equity",
        "stockholders equity", "shareholders equity", "stockholders' equity", "shareholders' equity",
        "eps", "earnings per share", "return on equity", "roe", "dividend", "buyback",
        "share repurchase", "research and development", "r&d",
        # Banks / financials
        "net interest income", "noninterest income", "interest income", "interest expense",
    ]

    # Metrics with NO single XBRL row — they are computed from components. Matching
    # the literal name returns 0 rows; instead we fetch the period's core items so
    # the components are in context for the LLM/ratio engine to compute the result.
    # "quarterly revenue", "revenue by quarter", "Q3 FY2024". Matched against the
    # raw query so a quarter-shaped question opts into the FY####Q# rows.
    _QUARTER_INTENT = re.compile(
        r"\bquarter(?:ly|s)?\b|\bq[1-4]\b", re.I)

    _DERIVED_METRICS: frozenset[str] = frozenset({
        "free cash flow",      # = operating cash flow − capex
        "gross margin",        # = gross profit / revenue
        "operating margin",    # = operating income / revenue
        "net margin", "profit margin",
        # Efficiency and return ratios. "inventory turnover" used to match the bare
        # term "inventory" first, so the fetch narrowed to inventory balances and
        # COGS — the numerator — was never retrieved. Prod's answer was "cost of
        # goods sold is missing from the sources" while both figures sat in the
        # table. Only ratios whose component LABELS exist in `financials` are listed:
        # there is no "Total Debt" label, so debt-to-equity is deliberately absent.
        "inventory turnover",
        "asset turnover",
        "receivables turnover", "days sales outstanding",
        "return on equity", "roe",
        "return on assets",
    })

    # Derived metric → ilike patterns for the exact COMPONENT rows to fetch (matched
    # against the stored metric_name labels, e.g. "Operating Cash Flow (Cash from
    # Operations, CFO)", "Capital Expenditures (CapEx, Purchases of PP&E)"). "*" is a
    # wildcard so multi-word labels match. Fetching only the components keeps every
    # pinned context slot relevant so the LLM can compute the result.
    # Major metric term → (concept key for de-duping synonyms, ilike pattern matching
    # the stored label). Used to detect multi-metric queries and OR-fetch each.
    _METRIC_PATTERNS: dict[str, tuple[str, str]] = {
        "total revenue": ("rev", "Revenue*"), "net sales": ("rev", "Revenue*"),
        "revenue": ("rev", "Revenue*"),
        "net income": ("ni", "*Net*Income*"),
        "operating income": ("oi", "*Operating*Income*"),
        "gross profit": ("gp", "*Gross*Profit*"),
        "research and development": ("rd", "*Research*and*Development*"),
        "r&d": ("rd", "*Research*and*Development*"),
        "total assets": ("ta", "*Total*Assets*"),
        "total liabilities": ("tl", "*Total*Liabilities*"),
        "stockholders equity": ("eq", "*holders*Equity*"),
        "shareholders equity": ("eq", "*holders*Equity*"),
        "total stockholders equity": ("eq", "*holders*Equity*"),
        "total shareholders equity": ("eq", "*holders*Equity*"),
        "accounts payable": ("ap", "*Accounts*Payable*"),
        "accounts receivable": ("ar", "*Accounts*Receivable*"),
        "net interest income": ("nii", "*Net*Interest*Income*"),
        "operating cash flow": ("ocf", "*Operating*Cash*Flow*"),
        "capital expenditure": ("capex", "*Capital*Expenditure*"),
        "capex": ("capex", "*Capital*Expenditure*"),
        "inventory": ("inv", "*Inventory*"),
        "long-term debt": ("ltd", "*Long-Term*Debt*"),
        "eps": ("eps", "*Earnings*Per*Share*"),
        "earnings per share": ("eps", "*Earnings*Per*Share*"),
    }

    # Headline financials pinned for qualitative/analytical queries that name no
    # single metric (bull/bear case, "did profitability improve"). One per statement.
    _KEY_METRIC_PATTERNS: list[str] = [
        "Revenue*", "*Net*Income*", "*Operating*Income*", "*Gross*Profit*",
        "*Operating*Cash*Flow*", "*Capital*Expenditure*",
        # Full balance sheet (was Assets-only → liabilities/equity never pinned
        # for ratio/qualitative queries that need them, e.g. quick ratio, D/E).
        "*Total*Assets*", "*Total*Liabilities*", "*holders*Equity*",
    ]

    _DERIVED_COMPONENTS: dict[str, list[str]] = {
        "free cash flow":  ["operating*cash*flow", "capital*expenditure"],
        "gross margin":    ["gross*profit", "total*revenue"],
        "operating margin": ["operating*income", "total*revenue"],
        "net margin":      ["net*income", "total*revenue"],
        "profit margin":   ["net*income", "total*revenue"],
        # Labels verified against the table before they were written here:
        # "Cost of Goods Sold (COGS, Cost of Revenue)" 2,119 rows,
        # "Inventory (Net Inventory)" 3,133, "Total Assets" 5,346,
        # "Shareholders Equity (Stockholders Equity)" 5,084,
        # "Accounts Receivable Net (Net AR)" 3,392.
        # TWO labels for one concept, and which one a company uses changes over
        # time: NVDA files `CostOfRevenue` → "Cost of Revenue (COGS)" for FY2016-
        # FY2026, but `CostOfGoodsAndServicesSold` → "Cost of Goods Sold (COGS,
        # Cost of Revenue)" only through FY2021, which is AMD's current label.
        # Matching one pattern retrieved AMD's FY2025 numerator and NVDA's FY2021,
        # so the comparison was still unanswerable — with rows on screen.
        "inventory turnover":       ["cost*of*goods", "cost*of*revenue", "inventory"],
        "asset turnover":           ["total*revenue", "total*assets"],
        "receivables turnover":     ["total*revenue", "accounts*receivable"],
        "days sales outstanding":   ["total*revenue", "accounts*receivable"],
        "return on equity":         ["net*income", "holders*equity"],
        "roe":                      ["net*income", "holders*equity"],
        "return on assets":         ["net*income", "total*assets"],
    }

    async def search(
        self,
        query: str,
        entities: dict | None = None,
        filters: dict | None = None,
        top_k: int = 10,
    ) -> list[RetrievalResult]:
        # Gated OFF by default: noisy table extraction outranks prose and hurts
        # accuracy. Re-enable (settings.structured_facts_enabled) once the
        # table-parser column-alignment is fixed.
        try:
            from app.config import settings as _s
            if not getattr(_s, "structured_facts_enabled", False):
                return []
        except Exception:
            return []

        # Prefer Supabase Postgres financials table (no Elasticsearch needed).
        try:
            from app.db import supabase_rest
            if supabase_rest.configured():
                rows = await self._search_supabase(query, entities, filters, top_k)
                return rows
        except Exception as e:
            logger.warning("structured_supabase_failed", error=str(e)[:160])

        # Fallback: Elasticsearch gravity_financials (if ES is provisioned).
        es = self._es_client()
        if es is None:
            return []
        try:
            tickers = self._tickers(entities, filters)
            must: list[dict] = []
            if tickers:
                must.append({"terms": {"ticker": tickers}})
            should = [
                {"multi_match": {
                    "query": query,
                    "fields": ["metric_name^3", "period^2", "caption", "source_section"],
                    "type": "best_fields",
                    "fuzziness": "AUTO",
                }},
            ]
            body = {
                "size": top_k,
                "query": {"bool": {"must": must, "should": should, "minimum_should_match": 1}},
            }
            resp = await es.search(index=FINANCIALS_INDEX, body=body)
            hits = (resp.get("hits", {}) or {}).get("hits", []) if isinstance(resp, dict) else []

            output: list[RetrievalResult] = []
            for h in hits:
                s = h.get("_source", {}) or {}
                val = s.get("value_raw") or s.get("value_float")
                if val is None:
                    continue
                unit = s.get("unit", "")
                fact = (
                    f"[Financial Fact] {s.get('ticker', '')} — {s.get('metric_name', '')} "
                    f"({s.get('period', '')}): {val}{(' ' + unit) if unit else ''} "
                    f"[source: {s.get('filing_type', '')} {s.get('filing_date', '')}]"
                )
                output.append(RetrievalResult(
                    chunk_id=f"fin_{str(h.get('_id', ''))[:48]}",
                    document_id=s.get("document_id", "gravity_financials"),
                    text=fact,
                    score=float(h.get("_score", 1.0) or 1.0),
                    metadata=s,
                    ticker=s.get("ticker", ""),
                ))
            logger.info("structured_search_es", results=len(output), tickers=tickers)
            return output
        except Exception as e:
            logger.warning("structured_search_failed", error=str(e))
            return []
