# AlphaGravity — Quick Answer Ruthless Fix Roadmap
## SEC Direct Filing Viewer + Universal Skills + Accuracy + Performance

## Objective

Make Quick Answer correct for arbitrary resolvable public companies, preserve evidence/verification, and make SEC citations open the exact filing document rather than an EDGAR landing page.

## Definition of Done

Quick Answer is not complete merely because unit tests are green. It is complete only when:

1. SEC citations have canonical filing identity.
2. **View filing** opens the exact primary SEC HTML.
3. **Filing details** opens the SEC `-index.htm` page.
4. Company and Sentiment do not depend on a small company allowlist.
5. A previously unseen but resolvable company can execute the appropriate skill.
6. Entity ambiguity is detected rather than guessed.
7. Missing data is reported as missing.
8. Wrong-period evidence cannot become verified.
9. Invalid citations cannot become verified.
10. Verification cannot be overwritten by later provenance transforms.
11. Future/unreported periods deterministically abstain.
12. Multi-company and multi-period requests work where supported.
13. Real-pipeline/browser behavior is proven where credentials permit.
14. Performance is measured honestly.
15. No tests are weakened/deleted merely to obtain green results.

If a required correctness gate is PARTIAL, BLOCKED, or UNVERIFIED, report it as such.

---

# Phase 0 — Baseline and audit

Before editing:

- inspect `git status` and current diff;
- identify pre-existing changes;
- read current Quick Answer closure/evaluation docs;
- run current relevant tests;
- record exact baseline numbers.

Create/update:

`docs/quick-answer/BASELINE_FIX_PASS.md`

Record commit, backend/frontend tests, typecheck, build, Quick Answer eval, live E2E, performance, browser state, and known failures.

Do not use an old report as current proof.

---

# Phase 1 — Canonical SEC filing identity

The product must distinguish:

**View filing** → actual primary filing HTML.

**Filing details** → SEC filing-detail/index page.

Canonical provenance should preserve, when available:

```text
cik
accession
accession_nodash
form_type
filing_date
period_of_report
primary_document
primary_document_url
filing_index_url
```

Never infer the primary document from ticker, company name, first `.htm`, or arbitrary string manipulation.

---

# Phase 2 — SEC URL resolver

Implement/reuse one authoritative resolver:

```text
source metadata
→ validate CIK/accession
→ resolve filing metadata
→ identify primary document
→ construct direct URL
→ validate identity
→ return primary URL + index URL + document name
```

Cases:

- direct primary URL exists → validate and preserve it;
- only filing identity exists → resolve from authoritative metadata;
- only index URL exists → extract/validate CIK + accession and resolve;
- primary cannot be safely determined → do not guess; return unresolved primary plus valid filing-details URL.

The frontend must consume this contract rather than construct SEC URLs itself.

---

# Phase 3 — SEC UI

Replace ambiguous `View on SEC EDGAR` with:

```text
View filing
View filing details
```

Only show **View filing** when a validated primary-document URL exists.

Example:

```text
SEC Filing
10-K · FY2026
Filed Feb 25, 2026

[View filing] [Filing details]
```

---

# Phase 4 — SEC regression matrix

Test at least:

- NVIDIA;
- Apple;
- Tesla;
- Microsoft;
- 3+ additional issuers from different sectors.

Forms:

- 10-K;
- 10-Q;
- 8-K where applicable;
- DEF 14A/proxy where applicable.

Layouts:

- company-specific primary filename;
- generic primary filename;
- multiple HTML documents;
- exhibits;
- inline XBRL;
- missing/unresolvable primary.

Negative cases:

- malformed accession;
- wrong CIK;
- wrong accession;
- unrelated exhibit;
- index URL as source;
- legacy source with no primary URL.

Assertions:

```text
View filing URL != Filing details URL
primary URL belongs to same CIK/accession
primary URL is not an exhibit unless metadata identifies it as primary
```

---

# Phase 5 — Inventory every Quick Answer skill

Inspect the repository, not only the UI.

Find:

- skill registry;
- skill router;
- intent classifier;
- Company;
- Sentiment;
- financial skills;
- comparison skills;
- filing skills;
- retrieval adapters;
- evidence builders;
- verification;
- frontend skill cards;
- skill fixtures;
- company/ticker allowlists.

Search for patterns such as:

```text
ticker in
company in
SUPPORTED_COMPANIES
SUPPORTED_TICKERS
if ticker ==
if company ==
NVDA
AAPL
TSLA
```

Classify every hit as either a legitimate domain rule or accidental company limitation. Remove accidental limitations.

Create/update:

`docs/quick-answer/SKILL_COVERAGE_MATRIX.md`

For each skill record inputs, required data, entity/period support, output, evidence, verification, limitations, and tests.

---

# Phase 6 — Canonical entity resolution

Use one entity system for all skills.

Required states:

```text
RESOLVED
AMBIGUOUS
UNKNOWN
```

Fuzzy matching must not silently resolve a materially ambiguous entity.

Where available, entity identity should support:

```text
company_id
legal_name
display_name
ticker(s)
exchange(s)
CIK
aliases
former_names
country
fiscal_year_end
```

Test ticker, company name, legal name, alias, exchange+ticker, former name, ambiguity, unknown company, and multi-company input.

---

# Phase 7 — Universal skill contract

