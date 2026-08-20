"""
The live SEC EDGAR channel.

Every HTTP call is mocked — these pin the channel's contract, not SEC's uptime:
it never raises into the parallel fan-out, it never invents a company, and a
derived quarter never looks like a filed one.
"""
import pytest

from app.core.retrieval.edgar_search import EdgarSearch, classify_metric, extract_tickers

TICKER_MAP = {
    "0": {"cik_str": 320193, "ticker": "AAPL", "title": "Apple Inc."},
    "1": {"cik_str": 789019, "ticker": "MSFT", "title": "Microsoft Corp"},
}

ANNUAL = {
    "cik": 320193,
    "tag": "RevenueFromContractWithCustomerExcludingAssessedTax",
    "units": {"USD": [
        {"start": "2022-09-25", "end": "2023-09-30", "val": 383_285_000_000,
         "form": "10-K", "accn": "0000320193-23-000106", "fy": 2023, "fp": "FY"},
        {"start": "2021-09-26", "end": "2022-09-24", "val": 394_328_000_000,
         "form": "10-K", "accn": "0000320193-22-000108", "fy": 2022, "fp": "FY"},
    ]},
}

# Q1-Q3 filed, no standalone Q4 — Apple's actual shape.
QUARTERLY = {
    "cik": 320193,
    "tag": "RevenueFromContractWithCustomerExcludingAssessedTax",
    "units": {"USD": [
        {"start": "2022-09-25", "end": "2022-12-31", "val": 117_154_000_000,
         "form": "10-Q", "accn": "0000320193-23-000006"},
        {"start": "2023-01-01", "end": "2023-04-01", "val": 94_836_000_000,
         "form": "10-Q", "accn": "0000320193-23-000064"},
        {"start": "2023-04-02", "end": "2023-07-01", "val": 81_797_000_000,
         "form": "10-Q", "accn": "0000320193-23-000077"},
        {"start": "2022-09-25", "end": "2023-09-30", "val": 383_285_000_000,
         "form": "10-K", "accn": "0000320193-23-000106"},
    ]},
}


class _Resp:
    def __init__(self, payload, status=200):
        self._payload, self.status_code = payload, status

    def raise_for_status(self):
        if self.status_code >= 400:
            raise RuntimeError(f"HTTP {self.status_code}")

    def json(self):
        return self._payload


class _FakeHTTP:
    """Routes by URL shape. `concepts` maps us-gaap tag -> payload (or None for 404)."""

    def __init__(self, concepts=None, ticker_map=TICKER_MAP, raises=None):
        self.concepts = concepts or {}
        self.ticker_map = ticker_map
        self.raises = raises
        self.urls = []

    async def get(self, url):
        self.urls.append(url)
        if self.raises:
            raise self.raises
        if "company_tickers.json" in url:
            return _Resp(self.ticker_map)
        tag = url.rsplit("/", 1)[-1].removesuffix(".json")
        payload = self.concepts.get(tag)
        return _Resp(payload, 200) if payload else _Resp(None, 404)


def _channel(**kw):
    return EdgarSearch(http_client=_FakeHTTP(**kw))


REV = "RevenueFromContractWithCustomerExcludingAssessedTax"


