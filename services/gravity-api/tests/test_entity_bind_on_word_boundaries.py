"""
U2 — the entity bind matched substrings, so `apple` bound `PINEAPPLE HOLDINGS`.

`_entity_is_bound` asks whether the answer's entity token appears in any
identity field a citation carries. It asked with `tok in identity`, which is
containment, not identity. Measured before the fix:

    _entity_is_bound('apple', [{'issuer':'PINEAPPLE HOLDINGS'}])  -> True
    _entity_is_bound('cat',   [{'issuer':'CATERPILLAR INC'}])     -> True
    _entity_is_bound('am',    [{'issuer':'AMAZON COM INC'}])      -> True

For a grader whose whole job is catching an answer that names one company and
cites another, that is the wrong comparison.

**The fix is word boundaries, not entity resolution.** The audit argued for
canonical CIK-keyed identity, which is the right long-run architecture and would
have blocked a three-line correctness win behind a registry project.

**What must survive.** The multi-field leniency exists because a real pipeline
citation was measured carrying `issuer='NVIDIA CORP'`, `cik=1045810`,
`ticker=''` — no single field can be trusted, so ANY field may carry the
identity and ANY citation may be the one that does. A fix that kills the
substring and also kills those has traded a false positive for a false
negative, which in this file's history is the more expensive direction.

Tokens are matched as literals. `AT&T` and `3M` are company names; a bind built
from an unescaped token would either throw or match the wrong thing.
"""

from __future__ import annotations

import pytest

from eval.head_to_head.rubric import _entity_is_bound


# ── U2: containment is not identity ───────────────────────────────────────


@pytest.mark.parametrize("token,issuer", [
    ("apple", "PINEAPPLE HOLDINGS"),
    ("cat", "CATERPILLAR INC"),
    ("am", "AMAZON COM INC"),
    ("intel", "INTELSAT SA"),
    ("visa", "VISANT CORP"),
    ("target", "TARGETED MEDICAL PHARMA INC"),
    ("oracle", "CORACLE BIOSCIENCES"),
])
def test_a_token_embedded_inside_another_word_does_not_bind(token, issuer):
    """Real collisions, not contrived ones: Intel/Intelsat, Visa/Visant."""
    assert _entity_is_bound(token, [{"issuer": issuer}]) is False


def test_the_audits_exact_case():
    assert _entity_is_bound("apple", [{"issuer": "PINEAPPLE HOLDINGS"}]) is False


# ── The leniency that must survive ────────────────────────────────────────


@pytest.mark.parametrize("token,cite", [
    ("apple", {"issuer": "APPLE INC"}),
    ("apple", {"issuer": "", "document_title": "Apple 10-K FY2025"}),
    ("apple", {"issuer": "", "ticker": "", "company": "Apple Inc."}),
    ("nvidia", {"issuer": "NVIDIA CORP", "ticker": ""}),
    ("aapl", {"ticker": "AAPL"}),
    ("old dominion", {"issuer": "OLD DOMINION FREIGHT LINE INC"}),
])
def test_a_real_identity_still_binds(token, cite):
    assert _entity_is_bound(token, [cite]) is True


def test_a_possessive_still_binds():
    """`APPLE'S 10-K` — the apostrophe is a boundary, not part of the name."""
    assert _entity_is_bound(
        "apple", [{"document_title": "Apple's 10-K FY2025"}]) is True


@pytest.mark.parametrize("token,issuer", [
    ("at&t", "AT&T INC"),
    ("3m", "3M COMPANY"),
    ("j.p. morgan", "J.P. MORGAN SECURITIES LLC"),
])
def test_a_token_carrying_regex_metacharacters_binds_literally(token, issuer):
    """
    Company names contain `&`, `.` and digits. An unescaped token would either
    raise or match something it should not.
    """
    assert _entity_is_bound(token, [{"issuer": issuer}]) is True


def test_any_citation_in_the_list_may_carry_the_identity():
    """Lenient on purpose, unchanged by U2."""
    cites = [{"issuer": "NVIDIA CORP"}, {"issuer": "APPLE INC"}]
    assert _entity_is_bound("apple", cites) is True


def test_no_identity_anywhere_is_still_unanswerable():
    """T4's contract survives U2: `None` means the question could not be asked."""
    assert _entity_is_bound("apple", [{"text": "no identity fields here"}]) is None
    assert _entity_is_bound("apple", []) is None


def test_a_genuinely_wrong_issuer_still_fails():
    """The defect this dimension exists to catch, unchanged."""
    assert _entity_is_bound("apple", [{"issuer": "NVIDIA CORP"}]) is False


@pytest.mark.parametrize("tok", ["", "   "])
def test_an_empty_token_no_longer_binds_everything(tok):
    """
    U10 — a side effect of U2, recorded rather than smuggled.

    Under `tok in identity`, an empty token was contained in every string, so a
    case whose `expect_entity_tokens` carried a blank silently earned the mark
    against any citation at all. Under the lookaround it binds nothing, because
    no position in a name has a non-word character on both sides.

    The change is an improvement — a malformed case should not be credited —
    but `False` is not obviously the right answer either. `None` (ungraded,
    T4's discipline) is arguably better, since a blank token means the CASE is
    broken rather than the citation being wrong. Left as `False` deliberately:
    it is louder than the silent credit it replaces, and changing it further is
    a scoring decision that belongs to its own loop, not a side effect of this
    one.

    Pinned so the behaviour is a decision on record rather than an accident.
    """
    assert _entity_is_bound(tok, [{"issuer": "APPLE INC"}]) is False
