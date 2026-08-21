"""
Multi-company ratio computation (quickanswerfix.md item 2).

The Stage 5b pre-pass called `compute_from_query(ticker=tickers[0])` — the FIRST
resolved company and only that one. "Compare FAANG operating margins" therefore
injected one company's ratios and nothing for the other four, and because a
company with no data contributed no text at all, the prompt could not distinguish
"no data for NFLX" from "NFLX was never asked about". A partial comparison
presented itself as a complete one.

Fixtures are REAL FY2024 figures pulled from SEC XBRL companyconcept before being
written here (us-gaap OperatingIncomeLoss over the revenue tag each filer actually
uses — note NFLX reports under the legacy `Revenues` tag, not the post-ASC606 one).
No invented numbers.
"""
import pytest

from app.core.finance.ratio_engine import (
    QUARTERLY_UNSUPPORTED,
    MultiRatioOutput,
    RatioEngine,
    _period_year,
)

# ticker -> (revenue, operating_income), FY2024 10-K, as filed.
FAANG_FY2024: dict[str, tuple[float, float]] = {
    "META":  (164_501_000_000, 69_380_000_000),   # 42.18%
    "AAPL":  (391_035_000_000, 123_216_000_000),  # 31.51%
    "AMZN":  (637_959_000_000, 68_593_000_000),   # 10.75%
    "NFLX":  (39_000_966_000, 10_417_614_000),    # 26.71%  (legacy `Revenues` tag)
    "GOOGL": (350_018_000_000, 112_390_000_000),  # 32.11%
}
EXPECTED_MARGIN = {
    "META": 42.18, "AAPL": 31.51, "AMZN": 10.75, "NFLX": 26.71, "GOOGL": 32.11,
}
FAANG = ["META", "AAPL", "AMZN", "NFLX", "GOOGL"]


def _engine(data: dict[str, tuple[float, float]] | None = None) -> RatioEngine:
    """RatioEngine with the metrics store stubbed — no DB, no network."""
    table = FAANG_FY2024 if data is None else data
    eng = RatioEngine(db_pool=None)

    async def _fake_fetch(ticker: str, period: str, metric_names: list[str]):
        row = table.get(ticker.upper())
        if row is None:
            return {}
        revenue, operating_income = row
        return {"revenue": revenue, "operating_income": operating_income}

    eng._fetch_metrics = _fake_fetch  # type: ignore[method-assign]
    return eng


class TestEveryCompanyAskedForComesBack:
    @pytest.mark.asyncio
    async def test_all_five_tickers_produce_an_output(self):
        out = await _engine().compute_many(FAANG, ["operating_margin"], "FY2024")
        assert out.tickers == FAANG, "every ticker asked for, in the order asked"

    @pytest.mark.asyncio
    async def test_each_margin_matches_the_filed_figures(self):
        out = await _engine().compute_many(FAANG, ["operating_margin"], "FY2024")
        for ticker, output in out.by_ticker().items():
            ratio = output.ratios[0]
            assert ratio.value == pytest.approx(EXPECTED_MARGIN[ticker], abs=0.01), ticker

    @pytest.mark.asyncio
    async def test_the_context_block_names_every_company(self):
        out = await _engine().compute_many(FAANG, ["operating_margin"], "FY2024")
        block = out.context_block
        for ticker in FAANG:
            assert ticker in block, f"{ticker} missing from the injected block"

    @pytest.mark.asyncio
    async def test_intent_is_detected_from_the_query_for_every_ticker(self):
        out = await _engine().compute_many_from_query(
            FAANG, "Compare FAANG operating margins over the last 4 quarters", "FY2024")
        assert out.tickers == FAANG
        assert all(o.computed_any for o in out.outputs)


class TestAMissingCompanyIsNamedNotDropped:
    """The failure this fix exists for: silence read as absence of the question."""

    PARTIAL = {k: v for k, v in FAANG_FY2024.items() if k not in ("NFLX", "AMZN")}

    @pytest.mark.asyncio
    async def test_companies_without_data_still_appear_in_the_result(self):
        out = await _engine(self.PARTIAL).compute_many(
            FAANG, ["operating_margin"], "FY2024")
        assert out.tickers == FAANG, "a company with no data must not vanish"

    @pytest.mark.asyncio
    async def test_they_are_reported_as_missing(self):
        out = await _engine(self.PARTIAL).compute_many(
            FAANG, ["operating_margin"], "FY2024")
        assert sorted(out.missing) == ["AMZN", "NFLX"]

    @pytest.mark.asyncio
    async def test_the_block_says_no_data_explicitly(self):
        out = await _engine(self.PARTIAL).compute_many(
            FAANG, ["operating_margin"], "FY2024")
        block = out.context_block
        for ticker in ("AMZN", "NFLX"):
            assert ticker in block, f"{ticker} must be named as missing, not omitted"
            # each gets its own stated reason, not a bare shrug
            line = next(l for l in block.splitlines() if l.startswith(f"- **{ticker}**"))
            assert "Missing data" in line, line
        # and the ones that DID compute are still there with their numbers
        assert "42.18" in block and "31.51" in block

    @pytest.mark.asyncio
    async def test_one_company_failing_does_not_sink_the_others(self):
        eng = _engine()

        async def _explode(ticker: str, period: str, metric_names: list[str]):
            if ticker.upper() == "AMZN":
                raise RuntimeError("metrics store unavailable")
            revenue, operating_income = FAANG_FY2024[ticker.upper()]
            return {"revenue": revenue, "operating_income": operating_income}

        eng._fetch_metrics = _explode  # type: ignore[method-assign]
        out = await eng.compute_many(FAANG, ["operating_margin"], "FY2024")
        assert out.tickers == FAANG
        assert "AMZN" in out.missing
        assert out.by_ticker()["META"].ratios[0].value == pytest.approx(42.18, abs=0.01)


