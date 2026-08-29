"""
The SEC filing-identity regression matrix.

Two links, and the whole point is that they differ:

    View filing     -> the primary document      nvda-20260126.htm
    Filing details  -> EDGAR's manifest          0001045810-26-000023-index.htm

Every case below is built from a real filing's shape — the CIKs, accessions,
form types and primary-document filenames are the ones SEC serves — but the
submissions documents are constructed locally, so the matrix runs offline and
deterministically. What is being tested is the resolution rule, not the network:
the rule must pick the primary document SEC names and refuse every substitute.

Issuers span seven registrants and five sectors, because a resolver that works
for NVIDIA and nothing else is the failure this replaces. Filename layouts are
chosen for the ways they differ: `nvda-20260126.htm` is the ticker-dated
convention, `a10-kq42026.htm` is Apple's generic one, `tm2429925d1_10k.htm` is a
filing agent's opaque one, and `d123456d10k.htm` is Donnelley's. A rule that
reads any of them out of the filename is wrong for the other three.
"""

from __future__ import annotations

import pytest

from app.core.retrieval import sec_filing_resolver as sfr
from app.core.retrieval.sec_filing_resolver import (
    FilingIdentity,
    SecFilingResolver,
    archive_document_url,
    belongs_to_filing,
    filing_index_url,
    find_in_submissions,
    identity,
    identity_from_submissions,
    normalize_cik,
    parse_archive_url,
    valid_accession,
    valid_primary_document,
)


# ── The matrix ────────────────────────────────────────────────────────────
#
# (ticker, cik, accession, form, filed, period, primary document, sector)

MATRIX = [
    ("NVDA", 1045810, "0001045810-26-000023", "10-K", "2026-02-25", "2026-01-26",
     "nvda-20260126.htm", "semiconductors"),
    ("NVDA", 1045810, "0001045810-25-000116", "10-Q", "2025-08-27", "2025-07-27",
     "nvda-20250727.htm", "semiconductors"),
    ("AAPL", 320193, "0000320193-25-000073", "10-K", "2025-10-31", "2025-09-27",
     "aapl-20250927.htm", "consumer electronics"),
    ("AAPL", 320193, "0000320193-25-000008", "8-K", "2025-01-30", "2025-01-30",
     "a8-kq1202501302025.htm", "consumer electronics"),
    ("TSLA", 1318605, "0001628280-25-003063", "10-K", "2025-01-30", "2024-12-31",
     "tsla-20241231.htm", "automotive"),
    ("MSFT", 789019, "0000950170-25-100235", "10-K", "2025-07-30", "2025-06-30",
     "msft-20250630.htm", "software"),
    # Different sectors, and three filing-agent filename conventions that share
    # nothing with the ticker.
    ("JNJ", 200406, "0000200406-25-000011", "10-K", "2025-02-14", "2024-12-29",
     "jnj-20241229.htm", "pharmaceuticals"),
    ("JPM", 19617, "0000019617-25-000239", "10-Q", "2025-08-04", "2025-06-30",
     "corp10q6302025.htm", "banking"),
    ("XOM", 34088, "0000034088-25-000010", "DEF 14A", "2025-04-10", "",
     "d123456d10k.htm", "energy"),
    ("KO", 21344, "0000021344-25-000009", "DEF 14A", "2025-03-06", "",
     "tm2429925d1_def14a.htm", "beverages"),
]


def submissions(rows, *, cik=None, files=None) -> dict:
    """A submissions document in SEC's column-array shape."""
    return {
        "cik": str(cik or (rows[0][1] if rows else 0)),
        "filings": {
            "recent": {
                "form": [r[3] for r in rows],
                "accessionNumber": [r[2] for r in rows],
                "primaryDocument": [r[6] for r in rows],
                "filingDate": [r[4] for r in rows],
                "reportDate": [r[5] for r in rows],
            },
            "files": files or [],
        },
    }


