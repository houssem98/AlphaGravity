"""
The adversarial pass: feed each layer the wrong thing and require a true answer.

Phase 17 of the specification. Each test states an attack and the honest
outcome. Nothing here checks that a component "handles" bad input gracefully —
graceful handling that returns a plausible wrong answer is the failure. The
requirement is that the result is TRUE: an invented URL, a fabricated figure, a
confident future-period answer and a verified-but-unsupported citation are all
worse than an empty result.

The attacks, by surface:

  SEC identity     wrong accession · wrong CIK · exhibit · index-as-primary ·
                   traversal · non-SEC host · scheme downgrade · company listing
  Entity           ambiguous mention · unknown company · empty mention
  Company          missing metric · dead provider · empty provider
  Sentiment        thin text · balanced text · dead provider · market proxy
  Time             future year · future quarter · unfiled past period
  Verification     provenance transform overwriting a computed verdict
"""

from __future__ import annotations

from datetime import date

import pytest

from app.core.retrieval import sec_filing_resolver as sfr
from app.core.retrieval.citation_provenance import filing_links, payload, provenance
from app.core.skills import company_skill, entity as entity_layer, sentiment_skill
from app.core.skills import period as period_layer
from app.core.skills.contract import SkillRequest, SkillStatus

from tests.test_skill_company_sentiment import (  # reuse the injected channels
    DeadChannel, EmptyChannel, FakeResolved, FakeResolver, NEGATIVE, POSITIVE,
    ProseChannel, UNSEEN, resolver_for, sec_meta,
)

TODAY = date(2026, 8, 29)
CIK, ACCN = 1045810, "0001045810-26-000023"
DIR = f"https://www.sec.gov/Archives/edgar/data/{CIK}/000104581026000023"


# ── SEC identity ──────────────────────────────────────────────────────────


@pytest.mark.parametrize("attack,url", [
    ("another accession", f"https://www.sec.gov/Archives/edgar/data/{CIK}/"
                          "000104581025000116/nvda-20250727.htm"),
    ("another registrant", "https://www.sec.gov/Archives/edgar/data/320193/"
                           "000032019325000073/aapl-20250927.htm"),
    ("scheme downgrade", f"http://www.sec.gov/Archives/edgar/data/{CIK}/"
                         "000104581026000023/nvda-20260126.htm"),
    ("lookalike host", f"https://sec.gov.evil.example/Archives/edgar/data/{CIK}/"
                       "000104581026000023/nvda-20260126.htm"),
    ("company listing", "https://www.sec.gov/cgi-bin/browse-edgar?action=getcompany&CIK=NVDA"),
    ("javascript", "javascript:alert(1)"),
    ("data uri", "data:text/html,<script>1</script>"),
    ("the index itself", f"{DIR}/{ACCN}-index.htm"),
    ("an XBRL instance", f"{DIR}/nvda-20260126_htm.xml"),
    ("a spreadsheet", f"{DIR}/Financial_Report.xlsx"),
])
def test_no_wrong_document_is_ever_offered_as_view_filing(attack, url):
    p = payload(provenance({
        "accn": ACCN, "cik": CIK, "form": "10-K",
        "primary_document_url": url,
    }, ticker="NVDA"))
    assert p["view_filing_url"] == "", attack
    # The filing is still nameable, so the honest fallback survives.
    assert p["filing_details_url"].endswith(f"{ACCN}-index.htm")
    assert p["primary_unresolved_reason"]


@pytest.mark.parametrize("name", [
    "../../../etc/passwd.htm", "..%2f..%2fx.htm", "dir/nested.htm",
    "https://evil.example/x.htm", "nvda\n.htm", "", " ",
])
def test_no_document_name_escapes_the_archive_directory(name):
    ident = sfr.identity(CIK, ACCN, primary_document=name)
    assert ident is not None
    assert ident.primary_document_url == ""
    assert ".." not in ident.filing_index_url
    assert ident.filing_index_url.startswith(f"{DIR}/")


@pytest.mark.parametrize("accn", [
    "0001045810-26-00002", "0001045810260000233", "0001045810-26-000023\n",
    "abcdefghij-26-000023", "0001045810-26-000023/../x", "", None,
])
def test_a_malformed_accession_produces_no_url_at_all(accn):
    assert sfr.filing_index_url(CIK, accn) == ""
    assert sfr.identity(CIK, accn) is None
    assert provenance({"accn": accn, "cik": CIK}) is None


def test_a_wrong_cik_with_a_real_accession_names_a_different_filing():
    """Both are well-formed. They must not be treated as the same document."""
    a = sfr.filing_index_url(CIK, ACCN)
    b = sfr.filing_index_url(320193, ACCN)
    assert a and b and a != b
    assert not sfr.belongs_to_filing(a, 320193, ACCN)


