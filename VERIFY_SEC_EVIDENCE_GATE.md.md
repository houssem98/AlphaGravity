# VERIFY AND EXPOSE THE SEC VERIFIED-EVIDENCE GATE

Execute this against the actual AlphaGravity repository.

Do NOT assume the gate exists because a previous report says it exists.

The goal is to make the implementation explicit, testable, auditable, and easy to verify in GitHub.

============================================================
1. INSPECT FIRST
============================================================

Inspect the current implementation before modifying anything.

Find the exact financial-query orchestration path:

QUESTION
→ query understanding
→ financial intent
→ retrieval
→ SEC
→ verification
→ answer

Identify the exact files/functions responsible for:

- financial intent classification
- structured/local retrieval
- SEC retrieval
- orchestration
- evidence verification
- persistence
- tests

Do not create duplicate architecture.

============================================================
2. REQUIRED EXPLICIT GATE
============================================================

There MUST be an explicit routing decision equivalent to:

    verified_local_evidence = check_verified_local_evidence(query)

    if verified_local_evidence:
        return local_answer

    return sec_authoritative_retrieval(...)

Do not hide this decision inside RRF.

Do not rely on:

    len(structured_results) > 0

Do not rely on:

    semantic similarity

Do not rely on:

    any local row existing

The decision must specifically determine whether the local evidence
is sufficiently verified and exactly matches the requested financial fact.

============================================================
3. REQUIRED STATES
============================================================

Implement explicit routing states:

    VERIFIED_LOCAL_HIT
    LOCAL_MISS
    LOCAL_UNVERIFIED
    LOCAL_CONFLICT

Meaning:

VERIFIED_LOCAL_HIT
→ exact verified local evidence exists
→ SEC MUST NOT be called

LOCAL_MISS
→ no exact local evidence
→ SEC MUST be called

LOCAL_UNVERIFIED
→ local data exists but is not verified
→ SEC MUST be called

LOCAL_CONFLICT
→ local evidence conflicts with authoritative/provenance requirements
→ SEC MUST be called

Do not silently convert these states into one generic "miss".

============================================================
4. EXACT EVIDENCE IDENTITY
============================================================

The gate must verify the local fact against the actual financial intent.

At minimum consider:

- ticker
- CIK
- fiscal year
- fiscal quarter
- period start
- period end
- metric
- segment/dimension
- statement scope
- unit
- fact type
- filing provenance
- accession number where applicable
- verification status

Use the existing AlphaGravity evidence model if one exists.

Do NOT create a second evidence model unnecessarily.

============================================================
5. MAKE THE IMPLEMENTATION EASY TO FIND
============================================================

Create or use a clearly named module/function.

Preferred conceptual naming:

    verified_evidence_gate.py

or an equivalent existing AlphaGravity module.

The exact filename may differ if the architecture has a better location.

The implementation must contain a clearly identifiable function such as:

    check_verified_local_evidence(...)

or equivalent.

Add a concise code comment explaining:

    "SEC is only invoked when no exact verified local evidence
     satisfies the financial query."

Do NOT add fake code merely for grep visibility.

The code must actually control execution.

============================================================
6. REQUIRED OBSERVABILITY
============================================================

Expose routing telemetry:

    local_evidence_status
    sec_invoked
    sec_skip_reason

Possible values:

    VERIFIED_LOCAL_HIT
    LOCAL_MISS
    LOCAL_UNVERIFIED
    LOCAL_CONFLICT

Example:

    {
      "local_evidence_status": "VERIFIED_LOCAL_HIT",
      "sec_invoked": false,
      "sec_skip_reason": "VERIFIED_LOCAL_HIT"
    }

Do not expose secrets or sensitive credentials.

============================================================
7. REQUIRED TESTS
============================================================

Add deterministic integration tests proving the actual execution path.

TEST A — VERIFIED LOCAL HIT

Preload exact verified NVDA Q3 FY2026 Data Center revenue.

Run the real financial query.

Expected:

    local_evidence_status = VERIFIED_LOCAL_HIT
    sec_invoked = false
    EDGAR calls = 0

This test MUST prove SEC was not called.

Do not mock away the routing decision.

------------------------------------------------------------

