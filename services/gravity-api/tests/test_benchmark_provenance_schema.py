"""L11 / D11 — the benchmark key must resolve per case, not per substring.

`b777977` bound every filed `expect_value` to an accession, which was the right
first move and is still the fallback. But it binds by scanning one joined blob:

    prov = "\\n".join(CASES["provenance"])
    assert str(int(v)) in prov

That answers "do these digits appear somewhere in the provenance text". It does
not answer "which filing backs THIS case", which is the question an independent
key exists to answer. The digits of one company's revenue appearing inside
another company's entry, or inside an accession number, would satisfy it. So
would a record for the wrong fiscal year.

The prose is also uneven in a way only a schema exposes: of the eleven entries,
three name the us-gaap concept and eight do not, and none names a unit. A
reader cannot tell whether `AAPL FY2024 revenue 391035000000` came from
`Revenues` or `RevenueFromContractWithCustomerExcludingAssessedTax` — and for
Apple those are different numbers. That ambiguity is invisible in prose and
unmissable in a field.

What is asserted here is resolution and internal consistency, NOT that the
figures are correct — this suite has no network and the values are not
re-fetched. Nothing below invents a concept, a unit, or an accession that the
recorded source did not state; where the original prose recorded no concept,
the field is null and `test_the_concept_coverage_gap_is_visible` reports how
many, rather than a plausible guess being written in to make a column look
full.
"""

from __future__ import annotations

import json
import re
from pathlib import Path

CASES = json.loads(
    (Path(__file__).resolve().parents[1] / "eval" / "head_to_head" /
     "cases.json").read_text(encoding="utf-8")
)
BY_ID = {c["id"]: c for c in CASES["cases"]}

#: SEC accession: 10-digit filer, 2-digit year, 6-digit sequence.
_ACCESSION = re.compile(r"^\d{10}-\d{2}-\d{6}$")

#: Cases whose expectation is computed from two records rather than filed as
#: one. They must still resolve — to both endpoints.
DERIVED = {"aapl-fy2025-growth", "nvda-fy2026-growth", "odfl-fy2025-decline"}


def _records() -> list[dict]:
    return CASES.get("provenance_records", [])


# ── the schema exists and is well formed ──────────────────────────────────


def test_the_provenance_is_structured_not_only_prose():
    recs = _records()
    assert recs, (
        "cases.json carries no `provenance_records`; the key is prose only, so "
        "no test can ask which filing backs which case"
    )


def test_every_record_carries_the_declared_fields():
    for r in _records():
        for field in ("ticker", "fiscal_period", "metric", "value",
                      "accession", "concept", "unit", "period_end", "supports"):
            assert field in r, f"{r.get('ticker')} {r.get('fiscal_period')}: no {field!r}"


def test_every_accession_is_a_real_accession_number():
    """A malformed accession cannot be looked up, so it is not provenance."""
    for r in _records():
        assert _ACCESSION.match(str(r["accession"])), (
            f"{r['ticker']} {r['fiscal_period']}: {r['accession']!r} is not an "
            "SEC accession number"
        )


def test_every_value_is_an_exact_integer_of_currency():
    for r in _records():
        assert isinstance(r["value"], int), (
            f"{r['ticker']} {r['fiscal_period']}: value {r['value']!r} is not an "
            "exact integer; a float key cannot be compared exactly"
        )


def test_every_period_end_is_a_date():
    for r in _records():
        assert re.match(r"^\d{4}-\d{2}-\d{2}$", str(r["period_end"])), (
            f"{r['ticker']} {r['fiscal_period']}: period_end {r['period_end']!r}"
        )


# ── every filed expectation resolves to a record ──────────────────────────


def test_every_filed_expectation_resolves_to_exactly_one_record():
    """L11's requirement. Resolution by identity, not by substring."""
    for case in CASES["cases"]:
        cid = case["id"]
        if case.get("expect_value") is None or cid in DERIVED:
            continue
        backing = [r for r in _records() if cid in r["supports"]]
        assert len(backing) == 1, (
            f"{cid}: {len(backing)} provenance records claim to back it; "
            "exactly one filing states a filed figure"
        )
        assert backing[0]["value"] == case["expect_value"], (
            f"{cid}: expects {case['expect_value']} but its record "
            f"({backing[0]['accession']}) states {backing[0]['value']}"
        )


