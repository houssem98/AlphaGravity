# Claude Code Execution Prompt — AlphaGravity Quick Answer

You are the implementation agent for the AlphaGravity repository.

Your task is to **actually execute** the Quick Answer hardening roadmap in:

`QUICK_ANSWER_EXECUTION_ROADMAP.md`

Do not merely review it, summarize it, propose code, or produce a plan.

You must inspect the repository, modify the code, run the tests, fix failures, and leave the repository in a working state.

---

## 1. Operating mode

Work like a senior staff engineer responsible for production correctness.

Rules:

1. **Inspect before editing.**
2. **Never assume documentation is accurate.**
3. **Never claim a feature works without executing it or testing the relevant contract.**
4. **Never create fake tests that only test mocks while claiming E2E correctness.**
5. **Never weaken or delete a failing test to make the suite green.**
6. **Do not invent missing data, URLs, provider calls, verification results, or benchmark scores.**
7. **Do not expose chain-of-thought.**
8. **Do not rewrite unrelated systems.**
9. **Prefer small, reversible changes.**
10. **After every major phase, run the relevant tests before continuing.**
11. **If the repository differs from the roadmap, adapt to the real codebase and document the deviation.**
12. **If a requirement is impossible because a dependency/API is unavailable, implement the strongest honest fallback and mark the gate BLOCKED rather than pretending it passes.**

---

## 2. First action: establish reality

Before changing code:

### A. Read

Read:

- `CLAUDE.md`
- `QUICK_ANSWER_EXECUTION_ROADMAP.md`
- existing architecture/benchmark documents relevant to search and QA
- Quick Answer frontend files
- Quick Answer backend route/pipeline files
- shared types
- existing search/citation tests

Search the repository rather than trusting filenames.

### B. Establish baseline

Run the actual repository commands for:

- tests;
- lint;
- typecheck;
- build;
- health;
- existing E2E/smoke tests.

Do not stop at the first failure.

Classify failures:

```text
PRODUCT_BUG
TEST_BUG
ENVIRONMENT
MISSING_DEPENDENCY
MISSING_SECRET
INFRA_FAILURE
UNKNOWN
```

Create:

`docs/quick-answer/BASELINE.md`

Record exact commands and results.

---

# 3. Create a working execution ledger

Create:

`docs/quick-answer/EXECUTION_LOG.md`

Use a table:

| Phase | Status | Evidence | Tests | Notes |
|---|---|---|---|---|
| 0 Baseline | | | | |
| 1 Events | | | | |
| 2 Provenance | | | | |
| 3 Verification | | | | |
| 4 Abstention | | | | |
| 5 Cancellation | | | | |
| 6 Resilience | | | | |
| 7 Evaluation | | | | |
| 8 E2E | | | | |
| 9 Frontend | | | | |
| 10 Persistence | | | | |
| 11 Performance | | | | |
| 12 Security | | | | |
| 13 Final | | | | |

Update it as work progresses.

Do not mark a phase complete until its acceptance tests pass.

---

# 4. Phase 1 — Truthful events

Find the actual Quick Answer progress implementation.

If it contains hard-coded stage timing, scripted progress, fake provider labels, or optimistic verification messages:

**remove the fake behavior.**

Implement a canonical backend event contract compatible with the existing WebSocket architecture.

The frontend must render actual events.

Do not invent events solely to preserve the old animation.

For every displayed provider/model/database name, derive it from actual runtime metadata.

### Required tests

Add tests proving:

- each event has trace/request identity;
- invalid event schemas are rejected;
- event order is deterministic/reconstructable;
- provider labels match actual execution;
- fake progress cannot appear without a corresponding backend event.

Run backend and frontend tests.

---

# 5. Phase 2 — Provenance

Trace a source object from the first retrieval result all the way to the browser.

Identify where URL/source fields disappear.

Fix the actual boundary where they are dropped.

Do not add a second parallel source model if the repository already has a canonical one.

Preserve, where available:

- source ID;
- document ID;
- chunk ID;
- title;
- publisher;
- URL/URI;
- company;
- ticker;
- filing type;
- dates;
- fiscal period;
- section;
- page/span;
- retrieval channels;
- scores;
- timestamps.

Do not fabricate missing values.

### Required tests

Construct a source with a known URL and unique IDs.

Prove those values survive:

