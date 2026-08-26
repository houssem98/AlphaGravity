"""
The three golden behaviours, driven through the real pipeline pieces.

These are the acceptance tests the task names. They are deliberately NOT
assertions about a model's prose — no answer text is hardcoded, per spec section
27. What they assert is the *routing and evidence* behaviour that must hold for
each question shape, because that is what is deterministic and what actually
governs whether the answer can be right.

GOLDEN 1 — EXACT FINANCIAL FACT
    "What was NVIDIA Data Center revenue in Q3 FY2026?"
    LOCAL verified hit if present, otherwise SEC. Web must not override.

GOLDEN 2 — FINANCIAL ANALYSIS
    "What drove EOG revenue decline from FY2022 to FY2025?"
    SEC for the reported figures, web for external context, FACT / CONTEXT /
    INFERENCE kept apart, every material claim carrying evidence.

GOLDEN 3 — FRESH WEB RESEARCH
    A "latest" question must not be answered from stale persisted evidence.
"""
from datetime import datetime, timedelta, timezone

import pytest

from app.core.question_class import classify, route_channels, route_sources
from app.core.research.budget import ResearchBudget
from app.core.research.evidence import (
    CONTEXT,
    FACT,
    INFERENCE,
    SEC_EVIDENCE,
    WEB_EVIDENCE,
    Claim,
    Evidence,
    EvidenceSet,
    cross_check,
)
from app.core.research.providers import ProviderSet, SearchResult, WebDocument
from app.core.research.source_quality import (
    SEC_FILINGS,
    admissible_for_financial_fact,
    rate,
)
from app.core.research.web_research import WebResearchChannel

from tests.test_web_research import StubFetch, StubSearch, _hit

NOW = datetime(2026, 8, 26, tzinfo=timezone.utc)

GOLDEN_1 = "What was NVIDIA Data Center revenue in Q3 FY2026?"
GOLDEN_2 = "What drove EOG revenue decline from FY2022 to FY2025?"
GOLDEN_3 = "What happened with NVIDIA's latest earnings?"


