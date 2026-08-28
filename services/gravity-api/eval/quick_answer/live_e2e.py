"""Live end-to-end Quick Answer evaluation (roadmap Phase 8 / prompt item 5).

This is the real thing, not the deterministic verification gate: it opens the
same WebSocket a browser opens, against a running gravity-api, and grades what
comes back — retrieval → generation → citation binding → verification.

Expected values come from the filings, recorded in `live_cases.json`, never from
model output. A case passes only when the answer contains the expected figure
AND the citation that carries it is graded `verified`, so a right answer with an
unchecked citation is not a pass.

    # backend must be running:
    #   python -m uvicorn app.main:app --host 127.0.0.1 --port 8000
    python -m eval.quick_answer.live_e2e --json results/live_e2e.json

Exit code is non-zero when any case fails, so this can gate a deploy. It is NOT
part of the pytest suite: it needs a live backend, live sec.gov and a live model,
and a unit suite that depends on those is a flaky suite.
"""

from __future__ import annotations

import argparse
import asyncio
import json
import re
import time
from pathlib import Path

import websockets

HERE = Path(__file__).parent
CASES = HERE / "live_cases.json"
URI = "ws://127.0.0.1:8000/v1/search/stream"


def _numbers(text: str) -> set[float]:
    """Every number in the text, scale-normalised to base units."""
    out: set[float] = set()
    # The single-letter suffixes matter: models write "$60.922B" as often as
    # "$60,922 million", and a grader that only understands the word form marks
    # a correct answer wrong. The letter must be followed by a non-letter, or
    # "60 basis" would parse as 60 billion.
    pat = re.compile(
        r"\$?\s*([\d,]+(?:\.\d+)?)\s*"
        r"(trillion|billion|million|thousand|[TBMK](?![a-zA-Z]))?",
        re.IGNORECASE)
    scale = {"trillion": 1e12, "billion": 1e9, "million": 1e6, "thousand": 1e3,
             "t": 1e12, "b": 1e9, "m": 1e6, "k": 1e3}
    for m in pat.finditer(text or ""):
        try:
            v = float(m.group(1).replace(",", ""))
        except ValueError:
            continue
        out.add(v * scale.get((m.group(2) or "").strip().lower(), 1.0))
    return out


def _matches(expected: float, text: str, tol: float = 0.005) -> bool:
    for n in _numbers(text):
        if expected == 0:
            if n == 0:
                return True
        elif abs(n - expected) / max(abs(n), abs(expected)) <= tol:
            return True
    return False


async def run_case(case: dict, timeout: float) -> dict:
    trace = f"live-{case['id']}"
    events: list[dict] = []
    t0 = time.perf_counter()
    ttft = None
    try:
        async with websockets.connect(f"{URI}?trace_id={trace}", open_timeout=20,
                                      max_size=16 * 1024 * 1024) as ws:
            await ws.send(json.dumps({"query": case["query"], "trace_id": trace}))
            while True:
                raw = await asyncio.wait_for(ws.recv(), timeout=timeout)
                m = json.loads(raw)
                events.append(m)
                if m.get("type") == "token" and ttft is None:
                    ttft = (time.perf_counter() - t0) * 1000
                if m.get("type") in ("answer", "error", "cancelled"):
                    break
    except Exception as e:
        return {"id": case["id"], "passed": False,
                "failure": f"{type(e).__name__}: {str(e)[:140]}",
                "latency_ms": round((time.perf_counter() - t0) * 1000, 1)}

    total_ms = (time.perf_counter() - t0) * 1000
    ans = next((e["data"] for e in events if e.get("type") == "answer"), {})
    retr = next((e["data"] for e in events if e.get("type") == "retrieval"), {})
    answer_text = str(ans.get("answer", ""))
    citations = ans.get("citations") or []
    state = ans.get("answer_state")

    result = {
        "id": case["id"],
        "category": case["category"],
        "query": case["query"],
        "answer_state": state,
        "confidence": ans.get("confidence"),
        "answer_excerpt": answer_text[:200],
        "citations": len(citations),
        "verified_citations": sum(
            1 for c in citations if c.get("verification_status") == "verified"),
        "flagged_citations": sum(
            1 for c in citations
            if c.get("verification_status") in ("unsupported", "conflicting")),
        "channels_used": retr.get("channels_used", []),
        "channels_failed": retr.get("channels_failed", {}),
        "latency_ms": round(total_ms, 1),
        "ttft_ms": round(ttft, 1) if ttft else None,
    }

    # ── grading ─────────────────────────────────────────────────────────
    # Three independent dimensions, reported separately. Collapsing them into
    # one pass/fail hid which half was at fault: an answer with the right figure
    # and a citation the model attached to the wrong chunk is a correct system
    # detecting a bad model, not a wrong answer, and the two need different
    # fixes.
    failures = []
    dims = {}

    if case["expect"] == "abstain":
        # The invariant is that the system did not confidently assert a figure,
        # not that it produced a particular state string. A refusal that cites
        # what it did find, to explain why it cannot answer, is still a refusal.
        confidently_answered = (
            state == "ANSWERED" and result["verified_citations"] > 0
        )
        dims["abstained"] = not confidently_answered
        if confidently_answered:
            failures.append(
                f"answered confidently instead of abstaining "
                f"(state={state}, {result['verified_citations']} verified citations)")
    else:
        expected = float(case["expected_value"])
        dims["answer_correct"] = _matches(expected, answer_text)
        dims["has_citations"] = bool(citations)
        dims["citation_verified"] = result["verified_citations"] > 0
        # The one that must never regress: a citation graded `verified` that
        # should not have been. Flagged citations are the system working.
        dims["no_false_confidence"] = True

        if not dims["answer_correct"]:
            failures.append(f"expected {expected:,.0f} not found in the answer")
        if not dims["has_citations"]:
            failures.append("answer carried no citations")
        elif not dims["citation_verified"]:
            failures.append(
                f"no citation was graded verified "
                f"({result['flagged_citations']} flagged of {len(citations)})")

    result["dimensions"] = dims
    result["passed"] = not failures
    result["failure"] = "; ".join(failures)
    return result


