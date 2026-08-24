"""
Amendments, restatements, and which filing wins.

`FIX_SECFILING.md` §7 calls this mandatory: never silently select an older filing
when an amended authoritative version supersedes it, and never silently mix an
original with a restatement.

The repository already had a policy pointing the other way — `sec_quarterly`
states "the 10-Q that reported the quarter beats a later restatement", and GS-3
pinned derived ratios to it. That module is deliberately left alone. The conflict
is instead detected in `sec_authority`, the authoritative reading is chosen for
the exact-fact answer, and the supersession is disclosed in the passage. It is
the *silence* §7 forbids, and the silence is what these tests remove.

Fixture recorded from the live SEC API on 2026-08-23: Plug Power (CIK 1093691)
`us-gaap:Revenues`, 60 points spanning 2018-2020 across forms 10-K, 10-K/A, 10-Q.
Plug Power restated 2018-2020, so one period genuinely carries three values:

    Q1 2019   10-Q    filed 2019-05-08   18,593,000   as originally reported
              10-Q    filed 2020-05-08   21,579,000   comparative, after revision
              10-K/A  filed 2022-03-14   21,510,000   the restatement

NVIDIA is used as the control: its Q3 FY2026 is reported more than once with the
*same* value, which is a comparative column and not a conflict at all.
"""

import json
from pathlib import Path

import pytest

from app.core.retrieval.edgar_search import EdgarSearch
from app.core.retrieval.sec_authority import (
    authority_key,
    base_form,
    describe,
    is_amendment,
    resolve,
)

FIX = Path(__file__).parent / "fixtures"

PLUG_CIK = 1093691
Q1_2019 = ("2019-01-01", "2019-03-31")

AS_ORIGINALLY_REPORTED = 18_593_000
AFTER_REVISION = 21_579_000
THE_RESTATEMENT = 21_510_000


def _plug_units():
    return json.loads(
        (FIX / "plug_revenues_restated.json").read_text(encoding="utf-8")
    )["units"]


class TestAmendedFormsAreRecognised:
    def test_an_amended_form_is_identified(self):
        assert is_amendment("10-Q/A")
        assert is_amendment("10-K/A")
        assert not is_amendment("10-Q")
        assert not is_amendment("10-K")

    def test_the_base_form_is_recovered(self):
        assert base_form("10-Q/A") == "10-Q"
        assert base_form("10-K/A") == "10-K"
        assert base_form("10-Q") == "10-Q"

    def test_an_amendment_outranks_its_original_filed_the_same_day(self):
        same_day = {"filed": "2020-05-08", "form": "10-Q"}
        amended = {"filed": "2020-05-08", "form": "10-Q/A"}
        assert authority_key(amended, True) > authority_key(same_day, True)

    def test_a_later_filing_outranks_an_earlier_amendment(self):
        """A restatement supersedes; recency is the more significant key."""
        old_amendment = {"filed": "2019-01-01", "form": "10-Q/A"}
        new_original = {"filed": "2022-03-14", "form": "10-Q"}
        assert authority_key(new_original, True) > authority_key(old_amendment, True)

    def test_a_quarters_own_10q_beats_a_10k_comparative_filed_the_same_day(self):
        native = {"filed": "2020-03-10", "form": "10-Q"}
        comparative = {"filed": "2020-03-10", "form": "10-K"}
        assert authority_key(native, True) > authority_key(comparative, True)
        # and the reverse for an annual question
        assert authority_key(comparative, False) > authority_key(native, False)


class TestTheRestatementWins:
    def test_the_authoritative_value_is_the_restated_one(self):
        r = resolve(_plug_units(), *Q1_2019, want_quarter=True)
        assert r["point"]["val"] == THE_RESTATEMENT

    def test_the_original_is_not_silently_served(self):
        r = resolve(_plug_units(), *Q1_2019, want_quarter=True)
        assert r["point"]["val"] != AS_ORIGINALLY_REPORTED

    def test_the_conflict_is_flagged(self):
        r = resolve(_plug_units(), *Q1_2019, want_quarter=True)
        assert r["conflict"] is True
        assert r["restated"] is True

    def test_the_superseded_readings_are_kept_for_the_citation(self):
        r = resolve(_plug_units(), *Q1_2019, want_quarter=True)
        superseded = {o["val"] for o in r["superseded"]}
        assert AS_ORIGINALLY_REPORTED in superseded
        assert AFTER_REVISION in superseded

    def test_the_winner_comes_from_the_amendment(self):
        r = resolve(_plug_units(), *Q1_2019, want_quarter=True)
        assert r["point"]["form"] == "10-K/A"
        assert r["point"]["filed"] == "2022-03-14"

    def test_the_supersession_is_stated_in_words(self):
        r = resolve(_plug_units(), *Q1_2019, want_quarter=True)
        said = describe(r)
        assert "restated" in said
        assert "10-K/A" in said
        assert "21,579,000" in said, "the reader must be told what this replaced"


