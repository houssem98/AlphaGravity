"""
A source click must open the exact filing. EOG, end to end.

The reported bug: clicking an EOG 10-K source opened

    https://www.sec.gov/cgi-bin/browse-edgar?action=getcompany&CIK=EOG&type=10-K

a company listing, while accession 0000821189-25-000011 had already been
resolved, verified and persisted. Two independent causes, both fixed here:

1. **The source object carried no URL at all.** `source_data` in
   `search_pipeline` emitted id/title/text/ticker/date and nothing else, and
   `SourcePassage` had no field for a filing. So the frontend had nothing to
   click and rebuilt a URL from the ticker.
2. **The frontend's resolver did not exist.** `EdgarLink` fetched
   `/v1/documents/filing-url` to resolve the link; gravity-api has no such
   route, so the fetch 404'd on every render and the generic fallback was taken
   100% of the time.

The fixture is real: `eog_revenues_concept.json` was recorded from
`data.sec.gov` on 2026-08-26, trimmed to the three points that accession
0000821189-25-000011 reports. EOG's FY2024 revenue in that filing is
23,698,000,000 USD and it is reported under `us-gaap:Revenues` —
`RevenueFromContractWithCustomerExcludingAssessedTax` 404s for this filer,
which is exactly the fallback case the concept family exists for.
"""

from __future__ import annotations

import json
from pathlib import Path

import pytest

from app.core.retrieval import citation_provenance as cp
from app.core.retrieval.edgar_search import EdgarSearch
from app.core.retrieval.fact_persistence import fact_row
from app.core.retrieval.fusion import RetrievalResult
from app.core.search_pipeline import _normalize_citations
from app.ingestion.sources.sec_quarterly import filing_url
from tests.test_sec_query_time_regression import _Resp

FIX = Path(__file__).parent / "fixtures"

TICKER = "EOG"
CIK = 821189
ACCN = "0000821189-25-000011"
# SEC spells this differently in its two files: `company_tickers.json` says
# "EOG RESOURCES INC", companyconcept says "EOG RESOURCES, INC.". The issuer is
# taken from the ticker file, which is where the resolver reads it.
ISSUER = "EOG RESOURCES INC"
FY2024_REVENUE = 23_698_000_000
FORM = "10-K"
FILED = "2025-02-27"

# The exact URL the specification requires.
EXACT_FILING_URL = (
    "https://www.sec.gov/Archives/edgar/data/821189/"
    "000082118925000011/0000821189-25-000011-index.htm"
)
GENERIC_BROWSE = "browse-edgar"

QUESTION = "What was EOG Resources total revenue in FY2024?"

EOG_TICKER_MAP = {
    "0": {"cik_str": CIK, "ticker": TICKER, "title": "EOG RESOURCES INC"},
}


class _EogSEC:
    """Serves the recorded EOG responses. No network."""

    def __init__(self):
        self.urls: list[str] = []
        self._concept = json.loads(
            (FIX / "eog_revenues_concept.json").read_text(encoding="utf-8")
        )

    async def get(self, url):
        self.urls.append(url)
        if "company_tickers.json" in url:
            return _Resp(EOG_TICKER_MAP)
        if url.endswith("Revenues.json"):
            return _Resp(self._concept)
        # Every other concept 404s, as it does for this filer in reality.
        return _Resp(None, 404)


async def _eog_result() -> RetrievalResult:
    """EOG's FY2024 revenue as the real channel resolves it."""
    out = await EdgarSearch(http_client=_EogSEC()).search(QUESTION, top_k=5)
    assert out, "the recorded filing reports this fact"
    return out[0]


def _cite(passage: RetrievalResult) -> dict:
    raw = [{"id": 1, "source": passage.document_title, "text": passage.text}]
    return _normalize_citations(raw, [passage])[0]


def _source_card(passage: RetrievalResult) -> dict:
    """
    The source object the pipeline emits, built exactly as Stage 5 builds it.

    Kept in step with `search_pipeline` by calling the same two functions the
    pipeline calls, rather than by copying the dict literal — a copy would keep
    passing while the pipeline regressed.
    """
    return {
        "id": "src_1",
        "chunk_id": passage.chunk_id,
        "title": passage.document_title,
        "ticker": passage.ticker,
        **cp.payload(cp.provenance(passage.metadata, ticker=passage.ticker)),
    }


