"""
The benchmark rubric.

A rubric is a measuring instrument, so the tests are about whether it can be
fooled rather than whether it produces pleasant numbers. Three properties:

  a wrong figure cannot score correct
  an ungraded dimension cannot silently become a zero
  neither side can be identified by the grader
"""

from __future__ import annotations

import json
from pathlib import Path

import pytest

from eval.head_to_head.rubric import (
    DIMENSIONS, blind_pairs, numbers_in, score_answer,
)

CASES = json.loads(
    (Path(__file__).resolve().parents[1] / "eval" / "head_to_head" /
     "cases.json").read_text(encoding="utf-8")
)
BY_ID = {c["id"]: c for c in CASES["cases"]}
SEC = [{"source_class": "sec_filing"}]
NEWS = [{"source_class": "news"}]


# ── The weights are the roadmap's ─────────────────────────────────────────


def test_the_weights_sum_to_one_hundred():
    assert sum(d.weight for d in DIMENSIONS) == 100


def test_the_roadmap_weighting_is_reproduced_exactly():
    want = {"correctness": 30, "evidence": 20, "reasoning": 15,
            "period_entity": 10, "scope": 10, "clarity": 10, "latency": 5}
    assert {d.key: d.weight for d in DIMENSIONS} == want


def test_the_judged_dimensions_are_declared_non_mechanical():
    judged = {d.key for d in DIMENSIONS if not d.mechanical}
    assert judged == {"reasoning", "clarity"}


# ── Number parsing ────────────────────────────────────────────────────────


@pytest.mark.parametrize("text,expected", [
    ("$416,161 million", 416_161_000_000),
    ("$416.161B", 416_161_000_000),
    ("416,161,000,000", 416_161_000_000),
    ("$4.65 billion", 4_650_000_000),
])
def test_scaled_figures_are_normalised(text, expected):
    assert any(abs(v - expected) / expected < 0.01 for v in numbers_in(text))


def test_a_bare_number_is_kept_alongside_its_scaled_reading():
    """A 10-K says "416,161" and means millions; both readings must survive."""
    got = numbers_in("Total net sales $ 416,161")
    assert 416_161 in got


# ── Correctness cannot be fooled ──────────────────────────────────────────


def test_the_right_figure_scores_one():
    c = score_answer(BY_ID["aapl-fy2025-revenue"],
                     "Apple's FY2025 net sales were $416,161 million [1].",
                     citations=SEC)
    assert c.scores["correctness"] == 1.0


def test_a_wrong_figure_scores_zero_however_confident():
    c = score_answer(BY_ID["aapl-fy2025-revenue"],
                     "Apple's FY2025 net sales were exactly $500,000 million [1].",
                     citations=SEC)
    assert c.scores["correctness"] == 0.0


def test_a_near_miss_outside_tolerance_still_fails():
    c = score_answer(BY_ID["aapl-fy2025-revenue"],
                     "About $380 billion [1].", citations=SEC)
    assert c.scores["correctness"] == 0.0


def test_the_same_figure_in_a_different_scale_still_scores_one():
    c = score_answer(BY_ID["aapl-fy2025-revenue"],
                     "Roughly $416.2 billion [1].", citations=SEC)
    assert c.scores["correctness"] == 1.0


def test_a_figure_on_an_abstention_case_scores_zero():
    """The right answer is no number. A number is not a near miss."""
    c = score_answer(BY_ID["future-period-abstain"],
                     "Apple's FY2031 revenue is projected at $600 billion.")
    assert c.scores["correctness"] == 0.0


def test_a_clean_abstention_scores_one():
    c = score_answer(BY_ID["future-period-abstain"],
                     "Fiscal 2031 has not ended, so Apple has reported nothing "
                     "for it.")
    assert c.scores["correctness"] == 1.0


def test_a_case_with_no_ground_truth_is_ungraded_not_zero():
    c = score_answer(BY_ID["sp500-tariff-scope"], "Some companies did.",
                     citations=SEC, scope_status="confirmed_partial")
    assert c.scores["correctness"] is None
    assert "no ground-truth" in c.notes["correctness"]


# ── Evidence ──────────────────────────────────────────────────────────────


def test_a_primary_citation_scores_full_evidence():
    c = score_answer(BY_ID["aapl-fy2025-revenue"], "$416,161 million [1].",
                     citations=SEC)
    assert c.scores["evidence"] == 1.0


def test_no_citation_scores_zero_evidence():
    c = score_answer(BY_ID["aapl-fy2025-revenue"], "$416,161 million.",
                     citations=[])
    assert c.scores["evidence"] == 0.0


