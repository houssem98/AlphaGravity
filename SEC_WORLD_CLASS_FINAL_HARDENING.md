# AlphaGravity SEC — FINAL WORLD-CLASS HARDENING

Execute this against the ACTUAL AlphaGravity repository.

This is NOT a request for another architecture proposal.

The objective is to take the existing SEC implementation and make it
production-grade, independently auditable, and maximally reliable.

Do not invent capabilities.
Do not weaken tests.
Do not remove failing assertions.
Do not hide failures behind mocks.
Do not declare 10/10 unless the evidence below actually exists.

============================================================
0. SOURCE OF TRUTH
============================================================

Before changing anything:

1. Inspect the current branch and working tree.
2. Inspect the existing SEC evidence gate.
3. Inspect the real SearchPipeline integration.
4. Inspect EdgarSearch.
5. Inspect XBRL resolution.
6. Inspect canonical evidence objects.
7. Inspect citation generation.
8. Inspect persistence.
9. Inspect all existing SEC tests.
10. Inspect LOOP_SPEC / LOOP_STANDARD / LOOP_CONVENTIONS if present.
11. Inspect gate-guard / graph-lint / loop-lint.

The ACTUAL repository is authoritative.

Do not assume previous reports are correct.

Create:

SEC_FINAL_HARDENING_RECON.md

Classify findings as:

VERIFIED
PARTIAL
MISSING
BLOCKED
UNKNOWN

============================================================
1. OBJECTIVE
============================================================

The final system must provide this exact architecture:

USER QUESTION
    ↓
QUERY UNDERSTANDING
    ↓
FINANCIAL INTENT
    ↓
VERIFIED LOCAL EVIDENCE GATE
    │
    ├── VERIFIED LOCAL HIT
    │       ↓
    │     ANSWER
    │
    └── MISS / UNVERIFIED / CONFLICT
            ↓
       AUTHORITATIVE SEC
            ↓
       EXACT FILING
            ↓
        EXACT FACT
            ↓
        VERIFICATION
            ↓
       CANONICAL EVIDENCE
            ↓
       EXACT CITATION
            ↓
          ANSWER
            ↓
       ASYNC PERSISTENCE

Do NOT introduce continuous SEC ingestion as a dependency.

Do NOT require the database to contain the filing before the user
can receive an answer.

Do NOT create duplicate databases or duplicate evidence models.

Reuse the existing architecture.

============================================================
2. VERIFIED LOCAL EVIDENCE GATE
============================================================

Preserve and harden the existing gate.

Required states:

VERIFIED_LOCAL_HIT
LOCAL_MISS
LOCAL_UNVERIFIED
LOCAL_CONFLICT

A local hit may bypass SEC only when the local evidence is an exact
verified match.

Verify as appropriate:

- ticker
- CIK
- issuer
- fiscal year
- fiscal quarter
- period start
- period end
- metric
- XBRL concept
- segment/dimension
- statement scope
- unit
- fact type
- filing form
- filing date
- accession
- provenance
- verification status
- freshness/conflict state

Do not use:

- vector similarity
- arbitrary text similarity
- row existence
- cache existence

as proof of a verified financial fact.

============================================================
3. SEC INVOCATION BOUNDARY
============================================================

Separate:

A. SEC identity resolution

from:

B. SEC authoritative financial-fact acquisition.

A verified local hit MUST NOT require:

- company_tickers.json
- companyconcept
- filing index
- filing document
- XBRL instance

unless there is a genuine architectural reason.

Ideally:

VERIFIED_LOCAL_HIT
    ↓
NO SEC NETWORK REQUEST

If an identity-map cache is required for object construction,
refactor so the evidence gate does not instantiate an SEC client
unnecessarily.

Instrument the actual network boundary.

Required invariant:

VERIFIED_LOCAL_HIT
    SEC fact requests = 0
    SEC filing requests = 0
    SEC Archives requests = 0

If any SEC network request remains, explain precisely why and
eliminate it if technically possible.

