# Roadmap Progress — Research Grid + Quick Answer → world-class (Hebbia/AlphaSense/Rogo tier)

Durable state ledger for the `/loop` engineering run. **Read this first every iteration.**
One shippable task per iteration. P0 before P1, etc. Skip BLOCKED tasks.

- **Branch:** `roadmap/world-class` — PUSHED to origin, **PR #1 open** (https://github.com/houssem98/antigravity/pull/1).
- **ITERATION COMPLETE:** P1-d span-level citations implemented (commit 0e751a5). Infrastructure ready; value accrues with new ingestions (current corpus 2020-2026, no offsets until re-ingest).
- **NEXT:** Numeric lever = deterministic structured-fact pinning (via priority-pin logic in search_pipeline.py). Target: move numeric from ~50%→60%+ by ensuring exact XBRL facts survive context cut. Also P2-a transcripts ingestion (low-hanging corpus expansion).
- ⚠️ **ROTATE KEYS:** committed config files (`.claude/settings.json`, `.claude/settings.local.json`, `scripts/hermes.bat`) held live OpenRouter/Supabase/Anthropic keys. Purged from pushed history via git-filter-repo + `.gitignore`d on origin (PR #1). They remain in LOCAL history (commit 2bf71c6) → **rotate them**.
- ✅ **RECONCILE DONE:** local `roadmap/world-class` == origin (`f040457`, identical), WIP + configs preserved (configs now gitignored, untracked). `core.longpaths true` set.
- 🚨 **PUBLIC SECRET LEAK (user handling):** repo is PUBLIC and `origin/main` (commits `423e07b`, `a09c2fd`) contains 4 live keys (OpenRouter, Supabase Secret, Supabase PAT, Anthropic). User said they'll fix. Keys MUST be rotated (already public). Local branches main/hermes-integration/fix-* + `backup/roadmap-pre-scrub` still hold them in history.

---

## Task checklist

### P0 — Fix what's broken
- [x] **P0-a** Build/confirm eval harness + capture baselines — *DONE. FinanceBench sample-15 vs prod: numeric 33%, citation 20%, halluc 7%, 5/15 timed out, p50 33.6s.*
- [x] **P0-b** Fix table column-alignment bug + regression test — *DONE. Root cause: `table_indexer._extract_rows` mapped header col_idx into data row; SEC `$`/spacer `<td>`s misalign it. Fixed: align numeric cells to period cols by ORDER (`_row_numeric_values`). 2 regression tests pass. NOTE: stored 152k rows stay wrong until re-ingest (P1-a) — FinanceBench won't move from code alone.*
- [x] **P0-c** Grid concurrency: parallel for deepseek/claude, serial for Gemini — *DONE. `startRun` concurrency = `selectedModel==='gemini' ? 1 : 6`. `runGrid` already has a safe cursor worker-pool. Built + deployed; bundle shows `==="gemini"?1:6`. Expected ~6× grid wall-time for paid models (exact /100-cell throughput needs in-browser timing).*
- [x] **P0-d** Clean `filing_date` + fix root cause — *DONE. Ledger overstated it: 2026 dates are VALID (current year); real issue = impossible future dates. Nulled future-dated (chunks 2,829, doc_trees 7; financials clean, no NULLs) via `scripts/fix_future_filing_dates.py` on Fly (Supabase PostgREST 500s on the 2,829 because the generated `tsv` recomputes per row → ran server-side w/ statement_timeout=0). Root cause: `metadata_extractor._extract_date` returned the FIRST body date → grabbed lease/debt-maturity future dates. Fixed: pick latest plausible (1994..today). +4 regression tests pass. gravity-api redeploy deferred to P1-a (EDGAR poller uses explicit metadata dates, so low urgency).*
- [x] **P0-e** Confirm reranker fires; fix — *DONE. It fired but FAILED: prod COHERE key is an exhausted Trial key (429 every call) → no rerank + ~3.2s/query wasted. Switched `get_reranker()` to prefer Voyage rerank-2 (finance-tuned). Deployed gravity-api. Voyage fails FAST (rerank_ms 3200→172) — ~3s/query latency win. Rerank QUALITY still BLOCKED: Voyage free tier = 3 RPM (multi-query 429s); needs a PAID Voyage/Cohere key (user action). Also confirmed bm25/FTS channel fires.*

### P1 — Accuracy
- [x] **P1-a** XBRL backfill (validated on 29 FinanceBench tickers) — *DONE/validated. financials 152,086→168,177; extracted with P0-b fix. RESULT (sample-30 vs 33% baseline): numeric 30% (FLAT), citation 20% (flat), but hallucinations 7%→**0%**, timeouts 5/15→**0**, latency p50 33.6s→**17.9s**. KEY: backfill FIXED coverage (0 "sources lack data", was the baseline's main failure) but numeric DIDN'T move — remaining failures are derived/analytical Qs (ratios, trends, segment compare) returning EMPTY answers in fast mode → need agentic reasoning (P1-c), not more data. Full S&P backfill = cheap coverage win but won't lift FinanceBench numeric; deferred/optional.*
- [x] **P1-b** Tune hybrid fusion RRF weights — *DONE + deployed + validated. Fixed latent bug: live `authority_aware_rrf` used PLAIN RRF, so `weighted_rrf` channel weights (structured=1.2, tree_nav=1.1) never applied. Wired weighted base via shared `DEFAULT_CHANNEL_WEIGHTS`. 3 tests. Deployed (backfill stopped first). WARM sample-30 vs post-P1-a 30%: numeric 30% (FLAT — structured already pinned, as predicted), citation 20%→**27%**, errors 0, p50 17.9s→**13.2s**. Net neutral-positive → KEEP. (First post-deploy run was cold-start confounded: 8/30 timeouts; warm re-run clean.)*
- [~] **P1-c** Agentic cells — *INVESTIGATED, redirected. Probed fast vs agentic on a derived-metric Q (AMCOR quick-ratio YoY): IDENTICAL answers, both compute FY2023 (0.89x) but report FY2022 missing. Agentic is NOT the lever — the class is data-DEPTH limited, not reasoning limited. Also found: eval's "empty got" was a wrong-field display artifact; the model DOES answer (declines correctly when prior-year data absent). `structured_search` already requests multi-period (line 88-95); the FY2022 facts are simply not ingested (backfill depth = 4 filings/3yr). Real lever for YoY-derived Qs = deeper historical backfill (more 10-Ks/years) — big, slow. Deferred pending that.*
- [x] **P1-d** Span-level citations (store char offsets at ingest; highlight exact passage) — *DONE (infrastructure). Chunker computes char_offset_start/char_offset_end by text search; offsets flow through RetrievalResult → API → frontend. SourceContext highlights cited passage if offsets present. MVP: visual indicator (background highlight) when offsets available. VALUE: accrues with new documents; existing corpus (2020-2026) won't have offsets until re-ingest. Infrastructure ready for FinanceBench-targeted 2016-19 filing backfill (planned post-P1). Commit 0e751a5.*

### P2 — Corpus moat
- [ ] **P2-a** Add earnings-call transcripts ingestion source
- [ ] **P2-b** Add news / press-release source
- [ ] **P2-c** Freshness SLA: ingest < 1h of EDGAR publish

### P3 — Source viewer + workflow
- [ ] **P3-a** Filing/PDF source viewer with citation jump-to-span
- [x] **P3-b** Export grid → Excel — *DONE (pre-existing). `gridExcel.exportGridToXLSX` → Grid + Sources + FinData + Validation sheets; wired to Excel + CSV buttons. Verified.*
- [ ] **P3-c** Save/share grid views
- [ ] **P3-d** Deepen cross-doc comparison in grid

### P4 — Scale / enterprise
- [ ] **P4-a** Quick-answer p95 < 2s
- [ ] **P4-b** Grid 100 cells < 60s
- [ ] **P4-c** Enforce entitlements/permissions, audit log, SSO

---

## Benchmarks (target — current)

| Metric | Target | Current | Source |
|---|---|---|---|
| FinanceBench numeric QA | ≥80% | **~50%** (15/30, after scorer fix; was mis-measured 30%) | `tests/eval/financebench.py` |
| Company-correctness | 100% | unmeasured | `tests/eval/company_correctness.py` |
| Retrieval recall@10 | ≥0.90 | **~7%** (weak proxy) | source text widened 500→2000 (recall 0→7%); still a weak proxy — gold evidence phrased differently than chunks, 0.5 token-overlap too strict. Directional only. |
| Extraction accuracy (vs SEC XBRL) | ≥95% | **86%** (169 pts, deterministic) | `tests/eval/extraction_accuracy.py` — core facts; income~83%, balance-sheet~88%. NOT the numeric wall. |
| Citation faithfulness | ≥95% | **27%** hit-rate (8/30, was 20%) | financebench citation_check |
| Hallucination rate | <2% | **0%** (0/30, was 7%) | financebench hallucination flag |
| Quick-answer p95 latency | <2s | **p50 17.9s** (was 33.6s; 0 timeouts, was 5/15) | financebench latencies |
| Grid throughput /100 cells | <60s | slow (serial conc=1) | — |
| Corpus coverage | 500+ cos, +transcripts, <1h fresh | 283 cos, 1,603 filings, SEC-only | Supabase |

---

## Eval log (before → after per task)

- **Recall eval infra (P1-b support)** — added `evidence_recall` to `financebench.py` (token-overlap of gold FinanceBench `evidence` vs retrieved source text, hit ≥0.5) + `retrieval_recall` per-Q + `recall_rate` in report/summary. 4 unit tests pass. Built deploy-free during backfill; RUN it alongside the P1-b deploy+measure once backfill done (gives the first retrieval recall@k number + makes fusion tuning principled). Note: sample is deterministic (`seed(42)`) so same-N runs ARE comparable before/after.

- **P0-a (baseline)** — eval harness present: `financebench.py`, `financebench_xbrl.py`, `company_correctness.py`, `latency_cost_runner.py`, `judge_model.py`, `run_eval.py`. Local venv has httpx/datasets/tqdm/rouge_score. Prod `/v1/search` reachable (HTTP 200, ~13.5s, channels `[structured,dense,tree_nav]`). FinanceBench sample-15 baseline running → results pending.

## Observations / leads
- **EQUITY FIX — end-to-end FinanceBench FLAT (expected).** post-fix sample-30: numeric 14/28=50% (fixed scorer), errors=5 (timeouts), citation 6/30, halluc 0. No bench move — equity fix is real (3/3 deterministic) but only ~1-2/30 sample Qs are balance-sheet-derived + 5 timeouts mask it + n=30 noise. Pattern: each deterministic fix touches few bench Qs → invisible at n=30. Headline numeric stuck ~50% MEASURED.
- **LATENCY/TIMEOUTS recurring:** 5/30 errors again (p50 21.7s). Timeouts cap numeric + make every bench run noisy. Real lever for measurable numeric gain = (1) kill timeouts (latency), (2) retrieval determinism, (3) sweep ALL metric-vocab gaps — sustained eng, not single /loop ticks.

- **VALIDATED FIX — equity/balance-sheet structured retrieval was broken; now works.** Root cause: structured_search single-metric path used a LITERAL ilike (`*stockholders*equity*`) that missed filed labels saying "shareholders' equity" → structured channel silently didn't fire for equity queries (`channels=[dense,tree_nav]`, answer "not found"). Also "stockholders equity" was absent from _METRIC_TERMS and Liabilities/Equity absent from the qualitative fallback. Fixed: equity/AP/AR vocab + single-metric prefers curated `_METRIC_PATTERNS` ilike (`*holders*Equity*`, matches both) + full balance sheet in fallback. Deployed. DETERMINISTIC spot-check 3/3 correct: AAPL FY2023 equity $62,146M, MSFT $206,223M, NVDA $22,101M (before: not found). This unblocks balance-sheet-derived FinanceBench Qs (quick ratio, D/E).
- **MEASUREMENT NOTE:** the structured-retrieval-recall eval is too NONDETERMINISTIC to measure aggregate retrieval change (retrieved% swung 28%↔7% on identical facts across runs — multi_query + flaky reranker + top-K variance). Deterministic single-query spot-checks (channel fired? exact value in sources?) are the reliable validator. answered% (59→66) is confounded by LLM parametric memory for famous tickers.
- **NUMERIC WALL TRIANGULATED = unreliable surfacing of structured facts to the LLM (NOT extraction/data).** Built `tests/eval/structured_retrieval_recall.py` (facts known-in-financials → does /v1/search surface them). Clean run (n=29, errors=0): RETRIEVED 28%, ANSWERED 59%. BUT spot-check proved this UNDERSTATES it: re-querying NVDA FY2022 revenue returns the exact fact (`[EXACT FILING FIGURE] NVDA FY2022 Revenue: $26,914M`) in sources — i.e., retrieval is NONDETERMINISTIC (the exact-fact passage is indexed + retrieved by the structured channel but inconsistently survives fusion/rerank/top-K cut into the final context; flaky Voyage reranker adds variance). `answered 59% > retrieved 28%` also reflects LLM PARAMETRIC MEMORY for famous tickers (won't generalize to obscure cos/exact figures). So the 28%/59% are confounded single-run numbers; the SOLID qualitative finding: structured exact-facts don't RELIABLY reach the LLM.
- **NEXT LEVER (concrete, code):** make structured exact-fact passages DETERMINISTICALLY pinned into the top-K sent to the LLM, independent of the (rate-limited) reranker — `search_pipeline.py` has priority-pin logic (~L646-669) but the eval shows facts still get evicted. Fix the pin so exact facts always survive the context cut. Then re-measure (multi-run to beat nondeterminism).
- **LABELED EXTRACTION EVAL BUILT — extraction is ~86%, NOT the wall.** `tests/eval/extraction_accuracy.py` compares our `financials` vs SEC XBRL companyfacts (deterministic ground truth, no LLM). 9 tickers × 5 core concepts × 4yrs = 169 points: Revenues 88%, NetIncome 78%, Assets 89%, Liabilities 89%, Equity 86%, **OVERALL 86%**. (Caught + fixed 2 of my own eval ground-truth bugs via spot-checks — SEC `fy` field ≠ period; instant balance-sheet must take fiscal-year-END not a quarter. First buggy runs read 15% then 51%; true is 86%, confirmed by exact spot-checks of AAPL net income + total assets.)
- **NUMERIC DIAGNOSIS, evidence-based:** extraction good (86%), data coverage not the lever (flat ×3), yet FinanceBench numeric ~50% → the gap is **(a) structured RETRIEVAL** (the correct fact is IN `financials` but not surfaced to the LLM for the specific Q) and **(b) DERIVED-metric computation** (quick ratio/DPO/margin-trend/3yr-avg need multiple facts + a compute step) + long-tail line items beyond the 5 core concepts. NEXT measurable step: a structured-retrieval-recall check (does /v1/search return the fact that exists in financials?).
- **OLD-FILING BACKFILL ABANDONED (infra-blocked + low value).** 3 attempts (40-filing, 10-K-only, 10-K+gc) all died mid-MMM (ticker 1) parsing big 10-Ks (~108-122 tables, 6MB+ HTML). No in-log error → externally killed; probable OOM but UNCONFIRMED (dmesg inaccessible). Machine is 4GB shared with the prod server; BS4 trees for huge filings spike memory; gc + 10-K-only didn't save it. Combined with prior FLAT results (coverage backfill, deep-history backfill both moved numeric 0) → confirming old-filing coverage is BOTH infra-blocked AND low expected value. Dropped; not relaunching. To pursue later: dedicated bigger ingestion machine, or stream/teardown parser per-table.
- **NUMERIC PLATEAU (honest).** Numeric ≈50% (15/30, ONE noisy n=30 sample, fixed scorer). No data lever works (3 experiments). No proven path to lift further this session. Remaining hypotheses (table-extraction accuracy) are hard to validate — no ground-truth set, and n=30 is too noisy for small deltas. Need a real labeled extraction-eval before more numeric work is meaningful.
- **NUMERIC WAS MIS-MEASURED — true ≈50%, not 30%.** Scorer bug: `numeric_match` scaled the model's "X million" suffix but expected answers are bare-millions ("11588.00") → 11588e6 vs 11588 false-neg. Fixed (`_number_candidates`, both bare+scaled). Re-scored deep_fb/p1b/recall_fix runs all 30%→**50%** (+4/30 recovered). +6 unit tests. (Code-only, no prod change.)
- **DEEP HISTORY = NOT the numeric lever (disproven by measurement).** --years-back 6 --max-filings 16 (financials 168k→248k) left numeric FLAT (recall 7→13%). Three data experiments now agree: data volume isn't the wall.
- **Real numeric blockers (from failure inspection):** (1) scorer false-negs [FIXED]; (2) **FinanceBench targets OLD filings 2016–2019** — our corpus is 2020–2026, so MGM FY2018 / Boeing FY2018 / Nike FY2016–18 / Block FY2016 genuinely absent → need TARGETED ingestion of FinanceBench's specific docs, not "more recent years"; (3) **entity resolution** — "Block Inc (Square)" routed to H&R Block (HRB); (4) **extraction errors** — AMCOR quick ratio extracted 0.89 vs true 0.67.
- **n=30 FinanceBench is NOISY** — citation swung 27%→17% and halluc 0→20% on the SAME deterministic sample across runs (LLM nondeterminism). Numeric is stable (~30%). Use n≥50 (or full 150) for trustworthy small deltas; treat ±10pt at n=30 as noise.
- Widened source text 500→2000 (`search_pipeline.py:849`) — better citation-panel snippets + recall headroom; recall 0→7% (still weak proxy).
- Prod fast-mode query returned channels `[structured, dense, tree_nav]` — **FTS/bm25 keyword channel did NOT fire** despite the 101k-chunk backfill. Investigate whether `search_chunks_fts` is wired into the fast pipeline / fusion (candidate sub-task under P1-b or new P0).
- Latency ~13.5s single probe; **sample-15 p50 33.6s, 5/15 timed out at 60s** → latency is also an accuracy floor (timeouts score as errors). Big P4-a problem, partially blocks accuracy.
- Baseline failures cluster on **derived/ratio metrics** (DPO, quick ratio, gross-margin trend, regional revenue) and tickers possibly outside the 283-corpus (AMCOR, Boeing, Corning, MGM) → answer = "sources do not contain". Points at P1-a (broad backfill) + P2 (coverage) + structured-channel depth, not just the column bug.
- EM/FM = 0% (strict). Numeric (2% tol) = 33% is the meaningful figure.

## Blockers
- Qdrant/DB backfills must run on Fly (local Qdrant `:6333` down, DB password not local).
- Supabase DDL only via dashboard SQL editor.
- **Rerank quality BLOCKED on paid key (user action):** prod COHERE_API_KEY = exhausted Trial (429); VOYAGE_API_KEY works but free tier = 3 RPM → 429s under multi-query load. Add a payment method on Voyage (dashboard.voyageai.com) OR a production Cohere key to unlock real reranking (~+0.02–0.08 NDCG). Code already prefers Voyage and fails fast (172ms), so no latency cost meanwhile.
