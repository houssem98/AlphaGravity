"""
Company-group -> ticker expansion (quickanswerfix.md item 3).

Nothing in the codebase mapped a named group to its constituents: a grep for
FAANG/MAG7/Magnificent/group_alias/company_alias/ticker_alias across every .py
file finds a routing-complexity test string, a router prompt line, and a
skill-loader docstring — none of which resolve anything at runtime. The
entity-extraction prompt's only worked example is a single company, so whether
"Compare FAANG operating margins" produced five tickers, one, or none was
whatever the classifier decided that request.

These tests pin the deterministic replacement: it fires on the groups it knows,
stays out of the way otherwise, and only ever ADDS to what the classifier found.
"""
import copy

import pytest

from app.core.entities.group_aliases import (
    GROUPS,
    detect_groups,
    expand_groups,
    merge_group_companies,
    ticker_name,
)
from app.core.query_understanding import DEFAULT_QUERY_PLAN

FAANG_QUERY = "Compare FAANG operating margins over the last 4 quarters"
FAANG_TICKERS = {"META", "AMZN", "AAPL", "NFLX", "GOOGL"}


def _tickers(plan: dict) -> set[str]:
    return {
        c["ticker"] for c in plan["entities"]["companies"] if c.get("ticker")
    }


class TestTheLiteralQueryThatMotivatedThis:
    def test_all_five_faang_tickers_are_resolved(self):
        assert set(expand_groups(FAANG_QUERY)) == FAANG_TICKERS

    def test_they_land_in_entities_companies(self):
        plan = {"entities": {"companies": []}}
        merge_group_companies(plan, FAANG_QUERY)
        assert _tickers(plan) == FAANG_TICKERS

    def test_each_entity_carries_a_name_and_a_ticker(self):
        # Downstream readers use `name` for prose and `ticker` for retrieval;
        # an entry missing either is silently useless to one of them.
        plan = {"entities": {"companies": []}}
        merge_group_companies(plan, FAANG_QUERY)
        for company in plan["entities"]["companies"]:
            assert company["ticker"] and company["name"]
            assert company["name"] != company["ticker"], company["ticker"]


class TestItDoesNotFireWhenNoGroupIsNamed:
    @pytest.mark.parametrize("query", [
        "What was Apple revenue in FY2024?",
        "NVDA gross margin trend",
        "Who is the CEO of Microsoft?",
        "Compare operating margins for Apple and Microsoft",
        "",
    ])
    def test_no_group_means_no_expansion(self, query):
        assert expand_groups(query) == []
        plan = {"entities": {"companies": []}}
        merge_group_companies(plan, query)
        assert plan["entities"]["companies"] == []

    def test_a_bare_mention_of_banks_is_not_a_group(self):
        # "major US banks" is a group; "bank" on its own is not, or every query
        # about one bank would drag in five more.
        assert expand_groups("What did JPMorgan say about its bank charter?") == []


class TestItMergesAndNeverNarrows:
    def test_a_group_plus_an_outside_ticker_keeps_both(self):
        plan = {"entities": {"companies": [
            {"name": "Microsoft Corporation", "ticker": "MSFT"},
        ]}}
        merge_group_companies(plan, "Compare FAANG and MSFT operating margins")
        assert _tickers(plan) == FAANG_TICKERS | {"MSFT"}

    def test_the_classifiers_entity_is_kept_intact(self):
        # A classifier-resolved company carries a CIK the bare table entry lacks;
        # merging must not overwrite it with the thinner version.
        plan = {"entities": {"companies": [
            {"name": "Meta Platforms, Inc.", "ticker": "META", "cik": "0001326801"},
        ]}}
        merge_group_companies(plan, FAANG_QUERY)
        meta = [c for c in plan["entities"]["companies"] if c["ticker"] == "META"]
        assert len(meta) == 1, "no duplicate entry for a company already resolved"
        assert meta[0]["cik"] == "0001326801", "the resolved CIK must survive"

    def test_the_classifiers_companies_come_first(self):
        plan = {"entities": {"companies": [{"name": "Tesla, Inc.", "ticker": "TSLA"}]}}
        merge_group_companies(plan, FAANG_QUERY)
        assert plan["entities"]["companies"][0]["ticker"] == "TSLA"

    def test_two_groups_in_one_query_both_expand(self):
        plan = {"entities": {"companies": []}}
        merge_group_companies(plan, "FAANG vs the Magnificent Seven on margins")
        assert FAANG_TICKERS <= _tickers(plan)
        assert {"MSFT", "NVDA", "TSLA"} <= _tickers(plan)


class TestItSurvivesTheClassificationTimeout:
    """Same reasoning as the EDGAR timeout-fallback fix: the fallback plan is used
    verbatim when analyze() never returns, so anything that only runs inside
    analyze() is absent exactly when the classifier gave us nothing."""

    def test_the_fallback_plan_still_resolves_a_group(self):
        plan = copy.deepcopy(DEFAULT_QUERY_PLAN)
        assert plan["entities"]["companies"] == [], "fallback starts with no entities"
        merge_group_companies(plan, FAANG_QUERY)
        assert _tickers(plan) == FAANG_TICKERS

    def test_merging_does_not_mutate_the_shared_default(self):
        # DEFAULT_QUERY_PLAN is module-level; leaking one request's companies into
        # it would hand them to every later defaulted request.
        plan = copy.deepcopy(DEFAULT_QUERY_PLAN)
        merge_group_companies(plan, FAANG_QUERY)
        assert DEFAULT_QUERY_PLAN["entities"]["companies"] == []


class TestTheTableItself:
    @pytest.mark.parametrize("key,expected", [
        ("faang", {"META", "AMZN", "AAPL", "NFLX", "GOOGL"}),
        ("magnificent_seven",
         {"AAPL", "MSFT", "GOOGL", "AMZN", "NVDA", "META", "TSLA"}),
        ("megacap_tech", {"AAPL", "MSFT", "GOOGL", "AMZN", "NVDA", "META"}),
        ("major_us_banks", {"JPM", "BAC", "WFC", "C", "GS", "MS"}),
    ])
    def test_membership(self, key, expected):
        assert set(GROUPS[key][1]) == expected

    def test_the_magnificent_seven_has_seven_members(self):
        assert len(GROUPS["magnificent_seven"][1]) == 7

    @pytest.mark.parametrize("phrase,key", [
        ("FAANG", "faang"),
        ("faang stocks", "faang"),
        ("Magnificent Seven", "magnificent_seven"),
        ("magnificent 7", "magnificent_seven"),
        ("Mag7", "magnificent_seven"),
        ("mag 7 earnings", "magnificent_seven"),
        ("mega-cap tech", "megacap_tech"),
        ("megacap technology names", "megacap_tech"),
        ("big tech", "megacap_tech"),
        ("major US banks", "major_us_banks"),
        ("big banks", "major_us_banks"),
        ("bulge bracket", "major_us_banks"),
    ])
    def test_phrasings_detect(self, phrase, key):
        assert key in detect_groups(f"compare {phrase} revenue")

    def test_every_ticker_in_the_table_has_a_display_name(self):
        for _patterns, tickers in GROUPS.values():
            for ticker in tickers:
                assert ticker_name(ticker) != ticker, f"{ticker} has no display name"

    def test_an_unknown_ticker_falls_back_to_itself(self):
        assert ticker_name("zzzz") == "ZZZZ"
