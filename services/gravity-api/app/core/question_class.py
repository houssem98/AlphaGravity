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

# The four classes `WEB_RESEARCH_SEC_INTEGRATION.md` §4 adds. They are appended
# rather than folded into the existing seven because the existing names are
# load-bearing: `NEEDS_PRIMARY_SOURCE` gates the exact-fact path off them and
# `test_question_class.py` pins their behaviour. A question that classified as
# EXACT_FINANCIAL_FACT before this change still does.
#
# `FINANCIAL_ANALYSIS` from §4 is not added: it is exactly the existing
# FINANCIAL_CALCULATION / FILING_QUALITATIVE pair, and a third name for the same
# thing would make routing ambiguous rather than more precise.
COMPANY_RESEARCH = "COMPANY_RESEARCH"
MARKET_CONTEXT = "MARKET_CONTEXT"
MACRO = "MACRO"
GENERAL_WEB_RESEARCH = "GENERAL_WEB_RESEARCH"

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

# Facts about a company that are not in its financial statements. "Who are AMD's
# data-center customers" is answerable, and the answer is on the web — the 10-K
# names a concentration threshold, not a customer list.
#
# Deliberately narrow, and deliberately does NOT include "who is the CEO":
# that question is pinned to GENERAL by the existing tests and widening this
# regex to catch it would change a classification the repo already relies on.
_COMPANY_RESEARCH = re.compile(
    r"\b(customers?|clients?|suppliers?|vendors?|partners?|partnerships?|"
    r"market share|competitive landscape|product (?:line|portfolio|roadmap)|"
    r"subsidiar(?:y|ies)|headcount|employees|workforce|"
    r"acquisitions?|acquired|divestitures?|divested|spin-?off|"
    r"data ?cent(?:er|re)s?|manufacturing|supply chain|"
    r"business (?:units?|segments? overview)|go-to-market)\b",
    re.I,
)

# The economy rather than a company. No company term is required — these are
# questions where a filing is the wrong artefact entirely.
_MACRO = re.compile(
    r"\b(inflation|cpi\b|ppi\b|gdp\b|unemployment|jobs report|nonfarm|"
    r"interest rates?|fed(?:eral reserve)?\b|fomc|rate (?:cut|hike|decision)s?|"
    r"yield curve|treasury yields?|recession|monetary policy|fiscal policy|"
    r"tariffs?|trade war|oil prices?|commodity prices?|crude|opec|"
    r"exchange rates?|currency|dollar index|macro(?:economic)?)\b",
    re.I,
)

# The market around a company rather than the company: sector moves, peer
# comparisons framed as conditions, industry demand.
_MARKET_CONTEXT = re.compile(
    r"\b(sector|industry (?:trends?|conditions?|outlook|demand|dynamics)|"
    r"market (?:conditions?|environment|trends?|demand|outlook)|"
    r"peer group|peers\b|competitors? (?:are|have|in the)|"
    r"supply (?:and demand|glut|shortage)|pricing environment|"
    r"demand environment|end market)\b",
    re.I,
)

# Classes for which the authoritative-source path must run.
NEEDS_PRIMARY_SOURCE = frozenset(
    {EXACT_FINANCIAL_FACT, FINANCIAL_TABLE, FINANCIAL_CALCULATION}
)

# Classes where the answer is on the live web, not in a filing or the corpus.
# `MARKET_NEWS` is here for the reason §5 gives: a "latest / today" question that
# is answered from persisted evidence is answered wrongly, however good that
# evidence was when it was stored.
NEEDS_WEB_RESEARCH = frozenset(
    {MARKET_NEWS, COMPANY_RESEARCH, MARKET_CONTEXT, MACRO,
     GENERAL_WEB_RESEARCH, MULTI_DOCUMENT_RESEARCH}
)

# Classes where web evidence adds context around an authoritative SEC answer.
# The SEC leg leads; the web leg explains. Neither may supply the other's part.
WEB_AUGMENTED = frozenset({FINANCIAL_CALCULATION, FILING_QUALITATIVE})


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
    # The web classes sit below every filing class on purpose. A question that a
    # filing can answer is routed to the filing; these catch what is left, which
    # is precisely the material that is not in one.
    elif has_company and _COMPANY_RESEARCH.search(q):
        cls = COMPANY_RESEARCH
    elif _MACRO.search(q):
        cls = MACRO
    elif _MARKET_CONTEXT.search(q):
        cls = MARKET_CONTEXT
    else:
        cls = GENERAL

    return {
        "question_class": cls,
        "has_metric": has_metric,
        "has_period": has_period,
        "has_company": has_company,
        "needs_primary_source": cls in NEEDS_PRIMARY_SOURCE,
        "needs_web_research": cls in NEEDS_WEB_RESEARCH,
        "web_augmented": cls in WEB_AUGMENTED,
    }


# Overrides the class rather than joining it, for the same reason `_FRESH_INTENT`
# below does: a question can be classified as a calculation and still be
# answerable only from the filing's narrative. "Review the quarter's revenue and
# the drivers management gives in the MD&A" classifies as FINANCIAL_CALCULATION
# and reached the XBRL channels and no prose channel at all; "describe the
# business and who it competes with" classifies as FINANCIAL_TABLE and reached
# the same. Both are questions a filing answers in sentences.
_FILING_PROSE_INTENT = re.compile(
    r"\b(risk factors?|item\s+\d+[a-z]?|md&a|management.s discussion|"
    r"legal proceedings?|litigation|properties|competitors?|competitive|"
    r"competes|business description|reporting segments?|"
    r"guidance|outlook|liquidity|capital resources|"
    r"discloses?|disclosed|disclosures?)\b",
    re.I,
)


