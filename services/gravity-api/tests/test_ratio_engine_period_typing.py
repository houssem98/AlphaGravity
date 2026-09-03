"""L3 / D3 — a ratio must know which period each operand came from.

`period_math` exists because of a real incident recorded in its own docstring:
FY2018 revenue beside FY2025 operating income, both individually cited,
together a margin collapse that never happened. Its answer is that an operand
carries its company, metric, period and unit, and an operation over two of them
either returns a result or a refusal naming what did not line up.

`ratio_engine` computes the ratios that actually ship and shares none of it.
`_fetch_metrics` returns `dict[str, float]`, and `compute` does
`defn.formula(num_val, den_val)` over two bare numbers. The period is pinned at
fetch time by the PostgREST filter and then discarded, so nothing downstream
can verify it — and `_prior` metrics from a DIFFERENT fiscal year are merged
into the SAME flat dict, which is precisely the shape the incident had.

Nothing here claims the current numbers are wrong. The fetch does filter by
period, so the values are period-correct by construction today. The defect is
that the construction is unverifiable and unenforced: a change to the fetch, or
to the `_prior` merge, would cross periods silently and no test would notice.

Two rules, because the engine has two kinds of ratio and they need opposite
checks:

  same-period ratios (margins, returns, turnover) — operands must agree
  growth ratios (`*_prior` denominator)          — operands must be exactly
                                                   one fiscal year apart

The second is not decoration. A "YoY growth" computed from figures three years
apart is a real number answering a question nobody asked, and it is the error
`period_math.growth` refuses with `wrong_interval`.

**Scope, stated honestly.** D3 also asks that operands carry an accession.
`supabase/migrations/0002_financials.sql` has no accession column — the table
stores `document_id`, `unit`, `period` and no filing accession at all. So the
accession half is blocked by the schema, not by this code, and `document_id`
is carried as the nearest available handle rather than an invented accession.
"""

from __future__ import annotations

import pytest

from app.core.finance.ratio_engine import Fact, RatioEngine


class _Engine(RatioEngine):
    """Real compute path, stubbed store. The DB is the only boundary replaced."""

    def __init__(self, facts: dict[str, Fact]):
        super().__init__(db_pool=None)
        self._facts = facts

    async def _fetch_facts(self, ticker, period, metric_names):
        return dict(self._facts)


def _f(metric: str, value: float, year: int, **kw) -> Fact:
    return Fact(value=value, metric=metric, fiscal_year=year, **kw)


def _only(out):
    assert out.ratios, "no ratio result at all"
    return out.ratios[0]


# ── the incident this exists to prevent ───────────────────────────────────


@pytest.mark.asyncio
async def test_a_margin_across_two_periods_is_refused():
    """FY2018 over FY2025 — the Copart shape, arithmetic that describes nothing."""
    engine = _Engine({
        "revenue": _f("revenue", 1000.0, 2025),
        "cost_of_goods_sold": _f("cost_of_goods_sold", 400.0, 2018),
        "gross_profit": _f("gross_profit", 600.0, 2018),
    })

    r = _only(await engine.compute("X", ["gross_margin"], period="FY2025"))

    assert r.value is None, (
        "a margin was computed from operands five years apart; the arithmetic "
        "runs cleanly and the answer means nothing"
    )
    assert r.error and "period" in r.error.lower(), (
        f"refused without naming the reason: {r.error!r}"
    )


@pytest.mark.asyncio
async def test_a_growth_rate_over_the_wrong_interval_is_refused():
    """A three-year gap labelled year-over-year."""
    engine = _Engine({
        "revenue": _f("revenue", 1000.0, 2025),
        "revenue_prior": _f("revenue_prior", 500.0, 2022),
    })

    r = _only(await engine.compute("X", ["revenue_growth_yoy"], period="FY2025"))

    assert r.value is None, "a 3-year gap was reported as year-over-year growth"
    assert r.error and "period" in r.error.lower()


