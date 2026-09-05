# AlphaGravity Quick Answer — R8 World-Class Hardening Roadmap

## Mission

Harden the Quick Answer financial research pipeline until it has a coherent, claim-level, provenance-aware evidence architecture.

This is NOT another benchmark-score optimization exercise.

The goal is:

> A financial answer must only receive VERIFIED evidence credit when the exact financial proposition is supported by the exact evidence, with correct entity, metric, value, unit/scale, period, scope, segment, currency, filing identity, and provenance.

Do not claim certification unless the implementation and verification criteria below are actually demonstrated.

---

# 0. NON-NEGOTIABLE RULES

1. Investigate the existing implementation before modifying it.
2. Read the actual producer → transformer → evaluator → publication path.
3. Do not assume tests describe production behavior.
4. Do not modify tests merely to make them pass.
5. Do not hard-code fixture-specific values.
6. Do not create a second parallel evidence model if an existing canonical model can be extended.
7. Preserve backward compatibility where practical, but remove ambiguous representations when they create correctness risk.
8. Every bug fix must include:
   - root cause
   - production trigger
   - regression test
   - proof that the test fails before the fix
   - proof that it passes after the fix
9. If a requirement cannot be proven, label it UNPROVEN.
10. Never report "world-class", "production-ready", or "certified" merely because the test suite is green.
11. Never weaken an evaluator so that existing tests pass.
12. Prefer general invariants over fixture-specific assertions.
13. Do not optimize benchmark scores at the expense of correctness.
14. Do not touch unrelated architecture.
15. Keep a running `R8_PROGRESS.md` containing:
   - discovered issue
   - root cause
   - files/functions
   - implementation
   - tests
   - remaining uncertainty.

---

# 1. BASELINE FIRST — NO CODE CHANGES

Before editing anything:

## 1.1 Establish exact git state

Record:

- HEAD
- branch
- working tree status
- commit range since R7
- changed files
- existing test configuration
- CI configuration

## 1.2 Trace the real Quick Answer path

Trace this exact lifecycle:

```text
user query
  ↓
SearchPipeline
  ↓
retrieval channels
  ↓
source objects
  ↓
citation construction
  ↓
citation provenance
  ↓
answer generation
  ↓
answer contract
  ↓
FinalGate
  ↓
publication
  ↓
cache write
  ↓
cache replay
```

Do not proceed until the real producer vocabulary is documented.

Create:

```text
docs/quick-answer/R8_DATAFLOW.md
```

Include actual file/function names.

---

# 2. CANONICAL EVIDENCE OBJECT — E1

The current system has a strong `citation_provenance.py` canonical object, but it is not yet universal.

The goal is ONE canonical financial evidence representation.

## 2.1 Define the canonical evidence schema

Create or formalize an immutable internal representation equivalent to:

```python
EvidenceFact(
    evidence_id,
    entity,
    ticker,
    cik,

    metric,
    concept,

    value,
    currency,
    unit,
    scale,

    period,
    period_start,
    period_end,
    fiscal_year,
    fiscal_quarter,

    scope,
    segment,

    filing_accession,
    filing_date,
    filing_form,
    document_section,

    source_class,
    verification_status,

    citation_id,
    source_url,

    restated,
    amended,

    raw_text,
)
```

Do NOT blindly copy this schema.

First inspect the existing provenance implementation and preserve fields already present.

The final canonical object must have one authoritative meaning for every field.

---

## 2.2 Eliminate "two worlds" of evidence

Current risk:

```text
authoritative XBRL/SEC evidence
        ↓
canonical provenance

WEB/local/prose evidence
        ↓
different representation
```

Determine which fields can be populated for every source class.

Do NOT falsely label web/local evidence as SEC filing evidence.

Instead distinguish:

```text
source identity
vs
financial fact identity
vs
verification strength
```

A web citation may reference an SEC page without itself proving that the underlying content is a verified filing fact.

---

## 2.3 Accession must never be sufficient by itself

Fix any rule equivalent to:

```python
if accession:
    primary = True
```

A valid-looking accession is not sufficient provenance.

Require coherent filing identity:

```text
valid accession
+
SEC filing/source class
+
compatible filing URL or filing metadata
```

Negative tests:

- fake accession + WEB_EVIDENCE
- fake accession + LOCAL_EVIDENCE
- fake accession + BLOG
- fake accession + NEWS
- valid accession embedded in arbitrary prose

