# Quick Answer — Execution Log

Status of each roadmap phase, with the evidence that justifies the status.
`DONE` means the phase's acceptance tests exist and pass. Nothing here is
marked done because code compiles.

| Phase | Status | Evidence | Tests | Notes |
|---|---|---|---|---|
| 0 Baseline | DONE | `BASELINE.md` | backend 1146 pass, frontend 1355 pass | 9 defects recorded, each proven by a probe rather than inferred. Final: **backend 1226, frontend 1403, both 0 failed** |
| 1 Events | DONE | `SearchEvent` carries `event_id`/`ts`/`seq`; new `retrieval` event | `test_search_stream_contract.py` (8), `QaSearchProgress.test.tsx` (20) | Scripted provider log deleted; `validating` stage removed; two real stages recovered |
| 2 Provenance | DONE (pre-existing) | `citation_provenance.py`, `sourceUrl.ts` | `test_citation_provenance.py` (18), `test_search_pipeline_sec_provenance_e2e.py` (13), `sourceUrl.test.ts` | Already satisfied by prior work — see deviation note below |
| 3 Verification | DONE | `app/core/verification/citation_verdict.py` | `test_citation_verdict.py` (14) | All 8 required adversarial cases caught; `is_verified` now derived, not model-reported |
| 4 Abstention | DONE | `answer_state` plumbed to UI; `AnswerStateBanner` | `qaStore.test.ts` (10), `AnswerStateBanner.test.tsx` (15) | Backend already decided; the UI was discarding the verdict |
| 5 Cancellation | DONE | `run_registry.py`, WS control frame | `test_run_registry.py` (13), contract tests | Cancel now reaches the server and cancels the task |
| 6 Reconnect | DONE | trace-id-addressed runs, replay buffer | `test_run_registry.py`, `test_search_stream_contract.py` | A reconnect runs the search once, proven by counting invocations |
| 7 Resilience | PARTIAL | `ChannelResults.failed` + `_safe_search` recording | `test_channel_failure_isolation.py` (10) | Orchestrator-level failures recorded and tested. Channels that swallow their own exception (`dense_search.py:81`) still read as `dark` — limit pinned by a test |
| 8 Evaluation | DONE | `eval/quick_answer/` v1.1.0 + `live_e2e.py` | `test_quick_answer_eval_gate.py` (6) | Deterministic 34/34, 0 false confidence. **Live end-to-end 5/7, answer accuracy 5/5.** Between them the two suites found 8 real bugs |
| 9 E2E | DONE | `test_search_stream_contract.py`, `test_quick_answer_pipeline_e2e.py` | 8 + 12 | Real route, and the real `SearchPipeline.search()` with fixtures only at retrieval |
| 10 Frontend | DONE | `QaSearchProgress.tsx` rewritten; green badge gated on the verdict | `QaSearchProgress.test.tsx` (20) + badge tests | Pure projection of server events |
| 11 Persistence | DONE | audit record carries verdicts, reasons, channels, `answer_state` | `test_audit_verdict_persistence.py` (17), `qaStore.test.ts` (13) | Closed in the closure pass. Also fixed: the record used to assert qdrant/voyage/cohere by default and persisted no citations at all |
| 12 Performance | PARTIAL | `eval/quick_answer/live_perf.py` | measured, not asserted | TTFT 1416ms, generation 2443ms, embed 916ms, rerank 620ms, verification 18ms/34 cases. End-to-end p50 **28.1s** vs a <8s target — measured, not investigated |
| 13 Security | DONE (with a finding) | owner-scoped registry | `test_run_registry.py` ownership tests (3) | Two cross-tenant holes I introduced were found and fixed here; one pre-existing finding reported, out of scope to fix |

## Deviations from the roadmap, and why

**Phase 2 was already done.** The roadmap assumes provenance is missing. It is
not: `citation_provenance.py` resolves and carries accession, CIK, form, filing
date and exact filing URL, and `sourceUrl.ts` refuses to reconstruct a URL for a
source that has none. 31 existing tests cover it, including the roadmap's exact
"a source with no URL must not look externally verifiable" case
(`sourceUrl.test.ts`: *returns empty for a local chunk rather than reconstructing
a guess*). Duplicating this would have added a second source model, which the
roadmap explicitly forbids. No change made.

