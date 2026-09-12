"""V4-1 gate. Period identity is the KIND of period plus its parts.

V3-4 replaced substring containment with equality on `(year, quarter)`. That shut
the hole it was written for and left every basis confusion open. Measured on the
V3 implementation, at commit 7419ccb:

    _same_period("FY2024",     "TTM 2024")   -> True
    _same_period("FY2024",     "2024-09-28") -> True
    _same_period("2024-09-28", "2024-12-31") -> True

A trailing-twelve-months figure accepted for a fiscal year. A balance-sheet
instant accepted for an annual duration. And one date matching a different date,
which is not a basis confusion at all, just wrong.

The client has modelled this correctly since V2-5 (`lib/periods.ts`, `PeriodBasis`).
This gate holds the server to the same contract.

V4-5 rides along at the bottom: no Pydantic model may declare a field twice.

Offline. No network, no database.

Run from services/gravity-api:
    python ../../docs/company-feature/gates/v4-1-gate.py
"""
import ast
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


def main() -> int:
    import structlog
    structlog.configure(processors=[])

    from app.core.analytics.longitudinal_tracker import (
        PeriodBasis, parse_period, _same_period,
    )

    # ── the basis of each label ──────────────────────────────────────────────
    for label, want in [
        ("FY2024", PeriodBasis.ANNUAL),
        ("2024", PeriodBasis.ANNUAL),
        ("FY 2024", PeriodBasis.ANNUAL),
        ("Q4 2024", PeriodBasis.QUARTERLY),
        ("FY2024 Q4", PeriodBasis.QUARTERLY),
        ("Q4 FY2024", PeriodBasis.QUARTERLY),
        ("TTM 2024", PeriodBasis.TTM),
        ("TTM FY2024", PeriodBasis.TTM),
        ("LTM 2024", PeriodBasis.TTM),
        ("2024-09-28", PeriodBasis.INSTANT),
        ("2024-12-31", PeriodBasis.INSTANT),
        ("", PeriodBasis.UNKNOWN),
        ("the most recent annual report", PeriodBasis.UNKNOWN),
    ]:
        got = parse_period(label).basis
        check(f"{label!r:32} parses as {want.value}", got is want, f"parsed as {got}")

    # ── an instant keeps its date, and no year is invented for it ────────────
    inst = parse_period("2024-09-28")
    check("an instant carries its exact date", inst.date == "2024-09-28",
          f"date was {inst.date!r}")

    q = parse_period("FY2024 Q4")
    check("a quarter carries its year and quarter", (q.year, q.quarter) == (2024, 4),
          f"got {(q.year, q.quarter)}")

    # ── THE THREE DEFECTS ────────────────────────────────────────────────────
    check("a fiscal year is NOT a trailing-twelve-months window",
          not _same_period("FY2024", "TTM 2024"),
          "a TTM figure was accepted for FY2024 - V3-4's implementation returned True here")
    check("nor the other way round", not _same_period("TTM 2024", "FY2024"))
    check("a TTM window is not the bare year either",
          not _same_period("TTM 2024", "2024"))

    check("a fiscal year is NOT an instant that falls inside it",
          not _same_period("FY2024", "2024-09-28"),
          "a balance-sheet date was accepted as an annual duration")
    check("nor is an instant a fiscal year", not _same_period("2024-09-28", "FY2024"))

    check("one date is NOT another date",
          not _same_period("2024-09-28", "2024-12-31"),
          "two different instants matched each other")

    # ── what must still match ────────────────────────────────────────────────
    check("FY2024 is the bare year 2024", _same_period("FY2024", "2024"))
    check("an instant matches itself", _same_period("2024-09-28", "2024-09-28"))
    check("two spellings of one quarter match", _same_period("Q4 2024", "FY2024 Q4"))
    check("V3-4 stays closed: a year is not its own quarter",
          not _same_period("FY2024", "FY2024 Q4"))
    check("a different year never matches", not _same_period("FY2024", "FY2019"))
    check("a different quarter never matches", not _same_period("Q1 2025", "Q4 2025"))

    # ── unknown matches nothing, including another unknown ───────────────────
    check("an empty label matches nothing", not _same_period("FY2024", ""))
    check("an empty label does not even match itself", not _same_period("", ""))
    check("two unreadable labels are not thereby the same period",
          not _same_period("whenever", "whenever"),
          "two labels we cannot read were called the same period")

    # ── the source no longer carries the (year, quarter) key ─────────────────
    src = (API / "app" / "core" / "analytics" / "longitudinal_tracker.py").read_text(encoding="utf-8")
    code = "\n".join(ln for ln in src.splitlines() if not ln.lstrip().startswith("#"))
    check("the bare (year, quarter) tuple key is gone",
          "return (int(year.group(0)), int(quarter.group(1)) if quarter else None)" not in code,
          "the V3-4 tuple key is still what decides period identity")
    check("basis is part of the model", "class PeriodBasis" in code)
    check("instants are representable", "INSTANT" in code)

    # ── V4-5 · no model declares a field twice ───────────────────────────────
    schema = (API / "app" / "api" / "schemas" / "search.py")
    tree = ast.parse(schema.read_text(encoding="utf-8"))
    dupes: dict[str, list[str]] = {}
    for node in ast.walk(tree):
        if isinstance(node, ast.ClassDef):
            names = [n.target.id for n in node.body
                     if isinstance(n, ast.AnnAssign) and isinstance(n.target, ast.Name)]
            d = sorted({n for n in names if names.count(n) > 1})
            if d:
                dupes[node.name] = d
    check("no Pydantic model in search.py declares a field twice",
          not dupes,
          f"Pydantic silently keeps the LAST declaration: {dupes}")

    return failures


if __name__ == "__main__":
    rc = main()
    print(f"\nRESULT {'PASS' if rc == 0 else f'FAIL ({rc})'}")
    sys.exit(0 if rc == 0 else 1)
