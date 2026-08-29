"""
Company and Sentiment for arbitrary registrants — the universality proof.

The tickers here are chosen for what they are NOT: none of CPRT, ODFL, TPL,
EXPD, WSO, LNTH or AOS appears in `_ALIASES`, in `group_aliases`, in any
fixture, or anywhere in the pipeline's source. If either skill worked only for
the companies someone had thought about in advance, every test in the first
block would fail.

Both skills are exercised through injected channels, so what is being tested is
the skill's own logic — resolution, period gating, absence handling, channel
semantics — and not SEC's uptime. The live path is a separate, credential-gated
gate that reports itself honestly.
"""

from __future__ import annotations

from datetime import date

import pytest

from app.core.skills import company_skill, sentiment_skill
from app.core.skills.contract import ChannelState, SkillRequest, SkillStatus

TODAY = date(2026, 8, 29)

# Seven registrants across seven sectors. None is hard-coded anywhere.
UNSEEN = [
    ("CPRT", "900075", "COPART INC", "salvage auctions"),
    ("ODFL", "878927", "OLD DOMINION FREIGHT LINE INC", "trucking"),
    ("TPL", "1811074", "TEXAS PACIFIC LAND CORP", "land and royalties"),
    ("EXPD", "746515", "EXPEDITORS INTERNATIONAL OF WASHINGTON INC", "logistics"),
    ("WSO", "105016", "WATSCO INC", "HVAC distribution"),
    ("LNTH", "1521036", "LANTHEUS HOLDINGS INC", "radiopharmaceuticals"),
    ("AOS", "91142", "A O SMITH CORP", "water heaters"),
]


class FakeResolved:
    def __init__(self, ticker, cik, name, confidence=1.0, match_type="exact_ticker",
                 alternatives=None):
        self.ticker, self.cik, self.name = ticker, cik, name
        self.confidence, self.match_type = confidence, match_type
        self.alternatives = alternatives or []
        self.former_names = []


class FakeResolver:
    def __init__(self, table):
        self.table = table

    async def resolve(self, mention, top_k=3):
        return self.table.get(mention.lower(), FakeResolved("", "", "", 0.0, "unknown"))


def resolver_for(rows):
    table = {}
    for ticker, cik, name, _ in rows:
        table[ticker.lower()] = FakeResolved(ticker, cik, name)
        table[name.lower()] = FakeResolved(ticker, cik, name, 0.95, "fuzzy_name")
    return FakeResolver(table)


class Passage:
    def __init__(self, text="", metadata=None, title="", section=""):
        self.text = text
        self.metadata = metadata or {}
        self.document_title = title
        self.section = section


def sec_meta(ticker, cik, *, value=None, accn="0000123456-25-000001", form="10-K",
             fy=2025, unit="USD", **over):
    m = {
        "accn": accn, "cik": int(cik), "issuer": f"{ticker} INC",
        "form": form, "filed": "2025-02-20", "fiscal_year": fy,
        "period_end": "2024-12-31", "period_of_report": "2024-12-31",
        "unit": unit, "value": value,
        "filing_url": f"https://www.sec.gov/Archives/edgar/data/{int(cik)}/"
                      f"{accn.replace('-', '')}/{accn}-index.htm",
        "primary_document": f"{ticker.lower()}-20241231.htm",
        "primary_document_url": f"https://www.sec.gov/Archives/edgar/data/{int(cik)}/"
                                f"{accn.replace('-', '')}/{ticker.lower()}-20241231.htm",
    }
    m.update(over)
    return m


class FactsChannel:
    """Answers a metric only when `supply` names it. Everything else is absent."""

    def __init__(self, ticker, cik, supply: dict):
        self.ticker, self.cik, self.supply = ticker, cik, supply
        self.queries: list[str] = []

    async def search(self, query, entities=None, top_k=10, filters=None):
        self.queries.append(query)
        for key, value in self.supply.items():
            if key in query.lower():
                return [Passage(
                    text=f"[EXACT FILING FIGURE] {value}",
                    metadata=sec_meta(self.ticker, self.cik, value=value),
                    title=f"{self.ticker} 10-K — FY2025",
                )]
        return []


class DeadChannel:
    def __init__(self, exc=RuntimeError("provider down")):
        self.exc = exc

    async def search(self, *a, **k):
        raise self.exc


class EmptyChannel:
    async def search(self, *a, **k):
        return []


# ── Company: arbitrary registrants ────────────────────────────────────────