============================================================
4. EXACT SEC FACT RESOLUTION
============================================================

For a missing fact, the system must deterministically resolve:

issuer
→ CIK
→ fiscal period
→ filing form
→ accession
→ filing document
→ XBRL instance
→ exact concept
→ exact dimensional context
→ exact value
→ exact unit
→ exact period

For segment facts, dimensions are mandatory.

Do NOT select a number merely because it is numerically plausible.

The system must distinguish:

- quarterly
- YTD
- annual
- consolidated
- segment
- product/geography dimension
- GAAP
- non-GAAP
- USD
- thousands
- millions
- billions

============================================================
5. EXACT CITATION PROVENANCE — TARGET 10/10
============================================================

This is mandatory.

The canonical evidence object MUST retain:

- issuer
- ticker
- CIK
- filing form
- filing date
- accession number
- fiscal year
- fiscal quarter
- period start
- period end
- XBRL concept
- dimension
- dimension value
- unit
- numeric value
- verification status
- source URL
- exact filing URL
- evidence location
- extraction method
- provenance chain

The accession number MUST NOT be lost between:

SEC client
→ evidence
→ retrieval metadata
→ answer generation
→ citation generation
→ API response
→ UI.

Fix the existing problem where the accession exists in metadata/persistence
but disappears from the citation payload.

============================================================
6. EXACT FILING URL
============================================================

Do not use only a generic EDGAR browse URL when the exact filing is known.

Construct/store the exact authoritative filing URL from the verified
accession and filing metadata.

Where possible expose:

- exact filing page
- filing document
- XBRL source/evidence
- accession number

Do not fabricate URLs.

If the exact filing URL cannot be constructed safely, retain the
authoritative SEC URL returned by the SEC resolver.

Add tests proving URL correctness.

============================================================
7. CITATION INTEGRITY TESTS
============================================================

Create tests proving:

A. accession survives SEC resolution

B. accession survives verification

C. accession survives persistence

D. accession survives retrieval

E. accession reaches citation generation

F. citation contains exact filing provenance

G. citation does not silently fall back to generic EDGAR when an
exact filing is known

H. citation value matches the verified evidence value

I. citation period matches the question

J. citation dimension matches the question

K. citation unit matches the answer

L. citation issuer matches the answer

The following must be impossible:

CORRECT VALUE
+
WRONG FILING

or:

CORRECT FILING
+
WRONG PERIOD

or:

CORRECT PERIOD
+
WRONG SEGMENT

============================================================
8. LIVE SEC AUTHORITY VALIDATION — TARGET 10/10
============================================================

Add a dedicated LIVE SEC smoke/integration test suite.

Do NOT replace deterministic fixtures.

Keep fixture tests for CI.

Create a clearly isolated live test, for example:

tests/live/test_sec_authority.py

or the appropriate existing project structure.

The live test must hit the real SEC infrastructure.

Do not mock the SEC HTTP boundary in this test.

Use the real:

- EdgarSearch
- SEC resolver
- XBRL resolution
- filing resolution
- evidence verification

subject to SEC rate limits and project policies.

============================================================
9. LIVE NVIDIA GOLDEN TEST
============================================================

Use this real question:

"What was NVIDIA's Data Center revenue in Q3 FY2026?"

The live test must prove:

NVIDIA
→ CIK
→ FY2026
→ Q3
→ correct filing
→ correct accession
→ correct dimensional XBRL fact
→ correct value
→ correct unit
→ correct segment
→ verification
→ exact citation

Expected verified value:

51,215,000,000 USD

Do NOT hardcode this value into the implementation.

The test may assert it after obtaining it independently from the
authoritative SEC source.

The test must fail if the resolver returns:

- wrong quarter
- YTD number
- consolidated revenue
- wrong segment
- wrong filing
- wrong unit
- wrong accession

============================================================
10. LIVE SEC NEGATIVE TESTS
============================================================

Where practical, add live validation for:

