"""
Deterministic question classification, ahead of retrieval.

`FIX_SECFILING.md` §3 asks for a `question_class` computed *before* retrieval, and
§12 for a routing policy keyed off it. The reason is concrete rather than
architectural: today the live EDGAR channel is added to the plan only when
`query_understanding` — an LLM call — labels the intent `calculation` or
`simple_lookup`, or the query happens to match a keyword regex. When that call is
slow, quota-limited or simply wrong about the label, the exact-fact path silently
does not run, and the user gets "no evidence" for a figure sitting in a filing.

A question about an exact financial fact is recognisable from its own words. This
module decides that with regexes and no network, so the routing cannot be lost to
a model's mood, and the LLM's own plan is treated as an addition rather than an
authority.

The classes are §3's, verbatim. `route_channels` implements §12's policy while
*adding* to the existing fan-out rather than replacing it — narrowing the channel
set on a deterministic guess would trade a recall bug for a worse one, and the
repository's own doctrine (`GRAVITY_LOOP.sh` rule 2) is that selection problems
are not fixed by turning sources off.
"""

from __future__ import annotations

import re

EXACT_FINANCIAL_FACT = "EXACT_FINANCIAL_FACT"
FINANCIAL_TABLE = "FINANCIAL_TABLE"
FINANCIAL_CALCULATION = "FINANCIAL_CALCULATION"
FILING_QUALITATIVE = "FILING_QUALITATIVE"
MULTI_DOCUMENT_RESEARCH = "MULTI_DOCUMENT_RESEARCH"
MARKET_NEWS = "MARKET_NEWS"
GENERAL = "GENERAL"

# A line item someone can ask for by name. Kept in step with the EDGAR channel's
# own metric table — this decides whether the exact-fact path runs at all, so a
# metric missing here is a metric that silently falls back to prose search.
_METRIC = re.compile(
    r"\b(revenue|revenues|sales|net income|net loss|earnings|eps|profit|"
    r"gross margin|operating margin|margin|assets|liabilities|equity|"
    r"cash flow|cash|inventory|inventories|cogs|cost of revenue|"
    r"cost of goods|ebitda|ebit|operating income|operating expenses|opex|"
    r"capex|capital expenditure|r&d|research and development|sg&a|"
    r"interest expense|net interest income|book value|dividend|buyback|"
    r"shares outstanding|free cash flow|fcf|backlog|deferred revenue)\b",
    re.I,
)

# A period pins the question to a filing rather than to the present.
_PERIOD = re.compile(
    r"\bq[1-4]\b|\bfy\s?(?:19|20)\d{2}\b|\bfiscal\s+(?:year\s+)?(?:19|20)\d{2}\b|"
    r"\b(?:19|20)\d{2}\b|\b[1-4](?:st|nd|rd|th)\s+quarter\b|"
    r"\b(?:first|second|third|fourth)\s+quarter\b|\blast\s+quarter\b|"
    r"\bfull\s+year\b|\btrailing\s+twelve\b|\bttm\b",
    re.I,
)

_CALC = re.compile(
    r"\b(grow(?:th|n)?|increase[ds]?|decrease[ds]?|decline[ds]?|change[ds]?|"
    r"ratio|per share|yoy|year[- ]over[- ]year|cagr|compare[ds]?|comparison|"
    r"versus|vs\.?|faster|slower|higher|lower|difference|multiple|"
    r"how much more|percent(?:age)?)\b",
    re.I,
)

_TABLE = re.compile(
    r"\b(table|breakdown|by segment|by region|by geography|by product|"
    r"segment[s]?\b|line items?|income statement|balance sheet|"
    r"cash flow statement|statement of operations|schedule of)\b",
    re.I,
)

_QUALITATIVE = re.compile(
    r"\b(risk factors?|risks?|management discussion|md&a|outlook|guidance|"
    r"strategy|competition|competitors?|legal proceedings|litigation|"
    r"going concern|why|explain|discuss|describe|commentary|"
    r"what did .* say|tone|sentiment)\b",
    re.I,
)

