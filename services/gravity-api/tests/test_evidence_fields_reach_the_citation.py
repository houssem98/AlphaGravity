"""
E1 — the canonical evidence object's financial fields must reach the citation.

`citation_provenance.provenance()` describes itself as "the canonical evidence
object for one passage", and it is: 21 fields, including every financial one the
sixth audit asked a canonical object to carry. `payload()` is what
`search_pipeline` attaches to a citation — `citation.update(payload(_prov))` —
and it emitted identity and URLs only.

Measured on an Apple FY2025 revenue fact before this row:

    provenance()                        payload() -> the citation
      value            416161000000       DROPPED
      scope            'segment'          DROPPED
      unit             'USD'              DROPPED
      xbrl_concept     'RevenueFrom...'   DROPPED    <- the metric
      dimension        [...Axis]          DROPPED    <- the scope
      dimension_value  [...Member]        DROPPED    <- the segment
      period_start     '2024-09-29'       DROPPED
      period_end       '2025-09-27'       DROPPED
      fiscal_year      '2025'             DROPPED
      fiscal_quarter   None               DROPPED

Ten of ten. Only `fiscal_period` survived, as the rendered label "FY2025".

That is why `verdict_for_citation` and `eval/head_to_head/rubric.py` recover a
figure's metric, magnitude and period by running regexes over prose — and it is
the one sentence underneath V1, V14, V15, V19, U3, V12, V16, V17, V20 and V23.

**This row copies fields. It computes nothing.** A citation that carries no
provenance must keep carrying nothing: inventing fields for a prose chunk would
re-create the defect one layer higher, which is the whole reason the round
exists.
"""

from __future__ import annotations

import pytest

from app.core.retrieval.citation_provenance import payload, provenance
from app.core.retrieval.evidence_gate import encode_provenance

ACCN = "0000320193-25-000073"
CIK = "0000320193"
CONCEPT = "RevenueFromContractWithCustomerExcludingAssessedTax"

#: The financial half of the canonical object — the audit's list, minus the
#: fields `provenance()` legitimately does not hold on this path.
FINANCIAL_FIELDS = (
    "value", "unit", "xbrl_concept", "scope",
    "dimension", "dimension_value",
    "period_start", "period_end", "fiscal_year", "fiscal_quarter",
)


def meta(**over) -> dict:
    return {
        "accn": ACCN,
        "issuer": "Apple Inc.",
        "ticker": "AAPL",
        "cik": CIK,
        "form": "10-K",
        "filed": "2025-11-01",
        "fiscal_year": "2025",
        "fiscal_quarter": None,
        "period_start": "2024-09-29",
        "period_end": "2025-09-27",
        "tag": CONCEPT,
        "unit": "USD",
        "value": 416_161_000_000,
        "dimensions": [{"axis": "srt:ProductOrServiceAxis",
                        "member": "us-gaap:ProductMember"}],
        "verification_status": "verified",
        "document_url": "https://www.sec.gov/Archives/x.htm",
        "context_id": "c-42",
        **over,
    }


def _payload(**over) -> dict:
    return payload(provenance(meta(**over), ticker="AAPL"))


# ── The fields survive ────────────────────────────────────────────────────


@pytest.mark.parametrize("field", FINANCIAL_FIELDS)
def test_each_financial_field_reaches_the_citation(field):
    """Ten assertions, one per field, so a partial regression names itself."""
    assert field in _payload(), (
        f"{field!r} is held by provenance() and dropped by payload(), so the "
        f"citation reaching verdict_for_citation cannot be graded on it"
    )


def test_the_values_are_the_objects_own_and_not_re_derived():
    """
    The point of the row. A field that arrives with a re-parsed value would be
    the same defect wearing the fix's clothes.
    """
    prov = provenance(meta(), ticker="AAPL")
    p = payload(prov)
    for field in FINANCIAL_FIELDS:
        # `provenance()` drops keys whose value is None; `payload()` keeps the
        # shape stable and carries the None. Both readings of "absent" agree.
        assert p[field] == prov.get(field), field
    assert p["value"] == 416_161_000_000
    assert p["xbrl_concept"] == CONCEPT


