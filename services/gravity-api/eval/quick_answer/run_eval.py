"""Quick Answer verification evaluation (roadmap Phase 8).

Grades the deterministic citation-verification layer against a versioned golden
set. Every expected verdict in `golden_v1.json` is derived from the fixture
passage itself, never from model output, so this runner needs no provider key
and no network — which is the point: it can gate a build.

What it does NOT measure: end-to-end answer accuracy. That needs live models and
a live corpus and is a separate benchmark (`eval/financebench_grader.py`).
Conflating the two would let a green verification score be read as an accuracy
claim it does not support.

    python -m eval.quick_answer.run_eval [--json out.json]
"""

from __future__ import annotations

import argparse
import json
import time
from collections import defaultdict
from pathlib import Path

from app.core.verification.citation_verdict import verdict_for_citation

HERE = Path(__file__).parent
GOLDEN = HERE / "golden_v1.json"

# A verdict that asserts support. Getting one of these wrong is a false
# confidence: the system told the user a claim checked out when it did not.
SUPPORTIVE = {"verified"}


class Passage:
    def __init__(self, d: dict):
        self.chunk_id = d["chunk_id"]
        self.ticker = d.get("ticker", "")
        self.filing_date = d.get("filing_date", "")
        self.document_title = d.get("document_title", "")
        self.text = d["text"]
        self.section = d.get("section", "")
        self.metadata = {}


def run(golden_path: Path = GOLDEN) -> dict:
    spec = json.loads(golden_path.read_text(encoding="utf-8"))
    by_id = {p["chunk_id"]: Passage(p) for p in spec["passages"]}
    ordered = list(by_id.values())

    results = []
    started = time.perf_counter()

    for case in spec["cases"]:
        passages = [] if case.get("no_passages") else ordered
        citation = {
            "citation_number": case.get("citation_number", 1),
            "chunk_id": case.get("chunk_id") or "",
            "text": case["claim"],
            "ticker": case.get("ticker", ""),
        }
        verdict = verdict_for_citation(
            citation, passages, model_entailed=case.get("model_entailed"),
        )
        results.append({
            "id": case["id"],
            "category": case["category"],
            "expected": case["expect"],
            "actual": verdict.status,
            "passed": verdict.status == case["expect"],
            "reasons": verdict.reasons,
        })

    elapsed_ms = (time.perf_counter() - started) * 1000

    # ── metrics ─────────────────────────────────────────────────────────
    total = len(results)
    passed = sum(r["passed"] for r in results)

    by_cat: dict[str, dict] = defaultdict(lambda: {"total": 0, "passed": 0})
    for r in results:
        by_cat[r["category"]]["total"] += 1
        by_cat[r["category"]]["passed"] += int(r["passed"])

    adversarial = [r for r in results if r["category"].endswith("_adversarial")]
    # The number that matters most: an adversarial case the system waved through
    # as supported. Every one of these is an answer a user would have trusted.
    false_confidence = [
        r for r in adversarial
        if r["actual"] in SUPPORTIVE and r["expected"] not in SUPPORTIVE
    ]
    # And the mirror: a sound citation wrongly rejected.
    false_rejection = [
        r for r in results
        if r["expected"] in SUPPORTIVE and r["actual"] not in SUPPORTIVE
    ]
    abstention = [r for r in results if r["category"] == "abstention"]

    return {
        "dataset_version": spec["version"],
        "generated_at": time.strftime("%Y-%m-%dT%H:%M:%S"),
        "elapsed_ms": round(elapsed_ms, 2),
        "totals": {"cases": total, "passed": passed, "failed": total - passed,
                   "accuracy": round(passed / total, 4) if total else 0.0},
        "metrics": {
            "adversarial_detection_rate": round(
                sum(r["passed"] for r in adversarial) / len(adversarial), 4) if adversarial else None,
            "false_confidence_count": len(false_confidence),
            "false_confidence_rate": round(len(false_confidence) / len(adversarial), 4) if adversarial else None,
            "false_rejection_count": len(false_rejection),
            "abstention_accuracy": round(
                sum(r["passed"] for r in abstention) / len(abstention), 4) if abstention else None,
        },
        "by_category": {k: {**v, "accuracy": round(v["passed"] / v["total"], 4)}
                        for k, v in sorted(by_cat.items())},
        "failures": [r for r in results if not r["passed"]],
        "results": results,
    }


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--json", type=Path, help="write the machine-readable report here")
    args = ap.parse_args()

    report = run()
    if args.json:
        args.json.parent.mkdir(parents=True, exist_ok=True)
        args.json.write_text(json.dumps(report, indent=2), encoding="utf-8")

    t = report["totals"]
    m = report["metrics"]
    print(f"Quick Answer verification eval — dataset v{report['dataset_version']}")
    print(f"  cases              {t['cases']}")
    print(f"  passed             {t['passed']}  ({t['accuracy'] * 100:.1f}%)")
    print(f"  adversarial caught {m['adversarial_detection_rate']}")
    print(f"  false confidence   {m['false_confidence_count']}")
    print(f"  false rejection    {m['false_rejection_count']}")
    print(f"  abstention         {m['abstention_accuracy']}")
    for cat, v in report["by_category"].items():
        print(f"    {cat:26s} {v['passed']}/{v['total']}")
    for f in report["failures"]:
        print(f"  FAIL {f['id']}: expected {f['expected']}, got {f['actual']} {f['reasons']}")
    return 0 if not report["failures"] else 1


if __name__ == "__main__":
    raise SystemExit(main())