class TestAKnownCompanyProducesACitableFact:
    @pytest.mark.asyncio
    async def test_a_revenue_query_returns_results(self):
        out = await _channel(concepts={REV: ANNUAL}).search("What was AAPL revenue?")
        assert out, "expected at least one EDGAR fact"

    @pytest.mark.asyncio
    async def test_the_fact_carries_the_sec_authority_tier(self):
        out = await _channel(concepts={REV: ANNUAL}).search("What was AAPL revenue?")
        assert out[0].source_quality == 10

    @pytest.mark.asyncio
    async def test_the_url_is_a_well_formed_sec_gov_filing_index(self):
        out = await _channel(concepts={REV: ANNUAL}).search("What was AAPL revenue?")
        url = out[0].metadata["source_url"]
        assert url == (
            "https://www.sec.gov/Archives/edgar/data/320193/"
            "000032019323000106/0000320193-23-000106-index.htm")
        assert out[0].metadata["filing_url"] == url

    @pytest.mark.asyncio
    async def test_the_text_is_prefixed_so_the_pipeline_pins_it(self):
        # search_pipeline keys priority pinning and `has_exact_fact` off this prefix
        out = await _channel(concepts={REV: ANNUAL}).search("What was AAPL revenue?")
        assert out[0].text.startswith("[EXACT FILING FIGURE] AAPL revenue for FY2023")
        assert "$383,285,000,000" in out[0].text

    @pytest.mark.asyncio
    async def test_the_result_is_typed_and_attributed(self):
        out = await _channel(concepts={REV: ANNUAL}).search("What was AAPL revenue?")
        r = out[0]
        assert r.document_type == "sec_edgar_xbrl"
        assert r.ticker == "AAPL"
        assert r.filing_date == "2023-09-30"
        assert r.metadata["accn"] == "0000320193-23-000106"

    @pytest.mark.asyncio
    async def test_the_10k_wins_over_a_10q_for_the_same_year(self):
        units = {"USD": ANNUAL["units"]["USD"] + [
            {"start": "2022-09-25", "end": "2023-09-30", "val": 1,
             "form": "10-Q", "accn": "0000320193-23-000999"}]}
        ch = _channel(concepts={REV: {"units": units}})
        out = await ch.search("AAPL revenue")
        assert out[0].metadata["form"] == "10-K"


class TestADerivedQuarterIsNeverDressedAsAFiledOne:
    @pytest.mark.asyncio
    async def test_the_missing_q4_is_flagged_derived_in_metadata(self):
        out = await _channel(concepts={REV: QUARTERLY}).search("AAPL quarterly revenue 2023")
        q4 = [r for r in out if r.metadata["fiscal_quarter"] == 4]
        assert q4 and q4[0].metadata["derived"] is True

    @pytest.mark.asyncio
    async def test_the_derivation_is_stated_in_the_passage_text(self):
        out = await _channel(concepts={REV: QUARTERLY}).search("AAPL quarterly revenue 2023")
        q4 = next(r for r in out if r.metadata["fiscal_quarter"] == 4)
        assert "(derived, not directly filed" in q4.text

    @pytest.mark.asyncio
    async def test_the_derived_value_is_the_filed_total_minus_the_filed_quarters(self):
        out = await _channel(concepts={REV: QUARTERLY}).search("AAPL quarterly revenue 2023")
        q4 = next(r for r in out if r.metadata["fiscal_quarter"] == 4)
        assert q4.metadata["value"] == pytest.approx(89_498_000_000, abs=1_000_000)

    @pytest.mark.asyncio
    async def test_the_filed_quarters_are_not_flagged_derived(self):
        out = await _channel(concepts={REV: QUARTERLY}).search("AAPL quarterly revenue 2023")
        filed = [r for r in out if r.metadata["fiscal_quarter"] in (1, 2, 3)]
        assert filed and all(r.metadata["derived"] is False for r in filed)
        assert all("derived" not in r.text for r in filed)


class TestItNeverBreaksTheFanOut:
    @pytest.mark.asyncio
    async def test_an_unknown_ticker_returns_empty_without_raising(self):
        out = await _channel(concepts={REV: ANNUAL}).search("What was ZZZZ revenue?")
        assert out == []

    @pytest.mark.asyncio
    async def test_a_query_naming_no_company_returns_empty(self):
        ch = _channel(concepts={REV: ANNUAL})
        assert await ch.search("what is a good gross margin?") == []

    @pytest.mark.asyncio
    async def test_a_transport_error_returns_empty_rather_than_propagating(self):
        ch = EdgarSearch(http_client=_FakeHTTP(raises=RuntimeError("connection reset")))
        assert await ch.search("AAPL revenue") == []

    @pytest.mark.asyncio
    async def test_a_concept_the_filer_never_reported_returns_empty(self):
        # every tag 404s
        assert await _channel(concepts={}).search("AAPL inventory") == []