@pytest.mark.asyncio
@pytest.mark.parametrize("row", UNSEEN, ids=[r[0] for r in UNSEEN])
async def test_company_answers_for_a_registrant_nobody_hard_coded(row):
    ticker, cik, name, _ = row
    facts = FactsChannel(ticker, cik, {"total revenue": 4_500_000_000.0,
                                       "net income": 1_200_000_000.0})
    out = await company_skill.run(
        SkillRequest(skill="company", entities=[ticker]),
        facts_search=facts, resolver=resolver_for(UNSEEN), as_of=TODAY,
    )
    assert out.status in (SkillStatus.SUCCESS, SkillStatus.PARTIAL)
    assert out.data["identity"]["ticker"] == ticker
    assert out.data["identity"]["company_id"] == f"cik:{int(cik)}"
    assert out.data["financials"]["revenue"]["value"] == 4_500_000_000.0
    assert out.citations and out.citations[0]["accession"]


@pytest.mark.asyncio
@pytest.mark.parametrize("row", UNSEEN, ids=[r[0] for r in UNSEEN])
async def test_company_resolves_by_legal_name_too(row):
    ticker, cik, name, _ = row
    facts = FactsChannel(ticker, cik, {"total revenue": 1.0})
    out = await company_skill.run(
        SkillRequest(skill="company", entities=[name]),
        facts_search=facts, resolver=resolver_for(UNSEEN), as_of=TODAY,
    )
    assert out.entities[0]["ticker"] == ticker


@pytest.mark.asyncio
async def test_a_metric_the_filer_does_not_report_stays_absent_never_zero():
    """A bank reports no gross profit. Reporting 0.0 would make its margin 0%."""
    facts = FactsChannel("JPM", "19617", {"total revenue": 1.7e11, "net income": 5.8e10})
    out = await company_skill.run(
        SkillRequest(skill="company", entities=["JPM"]),
        facts_search=facts,
        resolver=FakeResolver({"jpm": FakeResolved("JPM", "19617", "JPMORGAN CHASE & CO")}),
        as_of=TODAY,
    )
    assert out.status is SkillStatus.PARTIAL
    assert "gross_profit" not in out.data["financials"]
    assert "Gross profit" in out.data["not_reported"]
    absent = [c for c in out.claims if c.kind == "absent"]
    assert any("Gross profit" in c.text for c in absent)
    assert all(c.value is None for c in absent)
    # And nowhere in the payload is there a zero standing in for the gap.
    assert all(v["value"] != 0 for v in out.data["financials"].values())


@pytest.mark.asyncio
async def test_every_reported_metric_carries_provenance():
    facts = FactsChannel("ODFL", "878927", {"total revenue": 5.8e9})
    out = await company_skill.run(
        SkillRequest(skill="company", entities=["ODFL"]),
        facts_search=facts, resolver=resolver_for(UNSEEN), as_of=TODAY,
    )
    for claim in [c for c in out.claims if c.kind != "absent"]:
        assert claim.citations, claim.text
        for idx in claim.citations:
            cite = out.citations[idx]
            assert cite["accession"]
            assert cite["view_filing_url"].endswith("odfl-20241231.htm")
            assert cite["filing_details_url"].endswith("-index.htm")
            assert cite["view_filing_url"] != cite["filing_details_url"]


@pytest.mark.asyncio
async def test_an_ambiguous_company_is_refused_rather_than_chosen():
    resolver = FakeResolver({"apple": FakeResolved(
        "AAPL", "320193", "Apple Inc.", 0.95, "fuzzy_name",
        alternatives=[{"ticker": "APLE", "name": "Apple Hospitality REIT", "score": 0.93}],
    )})
    out = await company_skill.run(
        SkillRequest(skill="company", entities=["Apple"]),
        facts_search=FactsChannel("AAPL", "320193", {"total revenue": 1.0}),
        resolver=resolver, as_of=TODAY,
    )
    assert out.status is SkillStatus.AMBIGUOUS_ENTITY
    assert out.abstained
    assert not out.data.get("financials")


@pytest.mark.asyncio
async def test_an_unresolvable_company_says_so_without_inventing_figures():
    out = await company_skill.run(
        SkillRequest(skill="company", entities=["Wobblegonk Industries"]),
        facts_search=FactsChannel("X", "1", {"total revenue": 1.0}),
        resolver=FakeResolver({}), as_of=TODAY,
    )
    assert out.status is SkillStatus.INSUFFICIENT_DATA
    assert out.claims == []


