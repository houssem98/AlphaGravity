"""Live component latency for Quick Answer (roadmap Phase 12).

What this measures and what it does not, stated plainly because the distinction
is the whole point:

MEASURED — the provider legs that are reachable from this environment:
  * embedding      (Voyage)
  * reranking      (Cohere)
  * generation     (DeepSeek), including time-to-first-token

NOT MEASURED — retrieval latency and true end-to-end Quick Answer latency.
Those need a live corpus. Qdrant :6333, Elasticsearch :9200, Neo4j and Redis
:6379 all refuse connections here because the Docker daemon is not running, so
a retrieval number would be fabricated. It is reported as null rather than
estimated.

Every figure below is the median of N real calls. Run:

    python -m eval.quick_answer.live_perf --runs 5 --json results/live_perf.json
"""

from __future__ import annotations

import argparse
import asyncio
import json
import os
import statistics
import time
from pathlib import Path

PROMPT = (
    "Using only the passages below, answer in JSON with keys "
    '"answer" and "citations".\n\n'
    "[1] Revenue for fiscal year 2025 was $130,497 million.\n"
    "[2] Data Center revenue for fiscal 2025 was $115,186 million.\n\n"
    "Question: What was NVIDIA revenue in FY2025?"
)

DOCS = [
    "Revenue for fiscal year 2025 was $130,497 million.",
    "Data Center revenue for fiscal 2025 was $115,186 million.",
    "Gross margin was 75.0% in fiscal 2025.",
]


def _load_env() -> dict:
    env = {}
    for line in open(".env", encoding="utf-8", errors="ignore"):
        line = line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        k, v = line.split("=", 1)
        env[k.strip()] = v.strip()
    return env


def _median(xs):
    return round(statistics.median(xs), 1) if xs else None


async def measure_generation(runs: int) -> dict:
    from app.llm.base import LLMConfig, LLMMessage
    from app.llm.deepseek_client import DeepSeekClient

    client = DeepSeekClient()
    totals, ttfts, chars = [], [], []
    for _ in range(runs):
        t0 = time.perf_counter()
        first = None
        n = 0
        async for tok in client.generate_stream(
            messages=[LLMMessage(role="user", content=PROMPT)],
            config=LLMConfig(max_tokens=160, temperature=0.0),
        ):
            if first is None:
                first = (time.perf_counter() - t0) * 1000
            n += len(tok)
        totals.append((time.perf_counter() - t0) * 1000)
        if first is not None:
            ttfts.append(first)
        chars.append(n)
    return {
        "provider": "deepseek",
        "runs": runs,
        "ttft_ms_median": _median(ttfts),
        "total_ms_median": _median(totals),
        "response_chars_median": _median([float(c) for c in chars]),
    }


def measure_embedding(env: dict, runs: int) -> dict:
    import urllib.request

    lat = []
    for _ in range(runs):
        body = json.dumps({"model": "voyage-3.5-lite", "input": DOCS}).encode()
        req = urllib.request.Request(
            "https://api.voyageai.com/v1/embeddings", data=body, method="POST")
        req.add_header("Authorization", f"Bearer {env['VOYAGE_API_KEY']}")
        req.add_header("Content-Type", "application/json")
        t0 = time.perf_counter()
        with urllib.request.urlopen(req, timeout=30) as r:
            r.read()
        lat.append((time.perf_counter() - t0) * 1000)
    return {"provider": "voyage", "runs": runs, "docs": len(DOCS),
            "latency_ms_median": _median(lat)}


def measure_rerank(env: dict, runs: int) -> dict:
    import urllib.request

    lat = []
    for _ in range(runs):
        body = json.dumps({
            "model": "rerank-v3.5",
            "query": "What was NVIDIA revenue in FY2025?",
            "documents": DOCS, "top_n": 2,
        }).encode()
        req = urllib.request.Request(
            "https://api.cohere.com/v2/rerank", data=body, method="POST")
        req.add_header("Authorization", f"Bearer {env['COHERE_API_KEY']}")
        req.add_header("Content-Type", "application/json")
        t0 = time.perf_counter()
        with urllib.request.urlopen(req, timeout=30) as r:
            r.read()
        lat.append((time.perf_counter() - t0) * 1000)
    return {"provider": "cohere", "runs": runs, "docs": len(DOCS),
            "latency_ms_median": _median(lat)}


def measure_verification(runs: int) -> dict:
    """The deterministic layer, for scale: it runs in-process."""
    from eval.quick_answer.run_eval import run

    lat = []
    for _ in range(runs):
        t0 = time.perf_counter()
        report = run()
        lat.append((time.perf_counter() - t0) * 1000)
    return {"component": "citation_verification", "runs": runs,
            "cases": report["totals"]["cases"],
            "latency_ms_median_for_all_cases": _median(lat)}


async def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--runs", type=int, default=3)
    ap.add_argument("--json", type=Path)
    args = ap.parse_args()

    env = _load_env()
    for k, v in env.items():
        os.environ.setdefault(k, v)

    out = {
        "generated_at": time.strftime("%Y-%m-%dT%H:%M:%S"),
        "measured": {},
        "not_measured": {
            "retrieval_ms": None,
            "end_to_end_quick_answer_ms": None,
            "reason": (
                "No live corpus. Qdrant :6333, Elasticsearch :9200, Neo4j and "
                "Redis :6379 all refuse connections: the Docker daemon is not "
                "running. A retrieval or end-to-end figure would be fabricated."
            ),
        },
        "errors": {},
    }

    for name, fn in (
        ("generation", lambda: measure_generation(args.runs)),
        ("embedding", lambda: measure_embedding(env, args.runs)),
        ("rerank", lambda: measure_rerank(env, args.runs)),
        ("verification", lambda: measure_verification(args.runs)),
    ):
        try:
            r = fn()
            out["measured"][name] = await r if asyncio.iscoroutine(r) else r
        except Exception as e:  # a dead provider is a result, not a crash
            out["errors"][name] = f"{type(e).__name__}: {str(e)[:160]}"

    if args.json:
        args.json.parent.mkdir(parents=True, exist_ok=True)
        args.json.write_text(json.dumps(out, indent=2), encoding="utf-8")

    print(json.dumps(out, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(asyncio.run(main()))