```text
retrieval
→ pipeline
→ serialization
→ WebSocket
→ frontend-compatible payload
→ citation
```

Also test a source with no URL and prove the UI does not falsely present it as externally verifiable.

---

# 6. Phase 3 — Citation and claim verification

Inspect the existing citation validation code first.

Reuse it where possible.

Do not replace a working verifier with an LLM-only "judge".

Implement deterministic checks for:

- citation index validity;
- source ownership;
- claim/source binding;
- entity;
- period;
- unit/currency;
- numerical consistency where applicable.

If the architecture supports claim extraction, introduce explicit claim objects.

If it does not, implement the smallest safe abstraction that allows material factual claims to be checked.

Verification statuses must distinguish:

```text
verified
partially_supported
unsupported
conflicting
not_verifiable
```

### Required adversarial tests

Create tests where:

1. citation points to wrong source;
2. citation index is fabricated;
3. source is for wrong company;
4. source is for wrong quarter;
5. source uses millions but answer says billions;
6. source says 10% and answer says 10 percentage points;
7. arithmetic answer is wrong;
8. source contradicts the answer.

The verifier must catch these cases.

---

# 7. Phase 4 — Abstention

Implement an explicit answer policy.

If evidence is insufficient or conflicting, the system must not confidently fabricate an answer.

Test:

- no sources;
- irrelevant sources;
- conflicting sources;
- wrong fiscal period;
- unresolved entity;
- unsupported numeric claim.

The UI must communicate the state honestly.

Do not use a decorative confidence score.

---

# 8. Phase 5 — Cancellation

Trace cancellation from browser to server to actual async tasks.

Implement real cancellation propagation.

Test cancellation:

- before retrieval;
- during retrieval;
- during generation;
- during citation verification.

After cancellation:

- no completed answer event;
- no completed-answer persistence;
- cleanup occurs;
- UI receives a cancelled terminal state.

---

# 9. Phase 6 — Idempotent reconnect

Use the existing trace/request identifiers.

Simulate:

```text
request
→ server begins
→ connection drops
→ client reconnects
```

The server must not execute the expensive search twice.

Ensure:

- one logical request;
- one terminal result;
- no duplicate persistence;
- no duplicate cost accounting.

If true resume is not practical, implement a server-side attach-to-existing-request mechanism.

Do not fake this only in the frontend.

---

# 10. Phase 7 — Failure isolation

Inject failures into individual retrieval channels.

Verify:

```text
channel A fails
channel B/C/D continue
→ degraded result
→ truthful event
→ no false-success metadata
```

Do the same for model provider failure where the existing router supports fallback.

Record the actual fallback model/provider.

Never tell the UI that Cohere/Claude/Gemini/etc. ran if it did not.

---

# 11. Phase 8 — Financial QA evaluation

Build a versioned Quick Answer evaluation dataset.

Use real, reproducible source fixtures from the repository where possible.

Include:

- annual revenue;
- quarterly revenue;
- fiscal-year questions;
- fiscal-quarter questions;
- company comparisons;
- YoY/QoQ calculations;
- unit conversions;
- wrong-company distractors;
- wrong-period distractors;
- conflicting evidence;
- unsupported questions.

Do not hard-code model output as the expected answer.

For numerical questions, expected values must come from source fixtures or structured expected records.

Measure:

- answer accuracy;
- atomic claim accuracy;
- citation validity;
- citation support;
- unsupported claim rate;
- entity accuracy;
- period accuracy;
- unit accuracy;
- arithmetic accuracy;
- abstention correctness;
- latency.

Store machine-readable evaluation output.

---

# 12. Phase 9 — Real E2E contract test

Build one E2E test that crosses the real Quick Answer boundary.

It must cover:

```text
browser-compatible request
→ WebSocket
→ real backend route
→ real pipeline
→ source payload
→ answer
→ citation
→ verification
→ terminal event
```

Do not mock the entire search pipeline.

Mocks are acceptable only at external-provider boundaries when necessary.

The test must fail if:

- source URL is dropped;
- citation is invalid;
- verification is missing;
- fake event appears;
- duplicate completion occurs;
- cancellation produces completed output.

---

# 13. Phase 10 — Frontend

Now fix the UI.

The UI must be a pure projection of backend truth.

Replace any timer-driven progress with event-driven progress.

Implement:

