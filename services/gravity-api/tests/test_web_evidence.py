"""
The unified evidence model (spec sections 8, 9, 12, 13, 14, 16, 17).

Matrix items covered here: F (SEC/web disagreement), G (duplicates),
H (stale source), plus the claim map and the tier policy.

The through-line: an answer with six citations where every claim is grounded and
an answer with six citations where four claims are the model's own inference
render identically in a response body. `Claim` and `EvidenceSet.summary()` are
what make them different objects.
"""
from datetime import datetime, timedelta, timezone

import pytest

from app.core.research.evidence import (
    CONTEXT,
    FACT,
    INFERENCE,
    LOCAL_EVIDENCE,
    SEC_EVIDENCE,
    WEB_EVIDENCE,
    Claim,
    Evidence,
    EvidenceSet,
    cross_check,
    extract_values,
    parse_date,
    values_agree,
)
from app.core.research.source_quality import (
    COMPANY,
    NEWS,
    SEC_FILINGS,
    WEB,
    Tier,
    admissible_for_financial_fact,
    category_for,
    rate,
    tier_for,
)

NOW = datetime(2026, 8, 26, tzinfo=timezone.utc)


def _web(url, text="text " * 40, title="t", published=None, relevance=0.5,
         location="paragraph 1"):
    return Evidence(
        kind=WEB_EVIDENCE, text=text, title=title, url=url,
        source_type="web_page", published_at=published,
        retrieved_at=NOW, relevance=relevance, location=location,
    )


def _sec(text, accession="0000821189-25-000011", concept="Revenues", value="24.2 billion"):
    return Evidence(
        kind=SEC_EVIDENCE, text=text, title="EOG 10-K FY2025",
        source_type="10-K",
        provenance={"accession": accession, "xbrl_concept": concept,
                    "fiscal_year": 2025, "fiscal_quarter": "",
                    "dimension_value": "", "value": value},
    )


class TestSourceTiers:
    """Spec section 8: the ranking must prefer authoritative sources."""

    @pytest.mark.parametrize("url,tier", [
        ("https://www.sec.gov/Archives/edgar/data/1/x-index.htm", Tier.TIER_1),
        ("https://data.sec.gov/api/xbrl/companyconcept/x.json",   Tier.TIER_1),
        ("https://fred.stlouisfed.org/series/CPIAUCSL",           Tier.TIER_1),
        ("https://investor.nvidia.com/news/x",                    Tier.TIER_1),
        ("https://ir.eogresources.com/news/x",                    Tier.TIER_1),
        ("https://www.reuters.com/business/x",                    Tier.TIER_2),
        ("https://www.bloomberg.com/news/x",                      Tier.TIER_2),
        ("https://www.businesswire.com/news/home/x",              Tier.TIER_2),
        ("https://randomblog.substack.com/p/x",                   Tier.TIER_3),
        ("https://unknown-domain-nobody-scored.example/x",         Tier.TIER_4),
    ])
    def test_domains_map_to_the_expected_tier(self, url, tier):
        assert tier_for(url) is tier, f"{url} -> {tier_for(url)}"

    @pytest.mark.parametrize("url,doc_type,category", [
        ("https://www.sec.gov/Archives/edgar/data/1/x.htm", "", SEC_FILINGS),
        ("", "10-K", SEC_FILINGS),
        ("", "10-Q", SEC_FILINGS),
        ("https://ir.nvidia.com/x", "", COMPANY),
        ("https://www.businesswire.com/x", "", COMPANY),
        ("", "press_release", COMPANY),
        ("", "earnings_transcript", COMPANY),
        ("https://www.reuters.com/x", "", NEWS),
        ("https://www.cnbc.com/x", "", NEWS),
        ("https://example.com/whitepaper", "", WEB),
    ])
    def test_sources_land_in_the_right_ui_category(self, url, doc_type, category):
        assert category_for(url, document_type=doc_type) == category

    def test_a_filing_url_is_sec_even_when_the_title_reads_like_news(self):
        assert category_for(
            "https://www.sec.gov/Archives/edgar/data/1/x.htm",
            title="Breaking news: EOG reports") == SEC_FILINGS


