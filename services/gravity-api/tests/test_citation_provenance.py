"""
The accession must survive every hop, and the citation must name the filing.

The failure this pins was silent and complete. `edgar_search` resolved the exact
accession, built the exact filing index URL, verified the period and the
dimension, and hung all of it on `RetrievalResult.metadata`. `fact_persistence`
wrote it to the database. And then `_normalize_citations` built the user-facing
citation out of the passage's *attributes* only — `RetrievalResult` has no
attribute for any of it — so the accession was dropped one step before anyone
could see it, and `url` fell through to
`browse-edgar?action=getcompany&CIK=NVDA`: a company listing, offered in place
of the filing that was already known.

Two combinations the hardening document calls impossible are the reason the
checks below are field-by-field rather than "provenance is present":

    CORRECT VALUE + WRONG FILING
    CORRECT FILING + WRONG PERIOD
    CORRECT PERIOD + WRONG SEGMENT

Each is a citation that looks right. Only comparing the citation against the
verified evidence, field for field, distinguishes them.

The hops, and where each is proven:

    A  SEC resolution          `TestA_SecResolution`
    B  verification            `TestB_Verification`
    C  persistence             `TestC_Persistence`
    D  retrieval               `TestD_Retrieval`
    E  citation generation     `TestE_CitationGeneration`
    F  exact filing provenance `TestF_ExactFilingProvenance`
    G  no generic fallback     `TestG_NoSilentGenericFallback`
    H-L citation vs evidence   `TestHtoL_TheCitationMatchesTheEvidence`
"""

from __future__ import annotations

import pytest

from app.core.retrieval import citation_provenance as cp
from app.core.retrieval.edgar_search import EdgarSearch
from app.core.retrieval.fact_persistence import fact_row
from app.core.retrieval.fusion import RetrievalResult
from app.core.retrieval.structured_search import StructuredSearch
from app.core.search_pipeline import _answer_provenance, _normalize_citations
from tests.test_evidence_gate import ACCN, CIK, DATA_CENTER, THE_QUESTION, TICKER
from tests.test_evidence_gate import _row as stored_row
from tests.test_sec_query_time_regression import _SECFake

EXACT_FILING_URL = (
    "https://www.sec.gov/Archives/edgar/data/1045810/"
    "000104581025000230/0001045810-25-000230-index.htm"
)
GENERIC_BROWSE = "browse-edgar?action=getcompany"


async def _live_result() -> RetrievalResult:
    """The Data Center fact as the real EDGAR channel resolves it."""
    channel = EdgarSearch(http_client=_SECFake())
    out = await channel.search(THE_QUESTION, top_k=5)
    assert out, "the fixture filing reports this fact"
    return out[0]


def _cite(passage: RetrievalResult) -> dict:
    """One passage through the real citation normalizer, as the LLM emits it."""
    raw = [{"id": 1, "source": passage.document_title, "text": passage.text}]
    out = _normalize_citations(raw, [passage])
    assert out, "a passage must produce a citation"
    return out[0]


# ── A. accession survives SEC resolution ────────────────────────────────────


class TestA_SecResolution:
    @pytest.mark.asyncio
    async def test_the_resolved_fact_names_its_accession(self):
        r = await _live_result()
        assert r.metadata["accn"] == ACCN

    @pytest.mark.asyncio
    async def test_the_resolved_fact_names_its_cik_and_form(self):
        r = await _live_result()
        assert r.metadata["cik"] == CIK
        assert r.metadata["form"] == "10-Q"

    @pytest.mark.asyncio
    async def test_the_resolved_fact_carries_the_exact_filing_url(self):
        r = await _live_result()
        assert r.metadata["filing_url"] == EXACT_FILING_URL

    @pytest.mark.asyncio
    async def test_the_resolved_fact_names_the_issuer_not_only_the_symbol(self):
        r = await _live_result()
        assert "NVIDIA" in r.metadata["issuer"].upper()

    @pytest.mark.asyncio
    async def test_an_accession_that_is_not_one_never_becomes_a_url(self):
        """
        The string arrives from a parsed JSON document. "sec.gov sent it" is an
        assumption about the network, not a property of the value, and it is
        about to be interpolated into a URL path and shown to a user.
        """
        channel = EdgarSearch(http_client=_SECFake())
        bad = channel._to_result(
            TICKER, CIK, "Revenues", "revenue",
            {"fy": 2026, "quarter": 3, "value": 1, "unit": "USD",
             "accn": "../../../etc/passwd", "start": "2025-07-28",
             "end": "2025-10-26"},
        )
        assert bad.metadata["filing_url"] == ""
        assert cp.provenance(bad.metadata) is None


