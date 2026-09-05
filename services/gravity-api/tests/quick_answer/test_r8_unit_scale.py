"""
R8 QA-2 / roadmap §8 — unit, scale and currency, on the first real
multi-currency filing table this repository has had.

`AFL_JAPAN_OPERATIONS` is verbatim from Aflac's 2026 10-K, accession
`0001628280-26-011402`, held on disk:

    Aflac Japan Summary of Operating Results
    In Dollars        In Yen
    (In millions of dollars and billions of yen)
                                2025    2024     2025    2024
    Net earned premiums (1)   $ 6,744 $ 6,930   ¥ 1,009 ¥ 1,050

`$6,744 million` and `¥1,009 billion` are the same quantity at the 149.32
yen/dollar rate the table also states, so the fixture carries its own
arithmetic check.

**V25 — a header may declare more than one scale.** `declared_scale` returns a
single float and took the first match, so this header resolved to `1e6` while
its yen column is in billions. Measured before the fix:

    ¥1,009 billion  (the filing's own figure)   ->  refused
    ¥1,009 million  (wrong by a factor of 1000) ->  bound

Exactly inverted, on real SEC text — V14 and V19's class a third time, invisible
to the three earlier fixtures because each declared exactly one scale.
`declared_scales` now returns `{"USD": 1e6, "JPY": 1e9}` and the claim's own
currency picks the entry.

**V26 — currency was never compared.** Nothing in the binding path looked at
`$` against `¥`, so any figure whose digits agreed bound regardless of currency.
Both sides must now name a currency for the check to fire, which keeps it
one-directional: it refuses a claim naming the wrong currency and never invents
one for a claim that names none.

**V27 — a scaled reading cannot add precision the source never wrote.**
`(1)` in `Net earned premiums (1)` parses to the number 1.0. Under a billions
header, `1.0 x 1e9` sat inside the 1% tolerance of `¥1,009 billion`, so the
thousandfold-wrong yen claim bound through a different door than V25 — a
spurious FIGURE rather than a wrong multiplier, which is why V25's fix could
not reach it. Measured before the fix:

    ¥1,009 million  (wrong by a factor of 1000)  ->  bound

`_matches` now refuses to apply a scale when the source reading carries fewer
significant digits than the claim: `1` is not a measurement of `1,009`, however
close a multiplication brings it.

**V28 — the grader read accounting parentheses as positive.** `(408)` is
negative 408 in a filing, and `nli_verifier._parse_financial_number` has always
read it that way on the production side, but `_readings` returned +408 for the
same text. Two layers, one text, opposite signs. `_readings` now applies
production's own rule — an opening paren before the figure and a closing one
after make it negative — and emits the negative reading INSTEAD of the positive
rather than alongside it, because the notation is attached to that token and is
not a cue about the sentence.

**V29 — the footnote marker is still parsed as a figure, and is NOT fixed
here.** `(1)` now reads as -1.0 rather than 1.0. It is still not a quantity.
V27 blocked the harm it caused on this fixture and V28 changed its sign;
neither stopped the parse. Pinned below, with no demonstrated harm attached to
it, which is why it is recorded rather than fixed.
"""

from __future__ import annotations

import pytest

from app.core.verification.citation_verdict import (
    currency_of, declared_scale, declared_scales,
)
from app.core.verification.nli_verifier import _extract_numbers
from eval.head_to_head.rubric import _claim_is_bound, _readings, _sigdigits
from tests.real_sec_fixtures import (
    AFL_JAPAN_OPERATIONS, LYV_DEFERRED, UAL_RESULTS,
)

CITE = [AFL_JAPAN_OPERATIONS]


# ── The fixture is what it claims to be ───────────────────────────────────


def test_the_fixture_carries_both_currencies_for_one_metric():
    """Without this, everything below could be testing a table that lost its
    yen column to an encoding accident between EDGAR and here."""
    t = AFL_JAPAN_OPERATIONS["text"]
    assert "$ 6,744" in t
    assert "¥ 1,009" in t
    assert "In millions of dollars and billions of yen" in t


# ── V25 — one header, two scales ──────────────────────────────────────────


def test_v25_the_header_declares_a_scale_per_currency():
    assert declared_scales("(In millions of dollars and billions of yen)") == {
        "USD": 1e6, "JPY": 1e9}