def test_each_derived_case_resolves_to_both_of_its_endpoints():
    """A growth rate needs two filings, and both must be named."""
    for cid in DERIVED:
        backing = [r for r in _records() if cid in r["supports"]]
        assert len(backing) == 2, (
            f"{cid} is computed from two figures but {len(backing)} records "
            "back it; a derived key with one endpoint is unfalsifiable"
        )
        periods = {r["fiscal_period"] for r in backing}
        assert len(periods) == 2, f"{cid}: both records are {periods}"


def test_a_derived_expectation_recomputes_from_its_own_records():
    """
    The endpoints are not decoration. The recorded growth must follow from the
    two records that claim to back it, or one of the three is wrong.
    """
    for cid in DERIVED:
        backing = sorted((r for r in _records() if cid in r["supports"]),
                         key=lambda r: r["period_end"])
        prior, current = backing[0], backing[1]
        got = round((current["value"] / prior["value"] - 1) * 100, 4)
        assert abs(got - BY_ID[cid]["expect_value"]) < 1e-3, (
            f"{cid}: records give {got}, case claims {BY_ID[cid]['expect_value']}"
        )


def test_no_record_claims_a_case_that_does_not_exist():
    """A link to a nonexistent case id is a broken key, not a stale one."""
    filed = {c["id"] for c in CASES["cases"] if c.get("expect_value") is not None}
    for r in _records():
        unknown = set(r["supports"]) - filed
        assert not unknown, (
            f"{r['ticker']} {r['fiscal_period']} claims to back {unknown}, which "
            "are not filed cases"
        )


def test_the_unused_records_are_pinned_rather_than_assumed_absent():
    """
    Two entries in the original prose back no case: MSFT FY2025 and CPRT FY2024
    are prior-year figures for companies that have no growth case. They are not
    wrong and are not deleted — a recorded filing is evidence whether or not a
    case currently reads it, and deleting them would quietly shrink the key.

    The count is pinned so that a case added later without its provenance, or a
    record added that nothing reads, shows up as a change instead of passing
    unnoticed.
    """
    unused = sorted(f"{r['ticker']} {r['fiscal_period']}"
                    for r in _records() if not r["supports"])
    assert unused == ["CPRT FY2024", "MSFT FY2025"], (
        f"the set of unread provenance records changed: {unused}"
    )


# ── the structured form must agree with the prose it replaces ─────────────


def test_the_records_agree_with_the_prose_fallback():
    """
    The prose list stays as the fallback L11 asks for. Two copies of one fact
    drift; this is what stops them.
    """
    prose = "\n".join(CASES["provenance"])
    for r in _records():
        assert str(r["value"]) in prose, (
            f"{r['ticker']} {r['fiscal_period']}: value {r['value']} is in the "
            "records but not in the prose list"
        )
        assert r["accession"] in prose, (
            f"{r['accession']} is in the records but not in the prose list"
        )


def test_the_prose_and_the_records_describe_the_same_number_of_facts():
    assert len(_records()) == len(CASES["provenance"]), (
        "the structured records and the prose list have drifted apart"
    )


# ── the gaps are reported, not papered over ───────────────────────────────


def test_the_concept_coverage_gap_is_visible():
    """
    The original prose named a us-gaap concept for only some entries. That gap
    is real and is recorded as null rather than guessed: for Apple, `Revenues`
    and `RevenueFromContractWithCustomerExcludingAssessedTax` are different
    figures, so inventing one would put a false fact in the key.

    This test does not demand full coverage. It demands that whatever coverage
    exists is stated, so the gap can be closed deliberately from the filings
    rather than discovered later by someone trusting the column.
    """
    recs = _records()
    named = [r for r in recs if r["concept"]]
    for r in recs:
        assert r["concept"] is None or isinstance(r["concept"], str)
        if r["concept"]:
            assert r["concept"][0].isupper(), (
                f"{r['concept']!r} is not a us-gaap concept name"
            )
    assert named, "no record names its concept at all"


def test_no_record_invents_a_unit_it_cannot_support():
    """Every figure here is a currency amount from a USD filing."""
    for r in _records():
        assert r["unit"] in ("USD", None), (
            f"{r['ticker']} {r['fiscal_period']}: unit {r['unit']!r}"
        )
