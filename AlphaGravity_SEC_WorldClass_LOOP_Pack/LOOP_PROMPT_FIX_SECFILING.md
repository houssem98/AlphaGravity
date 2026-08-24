# LOOP_PROMPT_FIX_SECFILING.md

# Claude Code Execution Prompt — AlphaGravity SEC World-Class Upgrade

You are the implementation agent operating inside the **AlphaGravity** repository.

Your job is to execute the `FIX_SECFILING.md` roadmap using the project's existing LOOP/graph governance.

## NON-NEGOTIABLE RULE

Do not treat "no indexed document" as "source unavailable."

The specific failure to eliminate is:

```text
User asks:
What was NVIDIA's data center revenue in Q3 FY2026?

Current failure:
No indexed documents found.

Required behavior:
Resolve NVIDIA → fiscal Q3 FY2026 → exact SEC filing →
acquire authoritative evidence → extract/verify fact →
answer with exact citation → persist asynchronously.
```

---

# 1. Before changing code

Inspect the repository first.

You MUST inspect:

```text
CLAUDE.md
ARCHITECTURE_ROADMAP.md
ROADMAP.md
Deep_Research_Platform_Competitive_Benchmark_and_Upgrade_Plan.md
Financial_AI_Benchmark_Specification.md
services/gravity-api/
services/...
SEC ingestion implementation
financial database schema
structured retrieval
search pipeline
retrieval orchestrator
citation/evidence models
tests
```

Also search for the project's actual LOOP files:

```text
LOOP_SPEC.md
LOOP_STANDARD.md
LOOP_CONVENTIONS.md
gate-guard.mjs
graph-lint.mjs
```

If they exist locally, READ THEM before implementation.

Do not invent their contents.

They are project-level governance and must be obeyed.

---

# 2. First deliverable: reconnaissance

Before writing implementation code, produce:

```text
SEC_FIX_RECON.md
```

containing:

1. current SEC data flow
2. current database schema relevant to filings/facts
3. current ticker/CIK resolution
4. current filing retrieval
5. current XBRL handling
6. current parser
7. current structured retrieval
8. current citation model
9. current tests
10. exact insertion points for the new query-time resolver
11. duplicated code that should be reused rather than copied
12. risks and unknowns

Do not modify architecture before this inventory exists.

---

# 3. Core architecture to implement

Implement:

```text
Query
  ↓
Question Classification
  ↓
Entity Resolution
  ↓
Period Resolution
  ↓
Local Evidence Check
  ↓
if local evidence exists:
    existing retrieval path
else:
    authoritative source resolver
        ↓
    SEC filing resolver
        ↓
    SEC acquisition
        ↓
    XBRL / table-aware extraction
        ↓
    canonical evidence
        ↓
    verification
  ↓
Evidence Fusion
  ↓
Existing answer/citation pipeline
  ↓
Async persistence
```

Do NOT replace the existing AlphaGravity retrieval system.

Add a clean source-acquisition layer that integrates with it.

---

# 4. Reuse existing code

Before creating a new SEC client:

```text
grep/search for:
- EDGAR
- SEC
- CIK
- accession
- edgartools
- XBRL
- filing
- financial_fact
- structured search
- evidence
- citation
```

The current repository already contains SEC fetching capabilities.

Reuse them.

If you need to refactor the existing SEC source into a reusable service, do that rather than duplicating HTTP/API logic.

---

# 5. Implement the source resolver

Create a clean interface similar to:

```python
class AuthoritativeSourceResolver:
    async def resolve(self, query: FinancialQuery) -> SourceResolution:
        ...
```

SEC-specific implementation:

```python
class SECSourceResolver(AuthoritativeSourceResolver):
    async def resolve(self, query: FinancialQuery) -> SourceResolution:
        ...
```

The result must contain:

```text
issuer
ticker
CIK
fiscal year
fiscal quarter
period start
period end
form
filing date
accession
document URL
resolution confidence
```

Do not expose vague "best match" semantics for exact financial facts.

---

# 6. Exact fiscal-period resolution