# ── Company: period gating ────────────────────────────────────────────────


@pytest.mark.asyncio
async def test_a_future_period_abstains_and_never_reaches_the_channel():
    facts = FactsChannel("CPRT", "900075", {"total revenue": 4.2e9})
    out = await company_skill.run(
        SkillRequest(skill="company", entities=["CPRT"], period="FY2029"),
        facts_search=facts, resolver=resolver_for(UNSEEN), as_of=TODAY,
    )
    assert out.status is SkillStatus.INSUFFICIENT_DATA
    assert out.abstained
    assert facts.queries == []
    assert out.verification["period"]["must_abstain"] is True


@pytest.mark.asyncio
async def test_the_future_period_abstention_is_the_same_answer_every_time():
    outs = []
    for _ in range(25):
        outs.append(await company_skill.run(
            SkillRequest(skill="company", entities=["CPRT"], period="FY2029"),
            facts_search=FactsChannel("CPRT", "900075", {"total revenue": 4.2e9}),
            resolver=resolver_for(UNSEEN), as_of=TODAY,
        ))
    assert len({o.status for o in outs}) == 1
    assert len({tuple(o.limitations) for o in outs}) == 1


# ── Company: channel failure is not emptiness ─────────────────────────────


@pytest.mark.asyncio
async def test_a_provider_failure_is_an_error_not_an_empty_company():
    out = await company_skill.run(
        SkillRequest(skill="company", entities=["WSO"]),
        facts_search=DeadChannel(), resolver=resolver_for(UNSEEN), as_of=TODAY,
    )
    assert out.status is SkillStatus.ERROR
    assert out.channels[0].state is ChannelState.FAILED
    assert out.degraded_channels
    assert any("did not answer" in l for l in out.limitations)
    assert not any("does not report" in l for l in out.limitations)


@pytest.mark.asyncio
async def test_a_timeout_is_distinguished_from_a_failure():
    out = await company_skill.run(
        SkillRequest(skill="company", entities=["WSO"]),
        facts_search=DeadChannel(TimeoutError("slow")),
        resolver=resolver_for(UNSEEN), as_of=TODAY,
    )
    assert out.channels[0].state is ChannelState.TIMEOUT


@pytest.mark.asyncio
async def test_an_empty_but_healthy_channel_is_insufficient_data_not_an_error():
    out = await company_skill.run(
        SkillRequest(skill="company", entities=["TPL"]),
        facts_search=EmptyChannel(), resolver=resolver_for(UNSEEN), as_of=TODAY,
    )
    assert out.status is SkillStatus.INSUFFICIENT_DATA
    assert out.channels[0].state is ChannelState.EMPTY
    assert not out.degraded_channels


@pytest.mark.asyncio
async def test_the_channel_report_carries_no_message_only_the_type():
    out = await company_skill.run(
        SkillRequest(skill="company", entities=["WSO"]),
        facts_search=DeadChannel(RuntimeError("postgres://user:pw@host/db unreachable")),
        resolver=resolver_for(UNSEEN), as_of=TODAY,
    )
    blob = str(out.as_dict())
    assert "postgres://" not in blob
    assert out.channels[0].error_type == "RuntimeError"


# ── Sentiment: arbitrary registrants ──────────────────────────────────────


POSITIVE = (
    "Revenue growth accelerated and margins improved substantially across the segment. "
    "Demand remains strong and the outlook is favorable for the coming year. "
    "We delivered record results with robust cash generation and improved profitability. "
    "Our expansion strategy exceeded expectations and drove significant gains. "
    "Operating efficiency increased and costs declined meaningfully this period. "
    "Customer retention strengthened and new bookings grew at a healthy pace. "
)
NEGATIVE = (
    "Revenue declined sharply and margins deteriorated across every region we serve. "
    "Demand weakened considerably and the outlook remains challenging and uncertain. "
    "We recorded a significant impairment charge and losses widened during the period. "
    "Competitive pressure intensified and pricing eroded throughout the year. "
    "Costs increased substantially and operating efficiency worsened materially. "
    "Customer attrition accelerated and new bookings fell well below our plan. "
)


