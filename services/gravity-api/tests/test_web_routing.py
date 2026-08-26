"""
Deterministic source routing (spec sections 4, 5, 19; matrix items A-E).

Two properties this pins that are easy to lose:

**The existing seven classes still classify as they did.** Four new classes were
appended, not folded in, precisely so that a question which was
EXACT_FINANCIAL_FACT before still is. `test_question_class.py` guards the old
behaviour; this guards the boundary between old and new.

**A fresh question is never answered from storage.** Spec section 5's carve-out
is checked against the query text rather than the class, because "What was
AAPL's latest revenue" is an exact-fact question *and* a fresh one, and the
class alone cannot see that.
"""
import pytest

from app.core.question_class import (
    COMPANY_RESEARCH,
    EXACT_FINANCIAL_FACT,
    FILING_QUALITATIVE,
    FINANCIAL_CALCULATION,
    GENERAL,
    MACRO,
    MARKET_CONTEXT,
    MARKET_NEWS,
    MULTI_DOCUMENT_RESEARCH,
    NEEDS_PRIMARY_SOURCE,
    NEEDS_WEB_RESEARCH,
    classify,
    route_channels,
    route_sources,
)
from app.core.research.budget import ResearchBudget


class TestTheNewClassesClassify:
    @pytest.mark.parametrize("query,expected", [
        # Spec section 4's own worked examples.
        ("What was AMD revenue in FY2025?",            EXACT_FINANCIAL_FACT),
        ("Why did AMD revenue increase?",              FINANCIAL_CALCULATION),
        ("What happened to AMD yesterday?",            MARKET_NEWS),
        ("What are AMD's biggest data-center customers?", COMPANY_RESEARCH),
        # The rest of the new set.
        ("Who are Nvidia's suppliers?",                COMPANY_RESEARCH),
        ("What acquisitions has Broadcom made?",       COMPANY_RESEARCH),
        ("What is inflation doing to the economy?",    MACRO),
        ("Where are interest rates headed?",           MACRO),
        ("How did oil prices move?",                   MACRO),
        ("What is the demand environment like?",       MARKET_CONTEXT),
    ])
    def test_new_classes(self, query, expected):
        assert classify(query)["question_class"] == expected, query


class TestTheOldClassesAreUnchanged:
    """The regression risk of appending four classes to a seven-class chain."""

    @pytest.mark.parametrize("query,expected", [
        ("What was Apple revenue in FY2025?",       EXACT_FINANCIAL_FACT),
        ("Apple revenue",                           EXACT_FINANCIAL_FACT),
        ("What are Tesla's risk factors?",          FILING_QUALITATIVE),
        ("Any news on Nvidia today?",               MARKET_NEWS),
        # Pinned to GENERAL by the pre-existing suite. The COMPANY_RESEARCH
        # regex is deliberately narrow enough not to steal it.
        ("Who is the CEO of Microsoft?",            GENERAL),
        ("Build me an investment thesis on AMD",    MULTI_DOCUMENT_RESEARCH),
    ])
    def test_unchanged(self, query, expected):
        assert classify(query)["question_class"] == expected, query

    def test_an_exact_fact_question_never_becomes_a_web_class(self):
        """
        A financial question must reach the filing. If a web regex ever steals
        one, the exact-fact path silently stops running — the failure mode
        `question_class.py` was written to remove.
        """
        for q in ("Nvidia data center revenue Q3 FY2026",
                  "AMD cost of goods sold FY2025",
                  "EOG total revenue fiscal 2022"):
            assert classify(q)["question_class"] in NEEDS_PRIMARY_SOURCE, q


