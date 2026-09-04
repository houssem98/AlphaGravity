"""
An accession confers primary status only if it is an accession.

The rule it guards is deliberate and must survive: a citation carrying a REAL
accession came from a filing whatever anyone labelled it, so a sloppy
`source_class` cannot demote a genuine 10-K. That intent is sound. What was
missing is that nothing checked the value — `if c.get("accession")` accepted any
truthy string, so a `WEB_EVIDENCE` citation carrying `accession="invented"`
outranked the class system entirely.

The shape is fixed by EDGAR: ten digits (the filer's CIK-like prefix), two
digits (the year), six digits (the sequence), as `0000320193-25-000079`.

This file pins BOTH directions on purpose. Over-tightening here is the specific
regression the rubric's history warns about, and a test that only asserts the
new refusal would let a later loop close the rule entirely and still pass.
"""

from __future__ import annotations

import pytest

from eval.head_to_head.rubric import _is_primary


# ── The rule the fix must not break ───────────────────────────────────────


@pytest.mark.parametrize("field", ["accession", "accession_number"])
def test_a_real_accession_still_outranks_a_missing_class(field):
    """The rescue case: real accession, no class at all."""
    assert _is_primary([{"source_class": "", field: "0000320193-25-000079"}]) is True


@pytest.mark.parametrize("field", ["accession", "accession_number"])
def test_a_real_accession_still_outranks_a_wrong_class(field):
    """A genuine filing mislabelled `news` is still a filing."""
    assert _is_primary([{"source_class": "news",
                         field: "0001045810-25-000023"}]) is True


def test_the_undashed_eighteen_digit_accession_is_also_real():
    """
    Both forms circulate in this repo. `sec_filing_resolver.nodash()` and
    `ingestion/sources/earnings.py` both strip the dashes to build archive
    paths, so a citation can carry either. Validating only the dashed form
    would refuse genuine filings — the blindness this rubric already paid for
    once with the class names.
    """
    assert _is_primary([{"source_class": "news",
                         "accession": "000032019325000079"}]) is True


# ── T3: the value must actually be an accession ───────────────────────────


@pytest.mark.parametrize("bogus", [
    "invented",
    "totally-invented-value",
    "x",
    "true",
    "0000320193",                 # CIK alone, not an accession
    "0000320193-25",              # truncated
    "0000320193-25-00007",        # five sequence digits
    "000032019-25-000079",        # nine prefix digits
    "0000320193/25/000079",       # right digits, wrong separator
])
def test_a_fabricated_accession_does_not_confer_primary_status(bogus):
    assert _is_primary([{"source_class": "WEB_EVIDENCE",
                         "accession": bogus}]) is False


def test_a_bogus_accession_number_does_not_confer_primary_status():
    """The audit's measured case, verbatim: `news` + accession_number='x'."""
    assert _is_primary([{"source_class": "news",
                         "accession_number": "x"}]) is False


def test_a_bogus_accession_cannot_rescue_a_class_the_gate_refuses():
    """T1's fix must not be reopened through the accession door."""
    assert _is_primary([{"source_class": "LOCAL_EVIDENCE",
                         "accession": "not-an-accession"}]) is False


# ── Interaction with the rules either side of it ──────────────────────────


def test_a_bogus_accession_does_not_suppress_a_genuine_archives_url():
    """The URL rule is independent and must still fire."""
    cite = {"source_class": "news", "accession": "bogus",
            "url": "https://www.sec.gov/Archives/edgar/data/320193/x.htm"}
    assert _is_primary([cite]) is True


def test_a_bogus_accession_does_not_suppress_a_primary_class():
    cite = {"source_class": "sec_filing", "accession": "bogus"}
    assert _is_primary([cite]) is True
