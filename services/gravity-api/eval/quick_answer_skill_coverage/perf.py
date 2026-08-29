"""
Where the time goes, measured rather than asserted.

    python -m eval.quick_answer_skill_coverage.perf
    python -m eval.quick_answer_skill_coverage.perf --live --json results/perf.json

Two modes, kept apart because they measure different things and mixing them
produces a number that means neither:

**offline** (default) — the skill layer's own cost with evidence injected:
entity resolution, period evaluation, scoring, claim and citation assembly.
This is the part of the latency this work is responsible for. It needs no
network, so the numbers are reproducible.

**--live** — the SEC round trips the answer actually waits on: the submissions
fetch, the primary-document resolution, and the filing-index fetch. These
dominate, they are not ours, and reporting them separately is the only way to
say anything true about either.

What is NOT here: end-to-end Quick Answer latency with generation and
reranking. That needs LLM and reranker credentials, is measured by
`eval/quick_answer/live_perf.py`, and no figure for it is invented here. The
prompt records a previously measured p50 of about 28 seconds; nothing in this
pass claims to have moved it, because nothing in this pass touched generation.

Verification is never disabled to make a number look better. The period
verdict, the citation assembly and the absence rule all run in every timed
iteration below.
"""

from __future__ import annotations

import argparse
import asyncio
import json
import statistics
import sys
import time
from datetime import date
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[2]))

from app.core.skills import company_skill, sentiment_skill  # noqa: E402
from app.core.skills import entity as entity_layer  # noqa: E402
from app.core.skills import period as period_layer  # noqa: E402
from app.core.skills.contract import SkillRequest  # noqa: E402
from eval.quick_answer_skill_coverage import run_eval  # noqa: E402

AS_OF = date(2026, 8, 29)
ITERATIONS = 60


def pct(xs: list[float], p: float) -> float:
    if not xs:
        return 0.0
    s = sorted(xs)
    return round(s[min(len(s) - 1, int(len(s) * p))], 2)


def summarise(name: str, xs: list[float]) -> dict:
    return {
        "stage": name,
        "n": len(xs),
        "p50_ms": pct(xs, 0.50),
        "p95_ms": pct(xs, 0.95),
        "mean_ms": round(statistics.fmean(xs), 2) if xs else 0.0,
        "max_ms": round(max(xs), 2) if xs else 0.0,
    }


async def offline() -> list[dict]:
    issuers = json.loads(Path(run_eval.CASES).read_text(encoding="utf-8"))["issuers"]
    resolver = run_eval.Resolver(issuers)
    stages: dict[str, list[float]] = {
        "entity_resolution": [], "period_evaluation": [],
        "company_skill_total": [], "sentiment_skill_total": [],
    }

    for i in range(ITERATIONS):
        ticker = issuers[i % len(issuers)]["ticker"]
        cik = issuers[i % len(issuers)]["cik"]

        t = time.perf_counter()
        await entity_layer.resolve(ticker, resolver=resolver)
        stages["entity_resolution"].append((time.perf_counter() - t) * 1000)

        t = time.perf_counter()
        period_layer.evaluate("FY2025", fy_end_month=12, as_of=AS_OF)
        stages["period_evaluation"].append((time.perf_counter() - t) * 1000)

        facts = run_eval.FactsChannel(ticker, cik, run_eval.DEFAULT_SUPPLY)
        t = time.perf_counter()
        await company_skill.run(
            SkillRequest(skill="company", entities=[ticker]),
            facts_search=facts, resolver=resolver, as_of=AS_OF)
        stages["company_skill_total"].append((time.perf_counter() - t) * 1000)

        prose = run_eval.ProseChannel(ticker, cik, run_eval.POSITIVE)
        t = time.perf_counter()
        await sentiment_skill.run(
            SkillRequest(skill="sentiment", entities=[ticker]),
            text_search=prose, resolver=resolver, as_of=AS_OF)
        stages["sentiment_skill_total"].append((time.perf_counter() - t) * 1000)

    return [summarise(k, v) for k, v in stages.items()]


async def live() -> list[dict]:
    import httpx

    from app.config import settings
    from app.core.retrieval import sec_filing_resolver as sfr

    targets = [
        (1045810, "10-K"), (320193, "10-K"), (1318605, "10-K"),
        (789019, "10-K"), (19617, "10-Q"), (900075, "10-K"),
    ]
    cold, warm, details = [], [], []

    async with httpx.AsyncClient(headers={"User-Agent": settings.sec_user_agent},
                                 timeout=30.0, follow_redirects=True) as client:
        for cik, form in targets:
            r = await client.get(sfr.SUBMISSIONS_URL.format(cik=cik))
            rec = (r.json().get("filings") or {}).get("recent") or {}
            accn = next((a for f, a in zip(rec.get("form") or [],
                                           rec.get("accessionNumber") or [])
                         if f == form), "")
            if not accn:
                continue

            # Cold: a fresh resolver, so the submissions fetch is paid.
            res = sfr.SecFilingResolver(http_client=client)
            t = time.perf_counter()
            ident = await res.resolve(cik, accn)
            cold.append((time.perf_counter() - t) * 1000)

            # Warm: the same registrant again, served from the per-CIK cache.
            t = time.perf_counter()
            await res.resolve(cik, accn)
            warm.append((time.perf_counter() - t) * 1000)

            if ident and ident.filing_index_url:
                t = time.perf_counter()
                await client.get(ident.filing_index_url)
                details.append((time.perf_counter() - t) * 1000)
            await asyncio.sleep(0.15)

    return [
        summarise("sec_primary_resolution_cold", cold),
        summarise("sec_primary_resolution_warm", warm),
        summarise("sec_filing_index_fetch", details),
    ]


async def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--live", action="store_true")
    ap.add_argument("--json", dest="out", default="")
    args = ap.parse_args()

    report = {"iterations": ITERATIONS, "offline": await offline(), "live": []}
    if args.live:
        try:
            report["live"] = await live()
        except Exception as e:  # noqa: BLE001
            report["live_error"] = f"{type(e).__name__}: {str(e)[:200]}"

    print(f"\nSKILL LAYER — offline, {ITERATIONS} iterations, evidence injected")
    print(f"  {'stage':30} {'p50':>9} {'p95':>9} {'mean':>9} {'max':>9}")
    for s in report["offline"]:
        print(f"  {s['stage']:30} {s['p50_ms']:>8.2f}ms {s['p95_ms']:>8.2f}ms "
              f"{s['mean_ms']:>8.2f}ms {s['max_ms']:>8.2f}ms")

    if report["live"]:
        print("\nSEC ROUND TRIPS — live network")
        for s in report["live"]:
            print(f"  {s['stage']:30} {s['p50_ms']:>8.2f}ms {s['p95_ms']:>8.2f}ms "
                  f"{s['mean_ms']:>8.2f}ms {s['max_ms']:>8.2f}ms  (n={s['n']})")
    elif report.get("live_error"):
        print(f"\nSEC ROUND TRIPS — NOT MEASURED: {report['live_error']}")
    else:
        print("\nSEC ROUND TRIPS — not measured (pass --live)")

    print("\nNOT MEASURED HERE: generation, reranking, embedding — these need "
          "provider credentials and are measured by eval/quick_answer/live_perf.py.")

    if args.out:
        p = Path(args.out)
        p.parent.mkdir(parents=True, exist_ok=True)
        p.write_text(json.dumps(report, indent=2), encoding="utf-8")
        print(f"wrote {p}")
    return 0


if __name__ == "__main__":
    raise SystemExit(asyncio.run(main()))