class TestSourcePlan:
    """Matrix A-E: which of LOCAL / SEC / WEB each question uses."""

    def test_exact_fact_goes_local_then_sec_and_not_web(self):
        """Matrix A/B/C. Spec section 2: web must not be in the loop for a filed figure."""
        plan = route_sources(EXACT_FINANCIAL_FACT, "What was AMD revenue in FY2025?")
        assert plan.selected == ["LOCAL", "SEC"]
        assert "WEB" in plan.skipped

    def test_financial_analysis_uses_sec_and_web_together(self):
        """Matrix D. Spec section 6: both, in parallel, then synthesised."""
        plan = route_sources(FINANCIAL_CALCULATION,
                             "What drove EOG revenue decline from FY2022 to FY2025?")
        assert plan.sec and plan.web

    def test_news_goes_to_the_web(self):
        """Matrix E."""
        plan = route_sources(MARKET_NEWS, "What happened to AMD yesterday?")
        assert plan.web

    def test_macro_does_not_ask_the_filer(self):
        plan = route_sources(MACRO, "What is inflation doing?")
        assert plan.web and not plan.sec

    def test_qualitative_filing_questions_still_read_the_filing(self):
        plan = route_sources(FILING_QUALITATIVE, "What are Tesla's risk factors?")
        assert plan.sec, "filing prose lives in the 10-K"
        assert plan.web, "external context is still useful"

    def test_every_decision_states_a_reason(self):
        plan = route_sources(FINANCIAL_CALCULATION, "Why did AMD revenue increase?")
        for source in plan.selected:
            assert plan.reasons.get(source), f"{source} selected with no reason"

    def test_telemetry_names_both_selected_and_skipped(self):
        """
        Spec section 28. "We did not search the web" and "we searched and found
        nothing" are different answers and used to look identical.
        """
        t = route_sources(EXACT_FINANCIAL_FACT, "AMD revenue FY2025").telemetry()
        assert t["sources_selected"] == ["LOCAL", "SEC"]
        assert t["sources_skipped"] == ["WEB"]
        assert t["routing_reasons"]


class TestFreshIntentOverride:
    """Spec section 5: do NOT force local-first for inherently fresh questions."""

    @pytest.mark.parametrize("query", [
        "What is NVIDIA's latest revenue?",
        "What is AMD's current market position?",
        "What did Apple announce today?",
        "Any recent news on Tesla?",
        "What happened this week at Intel?",
        "What was just announced by Broadcom?",
    ])
    def test_fresh_questions_turn_the_web_on_and_local_off(self, query):
        cls = classify(query)["question_class"]
        plan = route_sources(cls, query)
        assert plan.fresh, query
        assert plan.web, query
        assert not plan.local, "persisted evidence cannot answer a 'latest' question"

    def test_a_fresh_exact_fact_question_still_asks_the_filer(self):
        """
        The override adds the web and drops the local shortcut. It must NOT drop
        SEC — "latest revenue" is still a filed figure, and answering it from a
        news article would be exactly the substitution spec section 2 forbids.
        """
        plan = route_sources(EXACT_FINANCIAL_FACT, "What is NVIDIA's latest revenue?")
        assert plan.sec and plan.web and not plan.local

    def test_a_dated_question_is_not_treated_as_fresh(self):
        plan = route_sources(EXACT_FINANCIAL_FACT, "What was AMD revenue in FY2023?")
        assert not plan.fresh
        assert plan.local

    def test_the_reason_says_why_local_was_skipped(self):
        plan = route_sources(EXACT_FINANCIAL_FACT, "NVIDIA latest revenue")
        assert "current information" in plan.reasons["LOCAL"]


class TestChannelRouting:
    def test_web_channel_is_added_for_web_classes(self):
        for cls in (MARKET_NEWS, COMPANY_RESEARCH, MACRO, MARKET_CONTEXT):
            assert "web" in route_channels(cls, ["dense", "bm25"]), cls

    def test_web_channel_is_not_added_for_an_exact_fact_question(self):
        assert "web" not in route_channels(EXACT_FINANCIAL_FACT, ["dense", "bm25"])

    def test_the_primary_source_guarantee_is_untouched(self):
        """The reason `route_channels` exists at all."""
        out = route_channels(EXACT_FINANCIAL_FACT, ["dense"])
        assert "edgar" in out and "structured" in out

    def test_routing_only_adds_channels_never_removes_them(self):
        base = ["dense", "bm25", "splade", "tree_nav"]
        for cls in list(NEEDS_WEB_RESEARCH) + list(NEEDS_PRIMARY_SOURCE):
            assert set(base) <= set(route_channels(cls, base)), cls