# ── 3. exact filing URL construction, generically ───────────────────────────


class TestTheUrlIsConstructedFromCikAndAccession:
    def test_the_eog_filing_url_is_exact(self):
        assert filing_url(CIK, ACCN) == EXACT_FILING_URL

    def test_the_accession_is_normalised_for_the_archives_path(self):
        """`0000821189-25-000011` -> `000082118925000011` in the path, and the
        hyphenated form is kept for the visible filing identity."""
        url = filing_url(CIK, ACCN)
        assert "/000082118925000011/" in url
        assert url.endswith(f"/{ACCN}-index.htm")

    @pytest.mark.parametrize(
        "cik,accn,expected_prefix",
        [
            (1045810, "0001045810-25-000230",
             "https://www.sec.gov/Archives/edgar/data/1045810/000104581025000230/"),
            (320193, "0000320193-24-000123",
             "https://www.sec.gov/Archives/edgar/data/320193/000032019324000123/"),
        ],
    )
    def test_it_is_not_hardcoded_to_eog(self, cik, accn, expected_prefix):
        assert filing_url(cik, accn).startswith(expected_prefix)

    def test_a_malformed_accession_produces_no_url_rather_than_a_guess(self):
        assert cp.provenance({"accn": "not-an-accession", "cik": CIK}) is None


# ── 8. the required EOG regression ──────────────────────────────────────────


class TestEogCitationCarriesTheExactFilingUrl:
    @pytest.mark.asyncio
    async def test_the_resolved_fact_is_the_eog_10k(self):
        r = await _eog_result()
        assert r.metadata["accn"] == ACCN
        assert r.metadata["cik"] == CIK
        assert r.metadata["form"] == FORM
        assert r.metadata["value"] == FY2024_REVENUE

    @pytest.mark.asyncio
    async def test_citation_filing_url_is_the_exact_filing(self):
        """The assertion the specification names."""
        assert _cite(await _eog_result())["filing_url"] == EXACT_FILING_URL

    @pytest.mark.asyncio
    async def test_the_generic_browse_url_is_not_used_anywhere_in_the_citation(self):
        c = _cite(await _eog_result())
        blob = json.dumps(c, default=str)
        assert GENERIC_BROWSE not in blob, blob

    @pytest.mark.asyncio
    async def test_the_click_target_is_the_exact_filing(self):
        c = _cite(await _eog_result())
        assert c["canonical_url"] == EXACT_FILING_URL
        assert c["url"] == EXACT_FILING_URL

    @pytest.mark.asyncio
    async def test_the_citation_names_the_filing_for_display(self):
        """S12: the card can say what it is about to open."""
        c = _cite(await _eog_result())
        assert c["issuer"] == ISSUER
        assert c["ticker"] == TICKER
        assert c["form"] == FORM
        assert c["filing_date"] == FILED
        assert c["fiscal_period"] == "FY2024"
        assert c["accession"] == ACCN
        assert c["accession_number"] == ACCN


# ── 5. the API contract ─────────────────────────────────────────────────────


class TestTheSourceObjectCarriesTheFiling:
    """
    The source card is what the user clicks, and it used to carry no URL at all.
    """

    @pytest.mark.asyncio
    async def test_the_source_card_has_every_field_the_contract_requires(self):
        s = _source_card(await _eog_result())
        for field in (
            "ticker", "issuer", "cik", "form", "filing_date", "fiscal_period",
            "accession_number", "filing_url", "document_url", "source_url",
            "verification_status",
        ):
            assert s.get(field) not in (None, ""), f"{field} missing from the source"

    @pytest.mark.asyncio
    async def test_the_source_click_target_is_the_exact_filing(self):
        s = _source_card(await _eog_result())
        assert s["canonical_url"] == EXACT_FILING_URL
        assert s["filing_url"] == EXACT_FILING_URL

    @pytest.mark.asyncio
    async def test_the_source_never_carries_a_company_listing(self):
        s = _source_card(await _eog_result())
        assert GENERIC_BROWSE not in json.dumps(s, default=str)

    @pytest.mark.asyncio
    async def test_the_frontend_never_has_to_rebuild_the_url(self):
        """Everything needed to link is already present, so a client that
        reconstructs one is doing so by choice, not by necessity."""
        s = _source_card(await _eog_result())
        assert s["canonical_url"].startswith("https://www.sec.gov/Archives/")

    @pytest.mark.asyncio
    async def test_a_prose_passage_gets_no_filing_link(self):
        """Nothing is invented for a passage that never named a filing."""
        prose = RetrievalResult(
            chunk_id="c1", document_id="d1", ticker=TICKER,
            text="Management discussed production growth.", metadata={},
        )
        assert cp.payload(cp.provenance(prose.metadata)) == {}
        assert _cite(prose).get("canonical_url") is None


