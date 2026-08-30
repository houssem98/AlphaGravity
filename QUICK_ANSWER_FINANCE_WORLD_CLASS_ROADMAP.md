# AlphaGravity — World-Class Finance Quick Answer Roadmap

## Goal
Make Quick Answer competitive with a top ChatGPT financial answer: fast, direct, finance-aware, evidence-grounded, citation-verified, period-correct, and honest about uncertainty.

**This is Quick Answer, not Deep Research.**

## Definition of Done
- Correct finance intent and entities.
- Works across arbitrary resolvable companies, not a small allowlist.
- Fiscal periods and calculations are correct.
- Answers directly without unnecessary Deep Research behavior.
- Uses strong primary evidence when appropriate.
- Exact claim-to-citation verification.
- No hallucination and no unnecessary abstention.
- Useful partial answers when evidence is partial.
- Fast-path latency is measured and improved without removing verification.

## Phase 1 — Baseline
Inspect git status/diff and current Quick Answer docs. Run backend/frontend tests, typecheck, build, Quick Answer evals, and available live/browser checks. Record exact baseline.

## Phase 2 — Finance Query Planning
Strengthen planning for revenue, growth, margins, operating income, net income, EPS, FCF, guidance, comparisons, rankings, filings, tariffs/trade risk, sentiment, and latest/current questions. Keep ordinary Quick Answer fast.

## Phase 3 — Universal Entity Resolution
Support ticker, company name, legal name, aliases, exchange+ticker, and former names where available. States: RESOLVED / AMBIGUOUS / UNKNOWN. Remove accidental company/ticker allowlists and company-specific production branches. Test many sectors.

## Phase 4 — Financial Reasoning
Correctly normalize fiscal year, quarter, calendar period, TTM, and reported period. Correctly calculate YoY, QoQ, CAGR when requested, margins, percentage-point changes, and basis-point changes. Never silently mix periods.

## Phase 5 — Company Skill
Make Company generic and evidence-driven for arbitrary resolvable companies. Missing data stays missing; never convert unavailable data to zero.

## Phase 6 — Sentiment Skill
Make Sentiment generic and evidence-driven. Separate management/earnings, SEC, news, analyst/research, and market-derived evidence where possible. Do not equate price movement with sentiment. Clearly report weak/conflicting evidence.

## Phase 7 — Scope-Aware Quick Answer
For questions such as “Which S&P 500 companies mentioned tariff risk in their 10-K?” distinguish:
- confirmed partial;
- confirmed exhaustive;
- insufficient evidence.

Do not abstain merely because exhaustive coverage is unavailable. Secondary sources can discover candidates, but final 10-K claims should be supported by the 10-K when available. Add `coverage_status` and `scope_status`. Never claim exhaustive coverage without proving the universe was covered.

## Phase 8 — SEC Provenance
Canonical filing reference should include CIK, accession, form, filing date, period, primary document, primary-document URL, and filing-index URL when available.

**View filing → actual primary SEC filing HTML.**
**Filing details → SEC filing index/detail page.**

Frontend must consume canonical provenance and never construct SEC URLs from ticker/company names. If the primary document cannot be safely resolved, do not show a misleading View filing link.

## Phase 9 — Verification
`verified = exact claim supported by exact cited evidence`.

Test invalid citation indexes, wrong company, wrong period, wrong number, correct number from wrong period, unrelated evidence, and conflicting evidence. Later provenance normalization must never turn a failed verdict into verified.

## Phase 10 — Abstention
Fix the known future/unreported-period inconsistency. Future/unreported periods must deterministically return insufficient-evidence/not-reported. Partial evidence should produce a useful partial answer.

## Phase 11 — Retrieval Failure Semantics
Preserve `success`, `empty`, `failed`, `timeout`, `unavailable`. A failed provider must not masquerade as an empty successful search.

## Phase 12 — Performance
Measure entity resolution, retrieval, embedding, reranking, generation, verification, and total latency. Previous observed p50 was about 28 seconds; make no performance claim without fresh measurements. Improve fast path without removing verification.

## Phase 13 — Evaluation
Test revenue, growth, margins, profitability, EPS, FCF, comparisons, rankings, tariffs, SEC filings, sentiment, latest results, fiscal periods, future periods, missing data, ambiguity, partial evidence, conflicting evidence, and multi-company questions. Use many companies/sectors. Track answer accuracy, numeric accuracy, period accuracy, citation validity/support, unsupported-claim rate, false-confidence, false-abstention, coverage, and latency.

## Phase 14 — Browser/Live Validation
When permitted, verify Quick Answer, Company, Sentiment, SEC citation, View filing, Filing details, multi-company, missing data, future periods, and history replay. If blocked, report BLOCKED; never fake results.

## Phase 15 — Adversarial Pass
Attack unknown/ambiguous companies, wrong tickers, wrong periods, future periods, missing metrics, conflicting sources, invalid citations, wrong SEC documents/exhibits, and failed retrieval channels.

## Final Documentation
Create/update:
- `docs/quick-answer/SKILL_COVERAGE_MATRIX.md`
- `docs/quick-answer/FINAL_FINANCE_QUICK_ANSWER_VERIFICATION.md`

Report every gate as PASS / PARTIAL / BLOCKED / UNVERIFIED with exact commands, counts, exit codes, timings, and remaining limitations.

Never claim world-class or complete without evidence.