# ── B. accession survives verification ──────────────────────────────────────


class TestB_Verification:
    @pytest.mark.asyncio
    async def test_a_verified_fact_still_carries_its_accession(self):
        r = await _live_result()
        assert r.metadata["verification_status"] == "verified"
        assert r.metadata["accn"] == ACCN

    @pytest.mark.asyncio
    async def test_verification_status_reaches_the_provenance_object(self):
        prov = cp.provenance((await _live_result()).metadata)
        assert prov["verification_status"] == "verified"


# ── C. accession survives persistence ───────────────────────────────────────


class TestC_Persistence:
    @pytest.mark.asyncio
    async def test_the_written_row_carries_the_accession(self):
        from app.core.retrieval.evidence_gate import decode_provenance

        row = fact_row(await _live_result())
        assert decode_provenance(row["source_section"])["accn"] == ACCN

    @pytest.mark.asyncio
    async def test_the_written_row_carries_the_evidence_location(self):
        """
        Which artefact, and where inside it. CIK and accession already rebuild
        the archive path, so only the instance filename and the XBRL context
        element are stored — the two that make the reading reproducible by hand.
        """
        from app.core.retrieval.evidence_gate import decode_provenance

        prov = decode_provenance(fact_row(await _live_result())["source_section"])
        assert prov["meth"] == "filing_instance"
        assert prov["loc"].endswith("_htm.xml")
        assert prov["ctx"], "the XBRL context element pins period and members"

    @pytest.mark.asyncio
    async def test_the_written_row_names_the_issuer(self):
        from app.core.retrieval.evidence_gate import decode_provenance

        prov = decode_provenance(fact_row(await _live_result())["source_section"])
        assert "NVIDIA" in prov["issuer"].upper()


# ── D. accession survives retrieval out of the corpus ───────────────────────


class TestD_Retrieval:
    """
    The second ask of the same question is answered locally, from a `financials`
    row. If provenance stopped at the database the locally-answered citation
    would carry no accession — and the whole point of persisting the fact is
    that the second answer is as citable as the first.
    """

    def test_a_stored_row_rehydrates_into_the_live_metadata_shape(self):
        m = cp.rehydrate(stored_row())
        assert m["accn"] == ACCN
        assert m["tag"] == "Revenues"
        assert m["fiscal_year"] == "2026"
        assert m["fiscal_quarter"] == "3"
        assert m["period_start"] == "2025-07-28"
        assert m["period_end"] == "2025-10-26"
        assert m["filing_url"] == EXACT_FILING_URL

    def test_a_row_written_by_anything_else_rehydrates_to_nothing(self):
        """The legacy companyfacts backfill and the table scrapes have no
        accession, so there is no provenance to recover and none is invented."""
        legacy = stored_row(source_section="xbrl_companyfacts")
        assert cp.provenance(cp.rehydrate(legacy)) is None

    @pytest.mark.asyncio
    async def test_the_structured_channel_passes_the_row_through_intact(self):
        """
        `structured_search` sets `metadata=r`, the raw row. That is what makes
        rehydration in the provenance builder sufficient — but only while the
        row really does arrive whole, so it is asserted rather than assumed.
        """
        row = stored_row()
        captured: list[RetrievalResult] = []

        async def _select(table, filters, select="*", limit=10, offset=0):
            return [row]

        import app.db.supabase_rest as sb
        from app.config import settings

        old = (sb.sb_select, sb.configured, settings.structured_facts_enabled)
        sb.sb_select, sb.configured = _select, lambda: True
        settings.structured_facts_enabled = True
        try:
            captured = await StructuredSearch().search(
                THE_QUESTION, filters={"companies": [TICKER]}
            )
        finally:
            sb.sb_select, sb.configured, settings.structured_facts_enabled = old

        assert captured, "the channel must return the row it read"
        assert captured[0].metadata.get("source_section") == row["source_section"]
        assert cp.provenance(captured[0].metadata)["accession"] == ACCN