Never derive fiscal quarter from calendar quarter.

The resolver must establish the issuer's actual fiscal period.

For NVIDIA Q3 FY2026, the system must resolve the actual filing period from SEC filing metadata.

Create deterministic fixtures for issuers with:

```text
calendar fiscal year
non-calendar fiscal year
52-week year
53-week year
```

---

# 7. Filing selection

Implement deterministic ranking:

```text
exact issuer
+
exact fiscal period
+
correct form
+
latest authoritative version
+
valid filing metadata
```

Support:

```text
10-Q
10-Q/A
10-K
10-K/A
8-K
```

Do not silently select an older filing when an amended authoritative version supersedes it.

---

# 8. Exact financial fact path

For:

```text
"What was NVIDIA's Data Center revenue in Q3 FY2026?"
```

the path must be:

```text
financial fact query
        ↓
structured resolver
        ↓
SEC/XBRL
        ↓
table evidence
        ↓
numeric verification
```

Do NOT ask a general-purpose LLM:

> "Read this filing and tell me the number."

The model can interpret evidence, but exact financial values must have a deterministic/structured extraction path whenever possible.

---

# 9. Canonical evidence

Create or reuse the existing evidence schema.

Minimum fields:

```text
evidence_id
source_type
issuer
ticker
CIK
filing_type
filing_date
period_start
period_end
fiscal_year
fiscal_quarter
accession_number
document_url
section_path
table_id
row_label
column_label
value
unit
text_span
xbrl_concept
retrieved_at
parser_version
verification_status
```

Every final financial number must be traceable to this object.

---

# 10. Numeric verification

The verifier must catch:

```text
51.215B
51,215M
51,215
$51.215 billion
```

as equivalent where appropriate.

It must reject:

```text
51.2%
$51.215 million
$51.215 billion YTD
$51.215 billion annual
```

when the requested fact is quarterly revenue.

Test unit normalization explicitly.

---

# 11. Query router

Introduce routing without breaking existing retrieval.

Pseudo-policy:

```python
if query.classification == EXACT_FINANCIAL_FACT:
    return financial_fact_path(query)

if query.classification == FINANCIAL_TABLE:
    return financial_table_path(query)

if query.classification == FILING_QUALITATIVE:
    return filing_retrieval_path(query)

return existing_general_research_path(query)
```

For exact financial facts:

```python
local = search_local_financial_facts(query)

if local.has_verified_evidence:
    return local

primary = sec_resolver.resolve(query)

if primary.success:
    evidence = sec_resolver.acquire(primary)
    verified = verify(evidence)
    persist_async(verified)
    return verified

return truthful_source_failure()
```

---

# 12. Empty-corpus regression

Create a test that intentionally removes all local evidence for:

```text
NVDA Q3 FY2026
Data Center revenue
```

Then run the complete user query.

Expected:

```text
HTTP success
source = SEC
filing = exact Q3 FY2026 10-Q
fact = exact Data Center revenue
verification = pass
citation = exact evidence
```

This is the most important regression test in the entire task.

---

# 13. Persistence

After a successful query:

```text
response should not wait for full indexing
```

Persist asynchronously:

```text
filing metadata
normalized fact
evidence span
source provenance
parser version
verification status
```

The next identical question should be able to use local evidence.

Test:

```text
Query 1:
SEC acquisition

Query 2:
local retrieval
```

---

# 14. User-facing behavior

Remove or bypass the terminal state:

```text
No indexed documents found.
To get answers, ingest relevant SEC filings first.
```

Replace with internal progress states:

```text
Analyzing question
Resolving NVIDIA
Resolving fiscal period
Searching primary source
Reading SEC filing
Verifying financial fact
Preparing answer
```

If SEC is unavailable:

```text
Primary SEC source could not be reached.
```

If the filing exists but does not contain the requested fact:

```text
The SEC filing was found, but the requested fact could not be verified from it.
```

Never fabricate a number.

---

# 15. Tests

Add tests for:

### Exact facts