- wrong fiscal year
- wrong quarter
- annual vs quarterly
- quarterly vs YTD
- consolidated vs segment
- wrong metric
- missing metric
- amended filing
- conflicting filing metadata

If a live negative test is unsafe or unstable because of SEC behavior,
keep it fixture-based and explicitly document why.

Do not pretend live coverage exists when it does not.

============================================================
11. SEC RATE-LIMIT SAFETY
============================================================

The live test suite must:

- use an explicit User-Agent if required
- avoid aggressive polling
- cache reusable identity metadata
- avoid unnecessary repeated requests
- never implement continuous polling as part of this feature
- avoid parallel request storms

Document the live-test request budget.

Do not solve performance by violating SEC access requirements.

============================================================
12. LIVE VS FIXTURE SEPARATION
============================================================

Clearly distinguish:

DETERMINISTIC CI:

    pytest

LIVE AUTHORITY:

    explicit live SEC test command

Do not make normal CI depend on live SEC availability.

The report must separately show:

fixture results
live SEC results

============================================================
13. FULL SEARCHPIPELINE E2E
============================================================

Preserve the real SearchPipeline tests.

Required scenarios:

1. verified local hit
2. empty local corpus
3. second identical query
4. unverified local
5. stale local
6. conflicting local

Use real:

SearchPipeline
RetrievalOrchestrator
EdgarSearch

Mock ONLY external boundaries that genuinely need isolation.

The gate itself must not be mocked.

============================================================
14. EMPTY-CORPUS REGRESSION
============================================================

Start with no relevant local evidence.

Run:

"What was NVIDIA's Data Center revenue in Q3 FY2026?"

Expected:

LOCAL_MISS
→ SEC
→ exact fact
→ verification
→ citation
→ answer
→ persistence

Then immediately repeat the same query.

Expected:

VERIFIED_LOCAL_HIT
→ SEC fact requests = 0
→ local answer

This must remain a permanent regression test.

============================================================
15. STALE / CONFLICT SAFETY
============================================================

Test:

LOCAL_UNVERIFIED
→ SEC

LOCAL_CONFLICT
→ SEC

An incorrect local record must NEVER silently override authoritative
SEC evidence.

Do not solve this by simply deleting the local record.

============================================================
16. PERSISTENCE
============================================================

The persisted evidence must retain the complete provenance chain.

At minimum:

- value
- metric
- period
- dimensions
- unit
- accession
- filing
- source
- verification state
- evidence location

Then retrieve the persisted fact and verify that no provenance is lost.

Add a round-trip persistence test.

============================================================
17. ON-DEMAND INGESTION ISOLATION
============================================================

A missing structured financial fact must NOT unexpectedly fall into
the generic document ingestion pipeline.

Verify:

local miss
→ SEC authoritative fact resolution
→ answer

NOT:

local miss
→ download filing
→ embedding API
→ generic ingestion
→ crash

If generic ingestion remains useful elsewhere, preserve it, but do not
make it an accidental dependency of exact financial-fact resolution.

Add a regression test.

============================================================
18. OBSERVABILITY
============================================================

Expose:

local_evidence_status
sec_invoked
sec_fact_requests
sec_filing_requests
sec_skip_reason
source_accession
source_filing_url
verification_status

Ensure telemetry distinguishes:

identity requests
from
authoritative fact requests.

============================================================
19. ERROR HANDLING
============================================================

Test:

- SEC unavailable
- timeout
- malformed XBRL
- missing dimension
- missing concept
- conflicting facts
- invalid period
- invalid unit
- filing unavailable

The system must fail truthfully.

Never fabricate a financial value because SEC retrieval failed.

============================================================
20. SECURITY
============================================================

Review the new code for:

- secrets
- unsafe URL construction
- SSRF possibilities
- arbitrary external URL fetching
- untrusted accession handling
- logging of credentials
- unsafe persistence

Do not weaken security for citation convenience.

============================================================
21. PERFORMANCE
============================================================

Measure:

VERIFIED LOCAL HIT:
    SEC fact requests = 0

LOCAL MISS:
    SEC requests required = measured

SECOND QUERY:
    SEC fact requests = 0

Do not claim latency improvements without measurements.

Do not optimize away authoritative verification.

============================================================
22. TEST ALL EXISTING INFRASTRUCTURE
============================================================

Run:

pytest

gate-guard

graph-lint

loop-lint

governance

existing SEC tests

existing evidence-gate tests

existing search-pipeline tests

new live SEC smoke tests

new citation tests

new persistence tests

Do not modify unrelated failures.

Clearly distinguish:

new failure
pre-existing failure
environmental blocker

============================================================
23. DEPLOYMENT
============================================================

Do NOT claim production-ready deployment if deployment is blocked.

If Fly remains blocked by billing/account state:

mark:

DEPLOYMENT = BLOCKED

Do not attempt to bypass billing restrictions.

Verify the branch and commit containing the implementation.

Do not merge to main automatically unless explicitly instructed.

============================================================
24. WORLD-CLASS ACCEPTANCE CRITERIA
============================================================

Do NOT declare 10/10 merely because tests pass.

The implementation can only be called:

WORLD-CLASS CANDIDATE

if all of these are true:

[ ] Verified local hit bypasses SEC fact/filling requests
[ ] Local miss invokes SEC
[ ] Second query uses persisted verified evidence
[ ] Unverified evidence invokes SEC
[ ] Conflicting evidence invokes SEC
[ ] Exact XBRL dimensional fact is resolved
[ ] Fiscal period is verified
[ ] Unit is verified
[ ] Filing/accession is verified
[ ] Canonical evidence retains full provenance
[ ] Accession reaches user-facing citation
[ ] Exact filing URL reaches user-facing citation
[ ] Citation value matches verified value
[ ] Citation period matches query
[ ] Citation dimension matches query
[ ] Citation unit matches query
[ ] Empty-corpus regression passes
[ ] Real SearchPipeline E2E passes
[ ] Live SEC NVIDIA smoke test passes
[ ] Live SEC failures are handled truthfully
[ ] No accidental generic-ingestion dependency
[ ] SEC rate limits are respected
[ ] Security review passes
[ ] LOOP gates pass
[ ] graph-lint passes
[ ] governance passes
[ ] all relevant tests pass

If any item is not proven:

DO NOT call it 10/10.

============================================================
25. FINAL AUDIT REPORT
============================================================

Create:

SEC_WORLD_CLASS_FINAL_AUDIT.md

Include:

1. Executive verdict
2. Architecture
3. Evidence gate
4. SEC resolver
5. XBRL resolver
6. Verification
7. Citation provenance
8. Live SEC validation
9. Persistence
10. SearchPipeline E2E
11. Security
12. Performance
13. Test results
14. LOOP results
15. Deployment status

For every requirement:

STATUS:
VERIFIED / FAILED / BLOCKED / NOT TESTED

Include:

- exact file
- exact function
- exact test
- exact command
- actual result
- commit SHA
- branch

============================================================
26. ABSOLUTE HONESTY RULE
============================================================

Do not say:

"world-class"

because the architecture looks sophisticated.

Do not say:

"10/10"

because pytest passes.

Do not convert:

NOT TESTED

into:

PASS.

Do not convert:

BLOCKED

into:

PASS.

Do not hide:

KNOWN LIMITATION.

If something cannot be proven, say so.

============================================================
27. FINAL OUTPUT
============================================================

After execution, report:

IMPLEMENTED:
...

VERIFIED:
...

FAILED:
...

BLOCKED:
...

NOT TESTED:
...

LIVE SEC RESULT:
...

CITATION RESULT:
...

SEARCHPIPELINE E2E RESULT:
...

TEST TOTAL:
...

LOOP RESULT:
...

GRAPH RESULT:
...

GOVERNANCE RESULT:
...

COMMIT:
...

BRANCH:
...

Do not provide a generic summary.

Provide evidence.