def test_a_news_only_citation_is_penalised_on_a_filing_question():
    c = score_answer(BY_ID["aapl-fy2025-revenue"], "$416,161 million [1].",
                     citations=NEWS)
    assert c.scores["evidence"] < 1.0
    assert "no primary source" in c.notes["evidence"]


def test_a_citation_marker_pointing_at_nothing_is_not_full_credit():
    """A reference to nothing reads exactly like a reference to something."""
    c = score_answer(BY_ID["aapl-fy2025-revenue"], "$416,161 million [1].",
                     citations=[])
    assert c.scores["evidence"] < 1.0


def test_an_abstention_needs_no_citation():
    c = score_answer(BY_ID["future-period-abstain"],
                     "Fiscal 2031 has not ended.")
    assert c.scores["evidence"] == 1.0


# ── Period / entity ───────────────────────────────────────────────────────


def test_the_right_company_and_period_score_full():
    c = score_answer(BY_ID["aapl-fy2025-revenue"],
                     "Apple reported $416,161 million for fiscal 2025 [1].",
                     citations=SEC)
    assert c.scores["period_entity"] == 1.0


def test_a_missing_period_loses_points():
    c = score_answer(BY_ID["aapl-fy2025-revenue"],
                     "Apple reported $416,161 million [1].", citations=SEC)
    assert c.scores["period_entity"] < 1.0


def test_a_forbidden_word_is_penalised():
    """ODFL revenue fell; calling it growth is a correctness failure."""
    c = score_answer(BY_ID["odfl-fy2025-decline"],
                     "Old Dominion revenue grew in fiscal 2025 [1].",
                     citations=SEC)
    assert c.scores["period_entity"] < 1.0


def test_the_decline_stated_correctly_scores_full():
    c = score_answer(BY_ID["odfl-fy2025-decline"],
                     "Old Dominion revenue declined 5.5% in fiscal 2025 [1].",
                     citations=SEC)
    assert c.scores["period_entity"] == 1.0


# ── Scope ─────────────────────────────────────────────────────────────────


def test_a_partial_scan_presented_as_complete_scores_zero_scope():
    c = score_answer(BY_ID["sp500-tariff-scope"],
                     "Apple, Microsoft and Nike mentioned tariffs [1].",
                     citations=SEC, scope_status="confirmed_partial")
    assert c.scores["scope"] == 0.0


def test_a_hedged_partial_scan_scores_full_scope():
    c = score_answer(BY_ID["sp500-tariff-scope"],
                     "At least 3 match; 40 of 503 were examined, so there may "
                     "be others [1].",
                     citations=SEC, scope_status="confirmed_partial")
    assert c.scores["scope"] == 1.0


def test_scope_is_ungraded_for_a_single_company_question():
    c = score_answer(BY_ID["aapl-fy2025-revenue"], "$416,161 million [1].",
                     citations=SEC)
    assert c.scores["scope"] is None


# ── Latency ───────────────────────────────────────────────────────────────


def test_beating_the_budget_scores_full_latency():
    c = score_answer(BY_ID["aapl-fy2025-revenue"], "$416,161 million [1].",
                     citations=SEC, latency_ms=2000)
    assert c.scores["latency"] == 1.0


def test_missing_the_budget_scores_proportionally():
    c = score_answer(BY_ID["aapl-fy2025-revenue"], "$416,161 million [1].",
                     citations=SEC, latency_ms=25000)
    assert 0 < c.scores["latency"] < 0.3


def test_unmeasured_latency_is_ungraded_not_zero():
    c = score_answer(BY_ID["aapl-fy2025-revenue"], "$416,161 million [1].",
                     citations=SEC, latency_ms=None)
    assert c.scores["latency"] is None


# ── Ungraded never becomes zero ───────────────────────────────────────────


def test_judgement_dimensions_are_always_ungraded():
    """A fabricated 0.8 here would move the aggregate by 25 points on no evidence."""
    c = score_answer(BY_ID["aapl-fy2025-revenue"], "$416,161 million [1].",
                     citations=SEC, latency_ms=1000)
    assert c.scores["reasoning"] is None
    assert c.scores["clarity"] is None
    assert "not graded" in c.notes["reasoning"]


