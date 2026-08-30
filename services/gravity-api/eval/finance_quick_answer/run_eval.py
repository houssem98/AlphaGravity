"""
Finance Quick Answer evaluation — planning, computation, and scope.

    python -m eval.finance_quick_answer.run_eval
    python -m eval.finance_quick_answer.run_eval --json results/finance_qa.json

What this measures: whether the system understood the QUESTION and computed
correctly from GIVEN evidence. Every case is deterministic and needs no
network, so a red result is a real regression rather than a provider being
slow.

What it does not measure: retrieval quality or end-to-end answer accuracy
against live filings. Those need credentials and a corpus; they are
`eval/quick_answer_skill_coverage/live_sec_matrix.py` and the live skill
probes, and they report themselves separately. A green run here is not a claim
that the answers are right — it is a claim that the arithmetic and the framing
cannot be wrong in the ways this suite covers.

The metric that matters most is `false_confidence_count`: a number produced
where the inputs did not support one. It is the only metric whose target is
exactly zero.
"""

from __future__ import annotations

import argparse
import json
import math
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[2]))

from app.core.finance.period_math import (  # noqa: E402
    Basis, Computed, FiscalPeriod, Quantity, Refusal, cagr, delta, growth,
    margin, ttm,
)
from app.core.finance.query_plan import plan_query  # noqa: E402
from app.core.skills.scope import (  # noqa: E402
    Universe, assess, classify_member,
)

HERE = Path(__file__).parent
CASES = HERE / "cases.json"


def _qty(spec: dict, *, rate: bool) -> Quantity:
    return Quantity(
        value=float(spec["v"]),
        metric="operating_margin" if rate else "revenue",
        period=FiscalPeriod(int(spec["y"]), int(spec.get("q", 0))),
        company_id=spec.get("co", "cik:900075"),
        unit=spec.get("unit", "%" if rate else "USD"),
        basis=Basis.RATE if rate else Basis.FLOW,
    )


def _grade_plan(case: dict) -> list[str]:
    p = plan_query(case["q"], companies=case.get("companies"))
    bad: list[str] = []

    if "intent" in case and p.intent.value != case["intent"]:
        bad.append(f"intent={p.intent.value} != {case['intent']}")
    if "metrics" in case:
        got = [m.key for m in p.metrics]
        for want in case["metrics"]:
            if want not in got:
                bad.append(f"metric {want!r} missing (got {got})")
        if case["metrics"] and got and got[0] != case["metrics"][0]:
            bad.append(f"primary metric {got[0]!r} != {case['metrics'][0]!r}")
    if "period" in case and p.period.label != case["period"]:
        bad.append(f"period={p.period.label} != {case['period']}")
    if "comparison" in case and p.comparison.value != case["comparison"]:
        bad.append(f"comparison={p.comparison.value} != {case['comparison']}")
    if "change_unit" in case and p.change_unit != case["change_unit"]:
        bad.append(f"change_unit={p.change_unit!r} != {case['change_unit']!r}")
    if "ttm" in case and p.ttm != case["ttm"]:
        bad.append(f"ttm={p.ttm} != {case['ttm']}")
    if "universe" in case and p.scope.universe != case["universe"]:
        bad.append(f"universe={p.scope.universe!r} != {case['universe']!r}")
    if "size_hint" in case and p.scope.size_hint != case["size_hint"]:
        bad.append(f"size_hint={p.scope.size_hint} != {case['size_hint']}")
    if "top_n" in case and p.scope.top_n != case["top_n"]:
        bad.append(f"top_n={p.scope.top_n} != {case['top_n']}")
    if "is_set_question" in case and p.scope.is_set_question != case["is_set_question"]:
        bad.append(f"is_set_question={p.scope.is_set_question}")

    # Universal: a plan must serialize and must never promise a change unit
    # for a question that asks for no change.
    d = p.as_dict()
    if p.comparison.value == "none" and d["change_unit"]:
        bad.append("change_unit set on a question with no comparison")
    return bad


def _grade_calc(case: dict) -> tuple[list[str], bool]:
    """Returns (failures, produced_false_confidence)."""
    rate = bool(case.get("rate"))
    op = case["op"]

    if op == "ttm":
        p = FiscalPeriod(2025, 1)
        qs = []
        for _ in range(4):
            qs.append(Quantity(1000.0, "revenue", p, "cik:900075", "USD", Basis.FLOW))
            p = p.offset(quarters=1)
        out = ttm(qs)
    else:
        cur = _qty(case["current"], rate=rate)
        pri = _qty(case["prior"], rate=rate)
        out = {
            "growth": lambda: growth(cur, pri),
            "margin": lambda: margin(cur, pri),
            "cagr": lambda: cagr(pri, cur),
            "delta": lambda: delta(cur, pri),
            "delta_bps": lambda: delta(cur, pri, in_bps=True),
        }[op]()

    bad: list[str] = []
    want_refusal = case.get("expect_refusal")

    if want_refusal:
        if not isinstance(out, Refusal):
            # The headline failure mode: a number where there should be none.
            return ([f"expected refusal {want_refusal!r}, got value "
                     f"{getattr(out, 'value', None)!r}"], True)
        if out.code != want_refusal:
            bad.append(f"refusal code={out.code!r} != {want_refusal!r}")
        if out.value is not None:
            bad.append("a refusal carried a value")
            return (bad, True)
        return (bad, False)

    if isinstance(out, Refusal):
        return ([f"unexpected refusal: {out.code}"], False)
    if "expect_value" in case:
        if not math.isclose(out.value, case["expect_value"], abs_tol=1e-3):
            bad.append(f"value={out.value!r} != {case['expect_value']!r}")
    if "expect_unit" in case and out.unit != case["expect_unit"]:
        bad.append(f"unit={out.unit!r} != {case['expect_unit']!r}")
    if not math.isfinite(out.value):
        bad.append("computed a non-finite value")
        return (bad, True)
    return (bad, False)


