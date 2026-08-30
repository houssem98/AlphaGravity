"""
Scope-aware answers: useful when partial, never overstated as a census.

Two failure modes, and this suite exists because they pull in opposite
directions. Abstaining on "which S&P 500 companies mentioned tariff risk"
because 503 filings cannot be read throws away a real answer. Listing eleven
confirmed matches without saying eleven out of how many lets a reader take a
sample for a census. A fix for either one that reintroduces the other is not a
fix, so both are asserted here.
"""

from __future__ import annotations

import pytest

from app.core.skills.scope import (
    CoverageStatus, MemberFinding, ScopeStatus, Universe, assess,
    classify_member,
)

SP500 = Universe(name="the S&P 500", size=503, enumerable=True, as_of="2026-08-01")
UNBOUNDED = Universe(name="US-listed companies")
KNOWN_BUT_UNLISTED = Universe(name="the S&P 500", size=503, enumerable=False)


def confirmed(cid, ticker=""):
    return classify_member(cid, ticker=ticker, source_class="sec_filing",
                           citations=(0,), supported=True)


def candidate(cid, ticker=""):
    return classify_member(cid, ticker=ticker, source_class="news",
                           citations=(1,), supported=True)


# ── classify_member ───────────────────────────────────────────────────────


def test_a_filing_that_says_it_is_a_confirmed_match():
    f = confirmed("cik:1", "AAPL")
    assert f.status is CoverageStatus.PRIMARY_CONFIRMED
    assert f.is_confirmed


def test_a_news_report_about_a_filing_is_a_lead_not_a_match():
    """Evidence that a filing says X, from something that is not the filing."""
    f = candidate("cik:2", "MSFT")
    assert f.status is CoverageStatus.SECONDARY_CANDIDATE
    assert not f.is_confirmed
    assert "lead" in f.note


def test_a_filing_that_was_read_and_does_not_say_it_is_refuted():
    f = classify_member("cik:3", source_class="sec_filing", supported=False)
    assert f.status is CoverageStatus.PRIMARY_REFUTED
    assert not f.is_confirmed


def test_a_member_nobody_looked_at_is_not_examined():
    assert classify_member("cik:4").status is CoverageStatus.NOT_EXAMINED


def test_a_caller_cannot_promote_a_secondary_source_by_asserting_support():
    """`supported=True` from a blog is still not a filing."""
    f = classify_member("cik:5", source_class="blog", supported=True)
    assert f.status is CoverageStatus.SECONDARY_CANDIDATE


def test_a_secondary_only_claim_stays_a_candidate_even_with_no_primary():
    f = classify_member("cik:6", source_class="news", supported=True,
                        primary_available=False)
    assert f.status is CoverageStatus.SECONDARY_CANDIDATE
    assert "no primary filing was available" in f.note


@pytest.mark.parametrize("cls", ["sec_filing", "edgar_text", "edgar", "xbrl"])
def test_every_primary_class_can_confirm(cls):
    f = classify_member("cik:7", source_class=cls, supported=True)
    assert f.status is CoverageStatus.PRIMARY_CONFIRMED


@pytest.mark.parametrize("cls", ["news", "blog", "analyst", "web", "transcript"])
def test_no_secondary_class_can_confirm(cls):
    f = classify_member("cik:8", source_class=cls, supported=True)
    assert f.status is not CoverageStatus.PRIMARY_CONFIRMED


# ── assess: the exhaustiveness gate ───────────────────────────────────────


def test_eleven_confirmed_out_of_503_is_a_useful_partial_answer():
    """The roadmap's case. Not an abstention."""
    r = assess([confirmed(f"cik:{i}") for i in range(11)], SP500)
    assert r.scope_status is ScopeStatus.PARTIAL
    assert len(r.confirmed) == 11
    assert not r.claims_exhaustive


def test_a_partial_answer_says_at_least_and_names_the_denominator():
    r = assess([confirmed(f"cik:{i}") for i in range(11)], SP500)
    h = r.headline()
    assert "At least 11" in h
    assert "503" in h
    assert "may be others" in h


