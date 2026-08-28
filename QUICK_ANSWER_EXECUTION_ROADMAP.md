# AlphaGravity Quick Answer — Ruthless Execution Roadmap

## Purpose

This roadmap is for **Quick Answer only**.

The objective is not to make the UI look better. The objective is to make Quick Answer a **truthful, evidence-first, testable financial QA product** where:

1. every visible pipeline step corresponds to a real backend event;
2. every material factual claim can be traced to source evidence;
3. source provenance is preserved end-to-end;
4. financial periods/entities/units are checked;
5. unsupported answers abstain instead of guessing;
6. cancellation actually stops work;
7. reconnects do not duplicate expensive jobs;
8. failures degrade gracefully;
9. the UI never claims work happened when it did not;
10. the complete path is covered by automated tests and a repeatable E2E smoke suite.

**Definition of done:** all gates in this document pass. A feature is not considered finished because code compiles or because a demo works once.

---

# 0. Ruthless baseline

The repository already has a substantial Quick Answer architecture:

- `apps/market-ui` contains the AlphaSense-style UI.
- `services/gravity-api` contains the Python search engine.
- the repository documents a WebSocket search pipeline with retrieval, fusion/reranking, generation, citation validation, caching and metadata.
- the frontend maintains Quick Answer state including sources, answer, citations, structured data and trace information.
- the repository already has benchmark and architecture documents.

However, the existence of a documented architecture is **not proof that every claimed stage is actually executed in production**.

The first phase therefore audits reality.

## Non-negotiable rule

Do not trust:

- comments;
- README claims;
- old architecture documents;
- TypeScript interfaces;
- mocked fixtures;
- hard-coded progress strings;
- function names;
- optimistic UI state.

Trust only:

- executable code;
- tests;
- runtime logs/events;
- actual source objects;
- reproducible requests.

---

# 1. Phase 0 — Establish the real baseline

## 1.1 Repository inventory

Inspect before modifying anything.

At minimum inspect:

### Frontend

- `apps/market-ui/src/pages/SearchPage.tsx`
- `apps/market-ui/src/hooks/useGravitySearch.ts`
- `apps/market-ui/src/components/qa/`
- citation rendering components
- source/context components
- shared types

### Backend

- `services/gravity-api/app/api/routes/search.py`
- `services/gravity-api/app/core/search_pipeline.py`
- retrieval modules
- fusion/reranking modules
- citation validation modules
- source passage/types
- LLM router
- cache
- persistence
- existing WebSocket tests

### Evaluation

- `eval/`
- existing financial benchmark tests
- existing search tests
- existing frontend tests

Do not assume filenames from documentation are still accurate. Search the repository and record the actual locations.

## 1.2 Baseline commands

Run the repository's real commands before changing code:

- install/dependency validation if required
- backend tests
- frontend tests
- typecheck
- lint
- build
- health checks
- existing E2E/smoke tests if available

Record:

- command;
- exit code;
- number passed/failed;
- first real failure;
- environment/dependency failures separately from product failures.

Create:

`docs/quick-answer/BASELINE.md`

This file must contain factual results only.

## 1.3 Baseline runtime probe

Run at least these questions through the actual application:

1. `What was NVIDIA revenue in FY2025?`
2. `What was NVIDIA revenue in Q3 FY2026?`
3. `Compare NVIDIA and AMD data center revenue growth.`
4. `What is the latest reported revenue for Tesla?`
5. `What was Apple's revenue in fiscal 2025?`

For each request capture:

- request/trace ID;
- actual events received;
- source objects;
- source URLs;
- citation objects;
- verification fields;
- answer;
- latency;
- errors;
- whether the UI showed a stage that the backend never emitted.

If external data is unavailable, mark the test as blocked. Do not fabricate a passing result.

---

# 2. Phase 1 — Make the event stream truthful

## Problem

The Quick Answer progress UI must never simulate backend work.

A UI stage is valid only when a real backend event says that stage happened.

## 2.1 Define a canonical event contract

Create one shared, versioned event contract.

Suggested event:

