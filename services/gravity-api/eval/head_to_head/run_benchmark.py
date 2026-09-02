"""
The golden benchmark, and the blind head-to-head when a reference exists.

    # score AlphaGravity alone, against the filings
    python -m eval.head_to_head.run_benchmark --live

    # score both sides, once reference answers are recorded
    python -m eval.head_to_head.run_benchmark --live --reference refs.json

What `--live` does: opens the same WebSocket a browser opens, against a running
gravity-api, and scores what comes back against ground truth read from SEC's
XBRL API — not from any model, and not from the reference answer.

**The head-to-head cannot run without a reference file, and this refuses to
invent one.** A `refs.json` is a recording of what a top ChatGPT finance answer
actually said, produced by a human running the same questions. Without it the
run reports the AlphaGravity column and marks the comparison BLOCKED, because a
benchmark whose opponent was written by the system under test is not a
benchmark. The roadmap is explicit that "beats ChatGPT" may not be claimed from
green tests, and a fabricated reference would be exactly that claim wearing a
number.

Reference file shape::

    {"aapl-fy2025-revenue": {"answer": "...", "latency_ms": 4200,
                             "citations": [{"source_class": "web"}]}, ...}
"""

from __future__ import annotations

import argparse
import asyncio
import json
import re
import sys
import time
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[2]))

from eval.head_to_head.rubric import (  # noqa: E402
    DIMENSIONS, blind_pairs, score_answer,
)

HERE = Path(__file__).parent
CASES = HERE / "cases.json"
URI = "ws://127.0.0.1:8000/v1/search/stream"


async def ask(query: str, *, timeout: float = 120.0) -> dict:
    """One live query over the real WebSocket. Returns answer + citations + ms."""
    import websockets

    t0 = time.perf_counter()
    answer, citations, scope_status, meta = "", [], "", {}
    async with websockets.connect(URI, max_size=32 * 1024 * 1024) as ws:
        await ws.send(json.dumps({"query": query, "reasoning_depth": "fast"}))
        while True:
            try:
                msg = json.loads(await asyncio.wait_for(ws.recv(), timeout=timeout))
            except Exception:
                break
            t = msg.get("type")
            data = msg.get("data") or {}
            if t == "answer":
                answer = data.get("answer") or data.get("text") or answer
                citations = data.get("citations") or citations
            elif t == "metadata":
                meta = data
                scope_status = str(data.get("scope_status", ""))
                if not citations:
                    citations = data.get("citations") or []
            if t in ("complete", "metadata"):
                break
    return {
        "answer": answer,
        "citations": citations,
        "scope_status": scope_status,
        "latency_ms": (time.perf_counter() - t0) * 1000,
        "metadata": meta,
    }


def aggregate(cards: list) -> dict:
    """Mean weighted score, with the graded coverage attached."""
    scored = [c for c in cards if c.weighted is not None]
    if not scored:
        return {"n": 0, "mean_weighted": None, "graded_weight_pct": 0}
    mean = sum(c.weighted for c in scored) / len(scored)
    cov = sum(c.graded_weight for c in scored) / (len(scored) * 100.0)
    per_dim = {}
    for d in DIMENSIONS:
        vals = [c.scores[d.key] for c in cards if c.scores.get(d.key) is not None]
        per_dim[d.key] = round(sum(vals) / len(vals), 4) if vals else None
    # The roadmap asks for these separately, and they are not the same failure:
    # one puts a wrong number in front of a user, the other declines to.
    modes = [c.notes.get("failure_mode") for c in cards]
    return {
        "n": len(scored),
        "mean_weighted": round(mean, 4),
        "graded_weight_pct": round(100 * cov, 1),
        "per_dimension": per_dim,
        "false_confidence": modes.count("false_confidence"),
        "false_abstention": modes.count("false_abstention"),
    }