All must fail primary-provenance classification.

---

# 3. CANONICAL SOURCE CLASS VOCABULARY

Audit every occurrence of:

```text
source_class
SEC_EVIDENCE
SEC_EVIDENCE
sec_filing
sec_xbrl
edgar
structured
WEB_EVIDENCE
LOCAL_EVIDENCE
```

Find every producer and consumer.

Create one canonical enum/value mapping.

Example architecture:

```text
EvidenceSourceClass
    SEC_FILING
    SEC_XBRL
    LOCAL_STRUCTURED
    LOCAL_DOCUMENT
    WEB
    NEWS
    TRANSCRIPT
    OTHER
```

Do not necessarily use these exact names.

Use the vocabulary already appropriate for the application.

Then ensure:

```text
retrieval
→ citation
→ provenance
→ rubric
→ FinalGate
→ API schema
```

all agree.

No consumer should silently interpret another producer's string.

Add a vocabulary contract test.

---

# 4. ENTITY BINDING — E2

Current entity binding has two major risks:

1. no identity can become "not penalized"
2. substring matching can produce false bindings.

Replace this with explicit entity resolution semantics.

## 4.1 Required states

Entity matching must distinguish:

```text
MATCH
MISMATCH
UNKNOWN
```

Never convert UNKNOWN into MATCH.

For evidence verification:

```text
MATCH      → may satisfy entity requirement
MISMATCH   → must fail
UNKNOWN    → cannot satisfy entity requirement
```

---

## 4.2 Entity normalization

Implement a canonical normalization layer for:

- ticker
- legal company name
- common company name
- CIK
- issuer
- document title

Handle:

- case
- punctuation
- Inc.
- Incorporated
- Corp.
- Corporation
- Ltd.
- Limited
- PLC
- hyphenation
- Unicode punctuation
- whitespace

Do not make short ticker/name tokens dangerous substring matches.

Example:

```text
ABC
```

must not match:

```text
ABCDEF
```

unless explicitly justified by the canonical identity resolver.

---

## 4.3 Identity priority

Prefer:

```text
CIK
↓
exact ticker
↓
canonical issuer identity
↓
normalized legal/company name
```

Do not allow a weak identity match to override a strong mismatch.

---

# 5. FINANCIAL CLAIM GRAPH — MOST IMPORTANT CHANGE

The largest remaining architecture gap is that evidence binding is still largely lexical/proximity based.

Move toward an explicit graph:

```text
Answer
 ├── Claim A
 │     ├── EvidenceFact 1
 │     └── EvidenceFact 2
 │
 ├── Claim B
 │     └── EvidenceFact 3
 │
 └── Claim C
       ├── EvidenceFact 4
       └── EvidenceFact 5
```

## 5.1 Atomic financial claim

Represent an atomic claim as:

```python
FinancialClaim(
    entity,
    metric,
    value,
    currency,
    unit,
    scale,
    period,
    scope,
    segment,
)
```

A claim should not be considered supported merely because:

```text
number appears somewhere
+
metric word appears somewhere
```

---

# 6. METRIC ↔ VALUE ASSOCIATION — V21

Explicitly attack the known transposition gap.

Example adversarial evidence:

```text
Revenue ........ $120B
Operating income $30B
```

Answer:

```text
Revenue was $30B.
```

The citation contains both the metric and number.

A naive lexical/proximity system may pass.

It MUST fail.

Add adversarial fixtures for:

- adjacent table rows
- multiple numbers in same paragraph
- same number appearing for two metrics
- previous-year/current-year columns
- quarterly/annual columns
- percentages beside dollar values
- EPS beside revenue
- margins beside absolute values

---

# 7. PERIOD ATTACHMENT

A financial value is not fully identified without period.

Examples:

```text
Revenue 2025 = $130B
Revenue 2024 = $110B
```

Answer:

```text
2024 revenue was $130B
```

must fail even though:

```text
metric = revenue
value = 130B
```

matches.

Implement:

```text
claim.period
    ↕
evidence.period
```

with explicit compatibility.

Required states:

```text
MATCH
MISMATCH
UNKNOWN
```

UNKNOWN must not satisfy a required period.

Test:

- FY2025 vs FY2024
- Q1 vs Q2
- quarter vs full year
- TTM vs FY
- calendar vs fiscal year
- same year but different quarter
- comparative columns.

