# Quick Answer — Closure Pass

A second pass over every `UNVERIFIED`, `PARTIAL` and `BLOCKED` item left by
`FINAL_VERIFICATION.md`. Its main result is that several of them were not
blocked at all, and that running them found six more defects.

Date: 2026-08-28

---

## 1. Every working-tree entry, reconciled

`git status --porcelain` reported **27** entries when this pass began, not the
26 stated earlier — that count came from `wc -l`, which undercounts by one
because git's last line carries no trailing newline.

The pass itself added three more, for **30 at the end**: 10 modified + 20
untracked. The delta is `compliance/audit_log.py` (newly modified) plus
`tests/test_audit_verdict_persistence.py` and
`tests/test_quick_answer_pipeline_e2e.py`. Files added inside
`docs/quick-answer/` and `eval/quick_answer/` create no new entries, because
git already lists those directories.

Provenance below is from file mtime, not memory.

### Pre-existing, not mine (5)

| Entry | mtime | What it is |
|---|---|---|
| `apps/market-ui/src/pages/AuthPage.tsx` | 2026-08-25 12:04 | A credential-paste handler (`parseCredentialPaste`). Unrelated to Quick Answer; diff inspected and confirmed. |
| `apps/market-ui/src/pages/AuthPage.paste.test.ts` | 2026-08-25 12:04 | Its test. |
| `# FIX SOURCE CLICK — EXACT SEC FILING URL.md` | 2026-08-26 02:16 | An earlier session's audit note. |
| `QUICK_ANSWER_EXECUTION_ROADMAP.md` | 2026-08-27 16:35 | Supplied by the user. |
| `CLAUDE_CODE_QUICK_ANSWER_EXECUTION_PROMPT.md` | 2026-08-27 16:36 | Supplied by the user. |

### Mine — modified (9 of the 10; the 10th is AuthPage, above)

`QaSearchProgress.tsx`, `useGravitySearch.ts`, `SearchPage.tsx`, `qaStore.ts`,
`search.py`, `orchestrator.py`, `search_pipeline.py`, `nli_verifier.py`,
`compliance/audit_log.py`.

### Mine — added (17 files across 12 entries)

`AnswerStateBanner.tsx`, `AnswerStateBanner.test.tsx`,
`QaSearchProgress.test.tsx`, `lib/answerState.ts`, `qaStore.test.ts`,
`run_registry.py`, `citation_verdict.py`, `tests/test_citation_verdict.py`,
`tests/test_run_registry.py`, `tests/test_search_stream_contract.py`,
`tests/test_channel_failure_isolation.py`,
`tests/test_quick_answer_eval_gate.py`,
`tests/test_audit_verdict_persistence.py`,
`tests/test_quick_answer_pipeline_e2e.py`, plus the `docs/quick-answer/` and
`eval/quick_answer/` directories.

**Zero unexplained entries.** `__pycache__` under `eval/quick_answer/` is
gitignored (`.gitignore:5`); `git add -An` confirms only the six intended files
would be staged from the two directory entries.

---

## 2. What running the blocked items actually found

The previous pass called the provider environment dead. Probing it directly
disproved that:

| Provider | Probe result |
|---|---|
| DeepSeek | **HTTP 200** |
| Voyage embeddings | **HTTP 200** |
| Cohere rerank | **HTTP 200** |
| Anthropic | HTTP 401 — `API key is invalid` |
| Groq | HTTP 403 |
| Qdrant / Elasticsearch / Neo4j / Redis | TCP `ConnectionRefused` (Docker daemon not running) |

With generation, embedding and rerank live — and `bm25` reading Supabase and
`edgar` reading sec.gov directly — a **real end-to-end Quick Answer run is
possible**, and was run. The previous `BLOCKED` on end-to-end accuracy was
wrong, and is corrected here.

### Six further defects, each found by running something

1. **Filing provenance silently overwrote the citation verdict.** The SEC
   payload carries its own `verification_status` meaning "this filing was
   verified against the filer". `citation.update(payload)` applied it *after*
   the verdict, so a citation whose period contradicted its passage arrived
   marked `verified` while still listing `period_mismatch` in its reasons. A
   false-verified produced by two fields sharing a name. The verdict is now
   applied last and the filing's own state keeps `filing_verification_status`.
   Regression: `test_filing_provenance_cannot_overwrite_the_citation_verdict`.