- actual stage status;
- actual elapsed time;
- source counts;
- degraded state;
- verification state;
- cancellation;
- reconnect;
- insufficient evidence;
- conflicting evidence;
- system error.

Do not display internal chain-of-thought.

Operational summaries are acceptable, for example:

> Retrieved 18 candidate passages

Do not display hidden reasoning.

---

# 14. Phase 11 — Persistence

Inspect existing persistence first.

Extend it rather than creating duplicate storage.

Persist enough to reproduce/debug:

- request/trace ID;
- query;
- source IDs;
- source metadata;
- citations;
- verification verdicts;
- actual model/provider;
- timing;
- failure/degradation events;
- final status.

Test persistence for:

- successful answer;
- rejected/abstained answer;
- conflicting evidence;
- cancellation;
- provider failure;
- reconnect.

---

# 15. Phase 12 — Performance

Only after correctness passes.

Measure:

- TTFT;
- retrieval latency;
- reranking latency;
- verification latency;
- total latency;
- tokens/sec if available;
- cost if available.

Do not claim improvements without before/after measurements.

Do not optimize by removing verification or provenance.

---

# 16. Phase 13 — Security review

Check:

- client bundle for secrets;
- WebSocket authentication;
- source URL handling;
- XSS-safe rendering;
- user/tenant isolation;
- logs for secrets;
- cancellation abuse;
- duplicate request behavior.

Fix real findings.

Do not create security theater.

---

# 17. Required quality gate after each phase

For every phase:

1. run focused tests;
2. run affected package tests;
3. inspect failures;
4. fix root cause;
5. rerun;
6. update `EXECUTION_LOG.md`.

Do not accumulate dozens of unverified changes.

---

# 18. Final verification

After all phases:

Run the complete repository quality suite.

At minimum:

```text
lint
typecheck
backend tests
frontend tests
build
health checks
Quick Answer E2E
Quick Answer financial evaluation
failure injection
cancellation
reconnect/idempotency
```

If the project uses Docker/infrastructure, run the real stack for the final E2E pass.

Generate:

`docs/quick-answer/FINAL_VERIFICATION.md`

Include:

- exact commands;
- exact exit codes;
- test counts;
- benchmark metrics;
- latency metrics;
- failures;
- known limitations;
- environment blockers.

---

# 19. Final manual smoke test

If a browser-capable environment is available, manually test:

### Test A

`What was NVIDIA revenue in FY2025?`

Verify:

- correct value;
- correct fiscal period;
- authoritative source;
- citation opens the correct source;
- verification is truthful.

### Test B

`What was NVIDIA revenue in Q3 FY2026?`

Verify fiscal quarter handling.

### Test C

`Compare NVIDIA and AMD data center revenue growth.`

Verify:

- both companies;
- comparable periods;
- units;
- calculation;
- citations.

### Test D

Ask a question for which the indexed evidence is insufficient.

Expected:

- honest insufficiency/confidence state;
- no fabricated answer.

### Test E

Force a retrieval-provider failure.

Expected:

- degraded state;
- truthful event;
- no fake provider success.

### Test F

Start a query and cancel it.

Expected:

- actual cancellation;
- no completed persistence.

### Test G

Disconnect/reconnect during execution.

Expected:

- no duplicate expensive execution;
- one terminal result.

---

# 20. Definition of done

You may only report completion if all required roadmap gates pass.

Your final response must include:

1. what you changed;
2. exact files changed;
3. exact tests run;
4. exact test results;
5. exact E2E results;
6. benchmark results;
7. any remaining blockers;
8. any requirements that could not be verified.

If something is not verified, explicitly say:

`UNVERIFIED`

or

`BLOCKED`

Never say:

- "done" when blocked;
- "production-ready" without evidence;
- "all tests pass" without running them;
- "verified" when only an LLM judged the claim;
- "real-time" when it is simulated.

---

# 21. Important execution behavior

Do not ask the user for permission between normal implementation steps.

Continue autonomously through the roadmap.

Only stop for user input if there is a genuinely external blocker that cannot be resolved from the repository/environment, such as a missing mandatory credential or unavailable infrastructure.

When blocked:

1. finish all independent work;
2. document the blocker;
3. add a deterministic test that demonstrates the blocker where possible;
4. do not fake the missing integration;
5. report exactly what remains.

The objective is a **working implementation backed by evidence**, not a convincing-looking progress report.

START NOW.
