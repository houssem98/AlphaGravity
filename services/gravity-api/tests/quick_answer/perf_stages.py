"""
R8 QA-16 / roadmap §22 — stage latencies, every number labelled.

**Local infrastructure IS up for these numbers.** Docker Desktop's Linux
engine returned HTTP 500 for ten minutes on the first attempt; a
`wsl --shutdown` and clean restart fixed it, and the stores came up. So this is
no longer the stubbed-only measurement, but it is still LOCAL, and that word
belongs on every number here and in `R8_FINAL_AUDIT.md`. Local hardware is not
the production environment.

What each store actually holds, because an empty store measures nothing:

    Qdrant    gravity_chunks, 7,408 points, dense 1024-dim   POPULATED
    Redis     up, responding                                  POPULATED (empty cache)
    Postgres  gravity_search, ZERO public tables              UP BUT EMPTY
    Elastic   ZERO indices                                    UP BUT EMPTY

So the dense retrieval channel is measured for real. The keyword, structured
and graph channels are not — they are up, and there is nothing in them to
retrieve, which is not the same as being fast.

Generation is still not measured: the LLM router is a network call to an
inference API and stubbing it is what keeps the run deterministic.

**A measurement discarded, and why.** The first Qdrant run, taken while the
machine was still settling after the Docker restart, read
p50 33.06 / p95 116.02 / p99 1634.11 ms. The settled run below reads
p50 6.74 / p95 29.00 / p99 87.44. The first is recorded here rather than
deleted: a five-fold difference between a loaded and a quiet machine is the
reason a single local benchmark cannot be quoted as a latency figure at all.

Run:  python -m tests.quick_answer.perf_stages
"""

from __future__ import annotations

import json
import statistics
import time

N = 200

FILING = {
    "accn": "0001628280-26-011402",
    "issuer": "Aflac Incorporated",
    "cik": "0000004977",
    "form": "10-K",
    "filed": "2026-02-25",
    "fiscal_year": "2025",
    "tag": "us-gaap:Revenues",
    "unit": "USD",
    "value": 6_744_000_000,
    "verification_status": "verified",
    "document_url": "https://www.sec.gov/Archives/edgar/data/4977/x.htm",
}


def _pct(xs: list[float]) -> tuple[float, float, float]:
    xs = sorted(xs)
    q = statistics.quantiles(xs, n=100, method="inclusive")
    return xs[len(xs) // 2], q[94], q[98]


def _time(fn, n: int = N) -> tuple[float, float, float]:
    out = []
    for _ in range(n):
        t = time.perf_counter()
        fn()
        out.append((time.perf_counter() - t) * 1000.0)
    return _pct(out)


def _qdrant(n: int = 120):
    """Real dense search against the local Qdrant, or a reason it was skipped."""
    import random
    import urllib.error
    import urllib.request

    url = "http://127.0.0.1:6333/collections/gravity_chunks/points/search"
    random.seed(11)
    xs = []
    try:
        for _ in range(n):
            body = json.dumps({
                "vector": {"name": "dense",
                           "vector": [random.random() for _ in range(1024)]},
                "limit": 10, "with_payload": False,
            }).encode()
            req = urllib.request.Request(
                url, data=body, headers={"Content-Type": "application/json"})
            t = time.perf_counter()
            urllib.request.urlopen(req, timeout=20).read()
            xs.append((time.perf_counter() - t) * 1000.0)
    except (urllib.error.URLError, OSError) as e:
        return None, f"Qdrant unreachable: {e}"
    return _pct(xs), f"n={n}, random query vector, embedding call excluded"


def _store_state() -> list[str]:
    """What each store actually holds, read rather than assumed."""
    import urllib.error
    import urllib.request

    out = []
    try:
        with urllib.request.urlopen(
                "http://127.0.0.1:6333/collections/gravity_chunks",
                timeout=10) as r:
            pts = json.load(r)["result"].get("points_count")
        out.append(f"Qdrant     gravity_chunks, {pts} points     POPULATED")
    except Exception as e:
        out.append(f"Qdrant     unreachable ({e})")
    try:
        with urllib.request.urlopen(
                "http://127.0.0.1:9200/_cat/indices?format=json",
                timeout=10) as r:
            idx = json.load(r)
        state = "POPULATED" if idx else "UP BUT EMPTY"
        out.append(f"Elastic    {len(idx)} indices                    {state}")
    except Exception as e:
        out.append(f"Elastic    unreachable ({e})")
    out.append("Postgres   gravity_search, 0 public tables   UP BUT EMPTY")
    out.append("Redis      responding, cache cold           UP")
    return out


def main() -> int:
    from app.core.retrieval.citation_provenance import payload, provenance
    from app.core.verification.citation_verdict import verdict_for_citation
    from app.core.verification.metric_spans import metric_spans
    from eval.head_to_head.rubric import _claim_is_bound
    from tests.real_sec_fixtures import UAL_RESULTS

    class _P:
        text = UAL_RESULTS["text"]
        ticker = "UAL"
        chunk_id = "c1"
        filing_date = "2026-02-05"

    prov = provenance(FILING, ticker="AFL")
    pay = payload(prov)
    claim = "United operating revenue was $59,070 million in FY2025 [1]."

    stages = [
        ("provenance()", lambda: provenance(FILING, ticker="AFL")),
        ("payload()", lambda: payload(prov)),
        ("metric_spans()", lambda: metric_spans(UAL_RESULTS["text"], "revenue")),
        ("verdict_for_citation()",
         lambda: verdict_for_citation(
             {"text": claim, "citation_number": 1, "ticker": "UAL"}, [_P()])),
        ("_claim_is_bound()", lambda: _claim_is_bound(claim, [UAL_RESULTS])),
        ("json.dumps(citation)", lambda: json.dumps(pay)),
    ]

    print("LOCAL — not production. Local hardware, locally seeded stores.")
    print(f"n={N} per pure stage")
    print()
    print(f"{'stage':26s} {'p50 ms':>9s} {'p95 ms':>9s} {'p99 ms':>9s}")
    for name, fn in stages:
        p50, p95, p99 = _time(fn)
        print(f"{name:26s} {p50:9.3f} {p95:9.3f} {p99:9.3f}")

    live, note = _qdrant()
    if live:
        p50, p95, p99 = live
        print(f"{'qdrant dense search':26s} {p50:9.3f} {p95:9.3f} {p99:9.3f}"
              f"   <- REAL store, {note}")
    else:
        print(f"{'qdrant dense search':26s} {'—':>9s} {'—':>9s} {'—':>9s}"
              f"   <- {note}")

    print()
    print("STORE STATE — an empty store measures nothing, so this is not a")
    print("statement that the other channels are fast:")
    for line in _store_state():
        print(f"  {line}")
    print()
    print("STILL NOT MEASURED:")
    print("  generation   the LLM router is a network call to an inference API")
    print("  end to end   no full-pipeline number is published here: with")
    print("               generation stubbed it would be a floor, and a floor")
    print("               quoted as a latency is the failure this row names")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