@pytest.mark.asyncio
async def test_a_caller_cannot_smuggle_a_primary_document_past_the_resolver():
    class Fake:
        async def get(self, url, *a, **k):
            class R:
                status_code = 200

                @staticmethod
                def json():
                    return {"filings": {"recent": {
                        "form": ["10-K"], "accessionNumber": [ACCN],
                        "primaryDocument": ["nvda-20260126.htm"],
                        "filingDate": ["2026-02-25"], "reportDate": ["2026-01-26"],
                    }, "files": []}}
            return R()

    res = sfr.SecFilingResolver(http_client=Fake())
    ident = await res.resolve(CIK, ACCN, primary_document="attacker-chosen.htm")
    assert ident is not None
    # SEC's answer wins; the caller's is discarded, not merged.
    assert ident.primary_document == "nvda-20260126.htm"


def test_an_empty_provenance_object_produces_no_links_rather_than_a_guess():
    links = filing_links({})
    assert links == {
        "view_filing_url": "", "filing_details_url": "",
        "primary_document": "", "unresolved_reason": "filing has no valid CIK and accession",
    }


# ── Entity ────────────────────────────────────────────────────────────────


@pytest.mark.asyncio
async def test_a_coin_flip_between_two_registrants_is_never_resolved_silently():
    resolver = FakeResolver({"apple": FakeResolved(
        "AAPL", "320193", "Apple Inc.", 0.95, "fuzzy_name",
        alternatives=[{"ticker": "APLE", "name": "Apple Hospitality REIT", "score": 0.93}],
    )})
    ent = await entity_layer.resolve("Apple", resolver=resolver)
    assert ent.status is entity_layer.EntityStatus.AMBIGUOUS
    assert ent.ticker == ""          # nothing usable is handed out
    assert ent.company_id == ""


@pytest.mark.asyncio
@pytest.mark.parametrize("mention", ["", "   ", "Wobblegonk Industries Plc", "??????"])
async def test_an_unresolvable_mention_never_becomes_a_company(mention):
    ent = await entity_layer.resolve(mention, resolver=FakeResolver({}))
    assert ent.status is entity_layer.EntityStatus.UNKNOWN
    assert ent.ticker == ""


# ── Time ──────────────────────────────────────────────────────────────────


@pytest.mark.parametrize("period", ["FY2030", "Q4 2029", "FY2027", "Q1 2027"])
@pytest.mark.asyncio
async def test_no_future_period_produces_a_figure(period):
    facts = type("C", (), {"calls": 0, "search": None})()
    out = await company_skill.run(
        SkillRequest(skill="company", entities=["CPRT"], period=period),
        facts_search=DeadChannel(), resolver=resolver_for(UNSEEN), as_of=TODAY,
    )
    assert out.status is SkillStatus.INSUFFICIENT_DATA
    assert out.data.get("financials") in (None, {})
    assert all(c.kind != "reported" for c in out.claims)


def test_a_past_period_the_filer_never_filed_is_not_claimed_as_reported():
    v = period_layer.evaluate("Q2 2026", fy_end_month=12,
                              reported_periods={(2026, 1)}, as_of=TODAY)
    assert v.state is period_layer.PeriodState.NOT_YET_FILED
    assert v.must_abstain


def test_a_future_verdict_cannot_be_flipped_by_repetition():
    """The retrieval-dependent coin flip this replaces."""
    states = {period_layer.evaluate("FY2030", fy_end_month=12, as_of=TODAY).state
              for _ in range(500)}
    assert states == {period_layer.PeriodState.NOT_YET_ENDED}


# ── Company: fabrication ──────────────────────────────────────────────────


@pytest.mark.asyncio
async def test_a_dead_provider_never_becomes_a_company_with_no_financials():
    out = await company_skill.run(
        SkillRequest(skill="company", entities=["AOS"]),
        facts_search=DeadChannel(), resolver=resolver_for(UNSEEN), as_of=TODAY,
    )
    assert out.status is SkillStatus.ERROR
    assert out.degraded_channels
    # The distinction the whole phase exists for.
    assert not any("does not report" in l.lower() for l in out.limitations)


@pytest.mark.asyncio
async def test_an_empty_provider_is_reported_as_absence_not_as_failure():
    out = await company_skill.run(
        SkillRequest(skill="company", entities=["AOS"]),
        facts_search=EmptyChannel(), resolver=resolver_for(UNSEEN), as_of=TODAY,
    )
    assert out.status is SkillStatus.INSUFFICIENT_DATA
    assert not out.degraded_channels


@pytest.mark.asyncio
async def test_no_absent_metric_is_ever_rendered_as_a_number():
    out = await company_skill.run(
        SkillRequest(skill="company", entities=["ODFL"]),
        facts_search=EmptyChannel(), resolver=resolver_for(UNSEEN), as_of=TODAY,
    )
    for claim in out.claims:
        if claim.kind == "absent":
            assert claim.value is None
            assert "0" not in claim.text.split("is not reported")[0]
    assert out.data["financials"] == {}


