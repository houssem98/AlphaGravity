"""
R8 QA-4 / roadmap §2.3 — an accession alone is not primary provenance.

`provenance()` describes the accession as "the discriminator", and it is the
ONLY discriminator: the gate is `valid_accession()`, which is a regex match.
Anything of the shape `##########-##-######` opens it, and `payload()` then
stamps `source_class: "SEC_EVIDENCE"` unconditionally. Measured before this
row, every one of these produced a full provenance object stamped
`SEC_EVIDENCE`:

    real Aflac 10-K metadata                          -> SEC_EVIDENCE
    accn 9999999999-99-999999, no issuer/cik/form     -> SEC_EVIDENCE
    a blog, accn 1234567890-12-123456                 -> SEC_EVIDENCE
    a web page, accn 1111111111-11-111111             -> SEC_EVIDENCE
    a news article quoting a real accession           -> SEC_EVIDENCE

**V33 — a well-formed accession is treated as proof of a filing.** The
docstring's own reasoning is that "a channel label is a claim about plumbing,
an accession is a claim about a document". True, but only if something checks
that the document exists: a fabricated accession is a claim about a document
that was never filed, and nothing distinguished the two.

QA-3 raised the stakes on this rather than creating it. Now that
`is_primary_class` is the single predicate, a `SEC_EVIDENCE` stamp confers
primacy in production AND in the benchmark, so whatever earns that stamp
wrongly is wrong in both places at once.

The failure mode roadmap §2.3 names for this row is the opposite one:
tightening it must not reject real citations. Every negative case below is
paired with a positive control drawn from real filing metadata.
"""

from __future__ import annotations

import pytest

from app.core.retrieval.citation_provenance import payload, provenance

REAL = {
    "accn": "0001628280-26-011402",
    "issuer": "Aflac Incorporated",
    "ticker": "AFL",
    "cik": "0000004977",
    "form": "10-K",
    "filed": "2026-02-25",
    "fiscal_year": "2025",
    "verification_status": "verified",
    "document_url": "https://www.sec.gov/Archives/edgar/data/4977/x.htm",
}


def _prov(**over):
    m = {**REAL, **over}
    return provenance(m, ticker=m.get("ticker") or "")


# ── The positive controls come first, deliberately ────────────────────────
#
# A tightening that rejects real citations has replaced one failure with a
# worse one, and roadmap §2.3 names that as this row's failure mode. These
# must stay green through any change to the rule.


def test_real_filing_metadata_is_primary():
    p = _prov()
    assert p is not None
    assert payload(p)["source_class"] == "SEC_EVIDENCE"


def test_a_real_filing_without_a_fiscal_year_is_still_primary():
    """Not every filing fact carries a period. Identity is the question here,
    not completeness."""
    assert _prov(fiscal_year=None) is not None


def test_a_real_filing_without_a_document_url_is_still_primary():
    assert _prov(document_url=None) is not None


# ── V33 — identity, not shape ─────────────────────────────────────────────


def test_v33_a_fabricated_accession_with_no_identity_is_not_primary():
    """
    `9999999999-99-999999` matches the accession pattern and names no filer,
    no form and no filing date. Nothing about it says a document exists.
    """
    assert _prov(accn="9999999999-99-999999", issuer=None, cik=None,
                 form=None, filed=None) is None


@pytest.mark.parametrize("source_class,issuer", [
    ("web", "example.com"),
    ("blog", "Some Blog"),
    ("news", "Reuters"),
    ("local_evidence", "corpus chunk"),
])
def test_v33_a_non_filing_source_cannot_buy_primacy_with_an_accession(
        source_class, issuer):
    """
    Roadmap §2.3's named negative cases. A citation that says it is a web page,
    a blog, a news article or a corpus chunk does not become a filing because
    an accession-shaped string travels with it.

    Note WHY each is refused: no CIK and no form, so no filer. The rule is not
    a veto on `source_class` — see
    `test_a_filing_that_also_carries_web_fields_is_still_a_filing` below, which
    is the case that made a class veto wrong.
    """
    assert _prov(accn="1234567890-12-123456", issuer=issuer, cik=None,
                 form=None, filed=None, source_class=source_class) is None


def test_v33_a_real_accession_quoted_by_a_news_article_is_not_primary():
    """
    The subtle one, and the reason shape cannot be the test: the accession here
    is REAL. It is Aflac's. The source is a news article that mentions it, and
    a citation to that article is evidence about the article.
    """
    assert _prov(issuer="Reuters", cik=None, form=None, filed=None,
                 source_class="news") is None


def test_v33_an_accession_without_a_filer_is_not_primary():
    """A filing is filed BY someone. An accession with no CIK and no issuer
    names a document nobody can be shown to have filed."""
    assert _prov(cik=None, issuer=None) is None


# ── The interaction that makes a class veto wrong ─────────────────────────


def test_a_filing_that_also_carries_web_fields_is_still_a_filing():
    """
    The first version of this rule vetoed any passage whose `source_class`
    declared itself non-filing, and it broke
    `test_web_citation_provenance.test_sec_wins_when_a_passage_somehow_carries_
    both`, which has asserted the opposite since round 2 and is right: an
    accession names a document that can be opened and audited, and a URL beside
    it does not weaken that.

    So the rule is coherent IDENTITY, not the declared label. Pinned here
    because the veto is the obvious-looking implementation and this is the case
    that rules it out.
    """
    p = _prov(source_class="WEB_EVIDENCE", web_evidence=True,
              url="https://www.reuters.com/x", domain="reuters.com")
    assert p is not None
    assert payload(p)["source_class"] == "SEC_EVIDENCE"


def test_a_filing_missing_only_its_form_is_still_primary():
    """Identity is filer plus when-or-what, not every field. A fact with a CIK
    and a filing date is attributable."""
    assert _prov(form=None) is not None


def test_a_filing_missing_only_its_date_is_still_primary():
    assert _prov(filed=None) is not None