All Quick Answer skills should consume a shared contract:

```text
SkillRequest
  skill
  entities
  period
  filters
  output_mode

SkillCapability
  skill
  entity_status
  data_available
  source_count
  freshness
  executable
  limitations

SkillResult
  status
  entities
  period
  claims
  data
  citations
  verification
  limitations
```

Statuses:

```text
success
partial
insufficient_data
ambiguous_entity
unsupported_operation
conflicting_evidence
error
```

Do not turn missing data into `unsupported company`.

---

# Phase 8 — Universal Company skill

Company must operate from canonical entity identity and available evidence, not a company list.

Support when reported:

- identity: name, ticker, exchange, CIK, sector/industry;
- business: description, segments, products/markets;
- financials: revenue, growth, gross profit/margin, operating income/margin, net income, EPS, cash, debt, FCF where available;
- trends: YoY, QoQ, multi-year;
- filings: latest 10-K, 10-Q, relevant 8-K.

Every material claim needs provenance.

Missing metric must be explicitly missing; never silently return zero.

---

# Phase 9 — Universal Sentiment skill

Sentiment must be generic, evidence-driven, and time-window-aware.

Minimum output:

```text
overall sentiment
positive evidence
negative evidence
neutral evidence
trend/change
source mix
time window
verification
limitations
```

Where possible separate:

- management/earnings-call tone;
- SEC filing language;
- news;
- analyst/research sources;
- market-derived sentiment.

Do not silently equate price movement with sentiment.

If evidence is insufficient → `insufficient evidence`.

If sources conflict → `conflicting evidence`.

---

# Phase 10 — Multi-company and multi-period

Support multi-company and multi-period requests where logically applicable.

Test latest, fiscal year, quarter, explicit dates, relative windows, and multiple fiscal years.

The requested period must remain attached to evidence and claims throughout the pipeline.

---

# Phase 11 — Verification hardening

Maintain this invariant:

```text
verified = exact claim supported by exact cited evidence
```

Test nonexistent citation index, wrong source, wrong company, wrong period, wrong number, correct number from wrong period, and correct number from wrong source.

Once a verdict is calculated, later normalization/provenance stages must not silently overwrite it. If evidence identity changes, revalidate.

---

# Phase 12 — Future-period abstention

Fix the known inconsistency where future/unreported periods sometimes abstain and sometimes answer confidently.

Eligibility must be deterministic from requested period + fiscal calendar + known filing periods + evidence period.

Unreported future periods must return an insufficient/not-reported state rather than a generated confident answer.

Add repeated-run tests for determinism.

---

# Phase 13 — Channel failure semantics

Provider failure must not look like successful empty retrieval.

Preserve:

```text
success
empty
failed
timeout
unavailable
```

Ensure downstream capability logic can distinguish no evidence from failed evidence retrieval.

---

# Phase 14 — Performance

Re-measure the current implementation. Break down:

```text
entity resolution
retrieval
SEC fetch/ingestion
embedding
rerank
generation
verification
total
```

Separate fast-path Quick Answer from expensive ingestion/deep retrieval where possible.

Do not remove verification for speed. Report actual p50/p95.

---

# Phase 15 — Real skill evaluation

Create:

`eval/quick_answer_skill_coverage/`

Use multiple issuers and sectors. Test each skill with happy path, unseen company, ticker, legal name, ambiguity, multi-company, annual, quarterly, future period, missing metric, conflicting evidence, citation correctness, and abstention.

Track:

```text
entity accuracy
intent accuracy
period accuracy
answer accuracy
citation validity
citation support
unsupported claim rate
false-confidence rate
abstention accuracy
coverage
latency
```

Fixture-only success does not prove universal support.

---

# Phase 16 — Browser verification

When environment permits, verify:

1. Quick Answer search;
2. Company;
3. Sentiment;
4. SEC citation;
5. View filing;
6. Filing details;
7. multi-company;
8. missing data;
9. future period;
10. history replay.

For SEC visually confirm:

```text
View filing → actual filing HTML
Filing details → EDGAR filing index
```

If authentication blocks it, report BLOCKED; never fake it.

---

# Phase 17 — Adversarial pass

Attack SEC, entity resolution, Company, Sentiment, time handling, and verification with wrong source, wrong entity, wrong period, wrong accession, missing data, conflicting data, fabricated citation, and invalid citation index.

Every result must be truthful.

---

# Final verification

Create/update:

`docs/quick-answer/FINAL_FIX_VERIFICATION.md`

Report for every gate:

```text
PASS
PARTIAL
BLOCKED
UNVERIFIED
```

Include exact commands, counts, exit codes, relevant evidence, and limitations for:

- backend tests;
- frontend tests;
- typecheck;
- build;
- Quick Answer eval;
- skill coverage eval;
- SEC resolver tests;
- entity tests;
- verification tests;
- future-period tests;
- channel-failure tests;
- live E2E;
- browser;
- performance;
- git status.

Do not call the project complete while required gates remain unresolved.

## Final acceptance question

Give Quick Answer a company that was not in a hard-coded test alias list. Ask Company and Sentiment questions over valid periods. Require citations. Click the SEC citation. Does it resolve to the exact filing document? If evidence does not exist, does the system clearly say so instead of inventing an answer?

If not, continue fixing.
