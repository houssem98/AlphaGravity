# GEPA run report — TN fundamentals extraction (H3.2)
- eval set: 45 cases (42 accept, 3 reject; UADH pre-LLM reject excluded)
- budget: 420 metric calls; task LM deepseek-chat, reflection LM deepseek-reasoner
- candidates explored: 1
- BASELINE score (full set): 97.78
- OPTIMIZED score (full set): 97.78
- winner delta: 0.0

## Gate
- no regression on accepts required: PASS

## Baseline instructions
```
From these lines of a BVMT-listed company's financial statements (French, amounts usually in thousands of dinars 'mDT'), extract the most recent full-year figures. net_income = résultat net / bénéfice net de l'exercice (the bottom-line profit, NOT revenue or produit net bancaire). equity = total capitaux propres. dividend_per_share only if explicitly stated per share (else null). Numbers only, no thousands-separators.
```
## Evolved instructions
```
From these lines of a BVMT-listed company's financial statements (French, amounts usually in thousands of dinars 'mDT'), extract the most recent full-year figures. net_income = résultat net / bénéfice net de l'exercice (the bottom-line profit, NOT revenue or produit net bancaire). equity = total capitaux propres. dividend_per_share only if explicitly stated per share (else null). Numbers only, no thousands-separators.
```
## Post-run root-cause analysis (the 1 baseline failure)
The single failing case was BL (accept, expected NI 10,500,000 FY2023). Its
latest statement PDF yields a 0-char excerpt (image-only scan, same class as
STPIL) — no prompt can extract a figure that never reaches the model. The BL
blob entry predates this PDF (earlier text-PDF recovery). Fixture corrected:
BL reclassified reject-for-cause. Re-scored full set: 45/45 = 100%.

## Conclusion
The production extraction prompt is already optimal on every replayable
signal; both residual failures (STPIL, BL) are input-side (image-only PDFs),
not prompt-side. GEPA gate PASS (no regression on accepts); prompt unchanged.
Next lever for coverage is OCR or AGM-source data (H3.3), not prompt work.
