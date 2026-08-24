DO NOT implement the naïve "local row exists → skip SEC" gate.

Your diagnosis is correct: the current implementation is missing the required local-hit/local-miss control flow.

Fix it, but implement a VERIFIED EVIDENCE GATE, not a simple existence check.

Required architecture:

QUESTION
  ↓
QUERY UNDERSTANDING
  ↓
FINANCIAL INTENT
  ↓
VERIFIED LOCAL EVIDENCE GATE
  │
  ├── VERIFIED + FRESH + EXACT MATCH
  │       ↓
  │     ANSWER
  │
  └── NO VERIFIED MATCH
          ↓
        SEC
          ↓
     EXACT FILING
          ↓
      EXACT FACT
          ↓
      VERIFICATION
          ↓
       EVIDENCE
          ↓
       PERSIST
          ↓
        ANSWER

==================================================

A LOCAL RECORD MAY BYPASS SEC ONLY IF ALL REQUIRED
IDENTITY AND VERIFICATION CONDITIONS PASS.

The local evidence must match:

- issuer/ticker
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
- filing/form where relevant
- accession number/provenance
- verification status

The local evidence must also have a valid verification state.

Do NOT treat:

- vector similarity
- text match
- cached answer
- unverified structured row
- stale fact
- partial match

as sufficient for the local-hit branch.

==================================================

IMPORTANT DISTINCTION

Implement three states:

1. VERIFIED_LOCAL_HIT

Exact verified evidence exists.

→ Do NOT call SEC.
→ Answer from local evidence.

2. LOCAL_MISS_OR_UNVERIFIED

No exact verified evidence exists.

→ Call SEC.
→ Resolve exact filing.
→ Extract fact.
→ Verify.
→ Persist.

3. LOCAL_CONFLICT

Local evidence exists but conflicts with authoritative evidence,
is stale, has incompatible provenance, or fails verification.

→ DO NOT silently answer from local.
→ Call SEC.
→ Resolve authoritative evidence.
→ Compare.
→ Record conflict.
→ Answer only from verified evidence.

==================================================

SEC SHOULD NOT BE CALLED ON A VERIFIED LOCAL HIT.

Add an explicit test proving:

channel calls:

{
  structured: 1,
  edgar: 0
}

for a verified local fact.

==================================================

EMPTY-CORPUS TEST

Delete/remove the relevant local evidence for:

NVDA
Q3 FY2026
Data Center revenue

Then execute the real user query.

Expected:

structured = 1
edgar = 1

and the system must:

SEC
→ exact filing
→ exact XBRL fact
→ verification
→ citation
→ answer
→ persistence

==================================================

SECOND QUERY TEST

Run the exact same query again.

Expected:

structured = 1
edgar = 0

because the verified evidence now exists locally.

This is a REQUIRED end-to-end regression.

==================================================

STALE LOCAL TEST

Create a local record with:

correct ticker
correct metric
correct period

but:

- stale provenance
- failed verification
- wrong accession
- wrong dimension
- wrong unit
- or conflicting filing

Expected:

local record does NOT bypass SEC.

==================================================

DO NOT USE RRF TO DECIDE WHETHER SEC IS NECESSARY.

RRF is a retrieval/fusion mechanism.

The SEC invocation decision must happen BEFORE expensive
authoritative-source retrieval.

The control flow must therefore explicitly represent:

verified_local_evidence?

not merely:

structured_results.length > 0

==================================================

OBSERVABILITY

Add explicit routing telemetry:

local_evidence_status =
    VERIFIED_LOCAL_HIT
    LOCAL_MISS
    LOCAL_UNVERIFIED
    LOCAL_CONFLICT

sec_invoked =
    true / false

sec_skip_reason =
    VERIFIED_LOCAL_HIT / null

This must be visible in tests/logging without exposing secrets.

==================================================

PERFORMANCE REGRESSION

Measure before and after.

The current implementation reportedly calls SEC even when
the fact is already locally verified.

After this change, prove:

verified local hit:
    SEC calls = 0

local miss:
    SEC calls = 1

local conflict:
    SEC calls = 1

Do not claim performance improvement without measured results.

==================================================

IMPORTANT

Do not weaken existing verification.

Do not delete the existing parallel retrieval system globally.

Only change the financial-fact routing path where an authoritative
verified local fact can deterministically satisfy the query.

Preserve the existing broader retrieval architecture for questions
where this exact financial-fact gate does not apply.

==================================================

After implementation:

1. Run existing tests.
2. Run new routing tests.
3. Run empty-corpus NVDA regression.
4. Run second-query persistence regression.
5. Run stale/conflict regression.
6. Verify SEC call counts.
7. Run LOOP checker.
8. Run graph lint.
9. Run gate guard.
10. Update SEC_FIX_IMPLEMENTATION_REPORT.md.

Do not declare DONE unless all of the above pass.

Report exactly:

VERIFIED:
...

FAILED:
...

BLOCKED:
...

NOT TESTED:
...

Do not invent results.