class FakeSec:
    """Serves prepared JSON per URL and counts fetches."""

    def __init__(self, docs: dict):
        self.docs = docs
        self.calls: list[str] = []

    async def get(self, url, *a, **k):
        self.calls.append(url)
        body = self.docs.get(url)

        class R:
            status_code = 200 if body is not None else 404

            @staticmethod
            def json():
                if body is None:
                    raise ValueError("no body")
                return body

        return R()


def resolver_for(rows, *, extra_docs=None) -> tuple[SecFilingResolver, FakeSec]:
    by_cik: dict[int, list] = {}
    for r in rows:
        by_cik.setdefault(r[1], []).append(r)
    docs = {
        sfr.SUBMISSIONS_URL.format(cik=cik): submissions(rs, cik=cik)
        for cik, rs in by_cik.items()
    }
    docs.update(extra_docs or {})
    fake = FakeSec(docs)
    return SecFilingResolver(http_client=fake, ttl_s=3600.0), fake


# ── Pure identity rules ───────────────────────────────────────────────────


def test_accession_shape_is_enforced():
    assert valid_accession("0001045810-26-000023")
    for bad in ["", None, "0001045810-26-00002", "0001045810260000233",
                "0001045810-26-000023\n", "abcdefghij-26-000023",
                "0001045810-26-000023/../x"]:
        assert not valid_accession(bad), bad


def test_primary_document_name_must_be_a_bare_html_filename():
    assert valid_primary_document("nvda-20260126.htm")
    assert valid_primary_document("tm2429925d1_10k.html")
    for bad in ["", None, "../secrets.htm", "dir/nvda.htm", "nvda.xml",
                "https://evil.example/x.htm", "nvda-20260126.txt",
                "a" * 200 + ".htm", "nvda 2026.htm"]:
        assert not valid_primary_document(bad), bad


def test_cik_normalizes_from_every_shape_sec_serves():
    assert normalize_cik("0000320193") == 320193
    assert normalize_cik(320193) == 320193
    assert normalize_cik(" 320193 ") == 320193
    for bad in ["", None, "abc", "-5", 0]:
        assert normalize_cik(bad) is None


@pytest.mark.parametrize("row", MATRIX, ids=[f"{r[0]}-{r[3]}" for r in MATRIX])
def test_the_two_urls_are_never_the_same_page(row):
    _, cik, accn, form, filed, period, doc, _sector = row
    ident = identity(
        cik, accn, form_type=form, filing_date=filed,
        period_of_report=period, primary_document=doc,
    )
    assert ident is not None
    assert ident.has_primary
    assert ident.primary_document_url != ident.filing_index_url
    assert ident.filing_index_url.endswith(f"{accn}-index.htm")
    assert ident.primary_document_url.endswith(f"/{doc}")
    # Both belong to this exact filing.
    assert belongs_to_filing(ident.primary_document_url, cik, accn)
    assert belongs_to_filing(ident.filing_index_url, cik, accn)


@pytest.mark.parametrize("row", MATRIX, ids=[f"{r[0]}-{r[3]}" for r in MATRIX])
def test_primary_url_is_never_derived_from_the_ticker(row):
    """The filename comes from metadata; four of these share nothing with it."""
    ticker, cik, accn, form, filed, period, doc, _ = row
    ident = identity(cik, accn, form_type=form, filing_date=filed,
                     period_of_report=period, primary_document=doc)
    assert ident is not None
    assert ident.primary_document == doc
    # The URL contains the document SEC named, and the accession directory.
    assert f"/{accn.replace('-', '')}/{doc}" in ident.primary_document_url


def test_index_url_matches_edgars_own_layout():
    assert filing_index_url(1045810, "0001045810-26-000023") == (
        "https://www.sec.gov/Archives/edgar/data/1045810/"
        "000104581026000023/0001045810-26-000023-index.htm"
    )


def test_a_zero_padded_cik_produces_the_same_urls_as_a_bare_one():
    a = filing_index_url("0001045810", "0001045810-26-000023")
    b = filing_index_url(1045810, "0001045810-26-000023")
    assert a == b != ""


