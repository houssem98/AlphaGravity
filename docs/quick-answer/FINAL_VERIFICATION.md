# Quick Answer — Final Verification

Every number below came from a command run in this repository. Where a gate
could not be run, it says `BLOCKED` and why, rather than being omitted.

Date: 2026-08-27
Branch: `feat/web-research-sec-integration`
Baseline commit: `3265969`

## 1. Commands and exact results

| # | Command | Dir | Exit | Result |
|---|---|---|---|---|
| 1 | `python -m pytest tests/ -q --ignore=tests/live --ignore=tests/eval` | `services/gravity-api` | 0 | **baseline: 1146 passed**, 0 failed, 459.76s |
| 2 | `npx vitest run src/ --reporter=json` | `apps/market-ui` | 0 | **baseline: 1355 passed**, 0 failed, 81 suites |
| 3 | `python -m pytest tests/ -q --ignore=tests/live --ignore=tests/eval` (final) | `services/gravity-api` | 0 | **1192 passed, 0 failed**, 536.29s |
| 4 | `npx vitest run src/ --reporter=json` (final) | `apps/market-ui` | 0 | **1400 passed, 0 failed, 84 suites, `success: true`** |
| 5 | `npx tsc --noEmit -p tsconfig.app.json` | `apps/market-ui` | 0 | no errors |
| 6 | `npx tsc -b && npx vite build` | `apps/market-ui` | 0 | `TypeScript: No errors found`; `dist/index.html` written |
| 7 | `npx eslint src/components/qa/ src/lib/answerState.ts src/pages/SearchPage.tsx` | `apps/market-ui` | 1 | 5 issues in `SearchPage.tsx` (**identical to baseline**), 2 in `FirecrawlScrapePanel.tsx` (untouched). My new files: clean |
| 8 | `python -m eval.quick_answer.run_eval --json results/quick_answer_eval.json` | `services/gravity-api` | 0 | **30/30 (100%)** |

Frontend test delta: 1355 → 1400 = **+45**, and a per-file diff confirmed the
only files whose counts changed were the new ones. No existing test was
weakened, skipped or deleted — `gate-guard.mjs` reports `clean · HEAD..working
tree` over the whole diff.

### 1a. Final backend suite

```
1192 passed, 26 warnings in 536.29s (0:08:56)
EXIT=0
```

Backend delta: 1146 → 1192 = **+46**, which is exactly the five new test files
(14 + 13 + 8 + 5 + 6). No pre-existing test failed, was skipped, or disappeared.

The final run used the **same command as the baseline**, deliberately. An
earlier attempt added `--timeout=180 --timeout-method=thread` to catch a hang;
that spawns a timer thread per test and ran roughly four times slower, which
would have made the before/after comparison meaningless. The timeout run was
discarded once the hang was fixed at its source.

## 2. Quick Answer evaluation results

`eval/quick_answer/golden_v1.json`, dataset v1.0.0, 30 cases, 12 fixture passages.

| Metric | Value |
|---|---|
| Cases passed | 30 / 30 (100%) |
| Adversarial detection rate | 1.0 |
| **False confidence count** | **0** |
| False rejection count | 0 |
| Abstention accuracy | 1.0 |

Per category: `exact_fact` 10/10, `units` 2/2, `units_adversarial` 2/2,
`temporal_adversarial` 3/3, `entity_adversarial` 2/2, `evidence_adversarial` 1/1,
`arithmetic_adversarial` 1/1, `citation_adversarial` 3/3, `abstention` 3/3,
`comparison` 3/3.

Machine-readable output: `services/gravity-api/results/quick_answer_eval.json`
(regenerate with the command in row 8 — `results/` is gitignored by repository
convention, so the artifact is not committed; the gate recomputes it in-process
and does not read the file).

Gated by `tests/test_quick_answer_eval_gate.py`, which fails the build on any
regression, on any false-confidence case, and on the golden set shrinking. The
last check matters: deleting cases is the cheapest way to make a golden suite
green, so the gate asserts the category coverage and the case count as well as
the score.

**What this measures:** the deterministic verification layer. **What it does not
measure:** end-to-end answer accuracy against a live corpus — that is a separate,
key-dependent benchmark and is `BLOCKED` (§5).

## 3. The success standard, item by item

The roadmap's closing question is whether a wrong source, wrong quarter, wrong
unit, fabricated citation, provider failure, disconnect and cancellation are
each detected rather than papered over.

