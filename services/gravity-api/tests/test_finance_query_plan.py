"""
Finance query planning: what was asked, decided before anything is retrieved.

The plan must be a function of the question alone. If a plan can be changed by
what retrieval happened to return, then the shape of the answer is decided by
the evidence rather than the question, and a thin result quietly becomes a
different — easier — question than the one typed.
"""

from __future__ import annotations

import pytest

from app.core.finance.period_math import Basis
from app.core.finance.query_plan import (
    ComparisonKind, FinanceIntent, plan_query,
)


def keys(plan):
    return [m.key for m in plan.metrics]


# ── Metrics ───────────────────────────────────────────────────────────────


@pytest.mark.parametrize("q,expected", [
    ("What was Apple revenue in FY2025?", "revenue"),
    ("NVIDIA net income last quarter", "net_income"),
    ("Microsoft operating income FY2025", "operating_income"),
    ("Tesla gross profit 2025", "gross_profit"),
    ("Amazon free cash flow", "free_cash_flow"),
    ("Google diluted EPS Q2 2025", "eps"),
    ("Meta capex 2025", "capex"),
    ("Intel R&D expense", "rnd"),
    ("JPMorgan total assets", "total_assets"),
    ("Costco shares outstanding", "shares_outstanding"),
    ("Nike backlog", "backlog"),
    ("Salesforce deferred revenue", "deferred_revenue"),
    ("Boeing headcount 2025", "headcount"),
    ("Ford total debt", "total_debt"),
    ("Pfizer EBITDA FY2025", "ebitda"),
])
def test_the_named_metric_is_the_first_metric(q, expected):
    assert keys(plan_query(q))[0] == expected


def test_gross_margin_is_one_metric_not_two():
    """`margin` inside `gross margin` must not also register as net margin."""
    assert keys(plan_query("Apple gross margin FY2025")) == ["gross_margin"]


def test_operating_margin_does_not_also_match_operating_income():
    assert keys(plan_query("NVIDIA operating margin")) == ["operating_margin"]


def test_a_question_naming_two_metrics_keeps_both():
    k = keys(plan_query("Apple revenue and net income FY2025"))
    assert "revenue" in k and "net_income" in k


@pytest.mark.parametrize("q,basis", [
    ("Apple revenue", Basis.FLOW),
    ("Apple gross margin", Basis.RATE),
    ("Apple cash", Basis.STOCK),
    ("Apple EPS", Basis.COUNT),
])
def test_each_metric_carries_the_basis_that_governs_its_maths(q, basis):
    assert plan_query(q).metrics[0].basis is basis


def test_a_margin_is_flagged_as_a_rate():
    """The flag that stops a margin move being reported as a percent change."""
    assert plan_query("Apple operating margin FY2025").metrics[0].is_rate


def test_an_amount_is_not_a_rate():
    assert not plan_query("Apple operating income FY2025").metrics[0].is_rate


# ── Periods ───────────────────────────────────────────────────────────────


@pytest.mark.parametrize("q,label", [
    ("Apple revenue FY2025", "FY2025"),
    ("Apple revenue Q2 2025", "FY2025Q2"),
    ("Apple revenue in the third quarter of 2024", "FY2024Q3"),
    ("Apple revenue", "latest"),
    ("Apple latest revenue", "latest"),
])
def test_the_period_is_parsed_from_the_question(q, label):
    assert plan_query(q).period.label == label


@pytest.mark.parametrize("q", [
    "Apple TTM revenue", "Apple trailing twelve month revenue",
    "Apple revenue last twelve months",
])
def test_trailing_twelve_months_is_recognised(q):
    assert plan_query(q).ttm


def test_an_ordinary_question_is_not_ttm():
    assert not plan_query("Apple revenue FY2025").ttm


# ── Comparison kind ───────────────────────────────────────────────────────


@pytest.mark.parametrize("q,kind", [
    ("Apple revenue year-over-year", ComparisonKind.YOY),
    ("Apple revenue YoY growth", ComparisonKind.YOY),
    ("Apple Q2 revenue versus last year", ComparisonKind.YOY),
    ("Apple revenue quarter-over-quarter", ComparisonKind.QOQ),
    ("Apple sequential revenue growth", ComparisonKind.QOQ),
    ("Apple revenue CAGR 2020 to 2025", ComparisonKind.CAGR),
    ("Apple revenue FY2025", ComparisonKind.NONE),
])
def test_the_comparison_is_decided_from_the_question(q, kind):
    assert plan_query(q).comparison is kind


