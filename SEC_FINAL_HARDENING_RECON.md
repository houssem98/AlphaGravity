# SEC FINAL HARDENING — RECON

Recon performed against the working tree at `5f9420f` on branch
`verify/multi-entity-live`, 2026-08-25. Every classification below was read out
of the repository, not out of a prior report.

## 0. Source of truth

| # | Item | Location | Status |
|---|---|---|---|
| 1 | Branch / working tree | `verify/multi-entity-live` @ `5f9420f`; 1 modified file + 2 untracked, all `market-ui`, unrelated | VERIFIED |
| 2 | SEC evidence gate | `app/core/retrieval/evidence_gate.py` (388 lines) | VERIFIED |
| 3 | SearchPipeline integration | `app/core/search_pipeline.py:309` `_evidence_gate`, `:744-786` gate call + `channels_after_gate` | VERIFIED |
| 4 | EdgarSearch | `app/core/retrieval/edgar_search.py` (848 lines) | VERIFIED |
| 5 | XBRL resolution | `app/core/retrieval/sec_dimensions.py`, `app/ingestion/sources/sec_quarterly.py` | VERIFIED |
| 6 | Canonical evidence object | `RetrievalResult` (`app/core/retrieval/fusion.py:162`) + its `metadata` dict | PARTIAL |
| 7 | Citation generation | `app/core/search_pipeline.py:2196` `_normalize_citations` | **MISSING** |
| 8 | Persistence | `app/core/retrieval/fact_persistence.py` | PARTIAL |
| 9 | Existing SEC tests | 9 files, 149 SEC-specific tests | VERIFIED |
| 10 | LOOP_SPEC / LOOP_STANDARD | `~/.claude/LOOP_SPEC.md`, `~/.claude/LOOP_STANDARD.md` | VERIFIED |
| 11 | gate-guard / graph-lint / loop-lint / governance | `~/.claude/scripts/gate-guard.mjs`, `scripts/graph-lint.mjs`, `scripts/loop-lint.mjs`, `scripts/governance.mjs` | VERIFIED |

## 1. What already exists and works

**VERIFIED — the evidence gate (S2).** All four states exist as module
constants (`VERIFIED_LOCAL_HIT`, `LOCAL_MISS`, `LOCAL_UNVERIFIED`,
`LOCAL_CONFLICT`). `evaluate()` requires ticker, CIK, concept-family, fiscal
year, fiscal quarter, period start, period end, dimension, unit equality,
accession presence, a passing verification state, freshness, and the absence of
a contradicting row. Vector similarity, text similarity, row existence and
cache existence are consulted nowhere in the gate.

**VERIFIED — the gate runs before the fan-out (S3).** `search_pipeline.py:758`
calls it before `self.retrieval.search(...)`, and `channels_after_gate` is the
single place the `edgar` channel is dropped.

**VERIFIED — exact XBRL dimensional resolution (S4).** `sec_dimensions.py`
parses the filing's own instance document, keys the context on `(start, end)`,
and refuses ambiguity rather than guessing. `fact_verification.verify_fact`
rejects YTD spans, wrong fiscal quarters and missing breakdowns.

**VERIFIED — authority / restatement resolution.** `sec_authority.resolve`
ranks filings by (filed date, amendment, native form) and carries the
superseded readings into the passage text.

**VERIFIED — the five SearchPipeline E2E scenarios (S13).** Present in
`tests/test_search_pipeline_sec_e2e.py`, driving the real `SearchPipeline`,
real `RetrievalOrchestrator` and real `EdgarSearch`, mocking only boundaries
that leave the process. The gate itself is not mocked.

## 2. Gaps found

### GAP-1 — Citation provenance is discarded (S5, S6, S7) — MISSING

`_normalize_citations` (`search_pipeline.py:2196-2269`) joins a citation to its
passage using `getattr(p, attr)` only. `RetrievalResult` has no attribute for
any SEC provenance field — they all live in `p.metadata`, which the function
never reads. Measured consequences:

* `accn`, `cik`, `form`, `filed`, `fiscal_year`, `fiscal_quarter`,
  `period_start`, `period_end`, `tag`, `unit`, `value`, `dimensions`,
  `verification_status`, `parser_version` — all present on the passage,
  none reach the citation payload.