def test_the_weighted_score_renormalises_over_graded_weight_only():
    """Otherwise both systems get an identical 25-point hole called a total."""
    c = score_answer(BY_ID["aapl-fy2025-revenue"],
                     "Apple reported $416,161 million for fiscal 2025 [1].",
                     citations=SEC, latency_ms=1000)
    assert c.graded_weight == 30 + 20 + 10 + 5      # scope is ungraded here
    assert c.weighted == 1.0


def test_a_perfect_answer_scores_one_and_a_wrong_one_does_not():
    good = score_answer(BY_ID["aapl-fy2025-revenue"],
                        "Apple reported $416,161 million for fiscal 2025 [1].",
                        citations=SEC, latency_ms=1000)
    bad = score_answer(BY_ID["aapl-fy2025-revenue"],
                       "Apple reported $500,000 million.", citations=[],
                       latency_ms=30000)
    assert good.weighted == 1.0
    assert bad.weighted < 0.2


def test_the_scorecard_lists_what_it_could_not_grade():
    d = score_answer(BY_ID["aapl-fy2025-revenue"], "x", citations=SEC).as_dict()
    assert "reasoning" in d["ungraded"]
    assert "clarity" in d["ungraded"]


# ── Blinding ──────────────────────────────────────────────────────────────


def test_the_grader_cannot_tell_which_side_is_ours():
    pairs = [("OURS-1", "REF-1"), ("OURS-2", "REF-2"), ("OURS-3", "REF-3")]
    blinded = blind_pairs(pairs, seed="s")
    for b in blinded:
        assert {b["left"], b["right"]} in (
            {"OURS-1", "REF-1"}, {"OURS-2", "REF-2"}, {"OURS-3", "REF-3"})
    # At least one pair is flipped, or the "blinding" is an identity function.
    assert any(b["_left_is"] == "b" for b in blinded) or len(blinded) < 3


def test_blinding_is_reproducible_for_a_given_seed():
    a = blind_pairs([("x", "y")] * 5, seed="abc")
    b = blind_pairs([("x", "y")] * 5, seed="abc")
    assert [p["_left_is"] for p in a] == [p["_left_is"] for p in b]


def test_different_seeds_give_different_arrangements():
    a = [p["_left_is"] for p in blind_pairs([("x", "y")] * 12, seed="a")]
    b = [p["_left_is"] for p in blind_pairs([("x", "y")] * 12, seed="b")]
    assert a != b


# ── The case file itself ──────────────────────────────────────────────────


def test_every_case_has_an_id_and_a_query():
    for c in CASES["cases"]:
        assert c["id"] and c["query"]


def test_ground_truth_records_where_it_came_from():
    """A key with no provenance is a guess with a confident format."""
    assert "SEC XBRL" in CASES["ground_truth_source"]
    assert len(CASES["provenance"]) >= 10
    for line in CASES["provenance"]:
        assert "accn" in line


def test_the_computed_growth_cases_agree_with_their_recorded_endpoints():
    """The derived expectations must follow from the fetched figures."""
    checks = [
        ("aapl-fy2025-growth", 416161000000, 391035000000),
        ("nvda-fy2026-growth", 215938000000, 130497000000),
        ("odfl-fy2025-decline", 5496389000, 5814810000),
    ]
    for case_id, cur, prev in checks:
        expected = round((cur / prev - 1) * 100, 4)
        assert BY_ID[case_id]["expect_value"] == pytest.approx(expected, abs=1e-3)


def test_the_suite_covers_the_categories_the_roadmap_names():
    cats = {c["category"] for c in CASES["cases"]}
    for required in ("exact_fact", "growth", "comparison", "abstention",
                     "scoped_set", "unseen_company", "latest"):
        assert required in cats


# ── An abstention may name the period it declines ─────────────────────────
#
# Found by this suite: `numbers_in` counted "fiscal 2031" as a stated figure, so
# the correct abstention scored zero on correctness. Left alone, the rubric
# would have rewarded abstentions that cannot say WHICH period is unreported —
# a grader pushing the system toward worse answers.


@pytest.mark.parametrize("answer", [
    "Fiscal 2031 has not ended, so Apple has reported nothing for it.",
    "FY2031 is a future period; no 10-K covers it.",
    "Apple's fiscal 2031 has not begun. Its most recent filed year is 2025.",
    "No filing covers 2031. Q4 2030 has not been reported either.",
])
def test_an_abstention_may_name_years_without_scoring_as_a_figure(answer):
    c = score_answer(BY_ID["future-period-abstain"], answer)
    assert c.scores["correctness"] == 1.0, c.notes["correctness"]


