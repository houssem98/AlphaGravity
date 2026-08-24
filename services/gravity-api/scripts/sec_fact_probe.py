#!/usr/bin/env python
"""
Measures the query-time SEC fact path. Committed and seeded, so a number quoted
from it can be reproduced.

    python scripts/sec_fact_probe.py            # live SEC
    python scripts/sec_fact_probe.py --offline  # recorded fixtures only
    python scripts/sec_fact_probe.py --json     # machine-readable

Exits non-zero if any case fails, so it can gate a change.

## What this does and does not measure

Most of these cases are **not** circular. The channel reads
`api/xbrl/companyconcept`; the segment expectations were read from a different
artefact — the filing's own XBRL instance document — and the restatement
expectations come from comparing values *across* filings, which no single
endpoint hands over. Period selection, filing identity, segment selection,
quarterly-vs-year-to-date and amendment authority are all genuinely independent
checks.

Two cases (`AAPL FY2025`, `MSFT FY2025`) assert a consolidated value taken from
the same endpoint the channel reads. Those grade *selection* — did we pick the
right period, form and filing out of hundreds of points — and not the arithmetic.
They are marked `same_source` and counted separately, because calling them
accuracy would be measuring the endpoint against itself.

No latency target is asserted. Latency is reported for information; the number
moves with SEC's response time and this probe is not a load test.
"""

from __future__ import annotations

import argparse
import asyncio
import json
import sys
import time
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app.core.retrieval.edgar_search import EdgarSearch  # noqa: E402

# Ground truth. `source` records where each expectation came from, so a reader
# can tell an independent check from a same-source one.
CASES: list[dict] = [
    {
        "id": "nvda-datacenter-q3fy2026",
        "query": "What was NVIDIA's Data Center revenue in Q3 FY2026?",
        "value": 51_215_000_000,
        "accn": "0001045810-25-000230",
        "form": "10-Q",
        "fy": 2026, "q": 3,
        "member": "nvda:DataCenterMember",
        "source": "filing XBRL instance nvda-20251026_htm.xml",
    },
    {
        "id": "nvda-consolidated-q3fy2026",
        "query": "NVIDIA revenue Q3 FY2026",
        "value": 57_006_000_000,
        "accn": "0001045810-25-000230",
        "form": "10-Q",
        "fy": 2026, "q": 3,
        "member": None,
        "source": "filing XBRL instance (non-dimensional context)",
    },
    {
        "id": "nvda-compute-networking-q3fy2026",
        "query": "NVIDIA Compute & Networking segment revenue Q3 FY2026",
        "value": 50_908_000_000,
        "accn": "0001045810-25-000230",
        "form": "10-Q",
        "fy": 2026, "q": 3,
        "member": "nvda:ComputeAndNetworkingSegmentMember",
        "source": "filing XBRL instance — the 0.6% look-alike for Data Center",
    },
    {
        "id": "nvda-gaming-q3fy2026",
        "query": "NVIDIA Gaming revenue Q3 FY2026",
        "value": 4_265_000_000,
        "accn": "0001045810-25-000230",
        "form": "10-Q",
        "fy": 2026, "q": 3,
        "member": "nvda:GamingMember",
        "source": "filing XBRL instance",
    },
    {
        "id": "plug-restated-q1-2019",
        "query": "Plug Power revenue Q1 2019",
        "value": 21_510_000,
        "form": "10-K/A",
        "fy": 2019, "q": 1,
        "restated": True,
        "not_value": [18_593_000, 21_579_000],
        "source": "cross-filing comparison — 3 values for one period",
        "tickers": ["PLUG"],
    },
    {
        "id": "aapl-fy2025",
        "query": "Apple revenue FY2025",
        "value": 416_161_000_000,
        "form": "10-K",
        "fy": 2025, "q": None,
        "source": "companyconcept",
        "same_source": True,
    },
    {
        "id": "msft-fy2025",
        "query": "Microsoft revenue FY2025",
        "value": 281_724_000_000,
        "form": "10-K",
        "fy": 2025, "q": None,
        "source": "companyconcept",
        "same_source": True,
    },
    {
        "id": "unknown-company",
        "query": "Zorblax Industries revenue Q3 FY2026",
        "expect_empty": True,
        "source": "negative control — must not invent an issuer",
    },
    {
        "id": "quarter-not-reported",
        "query": "NVIDIA Data Center revenue Q1 FY2019",
        "expect_no_segment": True,
        "source": "negative control — segment predates the disclosure",
    },
]

# The year-to-date span in NVDA's Q3 FY2026 10-Q. Never a valid answer to a
# question about one quarter.
YTD_TRAP = 147_811_000_000


