"""V2-8 gate. Every figure names the filing it came from.

`GravityMetric.document_id` holds the literal "xbrl:<TICKER>" — measured
2026-09-11, 150,596 exact rows across 501 distinct document_ids, exactly one per
registrant. That identifies no filing, so `DataTab` rendered the null marker in
the Source column on every single row.

What the row DOES carry is the form and the period it was reported for, and that
pair names exactly one filing in SEC's own index. Resolving it there is a lookup,
not an inference — and where the lookup finds nothing, or finds two, the row says
so instead of showing a dash.

The gate is live against SEC. It needs network.

Run from services/gravity-api:
    .venv/Scripts/python.exe ../../docs/company-feature/gates/v2-8-gate.py
"""
import asyncio
import logging
import os
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[3]
API = ROOT / "services" / "gravity-api"
UI = ROOT / "apps" / "market-ui" / "src"
sys.path.insert(0, str(API))

for env_file in (API / ".env", ROOT / ".env"):
    if env_file.exists():
        for line in env_file.read_text(encoding="utf-8").splitlines():
            line = line.strip()
            if line and not line.startswith("#") and "=" in line:
                k, v = line.split("=", 1)
                os.environ.setdefault(k.strip(), v.strip())

import structlog  # noqa: E402
structlog.configure(wrapper_class=structlog.make_filtering_bound_logger(logging.CRITICAL))

from app.api.routes.company import company_financials  # noqa: E402

AUTH = {"user_id": "gate", "tier": "service", "api_key": "gate"}
TICKERS = ["AAPL", "NVDA", "MS"]
ACCESSION = re.compile(r"^\d{10}-\d{2}-\d{6}$")

failures = 0


def check(name: str, ok: bool, detail: str = "") -> None:
    global failures
    if not ok:
        failures += 1
    print(f"{'PASS' if ok else 'FAIL'}  {name}" + (f"\n      {detail}" if detail and not ok else ""))


def index_url(cik, accession: str) -> str:
    """The URL the client builds, rebuilt here rather than imported from it."""
    n = int(str(cik).lstrip("0") or 0)
    return (f"https://www.sec.gov/Archives/edgar/data/{n}/"
            f"{accession.replace('-', '')}/{accession}-index.htm")


