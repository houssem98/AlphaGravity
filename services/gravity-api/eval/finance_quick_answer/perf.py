"""
What the finance planning and computation layers cost.

    python -m eval.finance_quick_answer.perf
    python -m eval.finance_quick_answer.perf --json results/finance_perf.json

Scope, stated up front because a latency number without one is a claim about
whatever the reader assumes: this measures the stages ADDED by this work —
query planning, period arithmetic, scope assessment — with no network and no
model call. These run on every finance question, so their cost is paid on every
answer, which is why they are measured rather than assumed cheap.

It does NOT measure end-to-end Quick Answer latency. That is dominated by
retrieval, reranking and generation, needs provider credentials, and is
measured by `eval/quick_answer/live_perf.py`. The roadmap records a previously
observed p50 of about 28 seconds; nothing here claims to have moved it, because
nothing here touched those stages, and no verification was removed to make any
number look better.
"""

from __future__ import annotations

import argparse
import json
import statistics
import sys
import time
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[2]))

from app.core.finance.period_math import (  # noqa: E402
    Basis, FiscalPeriod, Quantity, cagr, delta, growth, margin, ttm,
)
from app.core.finance.query_plan import plan_query  # noqa: E402
from app.core.question_class import classify  # noqa: E402
from app.core.skills.scope import Universe, assess, classify_member  # noqa: E402

ITERATIONS = 400

QUERIES = [
    "What was Copart revenue in FY2025?",
    "NVIDIA operating margin year-over-year",
    "Which S&P 500 companies mentioned tariff risk in their 10-K?",
    "Compare Old Dominion and Expeditors free cash flow",
    "What guidance did Watsco give for next year?",
    "Lantheus revenue CAGR from 2020 to 2025",
]


def pct(xs, p):
    s = sorted(xs)
    return round(s[min(len(s) - 1, int(len(s) * p))], 4)


def summarise(name, xs):
    return {"stage": name, "n": len(xs), "p50_ms": pct(xs, 0.50),
            "p95_ms": pct(xs, 0.95), "p99_ms": pct(xs, 0.99),
            "mean_ms": round(statistics.fmean(xs), 4), "max_ms": round(max(xs), 4)}


def _q(v, y, q=0, basis=Basis.FLOW):
    return Quantity(v, "revenue" if basis is Basis.FLOW else "operating_margin",
                    FiscalPeriod(y, q), "cik:900075",
                    "USD" if basis is Basis.FLOW else "%", basis)


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--json", dest="out", default="")
    args = ap.parse_args()

    stages: dict[str, list[float]] = {k: [] for k in (
        "question_class_classify", "finance_plan_query", "period_math_growth",
        "period_math_margin", "period_math_cagr", "period_math_delta",
        "period_math_ttm", "scope_assess_500_members",
    )}

    quarters = []
    p = FiscalPeriod(2025, 1)
    for _ in range(4):
        quarters.append(_q(1000.0, p.fiscal_year, p.quarter))
        p = p.offset(quarters=1)

    big = [classify_member(f"cik:{i}", source_class="sec_filing",
                           citations=(0,), supported=True) for i in range(500)]
    uni = Universe("the S&P 500", 503, enumerable=True)

    for i in range(ITERATIONS):
        query = QUERIES[i % len(QUERIES)]

        t = time.perf_counter()
        classify(query)
        stages["question_class_classify"].append((time.perf_counter() - t) * 1000)

        t = time.perf_counter()
        plan_query(query)
        stages["finance_plan_query"].append((time.perf_counter() - t) * 1000)

        t = time.perf_counter()
        growth(_q(5000, 2025), _q(4000, 2024))
        stages["period_math_growth"].append((time.perf_counter() - t) * 1000)

        t = time.perf_counter()
        margin(_q(1500, 2025), _q(6000, 2025))
        stages["period_math_margin"].append((time.perf_counter() - t) * 1000)

        t = time.perf_counter()
        cagr(_q(1000, 2020), _q(2000, 2025))
        stages["period_math_cagr"].append((time.perf_counter() - t) * 1000)

        t = time.perf_counter()
        delta(_q(25.0, 2025, basis=Basis.RATE), _q(20.0, 2024, basis=Basis.RATE))
        stages["period_math_delta"].append((time.perf_counter() - t) * 1000)

        t = time.perf_counter()
        ttm(quarters)
        stages["period_math_ttm"].append((time.perf_counter() - t) * 1000)

        if i % 10 == 0:          # the 500-member case, sampled
            t = time.perf_counter()
            assess(big, uni, examined=503)
            stages["scope_assess_500_members"].append(
                (time.perf_counter() - t) * 1000)

    report = {"iterations": ITERATIONS,
              "stages": [summarise(k, v) for k, v in stages.items() if v]}
    total = sum(s["p50_ms"] for s in report["stages"]
                if s["stage"] != "scope_assess_500_members")
    report["added_per_question_p50_ms"] = round(total, 4)

    print(f"\nFINANCE PLANNING + MATH — {ITERATIONS} iterations, no network")
    print(f"  {'stage':32} {'p50':>10} {'p95':>10} {'p99':>10} {'max':>10}")
    for s in report["stages"]:
        print(f"  {s['stage']:32} {s['p50_ms']:>9.4f}ms {s['p95_ms']:>9.4f}ms "
              f"{s['p99_ms']:>9.4f}ms {s['max_ms']:>9.4f}ms")
    print(f"\n  Added to a single finance question at p50: "
          f"{report['added_per_question_p50_ms']:.4f}ms "
          "(classification + planning + one computation of each kind)")
    print("\nNOT MEASURED HERE: retrieval, reranking, embedding, generation. "
          "Those need provider credentials and dominate end-to-end latency; "
          "see eval/quick_answer/live_perf.py. No claim is made about the "
          "~28s end-to-end p50, which this work did not touch.")

    if args.out:
        pth = Path(args.out)
        pth.parent.mkdir(parents=True, exist_ok=True)
        pth.write_text(json.dumps(report, indent=2), encoding="utf-8")
        print(f"wrote {pth}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