class TestGolden1ExactFinancialFact:
    """The SEC path must be untouched by everything this change added."""

    def test_it_classifies_as_an_exact_financial_fact(self):
        assert classify(GOLDEN_1)["question_class"] == "EXACT_FINANCIAL_FACT"
        assert classify(GOLDEN_1)["needs_primary_source"]

    def test_it_routes_local_then_sec_and_never_web(self):
        plan = route_sources("EXACT_FINANCIAL_FACT", GOLDEN_1)
        assert plan.selected == ["LOCAL", "SEC"]
        assert not plan.web, "spec section 2: web must not be in the loop for a filed figure"

    def test_the_authoritative_channels_are_guaranteed(self):
        channels = route_channels("EXACT_FINANCIAL_FACT", ["dense", "bm25"])
        assert "edgar" in channels and "structured" in channels
        assert "web" not in channels

    def test_no_web_budget_is_spent(self):
        b = ResearchBudget.for_class("EXACT_FINANCIAL_FACT")
        assert b.max_search_queries == 0 and b.max_pages_fetched == 0

    @pytest.mark.asyncio
    async def test_the_web_channel_does_nothing_even_if_registered(self):
        """
        Registration must not be the same as invocation. Even with a live
        provider holding a plausible-looking article, an exact-fact question
        performs zero searches and zero fetches.
        """
        search = StubSearch([_hit("https://cnbc.com/nvda-datacenter")])
        fetch = StubFetch({"https://cnbc.com/nvda-datacenter":
                           "NVIDIA Data Center revenue was $99.9 billion." * 20})
        ch = WebResearchChannel(providers=ProviderSet(search=[search], fetch=[fetch]))
        evidence, usage = await ch.research(
            GOLDEN_1, question_class="EXACT_FINANCIAL_FACT", companies=["NVDA"])
        assert evidence == []
        assert search.calls == [] and fetch.fetched == []
        assert usage.degraded == "not_routed"

    def test_a_web_source_may_not_supply_the_figure(self):
        """
        Spec section 9. Even a correct third-party number is inadmissible as the
        source of a reported figure — once it is allowed, there is no way to
        tell which source the answer used.
        """
        ok, why = admissible_for_financial_fact(rate("https://www.cnbc.com/nvda"))
        assert not ok and "SEC filings" in why

    def test_when_sec_and_web_disagree_the_filing_stands(self):
        """Matrix F, on the golden question."""
        sec = Evidence(
            kind=SEC_EVIDENCE, source_type="10-Q",
            text="Data Center revenue was $30.8 billion for the third quarter",
            provenance={"accession": "0001045810-25-000123",
                        "xbrl_concept": "RevenueFromContractWithCustomer",
                        "fiscal_year": 2026, "fiscal_quarter": 3,
                        "dimension_value": "Data Center"})
        blog = Evidence(
            kind=WEB_EVIDENCE, url="https://randomblog.substack.com/p/nvda",
            source_type="web_page", retrieved_at=NOW,
            # Says "revenue" explicitly, as a real article does. A passage that
            # never names the metric is treated as silent about it rather than
            # as conflicting — see
            # `TestBugsFoundByRunningLive.test_a_different_metric_of_similar_size`.
            text="NVIDIA data center revenue was $45.0 billion for the quarter.")
        corroborating, conflicts = cross_check(sec, [blog], subject="Data Center revenue")
        assert not corroborating and len(conflicts) == 1
        d = conflicts[0].as_dict()
        assert d["authoritative_value"] == "30,800,000,000"
        assert "not averaged" in d["resolution"]
        # The midpoint appears nowhere: averaging is the forbidden resolution.
        assert "37,900,000,000" not in str(d)

    def test_a_verified_local_hit_and_a_local_miss_are_different_states(self):
        """
        Spec section 5 — LOCAL first, then authoritative. The gate is untouched
        by this change; this asserts its contract still holds so a regression
        here fails in the web suite too.
        """
        from app.core.retrieval import evidence_gate as eg

        miss = eg.evaluate([], query=GOLDEN_1, ticker="NVDA", cik=1045810,
                           concept="Revenues", fiscal_year=2026, fiscal_quarter=3)
        assert miss.status == eg.LOCAL_MISS
        assert miss.sec_invoked, "a miss must reach the filer"
        # And a gate decision to skip SEC never drops `edgar` while the local
        # channel that would read the row is disabled.
        assert "edgar" in eg.channels_after_gate(["edgar", "dense"], miss)