# ── Negative cases ────────────────────────────────────────────────────────


def test_a_malformed_accession_yields_no_identity_at_all():
    assert identity(1045810, "not-an-accession", primary_document="x.htm") is None
    assert filing_index_url(1045810, "not-an-accession") == ""
    assert archive_document_url(1045810, "not-an-accession", "x.htm") == ""


def test_an_invalid_cik_yields_no_identity():
    assert identity("nope", "0001045810-26-000023") is None


def test_a_traversing_document_name_is_dropped_not_interpolated():
    ident = identity(1045810, "0001045810-26-000023",
                     primary_document="../../etc/passwd.htm")
    assert ident is not None
    assert ident.primary_document == ""
    assert ident.primary_document_url == ""
    assert ident.unresolved_reason
    # The filing is still nameable — details survives.
    assert ident.filing_index_url.endswith("-index.htm")


def test_a_filing_with_no_primary_document_offers_details_only():
    ident = identity(1045810, "0001045810-26-000023", form_type="10-K")
    assert ident is not None
    assert not ident.has_primary
    assert ident.filing_index_url
    assert "primaryDocument" in ident.unresolved_reason


def test_a_url_from_another_accession_does_not_belong_to_this_filing():
    other = archive_document_url(1045810, "0001045810-25-000116", "nvda-20250727.htm")
    assert other
    assert not belongs_to_filing(other, 1045810, "0001045810-26-000023")


def test_a_url_from_another_registrant_does_not_belong_to_this_filing():
    aapl = archive_document_url(320193, "0000320193-25-000073", "aapl-20250927.htm")
    assert not belongs_to_filing(aapl, 1045810, "0000320193-25-000073")


def test_a_non_sec_host_never_belongs_to_a_filing():
    for url in [
        "https://evil.example/Archives/edgar/data/1045810/000104581026000023/x.htm",
        "http://www.sec.gov/Archives/edgar/data/1045810/000104581026000023/x.htm",
        "javascript:alert(1)",
        "",
    ]:
        assert not belongs_to_filing(url, 1045810, "0001045810-26-000023"), url


# ── Index URL as the only source (Phase 2) ────────────────────────────────


def test_an_index_url_yields_the_filing_identity_and_is_not_a_document():
    url = filing_index_url(1045810, "0001045810-26-000023")
    parsed = parse_archive_url(url)
    assert parsed == {
        "cik": 1045810,
        "accession": "0001045810-26-000023",
        "document": "",
        "is_index": True,
    }


def test_a_document_url_yields_the_same_identity_plus_the_document():
    url = archive_document_url(1045810, "0001045810-26-000023", "nvda-20260126.htm")
    parsed = parse_archive_url(url)
    assert parsed is not None
    assert parsed["cik"] == 1045810
    assert parsed["accession"] == "0001045810-26-000023"
    assert parsed["document"] == "nvda-20260126.htm"
    assert parsed["is_index"] is False


def test_a_truncated_archive_segment_is_refused_rather_than_reshaped():
    assert parse_archive_url(
        "https://www.sec.gov/Archives/edgar/data/1045810/00010458102600/x.htm"
    ) is None


def test_a_non_archive_url_has_no_filing_identity():
    for url in [
        "https://www.sec.gov/cgi-bin/browse-edgar?action=getcompany&CIK=NVDA",
        "https://data.sec.gov/api/xbrl/companyconcept/CIK0001045810/us-gaap/Revenues.json",
        "https://example.com/",
        "",
        None,
    ]:
        assert parse_archive_url(url) is None, url


# ── Submissions matching ──────────────────────────────────────────────────


def test_find_in_submissions_matches_the_exact_accession():
    doc = submissions(MATRIX[:4])
    row = find_in_submissions(doc, "0000320193-25-000073")
    assert row is not None
    assert row["form"] == "10-K"
    assert row["primary_document"] == "aapl-20250927.htm"