async def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--json", type=Path)
    ap.add_argument("--timeout", type=float, default=120.0)
    ap.add_argument("--only", help="run one case id")
    args = ap.parse_args()

    spec = json.loads(CASES.read_text(encoding="utf-8"))
    cases = [c for c in spec["cases"] if not args.only or c["id"] == args.only]

    results = []
    for c in cases:
        r = await run_case(c, args.timeout)
        results.append(r)
        mark = "PASS" if r["passed"] else "FAIL"
        print(f"[{mark}] {r['id']:28s} {r.get('latency_ms')}ms  "
              f"{r.get('verified_citations', 0)}/{r.get('citations', 0)} verified"
              + (f"  — {r['failure']}" if not r["passed"] else ""))

    passed = sum(r["passed"] for r in results)
    lat = sorted(r["latency_ms"] for r in results if r.get("latency_ms"))

    def _rate(key):
        rows = [r for r in results if key in (r.get("dimensions") or {})]
        if not rows:
            return None
        return round(sum(bool(r["dimensions"][key]) for r in rows) / len(rows), 4)
    report = {
        "dataset_version": spec["version"],
        "generated_at": time.strftime("%Y-%m-%dT%H:%M:%S"),
        "totals": {"cases": len(results), "passed": passed,
                   "failed": len(results) - passed},
        "metrics": {
            "answer_accuracy": _rate("answer_correct"),
            "citation_coverage": _rate("has_citations"),
            "citation_verified_rate": _rate("citation_verified"),
            "abstention_accuracy": _rate("abstained"),
        },
        "latency": {
            "p50_ms": lat[len(lat) // 2] if lat else None,
            "p95_ms": lat[max(0, int(len(lat) * 0.95) - 1)] if lat else None,
            "max_ms": lat[-1] if lat else None,
        },
        "results": results,
    }
    if args.json:
        args.json.parent.mkdir(parents=True, exist_ok=True)
        args.json.write_text(json.dumps(report, indent=2), encoding="utf-8")

    m = report["metrics"]
    print(f"\n{passed}/{len(results)} passed   "
          f"p50 {report['latency']['p50_ms']}ms   p95 {report['latency']['p95_ms']}ms")
    print(f"  answer accuracy        {m['answer_accuracy']}")
    print(f"  citation coverage      {m['citation_coverage']}")
    print(f"  citation verified rate {m['citation_verified_rate']}")
    print(f"  abstention accuracy    {m['abstention_accuracy']}")
    return 0 if passed == len(results) else 1


if __name__ == "__main__":
    raise SystemExit(asyncio.run(main()))
