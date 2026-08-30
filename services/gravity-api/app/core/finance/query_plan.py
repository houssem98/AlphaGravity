"""
What a finance question is actually asking for, decided before retrieval.

`question_class.classify` answers "what kind of question is this" in one label,
which is what channel routing needs. It does not answer the questions the
*answer* needs: which metric, for which period, compared against what, and over
how many companies. Today those are re-derived downstream, sometimes by a
prompt, and a plan that lives only inside a model's head cannot be tested.

So this produces a `FinancePlan` — a plain dataclass, from regexes and the
existing classifier, with no network and no model call. Same query, same plan,
every time. Three things follow from that which matter more than the tidiness:

**The comparison kind is decided here, not inferred from what came back.**
"Revenue growth in Q2" and "revenue growth versus last year" want different
denominators, and picking one after seeing the retrieved rows means the answer
is shaped by what happened to be found.

**A ranking question is recognised as a ranking question.** "Which S&P 500
companies mentioned tariff risk" is not a lookup with an unusual entity; it is
a scoped set question, and answering it as a lookup is how a five-company
sample becomes a census. The plan carries `scope`, which
`app/core/skills/scope.py` then holds the system to.

**A margin question is marked as a rate.** That single flag is what stops
"operating margin change" being reported as a percent change of a percentage —
see `period_math.delta`.

Nothing here decides whether the answer is available. It decides what was
asked, which is a separate and prior question.
"""

from __future__ import annotations

import re
from dataclasses import dataclass, field
from enum import Enum

from app.core.finance.period_math import Basis
from app.core.skills.period import RequestedPeriod, parse_period

__all__ = [
    "ComparisonKind", "FinanceIntent", "FinancePlan", "MetricRequest",
    "ScopeRequest", "plan_query",
]


class FinanceIntent(str, Enum):
    """What the asker wants done with the numbers."""

    LOOKUP = "lookup"                 # one figure, one company, one period
    GROWTH = "growth"                 # change between two periods
    MARGIN = "margin"                 # a ratio within one period
    COMPARISON = "comparison"         # two or more companies side by side
    RANKING = "ranking"               # order or select across a set
    GUIDANCE = "guidance"             # forward-looking statements
    RISK = "risk"                     # risk factors, tariffs, trade exposure
    SENTIMENT = "sentiment"           # tone of disclosure
    FILINGS = "filings"               # which documents exist
    UNKNOWN = "unknown"


class ComparisonKind(str, Enum):
    NONE = "none"
    YOY = "yoy"
    QOQ = "qoq"
    CAGR = "cagr"
    SEQUENTIAL = "sequential"
    CROSS_COMPANY = "cross_company"
    VS_GUIDANCE = "vs_guidance"


@dataclass(frozen=True)
class MetricRequest:
    """One metric the question names, with the basis that governs its maths."""

    key: str
    label: str
    basis: Basis = Basis.FLOW

    @property
    def is_rate(self) -> bool:
        return self.basis is Basis.RATE


@dataclass(frozen=True)
class ScopeRequest:
    """The set a question ranges over, when it ranges over more than one name."""

    universe: str = ""
    size_hint: int = 0
    top_n: int = 0
    is_set_question: bool = False


@dataclass
class FinancePlan:
    intent: FinanceIntent = FinanceIntent.UNKNOWN
    metrics: list[MetricRequest] = field(default_factory=list)
    period: RequestedPeriod = field(default_factory=RequestedPeriod)
    comparison: ComparisonKind = ComparisonKind.NONE
    scope: ScopeRequest = field(default_factory=ScopeRequest)
    companies: list[str] = field(default_factory=list)
    ttm: bool = False
    question_class: str = ""
    needs_primary_source: bool = False

    @property
    def is_multi_company(self) -> bool:
        return len(self.companies) > 1 or self.scope.is_set_question

    @property
    def primary_metric(self) -> MetricRequest | None:
        return self.metrics[0] if self.metrics else None

    @property
    def change_unit(self) -> str:
        """
        The unit a change in this metric must be reported in.

        "Operating margin year-over-year" is a growth-shaped question about a
        rate, and the honest answer is in percentage points. Leaving that to be
        inferred downstream is how a margin moving 20% -> 25% gets published as
        "+25%", which is a different and much larger-sounding claim. The plan
        states it so no later stage has to work it out.
        """
        if self.comparison is ComparisonKind.NONE:
            return ""
        m = self.primary_metric
        return "pp" if (m and m.is_rate) else "%"

    def as_dict(self) -> dict:
        return {
            "intent": self.intent.value,
            "metrics": [
                {"key": m.key, "label": m.label, "basis": m.basis.value}
                for m in self.metrics
            ],
            "period": self.period.label,
            "comparison": self.comparison.value,
            "change_unit": self.change_unit,
            "ttm": self.ttm,
            "companies": self.companies,
            "scope": {
                "universe": self.scope.universe,
                "size_hint": self.scope.size_hint,
                "top_n": self.scope.top_n,
                "is_set_question": self.scope.is_set_question,
            },
            "question_class": self.question_class,
            "needs_primary_source": self.needs_primary_source,
        }


