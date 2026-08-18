"""
Per-quarter XBRL facts from SEC companyfacts, each carrying the accession number
of the filing it came from.

The annual path in `sec_xbrl.py` throws quarters away on purpose (`days < 330`),
so this is a separate reader rather than a flag: GS-3 pinned derived ratios to
the annual rows and nothing here may perturb that.

Two things make quarter assignment harder than reading `fy`/`fp` off the payload:

  * companyfacts `fy`/`fp` describe the FILING, not the data point. A FY2023 10-K
    tags its FY2021 comparatives as fy=2023 too.
  * Apple's Q1 FY2023 ENDS 2022-12-31, so the end year is not the fiscal year, and
    its quarters end on Saturdays (Q2 FY2023 ends 2023-04-01), so the end month is
    not the fiscal quarter either.

Both fall out of keying on the span MIDPOINT against the company's own fiscal
year-end month, which is itself measured from the annual spans in the payload.
"""
from __future__ import annotations

from datetime import date, timedelta

QUARTER_MIN_DAYS = 80
QUARTER_MAX_DAYS = 100
ANNUAL_MIN_DAYS = 330
ANNUAL_MAX_DAYS = 400


def _d(s: str) -> date:
    return date.fromisoformat(s[:10])


def fiscal_year_end_month(points: list[dict], default: int = 12) -> int:
    """Most common end month across annual spans — the company's FY end."""
    months: dict[int, int] = {}
    for p in points:
        if ANNUAL_MIN_DAYS <= p["days"] <= ANNUAL_MAX_DAYS:
            months[p["end"].month] = months.get(p["end"].month, 0) + 1
    if not months:
        return default
    return max(months.items(), key=lambda kv: (kv[1], kv[0]))[0]


def assign_period(mid: date, fy_end_month: int) -> tuple[int, int]:
    """(fiscal_year, quarter) for a span midpoint. Q1 starts the month after FY end."""
    fy = mid.year + 1 if mid.month > fy_end_month else mid.year
    quarter = ((mid.month - fy_end_month - 1) % 12) // 3 + 1
    return fy, quarter


def _duration_points(facts: dict, concepts: list[str] | None) -> dict[str, list[dict]]:
    usgaap = (facts.get("facts", {}) or {}).get("us-gaap", {}) or {}
    concepts = concepts if concepts is not None else list(usgaap.keys())
    by_concept: dict[str, list[dict]] = {}
    for concept in concepts:
        node = usgaap.get(concept)
        if not node:
            continue
        rows = []
        for unit, points in (node.get("units", {}) or {}).items():
            for p in points:
                start, end = p.get("start", ""), p.get("end", "")
                if not start or not end or p.get("val") is None:
                    continue
                try:
                    d0, d1 = _d(start), _d(end)
                except ValueError:
                    continue
                rows.append({
                    "start": d0, "end": d1, "days": (d1 - d0).days,
                    "mid": d0 + timedelta(days=(d1 - d0).days // 2),
                    "val": p.get("val"), "unit": unit,
                    "form": p.get("form", ""), "accn": p.get("accn", ""),
                })
        if rows:
            by_concept[concept] = rows
    return by_concept


def extract_quarterly_facts(facts: dict, fiscal_years: list[int],
                            concepts: list[str] | None = None) -> list[dict]:
    """
    Per-quarter values for flow concepts, with Q4 derived where the issuer files
    no standalone Q4 10-Q (Apple among them — its Q4 exists only inside the 10-K).

    Derived rows are marked `derived=True` and carry the arithmetic in
    `derivation`; they are never presented as a figure lifted from a filing.
    """
    by_concept = _duration_points(facts, concepts)
    all_points = [p for rows in by_concept.values() for p in rows]
    fy_end_month = fiscal_year_end_month(all_points)
    wanted = set(fiscal_years)
    out: list[dict] = []

    for concept, rows in by_concept.items():
        quarters: dict[tuple[int, int], dict] = {}
        annual: dict[int, dict] = {}
        for p in rows:
            fy, q = assign_period(p["mid"], fy_end_month)
            if fy not in wanted:
                continue
            if QUARTER_MIN_DAYS <= p["days"] <= QUARTER_MAX_DAYS:
                cur = quarters.get((fy, q))
                # the 10-Q that reported the quarter beats a later restatement
                if cur is None or (p["form"] == "10-Q" and cur["form"] != "10-Q"):
                    quarters[(fy, q)] = p
            elif ANNUAL_MIN_DAYS <= p["days"] <= ANNUAL_MAX_DAYS:
                cur = annual.get(fy)
                if cur is None or (p["form"] == "10-K" and cur["form"] != "10-K"):
                    annual[fy] = p

        for (fy, q), p in sorted(quarters.items()):
            out.append({
                "concept": concept, "fy": fy, "quarter": q, "value": p["val"],
                "unit": p["unit"], "form": p["form"], "accn": p["accn"],
                "start": p["start"].isoformat(), "end": p["end"].isoformat(),
                "derived": False, "derivation": "",
            })

        # Q4 = FY - (Q1+Q2+Q3), only when all three exist and Q4 was never filed.
        for fy, a in annual.items():
            if (fy, 4) in quarters:
                continue
            three = [quarters.get((fy, q)) for q in (1, 2, 3)]
            if not all(three) or len({p["unit"] for p in three} | {a["unit"]}) != 1:
                continue
            try:
                q4 = float(a["val"]) - sum(float(p["val"]) for p in three)
            except (TypeError, ValueError):
                continue
            out.append({
                "concept": concept, "fy": fy, "quarter": 4, "value": q4,
                "unit": a["unit"], "form": a["form"], "accn": a["accn"],
                "start": three[2]["end"].isoformat(), "end": a["end"].isoformat(),
                "derived": True,
                "derivation": "FY total minus Q1-Q3 (no standalone Q4 10-Q is filed)",
            })
    return sorted(out, key=lambda r: (r["concept"], r["fy"], r["quarter"]))


def filing_url(cik: int | str, accn: str) -> str:
    """Index page for the filing an accession number names."""
    if not accn:
        return ""
    return (f"https://www.sec.gov/Archives/edgar/data/{int(cik)}/"
            f"{accn.replace('-', '')}/{accn}-index.htm")