class TestGolden2FinancialAnalysis:
    """SEC for the numbers, web for the context, and the three labels kept apart."""

    def test_it_routes_to_both_sec_and_web(self):
        cls = classify(GOLDEN_2)["question_class"]
        assert cls == "FINANCIAL_CALCULATION"
        plan = route_sources(cls, GOLDEN_2)
        assert plan.sec and plan.web
        assert "SEC" in plan.reasons and "WEB" in plan.reasons

    def test_both_channel_families_run(self):
        channels = route_channels("FINANCIAL_CALCULATION", ["dense", "bm25"])
        assert "edgar" in channels and "web" in channels

    def test_the_web_budget_is_narrow_because_sec_leads(self):
        b = ResearchBudget.for_class("FINANCIAL_CALCULATION")
        assert 0 < b.max_pages_fetched <= 4

    def test_fact_context_and_inference_are_representable_and_distinct(self):
        """
        Spec section 22. The pipeline must be able to represent the distinction
        before a model can be asked to honour it.
        """
        sec = Evidence(
            kind=SEC_EVIDENCE, source_type="10-K",
            text="Total revenues decreased to $24.2 billion in fiscal 2025 from "
                 "$29.5 billion in fiscal 2022",
            provenance={"accession": "0000821189-25-000011",
                        "xbrl_concept": "Revenues", "fiscal_year": 2025,
                        "fiscal_quarter": "", "dimension_value": ""})
        context = Evidence(
            kind=WEB_EVIDENCE, url="https://www.reuters.com/markets/gas-prices",
            title="Natural gas prices fell through 2024 and 2025",
            source_type="web_page", published_at=NOW - timedelta(days=30),
            retrieved_at=NOW, location="paragraph 2",
            text="Henry Hub natural gas spot prices averaged sharply lower "
                 "across 2024 and 2025 than in the 2022 peak.")

        s = EvidenceSet("FINANCIAL_CALCULATION")
        assert s.add(sec, now=NOW)
        assert s.add(context, now=NOW)

        s.add_claim(Claim("EOG revenue fell from $29.5B to $24.2B", FACT, [sec]))
        s.add_claim(Claim("Natural gas prices declined over the period", CONTEXT, [context]))
        s.add_claim(Claim("Lower realized gas prices appear to explain most of "
                          "the decline", INFERENCE, [sec, context]))

        summary = s.summary()
        assert summary["claims_total"] == 3
        assert summary["claims_supported"] == 2   # FACT + CONTEXT
        assert summary["claims_inferred"] == 1
        assert summary["claims_unsupported"] == 0

    def test_every_material_claim_carries_evidence(self):
        """
        The property spec section 13 calls critical. An unsupported claim is
        counted separately rather than silently rendering as one more citation.
        """
        s = EvidenceSet("FINANCIAL_CALCULATION")
        s.add_claim(Claim("Revenue fell 18%", FACT))  # no evidence attached
        assert s.summary()["claims_unsupported"] == 1

    def test_an_inference_is_never_counted_as_a_reported_fact(self):
        ev = Evidence(kind=WEB_EVIDENCE, url="https://reuters.com/x",
                      text="prices fell", source_type="web_page", retrieved_at=NOW)
        assert not Claim("Prices drove the decline", INFERENCE, [ev]).supported

    def test_the_sec_source_outranks_the_web_source_in_the_list(self):
        s = EvidenceSet("FINANCIAL_CALCULATION")
        s.add(Evidence(kind=WEB_EVIDENCE, url="https://www.reuters.com/x",
                       title="Gas prices", source_type="web_page",
                       text="prices fell " * 20, retrieved_at=NOW, relevance=0.99),
              now=NOW)
        s.add(Evidence(kind=SEC_EVIDENCE, source_type="10-K", text="Revenue fell",
                       provenance={"accession": "0000821189-25-000011",
                                   "xbrl_concept": "Revenues", "fiscal_year": 2025,
                                   "fiscal_quarter": "", "dimension_value": ""},
                       relevance=0.10), now=NOW)
        assert s.evidence[0].kind == SEC_EVIDENCE
        assert s.evidence[0].category == SEC_FILINGS

    @pytest.mark.asyncio
    async def test_web_evidence_comes_from_a_fetched_page_not_a_snippet(self):
        """Spec section 10, on the golden question."""
        page = ("Natural gas prices averaged far below their 2022 peak through "
                "2024 and 2025, pressuring realized prices for producers across "
                "the Permian and Delaware basins. Producers reported lower "
                "revenue as a direct result of the weaker price environment.")
        ch = WebResearchChannel(providers=ProviderSet(
            search=[StubSearch([_hit("https://www.reuters.com/gas",
                                     title="Gas prices fall",
                                     snippet="MISLEADING SNIPPET")])],
            fetch=[StubFetch({"https://www.reuters.com/gas": page})]))
        evidence, usage = await ch.research(
            GOLDEN_2, question_class="FINANCIAL_CALCULATION", companies=["EOG"])
        assert evidence
        assert "MISLEADING SNIPPET" not in evidence[0].text
        assert usage.pages_fetched == 1


