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

**V28 — the parse itself is unchanged, and is NOT fixed here.** Footnote
markers still read as figures, and `(408)` still reads as POSITIVE 408 while
production's `_extract_numbers` returns -408 for the same text. V27 closed the
harm those cause on this fixture; it did not close them. Pinned below.
"""

from __future__ import annotations

import pytest

from app.core.verification.citation_verdict import (
    currency_of, declared_scale, declared_scales,
)
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


# ── V28 — the parse is still wrong. PINNED, NOT FIXED ─────────────────────


def test_v28_a_filing_footnote_marker_still_parses_as_a_number():
    """
    PINNED DEFECT. `(1)` and `(2)` are footnote references in a filing table,
    not quantities, and are still read as 1.0 and 2.0. V27 stopped the bind
    they caused here; it did not stop the parse, so a coincidence of the right
    magnitude could still produce one.

    Second assertion: `(408)` is read as POSITIVE 408, so this layer applies no
    accounting-negative convention at all — unlike
    `citation_verdict._extract_numbers`, which returns -408 for the same text.
    That divergence is recorded, not fixed.
    """
    assert 1.0 in {v for v, _ in _readings("Net earned premiums (1) $ 6,744")}, (
        "V28 moved: footnote markers no longer parse as figures. Delete this "
        "pin and assert the real behaviour."
    )
    assert 408.0 in {v for v, _ in _readings("net (408) (928)")}
    assert -408.0 not in {v for v, _ in _readings("net (408) (928)")}, (
        "V28 moved: the grader now reads accounting parentheses as negative. "
        "Delete this pin and reconcile it with `_extract_numbers`."
    )