def test_v25_an_ordinary_single_scale_header_is_unchanged():
    """The other three fixtures declare one scale for no particular currency,
    and must keep resolving through the unkeyed entry."""
    assert declared_scales(UAL_RESULTS["text"]) == {"": 1e6}
    assert declared_scales(LYV_DEFERRED["text"]) == {"": 1e3}
    assert declared_scale(UAL_RESULTS["text"]) == 1e6


def test_v25_the_correct_yen_reading_now_binds():
    """`¥1,009` under a header declaring billions for yen is ¥1,009 billion —
    the filing's own figure. Before the fix this was refused."""
    assert _claim_is_bound(
        "Aflac Japan net earned premiums were ¥1,009 billion in 2025 [1].",
        CITE) is True


def test_v25_the_dollar_column_still_binds():
    assert _claim_is_bound(
        "Aflac Japan net earned premiums were $6,744 million in 2025 [1].",
        CITE) is True


# ── V26 — currency is part of the comparison ──────────────────────────────


@pytest.mark.parametrize("claim", [
    "Aflac Japan net earned premiums were €6,744 million in 2025 [1].",
    "Aflac Japan net earned premiums were £6,744 million in 2025 [1].",
])
def test_v26_a_foreign_currency_no_longer_binds_a_dollar_figure(claim):
    """The digits agree with the dollar column and the currency does not.
    Roadmap §8.3 requires this to fail; before the fix it bound."""
    assert _claim_is_bound(claim, CITE) is False


def test_v26_a_claim_naming_no_currency_is_not_penalised():
    """One-directional, deliberately. A sentence that states no currency is not
    thereby wrong, which is the discipline the period and metric checks use."""
    assert _claim_is_bound(
        "United operating revenue was $59,070 million [1].",
        [UAL_RESULTS]) is True


def test_v26_a_sentence_naming_two_currencies_does_not_guess():
    """`currency_of` returns empty for a mixed sentence rather than picking
    one, so the check simply does not fire."""
    assert currency_of("revenue rose from $1 million to ¥200 million") == ""


# ── V27 — a scaled reading may not invent precision ───────────────────────


def test_v27_the_thousandfold_wrong_yen_claim_is_refused():
    """
    `¥1,009 million` is wrong by a factor of a thousand and bound before the
    fix, because the footnote marker `(1)` yields the reading 1.0 and under the
    yen column's billions scale `1.0 x 1e9` is 0.9% from the claimed `1.009e9`
    — inside the 1% tolerance.
    """
    assert _claim_is_bound(
        "Aflac Japan net earned premiums were ¥1,009 million in 2025 [1].",
        CITE) is False


def test_v27_a_precise_source_still_satisfies_a_rounded_claim():
    """One-directional. The guard refuses a COARSE source against a PRECISE
    claim, never the reverse — `$6.7 billion` is a fair reading of `6,744` in a
    millions table, and must stay bound."""
    assert _claim_is_bound(
        "Aflac Japan net earned premiums were $6.7 billion in 2025 [1].",
        CITE) is True


@pytest.mark.parametrize("value,want", [
    (1.0, 1), (1.009e9, 4), (59070.0, 4), (5.907e10, 4), (3582835.0, 7),
])
def test_v27_significant_digits_are_counted_from_the_magnitude(value, want):
    assert _sigdigits(value) == want


# ── V28 — accounting parentheses are negative, as production reads them ───


@pytest.mark.parametrize("text", [
    "net (408) (928)",
    "Net earned premiums (1) $ 6,744",
    "loss of (1,234) million",
    "revenue 5,000",
])
def test_v28_the_grader_and_production_read_the_same_signs(text):
    """
    The real assertion of this row: not that some rule was written, but that
    the two implementations now return the same numbers for the same text.
    Comparing against `_extract_numbers` itself means the grader cannot drift
    away from production without this failing.

    Scoped to accounting notation on purpose. The two layers do NOT agree on a
    prose parenthetical — see V30 below, where production is the wrong one.
    """
    assert ({v for v, _ in _readings(text)} & {408.0, -408.0, 1.0, -1.0,
                                               1234.0, -1234.0, 928.0, -928.0}
            == set(_extract_numbers(text)) & {408.0, -408.0, 1.0, -1.0,
                                              1234.0, -1234.0, 928.0, -928.0})


