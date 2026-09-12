"""V3-3 gate. Two disagreeing values for one (metric, period) are never silently
reduced to one.

The financials route dedupes on `(metric_name, period)` and keeps the first row it
sees. The comment said "later filings restate — keep the newest"; the ordering's
last tiebreak is `id.asc`, which is INGEST order and says nothing about which filing
restated what. `sec_xbrl.py` drops companyfacts' own `accn`, so the row cannot name
its own observation either. MMM holds 376 rows over 366 pairs — duplicates are
measured, not hypothetical.

V2-8 resolves (form, period end) against SEC's index, so the silently-kept row was
also getting a filing attached to it. When two values disagree, that filing names a
document that may not contain the figure shown beside it.

So: identical duplicates still collapse. Disagreeing ones are marked ambiguous, both
values are named, and NO filing is attributed.

Offline — `sb_select_all` and the filing index are stubbed.

Run from services/gravity-api:
    python ../../docs/company-feature/gates/v3-3-gate.py
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


def row(metric, period, value, form="10-K", end="2025-09-27"):
    return {"metric_name": metric, "period": period, "value_float": value,
            "unit": "USD", "filing_type": form, "filing_date": end,
            "document_id": "xbrl:MMM"}


ROWS = [
    # The conflict: one period, one metric, two different reported values. This is
    # the original-vs-restated shape, which these rows cannot tell apart.
    row("Revenue", "FY2024", 32_681_000_000.0),
    row("Revenue", "FY2024", 24_575_000_000.0),
    # The same fact reported twice, identically. Not a conflict — it collapses.
    row("Net Income", "FY2024", 4_173_000_000.0),
    row("Net Income", "FY2024", 4_173_000_000.0),
    # An undisputed fact, which must keep its filing.
    row("Operating Income", "FY2024", 6_000_000_000.0),
]

ACCESSION = "0000066740-25-000009"


async def main() -> int:
    import structlog
    structlog.configure(processors=[])

    from app.api.routes import company as mod

    async def fake_select_all(table, params, select=None):
        return list(ROWS), False

    async def fake_index(symbol):
        return {("10-K", "2025-09-27"): {
            "accession": ACCESSION, "filed": "2025-02-06",
            "primary_document": "mmm-20241231.htm",
        }}, "66740", None

    mod.supabase_rest.sb_select_all = fake_select_all
    mod._filing_index = fake_index

    out = await mod.company_financials("mmm", limit=60, auth={"tier": "test"})
    by_metric = {r["metric"]: r for r in out["rows"]}

    check("the three distinct facts collapse to three rows",
          len(out["rows"]) == 3,
          f"got {len(out['rows'])} rows: {[r['metric'] for r in out['rows']]}")

    # ── the conflict ─────────────────────────────────────────────────────────
    rev = by_metric.get("Revenue", {})
    check("a disagreeing pair is marked ambiguous",
          rev.get("ambiguous") is True,
          "two different values for one (metric, period) were silently reduced to one")

    reason = rev.get("source_reason") or ""
    check("both values are named in the row's own words",
          "32681000000" in reason.replace(",", "") or "3.2681e+10" in reason
          or "32,681,000,000" in reason,
          f"the first value is not stated: {reason!r}")
    check("the second, disagreeing value is named too",
          "24575000000" in reason.replace(",", "") or "2.4575e+10" in reason
          or "24,575,000,000" in reason,
          f"the conflicting value is not stated: {reason!r}")

    check("NO filing is attributed to an ambiguous fact",
          rev.get("accession") is None,
          f"accession {rev.get('accession')!r} was attached to a figure whose "
          "source filing is not determinable from these rows")
    check("nor a filing date",
          rev.get("filed") is None, f"filed was {rev.get('filed')!r}")
    check("nor a primary document",
          rev.get("primary_document") is None,
          f"primary_document was {rev.get('primary_document')!r}")

    # ── an identical duplicate is not a conflict ─────────────────────────────
    ni = by_metric.get("Net Income", {})
    check("the same value reported twice is NOT ambiguous",
          ni.get("ambiguous") is False,
          "an identical duplicate was reported as a disagreement")
    check("an identical duplicate keeps its filing",
          ni.get("accession") == ACCESSION,
          f"accession was {ni.get('accession')!r}")

    # ── an undisputed fact is untouched ──────────────────────────────────────
    oi = by_metric.get("Operating Income", {})
    check("an undisputed fact still names its filing",
          oi.get("accession") == ACCESSION and oi.get("ambiguous") is False,
          f"accession {oi.get('accession')!r}, ambiguous {oi.get('ambiguous')!r}")

    # ── the selection is deterministic across orderings ──────────────────────
    async def reversed_select(table, params, select=None):
        return list(reversed(ROWS)), False

    mod.supabase_rest.sb_select_all = reversed_select
    flipped = await mod.company_financials("mmm", limit=60, auth={"tier": "test"})
    frev = {r["metric"]: r for r in flipped["rows"]}.get("Revenue", {})
    check("the conflict is detected regardless of row order",
          frev.get("ambiguous") is True and frev.get("accession") is None,
          "reversing the row order hid the disagreement")

    # ── the source no longer claims to keep the newest ───────────────────────
    src = (API / "app" / "api" / "routes" / "company.py").read_text(encoding="utf-8")
    check("the route no longer claims the dedupe keeps the newest filing",
          "later filings restate — keep the newest." not in src,
          "the comment still describes behaviour the code does not have")

    return failures


if __name__ == "__main__":
    rc = asyncio.run(main())
    print(f"\nRESULT {'PASS' if rc == 0 else f'FAIL ({rc})'}")
    sys.exit(0 if rc == 0 else 1)
