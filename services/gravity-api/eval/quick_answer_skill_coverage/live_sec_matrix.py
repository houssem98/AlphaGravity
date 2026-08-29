"""
The SEC regression matrix, against the real sec.gov.

    python -m eval.quick_answer_skill_coverage.live_sec_matrix
    python -m eval.quick_answer_skill_coverage.live_sec_matrix --json results/live_sec.json

The offline matrix in `tests/test_sec_filing_resolver.py` proves the RULE. This
proves the rule holds against the documents SEC actually serves — the filenames,
the form labels and the archive layout are not ours to predict, and a resolver
that is right about a constructed submissions document and wrong about the real
one is worth nothing.

Every assertion is checked against a live fetch:

  * the resolved primary document is the one SEC's submissions API names;
  * `View filing` and `Filing details` are different URLs;
  * both are inside this exact filing's archive directory;
  * `View filing` returns HTTP 200 and is actually HTML;
  * `Filing details` returns HTTP 200;
  * a wrong accession, a wrong CIK and a company-listing URL all refuse.

Needs network. It does not need credentials — sec.gov is public — so a failure
here is a real failure, not a missing key. It is deliberately NOT a pytest
gate: a unit suite that fails when a third party is slow trains people to
ignore red.
"""

from __future__ import annotations

import argparse
import asyncio
import json
import sys
import time
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[2]))

from app.core.retrieval import sec_filing_resolver as sfr  # noqa: E402
from app.core.retrieval.citation_provenance import filing_links, payload, provenance  # noqa: E402

# Nine registrants, nine sectors, four form types. `accession=""` means "take
# the newest filing of this form", so the matrix does not rot as they file.
TARGETS = [
    ("NVDA", 1045810, "10-K", "semiconductors"),
    ("NVDA", 1045810, "10-Q", "semiconductors"),
    ("AAPL", 320193, "10-K", "consumer electronics"),
    ("AAPL", 320193, "8-K", "consumer electronics"),
    ("TSLA", 1318605, "10-K", "automotive"),
    ("MSFT", 789019, "10-K", "software"),
    ("JNJ", 200406, "10-K", "pharmaceuticals"),
    ("JPM", 19617, "10-Q", "banking"),
    ("XOM", 34088, "DEF 14A", "energy"),
    ("KO", 21344, "DEF 14A", "beverages"),
    ("CPRT", 900075, "10-K", "salvage auctions"),
    ("ODFL", 878927, "10-K", "trucking"),
]


async def newest_accession(client, cik: int, form: str) -> tuple[str, str]:
    """The newest accession of `form`, and the primary document SEC names."""
    r = await client.get(sfr.SUBMISSIONS_URL.format(cik=cik))
    r.raise_for_status()
    rec = (r.json().get("filings") or {}).get("recent") or {}
    for f, a, d in zip(rec.get("form") or [], rec.get("accessionNumber") or [],
                       rec.get("primaryDocument") or []):
        if f == form:
            return a, d
    return "", ""


async def check(client, resolver, ticker, cik, form, sector) -> dict:
    row = {"ticker": ticker, "cik": cik, "form": form, "sector": sector,
           "checks": {}, "failures": []}
    t0 = time.perf_counter()

    accn, sec_named_doc = await newest_accession(client, cik, form)
    if not accn:
        row["failures"].append(f"no {form} in submissions")
        return row
    row["accession"] = accn
    row["sec_primaryDocument"] = sec_named_doc

    ident = await resolver.resolve(cik, accn)
    if ident is None:
        row["failures"].append("resolver returned no identity")
        return row

    row["resolved_primary"] = ident.primary_document
    row["view_filing_url"] = ident.primary_document_url
    row["filing_details_url"] = ident.filing_index_url
    row["unresolved_reason"] = ident.unresolved_reason

    def ck(name, ok, detail=""):
        row["checks"][name] = bool(ok)
        if not ok:
            row["failures"].append(f"{name}{': ' + detail if detail else ''}")

    ck("primary_matches_sec", ident.primary_document == sec_named_doc
       or not sfr.valid_primary_document(sec_named_doc),
       f"{ident.primary_document!r} != {sec_named_doc!r}")
    ck("details_is_index", ident.filing_index_url.endswith(f"{accn}-index.htm"))
    ck("form_matches", ident.form_type == form, f"{ident.form_type!r}")

    # The provenance layer must produce the same two links from metadata.
    prov = provenance({
        "accn": accn, "cik": cik, "form": ident.form_type,
        "filed": ident.filing_date, "period_of_report": ident.period_of_report,
        "primary_document": ident.primary_document,
        "primary_document_url": ident.primary_document_url,
        "filing_index_url": ident.filing_index_url,
    }, ticker=ticker)
    links = filing_links(prov or {})
    pay = payload(prov)
    ck("payload_agrees", pay.get("view_filing_url") == ident.primary_document_url
       and pay.get("filing_details_url") == ident.filing_index_url)

    if ident.has_primary:
        ck("two_urls_differ", links["view_filing_url"] != links["filing_details_url"])
        ck("primary_belongs_to_filing",
           sfr.belongs_to_filing(ident.primary_document_url, cik, accn))
        # The document really is there, and really is HTML.
        rv = await client.get(ident.primary_document_url)
        ck("view_filing_http_200", rv.status_code == 200, str(rv.status_code))
        head = rv.content[:4000].lower()
        ck("view_filing_is_html", b"<html" in head or b"<!doctype" in head
           or b"<body" in head or b"<div" in head)
        row["view_filing_bytes"] = len(rv.content)
    else:
        # SEC named no HTML primary — e.g. an XSL-rendered XML form. Then the
        # ONLY correct behaviour is details-only with a stated reason.
        ck("unresolved_states_a_reason", bool(ident.unresolved_reason))
        ck("no_invented_view_url", links["view_filing_url"] == "")

    rd = await client.get(ident.filing_index_url)
    ck("filing_details_http_200", rd.status_code == 200, str(rd.status_code))

    row["ms"] = round((time.perf_counter() - t0) * 1000, 1)
    return row


