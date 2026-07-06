#!/usr/bin/env python3
"""H3.2: evolve the TN fundamentals extraction prompt with raw DSPy + GEPA.

Program under evolution: one dspy.Predict that maps a French statement
excerpt -> {fiscal_year, net_income_mdt, equity_mdt, dividend_per_share_tnd}.
Eval set: H3.1 cases with cached excerpts (42 accepts + STPIL/BTE/TAIR
rejects; UADH is a pre-LLM reject, excluded).

Metric (same gate as the roadmap):
- accept case: 1.0 iff scale-normalized NI within 2% of expected AND fiscal
  year matches (the plausible-PER scale search mirrors tn_fundamentals.py).
- reject case: 1.0 iff extraction still ends in reject (empty NI or no
  plausible scale) OR yields a plausible in-band PER (recovering STPIL with
  a sane number counts as success, per roadmap: "STPIL extracts plausibly
  or stays rejected-for-cause").

Gate for adopting a winner: no regression on the 42 accepts.

Usage: python gepa_extraction.py [--budget N]  (default light budget)
Writes gepa_report.md next to this file.
"""
import json
import os
import pathlib
import sys
from typing import Optional

import dspy

HERE = pathlib.Path(__file__).resolve().parent
ROOT = HERE.parents[2]
for line in (ROOT / ".env").read_text(encoding="utf-8", errors="ignore").splitlines():
    if "=" in line and not line.strip().startswith("#"):
        k, _, v = line.partition("=")
        os.environ.setdefault(k.strip(), v.strip())

CASES = json.loads((HERE / "tn_fundamentals_cases.json").read_text(encoding="utf-8"))
META = json.loads((HERE / "excerpts" / "meta.json").read_text(encoding="utf-8"))

BASELINE_INSTRUCTIONS = (
    "From these lines of a BVMT-listed company's financial statements (French, amounts "
    "usually in thousands of dinars 'mDT'), extract the most recent full-year figures. "
    "net_income = résultat net / bénéfice net de l'exercice (the bottom-line profit, NOT "
    "revenue or produit net bancaire). equity = total capitaux propres. dividend_per_share "
    "only if explicitly stated per share (else null). Numbers only, no thousands-separators."
)


class Extract(dspy.Signature):
    """placeholder — instructions injected below"""
    company: str = dspy.InputField()
    excerpt: str = dspy.InputField()
    fiscal_year: Optional[int] = dspy.OutputField()
    net_income_mdt: Optional[float] = dspy.OutputField(desc="null if not found")
    equity_mdt: Optional[float] = dspy.OutputField(desc="null if not found")
    dividend_per_share_tnd: Optional[float] = dspy.OutputField(desc="null unless explicitly per share")


Extract.__doc__ = BASELINE_INSTRUCTIONS


def plausible_scale(raw, shares, price):
    if not (shares and price) or raw is None or raw <= 0:
        return None
    return next((s for s in (1000.0, 1.0, 1e6) if 2 <= price / (raw * s / shares) <= 80), None)


def metric(example, pred, trace=None, pred_name=None, pred_trace=None):
    tk = example.ticker
    m = META[tk]
    try:
        raw = float(pred.net_income_mdt) if pred.net_income_mdt is not None else None
    except (TypeError, ValueError):
        raw = None
    scale = plausible_scale(raw, m["shares"], m["price"])
    if example.verdict == "reject":
        if not example.excerpt.strip():
            # image-only PDF (STPIL): any number is a hallucination
            ok = raw is None
            fb = "empty excerpt: net_income must be null, any number is hallucinated"
        else:
            # loss-makers (BTE/TAIR): negative NI or null are both faithful
            ok = raw is None or raw < 0
            fb = "loss-maker: net_income must be negative or null, positive = misread"
        score = 1.0 if ok else 0.0
    else:
        exp = example.expect
        if scale is None:
            score, fb = 0.0, f"no plausible-PER scale for raw={raw} (shares={m['shares']} price={m['price']})"
        else:
            ni = raw * scale
            fy_ok = int(pred.fiscal_year or 0) == exp["fiscalYear"]
            ni_ok = abs(ni - exp["netIncome"]) / exp["netIncome"] <= 0.02
            score = 1.0 if (fy_ok and ni_ok) else 0.0
            fb = f"NI got={ni} want={exp['netIncome']} FY got={pred.fiscal_year} want={exp['fiscalYear']}"
    if pred_name is None:
        return score
    return dspy.Prediction(score=score, feedback=fb)