def test_the_identity_and_link_fields_are_untouched():
    """
    `payload()` is a frontend contract. This row is additive; it may not rename
    or drop a key the browser already reads.
    """
    p = _payload()
    for field in ("source_class", "issuer", "cik", "form", "filing_date",
                  "fiscal_period", "accession", "accession_number",
                  "filing_url", "document_url", "source_url",
                  "evidence_location", "verification_status", "canonical_url",
                  "period_of_report", "primary_document", "view_filing_url",
                  "filing_details_url", "primary_unresolved_reason"):
        assert field in p, field
    assert p["source_class"] == "SEC_EVIDENCE"
    assert p["fiscal_period"] == "FY2025"


# ── And are not invented where there is no evidence ───────────────────────


def test_a_prose_passage_still_carries_nothing():
    """
    The guardrail this row is most likely to break. A passage with no accession
    has no provenance, and a citation that manufactures fields for it is worse
    than one that carries none.
    """
    assert payload(provenance({"text": "some prose about the company"})) == {}


def test_a_fact_missing_a_field_does_not_get_one_invented():
    """
    A consolidated fact names no segment. The keys may be present and empty;
    they may not be filled in with a guess.
    """
    p = _payload(dimensions=[])
    assert not p["dimension"]
    assert not p["dimension_value"]


# ── Both producers, because a citation must not depend on which asked ─────


def test_the_persisted_local_row_carries_the_same_fields():
    """
    The second ask of the same question is answered from the `financials` table
    rather than from SEC, and `rehydrate()` rebuilds the metadata shape. If the
    fields only survive on the live path, a citation's gradability depends on
    cache state, which is not a property anything should have.
    """
    stored = {
        "value_float": 416_161_000_000,
        "source_section": encode_provenance({
            "accn": ACCN, "cik": CIK, "issuer": "Apple Inc.",
            "concept": CONCEPT, "fy": "2025", "start": "2024-09-29",
            "end": "2025-09-27", "unit": "USD", "form": "10-K",
            "filed": "2025-11-01", "ver": "verified",
        }),
    }
    p = payload(provenance(stored, ticker="AAPL"))
    assert p["value"] == 416_161_000_000
    assert p["unit"] == "USD"
    assert p["xbrl_concept"] == CONCEPT
    assert p["period_start"] == "2024-09-29"
    assert p["period_end"] == "2025-09-27"


# ── E2: the scale question, answered by not adding a field ────────────────
#
# The audit's object lists `scale`, and it is the one field `provenance()` does
# not hold. The round's own row E2 proposed adding it as an explicit 1.
#
# It is not added, and these tests are why. A citation carries fields only when
# `provenance()` returns an object, and that requires a valid accession — which
# only the XBRL evidence gate produces. XBRL values are absolute: 416161000000,
# never 416161 under an `(in millions)` header. So `scale` on this path is the
# constant 1, and a constant field is a field every reader must check and no
# reader can learn anything from.
#
# The header-declared scale that V14 and V19 read is a property of PROSE, and
# prose carries no fields at all. Putting both under one name would make
# `scale` mean "the multiplier for a bare figure" in one place and "nothing,
# ignore me" in another, which is how the six vocabularies round 3 counted got
# started.
#
# If a producer of non-absolute values ever reaches a citation, the first test
# below fails and the decision is reopened with a case to look at.


@pytest.mark.parametrize("name,row", [
    # A table scrape: a real number, no accession, no gate contract.
    ("table scrape", {"value_float": 59_070.0, "unit": "USD",
                      "metric_name": "Operating revenue",
                      "source_section": "Results of Operations"}),
    # The legacy companyfacts backfill, which predates the gate.
    ("legacy backfill", {"value_float": 416_161.0, "unit": "USD",
                         "source_section": ""}),
    # Prose, including prose that declares a scale in a header.
    ("declared-scale prose",
     {"text": "(in millions) 2025 Operating revenue $ 59,070"}),
])
def test_no_producer_of_non_absolute_values_reaches_a_citation(name, row):
    """
    The accession is the gate, and it is what makes `scale` unnecessary. Every
    producer whose figures might carry an implied multiplier is stopped here,
    before it can put one on a citation.
    """
    assert payload(provenance(row, ticker="UAL")) == {}, name


def test_the_citation_carries_no_scale_field():
    """
    The decision, pinned so that adding one is a deliberate act rather than a
    reflex. If a fact whose value is NOT in base units ever reaches here, add
    `scale` — and delete this test in the same change, naming the fact.
    """
    assert "scale" not in _payload()