def test_a_partial_answer_never_reads_as_a_census():
    r = assess([confirmed("cik:1")], SP500)
    h = r.headline().lower()
    for forbidden in ("all ", "every ", "the only", "complete list", "none other"):
        assert forbidden not in h, forbidden


def test_exhaustive_requires_examining_the_whole_universe():
    r = assess([confirmed(f"cik:{i}") for i in range(11)], SP500, examined=503)
    assert r.scope_status is ScopeStatus.EXHAUSTIVE
    assert r.headline().startswith("All 503")


def test_one_member_short_of_the_universe_is_not_exhaustive():
    r = assess([confirmed("cik:1")], SP500, examined=502)
    assert r.scope_status is ScopeStatus.PARTIAL


def test_an_unbounded_universe_can_never_be_exhaustive():
    """No count of examinations covers a set you cannot enumerate."""
    r = assess([confirmed(f"cik:{i}") for i in range(50)], UNBOUNDED,
               examined=10_000)
    assert r.scope_status is ScopeStatus.PARTIAL
    assert any("not known" in l for l in r.limitations)


def test_a_known_size_without_the_membership_list_is_not_exhaustive():
    """Knowing there are 503 is not the same as knowing which 503."""
    r = assess([confirmed("cik:1")], KNOWN_BUT_UNLISTED, examined=503)
    assert r.scope_status is ScopeStatus.PARTIAL
    assert any("membership list was not retrieved" in l for l in r.limitations)


def test_nothing_confirmed_is_insufficient_not_a_claim_that_none_match():
    r = assess([candidate("cik:1"), candidate("cik:2")], SP500)
    assert r.scope_status is ScopeStatus.INSUFFICIENT
    assert "not evidence that none match" in r.headline()


def test_an_empty_result_does_not_become_exhaustive():
    r = assess([], SP500, examined=503)
    assert r.scope_status is ScopeStatus.INSUFFICIENT


def test_refuted_members_do_not_count_toward_the_answer():
    findings = [confirmed("cik:1"),
                classify_member("cik:2", source_class="sec_filing", supported=False)]
    r = assess(findings, SP500)
    assert len(r.confirmed) == 1
    assert len(r.refuted) == 1


def test_candidates_are_reported_separately_and_counted():
    r = assess([confirmed("cik:1"), candidate("cik:2"), candidate("cik:3")], SP500)
    assert len(r.confirmed) == 1
    assert len(r.candidates) == 2
    assert any("2 further name(s)" in l for l in r.limitations)


def test_the_unexamined_remainder_is_stated_with_a_number():
    r = assess([confirmed(f"cik:{i}") for i in range(11)], SP500, examined=40)
    assert any("40 of 503" in l and "463" in l for l in r.limitations)


def test_examined_is_counted_from_the_findings_when_not_supplied():
    findings = [confirmed("cik:1"), candidate("cik:2"),
                classify_member("cik:3")]          # NOT_EXAMINED
    r = assess(findings, SP500)
    assert r.examined == 2


def test_membership_as_of_date_is_carried_into_the_limitations():
    r = assess([confirmed("cik:1")], SP500)
    assert any("as of 2026-08-01" in l for l in r.limitations)


# ── Serialization ─────────────────────────────────────────────────────────


def test_the_payload_carries_both_statuses():
    r = assess([confirmed("cik:1", "AAPL"), candidate("cik:2", "MSFT")], SP500)
    d = r.as_dict()
    assert d["scope_status"] == "confirmed_partial"
    assert d["members"][0]["coverage_status"] == "primary_confirmed"
    assert d["members"][1]["coverage_status"] == "secondary_candidate"
    assert d["confirmed_count"] == 1
    assert d["candidate_count"] == 1
    assert d["universe"]["size"] == 503
    assert d["headline"]


def test_no_payload_claims_exhaustive_without_a_bounded_universe():
    """The invariant, over every combination that could reach EXHAUSTIVE."""
    for uni in (UNBOUNDED, KNOWN_BUT_UNLISTED, Universe(name="x", size=0,
                                                        enumerable=True)):
        for n in (0, 1, 10, 5_000):
            r = assess([confirmed("cik:1")], uni, examined=n)
            assert r.as_dict()["scope_status"] != "confirmed_exhaustive"