class ProseChannel:
    def __init__(self, ticker, cik, text, n=3):
        self.ticker, self.cik, self.text, self.n = ticker, cik, text, n

    async def search(self, query, entities=None, top_k=10, filters=None):
        return [
            Passage(
                text=self.text,
                metadata=sec_meta(self.ticker, self.cik,
                                  accn=f"000012345{i}-25-000001"),
                title=f"{self.ticker} 10-K — 2024-12-31",
                section="Item 7. Management's Discussion and Analysis",
            )
            for i in range(self.n)
        ]


@pytest.mark.asyncio
@pytest.mark.parametrize("row", UNSEEN, ids=[r[0] for r in UNSEEN])
async def test_sentiment_answers_for_a_registrant_nobody_hard_coded(row):
    ticker, cik, _name, _ = row
    out = await sentiment_skill.run(
        SkillRequest(skill="sentiment", entities=[ticker]),
        text_search=ProseChannel(ticker, cik, POSITIVE),
        resolver=resolver_for(UNSEEN), as_of=TODAY,
    )
    assert out.status in (SkillStatus.SUCCESS, SkillStatus.CONFLICTING_EVIDENCE)
    assert out.data["scored_sentences"] >= sentiment_skill.MIN_SENTENCES
    assert out.entities[0]["ticker"] == ticker


@pytest.mark.asyncio
async def test_sentiment_separates_positive_negative_and_neutral_evidence():
    out = await sentiment_skill.run(
        SkillRequest(skill="sentiment", entities=["CPRT"]),
        text_search=ProseChannel("CPRT", "900075", POSITIVE),
        resolver=resolver_for(UNSEEN), as_of=TODAY,
    )
    for key in ("positive_evidence", "negative_evidence", "neutral_evidence"):
        assert key in out.data
    for e in out.data["positive_evidence"]:
        assert e["label"] == "positive"
        assert out.citations[e["citation"]]["accession"]


@pytest.mark.asyncio
async def test_sentiment_states_its_window_and_source_mix():
    out = await sentiment_skill.run(
        SkillRequest(skill="sentiment", entities=["ODFL"]),
        text_search=ProseChannel("ODFL", "878927", POSITIVE),
        resolver=resolver_for(UNSEEN), as_of=TODAY,
    )
    assert out.data["window"]["filings"]
    assert out.data["source_mix"] == {"sec_filing": out.data["scored_sentences"]}
    assert any("not on price" in l for l in out.limitations)


@pytest.mark.asyncio
async def test_no_market_data_reaches_the_sentiment_result():
    """Price direction is never silently redefined as sentiment."""
    out = await sentiment_skill.run(
        SkillRequest(skill="sentiment", entities=["TPL"]),
        text_search=ProseChannel("TPL", "1811074", NEGATIVE),
        resolver=resolver_for(UNSEEN), as_of=TODAY,
    )
    blob = str(out.as_dict()).lower()
    for banned in ("price", "close", "volume", "return", "ohlc"):
        assert f'"{banned}"' not in blob


@pytest.mark.asyncio
async def test_a_negative_filing_reads_negative():
    out = await sentiment_skill.run(
        SkillRequest(skill="sentiment", entities=["LNTH"]),
        text_search=ProseChannel("LNTH", "1521036", NEGATIVE),
        resolver=resolver_for(UNSEEN), as_of=TODAY,
    )
    assert out.data["overall"] in ("negative", "mixed")
    assert out.data["counts"]["negative"] > 0


@pytest.mark.asyncio
async def test_balanced_evidence_is_reported_as_conflicting_not_averaged_to_neutral():
    out = await sentiment_skill.run(
        SkillRequest(skill="sentiment", entities=["AOS"]),
        text_search=ProseChannel("AOS", "91142", POSITIVE + NEGATIVE),
        resolver=resolver_for(UNSEEN), as_of=TODAY,
    )
    if out.data["conflicting"]:
        assert out.status is SkillStatus.CONFLICTING_EVIDENCE
        assert out.data["overall"] == "mixed"
        assert any("comparable measure" in l for l in out.limitations)
    else:
        # Not balanced enough to conflict — then it must not claim to be mixed.
        assert out.data["overall"] != "mixed"


def test_the_mix_rule_calls_a_balanced_document_conflicting():
    label, conflict = sentiment_skill.classify_mix(40, 40, 20)
    assert (label, conflict) == ("mixed", True)


def test_the_mix_rule_does_not_call_a_lopsided_document_conflicting():
    label, conflict = sentiment_skill.classify_mix(70, 10, 20)
    assert conflict is False
    assert label == "positive"


def test_the_mix_rule_survives_an_empty_document():
    assert sentiment_skill.classify_mix(0, 0, 0) == ("neutral", False)