@pytest.mark.parametrize("answer", [
    "Apple's FY2031 revenue is projected at $600 billion.",
    "We estimate 2031 revenue of $600B.",
    "FY2031 revenue should grow about 8%.",
    "Roughly 600,000 million in 2031.",
])
def test_a_real_figure_still_fails_an_abstention_case(answer):
    c = score_answer(BY_ID["future-period-abstain"], answer)
    assert c.scores["correctness"] == 0.0, c.notes["correctness"]


def test_the_figure_detector_separates_claims_from_years():
    from eval.head_to_head.rubric import _financial_figures

    assert _financial_figures("fiscal 2031 and Q4 2030") == set()
    assert _financial_figures("$416 billion") 
    assert _financial_figures("grew 6.4%")
    assert _financial_figures("rose 500 bps")


# ── Three grader bugs found by running the benchmark live ─────────────────
#
# All three marked a RIGHT answer wrong, which is the worst class of grader
# defect: it does not merely mis-score, it points optimisation at the wrong
# target. Each is pinned here.


def test_a_reported_decline_matches_a_negative_expectation():
    """
    Bug 1: the sign was not parsed, so "-5.48%" read as 5.48 and a correctly
    reported decline scored zero against an expected -5.476.
    """
    c = score_answer(
        BY_ID["odfl-fy2025-decline"],
        "Old Dominion revenue declined in fiscal 2025, falling to $5.496B from "
        "$5.815B, a decrease of -5.48% YoY [1].",
        citations=SEC)
    assert c.scores["correctness"] == 1.0, c.notes["correctness"]


@pytest.mark.parametrize("text", [
    "revenue fell 5.48% in fiscal 2025",
    "revenue declined 5.48% in fiscal 2025",
    "a decrease of 5.48% in fiscal 2025",
    "revenue was down 5.48% in fiscal 2025",
])
def test_decline_vocabulary_produces_the_negative_reading(text):
    assert -5.48 in numbers_in(text)


def test_a_positive_figure_is_not_flipped_by_a_distant_decline_word():
    """The negative reading is added, never substituted."""
    got = numbers_in("Revenue fell in 2024. Revenue then grew 12.0% in 2025.")
    assert 12.0 in got


def test_an_abstention_may_report_the_latest_period_it_does_have():
    """
    Bug 2: any figure anywhere scored zero, so an answer that correctly
    declined FY2031 and then cited the newest filed quarter was marked wrong.
    That trains the system toward abstentions which cannot say what IS known.
    """
    c = score_answer(
        BY_ID["future-period-abstain"],
        "Apple's fiscal year 2031 revenue is not available in the provided "
        "sources. The latest reported period is fiscal 2026 Q2, with quarterly "
        "revenue of $111.2B [1].",
        citations=SEC)
    assert c.scores["correctness"] == 1.0, c.notes["correctness"]


def test_a_figure_offered_as_the_unreported_period_still_fails():
    c = score_answer(
        BY_ID["future-period-abstain"],
        "Apple's fiscal 2031 revenue was $600 billion.", citations=SEC)
    assert c.scores["correctness"] == 0.0
    assert "attributed to the unreported period" in c.notes["correctness"]


def test_an_answer_that_never_declines_fails_even_with_no_figure():
    """Silence is not abstention."""
    c = score_answer(BY_ID["future-period-abstain"],
                     "Apple is a consumer electronics company.", citations=SEC)
    assert c.scores["correctness"] == 0.0
    assert "never declines" in c.notes["correctness"]


@pytest.mark.parametrize("cls", [
    "SEC_EVIDENCE", "sec_evidence", "LOCAL_EVIDENCE", "sec_filing",
    "sec_xbrl", "edgar", "edgar_text", "structured",
])
def test_the_pipelines_real_evidence_class_names_count_as_primary(cls):
    """
    Bug 3: the rubric knew `answer_contract.SourceClass` names and the pipeline
    emits `research.evidence` names, so every real SEC citation scored as
    non-primary — the grader reporting its own vocabulary gap as a system fault.
    """
    c = score_answer(BY_ID["aapl-fy2025-revenue"], "$416,161 million [1].",
                     citations=[{"source_class": cls}])
    assert c.scores["evidence"] == 1.0, c.notes.get("evidence")


def test_an_accession_makes_a_citation_primary_whatever_it_is_labelled():
    """A citation carrying a real accession came from a filing."""
    c = score_answer(BY_ID["aapl-fy2025-revenue"], "$416,161 million [1].",
                     citations=[{"source_class": "", 
                                 "accession": "0000320193-25-000079"}])
    assert c.scores["evidence"] == 1.0