| Adversarial input | Detected? | Proof |
|---|---|---|
| Fabricated citation index | Yes — `unsupported` | `test_citation_verdict.py::test_fabricated_citation_index_is_not_verified`; eval `trap-fabricated-index` |
| Citation to a foreign chunk | Yes — `unsupported` | `test_citation_to_foreign_chunk_id_is_unsupported` |
| Wrong company | Yes — `conflicting` | `test_wrong_company_source_conflicts`; eval `trap-wrong-company` |
| Wrong fiscal year | Yes — `conflicting` | `test_wrong_period_conflicts`; eval `trap-wrong-fiscal-year` |
| Wrong quarter (prose form) | Yes — `conflicting` | eval `trap-wrong-quarter` — **this one was initially missed and the eval caught it** |
| Millions stated as billions | Yes — `conflicting` | `test_million_billion_scale_error_conflicts` |
| Percent stated as percentage points | Yes — `conflicting` | `test_percent_stated_as_percentage_points_conflicts` |
| Number absent from the source | Yes — `conflicting` | `test_arithmetic_result_absent_from_source_conflicts` |
| Provider/channel failure | Yes — reported as failed, not empty | `test_channel_failure_isolation.py` (5 tests) |
| Disconnect + reconnect | Yes — one search, replayed | `test_run_registry.py`, `test_search_stream_contract.py::test_reconnect_with_same_trace_id_runs_the_search_once` |
| Cancellation | Yes — `cancelled`, no answer, no persistence | `test_cancel_frame_terminates_the_run_without_an_answer`, `qaStore.test.ts::persists nothing when the search is cancelled` |
| Another user attaching to a run | Yes — refused | `test_another_user_cannot_attach_to_a_run` |

A correct citation is still accepted (`false_rejection_count: 0`), so none of the
above is achieved by rejecting everything.

## 4. Security review

Checked, no finding:

- **WebSocket auth** — enforced at the route before any search
  (`search.py`); non-development environments close with 1008 when neither a JWT
  nor an API key validates.
- **Error events carry no provider detail** — asserted by
  `test_error_in_pipeline_becomes_an_error_event_not_a_crash`.
- **Channel failures record the exception type only**, never the message, which
  can carry a DSN or key — `test_the_failure_record_carries_no_message_only_the_type`.
- **Source URLs** — `isRenderableWebUrl` admits only `http`/`https`;
  `javascript:`, `data:`, `file:` and malformed input are refused, with existing
  tests.
- **Cancellation cannot corrupt state** — a cancelled run has its own terminal
  state, is never `complete`, and cannot reach persistence.

Found and fixed **during this work, in code I had just written**:

- **The run registry was not scoped to a user.** Any caller quoting a known
  trace id could attach to another user's in-flight search and be streamed its
  sources and answer, or cancel it. Now every lookup takes the authenticated
  `user_id` and refuses a run belonging to someone else, reporting "not found"
  rather than "not yours". Three tests cover it.
- **Runs could live forever.** The TTL sweep only ever saw runs that had
  finished, so a wedged provider would pin a task and its buffer for the life of
  the process, and `clear()` dropped references without cancelling tasks. Both
  fixed; `MAX_RUN_LIFETIME_S = 600`.

Pre-existing finding, **reported and not fixed** (outside Quick Answer, and the
roadmap forbids unrelated changes):

- `VITE_GEMINI_API_KEY`, `VITE_FRED_API_KEY`, `VITE_BEA_API_KEY`,
  `VITE_BLS_API_KEY` and `VITE_COURTLISTENER_TOKEN` are read via
  `import.meta.env` in `dexterLlm.ts`, `fredService.ts` and
  `courtListenerService.ts`. Vite inlines `VITE_*` at build time, so any value
  set for these ships in the client bundle. **In this build nothing leaks** —
  all are empty in `.env`, and a scan of `dist/assets/*.js` found no key
  literal. The pattern is unsafe if a key is ever set. Not on the Quick Answer
  path, which authenticates with a Supabase JWT (an anon key is public by
  design).

## 5. Blocked and unverified

> **Superseded by `CLOSURE_PASS.md` (2026-08-28).** A second pass probed the
> providers directly instead of trusting the recorded state, and three of the
> items below were not blocked. DeepSeek, Voyage and Cohere all answered HTTP
> 200; `bm25` reads Supabase and `edgar` reads sec.gov directly, so a real
> end-to-end run was possible and was performed. Read `CLOSURE_PASS.md` for
> the corrected status; the text below is kept as the record of what was
> believed at the time.

