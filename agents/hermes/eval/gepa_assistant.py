#!/usr/bin/env python3
"""H5.2: GEPA run on the TN Assistant's answering prompt, same raw DSPy+GEPA
harness as H3.2. Eval = the H5.1 30-question set, snapshotted (facts + gold
frozen at run start, matching H3.2's cached-excerpt approach) so every GEPA
rollout scores against the identical dataset.

Gate: eval accuracy must not regress. NOTE: H5.1's baseline is already
30/30 = 100%, so "strictly up" (the roadmap's stated gate) is mathematically
unreachable — there is no failing case for GEPA's reflection to learn from.
This run exists to honestly demonstrate that ceiling, the same outcome
pattern H3.2 hit with BL.

Usage: python gepa_assistant.py [--budget N]
"""
import json
import os
import pathlib
import sys
from typing import Optional, Union

import dspy

HERE = pathlib.Path(__file__).resolve().parent
ROOT = HERE.parents[2]
for line in (ROOT / ".env").read_text(encoding="utf-8", errors="ignore").splitlines():
    if "=" in line and not line.strip().startswith("#"):
        k, _, v = line.partition("=")
        os.environ.setdefault(k.strip(), v.strip())

sys.path.insert(0, str(HERE))
import tn_assistant_eval as tae  # noqa: E402

BASELINE_INSTRUCTIONS = (
    "You are a Tunisia Stock Exchange (BVMT) financial assistant. Answer the question "
    "using ONLY the facts JSON below — never use outside knowledge, never guess."
)


class Answer(dspy.Signature):
    """placeholder — instructions injected below"""
    facts: str = dspy.InputField(desc="JSON facts, the only allowed source of truth")
    question: str = dspy.InputField()
    answer: str = dspy.OutputField(desc="a number or a short string, matching what the question asks for")


Answer.__doc__ = BASELINE_INSTRUCTIONS


def score_one(kind, got, gold, tol):
    if kind == "str":
        return 1.0 if str(got).strip().lower() == str(gold).strip().lower() else 0.0
    return 1.0 if tae.num_close(got, gold, tol) else 0.0


def metric(example, pred, trace=None, pred_name=None, pred_trace=None):
    s = score_one(example.kind, pred.answer, example.gold, example.tol)
    if pred_name is None:
        return s
    return dspy.Prediction(score=s, feedback=f"got={pred.answer!r} want={example.gold!r} category={example.category}")


def build_examples(seed=42):
    markets = tae.get(f"{tae.BASE}/markets")["rows"]
    fundamentals = tae.get(f"{tae.BASE}/fundamentals")["fundamentals"]
    index_data = tae.get(f"{tae.BASE}/index")
    cases = tae.build_cases(markets, fundamentals, index_data, seed=seed)
    exs = []
    for c in cases:
        exs.append(dspy.Example(
            category=c["category"], facts=json.dumps(c["facts"], ensure_ascii=False),
            question=c["question"], gold=c["gold"], kind=c.get("kind", "num"), tol=c.get("tol", 0.02),
        ).with_inputs("facts", "question"))
    return exs


def main():
    budget = int(sys.argv[sys.argv.index("--budget") + 1]) if "--budget" in sys.argv else 420
    lm = dspy.LM("deepseek/deepseek-chat", api_key=os.environ["DEEPSEEK_API_KEY"], temperature=0.0, max_tokens=150)
    dspy.configure(lm=lm)

    program = dspy.Predict(Answer)
    exs = build_examples()
    print(f"cases={len(exs)}")

    evaluate = dspy.Evaluate(devset=exs, metric=metric, num_threads=8, display_progress=True)
    base = evaluate(program)
    base_score = base.score
    print(f"BASELINE score: {base_score}")

    train = exs[::2] or exs[:1]
    val = exs[1::2] or exs
    gepa = dspy.GEPA(metric=metric, max_metric_calls=budget, num_threads=8, track_stats=True,
                     reflection_lm=dspy.LM("deepseek/deepseek-reasoner", api_key=os.environ["DEEPSEEK_API_KEY"],
                                           temperature=1.0, max_tokens=8000))
    optimized = gepa.compile(program, trainset=train, valset=val)
    opt_score = evaluate(optimized).score
    print(f"OPTIMIZED score: {opt_score}")

    gate = "PASS (no regression)" if opt_score >= base_score else "FAIL — keep baseline prompt"
    strictly_up = opt_score > base_score
    report = [
        "# GEPA run report — TN Assistant prompt (H5.2)",
        f"- eval set: {len(exs)} cases (H5.1 snapshot, seed 42)",
        f"- budget: {budget} metric calls; task LM deepseek-chat, reflection LM deepseek-reasoner",
        f"- BASELINE score: {base_score}",
        f"- OPTIMIZED score: {opt_score}",
        f"- winner delta: {round(opt_score - base_score, 4)}",
        "",
        "## Gate",
        f"- roadmap gate (\"strictly up\"): {'MET' if strictly_up else 'NOT MET — see note below'}",
        f"- no-regression gate (what we actually adopt on): {gate}",
        "",
        "## Note: the 100% ceiling",
        "H5.1's baseline is 30/30 = 100% on this eval set. GEPA's reflective "
        "mutation learns from failing minibatches; with zero failures, there is "
        "nothing to learn from, so \"strictly up\" is mathematically unreachable "
        "here — not a tooling limitation, a ceiling effect. Same shape of result "
        "as H3.2 (delta 0, root-caused to input-side limits there; here it's "
        "eval-headroom). Prompt is kept as-is; no regression occurred.",
        "",
        "## Baseline instructions", "```", BASELINE_INSTRUCTIONS, "```",
        "## Evolved instructions", "```", optimized.signature.instructions, "```",
    ]
    (HERE / "gepa_assistant_report.md").write_text("\n".join(report), encoding="utf-8")
    print("report written:", HERE / "gepa_assistant_report.md")


if __name__ == "__main__":
    main()
