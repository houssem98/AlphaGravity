"""
R8 QA-6 / roadmap §2.1, §2.2 — the canonical evidence object reaches every
source class.

R7 measured that `provenance()` returns `None` without an accession, so prose
citations carry no fields. This row measured HOW MANY that affects, against the
real corpus backup (`chunks_full.jsonl`, 1.17 GB, read outside the repo):

    total prose chunks                        478,433
    carrying an accession in an ID field            0
    accession-shaped string anywhere in row       587   (inside filing TEXT)
    distinct metadata shapes                        1   (no `metadata` field)

Every prose citation the system can produce carries zero canonical evidence
fields. Not most: all of them.

What those chunks DO carry is real source identity — `ticker`, `company`,
`document_title`, `filing_date`, `filing_type`, `section`, `page`. The owner
decision for this row is to build a prose identity object from exactly those,
and from nothing else.

**§2.2's failure mode, and the line this row must not cross:** labelling web or
local evidence as filing evidence to make the fields non-empty. Source
identity, financial fact identity and verification strength stay three separate
things. So the object below carries NO accession, NO xbrl_concept, NO value,
its class stays `LOCAL_EVIDENCE`, and `is_primary_class` still refuses it. It
lets a citation say WHERE it came from; it does not let it claim a filing's
authority.
"""

from __future__ import annotations

import pytest

from app.core.finance.answer_contract import is_primary_class
from app.core.retrieval.citation_provenance import local_payload, source_payload

#: One row from `chunks_full.jsonl`, in the shape the whole corpus has.
CHUNK = {
    "chunk_level": "section",
    "company": "Apple Inc.",
    "document_id": "aapl-10k-2025",
    "document_title": "AAPL 10-K 2025-11-01",
    "filing_date": "2025-11-01",
    "filing_type": "10-K",
    "id": "c-4821",
    "page": 34,
    "section": "Item 7. Management's Discussion and Analysis",
    "ticker": "AAPL",
    "text": "Total net sales increased 6% during 2025 compared to 2024.",
}


# ── The object exists and says where the passage came from ────────────────


@pytest.mark.parametrize("field,expected", [
    ("source_class", "LOCAL_EVIDENCE"),
    ("issuer", "Apple Inc."),
    ("ticker", "AAPL"),
    ("form", "10-K"),
    ("filing_date", "2025-11-01"),
    ("section", "Item 7. Management's Discussion and Analysis"),
    ("page", 34),
])
def test_a_prose_chunk_carries_its_own_identity(field, expected):
    assert local_payload(CHUNK)[field] == expected


def test_the_router_returns_it():
    """`source_payload` is the single entry point the pipeline calls. Before
    this row it returned `{}` for every one of the 478,433 chunks."""
    assert source_payload(CHUNK)["source_class"] == "LOCAL_EVIDENCE"


# ── §2.2 — the line this must not cross ───────────────────────────────────


@pytest.mark.parametrize("field", [
    "accession", "accession_number", "xbrl_concept", "value", "unit",
    "cik", "filing_url", "view_filing_url", "primary_document",
])
def test_a_prose_chunk_claims_no_filing_identity(field):
    """
    Source identity, financial fact identity and verification strength stay
    three separate things. A prose chunk knows where it came from; it does not
    know an accession, a CIK, an XBRL concept or a value, and inventing any of
    them to make the object look complete is the failure mode §2.2 names.
    """
    assert field not in local_payload(CHUNK)


def test_prose_evidence_is_not_primary():
    """The whole point. After QA-3 there is one predicate, and it must still
    say no — otherwise this row has quietly granted 478,433 corpus chunks the
    authority of a filed document."""
    assert is_primary_class(local_payload(CHUNK)["source_class"]) is False


def test_a_real_filing_still_wins_the_router():
    """A passage carrying an accession is a filing fact regardless of what else
    is on its metadata, and that ordering is unchanged."""
    out = source_payload({
        **CHUNK,
        "accn": "0000320193-25-000123",
        "cik": "0000320193",
        "issuer": "Apple Inc.",
        "form": "10-K",
        "filed": "2025-11-01",
    }, ticker="AAPL")
    assert out["source_class"] == "SEC_EVIDENCE"
    assert out["accession"] == "0000320193-25-000123"


# ── Absent is absent, not invented ────────────────────────────────────────


def test_a_chunk_with_no_identity_at_all_gets_nothing():
    """A row with no company, ticker, form or date says nothing about its
    source, and an object of empty strings would be a claim that it does."""
    assert local_payload({"text": "prose", "id": "c-1"}) == {}
    assert source_payload({"text": "prose", "id": "c-1"}) == {}


def test_absent_fields_are_dropped_rather_than_emptied():
    thin = {"ticker": "AAPL", "text": "prose"}
    out = local_payload(thin)
    assert out["ticker"] == "AAPL"
    assert "section" not in out
    assert "page" not in out


# ── V35 — a placeholder is not a form ─────────────────────────────────────


@pytest.mark.parametrize("placeholder", ["document", "Document", "unknown",
                                         "other", "file"])
def test_v35_a_placeholder_form_is_dropped_not_stated(placeholder):
    """
    QA-9's corpus pass measured what `filing_type` actually holds:

        454,503 / 478,433  (95%)  'document'
         23,930 / 478,433   (5%)  a real SEC form

    `document` is what the ingestion writes when it does not know the form.
    Emitting it would have put a filing-shaped value on 95% of prose citations
    that names no filing — §2.2's "make the fields non-empty" failure, one
    field over, in code this round had already shipped.
    """
    out = local_payload({**CHUNK, "filing_type": placeholder})
    assert "form" not in out
    assert out["ticker"] == "AAPL", "the rest of the identity survives"


def test_v35_a_real_form_is_still_stated():
    """The control. Dropping every form would be the opposite error."""
    assert local_payload({**CHUNK, "filing_type": "10-Q"})["form"] == "10-Q"


def test_v35_a_placeholder_alone_is_not_identity():
    """A row whose only identity was the placeholder says nothing, so it gets
    nothing rather than a bare `source_class`."""
    assert local_payload({"filing_type": "document", "text": "prose"}) == {}
