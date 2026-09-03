"""L5 / D5 — a non-finite value must not reach a ratio.

`period_math` settled this already. `Quantity.__post_init__` refuses to build a
non-finite operand, `_finite()` gates every result, and
`test_every_operation_routes_through_the_finiteness_gate` fails if a new
operation forgets. The reasoning is written out there: guarding the inputs is
not enough, because every operand can be finite and the answer still not be —
IEEE hands back `inf` without raising.

`ratio_engine` shares none of it. `grep -c isfinite ratio_engine.py` is 0.
`_safe_div` guards a zero denominator and a None operand, which are the two
cases someone thought of, and passes `inf` and `nan` straight through:

    _safe_div(inf, 2)     -> inf
    _safe_div(1, nan)     -> nan
    _safe_div(1e308, 1e-308, pct=True) -> inf   (both operands finite)

`_derive_metrics` is the same story one level up: `gross_profit = rev - cogs`
with no check, so a single poisoned fact spreads into every composite built
from it and then into every ratio built from those.

This does not require the values in the store to be corrupt. `float(val)` on a
JSON number large enough overflows to `inf` on the way in, and the third case
above overflows out of two entirely reasonable inputs.

The fix routes through the gate `period_math` already owns rather than writing
a second one, which is what the roadmap asks for and also the only way the two
stay consistent when one of them changes.
"""

from __future__ import annotations

import inspect
import math

import pytest

from app.core.finance import ratio_engine as re_mod
from app.core.finance.ratio_engine import RatioEngine, _derive_metrics, _safe_div

INF = float("inf")
NAN = float("nan")


def _finite_or_none(x) -> bool:
    return x is None or (isinstance(x, (int, float)) and math.isfinite(x))


# ── _safe_div is the shared arithmetic exit ───────────────────────────────


@pytest.mark.parametrize("n, d", [
    (INF, 2.0),
    (-INF, 2.0),
    (NAN, 2.0),
    (1.0, INF),
    (1.0, NAN),
    (INF, INF),
])
def test_a_non_finite_operand_produces_no_ratio(n, d):
    """`None` already means "no ratio". A non-finite must mean the same."""
    assert _safe_div(n, d) is None, (
        f"_safe_div({n}, {d}) returned a value; a non-finite operand is not a ratio"
    )


def test_two_finite_operands_that_overflow_produce_no_ratio():
    """The case guarding the inputs cannot catch — the division itself overflows."""
    out = _safe_div(1e308, 1e-308, pct=True)
    assert _finite_or_none(out), f"_safe_div overflowed to {out} from two finite operands"


def test_ordinary_megacap_figures_still_compute():
    """The gate must not refuse real numbers. Mirrors the period_math guard."""
    assert _safe_div(130_497_000_000, 400_000_000_000, pct=True) == pytest.approx(
        32.624, abs=1e-3)
    assert _safe_div(-5.0, 2.0) == pytest.approx(-2.5)


def test_a_zero_denominator_is_still_undefined_not_zero():
    """The behaviour that was already correct must survive the change."""
    assert _safe_div(5.0, 0) is None
    assert _safe_div(None, 2.0) is None


# ── composites spread a poisoned fact ─────────────────────────────────────


def test_a_derived_metric_is_never_non_finite():
    """One bad fact must not become a bad gross_profit, and then a bad margin."""
    out = _derive_metrics({"revenue": INF, "cost_of_goods_sold": 100.0})
    for key, val in out.items():
        assert _finite_or_none(val), f"derived {key} is {val}"


def test_a_non_finite_input_fact_does_not_survive_derivation():
    out = _derive_metrics({"revenue": 1000.0, "cost_of_goods_sold": NAN})
    assert _finite_or_none(out.get("gross_profit"))


# ── end to end through compute() ──────────────────────────────────────────


class _Engine(RatioEngine):
    """Real compute path, stubbed store. The DB is the only boundary replaced."""

    def __init__(self, facts):
        super().__init__(db_pool=None)
        self._facts = facts

    async def _fetch_metrics(self, ticker, period, metric_names):
        return dict(self._facts)


@pytest.mark.asyncio
async def test_a_non_finite_fact_never_becomes_a_published_ratio():
    engine = _Engine({"revenue": INF, "cost_of_goods_sold": 100.0,
                      "gross_profit": INF})

    out = await engine.compute("NVDA", ["gross_margin"], period="FY2025")

    for r in out.ratios:
        assert _finite_or_none(r.value), (
            f"{r.label} shipped {r.value}; a non-finite ratio reached the caller"
        )


@pytest.mark.asyncio
async def test_a_refused_ratio_says_why_instead_of_reporting_nothing():
    """An absent value with no reason reads as "we looked and found nothing"."""
    engine = _Engine({"revenue": INF, "cost_of_goods_sold": 100.0,
                      "gross_profit": INF})

    out = await engine.compute("NVDA", ["gross_margin"], period="FY2025")

    assert out.ratios, "no ratio result at all"
    refused = [r for r in out.ratios if r.value is None]
    assert refused, "expected the poisoned ratio to be refused"
    for r in refused:
        assert r.error, f"{r.label} was refused with no stated reason"


@pytest.mark.asyncio
async def test_finite_facts_still_produce_the_ratio():
    """The guard: this whole change must not cost a single real answer."""
    engine = _Engine({"revenue": 130_497.0, "cost_of_goods_sold": 32_639.0,
                      "gross_profit": 97_858.0})

    out = await engine.compute("NVDA", ["gross_margin"], period="FY2025")

    got = [r for r in out.ratios if r.value is not None]
    assert got, "a clean ratio was refused"
    assert got[0].value == pytest.approx(74.99, abs=0.1)


# ── the structural guard, mirroring period_math ───────────────────────────


def test_the_engine_routes_through_a_finiteness_gate_at_all():
    """
    The check that fails when someone adds a new arithmetic path later.
    `period_math` pins the same property with the same shape of assertion.
    """
    src = inspect.getsource(re_mod)
    assert "is_finite_value" in src, (
        "ratio_engine performs financial arithmetic with no finiteness check "
        "anywhere in the module"
    )
    # Specifically period_math's gate. A local reimplementation would satisfy
    # the assertion above while reintroducing exactly the drift this shares a
    # gate to avoid.
    assert "from app.core.finance.period_math import is_finite_value" in src, (
        "the finiteness check is not the shared one"
    )
    assert "def is_finite_value" not in src, (
        "ratio_engine defines a second finiteness gate instead of using the one "
        "period_math already owns"
    )