async def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--live", action="store_true",
                    help="query a running gravity-api on :8000")
    ap.add_argument("--reference", default="",
                    help="JSON of recorded reference answers; without it the "
                         "head-to-head is reported BLOCKED rather than faked")
    ap.add_argument("--json", dest="out", default="")
    args = ap.parse_args()

    spec = json.loads(CASES.read_text(encoding="utf-8"))
    cases = spec["cases"]

    ours: list = []
    rows: list[dict] = []

    if args.live:
        for case in cases:
            try:
                got = await ask(case["query"])
            except Exception as e:  # noqa: BLE001
                rows.append({"id": case["id"], "error": f"{type(e).__name__}: {e}"})
                continue
            card = score_answer(
                case, got["answer"], citations=got["citations"],
                latency_ms=got["latency_ms"], scope_status=got["scope_status"],
                system="alphagravity",
            )
            ours.append(card)
            rows.append({
                "id": case["id"], "category": case["category"],
                "latency_ms": round(got["latency_ms"], 1),
                "answer_excerpt": (got["answer"] or "")[:220],
                "citations": len(got["citations"]),
                "card": card.as_dict(),
            })
    else:
        print("No --live: nothing was queried, so nothing is scored.")

    reference_cards: list = []
    reference_status = "BLOCKED"
    reference_reason = (
        "No reference answers supplied. A head-to-head needs a recording of "
        "what a top ChatGPT finance answer actually said; inventing one would "
        "make this benchmark score the system against itself."
    )
    if args.reference:
        refs = json.loads(Path(args.reference).read_text(encoding="utf-8"))
        for case in cases:
            r = refs.get(case["id"])
            if not r:
                continue
            reference_cards.append(score_answer(
                case, r.get("answer", ""), citations=r.get("citations") or [],
                latency_ms=r.get("latency_ms"), scope_status=r.get("scope_status", ""),
                system="reference",
            ))
        if reference_cards:
            reference_status = "SCORED"
            reference_reason = ""

    ours_agg = aggregate(ours)
    ref_agg = aggregate(reference_cards)

    verdict = "UNVERIFIED"
    if reference_status == "SCORED" and ours_agg["mean_weighted"] is not None:
        verdict = ("alphagravity >= reference"
                   if ours_agg["mean_weighted"] >= ref_agg["mean_weighted"]
                   else "alphagravity < reference")

    report = {
        "dataset": spec["dataset"], "version": spec["version"],
        "cases": len(cases),
        "alphagravity": ours_agg,
        "reference": ref_agg,
        "reference_status": reference_status,
        "reference_reason": reference_reason,
        "verdict": verdict,
        "ungraded_dimensions": [d.key for d in DIMENSIONS if not d.mechanical],
        "ungraded_weight": sum(d.weight for d in DIMENSIONS if not d.mechanical),
        "rows": rows,
    }

    print(f"\n{spec['dataset']} v{spec['version']} — {len(cases)} cases")
    if ours:
        print(f"\nALPHAGRAVITY   mean weighted {ours_agg['mean_weighted']} "
              f"over {ours_agg['graded_weight_pct']}% of the rubric's weight")
        for k, v in (ours_agg.get("per_dimension") or {}).items():
            print(f"  {k:16} {v if v is not None else 'ungraded'}")
        print(f"  {'false_confidence':16} {ours_agg.get('false_confidence')} "
              f"(a wrong figure stated)")
        print(f"  {'false_abstention':16} {ours_agg.get('false_abstention')} "
              f"(declined a question it should have answered)")
        print()
        for r in rows:
            if "error" in r:
                print(f"  [ERR ] {r['id']}: {r['error']}")
                continue
            c = r["card"]
            corr = c["scores"].get("correctness")
            mark = "ok  " if corr == 1.0 else ("FAIL" if corr == 0.0 else "—   ")
            print(f"  [{mark}] {r['id']:26} w={c['weighted']} "
                  f"{r['latency_ms']:>7.0f}ms  cites={r['citations']}")

    print(f"\nREFERENCE: {reference_status}")
    if reference_reason:
        print(f"  {reference_reason}")
    print(f"VERDICT: {verdict}")
    print(f"\nUNGRADED: {report['ungraded_dimensions']} "
          f"({report['ungraded_weight']} of 100 points). These need human or "
          "multi-trial judgement; a single model-judge call at a fixed "
          "threshold is a biased coin and is not used.")

    if args.out:
        p = Path(args.out)
        p.parent.mkdir(parents=True, exist_ok=True)
        p.write_text(json.dumps(report, indent=2), encoding="utf-8")
        print(f"wrote {p}")

    # Non-zero only when we actually scored and lost on correctness.
    if ours and (ours_agg.get("per_dimension") or {}).get("correctness") not in (None, 1.0):
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(asyncio.run(main()))