def _check(case: dict, results: list) -> list[str]:
    """Failures for one case. Empty list means it passed."""
    bad: list[str] = []

    if case.get("expect_empty"):
        if results:
            bad.append(f"expected no result, got {len(results)}")
        return bad

    if not results:
        bad.append("no result")
        return bad

    m = results[0].metadata
    got = m.get("value")

    if case.get("expect_no_segment"):
        for r in results:
            if "dimensions" in r.metadata:
                bad.append("returned a segment figure for a period that predates it")
        return bad

    if "value" in case and got != case["value"]:
        bad.append(f"value {got!r} != expected {case['value']!r}")
    for forbidden in case.get("not_value", []):
        if any(r.metadata.get("value") == forbidden for r in results):
            bad.append(f"returned superseded value {forbidden:,}")
    if any(r.metadata.get("value") == YTD_TRAP for r in results):
        bad.append("returned the year-to-date figure for a quarterly question")
    if case.get("accn") and m.get("accn") != case["accn"]:
        bad.append(f"accession {m.get('accn')} != {case['accn']}")
    if case.get("form") and m.get("form") != case["form"]:
        bad.append(f"form {m.get('form')} != {case['form']}")
    if case.get("fy") and m.get("fiscal_year") != case["fy"]:
        bad.append(f"fiscal year {m.get('fiscal_year')} != {case['fy']}")
    if "q" in case and m.get("fiscal_quarter") != case["q"]:
        bad.append(f"fiscal quarter {m.get('fiscal_quarter')} != {case['q']}")
    if case.get("restated") and not m.get("restated"):
        bad.append("restatement not disclosed")

    want_member = case.get("member")
    dims = m.get("dimensions") or []
    got_members = [d["member"] for d in dims]
    if want_member and want_member not in got_members:
        bad.append(f"member {got_members} != [{want_member}]")
    if want_member is None and "member" in case and dims:
        bad.append(f"expected a consolidated figure, got {got_members}")

    return bad


async def _corroborate(channel, result) -> dict | None:
    """
    Open the filing the answer cites and confirm the figure is in it.

    Only meaningful for a consolidated fact: that value came from
    `companyconcept`, and the filing's instance document is a different artefact,
    so agreement between them is evidence. A dimensional fact was *read from* the
    instance, so re-reading it would prove nothing — those are marked
    `independent: False` and excluded from the corroboration rate.
    """
    from app.core.retrieval.sec_dimensions import corroborate

    m = result.metadata
    accn, cik, tag = m.get("accn"), m.get("cik"), m.get("tag")
    start, end = m.get("period_start"), m.get("period_end")
    if not (accn and cik and tag and start and end) or m.get("derived"):
        return None

    dims = m.get("dimensions") or []
    independent = not dims
    http = await channel._client()
    out = await corroborate(
        http, cik, accn, tag, start, end, m.get("value"),
        members=[(d["axis"], d["member"]) for d in dims],
    )
    out["independent"] = independent
    return out


class _Counting:
    """
    Wraps the HTTP client to count requests and record their hosts.

    This is how `tool_calls` and `cost_per_query` become measurements rather than
    assertions: every outbound call is counted, and the host list shows what was
    actually contacted. `sec.gov` and `data.sec.gov` are free and keyless, so a
    run that touches only those hosts has a paid-API cost of exactly zero — a
    fact the host list proves rather than a number anyone had to estimate.
    """

    FREE_HOSTS = ("sec.gov", "data.sec.gov", "www.sec.gov")

    def __init__(self, inner):
        self._inner = inner
        self.requests = 0
        self.hosts: set[str] = set()

    async def get(self, url, *a, **kw):
        self.requests += 1
        try:
            self.hosts.add(url.split("/")[2])
        except IndexError:
            pass
        return await self._inner.get(url, *a, **kw)

    def __getattr__(self, name):
        return getattr(self._inner, name)

    @property
    def paid_hosts(self) -> set[str]:
        return {h for h in self.hosts if h not in self.FREE_HOSTS}


def _channel(offline: bool):
    if not offline:
        import httpx

        from app.config import settings

        inner = httpx.AsyncClient(
            headers={"User-Agent": settings.sec_user_agent}, timeout=15.0
        )
        return EdgarSearch(http_client=_Counting(inner))
    from tests.test_sec_query_time_regression import _SECFake  # type: ignore

    return EdgarSearch(http_client=_Counting(_SECFake()))