```text
SearchEvent
- schema_version
- event_id
- trace_id
- request_id
- timestamp
- stage
- status
- title
- detail
- started_at
- completed_at
- duration_ms
- metadata
- error
```

Allowed stages should be explicit, for example:

```text
request_received
query_understanding
cache_lookup
retrieval_started
retrieval_channel_completed
fusion
reranking
sources_ready
generation_started
citation_validation
answer_ready
cache_write
completed
cancelled
failed
```

Do not add a stage merely because it looks good in the UI.

## 2.2 Event invariants

Every event must:

- belong to exactly one trace/request;
- have a stable event ID;
- be ordered or contain enough timestamps to reconstruct order;
- identify success/failure/cancellation;
- never claim a provider/model/database was used unless it actually was;
- contain measured duration where applicable.

## 2.3 Remove fake progress

Delete or replace hard-coded progress sequences in Quick Answer.

If a backend event is missing, the UI must show the actual known state rather than inventing the missing step.

Do not replace fake progress with another timer-based animation.

## 2.4 Provider truthfulness

If the UI says:

- Qdrant
- Elasticsearch
- Neo4j
- Cohere
- Voyage
- Gemini
- Claude
- GPT

the event must contain evidence that that provider was actually invoked.

The UI should derive provider labels from event metadata.

---

# 3. Phase 2 — Build a first-class provenance model

## Problem

Financial answers are only as trustworthy as the evidence chain.

Source identity must survive:

`retrieval → pipeline → WebSocket → frontend → citation → source viewer`.

## 3.1 Canonical source schema

Create or extend the canonical source object with fields appropriate to the existing codebase:

```text
source_id
document_id
chunk_id
title
publisher
document_type
canonical_url
source_uri
company
ticker
CIK / issuer identifier when available
filing_type
filing_date
period_start
period_end
fiscal_period
section_path
page
char_start
char_end
text
retrieval_channels
retrieval_score
rerank_score
source_quality
retrieved_at
content_hash
```

Do not invent values.

Optional fields must remain null/absent when unknown.

## 3.2 URL/provenance invariant

For any source presented as externally verifiable:

- canonical URL must be preserved;
- URL must survive serialization;
- frontend must receive it;
- citation must point to the same source identity;
- source viewer must be able to resolve it.

If a source has no URL, display it honestly as an internal/indexed source rather than implying an external verified link exists.

## 3.3 Source identity tests

Add tests proving that a source retains:

`source_id + document_id + chunk_id + URL + metadata`

through the entire streaming path.

---

# 4. Phase 3 — Replace binary "verified" with real citation verification

## Problem

A boolean `is_verified` is not sufficient evidence of financial correctness.

Verification must answer: **does this source actually support this claim?**

## 4.1 Introduce claim-level objects

Represent material claims separately from the final prose.

Suggested model:

```text
Claim
- claim_id
- text
- claim_type
- entity
- metric
- value
- unit
- currency
- period
- source_ids
- citation_ids
- verification_status
- verification_reasons
```

## 4.2 Verification layers

Implement deterministic checks first.

### Layer A — Citation validity

- cited index exists;
- source exists;
- source belongs to this answer;
- citation is not fabricated.

### Layer B — Evidence support

For each material claim:

- cited passage is actually related to the claim;
- claim is entailed/supported by the passage;
- unsupported claims are flagged.

### Layer C — Financial grounding

Where applicable verify:

- company/entity;
- ticker/issuer;
- metric;
- value;
- currency;
- unit;
- fiscal/calendar period;
- quarter/year;
- filing type;
- period end.

### Layer D — Numerical consistency

For arithmetic claims:

- recompute from source values where possible;
- compare answer number with source number;
- detect unit scaling mistakes;
- detect percentage vs percentage-point mistakes;
- detect million/billion errors.

## 4.3 Verdicts

Do not use only true/false.

Use:

```text
verified
partially_supported
unsupported
conflicting
not_verifiable
```

The answer policy must react to these states.

---

# 5. Phase 4 — Add an explicit abstention policy

A financial assistant must know when it does not have enough evidence.

## 5.1 Hard rules

