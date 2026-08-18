"""
Quarterly XBRL extraction. Every fixture below is shaped like a real
companyfacts payload; the numbers are Apple's actual FY2023 revenue, which is
what makes the Q4 derivation checkable by hand.
"""
import pytest

from app.ingestion.sources.sec_quarterly import (
    assign_period, extract_quarterly_facts, fiscal_year_end_month, filing_url,
)

CONCEPT = "RevenueFromContractWithCustomerExcludingAssessedTax"


def _pt(start, end, val, form, accn="0000320193-23-000006"):
    return {"start": start, "end": end, "val": val, "form": form, "accn": accn}


def _facts(points, concept=CONCEPT, unit="USD"):
    return {"facts": {"us-gaap": {concept: {"units": {unit: points}}}}}


APPLE_FY2023 = [
    _pt("2022-09-25", "2022-12-31", 117_154_000_000, "10-Q"),
    _pt("2023-01-01", "2023-04-01", 94_836_000_000, "10-Q"),
    _pt("2023-04-02", "2023-07-01", 81_797_000_000, "10-Q"),
    _pt("2022-09-25", "2023-09-30", 383_285_000_000, "10-K"),
]


class TestFiscalPeriodAssignment:
    def test_a_quarter_ending_in_december_belongs_to_the_next_fiscal_year(self):
        # Apple Q1 FY2023 ends 2022-12-31. Keying on the end YEAR would file it
        # under FY2022, which is the bug this function exists to avoid.
        from datetime import date
        assert assign_period(date(2022, 11, 11), fy_end_month=9) == (2023, 1)

    def test_a_quarter_ending_on_april_1_is_still_q2(self):
        # Apple's quarters end on Saturdays, so Q2 FY2023 ends 2023-04-01 and the
        # END MONTH says Q3. The span midpoint says Q2, correctly.
        from datetime import date
        assert assign_period(date(2023, 2, 14), fy_end_month=9) == (2023, 2)

    def test_a_calendar_year_company_maps_q1_to_march(self):
        from datetime import date
        assert assign_period(date(2023, 2, 14), fy_end_month=12) == (2023, 1)
        assert assign_period(date(2023, 11, 14), fy_end_month=12) == (2023, 4)

    def test_fiscal_year_end_month_is_measured_from_the_annual_spans(self):
        facts = _facts(APPLE_FY2023)
        rows = extract_quarterly_facts(facts, [2023], [CONCEPT])
        # September FY end is what makes Q1 land in FY2023 at all
        assert {(r["fy"], r["quarter"]) for r in rows} == {(2023, 1), (2023, 2), (2023, 3), (2023, 4)}

    def test_a_payload_with_no_annual_span_falls_back_to_december(self):
        assert fiscal_year_end_month([], default=12) == 12


class TestQuarterlyValues:
    def test_the_three_filed_quarters_come_back_at_their_filed_values(self):
        rows = extract_quarterly_facts(_facts(APPLE_FY2023), [2023], [CONCEPT])
        by_q = {r["quarter"]: r for r in rows}
        assert by_q[1]["value"] == 117_154_000_000
        assert by_q[2]["value"] == 94_836_000_000
        assert by_q[3]["value"] == 81_797_000_000
        assert [by_q[q]["derived"] for q in (1, 2, 3)] == [False, False, False]

    def test_each_quarter_carries_the_accession_of_the_filing_it_came_from(self):
        pts = [
            _pt("2022-09-25", "2022-12-31", 117_154_000_000, "10-Q", "0000320193-23-000006"),
            _pt("2023-01-01", "2023-04-01", 94_836_000_000, "10-Q", "0000320193-23-000064"),
            APPLE_FY2023[3],  # annual anchor: without it the FY calendar is unknown
        ]
        rows = extract_quarterly_facts(_facts(pts), [2023], [CONCEPT])
        accn = {r["quarter"]: r["accn"] for r in rows}
        assert accn[1] == "0000320193-23-000006"
        assert accn[2] == "0000320193-23-000064"

    def test_the_originally_filed_10q_beats_a_later_restatement(self):
        pts = APPLE_FY2023 + [
            _pt("2022-09-25", "2022-12-31", 999_000_000_000, "10-K", "0000320193-24-000123")]
        rows = extract_quarterly_facts(_facts(pts), [2023], [CONCEPT])
        assert {r["quarter"]: r["value"] for r in rows}[1] == 117_154_000_000


