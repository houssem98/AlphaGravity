"""
Deterministic question classification and routing.

`FIX_SECFILING.md` §3 wants a `question_class` computed before retrieval and §12
wants routing keyed off it. The concrete reason: `query_understanding` adds the
live EDGAR channel only when its **LLM** labels the intent `calculation` or
`simple_lookup`, or a keyword regex fires. A slow, quota-limited or simply wrong
model call therefore skips the authoritative-source path entirely, and the user is
told there is no evidence for a figure that is sitting in a filing.

These tests pin the property that makes that impossible: for any question that is
recognisably about an exact financial fact, `edgar` and `structured` are routed in
**without consulting a model**.
"""

import pytest

from app.core.question_class import (
    EXACT_FINANCIAL_FACT,
    FILING_QUALITATIVE,
    FINANCIAL_CALCULATION,
    FINANCIAL_TABLE,
    GENERAL,
    MARKET_NEWS,
    MULTI_DOCUMENT_RESEARCH,
    classify,
    route_channels,
)

BASE = ["dense", "bm25", "splade", "tree_nav"]


def _cls(q, entities=None):
    return classify(q, entities)["question_class"]


class TestTheTargetQuestionRoutesToPrimarySource:
    Q = "What was NVIDIA's Data Center revenue in Q3 FY2026?"

    def test_it_is_an_exact_financial_fact(self):
        assert _cls(self.Q) == EXACT_FINANCIAL_FACT

    def test_it_needs_a_primary_source(self):
        assert classify(self.Q)["needs_primary_source"] is True

    def test_edgar_is_routed_in(self):
        assert "edgar" in route_channels(EXACT_FINANCIAL_FACT, BASE)

    def test_the_structured_channel_is_routed_in(self):
        assert "structured" in route_channels(EXACT_FINANCIAL_FACT, BASE)

    def test_no_model_call_is_needed(self):
        """classify() is pure — the routing cannot be lost to an LLM outage."""
        assert classify(self.Q, entities=None)["question_class"] == EXACT_FINANCIAL_FACT


class TestTheClassesAreDistinguished:
    @pytest.mark.parametrize(
        "query,expected",
        [
            ("NVIDIA revenue Q3 FY2026", EXACT_FINANCIAL_FACT),
            ("Apple revenue FY2025", EXACT_FINANCIAL_FACT),
            ("What is Apple's revenue?", EXACT_FINANCIAL_FACT),
            ("Microsoft net income fiscal 2025", EXACT_FINANCIAL_FACT),
            ("Did Meta's operating income grow faster than revenue in 2024?",
             FINANCIAL_CALCULATION),
            ("Tesla revenue growth year-over-year", FINANCIAL_CALCULATION),
            ("Show me NVIDIA's revenue by segment", FINANCIAL_TABLE),
            ("Apple income statement breakdown", FINANCIAL_TABLE),
            ("What are Tesla's risk factors?", FILING_QUALITATIVE),
            ("Explain the going concern language", FILING_QUALITATIVE),
            ("Any news on Nvidia today?", MARKET_NEWS),
            ("Build me an investment thesis on AMD", MULTI_DOCUMENT_RESEARCH),
            ("Who is the CEO of Microsoft?", GENERAL),
        ],
    )
    def test_class(self, query, expected):
        assert _cls(query) == expected


class TestTheCompanySignalSurvivesALeadingCompanyName:
    """A question usually opens with the company. An implementation that skips
    the first character to avoid sentence-initial capitals loses exactly the
    case it most needs — this pins that regression."""

    def test_a_leading_company_name_still_counts(self):
        assert classify("Apple revenue FY2025")["has_company"] is True

    def test_a_sentence_opener_alone_does_not_count(self):
        assert classify("What was the revenue?")["has_company"] is False

    def test_resolved_entities_are_enough_on_their_own(self):
        r = classify("revenue last quarter", {"companies": [{"ticker": "NVDA"}]})
        assert r["has_company"] is True
        assert r["question_class"] == EXACT_FINANCIAL_FACT


class TestRoutingAddsAndNeverSubtracts:
    """§12 asks for routing, not for turning sources off. Narrowing on a
    deterministic guess would trade a recall bug for a worse one, and
    `GRAVITY_LOOP.sh` rule (2) says selection problems are not fixed by
    disabling sources."""

    @pytest.mark.parametrize(
        "cls",
        [EXACT_FINANCIAL_FACT, FINANCIAL_TABLE, FINANCIAL_CALCULATION,
         FILING_QUALITATIVE, MARKET_NEWS, MULTI_DOCUMENT_RESEARCH, GENERAL],
    )
    def test_every_base_channel_survives_routing(self, cls):
        assert set(BASE) <= set(route_channels(cls, BASE))

    def test_a_qualitative_question_does_not_force_edgar(self):
        assert "edgar" not in route_channels(FILING_QUALITATIVE, BASE)

    def test_news_routes_to_the_news_channel(self):
        assert "gdelt" in route_channels(MARKET_NEWS, BASE)

    def test_routing_is_idempotent(self):
        once = route_channels(EXACT_FINANCIAL_FACT, BASE)
        assert route_channels(EXACT_FINANCIAL_FACT, once) == once


class TestPeriodAndMetricDetection:
    @pytest.mark.parametrize(
        "q", ["Q3 FY2026", "fiscal 2025", "in 2024", "3rd quarter",
              "third quarter", "full year", "TTM"],
    )
    def test_a_period_is_recognised(self, q):
        assert classify(f"NVIDIA revenue {q}")["has_period"] is True

    def test_a_question_with_no_period_still_asks_for_a_fact(self):
        r = classify("What is Apple's revenue?")
        assert r["has_period"] is False
        assert r["question_class"] == EXACT_FINANCIAL_FACT

    @pytest.mark.parametrize(
        "metric", ["revenue", "net income", "EPS", "operating income",
                   "free cash flow", "capex", "inventory", "gross margin"],
    )
    def test_a_metric_is_recognised(self, metric):
        assert classify(f"NVIDIA {metric} FY2025")["has_metric"] is True