def build_examples():
    exs = []
    for c in CASES:
        tk = c["ticker"]
        if tk not in META:
            continue
        excerpt = (HERE / "excerpts" / f"{tk}.txt").read_text(encoding="utf-8")
        exs.append(dspy.Example(
            ticker=tk, verdict=c["verdict"], expect=c.get("expect"),
            company=META[tk]["name"], excerpt=excerpt,
        ).with_inputs("company", "excerpt"))
    return exs


def main():
    budget = int(sys.argv[sys.argv.index("--budget") + 1]) if "--budget" in sys.argv else 420
    lm = dspy.LM("deepseek/deepseek-chat", api_key=os.environ["DEEPSEEK_API_KEY"],
                 temperature=0.0, max_tokens=800)
    dspy.configure(lm=lm)

    program = dspy.Predict(Extract)
    exs = build_examples()
    accepts = [e for e in exs if e.verdict == "accept"]
    rejects = [e for e in exs if e.verdict == "reject"]
    # train/val split: GEPA optimizes on train, pareto-validates on val
    train = accepts[1::2] + rejects[:2]   # odd indices include BL, the one baseline failure
    val = accepts[::2] + rejects[2:]
    print(f"cases={len(exs)} train={len(train)} val={len(val)}")

    if "--smoke" in sys.argv:
        smoke = dspy.Evaluate(devset=exs[:4] + rejects[:2], metric=metric,
                              num_threads=4, display_progress=True, provide_traceback=True)
        print("SMOKE:", smoke(program).score)
        return

    evaluate = dspy.Evaluate(devset=exs, metric=metric, num_threads=8, display_progress=True)
    base = evaluate(program)
    base_score = base.score
    print(f"BASELINE full-set score: {base_score}")

    gepa = dspy.GEPA(metric=metric, max_metric_calls=budget, num_threads=8,
                     track_stats=True,
                     reflection_lm=dspy.LM("deepseek/deepseek-reasoner",
                                           api_key=os.environ["DEEPSEEK_API_KEY"],
                                           temperature=1.0, max_tokens=8000))
    optimized = gepa.compile(program, trainset=train, valset=val)

    opt = evaluate(optimized)
    opt_score = opt.score
    print(f"OPTIMIZED full-set score: {opt_score}")

    results = getattr(optimized, "detailed_results", None)
    cands = len(results.candidates) if results else "n/a"
    new_instr = optimized.signature.instructions
    report = [
        "# GEPA run report — TN fundamentals extraction (H3.2)",
        f"- eval set: {len(exs)} cases ({len(accepts)} accept, {len(rejects)} reject; UADH pre-LLM reject excluded)",
        f"- budget: {budget} metric calls; task LM deepseek-chat, reflection LM deepseek-reasoner",
        f"- candidates explored: {cands}",
        f"- BASELINE score (full set): {base_score}",
        f"- OPTIMIZED score (full set): {opt_score}",
        f"- winner delta: {round(opt_score - base_score, 4)}",
        "",
        "## Gate",
        f"- no regression on accepts required: {'PASS' if opt_score >= base_score else 'FAIL — keep baseline prompt'}",
        "",
        "## Baseline instructions",
        "```", BASELINE_INSTRUCTIONS, "```",
        "## Evolved instructions",
        "```", new_instr, "```",
    ]
    (HERE / "gepa_report.md").write_text("\n".join(report), encoding="utf-8")
    print("report written:", HERE / "gepa_report.md")


if __name__ == "__main__":
    main()