def test_bare_growth_defaults_to_year_over_year():
    assert plan_query("Did Apple revenue grow?").comparison is ComparisonKind.YOY


def test_two_companies_make_it_a_cross_company_comparison():
    p = plan_query("Apple versus Microsoft revenue",
                   companies=["AAPL", "MSFT"])
    assert p.comparison is ComparisonKind.CROSS_COMPANY
    assert p.is_multi_company


def test_cagr_wins_over_a_bare_growth_word():
    assert plan_query("Apple revenue growth CAGR").comparison is ComparisonKind.CAGR


# ── Intent ────────────────────────────────────────────────────────────────


@pytest.mark.parametrize("q,intent", [
    ("Apple revenue FY2025", FinanceIntent.LOOKUP),
    ("Apple revenue growth year-over-year", FinanceIntent.GROWTH),
    ("Apple operating margin FY2025", FinanceIntent.MARGIN),
    ("What guidance did Apple give for next quarter?", FinanceIntent.GUIDANCE),
    ("What risk factors did Apple disclose?", FinanceIntent.RISK),
    ("What is the sentiment in Apple's 10-K?", FinanceIntent.SENTIMENT),
    ("Which S&P 500 companies mentioned tariff risk in their 10-K?",
     FinanceIntent.RANKING),
    ("List Apple's 10-K filings", FinanceIntent.FILINGS),
])
def test_intent(q, intent):
    assert plan_query(q).intent is intent


def test_tariffs_are_a_risk_question():
    assert plan_query("How exposed is Apple to tariffs?").intent is FinanceIntent.RISK


@pytest.mark.parametrize("q", [
    "Apple trade war exposure", "Apple export controls",
    "Apple Section 301 impact", "Apple supply chain risk",
])
def test_trade_risk_vocabulary_reaches_the_risk_intent(q):
    assert plan_query(q).intent is FinanceIntent.RISK


def test_a_two_company_question_is_a_comparison():
    p = plan_query("Compare Apple and Microsoft revenue",
                   companies=["AAPL", "MSFT"])
    assert p.intent is FinanceIntent.COMPARISON


def test_a_ranking_question_beats_the_metric_it_also_names():
    """Otherwise a set question is answered as a lookup — the census bug."""
    p = plan_query("Which companies had the highest revenue in 2025?")
    assert p.intent is FinanceIntent.RANKING
    assert "revenue" in keys(p)


# ── Scope ─────────────────────────────────────────────────────────────────


@pytest.mark.parametrize("q,name,size", [
    ("Which S&P 500 companies mentioned tariffs?", "the S&P 500", 503),
    ("Which Nasdaq-100 companies grew revenue?", "the Nasdaq-100", 101),
    ("Which Dow Jones companies pay dividends?",
     "the Dow Jones Industrial Average", 30),
    ("Which Russell 2000 companies are profitable?", "the Russell 2000", 2000),
])
def test_a_named_index_is_recognised_with_its_size(q, name, size):
    s = plan_query(q).scope
    assert s.universe == name
    assert s.size_hint == size
    assert s.is_set_question


def test_top_n_is_captured():
    assert plan_query("Top 10 companies by revenue").scope.top_n == 10


def test_a_single_company_question_is_not_a_set_question():
    assert not plan_query("Apple revenue FY2025").scope.is_set_question


def test_a_set_question_with_no_named_index_is_still_a_set_question():
    """Universe unknown is not the same as no universe — and blocks exhaustive."""
    s = plan_query("Which companies mentioned tariff risk?").scope
    assert s.is_set_question
    assert s.universe == ""
    assert s.size_hint == 0


def test_recognising_the_index_size_is_not_a_claim_the_members_were_fetched():
    """
    503 is a fact about the index, not evidence of coverage.

    The plan may carry the size; only `scope.Universe.enumerable` — set by
    something that actually retrieved constituents — can unlock EXHAUSTIVE.
    """
    from app.core.skills.scope import Universe, assess, classify_member

    s = plan_query("Which S&P 500 companies mentioned tariffs?").scope
    uni = Universe(name=s.universe, size=s.size_hint, enumerable=False)
    r = assess([classify_member("cik:1", source_class="sec_filing",
                                supported=True)], uni, examined=503)
    assert not r.claims_exhaustive


