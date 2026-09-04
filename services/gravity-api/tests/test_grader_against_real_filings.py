"""
The grader, run against real filing text rather than prose a test author wrote.

Every fixture here is verbatim from a filing in this repository's corpus. The
point is not to add coverage — it is that every rubric test before this one
validated the grader against sentences invented by whoever was fixing the bug,
which is R14's blind spot one level down: the gate was tested with
`{"source_class": "sec_filing"}`, a value the pipeline never emits, and passed.

**What real filings do that the invented fixtures did not.** Scale is declared
once in a table header and the figures are bare:

    (in millions) 2025 2024 2023 Operating revenue $ 59,070 $ 57,063

Every V1 test used `"$130 million"` — a unit welded to its number. Real filings
almost never do that in tables, so the case V1's fix must NOT break is the
common one, and the case it does break is the rarer one. These tests exist to
prove that distinction survives contact with the real thing.
"""

from __future__ import annotations

import pytest

from eval.head_to_head.rubric import (
    _asserts, _claim_is_bound, _entity_is_bound, _is_primary, _matches,
)
from tests.real_sec_fixtures import (
    ACCESSIONS, ALL_EXCERPTS, FDX_CAPEX, LYV_DEFERRED, UAL_RESULTS,
)


# ── Scale, against a real table that declares its unit in a header ────────


def test_a_bare_table_figure_still_scales_to_its_declared_unit():
    """
    `Operating revenue $ 59,070` in a table headed `(in millions)` is
    $59.07 billion. The figure carries no unit of its own, so the multiplier
    loop is the only thing that can read it — and V1 deliberately left that
    path open for exactly this shape.
    """
    assert _matches(59_070e6, UAL_RESULTS["text"]) is True


def test_the_same_figure_reads_correctly_at_its_face_value():
    """A case recorded in millions rather than base units."""
    assert _matches(59_070, UAL_RESULTS["text"]) is True


def test_a_thousands_denominated_table_also_scales():
    """Live Nation reports in thousands. `3,582,835` is $3.58 billion."""
    assert _matches(3_582_835e3, LYV_DEFERRED["text"]) is True


def test_a_figure_absent_from_a_real_filing_does_not_match():
    """The guard: scaling reads a number, it must not conjure one."""
    assert _matches(99_999e6, UAL_RESULTS["text"]) is False


@pytest.mark.parametrize("wrong", [
    "United Airlines operating revenue was $59,070 billion.",
    "United Airlines operating revenue was $59,070 thousand.",
])
def test_an_explicitly_wrong_unit_still_fails_against_a_real_filing(wrong):
    """
    V1, stated against real text. The filing says 59,070 in a millions table.
    An answer welding the wrong unit to that number is wrong by a factor of a
    thousand or more, and must not score correct.
    """
    assert _asserts(59_070e6, wrong) is False


def test_the_right_explicit_unit_still_passes():
    assert _asserts(59_070e6,
                    "United Airlines operating revenue was $59,070 million.") is True


# ── Claim binding, against a real multi-metric table ──────────────────────


def test_a_correct_claim_binds_against_the_real_table():
    assert _claim_is_bound(
        "United operating revenue was $59,070 million [1].",
        [UAL_RESULTS]) is True


def test_a_figure_belonging_to_another_metric_does_not_bind():
    """
    U3 against real prose. `54,356` is operating EXPENSE in this table. An
    answer claiming it as revenue must not bind, even though the number is
    genuinely present in the cited excerpt.
    """
    assert _claim_is_bound(
        "United operating revenue was $54,356 million [1].",
        [UAL_RESULTS]) is False


def test_a_prior_year_figure_from_the_same_table_still_binds():
    """
    The case a naive contradiction rule would break: the table carries three
    years of operating revenue, and 57,063 is one of them.
    """
    assert _claim_is_bound(
        "United operating revenue was $57,063 million [1].",
        [UAL_RESULTS]) is True


def test_citing_a_filing_that_does_not_contain_the_figure_does_not_bind():
    """
    V2 against real documents. FedEx's capex table carries no revenue figure,
    so an answer citing it for revenue has cited the wrong document.
    """
    assert _claim_is_bound(
        "Operating revenue was $59,070 million [1].",
        [FDX_CAPEX, UAL_RESULTS]) is False


def test_citing_the_correct_document_among_real_ones_binds():
    assert _claim_is_bound(
        "Operating revenue was $59,070 million [2].",
        [FDX_CAPEX, UAL_RESULTS]) is True


# ── Entity binding, against real issuer strings ───────────────────────────


@pytest.mark.parametrize("cite,token", [
    (UAL_RESULTS, "united airlines"),
    (LYV_DEFERRED, "live nation"),
    (FDX_CAPEX, "fedex"),
])
def test_a_real_issuer_string_binds_its_own_name(cite, token):
    assert _entity_is_bound(token, [cite]) is True


def test_a_real_issuer_string_does_not_bind_another_company():
    assert _entity_is_bound("fedex", [UAL_RESULTS]) is False


# ── Primary-source classification, against real citation records ──────────


@pytest.mark.parametrize("cite", ALL_EXCERPTS)
def test_every_real_sec_excerpt_counts_as_a_primary_filing(cite):
    """
    The R14 property, checked against records shaped like the pipeline's own
    output rather than against the literal string the grader hopes for.
    """
    assert _is_primary([cite]) is True


@pytest.mark.parametrize("ticker,accession", sorted(ACCESSIONS.items()))
def test_a_real_accession_is_accepted_by_the_validator(ticker, accession):
    """
    T3's format rule, checked against accessions taken from filings on disk
    rather than from an example in a docstring.
    """
    assert _is_primary([{"source_class": "", "accession": accession}]) is True