**`BLOCKED` — end-to-end financial answer accuracy.** *(Corrected: this was
run. 5/5 factual answers correct, p50 28.1s — see `CLOSURE_PASS.md` §3.)*
Requires live provider keys and a live corpus. The repository's keys are largely
dead. Running the existing FinanceBench grader would produce failures caused by
credentials, not by this work. No accuracy figure is claimed.

**`BLOCKED` — performance (roadmap Phase 11).** *(Corrected: component
latency measured — see `CLOSURE_PASS.md` §4.)* TTFT, retrieval latency, rerank
latency and cost per query all require live providers. Measuring them against a
substituted pipeline would be a fabricated benchmark. The plumbing exists — the
`retrieval` event carries measured `retrieval_ms` and `rerank_ms`, and the
metadata event carries five per-stage timings — so the numbers are collectable
the moment credentials are available. None are reported here.

**`UNVERIFIED` — manual browser smoke tests A–G (prompt §19).** *(Corrected:
A–G run at the WebSocket layer — 5 PASS, 2 PARTIAL. Browser leg blocked on
Supabase credentials, with a screenshot. See `CLOSURE_PASS.md` §5.)* No browser was
driven against a running stack in this session. Their machine-checkable content
is covered by the contract and store tests above, but the visual result was not
observed.

**`PARTIAL` — persistence of verification verdicts (roadmap Phase 10).**
*(Closed: verdicts, reasons, channels and answer_state now persist to the audit
record — `test_audit_verdict_persistence.py`, 17 tests.)*
Verdicts are computed, travel to the client, and a cancelled run cannot persist
as an answer (tested). Extending `compliance/audit_log.py` to store per-citation
verdicts server-side is **not done** and is listed as remaining work rather than
claimed.

**Two full backend runs were killed after hanging.** The cause was leaked
asyncio tasks from parked runs in the new registry — `clear()` dropped
references without cancelling them. That is fixed (§4) and the final run in §1a
is the verification.

## 6. Files changed

Modified (8):

```
apps/market-ui/src/components/qa/QaSearchProgress.tsx
apps/market-ui/src/hooks/useGravitySearch.ts
apps/market-ui/src/pages/SearchPage.tsx
apps/market-ui/src/stores/qaStore.ts
services/gravity-api/app/api/routes/search.py
services/gravity-api/app/core/retrieval/orchestrator.py
services/gravity-api/app/core/search_pipeline.py
services/gravity-api/app/core/verification/nli_verifier.py
```

Added (13):

```
apps/market-ui/src/components/qa/AnswerStateBanner.tsx
apps/market-ui/src/components/qa/AnswerStateBanner.test.tsx
apps/market-ui/src/components/qa/QaSearchProgress.test.tsx
apps/market-ui/src/lib/answerState.ts
apps/market-ui/src/stores/qaStore.test.ts
services/gravity-api/app/core/streaming/run_registry.py
services/gravity-api/app/core/verification/citation_verdict.py
services/gravity-api/eval/quick_answer/golden_v1.json
services/gravity-api/eval/quick_answer/run_eval.py
services/gravity-api/tests/test_channel_failure_isolation.py
services/gravity-api/tests/test_citation_verdict.py
services/gravity-api/tests/test_quick_answer_eval_gate.py
services/gravity-api/tests/test_run_registry.py
services/gravity-api/tests/test_search_stream_contract.py
```

`apps/market-ui/src/pages/AuthPage.tsx` and `AuthPage.paste.test.ts` were
already modified/untracked before this work began and were not touched.

## 7. Honest summary

Ten of the thirteen roadmap phases have passing acceptance tests. Phase 2 was
already satisfied by prior work and was left alone. Phase 10 is partial and says
so. Phase 11 is blocked on credentials and claims no numbers.

The single most important result is that a citation can no longer be marked
verified because a model said so: the verdict is computed against the passage
the citation points at, and `is_verified` is now `verification_status ==
'verified'` and nothing else. The second is that the progress display cannot
name a retrieval provider unless an event named it first.

This is not "production-ready" and is not claimed to be. It is a set of specific
defects fixed, each with a test that fails if the defect returns.