# ── E. accession reaches citation generation ────────────────────────────────


class TestE_CitationGeneration:
    @pytest.mark.asyncio
    async def test_the_citation_carries_the_accession(self):
        assert _cite(await _live_result())["accession"] == ACCN

    @pytest.mark.asyncio
    async def test_the_citation_carries_the_full_provenance_chain(self):
        chain = _cite(await _live_result())["provenance"]["provenance_chain"]
        joined = " ".join(chain)
        assert f"accession={ACCN}" in joined
        assert "cik=1045810" in joined
        assert "fiscal_period=FY2026Q3" in joined
        assert "verification=verified" in joined

    def test_a_locally_answered_citation_also_carries_the_accession(self):
        """The hop the persistence layer exists for: ask twice, cite twice."""
        local = RetrievalResult(
            chunk_id="fin_NVDA_Revenues_DataCenter_FY2026Q3_xbrl",
            document_id=f"edgar:{TICKER}:{ACCN}",
            text=f"Revenue - Data Center: {DATA_CENTER}",
            ticker=TICKER,
            metadata=stored_row(),
        )
        c = _cite(local)
        assert c["accession"] == ACCN
        assert c["filing_url"] == EXACT_FILING_URL

    def test_a_passage_with_no_filing_gets_no_fabricated_provenance(self):
        prose = RetrievalResult(
            chunk_id="c1", document_id="d1", ticker=TICKER,
            text="Management discussed data center demand.",
            metadata={"source": "dense"},
        )
        c = _cite(prose)
        assert "accession" not in c
        assert c.get("provenance") is None

    @pytest.mark.asyncio
    async def test_telemetry_reports_the_filing_the_answer_rests_on(self):
        t = _answer_provenance([_cite(await _live_result())])
        assert t["source_accession"] == ACCN
        assert t["source_filing_url"] == EXACT_FILING_URL
        assert t["verification_status"] == "verified"

    def test_telemetry_says_nothing_when_nothing_authoritative_was_cited(self):
        t = _answer_provenance([{"id": 1, "text": "some prose"}])
        assert t == {
            "source_accession": "", "source_filing_url": "", "verification_status": ""
        }


# ── F. the citation contains exact filing provenance ────────────────────────


class TestF_ExactFilingProvenance:
    @pytest.mark.asyncio
    async def test_every_field_the_document_requires_is_present(self):
        prov = _cite(await _live_result())["provenance"]
        for field in (
            "issuer", "ticker", "cik", "filing_form", "filing_date", "accession",
            "fiscal_year", "fiscal_quarter", "period_start", "period_end",
            "xbrl_concept", "dimension", "dimension_value", "unit", "value",
            "verification_status", "source_url", "filing_url",
            "evidence_location", "extraction_method", "provenance_chain",
        ):
            assert prov.get(field) not in (None, "", [], {}), f"{field} is missing"

    @pytest.mark.asyncio
    async def test_the_evidence_location_names_the_document_and_the_context(self):
        prov = _cite(await _live_result())["provenance"]
        doc, _, ctx = prov["evidence_location"].partition("#")
        assert doc.endswith("_htm.xml"), doc
        assert ctx, "the XBRL context element is what pins period and members"

    @pytest.mark.asyncio
    async def test_the_extraction_method_distinguishes_the_two_artefacts(self):
        """A segment figure is read out of the filing's own instance document.
        A consolidated one comes from SEC's companyconcept aggregation. Those
        are different evidence and the citation says which."""
        segment = cp.provenance((await _live_result()).metadata)
        assert segment["extraction_method"] == "filing_instance"

        channel = EdgarSearch(http_client=_SECFake())
        out = await channel.search("What was NVDA revenue in Q3 FY2026?", top_k=3)
        consolidated = cp.provenance(out[0].metadata)
        assert consolidated["extraction_method"] == "companyconcept"
        assert consolidated["scope"] == "consolidated"