class TestFinancialSourcePolicy:
    """Spec section 9: SEC and official releases outrank generic web pages."""

    def test_sec_may_supply_a_reported_figure(self):
        ok, why = admissible_for_financial_fact(
            rate("https://www.sec.gov/Archives/edgar/data/821189/x-index.htm"))
        assert ok and why == ""

    def test_issuer_ir_may_supply_a_reported_figure(self):
        ok, _ = admissible_for_financial_fact(rate("https://ir.eogresources.com/x"))
        assert ok

    @pytest.mark.parametrize("url", [
        "https://www.reuters.com/business/eog-results",
        "https://www.cnbc.com/eog",
        "https://seekingalpha.com/article/eog",
        "https://randomblog.substack.com/p/eog",
    ])
    def test_third_party_sources_may_not_supply_a_reported_figure(self, url):
        """
        A newspaper reporting the number accurately is still not the filing. The
        moment it may supply the figure there is no way to tell which one the
        answer used.
        """
        ok, why = admissible_for_financial_fact(rate(url))
        assert not ok
        assert "SEC filings" in why


class TestFreshness:
    """Spec section 16 / matrix H: stale evidence must not appear as current."""

    def test_a_recent_article_is_fresh_for_a_news_question(self):
        ev = _web("https://reuters.com/a", published=NOW - timedelta(days=1))
        assert ev.is_fresh_for("MARKET_NEWS", now=NOW)[0]

    def test_an_old_article_is_refused_for_a_news_question(self):
        ev = _web("https://reuters.com/a", published=NOW - timedelta(days=90))
        fresh, why = ev.is_fresh_for("MARKET_NEWS", now=NOW)
        assert not fresh
        assert "90d ago" in why and "limit 3d" in why

    def test_the_same_old_article_is_fine_for_a_research_question(self):
        ev = _web("https://reuters.com/a", published=NOW - timedelta(days=90))
        assert ev.is_fresh_for("COMPANY_RESEARCH", now=NOW)[0]

    def test_an_undated_page_is_refused_only_where_recency_is_the_point(self):
        ev = _web("https://reuters.com/a", published=None)
        assert not ev.is_fresh_for("MARKET_NEWS", now=NOW)[0]
        assert not ev.is_fresh_for("MARKET_CONTEXT", now=NOW)[0]
        # Elsewhere it is usable and simply says the date is unknown.
        fresh, why = ev.is_fresh_for("COMPANY_RESEARCH", now=NOW)
        assert fresh and "unknown" in why

    def test_sec_evidence_never_goes_stale(self):
        """
        A filed figure for a closed period does not expire, and `evidence_gate`
        already handles restatement with its own 90-day re-validation. Applying
        a 3-day news window to a 10-K would reject the authoritative source in
        favour of a blog post about it.
        """
        old = _sec("Revenue was $24.2 billion")
        old.published_at = NOW - timedelta(days=3650)
        assert old.is_fresh_for("MARKET_NEWS", now=NOW)[0]

    def test_the_set_counts_what_it_dropped_for_staleness(self):
        s = EvidenceSet("MARKET_NEWS")
        assert not s.add(_web("https://r.com/old",
                              published=NOW - timedelta(days=200)), now=NOW)
        assert len(s.dropped_stale) == 1


class TestDeduplication:
    """Spec section 17 / matrix G."""

    def test_the_same_article_under_two_tracked_urls_is_one_source(self):
        s = EvidenceSet("COMPANY_RESEARCH")
        assert s.add(_web("https://www.reuters.com/x?utm_source=a", title="EOG Q4"))
        assert not s.add(_web("https://reuters.com/x/", title="EOG Q4"))
        assert len(s.evidence) == 1
        assert s.dropped_duplicates == 1

    def test_syndicated_copies_collapse_to_one(self):
        headline = "EOG Resources reports fourth quarter 2025 results"
        s = EvidenceSet("COMPANY_RESEARCH")
        s.add(_web("https://finance.yahoo.com/news/eog", title=headline))
        s.add(_web("https://www.reuters.com/business/eog", title=headline))
        assert len(s.evidence) == 1

    def test_the_better_source_wins_a_duplicate(self):
        headline = "EOG Resources reports fourth quarter 2025 results"
        s = EvidenceSet("COMPANY_RESEARCH")
        s.add(_web("https://randomblog.substack.com/p/eog", title=headline))
        s.add(_web("https://ir.eogresources.com/eog", title=headline))
        assert len(s.evidence) == 1
        assert s.evidence[0].tier is Tier.TIER_1

    def test_two_facts_from_one_filing_are_two_pieces_of_evidence(self):
        """A filing is not the unit of SEC evidence — the fact read from it is."""
        s = EvidenceSet("EXACT_FINANCIAL_FACT")
        assert s.add(_sec("Revenue 24.2B", concept="Revenues"))
        assert s.add(_sec("Net income 7.6B", concept="NetIncomeLoss"))
        assert len(s.evidence) == 2

    def test_different_articles_are_not_merged(self):
        s = EvidenceSet("COMPANY_RESEARCH")
        s.add(_web("https://reuters.com/a", title="Story A"))
        s.add(_web("https://reuters.com/b", title="Story B"))
        assert len(s.evidence) == 2