The system must not confidently answer when:

- no authoritative source is available for a material factual claim;
- cited evidence contradicts the claim;
- entity resolution is ambiguous;
- fiscal period is ambiguous;
- units cannot be reconciled;
- a numerical result cannot be reproduced;
- citations are invalid;
- retrieval returned insufficient evidence.

## 5.2 Answer states

Use explicit states such as:

```text
answerable
answerable_with_caveat
insufficient_evidence
conflicting_evidence
system_error
```

The UI must distinguish them.

## 5.3 No fake confidence

Never calculate confidence merely from:

- LLM self-reported confidence;
- retrieval score alone;
- number of citations;
- answer length.

Confidence must be tied to evidence/verification signals.

---

# 6. Phase 5 — Cancellation and idempotent reconnect

## 6.1 Real cancellation

Closing a browser WebSocket is not sufficient.

Implement cancellation propagation:

```text
Browser
→ cancel request
→ API
→ pipeline cancellation token
→ retrieval/model tasks
→ cleanup
→ cancelled event
```

Every long-running async operation must respect cancellation.

## 6.2 Cancellation tests

Verify:

- cancel before retrieval;
- cancel during retrieval;
- cancel during generation;
- cancel during citation verification;
- no result is persisted as completed;
- resources are released;
- UI ends in a stable cancelled state.

## 6.3 Idempotent reconnect

Use `trace_id`/request ID as an idempotency/resume key.

If the browser reconnects:

- do not start a second expensive search;
- resume or attach to the existing execution;
- do not duplicate persistence;
- do not duplicate billing/cost accounting.

Add a test that deliberately disconnects and reconnects.

---

# 7. Phase 6 — Failure isolation and graceful degradation

Quick Answer must survive partial infrastructure failure.

## 7.1 Retrieval channel isolation

If one retrieval provider fails:

- capture the failure;
- emit a truthful event;
- continue with healthy channels where safe;
- mark degraded quality;
- never pretend the failed channel succeeded.

## 7.2 Model fallback

If a model provider fails:

- use the repository's supported fallback mechanism;
- preserve the model actually used in metadata;
- do not silently label the result as produced by another model.

## 7.3 No generic black-box 500

Errors should have structured categories:

```text
validation_error
authentication_error
retrieval_error
provider_timeout
model_error
citation_verification_error
persistence_error
cancelled
internal_error
```

The frontend should render useful states without exposing secrets.

---

# 8. Phase 7 — Financial correctness test suite

This is the most important quality gate.

Create a dedicated Quick Answer evaluation suite.

## 8.1 Golden questions

Build a versioned dataset covering:

### Exact facts

- annual revenue
- quarterly revenue
- segment revenue
- operating income
- net income
- EPS

### Temporal traps

- fiscal vs calendar year
- fiscal quarter labels
- period end dates
- latest vs annual

### Entity traps

- parent vs subsidiary
- similarly named companies
- ticker ambiguity

### Units

- thousands
- millions
- billions
- percentages
- percentage points

### Comparisons

- YoY growth
- QoQ growth
- margin change
- company A vs company B

### Adversarial evidence

- plausible but wrong passage
- wrong quarter
- wrong company
- old filing
- conflicting sources

## 8.2 Required metrics

Measure at minimum:

- answer accuracy;
- atomic claim accuracy;
- citation validity;
- citation support/entailment;
- citation coverage;
- unsupported-claim rate;
- wrong-source rate;
- entity accuracy;
- period accuracy;
- unit accuracy;
- arithmetic accuracy;
- abstention precision;
- false-confidence rate;
- p50/p95 latency;
- TTFT;
- cost per query.

## 8.3 No vanity benchmark

A passing result cannot be:

> "The answer looks good."

Every evaluation must have a deterministic expected answer or a human/judge rubric.

---

# 9. Phase 8 — End-to-end Quick Answer contract test

Create a test that starts at the same boundary the browser uses.

Test:

```text
query
→ WebSocket
→ real pipeline
→ events
→ sources
→ answer
→ citations
→ verification
→ persistence
→ frontend-compatible payload
```