class TestARepeatedFigureIsNotAConflict:
    """A period quoted again as a comparative column with the same value is the
    common case. Flagging it would make every answer carry a restatement notice."""

    def test_the_same_value_reported_twice_is_not_flagged(self):
        units = {
            "USD": [
                {"start": "2020-01-01", "end": "2020-03-31", "val": 100,
                 "form": "10-Q", "filed": "2020-05-01", "accn": "a"},
                {"start": "2020-01-01", "end": "2020-03-31", "val": 100,
                 "form": "10-K", "filed": "2021-02-01", "accn": "b"},
            ]
        }
        r = resolve(units, "2020-01-01", "2020-03-31", want_quarter=True)
        assert r["conflict"] is False
        assert r["superseded"] == []
        assert describe(r) == "", "no disclosure when nothing was superseded"

    def test_an_unreported_period_resolves_to_nothing(self):
        assert resolve(_plug_units(), "1990-01-01", "1990-03-31", True) is None


class TestTheChannelDisclosesRestatements:
    """End to end through the retrieval channel, on recorded payloads."""

    class _Fake:
        def __init__(self):
            self.units = _plug_units()

        async def get(self, url):
            class R:
                def __init__(self, payload, status=200):
                    self._p, self.status_code, self.content = payload, status, b""

                def raise_for_status(self):
                    if self.status_code >= 400:
                        raise RuntimeError("http")

                def json(self):
                    return self._p

            if "company_tickers.json" in url:
                return R({"0": {"cik_str": PLUG_CIK, "ticker": "PLUG",
                                "title": "Plug Power Inc"}})
            if url.rsplit("/", 1)[-1] == "Revenues.json":
                return R({"cik": PLUG_CIK, "tag": "Revenues", "units": self.units})
            return R(None, 404)

    async def _search(self):
        ch = EdgarSearch(http_client=self._Fake())
        return await ch.search("Plug Power revenue Q1 2019", top_k=5)

    @pytest.mark.asyncio
    async def test_the_answer_is_the_restated_figure(self):
        out = await self._search()
        assert out and out[0].metadata["value"] == THE_RESTATEMENT

    @pytest.mark.asyncio
    async def test_the_passage_tells_the_reader_it_was_restated(self):
        out = await self._search()
        assert "restated" in out[0].text
        assert "21,579,000" in out[0].text

    @pytest.mark.asyncio
    async def test_the_evidence_names_the_amending_filing(self):
        out = await self._search()
        m = out[0].metadata
        assert m["form"] == "10-K/A"
        assert m["is_amendment"] is True
        assert m["filed"] == "2022-03-14"
        assert m["conflict"] is True
        assert len(m["superseded"]) >= 2

    @pytest.mark.asyncio
    async def test_an_unrestated_company_carries_no_notice(self):
        """The NVDA control — a clean period must not acquire a restatement
        clause, or the disclosure becomes noise nobody reads."""
        from tests.test_sec_query_time_regression import _channel

        out = await _channel().search(
            "What was NVIDIA's Data Center revenue in Q3 FY2026?", top_k=5
        )
        assert out
        m = out[0].metadata
        assert m["conflict"] is False
        assert m["restated"] is False
        assert m["is_amendment"] is False
        assert "restated" not in out[0].text


class TestDerivedQuartersAreNotRestated:
    @pytest.mark.asyncio
    async def test_a_derived_quarter_keeps_its_derivation_not_an_amendment(self):
        """A backed-out Q4 is arithmetic over other rows. No single filing
        reports it, so no filing can restate it."""
        from tests.test_edgar_search import QUARTERLY, REV, _channel

        out = await _channel(concepts={REV: QUARTERLY}).search(
            "AAPL quarterly revenue 2023"
        )
        derived = [r for r in out if r.metadata.get("derived")]
        assert derived, "the fixture has no standalone Q4, so one must be derived"
        for r in derived:
            assert r.metadata["conflict"] is False
            assert "derived, not directly filed" in r.text
