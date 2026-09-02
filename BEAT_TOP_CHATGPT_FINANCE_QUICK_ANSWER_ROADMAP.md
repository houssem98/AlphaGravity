# AlphaGravity — Beat Top ChatGPT Finance Quick Answer Roadmap

## Mission
Make Quick Answer equal to or better than a top ChatGPT finance answer on correctness, financial reasoning, evidence, provenance, scope honesty, clarity, and latency. Keep it fast; do not turn every query into Deep Research.

## P0 — Correctness
1. **Citation verification:** deterministic verification is the sole authority for `verified`. Require valid citation target, matching entity/metric/period, supported numbers, valid provenance, and no contradiction/failure. Add adversarial tests for invalid indexes, wrong company/metric/period, unsupported claims, conflicts, and incomplete provenance. A failed citation can never later become verified.
2. **SEC provenance:** canonical filing object with CIK, accession, form, filing date, reporting period, primary document, primary filing HTML URL, and filing index/detail URL. `View SEC filing` must open the exact primary HTML; `Filing details` the exact SEC index. Never construct URLs from ticker/company; never use ticker as CIK; never fall back to generic EDGAR pages.
3. **Period integrity:** strictly distinguish FY, fiscal quarter, calendar period, TTM, YTD, guidance, filing date, and reporting period. Exact period questions require exact matching evidence. Future/unreported periods deterministically abstain.
4. **Finance math:** context-aware quantities carrying company, metric, period, unit, and basis. Safely support YoY/QoQ/CAGR/margins/percentage points/bps/absolute change/ratios/multiples. Refuse incompatible inputs, zero denominators, overflow, non-finite values, unsupported basis, and missing inputs.

## P1 — Universal finance skills
5. **Entity resolution:** ticker, company/legal name, aliases, exchange-qualified tickers, safe former names. `RESOLVED / AMBIGUOUS / UNKNOWN`. No small hard-coded company allowlist.
6. **Company skill:** generic arbitrary-issuer support for revenue, earnings, margins, EPS, FCF, balance sheet, guidance, filings, risks, and period comparisons. Retrieve only evidence needed.
7. **Sentiment skill:** separate management/earnings, SEC risk language, news, analyst/research, and market-derived signals. Never infer sentiment from price alone. Expose evidence basis, time window, coverage/confidence, and conflicts.
8. **Scope-aware sets:** for questions such as S&P 500 tariff risk, distinguish exhaustive/partial/unknown. Secondary sources discover; primary filings confirm. Never present a partial scan as exhaustive.

## P1 — Reliability and speed
9. **Channel status:** every provider preserves `success | empty | failed | timeout | unavailable`, plus latency, error category, channel, result count. Exceptions must not silently become successful empty results.
10. **Latency forensics:** instrument request → planning → entity → each retrieval channel → merge/dedup → rerank → context → generation → verification → provenance → serialization. Find the previously unexplained ~23s. Do not disable verification to improve speed. Target simple 2–5s, normal 4–8s, moderately complex 6–10s.

## P1 — Answer quality
11. **Answer Contract:** deterministic contract consumed by generation: mode, question class, entities, metrics, period, comparison, required evidence, source priority, primary-source requirement, coverage, verification, abstention, directness. Pipeline: QUESTION → PLAN → CONTRACT → RETRIEVE → NORMALIZE → COMPUTE → VERIFY → SCOPE → GENERATE → FINAL GATE → ANSWER.
12. **Top-model behavior:** answer first; key result first; concise; show calculations when useful; tables for comparisons; citations beside claims; label partial coverage; no internal pipeline noise; no invented facts.

## P2 — Evaluation
13. **Golden benchmark:** revenue, growth, margins, income, EPS, FCF, guidance, comparisons, rankings, tariffs, 10-K, sentiment, latest results, periods, future periods, missing/ambiguous data, partial/conflicting evidence, calculations, multi-company. Measure answer/numeric/period/entity accuracy, citation validity/support, provenance completeness, unsupported-claim rate, false-confidence, false-abstention, scope, latency.
14. **Blind head-to-head:** compare AlphaGravity with a top ChatGPT finance answer. Score correctness 30%, evidence 20%, reasoning 15%, period/entity 10%, scope/completeness 10%, clarity 10%, latency 5%. Goal: AlphaGravity >= reference in aggregate with no catastrophic correctness/provenance failures. Do not tune to leaked answers.

## P2 — Live and red-team
15. Test real SEC links, arbitrary companies, sentiment, set questions, future periods, history replay, missing data, and citation clicks whenever environment permits. Blocked tests must be labeled BLOCKED with the exact reason.
16. Red-team invalid citations, wrong SEC docs/CIK/accession, wrong/future periods, wrong/ambiguous companies, missing metrics, unsupported calculations, provider failures, partial universes, conflicts, and attempts to force `verified`. Every defect needs reproducer → failing test → fix → regression test → rerun.

## Final gate
Backend, frontend, typecheck, build, finance eval, Quick Answer eval, skill coverage, SEC matrix, provenance, period, scope, retrieval failure, performance, benchmark, and gate-guard must pass where executable. Create `docs/quick-answer/FINAL_BEAT_TOP_CHATGPT_VERIFICATION.md` with exact commands, counts, exit codes, p50/p95 latency, benchmark scores, and PASS/PARTIAL/BLOCKED/UNVERIFIED status.

Never claim “beats ChatGPT” merely because tests are green; the head-to-head benchmark must demonstrate it.