@pytest.mark.asyncio
async def test_too_little_text_is_insufficient_not_a_confident_neutral():
    out = await sentiment_skill.run(
        SkillRequest(skill="sentiment", entities=["EXPD"]),
        text_search=ProseChannel("EXPD", "746515",
                                 "Revenue grew modestly during the period under review.", n=1),
        resolver=resolver_for(UNSEEN), as_of=TODAY,
    )
    assert out.status is SkillStatus.INSUFFICIENT_DATA
    assert "overall" not in out.data
    assert out.abstained


@pytest.mark.asyncio
async def test_a_sentiment_provider_failure_is_not_an_absence_of_disclosure():
    out = await sentiment_skill.run(
        SkillRequest(skill="sentiment", entities=["WSO"]),
        text_search=DeadChannel(), resolver=resolver_for(UNSEEN), as_of=TODAY,
    )
    assert out.status is SkillStatus.ERROR
    assert out.channels[0].state is ChannelState.FAILED
    assert any("retrieval failure" in l for l in out.limitations)


@pytest.mark.asyncio
async def test_sentiment_abstains_on_a_future_period_without_calling_the_channel():
    class Counting(ProseChannel):
        calls = 0

        async def search(self, *a, **k):
            Counting.calls += 1
            return await super().search(*a, **k)

    out = await sentiment_skill.run(
        SkillRequest(skill="sentiment", entities=["CPRT"], period="FY2029"),
        text_search=Counting("CPRT", "900075", POSITIVE),
        resolver=resolver_for(UNSEEN), as_of=TODAY,
    )
    assert out.status is SkillStatus.INSUFFICIENT_DATA
    assert Counting.calls == 0


@pytest.mark.asyncio
async def test_sentiment_refuses_an_ambiguous_company():
    resolver = FakeResolver({"apple": FakeResolved(
        "AAPL", "320193", "Apple Inc.", 0.95, "fuzzy_name",
        alternatives=[{"ticker": "APLE", "name": "Apple Hospitality REIT", "score": 0.93}],
    )})
    out = await sentiment_skill.run(
        SkillRequest(skill="sentiment", entities=["Apple"]),
        text_search=ProseChannel("AAPL", "320193", POSITIVE),
        resolver=resolver, as_of=TODAY,
    )
    assert out.status is SkillStatus.AMBIGUOUS_ENTITY


@pytest.mark.asyncio
async def test_sentiment_never_reports_a_trend_it_did_not_compute():
    out = await sentiment_skill.run(
        SkillRequest(skill="sentiment", entities=["CPRT"]),
        text_search=ProseChannel("CPRT", "900075", POSITIVE),
        resolver=resolver_for(UNSEEN), as_of=TODAY,
    )
    assert out.data["trend"] is None
    assert out.data["trend_note"]


# ── Capability, before execution ──────────────────────────────────────────


@pytest.mark.asyncio
@pytest.mark.parametrize("mod", [company_skill, sentiment_skill],
                         ids=["company", "sentiment"])
async def test_capability_is_executable_for_an_arbitrary_registrant(mod):
    cap = await mod.capability(
        SkillRequest(skill=mod.SKILL, entities=["LNTH"]), resolver=resolver_for(UNSEEN)
    )
    assert cap.executable is True
    assert cap.entity_status == "resolved"
    assert cap.limitations == []


@pytest.mark.asyncio
@pytest.mark.parametrize("mod", [company_skill, sentiment_skill],
                         ids=["company", "sentiment"])
async def test_capability_refuses_an_unknown_company_without_calling_it_unsupported(mod):
    cap = await mod.capability(
        SkillRequest(skill=mod.SKILL, entities=["Wobblegonk"]), resolver=FakeResolver({})
    )
    assert cap.executable is False
    assert cap.entity_status == "unknown"
    # The limitation is about the mention, never about the product supporting
    # some companies and not others.
    assert all("unsupported" not in l for l in cap.limitations)


# ── Period pinning ────────────────────────────────────────────────────────
#
# Found live, against Copart: asking for "latest" resolved operating income and
# net income to the FY2025 10-K and revenue to a 2018 one, because each metric
# is fetched independently. The profile then showed FY2018 revenue beside FY2025
# operating income as one company's current position — a comparison the filings
# never make, built out of two individually-correct, individually-cited numbers.