def test_v28_a_parenthesised_figure_is_negative_and_not_also_positive():
    """Replaces rather than adds. A figure the filing wrote as `(408)` is not
    evidence for a claim of positive 408, and leaving both readings in would
    have let it be."""
    got = {v for v, _ in _readings("Nonoperating expense, net (408) (928)")}
    assert -408.0 in got
    assert 408.0 not in got


def test_v28_an_ordinary_figure_is_untouched():
    got = {v for v, _ in _readings("revenue was 5,000")}
    assert 5000.0 in got
    assert -5000.0 not in got


# ── V29 — the footnote marker is still a figure. PINNED, NOT FIXED ────────


def test_v29_a_filing_footnote_marker_still_parses_as_a_number():
    """
    PINNED DEFECT. `(1)` and `(2)` are footnote references in a filing table,
    not quantities, and are still read as numbers — now -1.0 and -2.0, since
    V28 gave parenthesised figures their accounting sign.

    Nothing here demonstrates harm from it: V27's guard stops a one-digit
    reading from satisfying a precise claim, and the negative sign stops it
    matching a positive one. It is recorded because a spurious figure that has
    twice been caught by something else is still a spurious figure.
    """
    got = {v for v, _ in _readings("Net earned premiums (1) $ 6,744")}
    assert -1.0 in got, (
        "V29 moved: footnote markers no longer parse as figures. Delete this "
        "pin and assert the real behaviour."
    )
    assert 6744.0 in got


# ── V30 — production reads a prose parenthetical as negative. PINNED ──────


def test_v30_a_prose_aside_is_positive_in_both_layers():
    """
    V30, found by V28 rather than by inspection, and CLOSED.

    `nli_verifier._parse_financial_number` made a figure negative whenever an
    opening paren preceded it, without checking whether the currency symbol was
    inside the parens. A filing writes an accounting negative as `(408)` or
    `$(408)`, symbol outside; prose writes a restatement as
    `($416,161 million)`, symbol inside. Production read the second as
    -416,161 million -- a correct, positive answer turned into a wrong one, in
    the layer `citation_verdict` calls to decide support. Measured before the
    fix:

        _extract_numbers("Net sales ($416,161 million) for the year.")
          ->  [-416161000000.0]

    It surfaced because V28 adopted production's rule verbatim and two
    prior-round grader tests went red -- `test_a_lone_parenthetical_is_still_
    the_claim` and `test_a_parenthetical_that_is_the_only_claim_still_counts`.
    Both were right; production was not.
    """
    aside = "Net sales ($416,161 million) for the year."
    assert 416161e6 in set(_extract_numbers(aside))
    assert -416161e6 not in set(_extract_numbers(aside))
    assert 416161.0 in {v for v, _ in _readings(aside)}
    assert -416161.0 not in {v for v, _ in _readings(aside)}


def test_v30_the_accounting_form_is_negative_in_both_layers():
    """The half that does agree, so the pin cannot be read as `parens are
    always positive`."""
    for text in ("net (408) (928)", "loss of (1,234) million"):
        g = {v for v, _ in _readings(text)}
        p = set(_extract_numbers(text))
        assert g & {-408.0, -928.0, -1234.0} == p & {-408.0, -928.0, -1234.0}


# ── QA-13: V27's guard, isolated ──────────────────────────────────────────


def test_v27_the_guard_itself_refuses_a_coarse_reading():
    """
    R8 QA-13. The theatre audit reverted V27's guard and this FILE still
    passed, because V28 had since made `(1)` read as -1.0 — the spurious +1.0
    the guard was written against no longer exists in that fixture, so the
    fixture-level test had stopped isolating the guard.

    The rule is still real, so it gets an assertion that exercises it directly:
    a one-digit source reading scaled up cannot satisfy a four-digit claim,
    even though `1 x 1e9` sits 0.89% from `1.009e9` and inside the tolerance.

    There are TWO sig-digit guards, and QA-13's first pass only caught one of
    them: the declared-scale path checks it inside its own condition, the
    open-scale path checks it before the scale loop. Reverting either alone
    left this test green, so both are exercised here and the audit reverts both.
    """
    from eval.head_to_head.rubric import _matches
    # open-scale path: no declared header, the loop tries 1e3/1e6/1e9
    assert _matches(1.009e9, "1") is False
    assert _matches(1.009e9, "1,009") is True
    # declared-scale path: the header says billions
    assert _matches(1.009e9, "1", declared=1e9) is False
    assert _matches(1.009e9, "1,009", declared=1e6) is True