# ── Metric vocabulary ─────────────────────────────────────────────────────
#
# Ordered longest-phrase-first within each entry so "operating income" is not
# matched by the "income" in "net income", and so "gross profit" and "gross
# margin" land on different metrics with different bases.

_METRICS: list[tuple[str, str, Basis, str]] = [
    ("free_cash_flow", "Free cash flow", Basis.FLOW,
     r"free\s+cash\s+flow|\bfcf\b"),
    ("operating_cash_flow", "Operating cash flow", Basis.FLOW,
     r"operating\s+cash\s+flow|cash\s+from\s+operations|\bcfo\b"),
    ("gross_margin", "Gross margin", Basis.RATE, r"gross\s+margin"),
    ("operating_margin", "Operating margin", Basis.RATE,
     r"operating\s+margin"),
    ("net_margin", "Net margin", Basis.RATE,
     r"net\s+margin|net\s+profit\s+margin|profit\s+margin"),
    ("ebitda_margin", "EBITDA margin", Basis.RATE, r"ebitda\s+margin"),
    ("gross_profit", "Gross profit", Basis.FLOW, r"gross\s+profit"),
    ("operating_income", "Operating income", Basis.FLOW,
     r"operating\s+income|operating\s+profit|\bebit\b"),
    ("ebitda", "EBITDA", Basis.FLOW, r"\bebitda\b"),
    ("net_income", "Net income", Basis.FLOW,
     r"net\s+income|net\s+loss|net\s+earnings|bottom\s+line"),
    ("eps", "EPS", Basis.COUNT,
     r"\beps\b|earnings\s+per\s+share"),
    # The compound-revenue metrics sit above bare `revenue` for the same reason
    # `gross margin` sits above `net margin`: the shorter pattern is a substring
    # of the longer one, and whichever is tried first wins the span.
    ("cost_of_revenue", "Cost of revenue", Basis.FLOW,
     r"cost\s+of\s+revenue|cost\s+of\s+goods|\bcogs\b"),
    ("deferred_revenue", "Deferred revenue", Basis.STOCK, r"deferred\s+revenue"),
    ("revenue", "Revenue", Basis.FLOW,
     r"revenue|revenues|net\s+sales|total\s+sales|\bsales\b|top\s+line"),
    ("rnd", "R&D expense", Basis.FLOW,
     r"\br\s*&\s*d\b|research\s+and\s+development"),
    ("sgna", "SG&A", Basis.FLOW, r"\bsg\s*&\s*a\b|selling,?\s+general"),
    ("capex", "Capital expenditure", Basis.FLOW,
     r"\bcapex\b|capital\s+expenditure"),
    ("cash", "Cash and equivalents", Basis.STOCK,
     r"cash\s+and\s+(?:cash\s+)?equivalents|\bcash\s+position\b|\bcash\b"),
    ("total_debt", "Total debt", Basis.STOCK,
     r"total\s+debt|long[- ]term\s+debt|\bdebt\b"),
    ("total_assets", "Total assets", Basis.STOCK, r"total\s+assets|\bassets\b"),
    ("equity", "Shareholders' equity", Basis.STOCK,
     r"shareholders?.?\s+equity|stockholders?.?\s+equity|book\s+value"),
    ("shares_outstanding", "Shares outstanding", Basis.COUNT,
     r"shares\s+outstanding|share\s+count|diluted\s+shares"),
    ("dividend", "Dividend", Basis.FLOW, r"dividend"),
    ("backlog", "Backlog", Basis.STOCK, r"backlog"),
    ("headcount", "Headcount", Basis.COUNT,
     r"headcount|employees|number\s+of\s+people"),
]