def test_find_in_submissions_refuses_an_accession_the_filer_never_filed():
    assert find_in_submissions(submissions(MATRIX[:4]), "0009999999-99-999999") is None


def test_short_columns_never_pair_an_accession_with_another_filings_document():
    """A malformed page drops its tail rather than mis-pairing."""
    doc = submissions(MATRIX[:3])
    doc["filings"]["recent"]["primaryDocument"] = ["nvda-20260126.htm"]
    assert find_in_submissions(doc, MATRIX[0][2])["primary_document"] == "nvda-20260126.htm"
    assert find_in_submissions(doc, MATRIX[1][2]) is None


def test_identity_from_submissions_carries_every_canonical_field():
    ident = identity_from_submissions(1045810, MATRIX[0][2], submissions(MATRIX[:2]))
    assert ident is not None
    assert ident.form_type == "10-K"
    assert ident.filing_date == "2026-02-25"
    assert ident.period_of_report == "2026-01-26"
    assert ident.primary_document == "nvda-20260126.htm"
    assert ident.accession_nodash == "000104581026000023"


# ── The resolver, over a fake SEC ─────────────────────────────────────────


@pytest.mark.asyncio
@pytest.mark.parametrize("row", MATRIX, ids=[f"{r[0]}-{r[3]}" for r in MATRIX])
async def test_resolver_returns_the_primary_document_sec_names(row):
    _, cik, accn, form, filed, period, doc, _ = row
    res, _fake = resolver_for(MATRIX)
    ident = await res.resolve(cik, accn)
    assert isinstance(ident, FilingIdentity)
    assert ident.primary_document == doc
    assert ident.form_type == form
    assert ident.filing_date == filed
    assert ident.period_of_report == period
    assert ident.primary_document_url != ident.filing_index_url


@pytest.mark.asyncio
async def test_one_registrant_costs_one_fetch_however_many_filings_are_asked_for():
    res, fake = resolver_for(MATRIX)
    for accn in ["0001045810-26-000023", "0001045810-25-000116"]:
        await res.resolve(1045810, accn)
    assert len(fake.calls) == 1


@pytest.mark.asyncio
async def test_an_unknown_accession_still_yields_an_exact_details_url():
    res, _ = resolver_for(MATRIX)
    ident = await res.resolve(1045810, "0009999999-99-999999")
    assert ident is not None
    assert ident.primary_document_url == ""
    assert ident.filing_index_url.endswith("0009999999-99-999999-index.htm")
    assert "not among" in ident.unresolved_reason


@pytest.mark.asyncio
async def test_a_network_failure_is_not_a_fabricated_url():
    class Dead:
        async def get(self, url, *a, **k):
            raise RuntimeError("connection reset")

    res = SecFilingResolver(http_client=Dead())
    ident = await res.resolve(1045810, "0001045810-26-000023")
    assert ident is not None
    assert ident.primary_document_url == ""
    assert ident.unresolved_reason == "submissions metadata unavailable"
    assert ident.filing_index_url


@pytest.mark.asyncio
async def test_a_caller_cannot_supply_the_primary_document_itself():
    """The filename comes from SEC or not at all — that is the whole rule."""
    res, _ = resolver_for(MATRIX)
    ident = await res.resolve(
        1045810, "0009999999-99-999999", primary_document="anything-i-like.htm"
    )
    assert ident is not None
    assert ident.primary_document == ""
    assert ident.primary_document_url == ""


@pytest.mark.asyncio
async def test_an_older_filing_is_found_on_the_archive_page():
    old = ("NVDA", 1045810, "0001045810-15-000006", "10-K", "2015-03-12",
           "2015-01-25", "nvda-20150125x10k.htm", "semiconductors")
    top = submissions(MATRIX[:2], cik=1045810,
                      files=[{"name": "CIK0001045810-submissions-001.json"}])
    page = submissions([old])["filings"]["recent"]
    res, fake = resolver_for([], extra_docs={
        sfr.SUBMISSIONS_URL.format(cik=1045810): top,
        sfr.SUBMISSIONS_PAGE_URL.format(name="CIK0001045810-submissions-001.json"): page,
    })
    ident = await res.resolve(1045810, old[2])
    assert ident is not None
    assert ident.primary_document == "nvda-20150125x10k.htm"
    assert len(fake.calls) == 2