The test must fail if:

- a required event is missing;
- a source URL disappears;
- a citation references a nonexistent source;
- a claim is marked verified without evidence;
- an answer is completed without required verification;
- the same trace produces duplicate completion;
- cancellation still produces a completed answer.

---

# 10. Phase 9 — Frontend correctness

The UI must be a projection of backend truth.

## 10.1 Progress component

Replace simulated progress with event-driven state.

Show:

- stage;
- actual status;
- actual duration;
- real provider metadata when available;
- failure/degraded status;
- cancellation.

Do not show internal chain-of-thought.

The UI may show concise operational events such as:

> Retrieved 18 candidate passages

but must not expose hidden reasoning or private model deliberation.

## 10.2 Source panel

For every source show only metadata actually available.

Suggested display:

- publisher;
- document title;
- document type;
- date;
- company/ticker;
- section/page;
- verification state;
- open-source action when URL exists.

## 10.3 Citation interaction

Clicking a citation must resolve to the exact source/chunk used.

Never show a green verification badge if the backend verdict is anything other than `verified`.

## 10.4 Error/degraded states

Implement distinct UI for:

- insufficient evidence;
- conflicting evidence;
- partial retrieval;
- provider failure;
- cancellation;
- system error.

---

# 11. Phase 10 — Persistence and reproducibility

Persist enough information to debug a bad answer.

At minimum preserve:

- trace/request ID;
- normalized query;
- source IDs;
- source metadata;
- cited spans;
- verification verdicts;
- model/provider actually used;
- timing;
- failure/degradation events;
- answer status.

Do not store secrets.

If the repository already has an audit/evaluation schema, reuse it rather than creating a duplicate system.

---

# 12. Phase 11 — Performance without fake UX

Only optimize after correctness passes.

Measure:

- TTFT;
- retrieval latency;
- reranking latency;
- verification latency;
- total latency;
- token throughput;
- cost.

Do not set arbitrary targets before measuring the actual baseline.

After measurement, define realistic budgets for:

- simple factual query;
- retrieval-heavy query;
- comparison query.

Caching may be used, but cached results must retain provenance and must not bypass verification rules.

---

# 13. Phase 12 — Security and correctness review

Before declaring done:

- no API keys in client bundles;
- no secret leakage in WebSocket events;
- auth checked at the actual API boundary;
- tenant/user isolation verified;
- source URLs sanitized;
- external URLs cannot execute arbitrary frontend code;
- prompt/input content cannot alter system policy;
- logs do not contain sensitive credentials;
- cancellation cannot be abused to corrupt state;
- duplicate requests do not duplicate persistent records.

---

# 14. Required test matrix

The implementation is not complete until the following are automated.

## Backend unit tests

- event schema;
- event ordering;
- source normalization;
- URL preservation;
- citation binding;
- claim extraction;
- entity check;
- period check;
- unit check;
- numerical check;
- verification verdict;
- abstention;
- cancellation;
- idempotency;
- provider failure;
- model fallback.

## Backend integration tests

- WebSocket happy path;
- WebSocket error;
- WebSocket cancellation;
- WebSocket reconnect;
- retrieval partial failure;
- model failure;
- citation verification failure;
- persistence failure.

## Frontend tests

- event → progress state;
- source rendering;
- citation rendering;
- verified/unverified states;
- insufficient evidence;
- conflicting evidence;
- cancellation;
- reconnect;
- error state.

## E2E tests

At least:

1. exact SEC-style fact;
2. quarterly fiscal-period question;
3. comparison question;
4. unsupported question;
5. conflicting-source question;
6. cancellation;
7. reconnect;
8. degraded retrieval provider.

---

# 15. Definition of Done

Quick Answer is DONE only when all are true.

### Truthfulness

- [ ] No hard-coded fake pipeline progress remains.
- [ ] Every displayed pipeline stage comes from a real backend event.
- [ ] Provider/model labels are runtime-derived.

### Provenance

- [ ] Source identity survives the entire pipeline.
- [ ] URLs are preserved where available.
- [ ] Citation resolves to exact source/chunk/span.
- [ ] Missing provenance is represented honestly.

