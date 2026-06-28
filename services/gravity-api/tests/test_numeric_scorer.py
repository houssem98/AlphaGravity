"""Regression tests for the FinanceBench numeric scorer.

The old numeric_match scaled the model's "X million" suffix but compared it to
expected answers that are already in millions WITHOUT a suffix (e.g. "11588.00")
→ 11588e6 vs 11588 = false negative. ~4/30 sample questions were correct but
mis-scored, undercounting numeric accuracy by ~13-20pts (30% → 50%).
"""

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent / "eval"))
import financebench as fb  # noqa: E402


def test_millions_suffix_vs_bare_millions():
    # Amazon FY2019 net income — the canonical false-negative.
    assert fb.numeric_match("net income was $11,588 million ($11.59B)", "11588.00")


def test_bare_vs_million_mantissa():
    assert fb.numeric_match("accounts payable total $303 million", "303.00")


def test_percentage():
    assert fb.numeric_match("gross margin was 43.3%", "43.3")


def test_within_tolerance():
    assert fb.numeric_match("revenue of $391,200 million", "391035")  # <2%


def test_unrelated_number_rejected():
    assert not fb.numeric_match("the footnote reference is 42", "11588.00")


def test_no_number_in_expected_is_neutral():
    assert fb.numeric_match("anything", "no numbers here")