# ── Sentiment: fabrication ────────────────────────────────────────────────


@pytest.mark.asyncio
async def test_a_dead_provider_never_becomes_neutral_sentiment():
    out = await sentiment_skill.run(
        SkillRequest(skill="sentiment", entities=["WSO"]),
        text_search=DeadChannel(), resolver=resolver_for(UNSEEN), as_of=TODAY,
    )
    assert out.status is SkillStatus.ERROR
    assert "overall" not in out.data
    assert "overall_score" not in out.data


@pytest.mark.asyncio
async def test_one_sentence_never_becomes_a_sentiment_reading():
    out = await sentiment_skill.run(
        SkillRequest(skill="sentiment", entities=["EXPD"]),
        text_search=ProseChannel("EXPD", "746515", "Revenue grew.", n=1),
        resolver=resolver_for(UNSEEN), as_of=TODAY,
    )
    assert out.status is SkillStatus.INSUFFICIENT_DATA
    assert "overall_score" not in out.data


@pytest.mark.asyncio
async def test_sentiment_evidence_always_points_at_a_citation_that_exists():
    for tone in (POSITIVE, NEGATIVE, POSITIVE + NEGATIVE):
        out = await sentiment_skill.run(
            SkillRequest(skill="sentiment", entities=["TPL"]),
            text_search=ProseChannel("TPL", "1811074", tone),
            resolver=resolver_for(UNSEEN), as_of=TODAY,
        )
        for key in ("positive_evidence", "negative_evidence", "neutral_evidence"):
            for e in out.data.get(key, []):
                assert 0 <= e["citation"] < len(out.citations)


# ── Verification: the overwrite ───────────────────────────────────────────


def test_a_provenance_transform_cannot_overwrite_a_computed_verdict():
    """
    The Phase-11 invariant, at the exact call site.

    `payload()` carries a `verification_status` of its own — "was this FILING
    verified against the filer" — which is a different question from "does this
    source support this claim". A citation dict that is `.update()`d with the
    payload must not come out claiming the verdict it never earned.
    """
    citation = {
        "verification_status": "unsupported",
        "is_verified": False,
        "verification_reasons": ["period_mismatch"],
    }
    verdict_status = citation["verification_status"]

    prov = provenance({
        "accn": ACCN, "cik": CIK, "form": "10-K",
        "primary_document": "nvda-20260126.htm",
        "verification_status": "verified",     # the FILING is verified
    }, ticker="NVDA")
    citation.update(payload(prov))

    # The transform did overwrite it — which is why the pipeline re-applies the
    # verdict last. Pin both halves: that the hazard is real, and that the
    # re-application is what restores truth.
    assert citation["verification_status"] == "verified"     # the hazard
    filing_status = citation["verification_status"]
    if filing_status != verdict_status:
        citation["filing_verification_status"] = filing_status
    citation["verification_status"] = verdict_status
    citation["is_verified"] = verdict_status == "verified"

    assert citation["verification_status"] == "unsupported"
    assert citation["is_verified"] is False
    assert citation["filing_verification_status"] == "verified"
    assert citation["verification_reasons"] == ["period_mismatch"]


def test_the_pipeline_reapplies_the_verdict_after_the_provenance_update():
    """The guard above is not hypothetical — assert it exists in the source."""
    import inspect

    from app.core import search_pipeline

    src = inspect.getsource(search_pipeline)
    i = src.find("citation.update(citation_provenance.payload(_prov))")
    assert i != -1, "the provenance update moved; this guard must move with it"
    after = src[i:i + 2500]
    assert 'citation["verification_status"] = _verdict.status' in after
    assert 'citation["is_verified"] = _verdict.is_verified' in after


def test_a_verified_filing_does_not_make_an_unsupported_claim_verified():
    """`is_verified` is the claim verdict and nothing else.

    R8 QA-4 added `"form"` to this metadata. The stub carried an accession and
    a CIK only, and `provenance()` now also requires a form or a filing date --
    a passage that cannot say what was filed, or when, is not shown to name a
    real filing. Nothing about this test's subject changed: it is about
    `is_verified` never leaking out of a payload, and both assertions below are
    untouched. The sibling test twelve lines above already passed `"form"` for
    the same accession, which is the realistic shape.
    """
    p = payload(provenance({
        "accn": ACCN, "cik": CIK, "form": "10-K",
        "verification_status": "verified",
    }, ticker="NVDA"))
    # The payload states the FILING's status under its own name, and carries no
    # `is_verified` of its own to leak into the citation.
    assert p["verification_status"] == "verified"
    assert "is_verified" not in p