* `_pf("url")` resolves to `""` because `RetrievalResult.url` does not exist,
  so line 2244 falls through to `_edgar_browse_url(ticker, doctype)` — a
  generic `browse-edgar?action=getcompany&CIK=NVDA` company-listing URL — even
  when `p.metadata["filing_url"]` already holds the exact
  `.../Archives/edgar/data/1045810/000104581025000230/0001045810-25-000230-index.htm`.
  This is precisely the S6 failure the document names.
* `app/api/schemas/search.py:75` `Citation` has no field able to carry any of
  it, so even a fixed normalizer would be stripped by the REST response model.

### GAP-2 — Observability is partial (S18) — PARTIAL

`query_plan["gate_telemetry"]` supplies `local_evidence_status`, `sec_invoked`,
`sec_skip_reason`, `gate_reason`, `gate_conflicts` into the `metadata` event
(`search_pipeline.py:1832`). Absent: `sec_fact_requests`,
`sec_filing_requests`, `source_accession`, `source_filing_url`,
`verification_status`. Nothing anywhere classifies a SEC request as identity
vs. authoritative-fact, so the S3 invariant is asserted only indirectly, by
URL-substring matching inside one test.

### GAP-3 — No live SEC validation exists at all (S8-S12) — MISSING

There is no `tests/live/`, no live marker, no live command, and no test in the
repository that opens a socket to sec.gov. All 149 SEC tests run against
recorded fixtures in `tests/fixtures/`. Those fixtures are genuine (recorded
2026-08-23 from accession `0001045810-25-000230`) but a fixture cannot prove
SEC still serves what it served then. **Live SEC authority is presently
unproven.**

### GAP-4 — Persistence provenance is incomplete, and there is no round-trip test (S16) — PARTIAL

`fact_persistence.fact_row` encodes 17 provenance fields into `source_section`.
Not persisted: the XBRL `context_id` and the instance-document URL — the
"evidence location" S5/S16 require. There are 18 persistence unit tests but
none that persists a fact, reads it back, and asserts the gate accepts it with
zero provenance loss.

### GAP-5 — On-demand-ingestion isolation is structural but untested (S17) — PARTIAL

`search_pipeline.py:951` gates on-demand ingestion behind `if not
top_passages`, so an EDGAR-answered query cannot reach it. Nothing asserts
this, so a future change to that guard would be silent.

### GAP-6 — Error handling is uneven (S19) — PARTIAL

`edgar_search.search` wraps everything in `try/except` and returns `[]`;
`resolve_dimensional_fact` catches and returns `None`; `verify_fact` drops
unverified facts rather than downgrading them. Fixture support exists
(`_SECFake(raises=...)`, `instance=False`). But no test asserts the
truthful-failure contract for SEC unavailable, timeout, malformed XBRL, or
filing unavailable, nor that no value is fabricated in any of those cases.

### GAP-7 — Unvalidated path components in SEC URL construction (S20) — PARTIAL

`sec_quarterly.filing_url` interpolates `accn` into a URL path after only
`.replace("-", "")`. `sec_dimensions.ARCHIVE_URL.format(name=...)` interpolates
a filename taken from `index.json`. Both inputs come from SEC today, so this is
not a live vulnerability, but neither is validated, and the accession is about
to become a user-facing citation field.

### GAP-8 — Live-vs-fixture separation does not exist (S12) — MISSING

`pytest` runs one undifferentiated suite. No marker, no separate command, no
documented request budget.

## 3. Blocked

**DEPLOYMENT = BLOCKED.** Fly deploys are refused by an overdue-invoice 403 on
the builder; production is frozen at v228 (2026-07-07). Nothing in this task
attempts to bypass that.

## 4. Classification summary

| Requirement | Status at recon |
|---|---|
| S2 evidence gate | VERIFIED |
| S3 SEC invocation boundary | PARTIAL (invariant holds; not instrumented) |
| S4 exact SEC fact resolution | VERIFIED |
| S5 citation provenance | MISSING |
| S6 exact filing URL | MISSING |
| S7 citation integrity tests | MISSING |
| S8-S12 live SEC validation | MISSING |
| S13 SearchPipeline E2E | VERIFIED |
| S14 empty-corpus regression | VERIFIED |
| S15 stale / conflict safety | VERIFIED |
| S16 persistence | PARTIAL |
| S17 on-demand ingestion isolation | PARTIAL |
| S18 observability | PARTIAL |
| S19 error handling | PARTIAL |
| S20 security | PARTIAL |
| S21 performance | PARTIAL |
| S23 deployment | BLOCKED |