@pytest.mark.asyncio
async def test_a_page_name_with_a_path_separator_is_never_fetched():
    top = submissions(MATRIX[:2], cik=1045810,
                      files=[{"name": "../../etc/passwd"}, {"name": 5}])
    res, fake = resolver_for([], extra_docs={
        sfr.SUBMISSIONS_URL.format(cik=1045810): top,
    })
    await res.resolve(1045810, "0009999999-99-999999")
    assert fake.calls == [sfr.SUBMISSIONS_URL.format(cik=1045810)]


@pytest.mark.asyncio
async def test_resolve_url_recovers_identity_from_a_legacy_index_url():
    res, _ = resolver_for(MATRIX)
    url = filing_index_url(320193, "0000320193-25-000073")
    ident = await res.resolve_url(url)
    assert ident is not None
    assert ident.primary_document == "aapl-20250927.htm"
    assert ident.form_type == "10-K"


@pytest.mark.asyncio
async def test_resolve_url_refuses_a_company_listing_url():
    res, _ = resolver_for(MATRIX)
    assert await res.resolve_url(
        "https://www.sec.gov/cgi-bin/browse-edgar?action=getcompany&CIK=AAPL"
    ) is None


# ── Enrichment of retrieval results ───────────────────────────────────────


class Passage:
    def __init__(self, metadata):
        self.metadata = metadata


@pytest.mark.asyncio
async def test_enrichment_fills_identity_on_every_matching_passage():
    res, fake = resolver_for(MATRIX)
    passages = [
        Passage({"cik": 1045810, "accn": "0001045810-26-000023"}),
        Passage({"cik": 1045810, "accn": "0001045810-26-000023"}),
        Passage({"cik": 320193, "accn": "0000320193-25-000073"}),
    ]
    await sfr.attach_filing_identity(passages, resolver=res)
    assert passages[0].metadata["primary_document"] == "nvda-20260126.htm"
    assert passages[1].metadata["primary_document"] == "nvda-20260126.htm"
    assert passages[2].metadata["primary_document"] == "aapl-20250927.htm"
    # One fetch per registrant, not per passage.
    assert len(fake.calls) == 2


@pytest.mark.asyncio
async def test_enrichment_leaves_a_passage_that_already_knows_its_document():
    res, fake = resolver_for(MATRIX)
    known = archive_document_url(1045810, "0001045810-26-000023", "already.htm")
    p = Passage({
        "cik": 1045810, "accn": "0001045810-26-000023",
        "primary_document": "already.htm", "primary_document_url": known,
    })
    await sfr.attach_filing_identity([p], resolver=res)
    assert p.metadata["primary_document"] == "already.htm"
    assert fake.calls == []


@pytest.mark.asyncio
async def test_enrichment_ignores_passages_with_no_filing_identity():
    res, fake = resolver_for(MATRIX)
    p = Passage({"text": "a prose chunk", "cik": None, "accn": ""})
    await sfr.attach_filing_identity([p], resolver=res)
    assert "primary_document" not in p.metadata
    assert fake.calls == []


@pytest.mark.asyncio
async def test_enrichment_failure_never_fails_the_search():
    class Dead:
        async def get(self, *a, **k):
            raise RuntimeError("down")

    res = SecFilingResolver(http_client=Dead())
    p = Passage({"cik": 1045810, "accn": "0001045810-26-000023"})
    out = await sfr.attach_filing_identity([p], resolver=res)
    assert out is not None
    assert p.metadata.get("primary_document_url", "") == ""