class MixedPeriodChannel:
    """Answers each metric from a different fiscal year, as SEC really did."""

    def __init__(self, ticker, cik, by_metric):
        self.ticker, self.cik, self.by_metric = ticker, cik, by_metric

    async def search(self, query, entities=None, top_k=10, filters=None):
        for key, (value, fy, accn) in self.by_metric.items():
            if key in query.lower():
                return [Passage(
                    text=f"[EXACT FILING FIGURE] {value}",
                    metadata=sec_meta(self.ticker, self.cik, value=value,
                                      fy=fy, accn=accn),
                    title=f"{self.ticker} 10-K — FY{fy}",
                )]
        return []


def _mixed():
    return MixedPeriodChannel("CPRT", "900075", {
        "total revenue": (1_805_695_000.0, 2018, "0000900075-18-000048"),
        "operating income": (1_696_714_000.0, 2025, "0001628280-25-042946"),
        "net income": (1_552_449_000.0, 2025, "0001628280-25-042946"),
    })


@pytest.mark.asyncio
async def test_a_profile_never_mixes_two_fiscal_years():
    out = await company_skill.run(
        SkillRequest(skill="company", entities=["CPRT"]),
        facts_search=_mixed(), resolver=resolver_for(UNSEEN), as_of=TODAY,
    )
    periods = {v["period"] for v in out.data["financials"].values()}
    assert len(periods) == 1, periods
    assert out.data["reporting_period"] in periods


@pytest.mark.asyncio
async def test_the_newest_period_wins_and_the_older_figure_is_dropped():
    out = await company_skill.run(
        SkillRequest(skill="company", entities=["CPRT"]),
        facts_search=_mixed(), resolver=resolver_for(UNSEEN), as_of=TODAY,
    )
    assert out.data["reporting_period"] == "FY2025"
    assert "revenue" not in out.data["financials"]
    assert "Revenue" in out.data["not_reported"]
    assert out.data["financials"]["operating_income"]["value"] == 1_696_714_000.0


@pytest.mark.asyncio
async def test_the_dropped_figure_is_named_rather_than_silently_discarded():
    out = await company_skill.run(
        SkillRequest(skill="company", entities=["CPRT"]),
        facts_search=_mixed(), resolver=resolver_for(UNSEEN), as_of=TODAY,
    )
    assert out.data["off_period_excluded"] == {"revenue": "FY2018"}
    assert any("another period" in l for l in out.limitations)
    stale_claim = next(c for c in out.claims
                       if c.kind == "absent" and "Revenue" in c.text)
    assert "FY2018" in stale_claim.text
    assert stale_claim.value is None


@pytest.mark.asyncio
async def test_the_result_states_which_period_the_figures_are_from():
    out = await company_skill.run(
        SkillRequest(skill="company", entities=["CPRT"]),
        facts_search=_mixed(), resolver=resolver_for(UNSEEN), as_of=TODAY,
    )
    assert any("All figures are from FY2025" in l for l in out.limitations)


@pytest.mark.asyncio
async def test_pinning_leaves_a_single_period_profile_untouched():
    facts = FactsChannel("AOS", "91142", {"total revenue": 3.83e9,
                                          "net income": 5.3e8})
    out = await company_skill.run(
        SkillRequest(skill="company", entities=["AOS"]),
        facts_search=facts, resolver=resolver_for(UNSEEN), as_of=TODAY,
    )
    assert out.data["off_period_excluded"] == {}
    assert out.data["financials"]["revenue"]["value"] == 3.83e9


def test_an_undated_fact_is_kept_rather_than_assumed_old():
    """A balance-sheet item the XBRL channel dates differently must survive."""
    kept, dropped = company_skill.pin_to_one_period({
        "revenue": {"metadata": {"fiscal_year": 2025}, "period": "FY2025"},
        "cash": {"metadata": {}, "period": ""},
    })
    assert set(kept) == {"revenue", "cash"}
    assert dropped == {}


def test_pinning_an_empty_set_is_a_no_op():
    assert company_skill.pin_to_one_period({}) == ({}, {})


def test_quarters_rank_within_a_year():
    kept, dropped = company_skill.pin_to_one_period({
        "a": {"metadata": {"fiscal_year": 2026, "fiscal_quarter": 1}, "period": "FY2026Q1"},
        "b": {"metadata": {"fiscal_year": 2026, "fiscal_quarter": 2}, "period": "FY2026Q2"},
    })
    assert set(kept) == {"b"}
    assert set(dropped) == {"a"}
