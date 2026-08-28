"""Live universal-coverage check for qualitative Quick Answer questions.

The unit tests grade the channel's logic against fixtures. They cannot prove the
claim this channel exists to make — that a qualitative question about a company
the corpus never ingested is answerable from the filer's own document. That
needs sec.gov, so it lives here rather than in `tests/`.

Every ticker below is OUTSIDE the local `chunks` corpus, which holds 39. Before
this channel each of these returned nothing at all for a prose question.

    python -m eval.quick_answer.live_coverage
    python -m eval.quick_answer.live_coverage --json

Exit code is non-zero when any case returns no cited passage, so this is usable
as a gate and not only as a report.
"""

from __future__ import annotations

import argparse
import asyncio
import json
import sys
import time

from app.core.retrieval.citation_provenance import provenance
from app.core.retrieval.edgar_search import EdgarSearch
from app.core.retrieval.edgar_text_search import EdgarTextSearch

# (ticker, question, the item the question is about)
CASES: list[tuple[str, str, str]] = [
    ("TXRH", "What risks does Texas Roadhouse disclose about beef commodity costs?", "item_1a"),
    ("PLOW", "What does Douglas Dynamics say about its business and competition?", "item_1"),
    ("CAKE", "What legal proceedings does Cheesecake Factory disclose?", "item_3"),
    ("WM", "What does Waste Management discuss about liquidity and cash flow?", "item_7"),
    ("ODFL", "What does Old Dominion say about its properties and facilities?", "item_2"),
    ("KO", "What did Coca-Cola report this quarter about results of operations?", "item_2"),
    # AMD filed a 10-K/A on the same day as its FY2025 10-K. Preferring the
    # newest annual filing read the amendment, which carries no Item 1A, so this
    # question came back with exhibit boilerplate. AMD is IN the local corpus and
    # still had no 10-K there — 531 chunks, none of them the annual report.
    ("AMD", "What risk factors does AMD disclose?", "item_1a"),
]


async def run() -> dict:
    channel = EdgarTextSearch(EdgarSearch())
    rows: list[dict] = []

    for ticker, query, expected_item in CASES:
        t0 = time.perf_counter()
        row: dict = {"ticker": ticker, "query": query, "expected_item": expected_item}
        try:
            out = await channel.search(query, filters={"companies": [ticker]}, top_k=3)
        except Exception as e:
            row |= {"ok": False, "error": f"{type(e).__name__}: {str(e)[:120]}"}
            rows.append(row)
            continue

        row["latency_ms"] = round((time.perf_counter() - t0) * 1000)
        if not out:
            row |= {"ok": False, "error": "no passages"}
            rows.append(row)
            continue

        top = out[0]
        prov = provenance(top.metadata, ticker=top.ticker)
        row |= {
            # A passage with no resolvable provenance cannot be cited, so it
            # does not count as coverage however relevant its text is.
            "ok": bool(prov),
            "hits": len(out),
            "form": top.document_type,
            "item": top.metadata.get("item_id", ""),
            "section": top.section,
            "accession": (prov or {}).get("accession", ""),
            "document_url": (prov or {}).get("document_url", ""),
            "item_matched": top.metadata.get("item_id") == expected_item,
        }
        rows.append(row)

    passed = sum(1 for r in rows if r.get("ok"))
    return {
        "cases": len(rows),
        "passed": passed,
        "routed_to_expected_item": sum(1 for r in rows if r.get("item_matched")),
        "rows": rows,
    }


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--json", action="store_true")
    args = ap.parse_args()

    report = asyncio.run(run())
    if args.json:
        print(json.dumps(report, indent=2))
    else:
        for r in report["rows"]:
            if r.get("ok"):
                print(f"{r['ticker']:6} PASS {r['hits']} hits ({r['latency_ms']:6}ms) "
                      f"{r['form']:5} {r['item'] or '-':8} {r['section'][:34]:34} "
                      f"{r['accession']}")
            else:
                print(f"{r['ticker']:6} FAIL {r.get('error', '')}")
        print(f"\n{report['passed']}/{report['cases']} cited from the filer; "
              f"{report['routed_to_expected_item']} routed to the expected Item")

    return 0 if report["passed"] == report["cases"] else 1


if __name__ == "__main__":
    sys.exit(main())
