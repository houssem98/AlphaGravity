"""
One entity layer, and the middle state that stops it guessing.

The resolver was already universal — it indexes SEC's whole ticker file. What
it lacked was a way to say "several companies fit", so a caller that took the
best match silently chose between Apple Inc. and Apple Hospitality REIT.

Ambiguity is decided on the MARGIN between the top two candidates, not on the
winner's absolute score. Two candidates at 0.95 and 0.94 are a coin flip
however confident the winner looks; 0.95 against 0.55 is a resolution.
"""

from __future__ import annotations

import pytest

from app.core.skills.entity import (
    AMBIGUITY_MARGIN,
    Entity,
    EntityStatus,
    classify,
    resolve,
    resolve_many,
)


class FakeResolved:
    def __init__(self, ticker, cik, name, confidence, match_type, alternatives=None):
        self.ticker, self.cik, self.name = ticker, cik, name
        self.confidence, self.match_type = confidence, match_type
        self.alternatives = alternatives or []
        self.former_names = []


class FakeResolver:
    """Maps a mention to a prepared answer; anything else is unknown."""

    def __init__(self, table):
        self.table = table
        self.calls: list[str] = []

    async def resolve(self, mention, top_k=3):
        self.calls.append(mention)
        return self.table.get(
            mention.lower(),
            FakeResolved("", "", "", 0.0, "unknown"),
        )


# ── The classification rule, on its own ───────────────────────────────────


def test_an_exact_ticker_is_never_ambiguous():
    """A ticker is a unique key on an exchange. That is what a ticker is for."""
    assert classify(1.0, [{"score": 0.99}], "exact_ticker") is EntityStatus.RESOLVED


def test_a_close_runner_up_makes_a_fuzzy_match_ambiguous():
    assert classify(0.95, [{"score": 0.94}], "fuzzy_name") is EntityStatus.AMBIGUOUS


def test_a_distant_runner_up_leaves_the_match_resolved():
    assert classify(0.95, [{"score": 0.55}], "fuzzy_name") is EntityStatus.RESOLVED


def test_a_runner_up_below_the_accept_gate_never_creates_ambiguity():
    assert classify(0.52, [{"score": 0.49}], "fuzzy_name") is EntityStatus.RESOLVED


def test_a_weak_best_match_is_unknown_not_ambiguous():
    assert classify(0.3, [{"score": 0.29}], "fuzzy_name") is EntityStatus.UNKNOWN


def test_the_margin_is_the_rule_not_the_absolute_score():
    # Both pairs are 0.02 apart; both are ambiguous, high or low.
    assert classify(0.99, [{"score": 0.97}], "fuzzy_name") is EntityStatus.AMBIGUOUS
    assert classify(0.60, [{"score": 0.58}], "fuzzy_name") is EntityStatus.AMBIGUOUS


def test_the_margin_boundary_resolves_rather_than_flickering():
    assert classify(0.90, [{"score": 0.90 - AMBIGUITY_MARGIN}], "fuzzy_name") \
        is EntityStatus.RESOLVED


def test_no_alternatives_at_all_resolves():
    assert classify(0.8, [], "fuzzy_name") is EntityStatus.RESOLVED


# ── Resolution over the layer ─────────────────────────────────────────────


@pytest.mark.asyncio
async def test_a_ticker_resolves_for_a_company_nobody_hard_coded():
    """The point of the layer: an arbitrary registrant, not a curated list."""
    r = FakeResolver({"cprt": FakeResolved("CPRT", "900075", "COPART INC", 1.0, "exact_ticker")})
    ent = await resolve("CPRT", resolver=r)
    assert ent.status is EntityStatus.RESOLVED
    assert ent.ticker == "CPRT"
    assert ent.cik == "900075"
    assert ent.company_id == "cik:900075"


@pytest.mark.asyncio
async def test_a_company_name_resolves():
    r = FakeResolver({"copart": FakeResolved("CPRT", "900075", "COPART INC", 0.92, "fuzzy_name")})
    ent = await resolve("Copart", resolver=r)
    assert ent.status is EntityStatus.RESOLVED
    assert ent.legal_name == "COPART INC"


@pytest.mark.asyncio
async def test_an_ambiguous_mention_is_refused_and_lists_its_candidates():
    r = FakeResolver({"apple": FakeResolved(
        "AAPL", "320193", "Apple Inc.", 0.95, "fuzzy_name",
        alternatives=[{"ticker": "APLE", "name": "Apple Hospitality REIT", "score": 0.93}],
    )})
    ent = await resolve("Apple", resolver=r)
    assert ent.status is EntityStatus.AMBIGUOUS
    assert ent.resolved is False
    # The winner is listed as a candidate rather than silently promoted.
    assert [c.ticker for c in ent.candidates] == ["AAPL", "APLE"]
    # And no ticker is exposed on the entity, so a caller cannot use it anyway.
    assert ent.ticker == ""


@pytest.mark.asyncio
async def test_an_unresolvable_mention_is_unknown():
    ent = await resolve("Definitely Not A Company Plc", resolver=FakeResolver({}))
    assert ent.status is EntityStatus.UNKNOWN
    assert ent.company_id == ""


@pytest.mark.asyncio
async def test_an_empty_mention_never_reaches_the_resolver():
    r = FakeResolver({})
    ent = await resolve("   ", resolver=r)
    assert ent.status is EntityStatus.UNKNOWN
    assert r.calls == []


@pytest.mark.asyncio
async def test_a_resolver_outage_is_unknown_rather_than_a_crash():
    class Broken:
        async def resolve(self, *a, **k):
            raise RuntimeError("ticker file unavailable")

    ent = await resolve("NVDA", resolver=Broken())
    assert ent.status is EntityStatus.UNKNOWN


@pytest.mark.asyncio
async def test_multi_company_input_resolves_each_against_the_same_layer():
    r = FakeResolver({
        "nvda": FakeResolved("NVDA", "1045810", "NVIDIA CORP", 1.0, "exact_ticker"),
        "cprt": FakeResolved("CPRT", "900075", "COPART INC", 1.0, "exact_ticker"),
        "apple": FakeResolved(
            "AAPL", "320193", "Apple Inc.", 0.95, "fuzzy_name",
            alternatives=[{"ticker": "APLE", "name": "Apple Hospitality REIT", "score": 0.93}],
        ),
    })
    out = await resolve_many(["NVDA", "CPRT", "Apple", "nonsense"], resolver=r)
    assert [e.status for e in out] == [
        EntityStatus.RESOLVED, EntityStatus.RESOLVED,
        EntityStatus.AMBIGUOUS, EntityStatus.UNKNOWN,
    ]


@pytest.mark.asyncio
async def test_a_former_name_is_carried_when_the_resolver_supplies_one():
    hit = FakeResolved("META", "1326801", "Meta Platforms, Inc.", 1.0, "exact_ticker")
    hit.former_names = ["Facebook, Inc."]
    ent = await resolve("META", resolver=FakeResolver({"meta": hit}))
    assert ent.former_names == ["Facebook, Inc."]


def test_the_serialized_entity_names_its_state_and_id():
    d = Entity(status=EntityStatus.RESOLVED, ticker="CPRT", cik="900075").as_dict()
    assert d["status"] == "resolved"
    assert d["company_id"] == "cik:900075"


def test_a_non_numeric_cik_yields_no_company_id_rather_than_a_broken_one():
    assert Entity(status=EntityStatus.RESOLVED, ticker="X", cik="").company_id == ""