class TestBudget:
    """Spec sections 19 and 29: not every query performs a web search."""

    def test_an_exact_fact_question_gets_no_web_budget_at_all(self):
        b = ResearchBudget.for_class(EXACT_FINANCIAL_FACT)
        assert b.max_search_queries == 0 and b.max_pages_fetched == 0

    def test_a_news_question_favours_breadth(self):
        b = ResearchBudget.for_class(MARKET_NEWS)
        assert b.max_search_queries >= 3
        assert b.max_results_per_query >= 8

    def test_a_research_question_favours_depth(self):
        b = ResearchBudget.for_class(MULTI_DOCUMENT_RESEARCH)
        assert b.max_pages_fetched >= ResearchBudget.for_class(MARKET_NEWS).max_pages_fetched

    def test_budgets_are_bounded_everywhere(self):
        for cls in (MARKET_NEWS, COMPANY_RESEARCH, MACRO, MARKET_CONTEXT,
                    FINANCIAL_CALCULATION, FILING_QUALITATIVE, GENERAL):
            b = ResearchBudget.for_class(cls)
            assert b.max_search_queries <= 6, cls
            assert b.max_pages_fetched <= 10, cls
            assert b.total_deadline_s <= 40, cls

    def test_a_budget_cannot_raise_its_own_limits(self):
        b = ResearchBudget.for_class(MARKET_NEWS)
        with pytest.raises(Exception):
            b.max_pages_fetched = 999  # type: ignore[misc]


class TestTheBudgetAgreesWithTheRouter:
    """
    Caught by running golden question 3 against the live provider stack, not by
    a fixture: "What happened with NVIDIA's latest earnings?" classifies as
    EXACT_FINANCIAL_FACT (a company plus a metric), so the class rule zeroed the
    web budget while `route_sources` correctly turned the web ON because the
    question asks about now.

    The result was the worst of both: telemetry reporting WEB as a selected
    source while the web leg performed zero searches. A source class reported as
    used must actually have been used.
    """

    def test_a_fresh_exact_fact_question_gets_a_real_web_budget(self):
        query = "What happened with NVIDIA's latest earnings?"
        cls = classify(query)["question_class"]
        plan = route_sources(cls, query)
        assert plan.web and plan.fresh
        budget = ResearchBudget.for_class(cls, fresh=plan.fresh)
        assert budget.max_search_queries > 0
        assert budget.max_pages_fetched > 0

    def test_a_dated_exact_fact_question_still_gets_none(self):
        query = "What was AMD revenue in FY2023?"
        cls = classify(query)["question_class"]
        plan = route_sources(cls, query)
        assert not plan.web and not plan.fresh
        budget = ResearchBudget.for_class(cls, fresh=plan.fresh)
        assert budget.max_search_queries == 0

    @pytest.mark.parametrize("query", [
        "What was NVIDIA Data Center revenue in Q3 FY2026?",
        "What drove EOG revenue decline from FY2022 to FY2025?",
        "What happened with NVIDIA's latest earnings?",
        "Any news on Nvidia today?",
        "What is inflation doing?",
        "Who is the CEO of Microsoft?",
    ])
    def test_router_and_budget_never_disagree(self, query):
        """The invariant, checked across every question shape."""
        cls = classify(query)["question_class"]
        plan = route_sources(cls, query)
        budget = ResearchBudget.for_class(cls, fresh=plan.fresh)
        spends = budget.max_search_queries > 0 and budget.max_pages_fetched > 0
        assert spends == plan.web, (
            f"{query!r}: router says web={plan.web} but budget spends={spends}")
