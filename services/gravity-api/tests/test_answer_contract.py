"""
The Answer Contract, and the gate that checks it.

A contract nothing verifies is a longer prompt. So roughly half of these tests
are about `FinalGate` catching an answer that ignored its obligations —
because the failure mode is not "the contract was wrong", it is "the contract
was right and nobody checked".
"""

from __future__ import annotations

import pytest

from app.core.finance.answer_contract import (
    AnswerContract, AnswerMode, FinalGate, SourceClass, build_contract,
)
from app.core.finance.query_plan import plan_query


def contract(q, **kw):
    return build_contract(plan_query(q, companies=kw.pop("companies", None)), **kw)


SEC = [{"source_class": "sec_filing"}]
NEWS = [{"source_class": "news"}]


# ── Mode ──────────────────────────────────────────────────────────────────


@pytest.mark.parametrize("q,mode", [
    ("Copart revenue FY2025", AnswerMode.DIRECT),
    ("Copart revenue year-over-year", AnswerMode.COMPUTED),
    ("Copart operating margin FY2025", AnswerMode.COMPUTED),
    ("Copart TTM revenue", AnswerMode.COMPUTED),
    ("What risk factors did Watsco disclose?", AnswerMode.QUALITATIVE),
    ("What guidance did Watsco give?", AnswerMode.QUALITATIVE),
    ("Which S&P 500 companies mentioned tariff risk?", AnswerMode.SCOPED_SET),
])
def test_mode_is_derived_from_the_plan(q, mode):
    assert contract(q).mode is mode


def test_two_companies_make_it_comparative():
    assert contract("Compare Copart and Old Dominion revenue",
                    companies=["CPRT", "ODFL"]).mode is AnswerMode.COMPARATIVE


def test_an_abstaining_question_is_a_refusal_regardless_of_shape():
    c = contract("Copart revenue FY2030", must_abstain=True,
                 abstain_reason="period has not ended")
    assert c.mode is AnswerMode.REFUSAL
    assert c.abstain_reason


def test_a_refusal_requires_no_citations_and_no_primary_source():
    c = contract("Copart revenue FY2030", must_abstain=True)
    assert c.min_citations == 0
    assert not c.requires_primary_source


# ── Evidence obligations ──────────────────────────────────────────────────


@pytest.mark.parametrize("q", [
    "Copart revenue FY2025", "Old Dominion net income Q2 2025",
    "Watsco operating margin year-over-year",
])
def test_a_financial_fact_requires_a_primary_filing(q):
    assert contract(q).requires_primary_source


def test_a_financial_question_puts_sec_first_in_source_priority():
    p = contract("Copart revenue FY2025").source_priority
    assert p[0] in ("sec_xbrl", "sec_filing")
    assert p.index("news") > p.index("sec_filing")


def test_a_sentiment_question_still_puts_filings_first_but_admits_other_classes():
    p = contract("What is the sentiment in A.O. Smith's 10-K?").source_priority
    assert p[0] == "sec_filing"
    assert "earnings_call" in p and "analyst" in p and "news" in p


def test_a_comparison_needs_one_citation_per_company():
    """Otherwise a reader cannot tell which half of the sentence was evidenced."""
    c = contract("Compare Copart and Old Dominion revenue",
                 companies=["CPRT", "ODFL"])
    assert c.min_citations == 2


def test_only_sec_classes_count_as_primary():
    assert SourceClass.SEC_FILING in __import__(
        "app.core.finance.answer_contract", fromlist=["PRIMARY"]).PRIMARY
    prim = __import__("app.core.finance.answer_contract",
                      fromlist=["PRIMARY"]).PRIMARY
    assert SourceClass.NEWS not in prim
    assert SourceClass.ANALYST not in prim


# ── Honesty obligations ───────────────────────────────────────────────────


def test_a_set_question_must_state_its_scope():
    assert contract("Which S&P 500 companies mentioned tariffs?").requires_scope_statement


def test_a_single_company_question_needs_no_scope_statement():
    assert not contract("Copart revenue FY2025").requires_scope_statement


def test_a_latest_question_must_name_the_period_it_resolved_to():
    """`latest` is a request, not an answer."""
    assert contract("Copart revenue").requires_period_statement


def test_a_rate_change_carries_the_points_limitation():
    c = contract("Copart operating margin year-over-year")
    assert c.change_unit == "pp"
    assert any("percentage points" in l for l in c.limitations)


# ── Shape ─────────────────────────────────────────────────────────────────


def test_every_contract_answers_first():
    for q in ("Copart revenue FY2025", "Which S&P 500 companies mentioned tariffs?"):
        assert contract(q).answer_first


def test_a_computed_answer_shows_its_calculation():
    assert contract("Copart revenue year-over-year").show_calculation
    assert not contract("Copart revenue FY2025").show_calculation


def test_comparisons_and_sets_prefer_a_table():
    assert contract("Compare Copart and Old Dominion revenue",
                    companies=["CPRT", "ODFL"]).prefer_table
    assert contract("Which S&P 500 companies mentioned tariffs?").prefer_table
    assert not contract("Copart revenue FY2025").prefer_table


