"""
The ratio engine may not compute from rows it cannot vouch for.

Found by an external audit of the Quick Answer path, then narrowed here.

`RatioEngineOutput.context_block` injects its numbers into the prompt under:

    ⚠ These values are computed deterministically from audited filings.
    Do NOT recompute them. Cite them directly.

`_fetch_metrics` selected `caption,value_float` from `financials` filtered on
ticker and period ALONE. That table holds three populations, and only the
`*_xbrl` rows are exactly tagged. `structured_search.py` already knows this and
filters for it, recording the case that forced the change:

    NVDA_CostOfRevenue_FY2026_xbrl          = 62,475,000,000   (dollars, as filed)
    NVDA_Cost_of_revenue_2026-05-20_backfill = 39.5             (a unitless scrape)

A ratio built from the second number is wrong rather than missing. The engine
was free to pick it up, divide by it, and stamp the result "audited".

This is the same shape as the 20,160% growth rate `calc_guard` was written for:
an authoritative label on an operand whose provenance was dropped. The fix is
the same in spirit — earn the claim or stop making it.
"""

from __future__ import annotations

import pytest

from app.core.finance.ratio_engine import RatioEngine, RatioEngineOutput, RatioResult


class _Recorder:
    """Captures the PostgREST filters the engine actually sends."""

    def __init__(self, rows: list[dict] | None = None):
        self.calls: list[dict] = []
        self.selects: list[str] = []
        self.rows = rows if rows is not None else []

    async def sb_select(self, table, filters, select="*", limit=10, offset=0):
        self.calls.append(dict(filters))
        self.selects.append(select)
        return list(self.rows)

    @staticmethod
    def configured() -> bool:
        return True


@pytest.fixture
def recorder(monkeypatch):
    import app.db.supabase_rest as sr

    rec = _Recorder()
    monkeypatch.setattr(sr, "sb_select", rec.sb_select)
    monkeypatch.setattr(sr, "configured", rec.configured)
    return rec


# ── The filter that was missing ───────────────────────────────────────────


@pytest.mark.asyncio
async def test_the_fetch_restricts_to_exactly_tagged_xbrl_rows(recorder):
    """
    Without this the engine reads the backfill population, whose values are
    unitless scrapes of the same captions.
    """
    await RatioEngine(None)._fetch_metrics("NVDA", "FY2026", ["revenue"])
    assert recorder.calls, "the engine never queried financials"
    for flt in recorder.calls:
        assert flt.get("id") == "like.*_xbrl", (
            f"fetch was not restricted to exactly-tagged rows: {flt}"
        )


@pytest.mark.asyncio
async def test_the_prior_year_fetch_is_restricted_too(recorder):
    """
    YoY and CAGR read a second year. Gating only the current year would leave
    half of every growth ratio sourced from the untrusted population.
    """
    await RatioEngine(None)._fetch_metrics("NVDA", "FY2026", ["revenue", "revenue_prior"])
    assert len(recorder.calls) >= 2, "prior-year fetch did not happen"
    for flt in recorder.calls:
        assert flt.get("id") == "like.*_xbrl"


@pytest.mark.asyncio
async def test_the_row_identity_is_selected_so_provenance_exists(recorder):
    """
    `caption,value_float` throws away the only column that says which filing a
    number came from. A claim of provenance needs the provenance fetched.
    """
    await RatioEngine(None)._fetch_metrics("AAPL", "FY2025", ["revenue"])
    for sel in recorder.selects:
        assert "id" in sel.split(","), f"row id not selected: {sel!r}"


@pytest.mark.asyncio
async def test_the_nvidia_backfill_row_cannot_reach_a_ratio(recorder):
    """
    The exact pair from structured_search's comment. 39.5 is a scrape of the
    cost-of-revenue line with its units lost; a margin computed from it is not
    merely imprecise, it is meaningless.
    """
    recorder.rows = [
        {"id": "NVDA_Cost_of_revenue_2026-05-20_backfill",
         "caption": "CostOfRevenue", "value_float": 39.5},
    ]
    await RatioEngine(None)._fetch_metrics("NVDA", "FY2026", ["cost_of_goods_sold"])
    # The guard is the query filter: a backfill id can only come back if the
    # engine asked for it.
    for flt in recorder.calls:
        assert flt.get("id") == "like.*_xbrl"


# ── The claim the block makes ─────────────────────────────────────────────


def _block(**kw) -> str:
    out = RatioEngineOutput(ticker="NVDA", period="FY2026", ratios=[
        RatioResult(ratio_key="gross_margin", label="Gross Margin",
                    value=75.0, unit="%",
                    numerator_metric="gross_profit", numerator_value=3.0,
                    denominator_metric="revenue", denominator_value=4.0,
                    ticker="NVDA", period="FY2026", **kw),
    ])
    return out.context_block


def test_the_block_no_longer_claims_filings_it_cannot_name():
    """
    "audited filings" asserts a specific document. The engine carries a row id,
    not an accession number, so it may describe the tagging it can show and
    must not imply a filing it cannot.
    """
    text = _block()
    assert "audited filings" not in text.lower()


def test_the_block_no_longer_forbids_the_model_from_checking():
    """
    "Do NOT recompute them. Cite them directly." is the instruction that turned
    a scraped fiscal year into a 20,160% growth rate on the calculator path.
    An instruction not to verify is only safe when the value is verified.
    """
    low = _block().lower()
    assert "do not recompute" not in low


def test_the_block_still_states_what_it_actually_knows():
    """
    The fix must not be silence. A caller still needs to know these are exact
    tagged facts rather than prose the model extracted.
    """
    low = _block().lower()
    assert "xbrl" in low
    assert "gross margin" in low


def test_the_docstring_promise_and_the_query_agree():
    """
    `_fetch_metrics` has always documented itself as reading "the Supabase XBRL
    financials table". It did not filter for XBRL rows. A docstring is not a
    filter, and the gap between them is where the bug lived.
    """
    import inspect

    src = inspect.getsource(RatioEngine._fetch_metrics)
    assert "XBRL" in inspect.getdoc(RatioEngine._fetch_metrics)
    assert '"like.*_xbrl"' in src or "'like.*_xbrl'" in src
