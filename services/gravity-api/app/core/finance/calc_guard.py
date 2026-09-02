"""
Refusing to compute when the operands cannot be trusted.

The deterministic-calculator pre-pass in `search_pipeline` regex-scrapes every
number out of the top passages, takes the first two distinct ones, feeds them to
`financial_calculator.yoy_growth`, and injects the result into the prompt under
the heading **"Deterministic Calculation Result"** with the instruction *"Use
this verified result in your answer. Do not recompute."*

Nothing in that path knows what the two numbers ARE. They carry no metric, no
period and no company, so a page number, a footnote marker and a fiscal year are
all equally eligible. The live benchmark produced the inevitable result:

    yoy_growth(current=2026.0, prior_year=10.0) = 20160.0
    -> "NVIDIA's revenue grew 20,160% year over year in fiscal 2026"

2026 was the fiscal year. The model reported the figure as authoritative because
it had been handed to it as authoritative.

`period_math.py` exists to make this impossible, but it needs typed quantities
and the pre-pass has only floats. So this module does the one thing that can be
done with floats alone: recognise pairs that CANNOT be a real comparison, and
refuse. It is deliberately conservative — a false refusal costs an injected
convenience, and a false acceptance costs a fabricated figure presented as
verified.

The asymmetry is the whole design. This will let some wrong pairs through; what
it must never do is let through the pairs that are obviously wrong.
"""

from __future__ import annotations

__all__ = ["looks_like_a_year", "plausible_operand_pair"]

#: Calendar years appear constantly in filings prose and are indistinguishable
#: from small financial figures once the units are stripped. A revenue of
#: exactly 2,026 dollars is possible and vanishingly rare; a fiscal year 2026 in
#: a filing is certain.
_YEAR_LO, _YEAR_HI = 1900, 2100

#: The largest believable ratio between two periods of the same metric. NVIDIA
#: grew 65% in a year and that was extraordinary; a 100x jump between two
#: consecutive periods of one line item does not happen without a restatement,
#: and if it did, an unattributed regex pair is not the evidence for it.
_MAX_PERIOD_RATIO = 100.0

#: Growth-shaped calculations, where both operands must be the same metric in
#: two periods. Margin-shaped ones legitimately mix magnitudes (operating
#: income over revenue) and are not held to the ratio test.
_PERIOD_COMPARISONS = frozenset({
    "yoy_growth", "qoq_growth", "percentage_change", "cagr",
})


def looks_like_a_year(value: float) -> bool:
    """
    True for a bare four-digit year.

    Whole-number test included on purpose: 2025.4 is a figure, 2025 is a year in
    every filing that mentions one.
    """
    try:
        v = float(value)
    except (TypeError, ValueError):
        return False
    return v == int(v) and _YEAR_LO <= int(v) <= _YEAR_HI


def plausible_operand_pair(current: float, prior: float, calc_type: str) -> bool:
    """
    Whether these two floats could be the two periods of one metric.

    Returns False for the pairs that are provably not a comparison. It cannot
    return True with any confidence — that would need the metric and the period,
    which is what `period_math.Quantity` carries and a regex hit does not.
    """
    try:
        cur, pri = float(current), float(prior)
    except (TypeError, ValueError):
        return False

    if looks_like_a_year(cur) or looks_like_a_year(pri):
        return False
    if cur == 0 or pri == 0:
        # Growth from zero is undefined, and the older calculator returns `inf`
        # for it, which renders into an answer as a real growth rate.
        return False
    if calc_type not in _PERIOD_COMPARISONS:
        return True
    if (cur < 0) != (pri < 0):
        # A sign flip between periods is real (a loss becoming a profit) but the
        # percentage describing it is not a growth rate, and an unattributed
        # pair is not the evidence for that story.
        return False

    ratio = abs(cur) / abs(pri)
    if ratio > _MAX_PERIOD_RATIO or ratio < 1.0 / _MAX_PERIOD_RATIO:
        return False
    return True