@pytest.mark.asyncio
async def test_a_ratio_records_the_period_each_operand_came_from():
    """Provenance the caller can check, rather than a period it must trust."""
    engine = _Engine({
        "revenue": _f("revenue", 1000.0, 2025),
        "cost_of_goods_sold": _f("cost_of_goods_sold", 400.0, 2025),
        "gross_profit": _f("gross_profit", 600.0, 2025),
    })

    r = _only(await engine.compute("X", ["gross_margin"], period="FY2025"))

    assert r.numerator_period == "FY2025"
    assert r.denominator_period == "FY2025"


# ── the guards: correct ratios must still compute ─────────────────────────


@pytest.mark.asyncio
async def test_a_same_period_margin_still_computes():
    engine = _Engine({
        "revenue": _f("revenue", 1000.0, 2025),
        "cost_of_goods_sold": _f("cost_of_goods_sold", 400.0, 2025),
        "gross_profit": _f("gross_profit", 600.0, 2025),
    })

    r = _only(await engine.compute("X", ["gross_margin"], period="FY2025"))

    assert r.error is None, r.error
    assert r.value == pytest.approx(60.0)


@pytest.mark.asyncio
async def test_a_one_year_growth_still_computes():
    """The cross-period ratio that is CORRECT. It must not be caught."""
    engine = _Engine({
        "revenue": _f("revenue", 1200.0, 2025),
        "revenue_prior": _f("revenue_prior", 1000.0, 2024),
    })

    r = _only(await engine.compute("X", ["revenue_growth_yoy"], period="FY2025"))

    assert r.error is None, r.error
    assert r.value == pytest.approx(20.0)


@pytest.mark.asyncio
async def test_a_fact_carries_its_unit_and_document():
    """Both columns exist in `financials` and neither was being selected."""
    f = _f("revenue", 1000.0, 2025, unit="USD", document_id="doc-1",
           concept="Revenues")
    assert (f.unit, f.document_id, f.concept) == ("USD", "doc-1", "Revenues")


def test_every_provenance_column_the_audit_named_is_selected():
    """
    The external audit listed five fields the fetch discarded: document_id,
    filing_date, unit, source_section and accession. Four are columns that
    exist and are now selected. `accession` is not a column at all — see
    `0002_financials.sql` — so it is absent by schema, and this asserts the
    four that were merely being left behind.
    """
    import inspect

    from app.core.finance.ratio_engine import RatioEngine

    src = inspect.getsource(RatioEngine._fetch_facts)
    for column in ("unit", "document_id", "filing_date", "source_section"):
        assert column in src, (
            f"`{column}` exists in the financials table and the ratio fetch "
            "does not select it, so the calculation cannot carry it"
        )


def test_a_fact_carries_the_two_columns_that_were_left_behind():
    f = _f("revenue", 1000.0, 2025, filing_date="2025-02-26",
           source_section="Consolidated Statements of Operations")
    assert f.filing_date == "2025-02-26"
    assert f.source_section == "Consolidated Statements of Operations"


def test_no_fact_claims_an_accession_it_cannot_have():
    """
    The audit asked for an accession. The table stores none, so the honest
    record is that the field does not exist rather than an empty string
    implying one was looked for and not found.
    """
    from app.core.finance.ratio_engine import Fact

    assert not hasattr(Fact(1.0, "revenue"), "accession"), (
        "Fact carries an `accession` field, but `financials` has no accession "
        "column — the value could only be invented"
    )


@pytest.mark.asyncio
async def test_a_missing_period_does_not_invent_a_refusal():
    """
    A fact whose year is unknown cannot be checked against another. The
    question is unanswerable, so it is not answered against the data — the
    same principle the claim-binding check uses.
    """
    engine = _Engine({
        "revenue": _f("revenue", 1000.0, 0),
        "cost_of_goods_sold": _f("cost_of_goods_sold", 400.0, 0),
        "gross_profit": _f("gross_profit", 600.0, 0),
    })

    r = _only(await engine.compute("X", ["gross_margin"], period="FY2025"))

    assert r.value == pytest.approx(60.0), (
        "an unknown period was treated as a mismatch and refused a real ratio"
    )