class TestTheSingleTickerCallersStillWork:
    """compute()/compute_from_query() keep their signature — compute_altman_z and
    every other existing caller pass one ticker and must be unaffected."""

    @pytest.mark.asyncio
    async def test_compute_still_takes_one_ticker(self):
        out = await _engine().compute("AAPL", ["operating_margin"], "FY2024")
        assert out.ticker == "AAPL"
        assert out.ratios[0].value == pytest.approx(31.51, abs=0.01)

    @pytest.mark.asyncio
    async def test_compute_from_query_still_takes_one_ticker(self):
        out = await _engine().compute_from_query(
            "META", "what was the operating margin", "FY2024")
        assert out.ticker == "META"
        # Intent detection is deliberately generous and can match more than one
        # ratio for a phrase, so look the one up by key rather than by position.
        margin = next(r for r in out.ratios if r.ratio_key == "operating_margin")
        assert margin.value == pytest.approx(42.18, abs=0.01)


class TestDegenerateInput:
    @pytest.mark.asyncio
    async def test_no_tickers_returns_an_empty_result_not_an_error(self):
        out = await _engine().compute_many([], ["operating_margin"], "FY2024")
        assert isinstance(out, MultiRatioOutput)
        assert out.outputs == [] and out.context_block == ""

    @pytest.mark.asyncio
    async def test_duplicates_are_collapsed(self):
        out = await _engine().compute_many(
            ["AAPL", "aapl", "AAPL "], ["operating_margin"], "FY2024")
        assert out.tickers == ["AAPL"]

    @pytest.mark.asyncio
    async def test_no_ratio_intent_in_the_query_computes_nothing(self):
        out = await _engine().compute_many_from_query(
            FAANG, "who is the CEO", "FY2024")
        assert out.outputs == []


class TestPeriodParsing:
    r"""
    The period regex was anchored — `(?:FY|Q[1-4])?(\d{4})` — so it only matched
    when the year sat immediately after the prefix. Every space-separated shape
    returned None and the engine computed nothing at all, including "Q4 2025",
    which compute()'s own docstring advertised as supported.
    """

    @pytest.mark.parametrize("period,year", [
        ("FY2024", 2024),
        ("2024", 2024),
        ("FY 2024", 2024),          # was None
        ("Q1 2025", 2025),          # was None
        ("Q4 2025", 2025),          # was None — a documented input
        ("Q12025", 2025),
        ("Q1 2025, Q4 2024, Q3 2024, Q2 2024", 2025),   # planner's compound form
        ("no year here", None),
        ("", None),
    ])
    def test_year_is_extracted(self, period, year):
        assert _period_year(period) == year


class TestQuarterlyIsRefusedWithAReason:
    """
    The store holds FY rows from xbrl_companyfacts alongside date-keyed backfill
    rows whose captions are empty and whose values are off by orders of magnitude
    (META "Cost of revenue" 2026-01-29 is 740, against 30,161,000,000 for FY2024).
    So a quarterly ask cannot be served, and must not be served from those rows.
    """

    @pytest.mark.asyncio
    async def test_a_quarterly_period_reports_why_not_silence(self):
        out = await _engine().compute("AAPL", ["operating_margin"], "Q1 2025")
        assert out.ratios, "must not return an empty output"
        assert out.ratios[0].value is None
        assert out.ratios[0].error == QUARTERLY_UNSUPPORTED

    @pytest.mark.asyncio
    async def test_the_reason_reaches_the_injected_block(self):
        out = await _engine().compute_many(FAANG, ["operating_margin"], "Q1 2025")
        assert out.missing == FAANG
        block = out.context_block
        assert "Annual figures only" in block
        assert "no quarterly ratio is computed" in block

    @pytest.mark.asyncio
    async def test_annual_periods_are_unaffected(self):
        out = await _engine().compute("AAPL", ["operating_margin"], "FY2024")
        assert out.ratios[0].value == pytest.approx(31.51, abs=0.01)