class TestTagSelection:
    @pytest.mark.asyncio
    async def test_a_pre_asc606_filer_falls_back_to_the_legacy_revenues_tag(self):
        ch = _channel(concepts={"Revenues": ANNUAL})   # modern tag 404s
        out = await ch.search("AAPL revenue")
        assert out and out[0].metadata["tag"] == "Revenues"

    def test_the_metric_table_prefers_the_more_specific_phrase(self):
        assert classify_metric("AAPL gross profit")[0] == "GrossProfit"
        assert classify_metric("AAPL cost of revenue")[0] == "CostOfGoodsAndServicesSold"
        assert classify_metric("AAPL revenue")[0] == (
            "RevenueFromContractWithCustomerExcludingAssessedTax")

    def test_an_unrecognised_metric_defaults_to_revenue(self):
        assert classify_metric("how did AAPL do last year")[1] == "revenue"

    def test_tickers_come_from_filters_entities_or_the_query(self):
        assert extract_tickers("compare", filters={"companies": [{"ticker": "aapl"}]}) == ["AAPL"]
        assert extract_tickers("compare", entities={"tickers": ["msft"]}) == ["MSFT"]
        assert extract_tickers("What did NVDA earn?") == ["NVDA"]

    def test_common_uppercase_words_are_not_mistaken_for_tickers(self):
        assert extract_tickers("What is the EPS for FY 2023?") == []