TEST B — EMPTY LOCAL CORPUS

Remove the relevant NVDA Q3 FY2026 evidence.

Run:

    "What was NVIDIA's Data Center revenue in Q3 FY2026?"

Expected:

    local_evidence_status = LOCAL_MISS
    sec_invoked = true
    EDGAR calls = 1

Then prove:

    exact filing
    exact fact
    verification
    citation
    answer
    persistence

------------------------------------------------------------

TEST C — SECOND QUERY AFTER PERSISTENCE

Run the same query again after the fact has been persisted.

Expected:

    local_evidence_status = VERIFIED_LOCAL_HIT
    sec_invoked = false
    EDGAR calls = 0

This proves the purpose of persistence.

------------------------------------------------------------

TEST D — UNVERIFIED LOCAL DATA

Insert a local record matching the metric/period but mark it
unverified.

Expected:

    LOCAL_UNVERIFIED
    sec_invoked = true

------------------------------------------------------------

TEST E — CONFLICTING LOCAL DATA

Create local evidence that conflicts with authoritative provenance,
filing, dimension, unit, or value.

Expected:

    LOCAL_CONFLICT
    sec_invoked = true

============================================================
8. PROVE IT WITH CALL COUNTS
============================================================

The tests must verify actual SEC invocation.

Do NOT merely assert:

    sec_invoked == false

if the underlying EDGAR client could still have been called.

Instrument the real boundary or use an appropriate test spy/mock
at the SEC client boundary.

Required proof:

    verified local:
        EDGAR = 0

    local miss:
        EDGAR = 1

    unverified local:
        EDGAR = 1

    conflict:
        EDGAR = 1

============================================================
9. DO NOT BREAK THE EXISTING RETRIEVAL SYSTEM
============================================================

Do NOT globally remove:

- dense retrieval
- sparse retrieval
- SPLADE
- graph retrieval
- structured retrieval
- RRF
- reranking

The gate applies to the exact financial-fact path.

For broader research questions where an exact verified financial fact
cannot satisfy the query, preserve the existing research architecture.

============================================================
10. RUN REAL VALIDATION
============================================================

Run:

- existing unit tests
- existing integration tests
- new evidence-gate tests
- NVDA empty-corpus regression
- persistence regression
- stale/unverified regression
- conflict regression
- SEC call-count tests

Then run the actual project:

- LOOP checker
- graph lint
- gate guard

if they exist.

Do not weaken tests.

Do not delete failing tests.

Do not change assertions simply to obtain PASS.

============================================================
11. CREATE AN AUDITABLE REPORT
============================================================

Create or update:

    SEC_EVIDENCE_GATE_AUDIT.md

Include exact:

1. Gate implementation file
2. Gate function
3. Orchestrator integration point
4. Evidence model used
5. Verification conditions
6. Test file names
7. Test names
8. SEC call-count results
9. NVDA empty-corpus result
10. Persistence result
11. Unverified-local result
12. Conflict result
13. LOOP results
14. Graph-lint result
15. Gate-guard result

For every claim distinguish:

    VERIFIED
    FAILED
    BLOCKED
    NOT TESTED

Do not claim anything that was not actually executed.

============================================================
12. FINAL RESPONSE TO ME
============================================================

After completing the work, report:

A. Exact implementation path

Example:

    services/.../verified_evidence_gate.py
    function: check_verified_local_evidence()

B. Exact orchestrator integration

Example:

    services/.../orchestrator.py
    function: ...

C. Exact tests

Example:

    tests/.../test_verified_evidence_gate.py

D. Actual results:

    VERIFIED LOCAL:
        EDGAR calls = ?

    EMPTY LOCAL:
        EDGAR calls = ?

    SECOND QUERY:
        EDGAR calls = ?

    UNVERIFIED:
        EDGAR calls = ?

    CONFLICT:
        EDGAR calls = ?

E. Git commit SHA containing the implementation.

F. Git branch containing the implementation.

G. GitHub-visible files containing the implementation.

IMPORTANT:

Do not simply tell me "the gate exists."

Give me the exact file, function, tests, execution results, commit SHA,
and branch so another engineer can independently audit it.

Do not declare DONE unless the actual tests prove the behavior.