# ── Determinism and serialization ─────────────────────────────────────────


QUERIES = [
    "Apple revenue FY2025",
    "Which S&P 500 companies mentioned tariff risk in their 10-K?",
    "NVIDIA operating margin year-over-year",
    "Compare Apple and Microsoft free cash flow",
    "What guidance did Tesla give?",
    "",
]


@pytest.mark.parametrize("q", QUERIES)
def test_the_same_question_always_plans_the_same_way(q):
    first = plan_query(q).as_dict()
    for _ in range(50):
        assert plan_query(q).as_dict() == first


@pytest.mark.parametrize("q", QUERIES)
def test_every_plan_serializes(q):
    d = plan_query(q).as_dict()
    assert set(d) >= {"intent", "metrics", "period", "comparison", "scope",
                      "ttm", "companies", "question_class"}


def test_an_empty_question_plans_to_unknown_without_raising():
    p = plan_query("")
    assert p.intent is FinanceIntent.UNKNOWN
    assert p.metrics == []
    assert p.period.label == "latest"


def test_planning_makes_no_network_call():
    """A plan that needs the network is not available before retrieval."""
    import socket

    real = socket.socket

    def boom(*a, **k):
        raise AssertionError("plan_query attempted a network connection")

    socket.socket = boom
    try:
        for q in QUERIES:
            plan_query(q)
    finally:
        socket.socket = real


# ── Substring shadowing ───────────────────────────────────────────────────
#
# Found by this suite: `revenue` was tried before `deferred revenue`, so
# "Salesforce deferred revenue" planned as a revenue lookup. A deferred-revenue
# balance is a liability, not a revenue flow, and the two differ by an order of
# magnitude — the answer would have been confidently wrong with a real citation
# attached. Every metric whose name contains another metric's name is pinned
# here, because the vocabulary is ordered by hand and re-ordering it is easy.


@pytest.mark.parametrize("q,expected", [
    ("Salesforce deferred revenue", "deferred_revenue"),
    ("Apple cost of revenue FY2025", "cost_of_revenue"),
    ("Apple cost of goods sold", "cost_of_revenue"),
    ("Apple gross margin", "gross_margin"),
    ("Apple operating margin", "operating_margin"),
    ("Apple net margin", "net_margin"),
    ("Apple EBITDA margin", "ebitda_margin"),
    ("Apple gross profit", "gross_profit"),
    ("Apple operating income", "operating_income"),
    ("Apple net income", "net_income"),
    ("Apple operating cash flow", "operating_cash_flow"),
    ("Apple free cash flow", "free_cash_flow"),
])
def test_a_longer_metric_name_is_not_shadowed_by_a_shorter_one(q, expected):
    assert keys(plan_query(q))[0] == expected


def test_each_metric_key_appears_at_most_once_in_the_vocabulary():
    """A duplicate entry makes the later one unreachable and silently dead."""
    from app.core.finance.query_plan import _METRICS

    seen = [k for k, *_ in _METRICS]
    assert len(seen) == len(set(seen)), \
        [k for k in seen if seen.count(k) > 1]


def test_no_metric_is_wholly_unreachable():
    """Every key must be producible by some question, or it is dead config."""
    from app.core.finance.query_plan import _METRICS

    probes = {
        "free_cash_flow": "free cash flow", "operating_cash_flow": "operating cash flow",
        "gross_margin": "gross margin", "operating_margin": "operating margin",
        "net_margin": "net margin", "ebitda_margin": "EBITDA margin",
        "gross_profit": "gross profit", "operating_income": "operating income",
        "ebitda": "EBITDA", "net_income": "net income", "eps": "EPS",
        "cost_of_revenue": "cost of revenue", "deferred_revenue": "deferred revenue",
        "revenue": "revenue", "rnd": "research and development", "sgna": "SG&A",
        "capex": "capex", "cash": "cash and equivalents", "total_debt": "total debt",
        "total_assets": "total assets", "equity": "shareholders equity",
        "shares_outstanding": "shares outstanding", "dividend": "dividend",
        "backlog": "backlog", "headcount": "headcount",
    }
    for key, *_ in _METRICS:
        assert key in probes, f"no probe for {key}"
        assert keys(plan_query(f"Apple {probes[key]}"))[0] == key, key


