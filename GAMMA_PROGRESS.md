# GAMMA loop progress — self-improving design + content

NEXT: G1a

## Tasks
- [x] G0a design rubric gamma-design-v1: 4 structure-judged dims + computeStructureStats
- [x] G0b design baseline over 5 archived v2 reports → eval/out/design-baseline.json
- [ ] G1a block library + deterministic section-shape classifier (sectionLayout.ts + tests)
- [ ] G1b web renderer honors per-section layouts + stat cards (extractor-only)
- [ ] G1c designer proposes per-section layout overrides (enum-bounded, validator preconditions)
- [ ] G1d design eval re-run → delta vs G0
- [ ] G2a numeric-series → bounded ExhibitSpec extractor + tests
- [ ] G2b web inline-SVG exhibits (no new dep) + PDF reuse
- [ ] G2c design eval re-run → delta
- [ ] G2.5a ReportTheme tokens (institutional/editorial/mono, enum-selected)
- [ ] G3a exemplar bank: persist {DesignSpec, score, tone/intent} outcomes
- [ ] G3b few-shot designer with top exemplars; measure iterations + score delta
- BLOCKED G4: vision judging (no vision key) · full-pipeline re-eval + W2a verify (Tavily quota) · insight-dim work (needs re-eval)

## Ledger
(one line per task: task · commit · what changed · MEASURED vs expected effect)
- G0a · 5ac3161 · gamma-design-v1 rubric (visual_hierarchy/scannability/exhibit_readiness/layout_variety) versioned separately from content rubric + computeStructureStats zero-LLM counts · 7/7 tests, typecheck clean. BUG FOUND BY TEST: even-length median took upper value → balanceRatio always 1.0 on 2-section docs (blind); fixed with true median. Roadmap corrected: real gamma.app core = per-section layout selection (rewrote G1), added G2.5 themes
- G0b · 2964f63 · designEval.test.ts scores archived markdown (quota-immune; DESIGN_EVAL_DIR/OUT for later corpora) · MEASURED BASELINE 5/5: visual_hierarchy 7.0 · scannability 6.2 (weakest) · exhibit_readiness 7.8 · layout_variety 7.6. Hard stats: avg para 888 chars (scannability drag), balanceRatio 2.41, 17.2 tables, 309 units/report. Judge rationale converges: "dense prose blocks, needs bullets/visual breaks" + "metrics concrete and chart-ready" → G1/G2 have real headroom on scannability, less on exhibit_readiness. Gotcha: deepseek-v4-flash = reasoning model, low max_tokens returns empty text (cap 3000)