**The backend was already truthful; the frontend was not.** The roadmap's
Phase 1 assumes the server does not report what it did. It does — the metadata
event carries `retrieval_channels`, `channels_dark`, `model_used` and five
per-stage timings. The lie was entirely in `QaSearchProgress.tsx`, which
narrated Qdrant, Elasticsearch, Neo4j, SPLADE and Cohere on a timer regardless.
The fix was therefore to delete the scripted narration and project the events
that already existed, plus add one `retrieval` event so the channel truth
arrives during the run rather than only at the end.

**Phase 11 (persistence) is partial, deliberately.** The roadmap asks for
verification verdicts in the audit record. The verdicts now exist on every
citation and reach the client, and a cancelled run cannot persist as a completed
answer. Extending `compliance/audit_log.py` to store per-citation verdicts is
real remaining work, not something done and unverified — it is listed as
outstanding rather than claimed.

**Phase 12 (performance) is blocked, not skipped.** Measuring TTFT, retrieval
latency and cost requires live provider keys and a live corpus. The repository's
keys are largely dead (Anthropic 401, Groq 401, Gemini daily-quota). Reporting
latency numbers from a run with a substituted pipeline would be a fabricated
benchmark. No numbers are claimed.

## Bugs the work found, in the order they were found

1. **A fabricated citation was reported as verified.** Probing the real
   `_normalize_citations` with a model citing index 99 against five passages
   returned `is_verified: True` with an empty `chunk_id` and empty title.
2. **The progress UI narrated providers that never ran** — a hard-coded log
   array on a 650 ms timer, on a deployment where two of the named services are
   not configured.
3. **A stage the backend never emits** (`validating`) held a 93% slot.
4. **Two stages the backend does emit were dropped**, and the unknown-status
   fallback reset the whole display to "no stage" mid-run.
5. **Timestamps were rendered from `new Date()` at render time**, not from the
   event.
6. **`answer_state` never reached the UI** — abstention was decided and discarded.
7. **`confidence` was typed `number` but sent as a word**, so the badge rendered
   `NaN` (it was hidden only because `"MEDIUM" > 0` is false).
8. **Cancel was client-side only**, and the server could not have heard one: it
   never read the socket while a search was running.
9. **Reconnect re-ran the whole search**, because the client's `trace_id` was
   sent, accepted by Pydantic, and silently dropped.
10. **A failed retrieval channel was stored as an empty list**, making an outage
    indistinguishable from an honest empty result.
11. **`_NUM_RE` parsed "2024 to" as 2024 × 10¹²** — the single-letter scale
    suffix ate the first letter of the next word. Found by the new eval; affects
    `numeric_precheck` repo-wide, not just Quick Answer.
12. **The period check silently no-opped on prose quarters** — "third quarter of
    fiscal 2026" matched none of the temporal patterns, so a wrong-quarter claim
    was graded on its number alone. Found by the new eval.
13. **The run registry I added was not scoped to a user** — any caller quoting a
    known trace id could attach to another user's in-flight search and be
    streamed its sources and answer, or cancel it. Found in the Phase 12 review
    of my own changes, before it shipped.
14. **The registry leaked asyncio tasks.** `clear()` dropped references without
    cancelling, and the TTL sweep only ever saw runs that had *finished*, so a
    wedged run lived forever. This hung two full backend runs before it was
    root-caused — the visible symptom was a pytest process sitting at ~8% CPU.
    Fixed with a cancelling `clear()` and `MAX_RUN_LIFETIME_S = 600`.
15. **A history turn could still show a green "Verified" badge.** Turns
    persisted before verdicts existed carry `is_verified: true` with no
    `verification_status` — the model's own word, which is exactly what this
    work removed. Replaying one out of history reproduced the badge. The badge
    now requires the verdict, so a legacy turn shows nothing.