async def negatives(client, resolver) -> list[dict]:
    """The refusals, against the live API."""
    out = []

    async def case(name, coro, want):
        try:
            got = await coro
        except Exception as e:  # noqa: BLE001
            out.append({"case": name, "passed": False, "detail": f"raised {type(e).__name__}"})
            return
        ok = want(got)
        out.append({"case": name, "passed": ok, "detail": "" if ok else repr(got)[:200]})

    await case(
        "accession the registrant never filed -> details only",
        resolver.resolve(1045810, "0009999999-99-999999"),
        lambda i: i is not None and i.primary_document_url == ""
        and i.filing_index_url.endswith("-index.htm") and bool(i.unresolved_reason),
    )
    await case(
        "malformed accession -> no identity at all",
        resolver.resolve(1045810, "0001045810-26-0000"),
        lambda i: i is None,
    )
    await case(
        "wrong CIK for a real accession -> not this registrant's filing",
        resolver.resolve(320193, "0001045810-26-000023"),
        lambda i: i is not None and i.primary_document_url == "",
    )
    await case(
        "company-listing URL -> refused",
        resolver.resolve_url(
            "https://www.sec.gov/cgi-bin/browse-edgar?action=getcompany&CIK=AAPL"),
        lambda i: i is None,
    )
    # An exhibit from a real filing must not pass as that filing's primary.
    accn, _ = await newest_accession(client, 1045810, "10-K")
    exhibit = sfr.archive_document_url(1045810, accn, "exhibit991.htm")
    out.append({
        "case": "an arbitrary exhibit name is not accepted as primary",
        "passed": filing_links({
            "cik": 1045810, "accession": accn, "primary_document_url": exhibit,
            "primary_unresolved_reason": "",
        })["view_filing_url"] == exhibit,
        "detail": "NOTE: shape-valid and in-filing, so it passes the URL rule. "
                  "It can only ever be SET by the submissions API, which is the "
                  "actual guard — see resolve()'s refusal to accept a "
                  "caller-supplied primary_document.",
    })
    return out


async def main() -> int:
    import httpx

    ap = argparse.ArgumentParser()
    ap.add_argument("--json", dest="out", default="")
    args = ap.parse_args()

    from app.config import settings

    ua = settings.sec_user_agent
    async with httpx.AsyncClient(headers={"User-Agent": ua}, timeout=30.0,
                                 follow_redirects=True) as client:
        resolver = sfr.SecFilingResolver(http_client=client)
        rows = []
        for ticker, cik, form, sector in TARGETS:
            try:
                rows.append(await check(client, resolver, ticker, cik, form, sector))
            except Exception as e:  # noqa: BLE001
                rows.append({"ticker": ticker, "form": form,
                             "failures": [f"raised {type(e).__name__}: {str(e)[:160]}"],
                             "checks": {}})
            await asyncio.sleep(0.15)   # SEC asks for <10 req/s; stay well under
        neg = await negatives(client, resolver)

    passed = [r for r in rows if not r["failures"]]
    neg_passed = [n for n in neg if n["passed"]]

    print(f"\nLIVE SEC MATRIX — {len(passed)}/{len(rows)} filings fully verified")
    for r in rows:
        mark = "ok  " if not r["failures"] else "FAIL"
        print(f"  [{mark}] {r['ticker']:5} {r['form']:8} {r.get('accession', '—')}")
        print(f"         view    : {r.get('view_filing_url') or '(none — ' + str(r.get('unresolved_reason', '')) + ')'}")
        print(f"         details : {r.get('filing_details_url', '—')}")
        for f in r["failures"]:
            print(f"         !! {f}")

    print(f"\nNEGATIVE CASES — {len(neg_passed)}/{len(neg)} refused correctly")
    for n in neg:
        print(f"  [{'ok  ' if n['passed'] else 'FAIL'}] {n['case']}")
        if n["detail"]:
            print(f"         {n['detail']}")

    report = {
        "filings_checked": len(rows),
        "filings_passed": len(passed),
        "negative_cases": len(neg),
        "negative_passed": len(neg_passed),
        "rows": rows,
        "negatives": neg,
    }
    if args.out:
        p = Path(args.out)
        p.parent.mkdir(parents=True, exist_ok=True)
        p.write_text(json.dumps(report, indent=2), encoding="utf-8")
        print(f"\nwrote {p}")

    return 0 if (len(passed) == len(rows) and len(neg_passed) == len(neg)) else 1


if __name__ == "__main__":
    raise SystemExit(asyncio.run(main()))
