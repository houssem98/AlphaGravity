Read and execute `QUICK_ANSWER_RUTHLESS_FIX_ROADMAP.md`.

THIS IS AN EXECUTION TASK, NOT A REVIEW.

Work directly in the current AlphaGravity repository.

1. Inspect the current repository and working tree.
2. Read the entire roadmap.
3. Run a real baseline.
4. Implement every required fix.
5. Add real regression/integration/E2E tests.
6. Run tests.
7. Fix every failure.
8. Re-run all affected tests.
9. Continue until every executable gate is PASS.
10. Never weaken, delete, skip, or loosen a test to obtain green results.

CRITICAL SEC FIX

`View filing` MUST open the exact primary SEC filing HTML.
`Filing details` MUST open the SEC filing-detail/index page.

Do not let the frontend construct SEC URLs from ticker/company data.

Use a canonical SEC provenance object containing CIK, accession, form, filing date, period, primary document, primary URL, and filing-index URL.

Resolve the primary document from authoritative filing metadata. NEVER guess the primary filename.

If the primary document cannot be safely resolved, do not invent a URL. Hide/disable `View filing` and provide only clearly labeled `Filing details`.

Test NVIDIA AND multiple other issuers and multiple SEC form types.

UNIVERSAL QUICK ANSWER SKILLS

Audit EVERY Quick Answer skill.

Find all ticker/company allowlists, company-specific branches, fixture-only routing, hard-coded sentiment companies, and special NVDA/AAPL/TSLA behavior.

Remove accidental limitations.

Required architecture:

query
→ entity resolution
→ skill/intent
→ capability/data availability
→ execution
→ evidence
→ verification
→ result

NOT:

query
→ company list
→ special case

COMPANY

Make Company generic and evidence-driven for arbitrary resolvable companies supported by available data.

Missing metrics must remain missing. Never convert missing data to zero.

SENTIMENT

Make Sentiment generic, evidence-driven, source-aware, and time-window-aware.

Show positive/negative/neutral evidence and limitations. Do not silently define price direction as sentiment. Insufficient or conflicting evidence must be represented honestly.

ENTITY RESOLUTION

Use one canonical entity layer. Support ticker, company name, legal name, aliases, exchange+ticker, and former names where available. Ambiguous entities must not be guessed.

VERIFICATION

Preserve:

verified = exact claim supported by exact cited evidence

Regression-test invalid citation index, wrong source, wrong company, wrong period, wrong number, and correct number from wrong source/period.

Never allow later provenance normalization to overwrite a verdict without revalidation.

FUTURE PERIOD

Fix the known inconsistency where future/unreported periods sometimes abstain and sometimes answer confidently. Make this deterministic.

CHANNEL FAILURE

A provider failure must not masquerade as an empty successful result. Preserve success/empty/failed/timeout/unavailable.

PERFORMANCE

Previous measured p50 was around 28 seconds. Re-measure the current implementation by stage. Do not claim improvement without evidence and do not remove verification to make it faster.

TEST MATRIX

Test multiple companies across multiple sectors, not only NVIDIA.

Test ticker, company name, legal name, ambiguity, multi-company, annual, quarterly, future periods, missing data, conflicting evidence, SEC citations, wrong citations, and abstention.

CREATE/UPDATE

- `docs/quick-answer/SKILL_COVERAGE_MATRIX.md`
- `docs/quick-answer/FINAL_FIX_VERIFICATION.md`
- the evaluation suite described by the roadmap

RUN ALL AVAILABLE VALIDATION

- backend tests
- frontend tests
- typecheck
- build
- Quick Answer evaluation
- skill coverage evaluation
- SEC URL/resolver tests
- entity resolution tests
- verification tests
- future-period tests
- channel failure tests
- real pipeline E2E when credentials exist
- browser tests when environment permits
- performance measurement

Do not fake live/browser results.

At the end give a factual gate table with PASS / PARTIAL / BLOCKED / UNVERIFIED, exact commands, exact counts, and exit codes.

Do not say complete if any required gate is unresolved.

START EXECUTION NOW.