_METRIC_RES = [(k, lbl, b, re.compile(p, re.I)) for k, lbl, b, p in _METRICS]

_TTM_RE = re.compile(r"\bttm\b|trailing\s+twelve|last\s+twelve\s+months?", re.I)
_CAGR_RE = re.compile(r"\bcagr\b|compound\s+annual", re.I)
_YOY_RE = re.compile(r"year[- ]over[- ]year|\byoy\b|y/y|"
                     r"(?:versus|vs\.?|compared\s+(?:to|with))\s+(?:the\s+)?"
                     r"(?:same\s+quarter\s+)?last\s+year|from\s+a\s+year\s+ago",
                     re.I)
_QOQ_RE = re.compile(r"quarter[- ]over[- ]quarter|\bqoq\b|q/q|sequential", re.I)
_GROWTH_RE = re.compile(
    r"\bgrow(?:th|n|ing)?\b|\bincrease[ds]?\b|\bdecrease[ds]?\b|\bdecline[ds]?\b|"
    r"\bchange[ds]?\b|\brose\b|\bfell\b|\bup\b|\bdown\b|how\s+much\s+more",
    re.I,
)
_GUIDANCE_RE = re.compile(
    r"\bguidance\b|\bguide[ds]?\b|\boutlook\b|\bforecast\b|\bexpect(?:s|ed)?\b|"
    r"next\s+(?:quarter|year)|full[- ]year\s+(?:view|target)", re.I,
)
_RISK_RE = re.compile(
    r"\brisk\s+factors?\b|\brisks?\b|\btariffs?\b|\btrade\s+war\b|"
    r"\btrade\s+(?:risk|policy|restriction)|\bsanctions?\b|\bexport\s+control|"
    r"\bsupply\s+chain\s+risk|\bgeopolitical\b|\bsection\s+301\b", re.I,
)
_SENTIMENT_RE = re.compile(
    r"\bsentiment\b|\btone\b|\bbullish\b|\bbearish\b|\boptimistic\b|"
    r"\bpessimistic\b|how\s+(?:positive|negative)|\bmood\b", re.I,
)
_FILINGS_RE = re.compile(
    r"\b10-?k\b|\b10-?q\b|\b8-?k\b|\bdef\s*14a\b|\bproxy\b|\bfilings?\b|"
    r"\bannual\s+report\b|\bquarterly\s+report\b", re.I,
)
_COMPARE_RE = re.compile(
    r"\b(?:versus|vs\.?|compared\s+(?:to|with)|compare)\b|\bbetween\b.+\band\b|"
    r"\bwhich\s+(?:one\s+)?(?:has|is|had)\b|\bhigher\s+than\b|\bbetter\s+than\b",
    re.I,
)
_RANKING_RE = re.compile(
    r"\bwhich\s+(?:companies|firms|issuers|stocks)\b|\bhow\s+many\s+companies\b|"
    r"\btop\s+\d+\b|\brank(?:ed|ing)?\b|\blargest\b|\bsmallest\b|\bbiggest\b|"
    r"\bmost\b\s+\w+\s+\bcompanies\b|\ball\s+companies\b|\blist\s+(?:the\s+)?companies\b",
    re.I,
)
# Wide on purpose. A three-digit cap made "top 1000 companies" parse as top_n=0,
# which downstream reads as "no limit requested" — the opposite of what was
# asked. Capturing an absurd N is harmless (the scope layer still refuses to
# claim exhaustiveness); silently dropping it is not.
_TOP_N_RE = re.compile(r"\btop\s+(\d{1,12})\b", re.I)

#: Named universes and their sizes. A size here is a fact about the index, not
#: a claim that its membership was retrieved — `scope.Universe.enumerable`
#: stays False until something actually fetches the constituents.
_UNIVERSES: list[tuple[str, int, str]] = [
    ("the S&P 500", 503, r"s\s*&\s*p\s*500|sp500|s&p500"),
    ("the Nasdaq-100", 101, r"nasdaq[- ]?100|ndx\b"),
    ("the Dow Jones Industrial Average", 30, r"dow\s+jones|\bdjia\b|the\s+dow\b"),
    ("the Russell 2000", 2000, r"russell\s*2000"),
    ("the Fortune 500", 500, r"fortune\s*500"),
    ("the S&P 100", 101, r"s\s*&\s*p\s*100"),
]
_UNIVERSE_RES = [(n, s, re.compile(p, re.I)) for n, s, p in _UNIVERSES]