# ── 10. both paths ──────────────────────────────────────────────────────────


class TestBothPathsResolveTheSameFiling:
    """
    S10: the SEC path and the persisted-local path must not disagree. An exact
    URL on the first ask and a company listing on the second is the failure this
    pins.
    """

    @pytest.mark.asyncio
    async def test_the_persisted_row_rebuilds_the_same_exact_url(self):
        r = await _eog_result()
        stored = {**fact_row(r), "created_at": "2026-08-26T00:00:00+00:00"}

        live = cp.payload(cp.provenance(r.metadata, ticker=TICKER))
        local = cp.payload(cp.provenance(stored, ticker=TICKER))

        assert local["canonical_url"] == live["canonical_url"] == EXACT_FILING_URL
        assert local["accession"] == live["accession"] == ACCN
        assert local["cik"] == str(CIK) or local["cik"] == CIK

    @pytest.mark.asyncio
    async def test_the_locally_answered_citation_opens_the_same_filing(self):
        r = await _eog_result()
        stored = {**fact_row(r), "created_at": "2026-08-26T00:00:00+00:00"}
        local_passage = RetrievalResult(
            chunk_id=f"fin_{stored['id']}", document_id=stored["document_id"],
            text=f"{stored['metric_name']}: {stored['value_raw']}",
            ticker=TICKER, metadata=stored,
        )
        c = _cite(local_passage)
        assert c["filing_url"] == EXACT_FILING_URL
        assert c["url"] == EXACT_FILING_URL
        assert GENERIC_BROWSE not in json.dumps(c, default=str)

    @pytest.mark.asyncio
    async def test_the_locally_answered_source_card_opens_the_same_filing(self):
        r = await _eog_result()
        stored = {**fact_row(r), "created_at": "2026-08-26T00:00:00+00:00"}
        local_passage = RetrievalResult(
            chunk_id=f"fin_{stored['id']}", document_id=stored["document_id"],
            text="Revenue", ticker=TICKER, metadata=stored,
        )
        assert _source_card(local_passage)["canonical_url"] == EXACT_FILING_URL


# ── 11. the resilience path ─────────────────────────────────────────────────


class TestEveryCitationBuilderUsesTheSameProvenance:
    """
    S11. There are two citation builders in `_normalize_citations`: the join,
    and the synthesis branch that runs when the model degrades and drops its
    citations array. A path that skips provenance is a path that opens a company
    listing exactly when the answer is most in need of its source.
    """

    @pytest.mark.asyncio
    async def test_the_normal_builder_uses_provenance(self):
        c = _normalize_citations(
            [{"id": 1, "source": "EOG 10-K", "text": "x"}], [await _eog_result()]
        )[0]
        assert c["url"] == EXACT_FILING_URL

    @pytest.mark.asyncio
    async def test_the_resilience_builder_uses_provenance(self):
        """No citations from the model at all — the synthesis branch."""
        c = _normalize_citations([], [await _eog_result()])[0]
        assert c["url"] == EXACT_FILING_URL
        assert c["filing_url"] == EXACT_FILING_URL
        assert c["accession"] == ACCN
        assert GENERIC_BROWSE not in json.dumps(c, default=str)

    @pytest.mark.asyncio
    async def test_both_builders_agree(self):
        r = await _eog_result()
        normal = _normalize_citations([{"id": 1, "source": "EOG", "text": "x"}], [r])[0]
        resilience = _normalize_citations([], [r])[0]
        for field in ("url", "filing_url", "canonical_url", "accession"):
            assert normal[field] == resilience[field], field

    @pytest.mark.asyncio
    async def test_a_model_supplied_url_cannot_override_provenance(self):
        """S2: never allow an LLM-generated URL to override canonical
        provenance."""
        r = await _eog_result()
        c = _normalize_citations(
            [{"id": 1, "source": "EOG", "text": "x",
              "url": "https://www.sec.gov/cgi-bin/browse-edgar?action=getcompany&CIK=EOG"}],
            [r],
        )[0]
        assert c["url"] == EXACT_FILING_URL