class TestOrderingAndGrouping:
    def test_authoritative_sources_sort_ahead_of_more_relevant_weak_ones(self):
        """Tier dominates relevance — the whole point of spec section 8."""
        s = EvidenceSet("COMPANY_RESEARCH")
        s.add(_web("https://randomblog.substack.com/p/x", title="blog", relevance=0.99))
        s.add(_web("https://ir.nvidia.com/x", title="IR", relevance=0.10))
        assert s.evidence[0].domain == "ir.nvidia.com"

    def test_sources_group_into_the_four_ui_categories(self):
        s = EvidenceSet("COMPANY_RESEARCH")
        s.add(_sec("Revenue 24.2B"))
        s.add(_web("https://ir.eogresources.com/x", title="IR release"))
        s.add(_web("https://www.reuters.com/x", title="Reuters story"))
        s.add(_web("https://example.com/paper", title="Industry paper"))
        groups = s.by_category()
        assert set(groups) == {SEC_FILINGS, COMPANY, NEWS, WEB}
        assert len(groups[SEC_FILINGS]) == 1


class TestClaimEvidenceMapping:
    """Spec section 13 — 'do NOT simply attach citations at the end'."""

    def test_a_claim_carries_its_own_evidence(self):
        e1, e2 = _web("https://reuters.com/a"), _web("https://ir.eog.com/b")
        c = Claim("Revenue declined 18%", kind=FACT, evidence=[e1, e2])
        assert c.supported
        assert c.as_dict()["evidence_count"] == 2

    def test_a_claim_with_no_evidence_is_not_supported(self):
        assert not Claim("Revenue declined 18%", kind=FACT).supported

    def test_an_inference_is_never_reported_as_supported_fact(self):
        """
        The distinction spec section 22 asks for. An inference may reason over
        evidence — that is what makes it an inference rather than invention —
        but it is never a reported fact.
        """
        c = Claim("Lower prices appear to explain the decline",
                  kind=INFERENCE, evidence=[_web("https://reuters.com/a")])
        assert not c.supported
        assert c.as_dict()["kind"] == INFERENCE

    def test_the_summary_separates_supported_from_inferred(self):
        s = EvidenceSet("FINANCIAL_CALCULATION")
        ev = _web("https://reuters.com/a")
        s.add(ev)
        s.add_claim(Claim("Revenue fell 18%", FACT, [_sec("Revenue 24.2B")]))
        s.add_claim(Claim("Oil prices fell", CONTEXT, [ev]))
        s.add_claim(Claim("Prices likely drove it", INFERENCE, [ev]))
        s.add_claim(Claim("Margins will recover", FACT))  # unsupported
        summary = s.summary()
        assert summary["claims_total"] == 4
        assert summary["claims_supported"] == 2
        assert summary["claims_inferred"] == 1
        assert summary["claims_unsupported"] == 1