def _metrics_in(q: str) -> list[MetricRequest]:
    """
    Every metric the question names, in the order the vocabulary prefers.

    Overlapping matches are resolved by consuming the matched span: "gross
    margin" is found first and removes those words, so the "margin" inside it
    cannot also register as net margin. Without that, "gross margin" produced
    two metrics and the answer picked whichever came first.
    """
    text = q
    found: list[MetricRequest] = []
    for key, label, basis, rx in _METRIC_RES:
        m = rx.search(text)
        if not m:
            continue
        found.append(MetricRequest(key, label, basis))
        text = text[:m.start()] + " " * (m.end() - m.start()) + text[m.end():]
    return found


def _scope_in(q: str) -> ScopeRequest:
    universe, size = "", 0
    for name, n, rx in _UNIVERSE_RES:
        if rx.search(q):
            universe, size = name, n
            break
    top = _TOP_N_RE.search(q)
    is_set = bool(_RANKING_RE.search(q)) or bool(universe)
    return ScopeRequest(universe=universe, size_hint=size,
                        top_n=int(top.group(1)) if top else 0,
                        is_set_question=is_set)


def _comparison_in(q: str, multi: bool) -> ComparisonKind:
    if _CAGR_RE.search(q):
        return ComparisonKind.CAGR
    if _YOY_RE.search(q):
        return ComparisonKind.YOY
    if _QOQ_RE.search(q):
        return ComparisonKind.QOQ
    if _GUIDANCE_RE.search(q) and _COMPARE_RE.search(q):
        return ComparisonKind.VS_GUIDANCE
    if multi:
        return ComparisonKind.CROSS_COMPANY
    if _GROWTH_RE.search(q):
        # Growth with no interval named. A quarter defaults to year-over-year
        # because that is what "did revenue grow" means about a quarter in
        # every filing that reports it; an annual period can only be YoY.
        return ComparisonKind.YOY
    return ComparisonKind.NONE


def _intent_in(q: str, metrics: list[MetricRequest], scope: ScopeRequest,
               comparison: ComparisonKind, multi: bool) -> FinanceIntent:
    # Order matters: a ranking question that also names a metric is still a
    # ranking question, and answering it as a lookup is the census bug.
    if scope.is_set_question:
        return FinanceIntent.RANKING
    if _SENTIMENT_RE.search(q):
        return FinanceIntent.SENTIMENT
    if _RISK_RE.search(q):
        return FinanceIntent.RISK
    if _GUIDANCE_RE.search(q):
        return FinanceIntent.GUIDANCE
    if multi or comparison is ComparisonKind.CROSS_COMPANY:
        return FinanceIntent.COMPARISON
    if comparison in (ComparisonKind.YOY, ComparisonKind.QOQ,
                      ComparisonKind.CAGR, ComparisonKind.SEQUENTIAL):
        return FinanceIntent.GROWTH
    if metrics and metrics[0].is_rate:
        return FinanceIntent.MARGIN
    if metrics:
        return FinanceIntent.LOOKUP
    if _FILINGS_RE.search(q):
        return FinanceIntent.FILINGS
    return FinanceIntent.UNKNOWN


def plan_query(query: str, *, companies: list[str] | None = None,
               entities: dict | None = None) -> FinancePlan:
    """
    The plan for one finance question. Pure, deterministic, no network.

    `companies` is the resolved list when entity resolution has already run.
    Its absence weakens only the multi-company signal; it never turns a
    financial question into a non-financial one, matching the existing
    classifier's rule.
    """
    from app.core.question_class import NEEDS_PRIMARY_SOURCE, classify

    q = query or ""
    names = list(companies or (entities or {}).get("companies") or [])
    metrics = _metrics_in(q)
    scope = _scope_in(q)
    period = parse_period(q)
    multi = len(names) > 1
    comparison = _comparison_in(q, multi)
    intent = _intent_in(q, metrics, scope, comparison, multi)
    cls = classify(q, entities)

    return FinancePlan(
        intent=intent,
        metrics=metrics,
        period=period,
        comparison=comparison,
        scope=scope,
        companies=names,
        ttm=bool(_TTM_RE.search(q)),
        question_class=cls["question_class"],
        needs_primary_source=cls["question_class"] in NEEDS_PRIMARY_SOURCE,
    )