### Verification

- [ ] Material claims are represented explicitly or have an equivalent deterministic verification path.
- [ ] Citation validity is checked.
- [ ] Evidence support is checked.
- [ ] Entity/period/unit checks exist where applicable.
- [ ] Numerical claims are checked where possible.
- [ ] Verification verdict is more expressive than a blind boolean.

### Safety against hallucination

- [ ] Unsupported material claims trigger caveat/abstention.
- [ ] Conflicting evidence is surfaced.
- [ ] No fake confidence is shown.

### Reliability

- [ ] Cancellation propagates to the backend.
- [ ] Reconnect is idempotent/resumable.
- [ ] Retrieval failures degrade safely.
- [ ] Model fallback records the model actually used.

### Testing

- [ ] Unit tests pass.
- [ ] Integration tests pass.
- [ ] Frontend tests pass.
- [ ] Typecheck passes.
- [ ] Lint passes.
- [ ] Build passes.
- [ ] E2E Quick Answer suite passes.
- [ ] Golden financial QA suite passes its configured thresholds.

### Operational proof

- [ ] A fresh clean environment can run the documented test/smoke procedure.
- [ ] A failed verification test actually fails the build.
- [ ] A deliberately broken source URL is detected.
- [ ] A deliberately wrong fiscal period is detected.
- [ ] A deliberately fabricated citation is rejected.
- [ ] A deliberate provider failure produces degraded output rather than a false-success state.
- [ ] A cancelled query does not complete in persistence.

---

# 16. Final acceptance run

After implementation, execute a clean verification pass.

Do not stop after the first green test.

Run:

1. repository lint;
2. typecheck;
3. backend unit tests;
4. backend integration tests;
5. frontend tests;
6. build;
7. infrastructure health;
8. seed data;
9. E2E Quick Answer suite;
10. golden financial QA suite;
11. failure-injection tests;
12. cancellation/reconnect tests;
13. inspect generated traces;
14. inspect final UI manually.

Produce:

`docs/quick-answer/FINAL_VERIFICATION.md`

It must contain:

- exact commands;
- exact exit codes;
- counts;
- benchmark results;
- known limitations;
- failures that remain;
- screenshots or captured evidence if the project already has an E2E capture mechanism.

## Absolute rule

If any required gate fails, the implementation is **NOT DONE**.

Do not write "complete", "production-ready", "world-class", or "all tests pass" unless the evidence proves it.

---

# 17. What NOT to do

Do not:

- rewrite the entire search engine;
- migrate databases as part of this project;
- add more LLM providers just for marketing;
- add fake progress animation;
- expose chain-of-thought;
- replace deterministic checks with an LLM saying "looks correct";
- add a confidence number with no calibration;
- weaken tests to make them pass;
- delete failing tests;
- mock the whole pipeline in the E2E test;
- claim an external source was verified when it was not fetched;
- silently swallow provider failures;
- change unrelated Deep Research/Grid functionality unless required by a shared contract.

The target is **working Quick Answer**, not a larger codebase.

---

# 18. Execution order

Execute strictly in this order:

```text
0. Baseline
   ↓
1. Truthful event contract
   ↓
2. Provenance
   ↓
3. Claim/citation verification
   ↓
4. Abstention
   ↓
5. Cancellation + idempotency
   ↓
6. Failure isolation
   ↓
7. Financial QA evaluation
   ↓
8. E2E contract
   ↓
9. Frontend projection
   ↓
10. Persistence/reproducibility
   ↓
11. Performance
   ↓
12. Security
   ↓
13. Final verification
```

Do not jump directly to UI polish.

---

# 19. Success standard

The final question is not:

> "Does Quick Answer look impressive?"

The final question is:

> **"Can we deliberately feed Quick Answer a wrong source, wrong quarter, wrong unit, fabricated citation, provider failure, disconnect, and cancellation — and does the system correctly detect or handle every case without pretending it succeeded?"**

If yes, Quick Answer has crossed the line from demo to serious financial QA infrastructure.

If no, keep working.