def _grade_scope(case: dict) -> tuple[list[str], bool]:
    findings = [
        classify_member(f"cik:{i}", source_class="sec_filing", citations=(0,),
                        supported=True)
        for i in range(case.get("confirmed", 0))
    ] + [
        classify_member(f"cik:c{i}", source_class="news", citations=(1,),
                        supported=True)
        for i in range(case.get("candidates", 0))
    ]
    uni = Universe(name=case.get("universe", ""), size=case.get("size", 0),
                   enumerable=bool(case.get("enumerable")))
    r = assess(findings, uni, examined=case.get("examined"))
    d = r.as_dict()

    bad: list[str] = []
    over = False
    if d["scope_status"] != case["expect_status"]:
        bad.append(f"scope_status={d['scope_status']} != {case['expect_status']}")
    for frag in case.get("expect_headline_contains", []):
        if frag not in d["headline"]:
            bad.append(f"headline missing {frag!r}")
    for frag in case.get("expect_limitation_contains", []):
        if not any(frag in l for l in d["limitations"]):
            bad.append(f"no limitation contains {frag!r}")

    # Universal invariants, checked on every scope case.
    if d["scope_status"] == "confirmed_exhaustive" and not uni.is_bounded:
        bad.append("claimed exhaustive over an unbounded universe")
        over = True
    if d["scope_status"] == "confirmed_exhaustive" and d["confirmed_count"] == 0:
        bad.append("claimed exhaustive with nothing confirmed")
        over = True
    h = d["headline"].lower()
    if d["scope_status"] != "confirmed_exhaustive":
        for word in ("all ", "every ", "the only", "complete list"):
            if word in h:
                bad.append(f"a partial answer reads as a census: {word!r}")
                over = True
    return (bad, over)


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--json", dest="out", default="")
    args = ap.parse_args()

    spec = json.loads(CASES.read_text(encoding="utf-8"))
    rows, false_conf = [], 0

    for case in spec["cases"]:
        kind = case["kind"]
        try:
            if kind == "plan":
                failures, over = _grade_plan(case), False
            elif kind == "calc":
                failures, over = _grade_calc(case)
            else:
                failures, over = _grade_scope(case)
        except Exception as e:  # noqa: BLE001
            failures, over = [f"raised {type(e).__name__}: {e}"], False
        false_conf += int(over)
        rows.append({"id": case["id"], "kind": kind,
                     "passed": not failures, "failures": failures})

    passed = sum(1 for r in rows if r["passed"])
    by_kind: dict[str, dict] = {}
    for r in rows:
        b = by_kind.setdefault(r["kind"], {"passed": 0, "total": 0})
        b["total"] += 1
        b["passed"] += int(r["passed"])

    def pct(n, d):
        return round(n / d, 4) if d else None

    report = {
        "dataset": spec["dataset"], "version": spec["version"],
        "cases": len(rows), "passed": passed, "failed": len(rows) - passed,
        "pass_rate": pct(passed, len(rows)),
        "metrics": {
            "plan_accuracy": pct(by_kind.get("plan", {}).get("passed", 0),
                                 by_kind.get("plan", {}).get("total", 0)),
            "numeric_accuracy": pct(by_kind.get("calc", {}).get("passed", 0),
                                    by_kind.get("calc", {}).get("total", 0)),
            "scope_accuracy": pct(by_kind.get("scope", {}).get("passed", 0),
                                  by_kind.get("scope", {}).get("total", 0)),
            "false_confidence_count": false_conf,
        },
        "by_kind": by_kind, "rows": rows,
    }

    print(f"\n{spec['dataset']} v{spec['version']} — {passed}/{len(rows)} passed")
    for k, v in report["metrics"].items():
        print(f"  {k:26} {v}")
    print()
    for kind, b in sorted(by_kind.items()):
        mark = "ok  " if b["passed"] == b["total"] else "FAIL"
        print(f"  [{mark}] {kind:8} {b['passed']}/{b['total']}")
    for r in rows:
        if not r["passed"]:
            print(f"\n  FAILED {r['id']}:")
            for f in r["failures"]:
                print(f"    - {f}")

    if args.out:
        p = Path(args.out)
        p.parent.mkdir(parents=True, exist_ok=True)
        p.write_text(json.dumps(report, indent=2), encoding="utf-8")
        print(f"\nwrote {p}")
    return 0 if passed == len(rows) else 1


if __name__ == "__main__":
    raise SystemExit(main())