_NEWS = re.compile(
    r"\b(news|today|yesterday|this week|breaking|announced|announcement|"
    r"headline|stock price|share price|market reaction|analyst rating|"
    r"upgrade[ds]?|downgrade[ds]?|price target)\b",
    re.I,
)

# Capitalised words that start a question rather than name a company.
_SENTENCE_OPENERS = frozenset(
    "What Whats How Why When Where Who Which Did Do Does Is Was Were Are "
    "Show Give Tell List Compare Any Build Can Could Should Would Please "
    "Find Get Explain Describe Discuss Summarize Summarise A An The In On For".split()
)

_RESEARCH = re.compile(
    r"\b(thesis|investment case|bull case|bear case|deep dive|"
    r"comprehensive|overview of|research report|due diligence|"
    r"should i (?:buy|sell|invest)|valuation|dcf|initiate coverage)\b",
    re.I,
)

# Classes for which the authoritative-source path must run.
NEEDS_PRIMARY_SOURCE = frozenset(
    {EXACT_FINANCIAL_FACT, FINANCIAL_TABLE, FINANCIAL_CALCULATION}
)


def classify(query: str, entities: dict | None = None) -> dict:
    """
    The question's class, plus the parts of it retrieval needs.

    `entities` is the resolved-company map when query understanding has already
    run; it is optional, and its absence only weakens the company signal — it
    never changes a class from financial to non-financial, because a question
    about revenue in a named quarter is an exact-fact question whether or not an
    LLM managed to resolve the ticker.
    """
    q = query or ""
    companies = list((entities or {}).get("companies") or [])
    # A capitalised token is a weak company signal, enough to keep the financial
    # classes reachable when entity resolution failed or never ran. Sentence
    # openers are excluded rather than the first character being sliced off —
    # slicing loses the company whenever the company *is* the first word, which
    # is exactly how these questions are usually typed ("Apple revenue FY2025").
    has_company = bool(companies) or any(
        w not in _SENTENCE_OPENERS
        for w in re.findall(r"\b[A-Z][A-Za-z.&-]+\b", q)
    )

    has_metric = bool(_METRIC.search(q))
    has_period = bool(_PERIOD.search(q))

    if _NEWS.search(q) and not has_period:
        cls = MARKET_NEWS
    elif _RESEARCH.search(q):
        cls = MULTI_DOCUMENT_RESEARCH
    elif has_metric and _CALC.search(q):
        cls = FINANCIAL_CALCULATION
    elif _TABLE.search(q) and (has_metric or has_company):
        # A statement or breakdown is a financial-table ask even when no line
        # item is named — "Apple income statement" names no metric the keyword
        # table knows, and is unmistakably financial.
        cls = FINANCIAL_TABLE
    elif has_metric and has_company and has_period:
        cls = EXACT_FINANCIAL_FACT
    elif has_metric and has_company:
        # No period named. Still an exact-fact ask — "what is Apple's revenue"
        # wants the latest filed figure, not a paragraph about revenue.
        cls = EXACT_FINANCIAL_FACT
    elif _QUALITATIVE.search(q):
        cls = FILING_QUALITATIVE
    else:
        cls = GENERAL

    return {
        "question_class": cls,
        "has_metric": has_metric,
        "has_period": has_period,
        "has_company": has_company,
        "needs_primary_source": cls in NEEDS_PRIMARY_SOURCE,
    }


def route_channels(question_class: str, channels: list[str]) -> list[str]:
    """
    §12's routing policy: send the question to the evidence system that can
    answer it, without switching the others off.

    For the financial classes this guarantees `edgar` and `structured` run. That
    guarantee is the point — it is what stops an LLM's intent label from being
    the reason an exact figure was never looked up.
    """
    out = list(channels or [])
    if question_class in NEEDS_PRIMARY_SOURCE:
        for c in ("structured", "edgar"):
            if c not in out:
                out.append(c)
    elif question_class == FILING_QUALITATIVE:
        for c in ("dense", "bm25", "splade", "tree_nav"):
            if c not in out:
                out.append(c)
    elif question_class == MARKET_NEWS:
        if "gdelt" not in out:
            out.append("gdelt")
    return out