def test_a_direct_answer_is_word_capped_so_quick_answer_stays_quick():
    assert 0 < contract("Copart revenue FY2025").max_words <= 200
    assert contract("Which S&P 500 companies mentioned tariffs?").max_words == 0


# ── Determinism / serialization ───────────────────────────────────────────


QUERIES = ["Copart revenue FY2025", "Which S&P 500 companies mentioned tariffs?",
           "Copart operating margin year-over-year", ""]


@pytest.mark.parametrize("q", QUERIES)
def test_the_contract_is_a_pure_function_of_the_plan(q):
    first = contract(q).as_dict()
    for _ in range(30):
        assert contract(q).as_dict() == first


@pytest.mark.parametrize("q", QUERIES)
def test_every_contract_serializes(q):
    import json
    json.dumps(contract(q).as_dict())


# ── FinalGate: the half that makes the contract real ──────────────────────


def test_the_gate_passes_a_compliant_answer():
    c = contract("Copart revenue FY2025")
    r = FinalGate.check(c, answer="Revenue was $4.6B in FY2025 [1].", citations=SEC)
    assert r.passed, r.violations


def test_the_gate_catches_a_missing_citation():
    c = contract("Copart revenue FY2025")
    r = FinalGate.check(c, answer="Revenue was $4.6B.", citations=[])
    assert not r.passed
    assert any("citation" in v for v in r.violations)


def test_the_gate_catches_a_news_only_answer_to_a_filing_question():
    """The failure a prompt cannot prevent: the model accepted a weaker source."""
    c = contract("Copart revenue FY2025")
    r = FinalGate.check(c, answer="Revenue was $4.6B [1].", citations=NEWS)
    assert not r.passed
    assert any("primary filing" in v for v in r.violations)


def test_the_gate_catches_a_figure_in_an_answer_that_had_to_abstain():
    c = contract("Copart revenue FY2030", must_abstain=True)
    r = FinalGate.check(c, answer="Revenue will be about $5.2B.", citations=[])
    assert not r.passed
    assert any("abstention" in v for v in r.violations)


def test_an_abstaining_answer_with_no_figure_passes():
    c = contract("Copart revenue FY2030", must_abstain=True)
    r = FinalGate.check(
        c, answer="FY2030 has not ended, so nothing is reported for it.",
        citations=[])
    assert r.passed, r.violations


def test_the_gate_catches_a_partial_scan_presented_without_a_hedge():
    c = contract("Which S&P 500 companies mentioned tariffs?")
    r = FinalGate.check(c, answer="Apple, Microsoft and Nike mentioned tariffs [1].",
                        citations=SEC, scope_status="confirmed_partial")
    assert not r.passed
    assert any("partial" in v for v in r.violations)


def test_a_hedged_partial_scan_passes():
    c = contract("Which S&P 500 companies mentioned tariffs?")
    r = FinalGate.check(
        c,
        answer=("At least 3 match. This is a partial answer: 40 of 503 members "
                "were examined, so there may be others [1]."),
        citations=SEC, scope_status="confirmed_partial")
    assert r.passed, r.violations


def test_the_gate_catches_a_set_question_with_no_scope_status():
    c = contract("Which S&P 500 companies mentioned tariffs?")
    r = FinalGate.check(c, answer="At least 3 match [1].", citations=SEC,
                        scope_status="")
    assert not r.passed
    assert any("scope_status" in v for v in r.violations)


def test_the_gate_catches_a_margin_move_reported_as_a_percent():
    """20% -> 25% is +5pp. Reporting +25% is the classic finance error."""
    c = contract("Copart operating margin year-over-year")
    r = FinalGate.check(c, answer="Operating margin grew 25% year over year [1].",
                        citations=SEC)
    assert not r.passed
    assert any("percentage points" in v for v in r.violations)


def test_the_same_move_stated_in_points_passes():
    c = contract("Copart operating margin year-over-year")
    r = FinalGate.check(
        c, answer="Operating margin rose 5 percentage points, to 25% [1].",
        citations=SEC)
    assert r.passed, r.violations


def test_basis_points_also_satisfy_the_rate_clause():
    c = contract("Copart operating margin year-over-year")
    r = FinalGate.check(c, answer="Operating margin rose 500 bps to 25% [1].",
                        citations=SEC)
    assert r.passed, r.violations


def test_the_gate_reports_which_clauses_it_actually_checked():
    """A gate that does not say what it checked cannot be audited."""
    c = contract("Which S&P 500 companies mentioned tariffs?")
    r = FinalGate.check(c, answer="At least 3 [1].", citations=SEC,
                        scope_status="confirmed_partial")
    assert "min_citations" in r.checked
    assert "scope_statement" in r.checked


def test_the_gate_never_rewrites_the_answer():
    """A gate that edits to satisfy itself is grading its own work."""
    import inspect
    src = inspect.getsource(FinalGate)
    for forbidden in ("answer =", "return answer", ".replace("):
        assert forbidden not in src