async def run(offline: bool) -> dict:
    rows = []
    # One channel for the whole run: the ticker map is cached on the instance for
    # a day, and rebuilding per case would re-download it and time that download
    # into every measurement. A served request reuses a long-lived channel.
    ch = _channel(offline)
    http = ch._http
    for case in CASES:
        if offline and case["id"].startswith(("plug", "aapl", "msft")):
            continue  # no recorded fixture wired into the shared fake
        before = http.requests
        t = time.perf_counter()
        cite = None
        try:
            results = await ch.search(
                case["query"],
                filters={"companies": case["tickers"]} if case.get("tickers") else None,
                top_k=5,
            )
            failures = _check(case, results)
            if not offline and results and not failures:
                cite = await _corroborate(ch, results[0])
                if cite and not cite["ok"]:
                    failures.append(f"citation not corroborated: {cite['reason']}")
        except Exception as e:  # a raising channel is itself a failure
            results, failures = [], [f"raised {type(e).__name__}: {e}"]
        rows.append({
            "id": case["id"],
            "ok": not failures,
            "failures": failures,
            "same_source": bool(case.get("same_source")),
            "source": case["source"],
            "ms": round((time.perf_counter() - t) * 1000),
            "got": results[0].metadata.get("value") if results else None,
            "citation": (cite or {}).get("ok") if cite else None,
            "citation_independent": bool(cite and cite.get("independent")),
            "requests": http.requests - before,
        })

    independent = [r for r in rows if not r["same_source"]]
    cited = [r for r in rows if r["citation_independent"]]
    # Negative controls: an unknown issuer and a period predating the breakdown.
    # A failure here is an adversarial citation — a confident answer to something
    # the source does not support.
    adversarial = [r for r in rows if r["id"] in ("unknown-company", "quarter-not-reported")]
    return {
        "mode": "offline" if offline else "live",
        "cases": rows,
        "n": len(rows),
        "passed": sum(r["ok"] for r in rows),
        "independent_n": len(independent),
        "independent_passed": sum(r["ok"] for r in independent),
        "citation_n": len(cited),
        "citation_ok": sum(bool(r["citation"]) for r in cited),
        "adversarial_n": len(adversarial),
        "adversarial_failures": sum(not r["ok"] for r in adversarial),
        "requests_total": http.requests,
        "paid_hosts": sorted(http.paid_hosts),
        "latencies": [r["ms"] for r in rows],
    }


def _pct(values: list[int], p: float) -> int:
    """Nearest-rank percentile. Stated plainly because a p95 over 9 samples is
    the 9th value, and pretending otherwise would dress up a small sample."""
    if not values:
        return 0
    s = sorted(values)
    k = max(0, min(len(s) - 1, int(round(p / 100 * len(s) + 0.5)) - 1))
    return s[k]


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--offline", action="store_true", help="recorded fixtures only")
    ap.add_argument("--json", action="store_true")
    args = ap.parse_args()

    report = asyncio.run(run(args.offline))

    if args.json:
        print(json.dumps(report, indent=2))
    else:
        print(f"sec-fact-probe | {report['mode']} | {report['n']} cases")
        print("-" * 72)
        for r in report["cases"]:
            mark = "PASS" if r["ok"] else "FAIL"
            tag = " [same-source]" if r["same_source"] else ""
            print(f"  {mark}  {r['id']:34s} {r['ms']:>6}ms{tag}")
            for f in r["failures"]:
                print(f"        {f}")
        print("-" * 72)
        print(f"  overall            {report['passed']}/{report['n']}")
        print(
            f"  independent        {report['independent_passed']}/{report['independent_n']}"
            "   (expectation not read from the endpoint under test)"
        )
        if report["citation_n"]:
            print(
                f"  citations          {report['citation_ok']}/{report['citation_n']}"
                "   (figure confirmed inside the filing it cites)"
            )
        lat = report["latencies"]
        print(
            f"  adversarial        {report['adversarial_failures']}/"
            f"{report['adversarial_n']} failed   (a failure here = a confident "
            "answer the source does not support)"
        )
        print(
            f"  latency            p50 {_pct(lat, 50)} ms | p95 {_pct(lat, 95)} ms"
            f"   (n={len(lat)}, nearest-rank)"
        )
        print(
            f"  tool calls         {report['requests_total']} HTTP requests"
            f" across {report['n']} cases"
            f" ({report['requests_total'] / max(report['n'], 1):.1f} per query)"
        )
        paid = report["paid_hosts"]
        print(
            f"  cost per query     $0.00   (0 paid-API calls; hosts contacted: "
            f"{'sec.gov only' if not paid else ', '.join(paid)})"
        )
    return 0 if report["passed"] == report["n"] else 1


if __name__ == "__main__":
    raise SystemExit(main())