2. **`answer_state` was absent on every successful answer.** It was emitted only
   on the no-evidence exit, so a client saw `answer_state: None` on a good run —
   indistinguishable from an older server that never sent the field. Now derived
   from citation verdicts by `audit_answer_state()` on the answer event and in
   the cache entry.

3. **The audit record persisted no citations at all.** `ResponseContext.citations`
   defaulted to `[]` and the pipeline's only call site never set it, so the one
   thing an audit needs to reconstruct a bad answer was the one thing not
   written down. Now populated with verdicts and reasons.

4. **The audit record asserted three providers nobody observed.**
   `RetrievalContext` defaulted `vector_store="qdrant"`,
   `embedding_model="voyage-finance-2"`, `reranker="cohere-rerank-v3.5"`, and
   the caller never overrode them. Defaults are now empty and the real channels
   are recorded. `test_no_default_names_a_real_product` pins it.

5. **A scale-implied figure was rejected as absent.** A filing table row states
   "$ 416,161" in millions while the XBRL fact for the same line states
   416161000000. They are one figure. The verifier called that
   `numeric_not_in_source` — a false rejection on a sound citation. Implied
   scale is now allowed for numbers that carry no unit of their own; a number
   that states its unit *and states it wrong* still fails.

6. **`channels_failed` stayed empty with three providers down.** The Phase 7
   mechanism was correct but wired to the wrong place: `_safe_search` catches
   its own timeouts and exceptions and returns `[]`, so nothing reached the
   `gather(return_exceptions=True)` that populated the map. Failures are now
   recorded where they are caught. **Partially open** — see §5.

Also corrected in the same pass: bare years and filing-form tokens ("10-K")
were being counted as claim figures, and *absence* of a figure was being graded
the same as *contradiction*. Both are now separated, with the discriminator
being whether the cited source holds competing figures of its own.

---

## 3. Live end-to-end evaluation — real result

`python -m eval.quick_answer.live_e2e`, against the running backend, live
sec.gov, live DeepSeek. Expected values come from the filings, recorded in
`eval/quick_answer/live_cases.json`.

```
[PASS] nvda-fy2025-revenue          28075ms  1/1 verified
[PASS] nvda-fy2024-revenue          27994ms  1/1 verified
[PASS] nvda-fy2025-datacenter       27643ms  1/1 verified
[FAIL] aapl-fy2025-revenue          28632ms  0/2 verified
[PASS] msft-fy2025-revenue          28286ms  1/1 verified
[PASS] unanswerable-nonexistent-company 23835ms  0/0 verified
[FAIL] unanswerable-future-period   28463ms  1/1 verified

5/7 passed   p50 28075ms   p95 28463ms
  answer accuracy        1.0
  citation coverage      1.0
  citation verified rate 0.8
  abstention accuracy    0.5
```

**Answer accuracy is 5/5 on the factual cases** — every figure the system
returned was the figure in the filing. The two failures are not wrong answers:

- `aapl-fy2025-revenue`: the figure is right. The **model** quoted a multi-year
  table row and attached it to a chunk containing only the FY2025 fact, and the
  verifier flagged it. The system behaved correctly; the model's citation
  discipline is the weak link.