```text
NVDA Q3 FY2026 Data Center revenue
NVDA Q3 FY2025 Data Center revenue
TSLA FY2025 revenue
AAPL FY2025 revenue
MSFT FY2025 revenue
AMZN FY2025 revenue
```

### Semantic traps

```text
revenue vs operating income
quarter vs YTD
segment vs consolidated
GAAP vs non-GAAP
growth rate vs absolute value
millions vs billions
```

### Period traps

```text
fiscal vs calendar
52-week fiscal year
53-week fiscal year
amended filing
comparative prior period
```

### Failure tests

```text
unknown ticker
unknown fiscal period
missing metric
SEC timeout
malformed filing
conflicting filings
empty corpus
```

---

# 16. Evaluation

Integrate with the existing AlphaGravity evaluation framework.

Report:

```text
source_resolution_accuracy
answer_accuracy
numeric_accuracy
citation_precision
citation_recall
span_recall_at_5
adversarial_citation_rate
latency_p50
latency_p95
cost_per_query
tool_calls
```

Do not invent benchmark numbers.

Do not write "world-class" in code/comments/docs unless backed by measured results.

---

# 17. LOOP execution discipline

At every iteration:

1. Read current LOOP state.
2. Read the target node.
3. Inspect actual repository state.
4. Implement the smallest coherent increment.
5. Run targeted tests.
6. Run relevant broader tests.
7. Record evidence.
8. Do not grade your own work as final.
9. Hand the increment to the independent checker.
10. Update durable memory with only verified facts.

Never:

```text
- delete failing tests
- weaken assertions to pass
- fabricate benchmark results
- mark incomplete work as done
- silently change acceptance criteria
- add unrelated features
- rewrite working retrieval infrastructure without evidence
```

---

# 18. Graph execution order

Execute nodes in this order:

```text
G0 → G1 → G2
          ↓
      G3 + G4 + G5
          ↓
         G6
          ↓
         G7
          ↓
         G8
          ↓
         G9
          ↓
        G10
          ↓
        G11
          ↓
        G12
          ↓
        G13
          ↓
        G14
          ↓
        G15
```

Parallelize only independent nodes.

Do not parallelize database migrations and code that depends on their schema before the migration contract is verified.

---

# 19. Gate policy

The implementation is NOT DONE if:

```text
source resolution works only when the filing is pre-indexed
```

The implementation is NOT DONE if:

```text
LLM can invent the financial value
```

The implementation is NOT DONE if:

```text
citation points to the filing generally but not to the evidence
```

The implementation is NOT DONE if:

```text
empty-corpus regression fails
```

The implementation is NOT DONE if:

```text
SEC failure causes generic 500
```

The implementation is NOT DONE if:

```text
the system requires continuous SEC ingestion for the interactive path
```

The implementation is NOT DONE if:

```text
the benchmark/evaluation evidence is missing
```

---

# 20. Stop conditions

STOP and report `BLOCKED` if:

- a required external credential is unavailable;
- the repository's actual LOOP contract conflicts with this prompt;
- an existing schema cannot safely support the proposed evidence model without a migration decision;
- SEC access cannot be tested and no fixture-based substitute exists;
- a proposed change requires architectural expansion not justified by evidence.

Do not work around a block by guessing.

---

# 21. Final report

At completion, produce:

```text
SEC_FIX_IMPLEMENTATION_REPORT.md
```

with:

1. files changed
2. architecture changes
3. reused components
4. new components
5. database migrations
6. tests added
7. tests passed
8. exact NVIDIA regression result
9. empty-corpus regression result
10. benchmark metrics
11. known limitations
12. remaining debt
13. evidence supporting every completion claim

Then invoke the project's independent checker and gate guard.

Only the project's real gate mechanism may declare the loop DONE.

---

# Final instruction

**Do not optimize for writing the most code.**

Optimize for this measurable property:

> **AlphaGravity can answer supported financial-fact questions from authoritative primary sources even when those sources were not previously indexed, with deterministic source identity, verified numeric values, exact evidence citations, truthful failure states, and asynchronous persistence.**

Everything else is secondary.
