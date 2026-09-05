"""
R8 QA-2 / roadmap §8 — unit, scale and currency, on the first real
multi-currency filing table this repository has had.

`AFL_JAPAN_OPERATIONS` is verbatim from Aflac's 2026 10-K, accession
`0001628280-26-011402`, held on disk. It is the only genuinely multi-currency
table in the corpus and it closes three fixture dimensions at once:

    Aflac Japan Summary of Operating Results
    In Dollars        In Yen
    (In millions of dollars and billions of yen)
                              2025    2024     2025    2024
    Net earned premiums     $ 6,744 $ 6,930   ¥ 1,009 ¥ 1,050

`$6,744 million` and `¥1,009 billion` are the same quantity at the 149.32
yen/dollar rate the table states.

**Two defects fall out of it immediately, and both are pinned here rather than
fixed.** Fixing either changes what the benchmark counts as correct, which
`R8_LOOP.md` §6 requires be escalated before landing. These tests assert the
CURRENT, WRONG behaviour and say so loudly, so the fix flips them and cannot
land silently.

**V25 — a header may declare more than one scale.** `declared_scale` returns a
single float and takes the first match, so this header resolves to `1e6`. The
yen column is in billions. Measured:

    _claim_is_bound("... ¥1,009 billion ...")  ->  False   <- correct, refused
    _claim_is_bound("... ¥1,009 million ...")  ->  True    <- wrong by 1000x, bound

Exactly inverted, on real SEC text. It is V14 and V19's class a third time, and
the earlier fixtures could not surface it because each declared one scale.

**V26 — currency is not compared at all.** Nothing in the binding path looks at
`$` versus `¥`, so a figure quoted in the wrong currency binds whenever the
digits agree. Roadmap §8.3 requires a matching numeric value with the wrong
currency to fail.
"""

from __future__ import annotations

import pytest

from app.core.verification.citation_verdict import declared_scale
from eval.head_to_head.rubric import _claim_is_bound
from tests.real_sec_fixtures import AFL_JAPAN_OPERATIONS

CITE = [AFL_JAPAN_OPERATIONS]


# ── The fixture is what it claims to be ───────────────────────────────────


def test_the_fixture_carries_both_currencies_for_one_metric():
    """Without this, everything below could be testing a table that lost its
    yen column to an encoding accident somewhere between EDGAR and here."""
    t = AFL_JAPAN_OPERATIONS["text"]
    assert "$ 6,744" in t
    assert "¥ 1,009" in t
    assert "In millions of dollars and billions of yen" in t


def test_the_usd_column_binds_correctly():
    """The dollar half is ordinary and must keep working."""
    assert _claim_is_bound(
        "Aflac Japan net earned premiums were $6,744 million in 2025 [1].",
        CITE) is True


# ── V25 — one header, two scales ──────────────────────────────────────────


def test_v25_a_dual_scale_header_resolves_to_only_one_scale():
    """
    PINNED DEFECT. `declared_scale` returns a float, so a header naming two
    scales can only answer for one of them, and it answers for the first.
    """
    assert declared_scale(
        "(In millions of dollars and billions of yen)") == 1e6, (
        "V25 moved. If the scale reader now distinguishes the dollar and yen "
        "columns, this is fixed — assert the real behaviour and delete this pin."
    )


def test_v25_the_correct_yen_reading_is_refused():
    """
    PINNED DEFECT. `¥1,009` sits under a header declaring billions for yen, so
    ¥1,009 billion is the filing's own figure — and it does not bind.
    """
    assert _claim_is_bound(
        "Aflac Japan net earned premiums were ¥1,009 billion in 2025 [1].",
        CITE) is False, (
        "V25 moved: the correct yen reading now binds. Delete this pin and "
        "assert True."
    )


def test_v25_the_thousandfold_wrong_yen_reading_binds():
    """
    PINNED DEFECT, and the half that costs a user something. The claim is wrong
    by a factor of a thousand and the grader accepts it, because the dollar
    scale in the header was applied to the yen column.
    """
    assert _claim_is_bound(
        "Aflac Japan net earned premiums were ¥1,009 million in 2025 [1].",
        CITE) is True, (
        "V25 moved: the wrong yen reading is now refused. Delete this pin and "
        "assert False."
    )


# ── V26 — currency is not part of the comparison ──────────────────────────


@pytest.mark.parametrize("claim", [
    "Aflac Japan net earned premiums were €6,744 million in 2025 [1].",
    "Aflac Japan net earned premiums were £6,744 million in 2025 [1].",
])
def test_v26_a_foreign_currency_symbol_binds_against_a_dollar_figure(claim):
    """
    PINNED DEFECT. The digits match the dollar column and nothing checks the
    symbol, so a euro or sterling claim binds against a US dollar figure.
    Roadmap §8.3 requires this to fail.
    """
    assert _claim_is_bound(claim, CITE) is True, (
        "V26 moved: currency is now compared. Delete this pin and assert False."
    )
