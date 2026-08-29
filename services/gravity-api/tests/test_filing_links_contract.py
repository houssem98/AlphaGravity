"""
The two links a SEC citation carries, and what each one is allowed to be.

`citation_provenance.payload()` is what reaches the browser. The frontend is
forbidden from constructing a SEC URL, so whatever this emits is the whole
decision: if `view_filing_url` is wrong the user opens the wrong document, and
if it is absent when it should not be, the product silently degrades to the
manifest page this work exists to stop being the only answer.

The rule, in one line: **details is deterministic, view is authoritative.**
`filing_details_url` is derivable from CIK + accession and therefore exists
whenever the filing can be named. `view_filing_url` exists only when SEC's own
submissions metadata named the primary document AND the URL is inside this
filing's archive directory.
"""

from __future__ import annotations

import pytest

from app.core.retrieval.citation_provenance import (
    filing_links,
    payload,
    provenance,
    source_payload,
)

CIK = 1045810
ACCN = "0001045810-26-000023"
DIR = f"https://www.sec.gov/Archives/edgar/data/{CIK}/000104581026000023"
DETAILS = f"{DIR}/{ACCN}-index.htm"
PRIMARY = f"{DIR}/nvda-20260126.htm"


def meta(**over) -> dict:
    base = {
        "accn": ACCN,
        "cik": CIK,
        "issuer": "NVIDIA CORP",
        "form": "10-K",
        "filed": "2026-02-25",
        "fiscal_year": 2026,
        "period_end": "2026-01-26",
        "period_of_report": "2026-01-26",
        "tag": "Revenues",
        "unit": "USD",
        "value": 130_497_000_000,
        "filing_url": DETAILS,
        "filing_index_url": DETAILS,
        "primary_document": "nvda-20260126.htm",
        "primary_document_url": PRIMARY,
        "verification_status": "verified",
    }
    base.update(over)
    return base


# ── The happy path ────────────────────────────────────────────────────────


def test_payload_carries_both_links_and_they_differ():
    p = payload(provenance(meta(), ticker="NVDA"))
    assert p["view_filing_url"] == PRIMARY
    assert p["filing_details_url"] == DETAILS
    assert p["view_filing_url"] != p["filing_details_url"]
    assert p["primary_document"] == "nvda-20260126.htm"
    assert p["primary_unresolved_reason"] == ""


def test_details_is_the_index_page_and_view_is_not():
    p = payload(provenance(meta(), ticker="NVDA"))
    assert p["filing_details_url"].endswith(f"{ACCN}-index.htm")
    assert "-index.htm" not in p["view_filing_url"]


def test_the_period_of_report_survives_to_the_payload():
    p = payload(provenance(meta(), ticker="NVDA"))
    assert p["period_of_report"] == "2026-01-26"


def test_source_payload_carries_the_links_too():
    p = source_payload(meta(), ticker="NVDA")
    assert p["view_filing_url"] == PRIMARY
    assert p["filing_details_url"] == DETAILS


# ── The unresolved primary ────────────────────────────────────────────────


def test_no_primary_document_means_details_only_with_a_stated_reason():
    p = payload(provenance(meta(primary_document=None, primary_document_url=None),
                           ticker="NVDA"))
    assert p["view_filing_url"] == ""
    assert p["filing_details_url"] == DETAILS
    assert p["primary_unresolved_reason"]


def test_the_backends_own_reason_is_carried_through():
    p = payload(provenance(
        meta(primary_document=None, primary_document_url=None,
             primary_unresolved_reason="submissions metadata unavailable"),
        ticker="NVDA",
    ))
    assert p["primary_unresolved_reason"] == "submissions metadata unavailable"


@pytest.mark.parametrize("bad", [
    # Another accession of the same registrant.
    "https://www.sec.gov/Archives/edgar/data/1045810/000104581025000116/nvda-20250727.htm",
    # Another registrant entirely.
    "https://www.sec.gov/Archives/edgar/data/320193/000032019325000073/aapl-20250927.htm",
    # A real SEC path over a downgradeable scheme.
    "http://www.sec.gov/Archives/edgar/data/1045810/000104581026000023/nvda-20260126.htm",
    # Not SEC at all.
    "https://evil.example/Archives/edgar/data/1045810/000104581026000023/nvda-20260126.htm",
    # A company listing.
    "https://www.sec.gov/cgi-bin/browse-edgar?action=getcompany&CIK=NVDA",
])
def test_a_primary_url_that_is_not_this_filings_document_is_refused(bad):
    p = payload(provenance(meta(primary_document_url=bad), ticker="NVDA"))
    assert p["view_filing_url"] == ""
    # The filing is still nameable, so details survives.
    assert p["filing_details_url"] == DETAILS
    assert "does not belong" in p["primary_unresolved_reason"]


def test_the_index_page_may_not_masquerade_as_the_primary_document():
    p = payload(provenance(meta(primary_document_url=DETAILS,
                                primary_document=f"{ACCN}-index.htm"), ticker="NVDA"))
    assert p["view_filing_url"] == ""
    assert p["filing_details_url"] == DETAILS


@pytest.mark.parametrize("name", ["report.xml", "report.txt", "Financial_Report.xlsx"])
def test_a_non_html_document_is_not_offered_as_view_filing(name):
    """The XBRL instance and the complete-submission text file are not the filing."""
    p = payload(provenance(
        meta(primary_document=name, primary_document_url=f"{DIR}/{name}"), ticker="NVDA"
    ))
    assert p["view_filing_url"] == ""


def test_a_traversing_document_name_never_reaches_a_url():
    p = payload(provenance(
        meta(primary_document="../../../etc/passwd.htm", primary_document_url=None),
        ticker="NVDA",
    ))
    assert p["view_filing_url"] == ""
    assert ".." not in p["filing_details_url"]


# ── Identity recovery ─────────────────────────────────────────────────────


def test_the_primary_url_is_built_from_the_name_when_only_the_name_is_stored():
    p = payload(provenance(meta(primary_document_url=None), ticker="NVDA"))
    assert p["view_filing_url"] == PRIMARY


def test_links_recovered_from_a_stored_index_url_with_no_accession_field():
    """The Phase-2 legacy case: the URL survived, the identity fields did not."""
    links = filing_links({"filing_index_url": DETAILS})
    assert links["filing_details_url"] == DETAILS
    assert links["view_filing_url"] == ""


def test_no_identity_at_all_yields_neither_link():
    links = filing_links({"issuer": "NVIDIA CORP"})
    assert links["filing_details_url"] == ""
    assert links["view_filing_url"] == ""
    assert links["unresolved_reason"]


def test_a_malformed_accession_yields_no_provenance_and_therefore_no_links():
    assert provenance(meta(accn="0001045810-26-0000")) is None


def test_a_prose_chunk_acquires_no_filing_links():
    assert payload(provenance({"text": "some prose"})) == {}
    assert source_payload({"text": "some prose"}) == {}


# ── Cross-check against the resolver ──────────────────────────────────────


def test_the_two_urls_agree_with_the_resolvers_own_construction():
    from app.core.retrieval import sec_filing_resolver as sfr

    ident = sfr.identity(CIK, ACCN, primary_document="nvda-20260126.htm")
    p = payload(provenance(meta(), ticker="NVDA"))
    assert ident is not None
    assert p["view_filing_url"] == ident.primary_document_url
    assert p["filing_details_url"] == ident.filing_index_url
