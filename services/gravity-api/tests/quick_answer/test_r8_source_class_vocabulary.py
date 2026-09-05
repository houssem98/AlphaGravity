"""
R8 QA-3 / roadmap §3 — one `source_class` vocabulary.

Three independent vocabularies for the same idea currently live in this
codebase:

    app/core/finance/answer_contract.py   SourceClass enum, lowercase
                                          sec_filing / sec_xbrl / earnings_call
                                          / analyst / news / web
    app/core/retrieval/citation_provenance.py   the WIRE vocabulary, uppercase
                                          SEC_EVIDENCE / LOCAL_EVIDENCE
                                          / WEB_EVIDENCE
    app/core/skills/scope.py              its own frozenset, lowercase
                                          sec_filing / edgar_text / edgar / xbrl

`answer_contract.is_primary_class` bridges the first two, and says so in a
comment. Nothing bridges the third.

**V32 — the scope layer demotes strings the provenance layer actually stamps.**
`citation_provenance.payload()` writes `source_class: "SEC_EVIDENCE"` onto every
SEC citation. `scope.PRIMARY_CLASSES` does not contain it, so
`classify_member` returns `SECONDARY_CANDIDATE` with the note *"Reported by a
secondary source; the filing itself was not read, so this is a lead rather than
a confirmed match."* — about a citation carrying an accession, a CIK and a
`verified` status. Measured:

    is_primary_class("SEC_EVIDENCE")            True
    "SEC_EVIDENCE" in scope.PRIMARY_CLASSES     False

    is_primary_class("sec_xbrl")                True     <- the enum's own member
    "sec_xbrl" in scope.PRIMARY_CLASSES         False

It has stayed green because `classify_member` is never called from `app/` at
all — only from tests, which pass the literal `"sec_filing"` they chose
themselves. The consumer has never seen a string a producer emits, which is the
precise shape roadmap §3 asks this row to find.

`scope.PRIMARY_CLASSES` also contains `edgar` and `edgar_text`, which no
producer in this repository emits and no enum member names.
"""

from __future__ import annotations

import pytest

from app.core.finance.answer_contract import PRIMARY, SourceClass, is_primary_class
from app.core.retrieval.citation_provenance import payload, provenance
from app.core.skills import scope

ACCN = "0000320193-25-000123"
CIK = "0000320193"
CONCEPT = "us-gaap:RevenueFromContractWithCustomerExcludingAssessedTax"


def _meta(**over) -> dict:
    return {
        "accn": ACCN,
        "issuer": "Apple Inc.",
        "ticker": "AAPL",
        "cik": CIK,
        "form": "10-K",
        "filed": "2025-11-01",
        "fiscal_year": "2025",
        "tag": CONCEPT,
        "unit": "USD",
        "value": 416_161_000_000,
        "verification_status": "verified",
        "document_url": "https://www.sec.gov/Archives/x.htm",
        **over,
    }


# ── What a producer actually stamps, read rather than assumed ─────────────


def test_the_provenance_layer_stamps_sec_evidence():
    """Read from `payload()` itself, so this test tracks the producer instead
    of a copy of its value. Everything below depends on this string being the
    one that really travels on a citation."""
    p = payload(provenance(_meta(), ticker="AAPL"))
    assert p["source_class"] == "SEC_EVIDENCE"


# ── V32 — the consumers must agree about the same string ──────────────────


@pytest.mark.parametrize("value", ["SEC_EVIDENCE", "sec_xbrl", "sec_filing"])
def test_v32_a_primary_string_is_primary_in_every_consumer(value):
    """
    A citation to a filed SEC document is primary evidence or it is not. Which
    module is asked must not change the answer.
    """
    assert is_primary_class(value) is True, "precondition: canonical mapping"
    assert scope.is_primary_source_class(value) is True, (
        f"{value!r} is primary to answer_contract and not to scope"
    )


@pytest.mark.parametrize("value", ["WEB_EVIDENCE", "LOCAL_EVIDENCE", "news",
                                   "web", "analyst", "earnings_call"])
def test_v32_a_secondary_string_is_secondary_in_every_consumer(value):
    """The control, and the more important half. A vocabulary reconciled by
    widening until everything passes is worse than two that disagree."""
    assert is_primary_class(value) is False
    assert scope.is_primary_source_class(value) is False


def test_v32_a_real_sec_citation_is_confirmed_not_a_lead():
    """
    End to end on the actual string: the provenance layer stamps it, the scope
    layer classifies it. Before this row the answer was
    `SECONDARY_CANDIDATE` — "the filing itself was not read" — about a citation
    carrying an accession, a CIK and a verified status.
    """
    p = payload(provenance(_meta(), ticker="AAPL"))
    finding = scope.classify_member(
        "cik:320193", ticker="AAPL",
        source_class=p["source_class"], supported=True,
    )
    assert finding.status is scope.CoverageStatus.PRIMARY_CONFIRMED


# ── No seventh vocabulary ─────────────────────────────────────────────────


def test_v32_scope_invents_no_primacy_of_its_own():
    """
    Roadmap §3's failure mode is a new enum added beside the old strings rather
    than replacing them. This asserts the direction that matters: `scope` may
    not grant primacy to a string the canonical mapping does not recognise.

    `edgar` and `edgar_text` were exactly that — names no producer in this
    repository emits and no `SourceClass` member spells.
    """
    invented = {c for c in scope.PRIMARY_CLASSES if not is_primary_class(c)}
    assert invented == set(), (
        f"scope treats {sorted(invented)} as primary and the canonical mapping "
        f"does not recognise them"
    )


def test_v32_every_enum_member_is_classifiable():
    """No member of the canonical enum may be a string the consumers cannot
    place. A vocabulary with unclassifiable members is two vocabularies."""
    for member in SourceClass:
        assert is_primary_class(member.value) is (member in PRIMARY)
        assert scope.is_primary_source_class(member.value) is (member in PRIMARY)