def test_an_archives_url_makes_a_citation_primary():
    c = score_answer(BY_ID["aapl-fy2025-revenue"], "$416,161 million [1].",
                     citations=[{"source_class": "unknown",
                                 "url": "https://www.sec.gov/Archives/edgar/data/320193/x.htm"}])
    assert c.scores["evidence"] == 1.0


def test_web_evidence_alone_is_still_not_primary():
    """The fix must not make everything primary."""
    c = score_answer(BY_ID["aapl-fy2025-revenue"], "$416,161 million [1].",
                     citations=[{"source_class": "WEB_EVIDENCE"}])
    assert c.scores["evidence"] < 1.0


# ── A wrong number and an honest decline are different failures ───────────
#
# Added after calc_guard turned a fabricated "revenue grew 20,160%" into "the
# sources do not provide FY2025 revenue, so the growth rate cannot be computed".
# Both score zero on correctness. Only one of them would have misled anyone, and
# the roadmap asks for false-confidence and false-abstention separately for
# exactly that reason. A rubric that cannot tell them apart cannot see the
# difference between a system getting safer and a system getting worse.


def test_a_wrong_figure_is_recorded_as_false_confidence():
    c = score_answer(BY_ID["nvda-fy2026-growth"],
                     "NVIDIA's revenue grew 20,160% year over year in fiscal "
                     "2026, from $10.0B to $215.9B [1].", citations=SEC)
    assert c.scores["correctness"] == 0.0
    assert c.notes["failure_mode"] == "false_confidence"


def test_an_honest_decline_is_recorded_as_false_abstention():
    c = score_answer(BY_ID["nvda-fy2026-growth"],
                     "The sources do not provide NVIDIA's FY2025 revenue, so "
                     "the year-over-year growth rate cannot be computed.",
                     citations=SEC)
    assert c.scores["correctness"] == 0.0
    assert c.notes["failure_mode"] == "false_abstention"
    assert "declined rather than guessing" in c.notes["correctness"]


def test_a_correct_answer_records_no_failure_mode():
    c = score_answer(BY_ID["aapl-fy2025-revenue"],
                     "Apple reported $416,161 million for fiscal 2025 [1].",
                     citations=SEC)
    assert c.scores["correctness"] == 1.0
    assert "failure_mode" not in c.notes


def test_both_failure_modes_still_score_zero():
    """
    The distinction is diagnostic, not a partial credit. Declining a question
    you should have answered is a failure; it is simply a different one, and
    softening its score would reward abstention.
    """
    wrong = score_answer(BY_ID["nvda-fy2026-growth"],
                         "Revenue grew 20,160% [1].", citations=SEC)
    declined = score_answer(BY_ID["nvda-fy2026-growth"],
                            "The sources do not provide the prior year, so it "
                            "cannot be computed.", citations=SEC)
    assert wrong.scores["correctness"] == declined.scores["correctness"] == 0.0


def test_the_aggregate_reports_both_counts():
    from eval.head_to_head.run_benchmark import aggregate

    cards = [
        score_answer(BY_ID["nvda-fy2026-growth"], "grew 20,160% [1].", citations=SEC),
        score_answer(BY_ID["aapl-fy2025-growth"],
                     "The sources do not contain the prior year figure, so it "
                     "cannot be computed.", citations=SEC),
        score_answer(BY_ID["aapl-fy2025-revenue"],
                     "Apple reported $416,161 million for fiscal 2025 [1].",
                     citations=SEC),
    ]
    agg = aggregate(cards)
    assert agg["false_confidence"] == 1
    assert agg["false_abstention"] == 1


# ── Two more grader bugs, found by benchmark run 4 ────────────────────────
#
# Both punished an honest answer, which is the same class as the three before:
# the grader does not merely mis-score, it aims the system at the wrong target.


def test_a_complete_refusal_on_a_set_question_is_not_an_overstated_scan():
    """
    Run 4 scored this 0.0 for "partial scan presented as complete":

        "No source passage identifies which S&P 500 companies mentioned tariff
         risk in their 10-K filings. The available evidence covers earnings
         calls, not 10-Ks, and does not name individual companies."

    It names nobody. That is the strongest possible statement of limited
    coverage, and the hedge list only recognised PARTIAL answers.
    """
    c = score_answer(
        BY_ID["sp500-tariff-scope"],
        "No source passage identifies which S&P 500 companies mentioned tariff "
        "risk in their 10-K filings. The available evidence covers earnings "
        "calls, not 10-Ks, and does not name individual companies.",
        citations=SEC, scope_status="confirmed_partial")
    assert c.scores["scope"] == 1.0, c.notes["scope"]
    assert "refused" in c.notes["scope"]