class TestCrossSourceVerification:
    """Spec sections 9 and 14 / matrix F: never average, always preserve."""

    def test_agreeing_sources_corroborate(self):
        sec = _sec("Total revenue was $24.2 billion for fiscal 2025")
        news = _web("https://reuters.com/a",
                    text="EOG posted revenue of $24.2 billion in fiscal 2025.")
        corroborating, conflicts = cross_check(sec, [news])
        assert corroborating == [news]
        assert conflicts == []

    def test_rounding_differences_still_agree(self):
        sec = _sec("Revenue of 24,200 million")
        news = _web("https://reuters.com/a", text="revenue of $24.2 billion")
        corroborating, conflicts = cross_check(sec, [news])
        assert corroborating and not conflicts

    def test_a_disagreement_is_preserved_not_averaged(self):
        sec = _sec("Total revenue was $24.2 billion for fiscal 2025")
        news = _web("https://cnbc.com/a", text="EOG revenue came in at $31.0 billion.")
        corroborating, conflicts = cross_check(sec, [news], subject="revenue")
        assert not corroborating
        assert len(conflicts) == 1
        d = conflicts[0].as_dict()
        assert d["authoritative_value"] == "24,200,000,000"
        assert d["conflicting_value"] == "31,000,000,000"
        assert "not averaged" in d["resolution"]
        # The averaged value must appear nowhere.
        assert "27,600,000,000" not in str(d)

    def test_the_sec_source_is_named_authoritative(self):
        sec = _sec("Revenue was $24.2 billion")
        news = _web("https://cnbc.com/a", text="revenue of $31.0 billion")
        _, conflicts = cross_check(sec, [news])
        assert conflicts[0].authoritative is sec

    def test_an_unrelated_magnitude_is_not_a_disagreement(self):
        """Most articles do not restate exact revenue; silence is not conflict."""
        sec = _sec("Revenue was $24.2 billion")
        news = _web("https://reuters.com/a",
                    text="EOG settled a $5 million environmental claim.")
        corroborating, conflicts = cross_check(sec, [news])
        assert not corroborating and not conflicts

    def test_two_sec_sources_are_never_compared_against_each_other(self):
        sec = _sec("Revenue was $24.2 billion")
        other = _sec("Revenue was $31.0 billion", concept="Other")
        _, conflicts = cross_check(sec, [other])
        assert conflicts == []


class TestValueExtraction:
    @pytest.mark.parametrize("text,expected", [
        ("revenue of $24.2 billion", 24_200_000_000),
        ("24,200 million", 24_200_000_000),
        ("$7.6bn", 7_600_000_000),
        ("1.5 trillion", 1_500_000_000_000),
        ("margin of 18%", 18.0),
    ])
    def test_magnitudes_are_scale_normalised(self, text, expected):
        assert extract_values(text)[0] == pytest.approx(expected)

    def test_values_within_one_percent_are_the_same_figure(self):
        assert values_agree(24_200_000_000, 24_198_000_000)
        assert not values_agree(24_200_000_000, 31_000_000_000)


class TestDateParsing:
    @pytest.mark.parametrize("raw,year", [
        ("2026-08-20T14:30:00Z", 2026),
        ("2026-08-20", 2026),
        ("20260820T143000Z", 2026),
        ("Wed, 20 Aug 2026 14:30:00 GMT", 2026),
    ])
    def test_known_shapes_parse(self, raw, year):
        assert parse_date(raw).year == year

    @pytest.mark.parametrize("raw", ["", None, "not a date", "yesterday"])
    def test_an_unknown_date_stays_unknown(self, raw):
        """Inventing one is how stale evidence gets presented as current."""
        assert parse_date(raw) is None


class TestWireShape:
    def test_a_web_source_carries_every_field_the_spec_requires(self):
        ev = _web("https://www.reuters.com/business/x?utm_source=t",
                  title="EOG story", published=NOW - timedelta(days=2))
        d = ev.as_source_dict()
        for field in ("url", "canonical_url", "domain", "published_at",
                      "retrieved_at", "source_type", "evidence_location",
                      "category", "tier", "evidence_kind"):
            assert field in d, f"missing {field}"
        assert d["canonical_url"] == "https://reuters.com/business/x"
        assert d["evidence_kind"] == WEB_EVIDENCE

    def test_nothing_is_invented_for_a_page_with_no_declared_date(self):
        d = _web("https://example.com/x", published=None).as_source_dict()
        assert "published_at" not in d

    def test_a_local_chunk_acquires_no_web_fields(self):
        ev = Evidence(kind=LOCAL_EVIDENCE, text="prose " * 40, chunk_id="c1")
        d = ev.as_source_dict()
        assert "url" not in d and "domain" not in d