def route_channels(
    question_class: str, channels: list[str], query: str = ""
) -> list[str]:
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
        # `edgar_text` sits with them because the other four read the ingested
        # corpus, which covers the tickers ingestion happened to reach. A
        # qualitative question about any other registrant had no source at all
        # until this channel; with it the class answers from the filing itself.
        for c in ("dense", "bm25", "splade", "tree_nav", "edgar_text"):
            if c not in out:
                out.append(c)
    elif question_class == MARKET_NEWS:
        if "gdelt" not in out:
            out.append("gdelt")
    if question_class in NEEDS_WEB_RESEARCH or question_class in WEB_AUGMENTED:
        if "web" not in out:
            out.append("web")
    # Class-independent: what the filing says in sentences is not the property of
    # one label. `route_sources` still decides whether SEC is consulted at all.
    if _FILING_PROSE_INTENT.search(query or "") and "edgar_text" not in out:
        out.append("edgar_text")
    return out


# ── Source routing (§4) ───────────────────────────────────────────────────

# `FRESH_INTENT` is separate from the class because it can override one. §5:
# "do NOT force local-first for inherently fresh questions". A question that
# says "latest" is asking about now, and the persisted answer to the same words
# from three weeks ago is the wrong answer no matter how well it was verified.
_FRESH_INTENT = re.compile(
    r"\b(latest|current(?:ly)?|now|today|tonight|yesterday|this (?:week|morning|"
    r"month|quarter)|past (?:hour|day|week)|recent(?:ly)?|just (?:announced|"
    r"reported|released)|breaking|so far|as of (?:today|now)|up to date|"
    r"most recent|newest)\b",
    re.I,
)


class SourcePlan:
    """
    Which of the three source classes this question uses, and why.

    A plain object rather than a dict so the reasons travel with the decision —
    telemetry that says `web=True` without saying *why* cannot be debugged, and
    §28 asks for `sources_selected` and `sources_skipped` as separate fields.
    """

    __slots__ = ("question_class", "local", "sec", "web", "fresh", "reasons")

    def __init__(self, question_class, *, local, sec, web, fresh, reasons):
        self.question_class = question_class
        self.local = local
        self.sec = sec
        self.web = web
        self.fresh = fresh
        self.reasons = reasons

    @property
    def selected(self) -> list[str]:
        return [n for n, on in
                (("LOCAL", self.local), ("SEC", self.sec), ("WEB", self.web)) if on]

    @property
    def skipped(self) -> list[str]:
        return [n for n, on in
                (("LOCAL", self.local), ("SEC", self.sec), ("WEB", self.web)) if not on]

    def telemetry(self) -> dict:
        return {
            "question_class": self.question_class,
            "sources_selected": self.selected,
            "sources_skipped": self.skipped,
            "fresh_intent": self.fresh,
            "routing_reasons": dict(self.reasons),
        }

    def __repr__(self) -> str:
        return f"<SourcePlan {self.question_class} {'+'.join(self.selected) or 'none'}>"


def route_sources(question_class: str, query: str = "") -> SourcePlan:
    """
    Deterministic LOCAL / SEC / WEB routing, §4.

    Three rules, in this order:

    1. **A filing question goes to the filing.** The primary-source classes get
       SEC unconditionally. Whether SEC is actually *called* is not decided here
       — `evidence_gate` makes that call from real local rows, and this function
       must not pre-empt it, because the gate is the only thing that knows
       whether the local row is the right fact.

    2. **A fresh question does not get answered from storage.** `_FRESH_INTENT`
       turns the web leg on and turns the local shortcut off, for every class.
       This is the §5 carve-out and it is why the check is on the query text
       rather than on the class: "What was AAPL's latest revenue" is an exact-fact
       question *and* a fresh one.

    3. **Everything else follows its class.** Web for the research classes, web
       as context for the augmented ones, local-only for the rest.

    LOCAL is on almost everywhere because it is free — it is a lookup against
    rows already stored, and turning it off buys nothing. The only case where it
    is off is a fresh-intent question, where a stored answer is actively wrong.
    """
    q = query or ""
    fresh = bool(_FRESH_INTENT.search(q))
    reasons: dict[str, str] = {}

    sec = question_class in NEEDS_PRIMARY_SOURCE
    if sec:
        reasons["SEC"] = f"{question_class} requires an authoritative filed figure"

    web = question_class in NEEDS_WEB_RESEARCH
    if web:
        reasons["WEB"] = f"{question_class} is answered by live sources, not filings"
    elif question_class in WEB_AUGMENTED:
        web = True
        reasons["WEB"] = f"{question_class} uses web evidence as context around SEC facts"

    local = True
    reasons["LOCAL"] = "verified local evidence is checked first"

    if fresh:
        if not web:
            web = True
            reasons["WEB"] = "question asks for current information"
        else:
            reasons["WEB"] += "; question asks for current information"
        local = False
        reasons["LOCAL"] = ("skipped: question asks for current information and "
                            "persisted evidence cannot answer it")

    # A qualitative filing question still wants the filing text, even though it
    # is not an exact-fact class — the prose lives in the 10-K.
    if question_class in (FILING_QUALITATIVE, MULTI_DOCUMENT_RESEARCH) and not sec:
        sec = True
        reasons["SEC"] = f"{question_class} draws on filing prose"

    return SourcePlan(question_class, local=local, sec=sec, web=web,
                      fresh=fresh, reasons=reasons)