def test_a_list_of_names_with_no_hedge_still_scores_zero_scope():
    """The fix must not excuse an actual unhedged list."""
    c = score_answer(
        BY_ID["sp500-tariff-scope"],
        "Apple, Microsoft, Nike and Ford mentioned tariff risk in their "
        "10-K filings [1].",
        citations=SEC, scope_status="confirmed_partial")
    assert c.scores["scope"] == 0.0


def test_a_bulleted_list_counts_as_naming_members():
    c = score_answer(
        BY_ID["sp500-tariff-scope"],
        "The following mentioned tariff risk:\n- Apple\n- Microsoft\n- Nike\n",
        citations=SEC, scope_status="confirmed_partial")
    assert c.scores["scope"] == 0.0


def test_declining_the_asked_metric_while_reporting_another_is_not_false_confidence():
    """
    Run 4 labelled this `false_confidence`:

        "Apple's total net sales for FY2025 were $416.161B[1]. The sources do
         not contain Apple's FY2024 total net sales figure, so the
         year-over-year growth rate for FY2025 cannot be computed."

    It reports the figure it HAS and declines the one it does not. Scoring that
    as a confident wrong answer punishes precisely the behaviour `calc_guard`
    was added to produce.
    """
    c = score_answer(
        BY_ID["aapl-fy2025-growth"],
        "Apple's total net sales for FY2025 (fiscal year ended September 27, "
        "2025) were $416.161B[1]. The sources do not contain Apple's FY2024 "
        "total net sales figure, so the year-over-year growth rate for FY2025 "
        "cannot be computed.",
        citations=SEC)
    assert c.scores["correctness"] == 0.0
    assert c.notes["failure_mode"] == "false_abstention", c.notes["correctness"]


def test_a_genuinely_wrong_growth_rate_is_still_false_confidence():
    """
    The fix must not reclassify a real error. Run 4's NVIDIA answer stated
    85.2% using a derived FY2025 base of $116.599B against a filed
    $130,497,000,000 — a wrong number, confidently given.
    """
    c = score_answer(
        BY_ID["nvda-fy2026-growth"],
        "NVIDIA's revenue grew 85.2% YoY in fiscal 2026, reaching $215.938B "
        "versus $116.599B in fiscal 2025 [1].",
        citations=SEC)
    assert c.scores["correctness"] == 0.0
    assert c.notes["failure_mode"] == "false_confidence"


def test_a_refusal_followed_by_a_source_list_is_still_a_refusal():
    """
    Grader bug 6, from run 5. The reply opens with a clean refusal and then
    lists the SOURCES it consulted:

        "The sources do not identify which S&P 500 companies mentioned tariff
         risk in their 10-K filings. ...
         FactSet ..."

    `_names_members` cannot tell a list of sources from a list of companies, so
    scanning the whole reply scored a clean refusal 0.0 for "presenting a
    partial scan as complete". The opening sentence is the honest place to judge
    what the answer claims.
    """
    c = score_answer(
        BY_ID["sp500-tariff-scope"],
        "The sources do not identify which S&P 500 companies mentioned tariff "
        "risk in their 10-K filings. The provided material covers earnings "
        "conference calls, not 10-K filings, and does not name individual "
        "companies.\n\nSources consulted:\n- FactSet\n- Reuters\n- Bloomberg\n",
        citations=SEC, scope_status="confirmed_partial")
    assert c.scores["scope"] == 1.0, c.notes["scope"]


def test_an_opening_list_of_companies_is_still_scored_zero():
    """The fix must not excuse an answer that opens by naming members."""
    c = score_answer(
        BY_ID["sp500-tariff-scope"],
        "Apple, Microsoft, Nike and Ford mentioned tariff risk in their 10-Ks "
        "[1]. No other companies were checked.",
        citations=SEC, scope_status="confirmed_partial")
    assert c.scores["scope"] == 0.0


def test_a_hedged_partial_answer_is_unaffected_by_the_opening_sentence_rule():
    c = score_answer(
        BY_ID["sp500-tariff-scope"],
        "At least 3 match. 40 of 503 members were examined, so there may be "
        "others [1].\n\n- Apple\n- Microsoft\n- Nike",
        citations=SEC, scope_status="confirmed_partial")
    assert c.scores["scope"] == 1.0