class TestGolden3FreshWebResearch:
    """A 'latest' question must not be served from stale persisted evidence."""

    def test_it_is_recognised_as_a_fresh_question(self):
        cls = classify(GOLDEN_3)["question_class"]
        plan = route_sources(cls, GOLDEN_3)
        assert plan.fresh, "the word 'latest' must be seen"
        assert plan.web

    def test_the_local_shortcut_is_turned_off(self):
        """
        Spec section 5's carve-out. The persisted answer to these words from
        three weeks ago is the wrong answer however well it was verified.
        """
        plan = route_sources(classify(GOLDEN_3)["question_class"], GOLDEN_3)
        assert not plan.local
        assert "current information" in plan.reasons["LOCAL"]

    def test_stale_web_evidence_is_refused_for_a_fresh_question(self):
        """Matrix H, on the golden question."""
        s = EvidenceSet("MARKET_NEWS")
        stale = Evidence(kind=WEB_EVIDENCE, url="https://reuters.com/old-earnings",
                         title="NVIDIA Q1 earnings", source_type="web_page",
                         text="old coverage " * 20,
                         published_at=NOW - timedelta(days=200), retrieved_at=NOW)
        assert not s.add(stale, now=NOW)
        assert s.dropped_stale and "200d ago" in s.dropped_stale[0][1]

    def test_recent_web_evidence_is_accepted(self):
        s = EvidenceSet("MARKET_NEWS")
        fresh = Evidence(kind=WEB_EVIDENCE, url="https://reuters.com/new-earnings",
                         title="NVIDIA reports", source_type="web_page",
                         text="latest coverage " * 20,
                         published_at=NOW - timedelta(hours=6), retrieved_at=NOW)
        assert s.add(fresh, now=NOW)

    def test_an_undated_page_cannot_masquerade_as_current(self):
        """
        The subtle version of the same failure: no publication date, so nothing
        contradicts a claim of currency. Refused where recency is the point.
        """
        s = EvidenceSet("MARKET_NEWS")
        undated = Evidence(kind=WEB_EVIDENCE, url="https://blog.example/nvda",
                           title="NVIDIA earnings", source_type="web_page",
                           text="undated coverage " * 20,
                           published_at=None, retrieved_at=NOW)
        assert not s.add(undated, now=NOW)

    def test_a_fresh_question_about_a_filed_figure_still_asks_the_filer(self):
        """
        Freshness adds the web and drops the local shortcut. It must never drop
        SEC — answering "latest earnings" purely from a news article is the
        substitution spec section 2 forbids.
        """
        plan = route_sources("EXACT_FINANCIAL_FACT", "NVIDIA's latest revenue")
        assert plan.sec and plan.web and not plan.local

    @pytest.mark.asyncio
    async def test_the_news_budget_asks_for_recent_material(self):
        b = ResearchBudget.for_class("MARKET_NEWS")
        assert b.max_search_queries >= 3
        ch = WebResearchChannel(providers=ProviderSet(
            search=[StubSearch([_hit("https://www.reuters.com/nvda")])],
            fetch=[StubFetch({"https://www.reuters.com/nvda": "coverage " * 60})]))
        _, usage = await ch.research(GOLDEN_3, question_class="MARKET_NEWS",
                                     companies=["NVDA"])
        assert usage.search_queries >= 1


class TestTheGoldenQuestionsAreNotHardcodedAnywhere:
    """
    Spec section 27: "Do not hardcode answers into the production code."

    A guard against the cheapest way to pass an acceptance test.
    """

    def test_no_production_module_mentions_a_golden_question_or_its_answer(self):
        import pathlib

        root = pathlib.Path(__file__).resolve().parents[1] / "app"
        needles = ["Data Center revenue in Q3 FY2026", "EOG revenue decline",
                   "30.8 billion", "24.2 billion", "29.5 billion"]
        offenders = []
        for path in root.rglob("*.py"):
            try:
                text = path.read_text(encoding="utf-8", errors="ignore")
            except OSError:
                continue
            for needle in needles:
                if needle in text:
                    offenders.append(f"{path.name}: {needle}")
        assert offenders == [], f"golden answers leaked into production: {offenders}"