---

# 8. UNIT / SCALE / CURRENCY SEMANTICS — E2

This must be semantic, not merely textual.

Real SEC tables commonly contain:

```text
(in millions)

Revenue     59,070
```

The number is not:

```text
$59,070
```

but:

```text
$59,070 million
```

Likewise distinguish:

```text
59,070 million
59,070 billion
59.070 billion
59,070
```

## 8.1 Canonical representation

Normalize internally to:

```text
value
unit
scale
currency
```

Example:

```text
59070
USD
1_000_000
```

or equivalent.

Do NOT add scale to XBRL values that are already absolute.

---

## 8.2 Scale must come from evidence

Sources of scale may include:

1. explicit table header
2. explicit prose
3. canonical structured fact metadata
4. trusted document metadata

Do NOT infer scale merely because a number "looks like" millions/billions.

---

## 8.3 Currency

Test:

```text
USD
EUR
GBP
JPY
CNY
```

and:

```text
"$"
"€"
"£"
```

plus prose/table metadata.

A matching numeric value with wrong currency must fail.

---

# 9. SCOPE / SEGMENT SEMANTICS

Test:

```text
consolidated revenue
segment revenue
geographic revenue
continuing operations
discontinued operations
```

Example:

```text
Company revenue = $100B
Cloud segment revenue = $30B
```

Answer:

```text
Company revenue was $30B.
```

must fail.

Add:

```text
scope
segment
consolidation
```

to the claim/evidence compatibility matrix.

---

# 10. RESTATEMENT / AMENDMENT SEMANTICS

This is a major missing adversarial dimension.

Test:

```text
original filing
amended filing
restated figure
subsequent comparative filing
```

The system must not silently treat two conflicting values as equivalent.

Define explicit behavior:

```text
ORIGINAL
RESTATED
AMENDED
UNKNOWN
```

When two facts conflict:

```text
CONFLICTING
```

must remain distinct from:

```text
VERIFIED
```

---

# 11. VERIFICATION STATUS COMPATIBILITY — V18

Do NOT build an invariant that only tests:

```text
UNSUPPORTED
```

against the grader.

Build a compatibility matrix.

Example:

| Production | Grader | Result |
|---|---|---|
| VERIFIED | VERIFIED | pass |
| VERIFIED | PARTIALLY_SUPPORTED | investigate |
| VERIFIED | UNSUPPORTED | fail |
| CONFLICTING | VERIFIED | fail |
| CONFLICTING | PARTIALLY_SUPPORTED | fail |
| UNSUPPORTED | VERIFIED | fail |
| NOT_VERIFIABLE | VERIFIED | fail |

Use the actual production enum names.

The critical invariant is:

> Production evidence semantics and evaluator semantics must never disagree in a direction that creates false confidence.

---

# 12. CLAIM → EVIDENCE GRAPH TESTING

Upgrade the mutation rig.

Current mutation testing is strong but primarily node-oriented.

Add EDGE mutations.

Mutation categories:

```text
entity edge
metric edge
value edge
period edge
currency edge
unit edge
scale edge
scope edge
segment edge
filing edge
citation-index edge
claim→evidence edge
```

Example:

```text
Correct claim
    ↓
Correct evidence

mutation:
claim.metric ↔ evidence.metric
```

Expected:

```text
UNSUPPORTED / CONFLICTING
```

Never:

```text
VERIFIED
```

---

# 13. CITATION INDEX / IDENTITY MAPPING

Add explicit mutation tests for:

```text
citation_id
evidence_id
claim_id
source index
citation order
```

Example:

```text
Claim A → citation 0
Claim B → citation 1
```

Swap:

```text
Claim A → citation 1
Claim B → citation 0
```

The evaluator must detect the transposition.

This is a high-value integrity test because all the underlying evidence can remain individually valid.

---

# 14. ASSERTED-CLAIM PARSING

The current `_asserts()` behavior around parenthetical asides and punctuation is too narrow.

Do not solve this by blindly adding punctuation characters.

First define the semantic rule.

Test:

```text
Revenue was $120B — but the filing reports $130B.
Revenue was $120B; the cited table reports $130B.
Revenue was $120B, while the filing reports $130B.
Revenue was $120B. The filing reports $130B.
Revenue was $120B (although the filing reports $130B).
```

The system must identify what the answer actually asserts.

Do not treat every number in a sentence as an asserted financial fact.