class TestBugsFoundByRunningLive:
    """
    Two defects that every fixture-based test passed straight over. Both were
    found by running golden question 2 against the real SEC filing and the real
    Tavily/press-release stack, which is why the live run is part of the work
    and not a formality.
    """

    def test_a_form_name_is_not_read_as_a_quantity(self):
        """
        The live SEC passage is:
            "[EXACT FILING FIGURE] EOG revenue for FY2025 (10-K): $22,632,000,000"
        `extract_values` returned 10 as its FIRST number — the "10" of "10-K" —
        so every cross-source comparison against it was nonsense.
        """
        text = "[EXACT FILING FIGURE] EOG revenue for FY2025 (10-K): $22,632,000,000"
        values = extract_values(text)
        assert 10.0 not in values, f"form number leaked into {values}"
        assert 22_632_000_000 in values

    @pytest.mark.parametrize("form", ["10-K", "10-Q", "8-K", "20-F", "6-K", "13-D"])
    def test_no_form_name_contributes_a_number(self, form):
        assert extract_values(f"Reported in the {form} filing.") == []

    def test_the_authoritative_value_comes_from_provenance_not_from_prose(self):
        """
        The SEC resolver already parsed the exact value out of XBRL. Re-deriving
        it by scanning prose is strictly worse and was wrong in practice.
        """
        sec = Evidence(
            kind=SEC_EVIDENCE, source_type="10-K",
            text="[EXACT FILING FIGURE] EOG revenue for FY2025 (10-K): $22,632,000,000",
            provenance={"accession": "0000821189-26-000054", "xbrl_concept": "Revenues",
                        "fiscal_year": 2025, "fiscal_quarter": "",
                        "dimension_value": "", "value": 22_632_000_000})
        agreeing = _web("https://prnewswire.com/eog",
                        text="EOG reported total revenue of $22.63 billion for 2025.")
        corroborating, conflicts = cross_check(sec, [agreeing])
        assert corroborating == [agreeing]
        assert conflicts == [], "an agreeing source must not be flagged as a conflict"

    def test_the_headline_figure_wins_over_an_incidental_one(self):
        """
        Position in a sentence does not rank magnitudes: a passage states its
        headline figure alongside per-share amounts and percentages.
        """
        assert max(extract_values("EPS of $4.20 on revenue of $22.6 billion"), key=abs) \
            == pytest.approx(22_600_000_000)

    def test_three_passages_from_one_page_are_three_pieces_of_evidence(self):
        """
        Keying web evidence on the URL alone collapsed them to one: a live press
        release yielded five passages and contributed a single piece of evidence.
        The passage is the unit, exactly as the fact — not the filing — is the
        unit for SEC evidence.
        """
        s = EvidenceSet("FINANCIAL_CALCULATION")
        for i in (1, 2, 3):
            assert s.add(_web("https://prnewswire.com/eog-q4",
                              title="EOG reports fourth quarter and full year results",
                              location=f"paragraph {i}"), now=NOW), i
        assert len(s.evidence) == 3

    def test_the_same_passage_twice_is_still_one(self):
        s = EvidenceSet("FINANCIAL_CALCULATION")
        assert s.add(_web("https://prnewswire.com/x", location="paragraph 1"), now=NOW)
        assert not s.add(_web("https://prnewswire.com/x", location="paragraph 1"), now=NOW)
        assert s.dropped_duplicates == 1

    def test_a_different_metric_of_similar_size_is_not_a_disagreement(self):
        """
        A press release states operating cash flow, capex and total revenue
        within one order of magnitude of each other. Comparing the filing's
        revenue against whichever happened to be nearest produced three
        confident "disagreements" between sources that agreed. Observed live
        against EOG's Q4 release.
        """
        sec = _sec("Revenue was $22.6 billion", concept="Revenues",
                   value=22_632_000_000)
        sec.provenance["value"] = 22_632_000_000
        other = _web("https://prnewswire.com/eog",
                     text="EOG generated discretionary cash flow of $11.0 billion "
                          "and returned $5.5 billion to shareholders.")
        corroborating, conflicts = cross_check(sec, [other], subject="revenue")
        assert conflicts == [], "a passage that never mentions revenue is silent, not conflicting"
        assert corroborating == []

    def test_a_genuine_disagreement_about_the_same_metric_is_still_raised(self):
        sec = _sec("Revenue was $22.6 billion", concept="Revenues",
                   value=22_632_000_000)
        sec.provenance["value"] = 22_632_000_000
        other = _web("https://cnbc.com/eog",
                     text="EOG reported total revenue of $31.0 billion for the year.")
        _, conflicts = cross_check(sec, [other], subject="revenue")
        assert len(conflicts) == 1
        assert conflicts[0].as_dict()["conflicting_value"] == "31,000,000,000"