class TestMultiYearQuarterlyBreadth:
    """
    A 3-fiscal-year quarterly ask names 12 periods (4 quarters x 3 years, one
    derived Q4 per year). Before the effective_top_k fix, the channel's own
    `top_k=10` default silently truncated this to the 10 most recent periods,
    dropping FY2023 Q1/Q2 even though they were fetched and correctly derived
    upstream. Real Apple FY2023-2025 figures, matching what SEC EDGAR actually
    reports (cross-checked against the filed 9-month cumulative each year).
    """

    THREE_YEAR_QUARTERLY = {
        "cik": 320193,
        "tag": REV,
        "units": {"USD": [
            # FY2023
            {"start": "2022-09-25", "end": "2022-12-31", "val": 117_154_000_000,
             "form": "10-Q", "accn": "0000320193-23-000006"},
            {"start": "2023-01-01", "end": "2023-04-01", "val": 94_836_000_000,
             "form": "10-Q", "accn": "0000320193-23-000064"},
            {"start": "2023-04-02", "end": "2023-07-01", "val": 81_797_000_000,
             "form": "10-Q", "accn": "0000320193-23-000077"},
            {"start": "2022-09-25", "end": "2023-09-30", "val": 383_285_000_000,
             "form": "10-K", "accn": "0000320193-23-000106"},
            # FY2024
            {"start": "2023-10-01", "end": "2023-12-30", "val": 119_575_000_000,
             "form": "10-Q", "accn": "0000320193-24-000006"},
            {"start": "2023-12-31", "end": "2024-03-30", "val": 90_753_000_000,
             "form": "10-Q", "accn": "0000320193-24-000069"},
            {"start": "2024-03-31", "end": "2024-06-29", "val": 85_777_000_000,
             "form": "10-Q", "accn": "0000320193-24-000081"},
            {"start": "2023-10-01", "end": "2024-09-28", "val": 391_035_000_000,
             "form": "10-K", "accn": "0000320193-24-000123"},
            # FY2025
            {"start": "2024-09-29", "end": "2024-12-28", "val": 124_300_000_000,
             "form": "10-Q", "accn": "0000320193-25-000008"},
            {"start": "2024-12-29", "end": "2025-03-29", "val": 95_359_000_000,
             "form": "10-Q", "accn": "0000320193-25-000057"},
            {"start": "2025-03-30", "end": "2025-06-28", "val": 94_036_000_000,
             "form": "10-Q", "accn": "0000320193-25-000073"},
            {"start": "2024-09-29", "end": "2025-09-27", "val": 416_161_000_000,
             "form": "10-K", "accn": "0000320193-25-000079"},
        ]},
    }

    # "Apple", not "AAPL" — deliberately not a bare uppercase ticker the regex
    # fallback in extract_tickers would catch. In production the LLM query-
    # understanding step resolves "Apple" -> AAPL into `entities` before the
    # channel ever sees the query; these tests pass that resolved entity to
    # match how the orchestrator actually calls this channel.
    QUERY = "Apple quarterly revenue for FY2023, FY2024, and FY2025 including Q4 each year"
    ENTITIES = {"companies": [{"ticker": "AAPL"}]}

    @pytest.mark.asyncio
    async def test_all_twelve_periods_come_back_not_just_the_ten_most_recent(self):
        out = await _channel(concepts={REV: self.THREE_YEAR_QUARTERLY}).search(
            self.QUERY, entities=self.ENTITIES)
        assert len(out) == 12, (
            f"expected all 3 filed quarters x 3 years + 3 derived Q4s = 12, got {len(out)}"
        )

    @pytest.mark.asyncio
    async def test_the_oldest_quarters_survive_the_cut(self):
        # These are exactly what a top_k=10 default drops first under
        # descending (fy, quarter) sort — the regression this test guards.
        out = await _channel(concepts={REV: self.THREE_YEAR_QUARTERLY}).search(
            self.QUERY, entities=self.ENTITIES)
        periods = {(r.metadata["fiscal_year"], r.metadata["fiscal_quarter"]) for r in out}
        assert (2023, 1) in periods
        assert (2023, 2) in periods

    @pytest.mark.asyncio
    async def test_every_year_gets_its_derived_q4(self):
        out = await _channel(concepts={REV: self.THREE_YEAR_QUARTERLY}).search(
            self.QUERY, entities=self.ENTITIES)
        derived_q4_years = {
            r.metadata["fiscal_year"] for r in out
            if r.metadata["fiscal_quarter"] == 4 and r.metadata["derived"]
        }
        assert derived_q4_years == {2023, 2024, 2025}

    @pytest.mark.asyncio
    async def test_derived_q4_values_match_fy_total_minus_filed_quarters(self):
        out = await _channel(concepts={REV: self.THREE_YEAR_QUARTERLY}).search(
            self.QUERY, entities=self.ENTITIES)
        by_period = {(r.metadata["fiscal_year"], r.metadata["fiscal_quarter"]): r for r in out}
        assert by_period[(2023, 4)].metadata["value"] == pytest.approx(89_498_000_000, abs=1_000_000)
        assert by_period[(2024, 4)].metadata["value"] == pytest.approx(94_930_000_000, abs=1_000_000)
        assert by_period[(2025, 4)].metadata["value"] == pytest.approx(102_466_000_000, abs=1_000_000)

    @pytest.mark.asyncio
    async def test_a_wide_year_range_is_still_bounded_not_unbounded(self):
        # Sanity check on the min(..., 60) ceiling: a query naming a huge span
        # doesn't turn into an unbounded fan-out.
        query = "AAPL quarterly revenue every year from 1998 to 2025"
        out = await _channel(concepts={REV: self.THREE_YEAR_QUARTERLY}).search(
            query, entities=self.ENTITIES)
        assert len(out) <= 60


class TestRequestHygiene:
    @pytest.mark.asyncio
    async def test_the_ticker_map_is_fetched_once_and_reused(self):
        http = _FakeHTTP(concepts={REV: ANNUAL})
        ch = EdgarSearch(http_client=http)
        await ch.search("AAPL revenue")
        await ch.search("MSFT revenue")
        assert sum("company_tickers.json" in u for u in http.urls) == 1

    @pytest.mark.asyncio
    async def test_the_concept_url_is_zero_padded_to_ten_digits(self):
        http = _FakeHTTP(concepts={REV: ANNUAL})
        await EdgarSearch(http_client=http).search("AAPL revenue")
        assert any("CIK0000320193/us-gaap/" in u for u in http.urls)

    def test_the_user_agent_comes_from_settings(self):
        from app.config import settings
        assert EdgarSearch()._ua == settings.sec_user_agent
        assert "@" in settings.sec_user_agent, "SEC requires a contact address"
