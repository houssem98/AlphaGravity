"""
R8 QA-5 / roadmap §4 — entity binding has three states.

The evaluator has all three and has had them since round 6:
`_entity_is_bound` returns `True` (MATCH), `False` (MISMATCH) or `None`
(UNKNOWN, the question could not be asked), and `_names_the_entity` uses
`(?<!\\w)tok(?!\\w)` so `apple` does not bind `PINEAPPLE HOLDINGS`.

Production has one comparison, and it cannot fire.

**V34 — production's entity layer compares a passage's ticker with itself.**
`citation_verdict` Layer C is:

    cited_ticker   = citation.get("ticker")
    passage_ticker = passage.ticker
    if cited_ticker and passage_ticker and cited_ticker != passage_ticker:
        conflicts.append("entity_mismatch")

and the citation it grades is built by `_normalize_citations`, where

    _tk = c.get("ticker") or _pf("ticker")      # _pf == getattr(passage, ...)

so when the model's citation carries no ticker — the normal case, since a
citation is `{citation_number, text}` — `_tk` IS the passage's ticker and the
comparison is `x != x`. `payload()` does not emit a `ticker` key either, so
nothing downstream supplies one.

The gap that leaves, measured:

    claim   "Microsoft total net sales were $416,161 million in fiscal 2025 [1]."
    passage issuer "Apple Inc.", cik 0000320193, text naming Apple Inc.
    verdict  verified  ['numeric_grounded_in_source']

Production certifies a claim about Microsoft against Apple's filing, because
nothing compares the company the CLAIM names against the company the PASSAGE
belongs to. Only the ticker fields are compared, and they are the same field.

`_normalize_citations(raw_citations, passages)` was module-level and received
neither the query nor the resolved entity, so this was structural rather than an
oversight: there was no third party in scope to compare against.

The fix supplies one. The companies the QUESTION resolved to travel into
`_normalize_citations` as `scope_tickers`, and a passage whose ticker is not
among them is a passage about a company the question is not about. A SET, not a
ticker, because a comparison query is legitimately about several companies at
once and a single-ticker equality would have failed every one of them.

`citation_verdict` is unchanged. The layer was never broken; it was never given
two different tickers.
"""

from __future__ import annotations

import pytest

from app.core.search_pipeline import _normalize_citations
from app.core.verification.citation_verdict import verdict_for_citation
from eval.head_to_head.rubric import _entity_is_bound, _names_the_entity

APPLE_TEXT = "Apple Inc. total net sales were $416,161 million in fiscal 2025."


class _Passage:
    def __init__(self, ticker: str = "", issuer: str = ""):
        self.text = APPLE_TEXT
        self.ticker = ticker
        self.issuer = issuer
        self.cik = "0000320193"
        self.filing_date = "2025-11-01"
        self.chunk_id = "c1"
        self.document_title = "AAPL 10-K"
        self.section = ""
        self.metadata = None


def _normalize(scope: frozenset) -> dict:
    """One citation through the real pipeline path, with the query's resolved
    scope supplied as `search()` now supplies it."""
    raw = [{"citation_number": 1, "chunk_id": "c1",
            "text": "Microsoft total net sales were $416,161 million in "
                    "fiscal 2025 [1]."}]
    return _normalize_citations(raw, [_Passage("AAPL", "Apple Inc.")], scope)[0]


# ── The evaluator already has the three states ────────────────────────────
#
# These are controls, not the row's work: they establish that the discipline
# production is missing is already written down and agreed, one layer over.


@pytest.mark.parametrize("tok,identity", [
    ("abc", "abcdef corporation"),
    ("apple", "pineapple holdings"),
    ("cat", "caterpillar inc"),
    ("intel", "intelsat sa"),
])
def test_a_name_inside_another_name_is_not_a_match(tok, identity):
    """Roadmap §4's named case — `ABC` must not match `ABCDEF` — and the three
    that round 6 found. The failure mode §4 warns about is normalization that
    is a substring matcher wearing a new name."""
    assert _names_the_entity(tok, identity) is False


@pytest.mark.parametrize("tok,identity", [
    ("apple", "apple inc."),
    ("at&t", "at&t inc"),
    ("3m", "3m company"),
])
def test_a_real_name_still_matches(tok, identity):
    """The control on the control. A boundary rule that refuses `AT&T` because
    the name ends in a non-word character has replaced one bug with another."""
    assert _names_the_entity(tok, identity) is True


def test_the_evaluator_returns_unknown_when_it_cannot_ask():
    """UNKNOWN is a third state, not a quiet False. No citation carries any
    issuer identity, so there is nothing to check the name against."""
    assert _entity_is_bound("microsoft", [{"text": "some prose"}]) is None


def test_the_evaluator_says_mismatch_when_it_can_ask():
    assert _entity_is_bound(
        "microsoft", [{"issuer": "Apple Inc."}]) is False


# ── V34 — the comparison now has a third party ────────────────────────────


def test_v34_a_claim_about_another_company_no_longer_binds():
    """
    The case that cost a user something. The claim names Microsoft. The passage
    is Apple's — its ticker is AAPL, its issuer is Apple Inc., its text says so.
    The question resolved to MSFT.

    Before: `verified ['numeric_grounded_in_source']`, because the citation's
    ticker fell back to the passage's own and the layer compared `x != x`.
    """
    out = _normalize(scope=frozenset({"MSFT"}))
    assert out["verification_status"] == "conflicting"
    assert "entity_mismatch" in out["verification_reasons"]


def test_v34_a_correct_citation_is_untouched():
    """The control. An entity check that refuses the right source has replaced
    one failure with a worse one."""
    out = _normalize(scope=frozenset({"AAPL"}))
    assert out["verification_status"] == "verified"
    assert "entity_mismatch" not in out["verification_reasons"]


def test_v34_a_comparison_query_is_not_broken():
    """
    A comparison is legitimately about several companies at once, and a
    citation to either one belongs. This is why the scope is a SET and the rule
    is `not in scope` rather than `!= the ticker` — a single-ticker equality
    would have failed every comparison the product supports.
    """
    out = _normalize(scope=frozenset({"AAPL", "MSFT"}))
    assert out["verification_status"] == "verified"


def test_v34_no_resolved_scope_never_invents_a_conflict():
    """
    One-directional, like every other check this round added. When the query
    resolved to no company the citation is graded exactly as before: absence of
    scope is not evidence of a mismatch.
    """
    out = _normalize(scope=frozenset())
    assert "entity_mismatch" not in out["verification_reasons"]


def test_v34_the_verdict_layer_alone_still_forms_no_opinion():
    """
    `verdict_for_citation` is unchanged and still compares two tickers. Called
    without the pipeline's scope it has only one company in hand and correctly
    says nothing — the fix supplied the missing third party, it did not make
    the layer stricter.
    """
    v = verdict_for_citation(
        {"citation_number": 1,
         "text": "Microsoft total net sales were $416,161 million [1]."},
        [_Passage(ticker="AAPL", issuer="Apple Inc.")],
    )
    assert "entity_mismatch" not in v.reasons


def test_v34_the_layer_fires_when_two_tickers_really_differ():
    """Recorded so the row is not read as `the layer was broken`. It worked; it
    was never given two different tickers."""
    v = verdict_for_citation(
        {"citation_number": 1, "ticker": "MSFT",
         "text": "Microsoft total net sales were $416,161 million [1]."},
        [_Passage(ticker="AAPL", issuer="Apple Inc.")],
    )
    assert "entity_mismatch" in v.reasons