# ── G. no silent fallback to a generic EDGAR URL ────────────────────────────


class TestG_NoSilentGenericFallback:
    @pytest.mark.asyncio
    async def test_the_citation_url_is_the_exact_filing(self):
        c = _cite(await _live_result())
        assert c["url"] == EXACT_FILING_URL
        assert GENERIC_BROWSE not in c["url"]

    @pytest.mark.asyncio
    async def test_the_exact_filing_outranks_a_url_the_model_emitted(self):
        """
        The resolver read the accession out of the filing; the model did not.
        A model-supplied URL winning here is how a correct value acquires a
        wrong filing.
        """
        passage = await _live_result()
        raw = [{"id": 1, "source": passage.document_title, "text": passage.text,
                "url": "https://example.com/somewhere-else"}]
        assert _normalize_citations(raw, [passage])[0]["url"] == EXACT_FILING_URL

    def test_a_passage_with_no_filing_may_still_use_the_browse_url(self):
        """The generic URL is a fallback for passages that never named a filing,
        which is what makes substituting it for a known filing a downgrade."""
        prose = RetrievalResult(
            chunk_id="c1", document_id="d1", ticker=TICKER, document_type="10-K",
            text="Management discussed data center demand.", metadata={},
        )
        assert GENERIC_BROWSE in _cite(prose)["url"]

    def test_the_url_chooser_prefers_the_filing_over_anything_offered(self):
        prov = {"filing_url": EXACT_FILING_URL, "source_url": "https://data.sec.gov/x"}
        assert cp.citation_url(prov, "https://fallback") == EXACT_FILING_URL

    def test_the_url_chooser_keeps_the_resolver_url_when_no_filing_url_exists(self):
        """S6: if the exact filing URL cannot be built safely, retain the
        authoritative SEC URL the resolver returned — never the generic one."""
        prov = {"source_url": "https://data.sec.gov/api/xbrl/companyconcept/x.json"}
        assert cp.citation_url(prov, "https://fallback").startswith("https://data.sec.gov")


# ── H-L. the citation matches the evidence, field for field ─────────────────


