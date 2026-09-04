"""
U1 — an accession rescues an UNKNOWN class. It may not overrule a DENIAL.

Round 3 narrowed this rule from "any truthy accession" to "a value shaped like
an accession" (T3). The fourth audit walked through what was left: a
well-formed accession still turns `WEB_EVIDENCE` into a primary filing, so the
class system can be bypassed by a string with the right number of digits.

The distinction that makes this fixable without breaking the rule is what the
`source_class` is *saying*:

    ""              no claim about provenance   -> the accession may rescue it
    "unknown"       no claim about provenance   -> the accession may rescue it
    "WEB_EVIDENCE"  this IS a web page          -> the accession may not overrule
    "news"          this IS a news article      -> the accession may not overrule

The rule was written to rescue a citation carrying a real accession whose class
was sloppy or missing, and that case is untouched here — it is the first two
lines, and both still bind. What is refused is an accession outranking a class
that positively asserts the source is not a filing.

**This is the same defect as T1, one door along.** Round 3's L1 stopped
`local_evidence` earning primary credit by class name. The accession rule sat
below it and let the same citation back in through a different field. T13
recorded that; this file closes it for the general case rather than the one
class L1 happened to test.

Note the deliberate limit: `FinalGate.check` reads `source_class` alone and has
never had this hole. Everything here is evaluator integrity, not a production
defect.
"""

from __future__ import annotations

import pytest

from eval.head_to_head.rubric import _is_primary

#: A real Apple 10-K accession. Genuine shape, so the T3 validator passes it.
REAL = "0000320193-25-000079"


# ── U1: a class that positively denies filing provenance ──────────────────


@pytest.mark.parametrize("cls", [
    "WEB_EVIDENCE", "web_evidence", "LOCAL_EVIDENCE", "local_evidence",
    "news", "web", "blog", "analyst", "earnings_call", "transcript",
])
@pytest.mark.parametrize("field", ["accession", "accession_number"])
def test_an_accession_cannot_make_a_declared_non_filing_primary(cls, field):
    assert _is_primary([{"source_class": cls, field: REAL}]) is False


def test_the_audits_exact_case():
    """`refix-r3.md`'s P1, verbatim."""
    assert _is_primary([{"source_class": "WEB_EVIDENCE",
                         "accession": REAL}]) is False


# ── The rescue the rule exists for, which must survive ────────────────────


@pytest.mark.parametrize("cite", [
    {"source_class": "", "accession": REAL},
    {"source_class": "   ", "accession": REAL},
    {"accession": REAL},                          # no class key at all
    {"source_class": "unknown", "accession": REAL},
    {"source_class": "misc", "accession": REAL},
])
def test_an_accession_still_rescues_a_class_that_makes_no_claim(cite):
    """
    Absent, blank, missing and unrecognised are all "we do not know", not "this
    is not a filing". A citation carrying a real accession and a class nobody
    filled in is exactly what the rule was written for.
    """
    assert _is_primary([cite]) is True


def test_a_class_that_is_already_primary_is_unaffected():
    assert _is_primary([{"source_class": "sec_filing", "accession": REAL}]) is True
    assert _is_primary([{"source_class": "SEC_EVIDENCE", "accession": REAL}]) is True


# ── Scope pins: what N1 deliberately does NOT change ──────────────────────


def test_the_archives_url_rule_is_unchanged_by_this_fix():
    """
    N1 bounds the ACCESSION rule only. The `sec.gov/Archives` URL rule is left
    alone on purpose: a web fetch of an SEC archive page is the filing itself,
    not a page about it, so the denial argument does not obviously apply.

    Pinned so that if a later loop decides otherwise, the change is visible
    here rather than silent.
    """
    cite = {"source_class": "WEB_EVIDENCE",
            "url": "https://www.sec.gov/Archives/edgar/data/320193/x.htm"}
    assert _is_primary([cite]) is True


def test_a_bogus_accession_is_still_refused_everywhere():
    """T3's fix must survive N1 unchanged."""
    assert _is_primary([{"source_class": "", "accession": "invented"}]) is False
    assert _is_primary([{"source_class": "news", "accession": "x"}]) is False


def test_one_good_citation_among_denied_ones_still_binds():
    """`_is_primary` is an ANY over the list; N1 must not change that."""
    cites = [{"source_class": "news", "accession": REAL},
             {"source_class": "sec_filing"}]
    assert _is_primary(cites) is True
