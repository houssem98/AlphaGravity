"""V3-2 gate. A fact with no unit stays unit-unknown.

`company.py` did `"unit": r.get("unit") or "USD"`. A row whose unit is NULL in the
exact-XBRL table came back out of the API asserting dollars — a currency claim the
filing never made, which the client then drew with a dollar sign. A percentage or a
per-share figure with a missing unit reads as money at 100x the magnitude.

Offline. `sb_select_all` and the SEC filing index are both stubbed, so this grades
the route's own transformation and needs no network and no database.

Run from services/gravity-api:
    python ../../docs/company-feature/gates/v3-2-gate.py
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


ROWS = [
    # A row with no unit at all — the defect's subject.
    {"metric_name": "Gross margin", "period": "FY2025", "value_float": 45.0,
     "unit": None, "filing_type": "10-K", "filing_date": "2025-09-27",
     "document_id": "xbrl:AAPL"},
    # A row whose unit is present but blank — same fact, different spelling.
    {"metric_name": "Some Ratio", "period": "FY2025", "value_float": 1.25,
     "unit": "   ", "filing_type": "10-K", "filing_date": "2025-09-27",
     "document_id": "xbrl:AAPL"},
    # A row that really is dollars, which must be untouched.
    {"metric_name": "Revenue", "period": "FY2025", "value_float": 416161000000.0,
     "unit": "USD", "filing_type": "10-K", "filing_date": "2025-09-27",
     "document_id": "xbrl:AAPL"},
    # A row in a non-currency unit, which must survive as itself.
    {"metric_name": "Shares Outstanding", "period": "FY2025", "value_float": 15_000_000_000.0,
     "unit": "shares", "filing_type": "10-K", "filing_date": "2025-09-27",
     "document_id": "xbrl:AAPL"},
]


async def main() -> int:
    import structlog
    structlog.configure(processors=[])

    from app.api.routes import company as mod

    async def fake_select_all(table, params, select=None):
        assert table == "financials", table
        return list(ROWS), False

    async def fake_index(symbol):
        return {("10-K", "2025-09-27"): {
            "accession": "0000320193-25-000073",
            "filed": "2025-10-30",
            "primary_document": "aapl-20250927.htm",
        }}, "320193", None

    mod.supabase_rest.sb_select_all = fake_select_all
    mod._filing_index = fake_index

    out = await mod.company_financials("aapl", limit=60, auth={"tier": "test"})
    by_metric = {r["metric"]: r for r in out["rows"]}

    check("the route answered for the fixture", len(out["rows"]) == len(ROWS),
          f"got {len(out['rows'])} rows for {len(ROWS)} distinct facts")

    gm = by_metric.get("Gross margin", {})
    check("a NULL unit comes back as null, not USD",
          gm.get("unit") is None,
          f"unit was {gm.get('unit')!r} — the API asserted a currency the row does not carry")
    check("the missing unit is explained rather than silently absent",
          isinstance(gm.get("unit_reason"), str) and gm["unit_reason"].strip() != "",
          f"unit_reason was {gm.get('unit_reason')!r}")
    check("the explanation does not claim the figure is dollars",
          "USD" not in (gm.get("unit_reason") or "").replace("assumed to be USD", ""),
          f"unit_reason asserts a currency: {gm.get('unit_reason')!r}")

    blank = by_metric.get("Some Ratio", {})
    check("a blank unit is treated as no unit, not as a unit named ' '",
          blank.get("unit") is None, f"unit was {blank.get('unit')!r}")
    check("the blank-unit row is explained too",
          isinstance(blank.get("unit_reason"), str) and blank["unit_reason"].strip() != "",
          f"unit_reason was {blank.get('unit_reason')!r}")

    usd = by_metric.get("Revenue", {})
    check("a real USD row is unchanged", usd.get("unit") == "USD", f"unit was {usd.get('unit')!r}")
    check("a real USD row carries no spurious explanation",
          usd.get("unit_reason") is None, f"unit_reason was {usd.get('unit_reason')!r}")

    shares = by_metric.get("Shares Outstanding", {})
    check("a non-currency unit survives as itself",
          shares.get("unit") == "shares", f"unit was {shares.get('unit')!r}")

    # ── the source no longer carries the defect ──────────────────────────────
    src = (API / "app" / "api" / "routes" / "company.py").read_text(encoding="utf-8")
    code = "\n".join(ln for ln in src.splitlines() if not ln.lstrip().startswith("#"))
    check('the `or "USD"` default is gone from the route',
          'r.get("unit") or "USD"' not in code,
          "the unit default is still in the financials route")

    return failures


if __name__ == "__main__":
    rc = asyncio.run(main())
    print(f"\nRESULT {'PASS' if rc == 0 else f'FAIL ({rc})'}")
    sys.exit(0 if rc == 0 else 1)