---

# 15. FINALGATE — PUBLICATION INVARIANT

Verify every Quick Answer publication path.

Required invariant:

```text
NO ANSWER EVENT MAY BE PUBLISHED
UNTIL FINALGATE HAS PASSED.
```

Audit:

- normal generated answer
- no-evidence refusal
- cache hit
- cached answer replay
- fallback path
- error/recovery path
- streaming path
- WebSocket path
- REST path

Search for every:

```python
yield
send
return answer
publish
cache.set
```

and prove the gate ordering.

Do not assume there are only three paths.

---

# 16. CACHE INTEGRITY

The cache currently trusts a stored passing verdict.

Determine whether the cache entry cryptographically/logically binds:

```text
query
answer
citations
contract
verdict
provenance
```

If not, design an integrity binding.

At minimum:

```text
cache payload
    +
deterministic content hash
    ↓
verdict
```

The system must reject a verdict if the answer/citations/contract have changed after verdict generation.

Test:

```text
generate passing answer
↓
store cache

mutate answer
↓
reuse old verdict
```

Expected:

```text
REJECT
```

Also mutate:

- citations
- provenance
- contract
- evidence list.

---

# 17. PRODUCTION FIXTURE CORPUS

Build a small but serious fixture corpus.

Minimum:

## SEC/XBRL

- NVIDIA
- Apple
- Microsoft
- Tesla
- United Airlines
- one non-USD-heavy company
- one amended/restated example
- one segmented company

## Fixture dimensions

Every fixture should include:

```text
entity
metric
value
currency
unit
scale
period
scope
segment
filing
accession
section
citation
```

Do not fabricate SEC data.

Use actual repository fixtures or verified SEC-derived data already present in the project.

---

# 18. DIFFERENTIAL TESTING

For each fixture construct:

```text
CORRECT
WRONG_VALUE
WRONG_UNIT
WRONG_SCALE
WRONG_CURRENCY
WRONG_PERIOD
WRONG_ENTITY
WRONG_SCOPE
WRONG_SEGMENT
WRONG_METRIC
WRONG_CITATION
WRONG_CITATION_INDEX
CONFLICTING
UNSUPPORTED
```

Expected result must be defined explicitly.

This becomes the core evidence test matrix.

---

# 19. EVALUATOR THEATRE TEST

Prove the grader cannot pass because of fixture leakage.

Procedure:

1. Revert the production fix.
2. Confirm the adversarial test fails.
3. Restore production fix.
4. Confirm it passes.
5. Change fixture wording substantially.
6. Confirm result remains correct.
7. Change order of citations.
8. Confirm result remains correct.
9. Replace numbers with different valid values.
10. Confirm result still follows semantics.

If a test passes before the production fix, mark it:

```text
THEATRE / INVALID REGRESSION TEST
```

and replace it.

---

# 20. TEST PYRAMID

Do not rely exclusively on unit tests.

Implement:

```text
Layer 1 — pure semantic unit tests
Layer 2 — provenance/evidence integration tests
Layer 3 — SearchPipeline integration tests
Layer 4 — API/WebSocket E2E
Layer 5 — cache replay tests
Layer 6 — production-like fixture tests
```

Each layer must test different failure modes.

---

# 21. REAL QUICK ANSWER E2E

Create an E2E path using the actual application route.

Prove:

```text
query
→ retrieval
→ answer
→ provenance
→ FinalGate
→ publication
```

The only allowed substitution should be external dependencies that genuinely cannot run in the test environment.

Do not replace the component under test.

---

# 22. PERFORMANCE

Do NOT claim Quick Answer latency from a grader microbenchmark.

Measure separately:

```text
retrieval latency
answer-generation latency
provenance construction
FinalGate
serialization
cache hit
cache miss
end-to-end latency
```

Report:

```text
p50
p95
p99
```

for realistic test workloads.

Keep correctness and latency measurements separate.

---

# 23. OBSERVABILITY

Add structured telemetry sufficient to answer:

```text
Why was this claim VERIFIED?
Why was this claim rejected?
Which evidence fact supported it?
Which entity matched?
Which period matched?
Which unit/scale matched?
Which citation was used?
Which gate rejected it?
```

Do not log secrets or sensitive data.

---

# 24. ARCHITECTURAL CLEANUP

After functionality is correct:

Search for duplicate concepts:

```text
source_class
verification_status
canonical_url
evidence_location
issuer
citation provenance
financial fact
citation verdict
```

If multiple representations exist, determine whether each is:

```text
canonical
transport
legacy compatibility
derived
```

Document this explicitly.

Do not perform cosmetic refactoring merely for style.

---

# 25. REQUIRED R8 TEST MATRIX

Create:

```text
tests/quick_answer/test_r8_evidence_contract.py
tests/quick_answer/test_r8_entity_binding.py
tests/quick_answer/test_r8_period_binding.py
tests/quick_answer/test_r8_unit_scale.py
tests/quick_answer/test_r8_claim_evidence_edges.py
tests/quick_answer/test_r8_citation_index.py
tests/quick_answer/test_r8_cache_integrity.py
tests/quick_answer/test_r8_finalgate_publication.py
```

If equivalent existing test files already exist, extend them rather than duplicating them.

---

# 26. SUCCESS CRITERIA

R8 is successful only if ALL are true.

## Evidence

- [ ] canonical financial evidence representation exists
- [ ] producer/consumer vocabulary is unified
- [ ] fake accession cannot create primary provenance
- [ ] entity mismatch fails
- [ ] unknown entity cannot silently pass
- [ ] metric mismatch fails
- [ ] value mismatch fails
- [ ] period mismatch fails
- [ ] unit mismatch fails
- [ ] scale mismatch fails
- [ ] currency mismatch fails
- [ ] scope mismatch fails
- [ ] segment mismatch fails
- [ ] filing mismatch fails
- [ ] citation-index transposition fails
- [ ] claim/evidence edge transposition fails
- [ ] conflicting evidence cannot become VERIFIED

## FinalGate

- [ ] every publication path is gated
- [ ] cache replay cannot bypass integrity
- [ ] failed verdicts cannot be served
- [ ] verdict is bound to exact answer/citations/contract

## Evaluator

- [ ] evaluator uses production semantics where appropriate
- [ ] evaluator does not depend on fixture wording
- [ ] mutation rig contains both node and edge mutations
- [ ] negative tests fail before fixes
- [ ] tests pass after fixes
- [ ] no test exists solely to mirror implementation internals

## Production proof

- [ ] actual Quick Answer route tested
- [ ] actual WebSocket path tested
- [ ] cache hit tested
- [ ] cache miss tested
- [ ] no-evidence path tested
- [ ] generated answer path tested
- [ ] performance measured end-to-end
- [ ] no unsupported certification claim

---

# 27. FINAL AUDIT REPORT

At the end create:

```text
docs/quick-answer/R8_FINAL_AUDIT.md
```

Use exactly these sections:

```text
1. Executive Verdict
2. What Changed
3. Root Causes Closed
4. Root Causes Still Open
5. Tests Actually Executed
6. Tests Not Executed
7. Production Paths Verified
8. Known Limitations
9. Performance Measurements
10. Evidence Architecture
11. Evaluator Integrity
12. Certification Decision
```

For every claim use one of:

```text
PROVEN
TESTED
READ
INFERRED
UNPROVEN
BLOCKED
```

Never use vague language such as:

```text
looks good
should work
production-ready
world-class
fully fixed
```

unless backed by evidence.

---

# 28. FINAL COMMAND TO CLAUDE

Do not stop after implementing the first obvious fixes.

Work systematically through the roadmap.

Before every major change:

```text
inspect → reproduce → identify root cause → write failing test → implement → run targeted test → run broader tests
```

When a test unexpectedly passes before the fix, investigate the test immediately.

When the full suite fails after a targeted fix:

```text
do not weaken the new test
do not revert the production fix automatically
identify the contract conflict
repair the implementation or the genuinely incorrect old test
```

At the end report:

```text
FILES CHANGED:
COMMITS:
TESTS RUN:
TESTS PASSED:
TESTS FAILED:
TESTS SKIPPED:
BLOCKED TESTS:
KNOWN OPEN RISKS:
CERTIFICATION:
```

Certification must be one of:

```text
CERTIFIED
NOT CERTIFIED
BLOCKED
```

Default to:

```text
NOT CERTIFIED
```

unless every required criterion is actually demonstrated.

The objective is not a green scoreboard.

The objective is a Quick Answer system where a financially wrong answer cannot obtain VERIFIED evidence merely because the right number, metric word, or citation happens to appear somewhere nearby.