class TestHtoL_TheCitationMatchesTheEvidence:
    """
    CORRECT VALUE + WRONG FILING, CORRECT FILING + WRONG PERIOD, and
    CORRECT PERIOD + WRONG SEGMENT are all citations that look right. Only
    comparing each field against the verified evidence separates them.
    """

    @pytest.mark.asyncio
    async def test_H_the_citation_value_is_the_verified_value(self):
        r = await _live_result()
        prov = _cite(r)["provenance"]
        assert prov["value"] == r.metadata["value"] == DATA_CENTER

    @pytest.mark.asyncio
    async def test_I_the_citation_period_is_the_period_the_question_named(self):
        prov = _cite(await _live_result())["provenance"]
        assert (prov["fiscal_year"], prov["fiscal_quarter"]) == (2026, 3)
        # The span, not only the label: Q3 FY2026 *ends* 2025-10-26, and the
        # same filing carries a 272-day year-to-date column under the same tag.
        assert (prov["period_start"], prov["period_end"]) == ("2025-07-28", "2025-10-26")

    @pytest.mark.asyncio
    async def test_J_the_citation_dimension_is_the_segment_that_was_asked_for(self):
        prov = _cite(await _live_result())["provenance"]
        assert prov["scope"] == "segment"
        # The member travels as the raw XBRL name (`nvda:DataCenterMember`), not
        # as the display label, because that is what an auditor resolves against
        # the filing.
        members = " ".join(str(m) for m in prov["dimension_value"]).lower()
        assert "datacenter" in members, members
        # Compute & Networking sits 0.6% away and is a different thing.
        assert "computeandnetworking" not in members, members
        assert any("ProductOrService" in str(a) for a in prov["dimension"])

    @pytest.mark.asyncio
    async def test_K_the_citation_unit_is_the_unit_of_the_value(self):
        r = await _live_result()
        assert _cite(r)["provenance"]["unit"] == r.metadata["unit"] == "USD"

    @pytest.mark.asyncio
    async def test_L_the_citation_issuer_is_the_issuer_of_the_filing(self):
        prov = _cite(await _live_result())["provenance"]
        assert prov["ticker"] == TICKER
        assert "NVIDIA" in prov["issuer"].upper()
        assert prov["cik"] == CIK

    @pytest.mark.asyncio
    async def test_the_consolidated_total_is_never_cited_as_the_segment(self):
        """CORRECT PERIOD + WRONG SEGMENT, stated as an assertion."""
        from tests.test_sec_query_time_regression import (
            COMPUTE_AND_NETWORKING_Q3_FY2026,
            CONSOLIDATED_Q3_FY2026,
            YTD_THROUGH_Q3_FY2026,
        )

        prov = _cite(await _live_result())["provenance"]
        assert prov["value"] not in (
            CONSOLIDATED_Q3_FY2026,
            COMPUTE_AND_NETWORKING_Q3_FY2026,
            YTD_THROUGH_Q3_FY2026,
        )


# ── the security boundary the accession crosses ─────────────────────────────


class TestUntrustedAccessionHandling:
    @pytest.mark.parametrize(
        "bad",
        [
            "", None, "not-an-accession", "0001045810-25-00023",
            "../../../../etc/passwd", "0001045810-25-000230/../../secret",
            "0001045810-25-000230\n", "https://evil.example/x",
            "0001045810‑25‑000230",  # unicode non-breaking hyphens
        ],
    )
    def test_a_malformed_accession_is_refused(self, bad):
        assert cp.valid_accession(bad) is False

    def test_a_real_accession_is_accepted(self):
        assert cp.valid_accession(ACCN) is True

    @pytest.mark.parametrize(
        "bad",
        [
            "../nvda-20251026_htm.xml", "/etc/passwd", "a/b_htm.xml",
            "https://evil.example/x.xml", "nvda.exe", "", None,
            "x" * 200 + ".xml",
        ],
    )
    def test_a_malformed_instance_filename_is_refused(self, bad):
        assert cp.valid_instance_name(bad) is False

    def test_a_real_instance_filename_is_accepted(self):
        assert cp.valid_instance_name("nvda-20251026_htm.xml") is True

    @pytest.mark.asyncio
    async def test_a_traversing_filename_in_the_filing_index_is_not_fetched(self):
        """
        The instance filename comes off the wire, out of the filing's own
        index.json, and is appended to an Archives URL. A path separator or a
        parent hop in that field would point the fetch outside the archive.
        """
        from app.core.retrieval.sec_dimensions import find_instance_name

        class _Index:
            status_code = 200

            @staticmethod
            def json():
                return {"directory": {"item": [
                    {"name": "../../../../etc/passwd"},
                    {"name": "https://evil.example/x_htm.xml"},
                ]}}

        class _Http:
            async def get(self, url):
                return _Index()

        assert await find_instance_name(_Http(), CIK, ACCN) is None