# ── The unit a change is reported in ──────────────────────────────────────


@pytest.mark.parametrize("q,unit", [
    ("Apple revenue year-over-year", "%"),
    ("Apple net income growth", "%"),
    ("Apple operating margin year-over-year", "pp"),
    ("Apple gross margin change", "pp"),
    ("Apple net margin quarter-over-quarter", "pp"),
    ("Apple revenue FY2025", ""),
    ("Apple operating margin FY2025", ""),
])
def test_a_rate_changes_in_points_and_an_amount_changes_in_percent(q, unit):
    """
    20% -> 25% is +5 pp, not +25%. The plan says which, so no later stage has
    to infer it and get it wrong in the direction that flatters the number.
    """
    assert plan_query(q).change_unit == unit


def test_change_unit_agrees_with_what_period_math_will_actually_return():
    """The plan must not promise a unit the maths layer refuses to produce."""
    from app.core.finance.period_math import (
        Basis, FiscalPeriod, Quantity, delta, growth,
    )

    def qty(v, year, basis):
        return Quantity(value=v, metric="m", period=FiscalPeriod(year),
                        company_id="cik:1", unit="%" if basis is Basis.RATE else "USD",
                        basis=basis)

    rate_plan = plan_query("Apple operating margin year-over-year")
    assert rate_plan.change_unit == "pp"
    assert delta(qty(25.0, 2025, Basis.RATE), qty(20.0, 2024, Basis.RATE)).unit == "pp"
    # ...and growth() refuses rates outright, which is why the plan says pp.
    assert growth(qty(25.0, 2025, Basis.RATE),
                  qty(20.0, 2024, Basis.RATE)).code == "rate_growth"

    amount_plan = plan_query("Apple revenue year-over-year")
    assert amount_plan.change_unit == "%"
    assert growth(qty(5.0, 2025, Basis.FLOW), qty(4.0, 2024, Basis.FLOW)).unit == "%"


# ── The pipeline wiring ───────────────────────────────────────────────────
#
# A plan that is computed and thrown away is dead code with tests. These assert
# the plan reaches `query_plan`, which is what telemetry and downstream stages
# read, and that a planning failure cannot take down a search.


def test_the_pipeline_computes_the_finance_plan_at_classification_time():
    """Pinned against the source: the call site must survive refactors."""
    import inspect

    from app.core import search_pipeline

    src = inspect.getsource(search_pipeline)
    assert "plan_finance_query" in src
    i = src.find('query_plan["finance_plan"]')
    assert i != -1, "the finance plan is no longer written into query_plan"
    # It must be computed alongside question classification, before retrieval.
    assert src.index('query_plan["question_class"]') < i


def test_a_planning_failure_cannot_take_down_a_search():
    """
    Advisory means advisory: a raise here must not lose the answer.

    Checked structurally rather than by scanning a fixed window of source
    text. The window version broke the moment another statement was added
    inside the same `try`, which is a false alarm about a guard that was still
    there — and a guard test that cries wolf is a guard test that gets deleted.
    """
    import ast
    import inspect
    import textwrap

    from app.core import search_pipeline

    tree = ast.parse(textwrap.dedent(inspect.getsource(search_pipeline.SearchPipeline)))

    protected = []
    for node in ast.walk(tree):
        if not isinstance(node, ast.Try):
            continue
        calls = {
            n.func.id
            for n in ast.walk(node)
            if isinstance(n, ast.Call) and isinstance(n.func, ast.Name)
        }
        if "plan_finance_query" not in calls:
            continue
        # It must be caught by a bare `Exception`, not a narrow subclass that
        # would let an unexpected error through.
        broad = any(
            h.type is None or (isinstance(h.type, ast.Name) and h.type.id == "Exception")
            for h in node.handlers
        )
        logged = "finance_plan_failed" in ast.dump(node)
        protected.append(broad and logged)

    assert protected, "plan_finance_query is not inside any try block"
    assert all(protected), "a plan_finance_query call is not guarded by except Exception + log"


def test_the_plan_written_into_query_plan_is_the_serialized_form():
    """`query_plan` is JSON-serialized into telemetry; a dataclass would break it."""
    import json

    d = plan_query("Apple revenue FY2025").as_dict()
    json.dumps(d)          # raises if anything in it is not JSON-safe
    assert isinstance(d, dict)