def test_a_comparison_missing_one_companys_citation_is_caught():
    c = contract("Compare Copart and Old Dominion revenue",
                 companies=["CPRT", "ODFL"])
    r = FinalGate.check(c, answer="Copart $4.6B, Old Dominion $5.8B [1].",
                        citations=SEC)
    assert not r.passed
    assert any("at least 2" in v for v in r.violations)


# ── Pipeline wiring ───────────────────────────────────────────────────────
#
# A contract computed and discarded is dead code with tests. These pin that it
# reaches the pipeline, that the gate runs, and that neither can lose an answer.


def test_the_pipeline_builds_the_contract_before_retrieval():
    import inspect
    from app.core import search_pipeline

    src = inspect.getsource(search_pipeline)
    i = src.find('query_plan["answer_contract"]')
    assert i != -1, "the contract no longer reaches query_plan"
    # It must be built alongside planning, not after the evidence is in.
    assert src.index('query_plan["finance_plan"]') < i
    assert i < src.index('"── Stage 10') if '"── Stage 10' in src else True


def test_the_pipeline_runs_the_final_gate():
    import inspect
    from app.core import search_pipeline

    src = inspect.getsource(search_pipeline)
    assert "FinalGate.check(" in src
    assert '"contract_gate": _gate_result' in src


def test_a_gate_failure_cannot_lose_the_answer():
    """Reported, never enforced. An exception here must not cost the answer."""
    import inspect
    from app.core import search_pipeline

    src = inspect.getsource(search_pipeline)
    i = src.find("FinalGate.check(")
    after = src[i:i + 900]
    assert "except Exception" in after
    assert "final_gate_failed" in after


def test_the_contract_in_metadata_is_json_safe():
    import json
    json.dumps(contract("Copart revenue FY2025").as_dict())
    json.dumps(FinalGate.check(contract("Copart revenue FY2025"),
                               answer="x", citations=SEC).as_dict())


# ── The contract reaches the model ────────────────────────────────────────
#
# `FinalGate` checks the answer; these check the other direction — that the
# model was actually TOLD the rule it is about to be graded on. A gate without
# a directive is a trap; a directive without a gate is a wish.


def _directives(q, **kw):
    from app.core.reasoning.prompts import contract_directives
    return contract_directives(contract(q, **kw).as_dict())


def test_no_contract_renders_nothing():
    from app.core.reasoning.prompts import contract_directives
    assert contract_directives(None) == ""
    assert contract_directives({}) == ""


def test_every_contract_tells_the_model_to_answer_first():
    assert "Lead with the answer" in _directives("Copart revenue FY2025")


def test_a_direct_answer_is_given_its_word_cap():
    d = _directives("Copart revenue FY2025")
    assert "under 120 words" in d


def test_a_computed_answer_is_told_to_show_the_arithmetic():
    assert "Show the arithmetic" in _directives("Copart revenue year-over-year")


def test_a_rate_question_is_told_to_use_points_not_percent():
    d = _directives("Copart operating margin year-over-year")
    assert "percentage points" in d
    assert "never as a percent change" in d


def test_a_set_question_is_told_not_to_present_a_partial_scan_as_complete():
    d = _directives("Which S&P 500 companies mentioned tariffs?")
    assert "partial scan" in d
    assert "At least N" in d


def test_a_filing_question_is_told_a_news_report_is_not_the_filing():
    d = _directives("Copart revenue FY2025")
    assert "is not the filing" in d


def test_an_abstaining_contract_tells_the_model_to_give_no_figure():
    d = _directives("Copart revenue FY2030", must_abstain=True)
    assert "ABSTAIN" in d
    assert "no figure" in d


def test_every_gate_clause_has_a_matching_directive():
    """
    The two halves must not drift.

    If the gate can fail an answer for a rule the model was never given, the
    system is punishing the model for a secret. Each clause the gate checks
    must appear in the directives for a contract that triggers it.
    """
    pairs = [
        ("Copart revenue FY2025", "primary_source", "is not the filing"),
        ("Copart operating margin year-over-year", "change_unit", "percentage points"),
        ("Which S&P 500 companies mentioned tariffs?", "scope_statement", "partial scan"),
    ]
    for q, clause, phrase in pairs:
        c = contract(q)
        r = FinalGate.check(c, answer="", citations=SEC,
                            scope_status="confirmed_partial")
        assert clause in r.checked, f"{q}: gate did not check {clause}"
        assert phrase in _directives(q), f"{q}: model never told about {clause}"


def test_the_directives_are_appended_to_the_user_message():
    from app.core.reasoning.prompts import build_user_message

    c = contract("Copart operating margin year-over-year").as_dict()
    with_c = build_user_message("q", [], contract=c)
    without = build_user_message("q", [])
    assert len(with_c) > len(without)
    assert "ANSWER CONTRACT" in with_c
    assert "ANSWER CONTRACT" not in without


def test_the_pipeline_passes_the_contract_into_the_prompt():
    import inspect
    from app.core import search_pipeline

    src = inspect.getsource(search_pipeline)
    i = src.find("build_user_message(")
    assert i != -1
    assert 'contract=query_plan.get("answer_contract")' in src[i:i + 400]