# ── 7. security ─────────────────────────────────────────────────────────────


class TestOnlyTrustedSecUrlsBecomeLinks:
    @pytest.mark.parametrize(
        "url",
        [
            "javascript:alert(1)",
            "data:text/html,<script>alert(1)</script>",
            "file:///etc/passwd",
            "http://localhost:8000/admin",
            "https://localhost/x",
            "http://127.0.0.1/x",
            "https://169.254.169.254/latest/meta-data/",
            "https://evil.example/Archives/edgar/data/821189/x-index.htm",
            "https://www.sec.gov.evil.example/Archives/x",
            "http://www.sec.gov/Archives/x",  # plain http
            "", None,
        ],
    )
    def test_an_untrusted_url_is_refused(self, url):
        assert cp.is_trusted_sec_url(url) is False

    @pytest.mark.parametrize(
        "url",
        [
            EXACT_FILING_URL,
            "https://www.sec.gov/Archives/edgar/data/1045810/000104581025000230/nvda-20251026_htm.xml",
            "https://data.sec.gov/api/xbrl/companyconcept/CIK0000821189/us-gaap/Revenues.json",
        ],
    )
    def test_a_real_sec_url_is_accepted(self, url):
        assert cp.is_trusted_sec_url(url) is True

    def test_an_untrusted_url_in_provenance_is_never_the_click_target(self):
        """Even if a URL reached the provenance object, it cannot be clicked."""
        assert cp.source_click_url({"filing_url": "https://evil.example/x"}) == ""
        assert cp.source_click_url(
            {"filing_url": "https://evil.example/x", "source_url": EXACT_FILING_URL}
        ) == EXACT_FILING_URL

    def test_no_provenance_yields_no_click_target(self):
        assert cp.source_click_url(None) == ""
        assert cp.source_click_url({}) == ""


# ── 4 / 13. document URL vs filing URL, and evidence location ───────────────


class TestDocumentUrlAndEvidenceLocationArePreserved:
    @pytest.mark.asyncio
    async def test_both_urls_are_kept(self):
        prov = cp.provenance((await _eog_result()).metadata, ticker=TICKER)
        assert prov["filing_url"] == EXACT_FILING_URL
        assert prov["document_url"], "the evidence document is not discarded"

    @pytest.mark.asyncio
    async def test_the_evidence_location_names_the_artefact(self):
        """S13: the filing index is the click target, but it is not claimed to
        be the exact location of the fact — that stays on the provenance."""
        prov = cp.provenance((await _eog_result()).metadata, ticker=TICKER)
        assert prov["evidence_location"]
        assert prov["extraction_method"] == "companyconcept"

    @pytest.mark.asyncio
    async def test_the_click_target_prefers_the_filing_over_the_json_api(self):
        """A companyconcept URL is authoritative evidence but not a filing a
        person can read. The index page is what a source click opens."""
        prov = cp.provenance((await _eog_result()).metadata, ticker=TICKER)
        assert prov["document_url"].startswith("https://data.sec.gov/")
        assert cp.source_click_url(prov) == EXACT_FILING_URL

    def test_an_archives_document_is_preferred_when_there_is_no_filing_url(self):
        doc = (
            "https://www.sec.gov/Archives/edgar/data/821189/"
            "000082118925000011/eog-20241231_htm.xml"
        )
        assert cp.source_click_url({"document_url": doc}) == doc