class TestDerivedQ4:
    def test_q4_is_derived_when_no_standalone_q4_is_filed(self):
        rows = extract_quarterly_facts(_facts(APPLE_FY2023), [2023], [CONCEPT])
        q4 = next(r for r in rows if r["quarter"] == 4)
        # 383.285 - (117.154 + 94.836 + 81.797) = 89.498
        assert q4["value"] == pytest.approx(89_498_000_000, abs=1_000_000)
        assert q4["derived"] is True
        assert "FY total minus Q1-Q3" in q4["derivation"]

    def test_a_derived_q4_cites_the_10k_it_was_derived_from(self):
        pts = APPLE_FY2023[:3] + [
            _pt("2022-09-25", "2023-09-30", 383_285_000_000, "10-K", "0000320193-23-000106")]
        rows = extract_quarterly_facts(_facts(pts), [2023], [CONCEPT])
        q4 = next(r for r in rows if r["quarter"] == 4)
        assert q4["accn"] == "0000320193-23-000106"
        assert q4["form"] == "10-K"

    def test_a_filed_q4_is_never_overwritten_by_a_derived_one(self):
        pts = APPLE_FY2023 + [_pt("2023-07-02", "2023-09-30", 89_498_000_000, "10-Q")]
        rows = extract_quarterly_facts(_facts(pts), [2023], [CONCEPT])
        q4 = next(r for r in rows if r["quarter"] == 4)
        assert q4["derived"] is False
        assert q4["form"] == "10-Q"

    def test_no_q4_is_derived_when_a_quarter_is_missing(self):
        pts = [APPLE_FY2023[0], APPLE_FY2023[1], APPLE_FY2023[3]]  # Q3 absent
        rows = extract_quarterly_facts(_facts(pts), [2023], [CONCEPT])
        assert all(r["quarter"] != 4 for r in rows)

    def test_no_q4_is_derived_across_mismatched_units(self):
        facts = {"facts": {"us-gaap": {CONCEPT: {"units": {
            "USD": APPLE_FY2023[:3], "EUR": [APPLE_FY2023[3]]}}}}}
        rows = extract_quarterly_facts(facts, [2023], [CONCEPT])
        assert all(r["quarter"] != 4 for r in rows)


class TestScope:
    def test_years_outside_the_request_are_dropped(self):
        rows = extract_quarterly_facts(_facts(APPLE_FY2023), [2024], [CONCEPT])
        assert rows == []

    def test_nine_month_and_annual_spans_never_appear_as_quarters(self):
        pts = ([_pt("2022-09-25", "2023-07-01", 279_787_000_000, "10-Q")]
               + APPLE_FY2023[:1] + [APPLE_FY2023[3]])
        rows = extract_quarterly_facts(_facts(pts), [2023], [CONCEPT])
        # the 9-month span is neither a quarter nor an annual, and Q4 cannot be
        # derived from a single quarter, so only Q1 survives
        assert [r["quarter"] for r in rows] == [1]

    def test_without_an_annual_span_the_fiscal_calendar_cannot_be_measured(self):
        # Documented limitation, not an accident: FY end is read off the annual
        # spans, so a payload carrying only quarters falls back to a calendar year
        # and a September-FY company lands a year early. Real companyfacts
        # payloads always carry annuals.
        # Apple's real Q1-Q3, read with no annual span to anchor the calendar:
        # Q1 (ends Dec 2022) slides back to FY2022 Q4, and Q2/Q3 slide down to
        # FY2023 Q1/Q2. Every value is still correct; only the labels are wrong.
        q = extract_quarterly_facts(_facts(APPLE_FY2023[:3]), [2022, 2023], [CONCEPT])
        assert [(r["fy"], r["quarter"]) for r in q] == [(2022, 4), (2023, 1), (2023, 2)]
        assert [r["value"] for r in q] == [117_154_000_000, 94_836_000_000, 81_797_000_000]

    def test_filing_url_points_at_the_filing_index(self):
        assert filing_url(320193, "0000320193-23-000006") == (
            "https://www.sec.gov/Archives/edgar/data/320193/"
            "000032019323000006/0000320193-23-000006-index.htm")

    def test_a_missing_accession_yields_no_url_rather_than_a_broken_one(self):
        assert filing_url(320193, "") == ""
