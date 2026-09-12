"""V3-4 gate. SEC fallback matches a period, not a substring of one.

`_fetch_from_edgar` accepted a result whenever `period in got or got in period`.
That is containment, not equality:

  * "FY2024" is a substring of "FY2024 Q4", so asking for a fiscal year accepted a
    single quarter of it — roughly a 4x understatement, rendered under the annual
    label, which is exactly the fabricated comparison company_skill's "absent" rule
    exists to prevent.
  * the guard opened with `if got and ...`, so a result carrying NO period at all
    skipped the check entirely and was accepted on search ranking alone.

Offline — EdgarSearch is stubbed, so this grades the matching rule itself.

Run from services/gravity-api:
    python ../../docs/company-feature/gates/v3-4-gate.py
"""
import asyncio
import sys
from pathlib import Path

HERE = Path(__file__).resolve()
API = HERE.parents[3] / "services" / "gravity-api"
sys.path.insert(0, str(API))

failures = 0


def check(name: str, ok: bool, detail: str = "") -> None:
    global failures
    if not ok:
        failures += 1
    print(f"{'PASS' if ok else 'FAIL'}  {name}" + (f"\n      {detail}" if detail and not ok else ""))


class Result:
    def __init__(self, metadata):
        self.metadata = metadata


async def main() -> int:
    import structlog
    structlog.configure(processors=[])

    from app.core.analytics import longitudinal_tracker as lt

    # ── the matching rule, directly ──────────────────────────────────────────
    same = lt._same_period
    check("a fiscal year does not match one of its quarters",
          not same("FY2024", "FY2024 Q4"),
          "FY2024 accepted a Q4 figure — a quarter reported under an annual label")
    check("nor the other way round",
          not same("Q4 FY2024", "FY2024"),
          "a quarter accepted the whole year's figure")
    check("an empty period matches nothing",
          not same("FY2024", ""), "a result with no period was accepted")
    check("a period that names no year matches nothing",
          not same("FY2024", "the most recent annual report"),
          "a result with no parseable period was accepted")
    check("a different year never matches",
          not same("FY2024", "FY2019"), "FY2019 was accepted for FY2024")
    check("a different quarter of the right year never matches",
          not same("Q1 2025", "Q4 2025"), "Q4 was accepted for Q1")

    check("the same fiscal year matches", same("FY2024", "FY2024"))
    check("a bare year is the same annual period as FY-prefixed",
          same("FY2024", "2024"),
          "`fiscal_year: 2024` was rejected for the period FY2024")
    check("the same quarter matches in either spelling",
          same("Q4 2025", "FY2025 Q4"),
          "two spellings of the same quarter were treated as different periods")

    # ── through the real fetch path ──────────────────────────────────────────
    calls = {"n": 0}

    def stub(results):
        class FakeSearch:
            async def search(self, *a, **k):
                calls["n"] += 1
                return results
        import app.core.retrieval.edgar_search as es
        es.EdgarSearch = FakeSearch

    stub([Result({"period": "FY2024 Q4", "value": 24_575_000_000})])
    got = await lt._fetch_from_edgar("MMM", "revenue", "FY2024")
    check("a Q4 result is rejected for an FY2024 request",
          got is None, f"_fetch_from_edgar returned {got!r} for a quarter's figure")

    stub([Result({"value": 32_681_000_000})])  # no period key at all
    got = await lt._fetch_from_edgar("MMM", "revenue", "FY2024")
    check("a result with no period is rejected",
          got is None, f"_fetch_from_edgar returned {got!r} for a period-less result")

    stub([Result({"period": "FY2024", "value": 32_681_000_000})])
    got = await lt._fetch_from_edgar("MMM", "revenue", "FY2024")
    check("an exact period match is still accepted",
          got == 32_681_000_000.0, f"_fetch_from_edgar returned {got!r} for an exact match")

    stub([Result({"fiscal_year": 2024, "value": 32_681_000_000})])
    got = await lt._fetch_from_edgar("MMM", "revenue", "FY2024")
    check("a `fiscal_year` integer is still accepted for the same year",
          got == 32_681_000_000.0, f"_fetch_from_edgar returned {got!r}")

    # The wrong result first, the right one second: the loop must keep looking
    # rather than take the top hit and stop.
    stub([
        Result({"period": "FY2019", "value": 1}),
        Result({"period": "FY2024", "value": 32_681_000_000}),
    ])
    got = await lt._fetch_from_edgar("MMM", "revenue", "FY2024")
    check("a wrong-period top hit does not block the right one",
          got == 32_681_000_000.0, f"_fetch_from_edgar returned {got!r}")

    # ── the source no longer carries the defect ──────────────────────────────
    src = (API / "app" / "core" / "analytics" / "longitudinal_tracker.py").read_text(encoding="utf-8")
    code = "\n".join(ln for ln in src.splitlines() if not ln.lstrip().startswith("#"))
    check("the containment test is gone from the source",
          "period not in got and got not in period" not in code,
          "`period in got or got in period` still decides whether a figure matches")

    return failures


if __name__ == "__main__":
    rc = asyncio.run(main())
    print(f"\nRESULT {'PASS' if rc == 0 else f'FAIL ({rc})'}")
    sys.exit(0 if rc == 0 else 1)