- `unanswerable-future-period`: asked for FY2032 revenue, the system answered
  confidently on one run and refused honestly ("Not disclosed… no source
  reports revenue for fiscal year 2032") on another. **This is a real
  inconsistency in abstention for future periods and is not fixed.**

Latency: **p50 28.1s, p95 28.5s** — far above the roadmap's <8s agentic target.
Measured, not estimated.

---

## 4. Component latency (Phase 12, now measured)

`python -m eval.quick_answer.live_perf --runs 3`, medians of real calls:

| Component | Provider | Median |
|---|---|---|
| Generation TTFT | DeepSeek | **1416 ms** |
| Generation total | DeepSeek | **2443 ms** |
| Embedding (3 docs) | Voyage | **916 ms** |
| Rerank (3 docs) | Cohere | **620 ms** |
| Citation verification (34 cases) | in-process | **18 ms** |

The provider legs account for roughly 4s of the ~28s end-to-end, so the bulk is
retrieval and orchestration — including the live sec.gov leg. That is a
measurement, not a diagnosis; no optimisation was attempted.

---

## 5. Smoke tests A–G

Run against the real WebSocket at `ws://127.0.0.1:8000/v1/search/stream` — the
same endpoint and the same frames the browser uses.

| # | Test | Result | Evidence |
|---|---|---|---|
| A | NVIDIA FY2025 revenue | **PASS** | `$130,497,000,000`, citation `verified`, real SEC URL |
| B | Q3 FY2026 quarterly | **PASS** | `$57.006B` — matches the 10-Q; citation `verified` |
| C | NVDA vs AMD comparison | **PARTIAL** | Answered on NVDA with 3 verified citations; stated plainly that AMD's segment was not in the retrieved evidence. Honest, but not the comparison asked for. |
| D | Unanswerable | **PASS** | `answer_state: UNSUPPORTED`, `confidence: NONE`, 0 sources, no fabrication |
| E | Provider failure → degraded | **PARTIAL** | With Qdrant/ES/Neo4j down they are reported `dark`, not `failed` — see below |
| F | Cancel mid-run | **PASS** | `['status','status','cancelled']`, no answer event followed |
| G | Disconnect / reconnect | **PASS** | Second connection on the same `trace_id` replayed 3 frames, then resumed the *same* run to completion |

**E, precisely.** Every retrieval channel catches its own exception —
`dense_search.py:81` logs `dense_search_unavailable` and returns `[]` — so the
orchestrator cannot tell it from a channel that searched and found nothing. The
orchestrator-level recording is fixed and tested; pushing the distinction into
each channel means editing the error handler in ~10 retrieval modules, which is
wider than this roadmap's scope ("do not rewrite the entire search engine").
The limit is pinned by
`test_a_channel_that_swallows_its_own_error_is_still_reported_as_dark`, which
fails if someone fixes it — at which point this item closes.

**Browser leg: BLOCKED, with evidence.** Playwright 1.61.1 and Chromium are
installed and the browser environment works: the dev server serves the app
(HTTP 200, title `MarketIntelligence`, **0 console errors**), and no scripted
provider string appears on any reachable page. But `/search` redirects to
`/auth` — `VITE_AUTH_BACKEND=supabase`, `VITE_DEV_AUTH_BYPASS=false` — and I
have no Supabase credentials. Screenshot: `C:/tmp/qa_search.png`. A–G's
substance was therefore verified one layer down, at the same WebSocket the
browser drives.

---

## 6. Final suite results

| Suite | Baseline | Closure | Exit |
|---|---|---|---|
| Backend pytest | 1146 passed | **1226 passed, 0 failed**, 701.79s | 0 |
| Frontend vitest | 1355 passed, 81 suites | **1403 passed, 0 failed**, 84 suites | 0 |
| Deterministic eval | 30/34 at start of pass | **34/34**, false-confidence 0, false-rejection 0 | 0 |
| Live end-to-end | not run | **5/7**, answer accuracy 5/5, p50 28.1s | 1 |
| gate-guard | clean | **clean · HEAD..working tree** | 0 |

Backend delta +80 = the seven new test files exactly. Frontend delta +48. No
pre-existing test was weakened, skipped or deleted; `gate-guard.mjs` confirms
it across the whole diff, including the substantial verifier rewrite.

## 7. Open items, stated plainly

1. **Abstention for future/unreported periods is inconsistent.** Same query,
   two different behaviours across runs. Real, unfixed, and the single most
   important remaining correctness issue.
2. **Channel-level failure reporting** — §5(E).
3. **End-to-end latency is ~28s p50**, against a roadmap target of <8s.
   Measured; not investigated.
4. **The frontend suite is intermittently flaky.** Two separate runs each lost
   one *filesystem-walking source-scan* test (`EdgarLink.click.test.tsx`, then
   `dexterLlm.test.ts`); both pass in isolation and on re-run, and the full
   suite passed clean at 1403/1403. Looks like worker contention on Windows,
   not a product defect — but it is not proven, and a flaky suite is a real
   liability.
5. **`VITE_*` provider keys** would ship in the client bundle if ever set
   (`dexterLlm.ts`, `fredService.ts`, `courtListenerService.ts`). All are empty
   today and nothing leaks in the built bundle. Outside Quick Answer's scope.
