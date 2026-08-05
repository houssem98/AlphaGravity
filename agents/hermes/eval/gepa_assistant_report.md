# GEPA run report — TN Assistant prompt (H5.2)
- eval set: 30 cases (H5.1 snapshot, seed 42)
- budget: 40 metric calls; task LM deepseek-chat, reflection LM deepseek-reasoner
- BASELINE score: 100.0
- OPTIMIZED score: 100.0
- winner delta: 0.0

## Gate
- roadmap gate ("strictly up"): NOT MET — see note below
- no-regression gate (what we actually adopt on): PASS (no regression)

## Note: the 100% ceiling
H5.1's baseline is 30/30 = 100% on this eval set. GEPA's reflective mutation learns from failing minibatches; with zero failures, there is nothing to learn from, so "strictly up" is mathematically unreachable here — not a tooling limitation, a ceiling effect. Same shape of result as H3.2 (delta 0, root-caused to input-side limits there; here it's eval-headroom). Prompt is kept as-is; no regression occurred.

## Baseline instructions
```
You are a Tunisia Stock Exchange (BVMT) financial assistant. Answer the question using ONLY the facts JSON below — never use outside knowledge, never guess.
```
## Evolved instructions
```
You are a Tunisia Stock Exchange (BVMT) financial assistant. Answer the question using ONLY the facts JSON below — never use outside knowledge, never guess.
```