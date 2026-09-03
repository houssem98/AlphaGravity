"""L8 / R9 — the entity mark scores prose, not attribution.

`period_entity` gave the period half an attachment check (`_period_misattributed`)
and gave the entity half nothing:

    for token in case.get("expect_entity_tokens", []):
        checks += 1
        hits += int(token.lower() in low)

Naming the company in the reply earns the mark. An answer that says "Apple"
while every citation is an NVIDIA filing scores exactly as well as one that
cites Apple's own 10-K. That is the same defect the period half already fixed:
presence is not attribution.

**Checked, not assumed.** L8 says to BLOCK if citations carry no issuer id.
They do — measured on a real pipeline citation:

    issuer         'NVIDIA CORP'
    cik            1045810
    document_title 'NVIDIA 10-K FY2025'
    ticker         ''            <- empty here, so ticker alone is not enough

So the binding reads issuer, cik, ticker and document_title together rather
than trusting any one of them.

**The leniency this file's history demands.** When no citation carries any
issuer identity, the question cannot be asked, and an unanswerable question is
not a failed one — `_entity_is_bound` returns None and the score is exactly what
it was. That is the same discipline `_claim_is_bound` uses, and the reason six
grader bugs did not become seven.
"""

from __future__ import annotations

from eval.head_to_head.rubric import score_answer

APPLE_CITE = {"source_class": "SEC_EVIDENCE", "issuer": "APPLE INC",
              "cik": 320193, "ticker": "AAPL",
              "document_title": "Apple 10-K FY2025",
              "text": "Net sales were $416,161 million in fiscal 2025 as filed."}
NVDA_CITE = {"source_class": "SEC_EVIDENCE", "issuer": "NVIDIA CORP",
             "cik": 1045810, "ticker": "",
             "document_title": "NVIDIA 10-K FY2025",
             "text": "Revenue for fiscal year 2025 was $130,497 million."}

CASE = {"id": "t", "expect_value": 416161.0, "expect_entity_tokens": ["apple"]}


def _score(answer, cites):
    return score_answer(CASE, answer, citations=cites).scores.get("period_entity")


ANSWER = "Apple net sales were $416,161 million [1]."


# ── the defect ────────────────────────────────────────────────────────────


def test_naming_a_company_while_citing_another_is_not_attribution():
    assert _score(ANSWER, [NVDA_CITE]) != 1.0, (
        "the reply named Apple, cited only an NVIDIA filing, and took the full "
        "entity mark; presence in prose was scored as attribution"
    )


# ── the guards ────────────────────────────────────────────────────────────


def test_the_right_issuer_still_scores_full():
    assert _score(ANSWER, [APPLE_CITE]) == 1.0


def test_one_correct_citation_among_others_is_enough():
    """Lenient on purpose, like `_claim_is_bound`: ANY citation may carry it."""
    assert _score(ANSWER, [NVDA_CITE, APPLE_CITE]) == 1.0


def test_no_issuer_identity_anywhere_is_unanswerable_not_failed():
    """The leniency that keeps this from becoming grader bug seven."""
    bare = [{"source_class": "web", "text": "A sufficiently long excerpt here."}]
    assert _score(ANSWER, bare) == 1.0, (
        "citations carrying no issuer identity were treated as proof of the "
        "wrong issuer; an unanswerable question is not a failed one"
    )


def test_no_citations_at_all_is_unanswerable_not_failed():
    assert _score(ANSWER, []) == 1.0


def test_the_ticker_alone_can_carry_it():
    cite = {"source_class": "SEC_EVIDENCE", "ticker": "AAPL", "issuer": "",
            "document_title": "", "text": "An excerpt of sufficient length."}
    assert _score("AAPL net sales were $416,161 million [1].",
                  [cite]) is not None


def test_the_document_title_can_carry_it_when_issuer_is_empty():
    """`ticker` was empty on a real citation, so no single field is trusted."""
    cite = {"source_class": "SEC_EVIDENCE", "issuer": "", "ticker": "",
            "document_title": "Apple 10-K FY2025",
            "text": "An excerpt of sufficient length to be usable."}
    assert _score(ANSWER, [cite]) == 1.0


def test_a_company_never_named_still_fails_on_presence():
    """Unchanged: the mark still requires the reply to name the entity."""
    assert _score("Net sales were $416,161 million [1].", [APPLE_CITE]) == 0.0


def test_a_multi_entity_case_needs_both_issuers():
    case = {"id": "cmp", "expect_value": None,
            "expect_entity_tokens": ["copart", "old dominion"]}
    cprt = {"source_class": "SEC_EVIDENCE", "issuer": "COPART INC",
            "document_title": "Copart 10-K", "text": "An excerpt long enough."}
    answer = "Copart and Old Dominion both grew [1]."

    both = score_answer(case, answer, citations=[cprt]).scores["period_entity"]
    assert both == 0.5, (
        f"only Copart is cited, so exactly one of two entity tokens should "
        f"bind; got {both}"
    )