async def main() -> int:
    first_url = None

    for ticker in TICKERS:
        out = await company_financials(ticker, limit=25, auth=AUTH)
        rows = out.get("rows") or []
        check(f"{ticker}: the route returns rows at all", bool(rows))
        if not rows:
            continue

        # ── every fact carries form, filing date, accession and period ──────
        missing_form = [r["metric"] for r in rows if not r.get("filing_type")]
        check(f"{ticker}: every fact names a form", not missing_form,
              f"{len(missing_form)} without: {missing_form[:3]}")

        missing_period = [r["metric"] for r in rows if not r.get("period")]
        check(f"{ticker}: every fact names a period", not missing_period,
              f"{len(missing_period)} without: {missing_period[:3]}")

        missing_end = [r["metric"] for r in rows if not r.get("period_end")]
        check(f"{ticker}: every fact names the period end it was reported for",
              not missing_end, f"{len(missing_end)} without")

        # The state this row exists to delete: a figure with neither a filing
        # nor a reason there is none. That is the bare dash.
        bare = [r["metric"] for r in rows
                if not r.get("accession") and not r.get("source_reason")]
        check(f"{ticker}: no fact is left with neither a filing nor a reason",
              not bare, f"{len(bare)} bare: {bare[:3]}")

        resolved = [r for r in rows if r.get("accession")]
        unresolved = [r for r in rows if not r.get("accession")]

        check(f"{ticker}: the lookup resolved at least one filing", bool(resolved),
              f"0 of {len(rows)} resolved; reasons: "
              f"{sorted({(r.get('source_reason') or '')[:90] for r in unresolved})}")

        malformed = [r["accession"] for r in resolved if not ACCESSION.match(r["accession"])]
        check(f"{ticker}: every accession is well formed", not malformed,
              f"{malformed[:3]}")

        # An accession is only useful with the CIK that addresses it.
        no_cik = [r["metric"] for r in resolved if not r.get("cik")]
        check(f"{ticker}: every resolved fact carries its CIK", not no_cik,
              f"{len(no_cik)} without")

        # `filed` is the real filing date. It must differ from the period end at
        # least sometimes — if it never did, the server would just be echoing the
        # mislabelled column back instead of looking anything up.
        filed_after = [r for r in resolved
                       if r.get("filed") and r.get("period_end") and r["filed"] > r["period_end"]]
        check(f"{ticker}: the filing date is later than the period it reports",
              bool(filed_after),
              "no row has filed > period_end, so `filed` is not a real lookup")

        # Every unresolved fact says WHY, in words that name the fact.
        vague = [r["metric"] for r in unresolved
                 if len((r.get("source_reason") or "").split()) < 5]
        check(f"{ticker}: an unresolved fact explains itself in a sentence",
              not vague, f"{len(vague)} with a stub reason")

        sample = resolved[0]
        print(f"      {ticker}: {len(resolved)}/{len(rows)} resolved · "
              f"{sample['filing_type']} period end {sample['period_end']} -> "
              f"{sample['accession']} filed {sample['filed']}")
        if unresolved:
            print(f"      {ticker}: {len(unresolved)} unresolved, e.g. "
                  f"{unresolved[0]['source_reason'][:120]}")

        if first_url is None:
            first_url = index_url(sample["cik"], sample["accession"])

    # ── clicking a figure opens that filing ─────────────────────────────────
    check("a filing URL was built from the resolved provenance", bool(first_url))
    if first_url:
        import httpx
        try:
            async with httpx.AsyncClient(timeout=20.0, follow_redirects=True) as c:
                r = await c.get(first_url, headers={"User-Agent": "antigravity-gate gate@example.com"})
            body = r.text
            ok = r.status_code == 200
            check("that URL is a real filing on sec.gov, fetched", ok,
                  f"{r.status_code} for {first_url}")
            check("and the page it returns is that filing's index",
                  ok and ("Filing Detail" in body or "Accession Number" in body.replace("&nbsp;", " ")),
                  f"unexpected body at {first_url}")
            print(f"      {first_url} -> {r.status_code}")
        except Exception as e:  # noqa: BLE001
            check("that URL is a real filing on sec.gov, fetched", False,
                  f"{type(e).__name__}: {e}")

    # ── the client renders all of it ────────────────────────────────────────
    # Comment-stripped: this file's own docstring describes the dash it forbids.
    tsx = (UI / "components/company/DataTab.tsx").read_text(encoding="utf-8")
    code = re.sub(r"\{?/\*[\s\S]*?\*/\}?", "", tsx)
    code = re.sub(r"^[ \t]*//.*$", "", code, flags=re.M)

    check("DataTab builds a filing URL from the accession",
          "canonicalSecUrl" in code and "m.accession" in code)
    check("DataTab renders that URL as a link out to the filing",
          "data-source-filing" in code and 'target="_blank"' in code)
    check("DataTab renders the stated reason when there is no accession",
          "data-source-unresolved" in code and "m.source_reason" in code)
    check("the bare marker survives only for a payload carrying neither",
          code.count("NULL_MARK") >= 2
          and code.index("m.source_reason") < code.rindex("NULL_MARK"),
          "the marker is still reachable ahead of the reason")

    types = (UI / "components/company/types.ts").read_text(encoding="utf-8")
    for field in ("accession", "filed", "period_end", "source_reason", "cik"):
        check(f"GravityMetric declares `{field}`", re.search(rf"\b{field}\??:", types) is not None)

    print(f"\nRESULT {'PASS' if failures == 0 else f'FAIL ({failures})'}")
    return 0 if failures == 0 else 1


if __name__ == "__main__":
    raise SystemExit(asyncio.run(main()))
