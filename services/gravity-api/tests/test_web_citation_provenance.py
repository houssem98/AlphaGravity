"""
One citation architecture for three source classes (spec sections 11, 12, 24).

Matrix items M (citation correctness), N (exact SEC source click), O (exact web
source click), P (persisted provenance).

The bug this guards against is specific and was live in the codebase before this
change: `_normalize_citations` ends its URL fallback chain with
`_edgar_browse_url(ticker, form)`. A web citation reaching that fallback gets a
`browse-edgar?action=getcompany` link — a source card that opens a company
filing list while claiming to be the Reuters article it quoted. That is the same
class of bug as the SEC one the exact-filing work removed, pointed the other way.
"""
import pytest

from app.core.retrieval.citation_provenance import (
    click_url,
    is_renderable_web_url,
    is_trusted_sec_url,
    payload,
    provenance,
    source_click_url,
    source_payload,
    web_payload,
)

# Real EOG provenance — the accession and CIK from `FIX_SOURCE_CLICK`.
SEC_META = {
    "accn": "0000821189-25-000011",
    "cik": 821189,
    "issuer": "EOG Resources, Inc.",
    "form": "10-K",
    "filed": "2025-02-27",
    "tag": "Revenues",
    "fiscal_year": 2025,
    "unit": "USD",
    "value": 24_200_000_000,
    "verification_status": "verified",
    "filing_url": ("https://www.sec.gov/Archives/edgar/data/821189/"
                   "000082118925000011/0000821189-25-000011-index.htm"),
    "document_url": ("https://www.sec.gov/Archives/edgar/data/821189/"
                     "000082118925000011/eog-20241231.htm"),
}

WEB_META = {
    "source_class": "WEB_EVIDENCE",
    "web_evidence": True,
    "url": "https://www.reuters.com/business/energy/eog-q4-2025",
    "canonical_url": "https://reuters.com/business/energy/eog-q4-2025",
    "title": "EOG Resources reports fourth quarter results",
    "domain": "reuters.com",
    "published_at": "2026-02-20T10:00:00+00:00",
    "retrieved_at": "2026-08-26T09:00:00+00:00",
    "source_type": "web_page",
    "evidence_location": "paragraph 3",
    "fetch_provider": "http",
    "search_provider": "tavily",
}


class TestOneEntryPointForEverySourceClass:
    """Spec section 32: no second citation architecture."""

    def test_a_sec_passage_resolves_to_sec_provenance(self):
        out = source_payload(SEC_META, ticker="EOG")
        assert out["accession"] == "0000821189-25-000011"
        assert out["filing_url"].endswith("0000821189-25-000011-index.htm")
        assert "domain" not in out, "a filing must not acquire a web domain"

    def test_a_web_passage_resolves_to_web_provenance(self):
        out = source_payload(WEB_META)
        assert out["source_class"] == "WEB_EVIDENCE"
        assert out["domain"] == "reuters.com"
        assert "accession" not in out, "a web page must not acquire an accession"

    def test_a_local_prose_chunk_gets_neither(self):
        assert source_payload({"chunk_id": "c1", "text": "prose"}) == {}
        assert source_payload(None) == {}

    def test_sec_wins_when_a_passage_somehow_carries_both(self):
        """
        An accession is the stronger claim: it names a document that can be
        opened and audited. A URL alongside it does not weaken that.
        """
        out = source_payload({**SEC_META, **WEB_META}, ticker="EOG")
        assert out["accession"] == "0000821189-25-000011"
        assert out["source_class"] != "WEB_EVIDENCE"


class TestWebProvenanceFields:
    """Spec section 11: what a web citation must preserve."""

    @pytest.mark.parametrize("field", [
        "url", "canonical_url", "title", "domain", "published_at",
        "retrieved_at", "source_type", "evidence_location",
    ])
    def test_required_fields_survive(self, field):
        assert web_payload(WEB_META).get(field), field

    def test_an_absent_publication_date_is_absent_not_invented(self):
        out = web_payload({**WEB_META, "published_at": ""})
        assert "published_at" not in out
        # Everything else still travels.
        assert out["url"] and out["retrieved_at"]

    def test_a_malformed_url_yields_no_citation_rather_than_a_broken_link(self):
        for bad in ("", "not a url", "javascript:alert(1)", "data:text/html,x"):
            assert web_payload({**WEB_META, "url": bad, "canonical_url": ""}) == {}, bad


