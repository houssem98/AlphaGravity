"""
R8 QA-9 / roadmap §9, §10 — scope, segment and restatement.

**The `UNPROVEN` label, and what now backs it.** The owner decision for this row
was that restatement semantics are built against constructed evidence because
no amended filing exists here. That was recorded against 1,408 manifest rows.
This round measured the real corpus instead:

    chunks                       478,433
    chunks with an /A form             0
    distinct filing_type values       10   (10-K, 10-Q, 8-K, S-1, DEF 14A,
                                            4, 13F-HR, SC 13D,
                                            earnings_transcript, 'document')

Still zero. The `UNPROVEN` label stands, now on the whole corpus rather than on
a manifest. One real `10-K/A` in `data/filings*/` upgrades it without touching
the implementation.

The SCOPE half needs no such caveat: which scope a fact has is decided by its
XBRL dimension axes, which the taxonomy defines, so it is testable against real
axis names today.

**V36 — `payload()` drops `restated`, so a restated fact and an original one
produce byte-identical citations.** `provenance()` records it; the citation
never learns it. Measured before the fix:

    provenance restated flag   False / True
    payload has restated key   False / False
    payload identical?         True

**V37 — `scope` has two states where §9 names five.** It is
`"segment" if dims else "consolidated"`, so a geographic fact and a
discontinued-operations fact both come back `segment`:

    no dimensions                          -> consolidated
    business-segment axis                  -> segment
    geographic axis                        -> segment      (wrong)
    discontinued-operations member         -> segment      (wrong)

A discontinued operation is not a business segment, and an answer that cites
one for the other is wrong in a way nothing downstream could see.

**Out of scope, and recorded rather than forced:** §10 also asks that two
conflicting facts stay `CONFLICTING` rather than collapsing to `VERIFIED`.
Measured, `verdict_for_citation` resolves to the chunk the citation NAMES, so a
contradicting passage elsewhere in the retrieval set is never consulted — which
is right at citation level. That requirement belongs to the answer layer, not
here, and QA-12's status matrix is where it lands.
"""

from __future__ import annotations

import pytest

from app.core.retrieval.citation_provenance import payload, provenance

BASE = {
    "accn": "0000320193-25-000123",
    "issuer": "Apple Inc.",
    "cik": "0000320193",
    "form": "10-K",
    "filed": "2025-11-01",
    "tag": "us-gaap:Revenues",
    "unit": "USD",
    "value": 416_161_000_000,
}

SEGMENT = [{"axis": "us-gaap:StatementBusinessSegmentsAxis",
            "member": "aapl:AmericasSegmentMember"}]
GEOGRAPHIC = [{"axis": "srt:StatementGeographicalAxis", "member": "country:CN"}]
DISCONTINUED = [{"axis": "us-gaap:StatementScenarioAxis",
                 "member": "us-gaap:DiscontinuedOperationsMember"}]
CONTINUING = [{"axis": "us-gaap:StatementScenarioAxis",
               "member": "us-gaap:ContinuingOperationsMember"}]


def _prov(**over):
    return provenance({**BASE, **over}, ticker="AAPL")


# ── V37 — scope has the states §9 names ───────────────────────────────────


@pytest.mark.parametrize("dims,expected", [
    (None, "consolidated"),
    (SEGMENT, "segment"),
    (GEOGRAPHIC, "geographic"),
    (DISCONTINUED, "discontinued"),
    (CONTINUING, "continuing"),
])
def test_v37_scope_distinguishes_the_five_states(dims, expected):
    assert _prov(dimensions=dims)["scope"] == expected


def test_v37_a_discontinued_operation_is_not_a_segment():
    """The pair that matters. Both were `segment`, so an answer citing a
    discontinued operation for a business segment — or the reverse — was
    invisible to everything downstream."""
    assert _prov(dimensions=DISCONTINUED)["scope"] != _prov(
        dimensions=SEGMENT)["scope"]


def test_v37_an_unrecognised_axis_is_still_segment():
    """The fallback is unchanged: a dimensioned fact whose axis this does not
    recognise is still narrower than consolidated, and calling it `segment`
    claims less than inventing a new state for it would."""
    assert _prov(dimensions=[{"axis": "aapl:SomeCustomAxis",
                              "member": "aapl:X"}])["scope"] == "segment"


def test_v37_scope_survives_into_the_citation():
    assert payload(_prov(dimensions=GEOGRAPHIC))["scope"] == "geographic"


# ── V36 — the citation learns whether the fact was restated ───────────────


def test_v36_a_restated_fact_no_longer_looks_original():
    """Before the fix these two payloads were byte-identical."""
    assert payload(_prov(restated=True)) != payload(_prov(restated=False))


@pytest.mark.parametrize("meta,expected", [
    ({"restated": True}, "RESTATED"),
    ({"restated": False}, "ORIGINAL"),
    ({}, "UNKNOWN"),
    ({"form": "10-K/A"}, "AMENDED"),
    ({"form": "10-Q/A", "restated": False}, "AMENDED"),
])
def test_v36_restatement_status_has_four_states(meta, expected):
    """
    §9 names ORIGINAL / RESTATED / AMENDED / UNKNOWN. UNKNOWN is the one that
    matters most: `provenance` stored `bool(m.get("restated"))`, which made an
    absent flag indistinguishable from a positive statement that the fact was
    never restated. Absence of evidence was being recorded as evidence.

    AMENDED comes from the FORM, which is a fact about the filing rather than
    an assertion about the figure, and is therefore knowable even here where no
    /A filing exists to test against real data.
    """
    assert payload(_prov(**meta))["restatement_status"] == expected


def test_v36_unknown_is_not_original():
    """The specific collapse this fixes. A fact that says nothing about
    restatement must not be reported as positively original."""
    assert payload(_prov())["restatement_status"] == "UNKNOWN"
    assert payload(_prov(restated=False))["restatement_status"] == "ORIGINAL"


def test_v36_an_amended_form_outranks_a_false_flag():
    """A 10-K/A IS an amendment. A `restated: False` alongside it is a claim
    about one figure, not about the filing, and must not erase the form."""
    assert payload(_prov(form="10-K/A", restated=False))[
        "restatement_status"] == "AMENDED"