class TestRenderableWebUrls:
    """What may be put in an href, which is a narrower question than what may be
    fetched — the risk in a browser is `javascript:`, not internal networking."""

    @pytest.mark.parametrize("url", [
        "https://www.reuters.com/x",
        "http://example.com/x",
    ])
    def test_http_and_https_are_renderable(self, url):
        assert is_renderable_web_url(url)

    @pytest.mark.parametrize("url", [
        "javascript:alert(1)", "data:text/html,<script>", "file:///etc/passwd",
        "", None, "not a url", "https://",
    ])
    def test_dangerous_and_malformed_urls_are_not(self, url):
        assert not is_renderable_web_url(url)


class TestSourceClickBehaviour:
    """Spec section 24 / matrix N and O."""

    def test_a_sec_click_opens_the_exact_filing(self):
        url = click_url(SEC_META, ticker="EOG")
        assert url == SEC_META["filing_url"]
        assert "browse-edgar" not in url
        assert "action=getcompany" not in url

    def test_a_web_click_opens_the_exact_page(self):
        assert click_url(WEB_META) == WEB_META["url"]

    def test_a_web_click_never_falls_back_to_an_edgar_listing(self):
        """
        The bug this test exists for: a Reuters citation whose card opens a
        company filing list.
        """
        url = click_url(WEB_META)
        assert "sec.gov" not in url and "browse-edgar" not in url

    def test_a_passage_with_no_provenance_gets_the_callers_fallback(self):
        assert click_url({"chunk_id": "c1"}, fallback="") == ""
        assert click_url({"chunk_id": "c1"}, fallback="x") == "x"

    def test_the_generic_listing_is_never_substituted_for_a_known_filing(self):
        """The invariant the exact-filing work established. Unchanged here."""
        assert source_click_url(provenance(SEC_META, ticker="EOG")) == SEC_META["filing_url"]

    def test_sec_link_trust_is_still_a_host_allow_list(self):
        assert is_trusted_sec_url(SEC_META["filing_url"])
        assert not is_trusted_sec_url("https://sec.gov.evil.com/Archives/x")
        assert not is_trusted_sec_url("https://www.reuters.com/x")


class TestTheSecPathIsUnchanged:
    """
    Spec section 2. The SEC provenance builder gained a sibling, not a rewrite;
    these assert the original behaviour byte for byte.
    """

    def test_full_sec_provenance_still_resolves(self):
        p = provenance(SEC_META, ticker="EOG")
        assert p["accession"] == "0000821189-25-000011"
        assert p["cik"] == 821189
        assert p["xbrl_concept"] == "Revenues"
        assert p["fiscal_year"] == 2025
        assert p["unit"] == "USD"
        assert p["verification_status"] == "verified"
        assert p["provenance_chain"]

    def test_a_passage_with_no_accession_still_has_no_sec_provenance(self):
        assert provenance({"text": "some prose"}) is None

    def test_the_sec_payload_shape_is_unchanged(self):
        out = payload(provenance(SEC_META, ticker="EOG"))
        for field in ("accession", "accession_number", "filing_url",
                      "document_url", "cik", "form", "filing_date"):
            assert field in out, field

    def test_a_web_passage_cannot_manufacture_filing_provenance(self):
        """
        The load-bearing security property behind the prompt fence: a page can
        lie, but it cannot become a filing. `provenance()` discriminates on a
        well-formed accession, which no web page supplies.
        """
        assert provenance(WEB_META) is None
        forged = {**WEB_META, "accn": "not-an-accession", "cik": 1}
        assert provenance(forged) is None
