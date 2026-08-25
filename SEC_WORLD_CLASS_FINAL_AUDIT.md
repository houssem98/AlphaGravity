# SEC WORLD-CLASS FINAL AUDIT

| | |
|---|---|
| **Branch** | `verify/multi-entity-live` |
| **Commit** | `f725f8d0be300707fc475e959f7e7529051496f3` (`f725f8d`) |
| **Base** | `5f9420f7b95b1886f36df24977ae5e0b32e7d946` |
| **Date** | 2026-08-25 |
| **Deterministic suite** | 758 passed / 51 skipped / **0 failed** (344s, 310s across two runs) |
| **Live SEC suite** | 24 passed / 0 failed, 31.4s, **18 real requests** |
| **Baseline before this work** | 644 passed / 27 skipped / 0 failed |

---

## 1. Executive verdict

**This is NOT 10/10 and I am not calling it a WORLD-CLASS CANDIDATE.**

Section 24 of the hardening document sets 26 conditions and says plainly: if any
item is not proven, do not call it 10/10. Twenty-four are proven. Two are not:

* **"Live SEC failures are handled truthfully"** — failure handling is proven
  against 30 fixture tests. It is **NOT TESTED LIVE**. Inducing a real SEC
  failure means either issuing malformed requests or hammering the endpoint
  until it refuses, and section 11 forbids both. This is a deliberate,
  documented gap, not an oversight.
* **"LOOP gates pass"** — `gate-guard`, `graph-lint` and `governance` pass
  cleanly. `loop-lint` reports **8 failing loops out of 37**. Those 8 are
  pre-existing and none of them was touched: this change adds no loop file and
  no roadmap file (`git status` confirms). But "LOOP gates pass" is not
  literally true of this repository, and converting that into PASS is the exact
  substitution section 26 forbids.

Everything the two explicit goals asked for is done and measured:

1. **Live SEC validation is genuinely proven, not fixture-only.** 24 tests hit
   real sec.gov. The NVIDIA golden value is re-derived from SEC by an
   independent route and compared, rather than asserted from a constant.
2. **Citation precision now carries complete authoritative provenance** —
   accession and exact filing URL included — all the way to the user-facing
   result, on both the SEC path and the locally-answered path.

Three real defects were found and fixed during the work, two of them by tests
written for this task:

* there were **two** citation builders, and the second — the resilience path
  that runs whenever the model degrades under rate-limit — bypassed the
  provenance join entirely and hardcoded the generic EDGAR browse URL
* the accession validator used `^...$`, and `$` in Python also matches
  immediately before a trailing newline, so `"0001045810-25-000230\n"`
  validated and would have been interpolated into a URL path
* the gate dropped the `edgar` channel on a verified hit even when
  `structured_facts_enabled` was off, in which case nothing could read the row
  it bypassed for, and the answer fell back to prose with the exact figure
  removed

---

## 2. Architecture

Unchanged in shape. No new database, no duplicate evidence model, no continuous
ingestion dependency. The document's target flow, with the file that implements
each hop:

```
USER QUESTION
  -> QUERY UNDERSTANDING          app/core/query_understanding.py
  -> FINANCIAL INTENT             app/core/question_class.py::classify
  -> VERIFIED LOCAL EVIDENCE GATE app/core/retrieval/evidence_gate.py::evaluate
      |
      +-- VERIFIED LOCAL HIT -> ANSWER          (edgar dropped: channels_after_gate)
      |
      +-- MISS / UNVERIFIED / CONFLICT
            -> AUTHORITATIVE SEC   edgar_search.py::EdgarSearch.search
            -> EXACT FILING        sec_authority.py::resolve
            -> EXACT FACT          sec_dimensions.py::resolve_dimensional_fact
            -> VERIFICATION        fact_verification.py::verify_fact
            -> CANONICAL EVIDENCE  citation_provenance.py::provenance   [NEW]
            -> EXACT CITATION      search_pipeline.py::_normalize_citations
            -> ANSWER
            -> ASYNC PERSISTENCE   fact_persistence.py::schedule
```

**STATUS: VERIFIED.** `tests/test_search_pipeline_sec_e2e.py` and
`tests/test_search_pipeline_sec_provenance_e2e.py` drive the real
`SearchPipeline`, real `RetrievalOrchestrator` and real `EdgarSearch`; the gate
is never mocked.

### Files added

| File | Purpose |
|---|---|
| `services/gravity-api/app/core/retrieval/citation_provenance.py` | canonical evidence object, stored-row rehydration, URL choice, accession/filename validation |
| `services/gravity-api/app/core/retrieval/sec_telemetry.py` | SEC requests counted at the socket, split identity vs authoritative |
| `services/gravity-api/tests/test_citation_provenance.py` | 53 tests, section 7 hops A-L |
| `services/gravity-api/tests/test_search_pipeline_sec_provenance_e2e.py` | 13 tests, provenance / isolation / telemetry through the real pipeline |
| `services/gravity-api/tests/test_sec_persistence_roundtrip.py` | 18 tests, section 16 |
| `services/gravity-api/tests/test_sec_error_handling.py` | 30 tests, section 19 |
| `services/gravity-api/tests/live/test_sec_authority.py` | 24 live tests, sections 8-12 |

### Files changed

`app/core/search_pipeline.py`, `app/core/retrieval/edgar_search.py`,
`app/core/retrieval/evidence_gate.py`, `app/core/retrieval/fact_persistence.py`,
`app/core/retrieval/sec_dimensions.py`, `app/api/routes/search.py`,
`app/api/schemas/search.py`, `apps/gravity-ui/src/lib/types.ts`,
`tests/conftest.py` and three existing SEC test files.

Total: 21 files, +3625 / -22.

---

## 3. Evidence gate

**STATUS: VERIFIED.**

* **File:** `app/core/retrieval/evidence_gate.py`
* **Functions:** `evaluate`, `check_verified_local_evidence`,
  `channels_after_gate`, `local_channel_can_serve` (new), `GateDecision.block`
  (new)
* **Tests:** `tests/test_evidence_gate.py` (37), `tests/test_verified_evidence_gate.py` (17)
* **Command:** `pytest tests/test_evidence_gate.py tests/test_verified_evidence_gate.py`
* **Result:** 54 passed

All four required states exist and are reachable: `VERIFIED_LOCAL_HIT`,
`LOCAL_MISS`, `LOCAL_UNVERIFIED`, `LOCAL_CONFLICT`. A row bypasses SEC only when
ticker, CIK, concept family, fiscal year, fiscal quarter, period start, period
end, dimension, unit, accession, provenance and a passing verification state all
match, the row is fresh, and no second row contradicts it. Vector similarity,
text similarity, row existence and cache existence are consulted nowhere.

### Change made here

`channels_after_gate` now refuses the bypass when the channel that would read the
verified row is not running. `structured_facts_enabled` defaults to `False` for
a stated pre-existing reason (noisy table-extracted rows regressed FinanceBench
40% -> 20%, `app/config.py:101-103`), and `structured_search.search` then returns
`[]` unconditionally. Dropping `edgar` in that configuration removed the exact
figure and left the answer to prose — the failure this gate exists to prevent,
arrived at from the other side.

The evidence status stays `VERIFIED_LOCAL_HIT` (the evidence *is* a verified
hit); `sec_invoked` now reports what the pipeline will actually do, and
`gate_bypass_blocked` says why. Telemetry that claims the filer was skipped while
the filer is being called is worse than no telemetry.

**Escalation, not taken:** flipping `structured_facts_enabled` to `True` would
make the local-hit path serve answers in the default configuration. It also
re-enables the noisy rows its comment warns about, and
`SEC_FIX_IMPLEMENTATION_REPORT.md:499` already recorded it as an escalation. It
was **not** changed here.

---

## 4. SEC resolver

**STATUS: VERIFIED (fixture + live).**

* **File:** `app/core/retrieval/edgar_search.py`
* **Functions:** `EdgarSearch.search`, `_for_ticker`, `_fetch_concept`,
  `ticker_to_cik`, `tickers_from_names`, `_apply_authority`, `_to_result`
* **Tests:** `tests/test_edgar_search.py` (22), `tests/test_sec_query_time_regression.py` (37), `tests/live/test_sec_authority.py`
* **Result:** fixture 59 passed; live 24 passed

Deterministic resolution chain, confirmed live:

```
NVIDIA -> CIK 1045810 -> FY2026 Q3 -> 10-Q -> accession 0001045810-25-000230
       -> nvda-20251026_htm.xml -> us-gaap:Revenues
       -> srt:ProductOrServiceAxis = nvda:DataCenterMember
       -> 51,215,000,000 -> USD -> 2025-07-28..2025-10-26
```

Additions here: `issuer` (SEC's own registrant name, from the ticker file already
downloaded), `extraction_method`, `document_url`, and accession validation before
any URL is built.

---

## 5. XBRL resolver

**STATUS: VERIFIED.**

* **File:** `app/core/retrieval/sec_dimensions.py`
* **Functions:** `resolve_dimensional_fact`, `parse_dimensional_facts`,
  `select_by_query`, `find_instance_name`, `corroborate`
* **Tests:** `tests/test_sec_query_time_regression.py`, `tests/test_sec_error_handling.py::TestMalformedXbrl`
* **Result:** passed

Segment and product-line facts exist only in the filing's own instance document;
`companyconcept` returns non-dimensional facts only. The context is keyed on both
period endpoints, which is what makes the year-to-date trap unreachable — the
272-day span at 147,811,000,000 is a different context and is never selected.
Ambiguous member matches are refused rather than guessed.

**Change made here:** `parse_dimensional_facts` returns `[]` instead of raising
`ET.ParseError` on a body that will not parse. The input is a document fetched
over the network, so "unparseable" is a normal outcome — a truncated read, an
error page served with a 200 — and the honest result is the same as "this filing
reports no such fact".

---

## 6. Verification

**STATUS: VERIFIED.**

* **File:** `app/core/retrieval/fact_verification.py`
* **Functions:** `verify_fact`, `verify_period`, `verify_value`, `verify_dimension`
* **Tests:** `tests/test_sec_error_handling.py` (30), `tests/test_sec_query_time_regression.py`
* **Command:** `pytest tests/test_sec_error_handling.py`
* **Result:** 30 passed

Distinguishes quarterly / YTD / annual, consolidated / segment, GAAP concept
identity, unit presence and finiteness, and fiscal-vs-calendar period assignment
through the issuer's own fiscal calendar. A failing fact is dropped, not
downgraded.

---

## 7. Citation provenance — the primary goal

**STATUS: VERIFIED.**

* **File:** `app/core/retrieval/citation_provenance.py` (new)
* **Functions:** `provenance`, `rehydrate`, `citation_url`, `evidence_location`,
  `valid_accession`, `valid_instance_name`
* **Call sites:** `app/core/search_pipeline.py::_normalize_citations` (both
  builders), `app/core/search_pipeline.py::_answer_provenance`
* **Tests:** `tests/test_citation_provenance.py` (53),
  `tests/test_search_pipeline_sec_provenance_e2e.py` (13)
* **Command:** `pytest tests/test_citation_provenance.py tests/test_search_pipeline_sec_provenance_e2e.py`
* **Result:** 66 passed

### What was broken

`_normalize_citations` joined a citation to its passage with `getattr(p, attr)`
only. `RetrievalResult` has no attribute for any SEC field — they all live in
`p.metadata`, which the function never read. So `_pf("url")` resolved to `""` and
line 2244 fell through to `_edgar_browse_url(ticker, doctype)`:

```
was:  https://www.sec.gov/cgi-bin/browse-edgar?action=getcompany&CIK=NVDA&...&type=sec_edgar_xbrl
now:  https://www.sec.gov/Archives/edgar/data/1045810/000104581025000230/0001045810-25-000230-index.htm
```

`app/api/schemas/search.py::Citation` had no field able to carry it, and
`app/api/routes/search.py::_coerce_citation` is a whitelist — so even a fixed
normalizer would have been stripped at the REST hop. Both are fixed.

### The second builder

`_normalize_citations` ends with a resilience branch that synthesizes citations
directly from passages when the model drops its citations array — which is what
happens under rate-limit, and what happened on every run of the E2E harness. It
bypassed the provenance join and hardcoded `_edgar_browse_url`. Fixing only the
first builder would have made exact-filing citations correct precisely while the
model was healthy, and wrong exactly when the answer most needs its source. This
was found by `TestCitationProvenanceThroughThePipeline`, not by inspection.

### Section 7 requirements A-L

| | Requirement | Test | Status |
|---|---|---|---|
| A | accession survives SEC resolution | `TestA_SecResolution` (5) | VERIFIED |
| B | accession survives verification | `TestB_Verification` (2) | VERIFIED |
| C | accession survives persistence | `TestC_Persistence` (3) | VERIFIED |
| D | accession survives retrieval | `TestD_Retrieval` (4) | VERIFIED |
| E | accession reaches citation generation | `TestE_CitationGeneration` (6) | VERIFIED |
| F | citation contains exact filing provenance | `TestF_ExactFilingProvenance` (3) | VERIFIED |
| G | no silent fallback to generic EDGAR | `TestG_NoSilentGenericFallback` (5) | VERIFIED |
| H | citation value matches verified value | `test_H_...` | VERIFIED |
| I | citation period matches the question | `test_I_...` | VERIFIED |
| J | citation dimension matches the question | `test_J_...` | VERIFIED |
| K | citation unit matches the answer | `test_K_...` | VERIFIED |
| L | citation issuer matches the answer | `test_L_...` | VERIFIED |

The three combinations the document calls impossible are asserted directly, which
is why the checks are field-by-field rather than "provenance is present":
`test_the_consolidated_total_is_never_cited_as_the_segment` rejects
57,006,000,000 (consolidated), 50,908,000,000 (Compute & Networking, 0.6% away)
and 147,811,000,000 (year-to-date) by value.

### Fields carried (section 5)

`issuer, ticker, cik, filing_form, filing_date, accession, fiscal_year,
fiscal_quarter, period_start, period_end, xbrl_concept, dimension,
dimension_value, unit, value, verification_status, source_url, filing_url,
evidence_location, extraction_method, parser_version, scope, restated,
is_amendment, superseded, provenance_chain`

`TestF_ExactFilingProvenance::test_every_field_the_document_requires_is_present`
asserts each is non-empty on the golden fact.

### The locally-answered path

The second ask of the same question is served from a `financials` row, not from a
live result — and that row uses different keys. `rehydrate()` maps the stored
provenance back into the live metadata shape, so `provenance()` serves both paths
and the locally-answered citation carries the same accession and the same exact
filing URL. Without this, persistence would be a latency trick rather than a
corpus. Proven end-to-end by
`test_the_locally_answered_citation_also_names_the_filing`.

### Ordering rule

The exact filing URL outranks a URL the model emitted
(`test_the_exact_filing_outranks_a_url_the_model_emitted`). The resolver read the
accession out of the filing; the model did not. When no filing is known, the
generic browse URL is still used — which is what makes substituting it for a
known filing a downgrade rather than a convenience.

---

## 8. Live SEC validation — the second primary goal

**STATUS: VERIFIED.**

* **File:** `tests/live/test_sec_authority.py`
* **Command:** `GRAVITY_LIVE_SEC=1 pytest tests/live -v`
* **Result:** **24 passed, 0 failed, 31.39s, 18 real HTTP requests to sec.gov**
* **Opt-in:** skipped unless `GRAVITY_LIVE_SEC=1`; the marker is registered in
  `tests/conftest.py::pytest_configure`. `pytest tests` collects them as 24
  skips and never depends on SEC availability.

### The golden NVIDIA test (section 9)

Question, verbatim: *"What was NVIDIA's Data Center revenue in Q3 FY2026?"*

Proven live, against real sec.gov:

| Hop | Live result |
|---|---|
| NVIDIA -> CIK | 1045810 (resolved from the name, not a ticker) |
| FY / quarter | FY2026 Q3 |
| Filing | 10-Q |
| Accession | `0001045810-25-000230` |
| Instance | `nvda-20251026_htm.xml` |
| Concept | `us-gaap:Revenues` |
| Dimension | `srt:ProductOrServiceAxis = nvda:DataCenterMember` |
| Period | 2025-07-28 .. 2025-10-26 (90 days) |
| **Value** | **51,215,000,000** |
| Unit | USD |
| Verification | `verified` |
| Citation | exact filing index URL, accession present, no `browse-edgar` |

**The value is not asserted from a hardcoded constant.** `_independent()`
re-derives it from SEC by a route sharing no code with the resolver under test:
raw `httpx`, the `companyconcept` endpoint to find the accession covering the
span, the filing index, and a stdlib `ElementTree` read of the instance document
performed inside the test file. The resolver is compared against that
(`test_the_value_matches_an_independent_read_of_the_filing`). The literal
51,215,000,000 is asserted too, as a cross-check on both — and a restatement
should break it loudly rather than pass on a stale expectation.

### Live negatives (section 10)

| Case | Test | Status |
|---|---|---|
| year-to-date column returned | `test_the_year_to_date_column_is_never_returned` | VERIFIED live |
| consolidated returned as segment | `test_the_consolidated_total_is_never_returned_as_the_segment` | VERIFIED live |
| adjacent segment returned | `test_the_adjacent_segment_is_never_returned` | VERIFIED live |
| wrong quarter | `test_a_different_quarter_resolves_to_a_different_period` | VERIFIED live (Q2 resolved to accession `0001045810-25-000209`, `nvda-20250727_htm.xml`) |
| annual vs quarterly | `test_an_annual_question_is_not_answered_with_a_quarter` | VERIFIED live |
| consolidated vs segment | `test_a_consolidated_question_is_not_answered_with_a_segment` | VERIFIED live |
| wrong metric | `test_a_different_metric_resolves_to_a_different_concept` | VERIFIED live |
| missing metric | `test_a_metric_the_filer_does_not_report_yields_nothing` | VERIFIED live |
| **amended filing** | `tests/test_sec_amendments.py` (18) | **FIXTURE ONLY — see below** |
| **conflicting filing metadata** | `tests/test_sec_amendments.py` | **FIXTURE ONLY — see below** |

**Why amendments stay fixture-based, stated rather than hidden:** a live
amendment test needs an issuer that has restated a specific period, which is a
fact about the world that changes without notice. `tests/test_sec_amendments.py`
pins it against Plug Power's genuinely restated Q1 2019 (18,593,000 ->
21,579,000 -> 21,510,000), recorded. A live version would go red for reasons
having nothing to do with this code.

### Rate-limit safety (section 11) — MEASURED

**18 requests for the entire live module**, serial, one identity request.

```
 1  company_tickers.json                                     identity (once)
 2  companyconcept RevenueFromContract..., then Revenues     golden resolution
 1  Archives .../000104581025000230/index.json               golden resolution
 1  Archives .../nvda-20251026_htm.xml                       golden resolution
 1  companyconcept Revenues                                  independent re-derivation
 1  Archives .../index.json                                  independent re-derivation
 1  Archives .../nvda-20251026_htm.xml                       independent re-derivation
10  four live negatives (Q2, FY2025 annual, consolidated, NetIncomeLoss, DepositsFromBanks)
```

* No `asyncio.gather`, no parallel parametrisation, no polling loop anywhere in
  the file.
* The 1.2 MB identity map is downloaded once and shared, exactly as production
  does on a long-lived channel — `test_the_identity_map_is_downloaded_at_most_once`.
* An identifying User-Agent with contact information is asserted —
  `test_an_identifying_user_agent_is_sent`.
* The budget is **enforced, not described**:
  `test_the_request_budget_is_respected` fails above `MAX_LIVE_REQUESTS = 30`, so
  a change that starts re-resolving per assertion fails here rather than at
  sec.gov.

### Live vs fixture separation (section 12)

```
DETERMINISTIC CI    pytest tests                          758 passed / 51 skipped / 0 failed
LIVE AUTHORITY      GRAVITY_LIVE_SEC=1 pytest tests/live   24 passed / 0 failed / 18 requests
```

---

## 9. Persistence

**STATUS: VERIFIED.**

* **File:** `app/core/retrieval/fact_persistence.py`
* **Functions:** `fact_row`, `persist`, `schedule`, `_instance_name` (new)
* **Tests:** `tests/test_sec_fact_persistence.py` (18), `tests/test_sec_persistence_roundtrip.py` (18, new)
* **Command:** `pytest tests/test_sec_persistence_roundtrip.py`
* **Result:** 18 passed

The round trip asserted is the real one: live EDGAR result -> `fact_row` ->
`created_at` assigned by Postgres -> `evidence_gate.evaluate` (does it bypass
SEC?) -> `citation_provenance.provenance` (can it still be cited?). Every field
is asserted against the **original live result**, not against a literal, so a
resolver change that stops emitting one fails here too.

Section 16's minimum, each with its own test: value, metric, period (as a span,
not only a label), dimensions, unit, accession, filing, source, verification
state, evidence location.

**Added here:** `issuer`, `meth` (extraction method), `ctx` (XBRL context
element) and `loc` (instance filename). CIK and accession already reconstruct the
archive path, so the filename and the context element are all that must be stored
to make the reading reproducible by hand — no schema migration, no new column.

`TestWhatMustNotRoundTrip` pins the other direction: a derived Q4 is never
written (it is arithmetic, not a filed figure), and a legacy row cannot
masquerade as a round-tripped one.

---

## 10. SearchPipeline E2E

**STATUS: VERIFIED.**

* **Files:** `tests/test_search_pipeline_sec_e2e.py`, `tests/test_search_pipeline_sec_provenance_e2e.py`
* **Command:** `pytest tests/test_search_pipeline_sec_e2e.py tests/test_search_pipeline_sec_provenance_e2e.py`
* **Result:** 13 + 13 = 26 passed

Real `SearchPipeline`, real `RetrievalOrchestrator`, real `EdgarSearch`, real
gate. Mocks sit only on boundaries that leave the process: the LLM router, the
query understander, the SEC HTTP client (recorded fixtures) and Supabase.

| # | Scenario (section 13) | Result |
|---|---|---|
| 1 | verified local hit | `VERIFIED_LOCAL_HIT`, 0 SEC requests |
| 2 | empty local corpus | `LOCAL_MISS`, SEC invoked, instance fetched, fact persisted |
| 3 | second identical query | `VERIFIED_LOCAL_HIT`, 0 SEC requests |
| 4 | unverified local | `LOCAL_UNVERIFIED` -> SEC |
| 5 | stale local | `LOCAL_CONFLICT` -> SEC |
| 6 | conflicting local | `LOCAL_CONFLICT` -> SEC |

**Empty-corpus regression (section 14):** `TestScenario3` runs the miss, feeds
back exactly what the pipeline persisted, re-runs, and asserts zero SEC requests.
`test_the_second_query_costs_nothing_again` asserts the same on the measured
per-kind counters. Permanent regression tests.

**Stale / conflict safety (section 15):** VERIFIED. An incorrect local record
never overrides SEC, and the fix is not deletion — the row stays, and the gate
routes past it.

**One test double was strengthened:** `_StructuredChannel` summarised the row
into `{"value": ..., "source": "structured"}`, while the real
`structured_search` sets `metadata=r` — the whole row, which is where the
provenance lives. A double that summarised it would have hidden the exact hop
these tests exist to prove. It now passes the row through.

---

## 11. On-demand ingestion isolation

**STATUS: VERIFIED.**

* **Guard:** `app/core/search_pipeline.py:951` — `if not top_passages and settings.on_demand_ingest_enabled ...`
* **Test:** `tests/test_search_pipeline_sec_provenance_e2e.py::TestOnDemandIngestionIsolation`
* **Result:** 2 passed

`on_demand_ingest_enabled` defaults to `True`, so nothing but the EDGAR answer
stands between an empty corpus and the generic ingestion path (download the
filing, chunk it, call the embedding API). The tests monkeypatch
`get_on_demand_ingestor` to raise, then run a local miss and a verified hit
through the real pipeline. Both answer without entering it. Generic ingestion is
preserved for the uses it has; it is no longer an untested accidental dependency
of exact financial-fact resolution.

---

## 12. Observability

**STATUS: VERIFIED.**

* **File:** `app/core/retrieval/sec_telemetry.py` (new); emitted at
  `app/core/search_pipeline.py:1832-1850`
* **Test:** `TestTheRequestsThatActuallyLeft` (5)

Every field section 18 asks for, in the `metadata` event and in
`SearchMetadata`:

| Field | Source |
|---|---|
| `local_evidence_status` | `GateDecision.telemetry()` |
| `sec_invoked` | `GateDecision.sec_invoked` — now reports what the pipeline will do |
| `sec_skip_reason` | `GateDecision.sec_skip_reason` |
| `sec_fact_requests` | counted at the socket |
| `sec_filing_requests` | counted at the socket |
| `sec_identity_requests` | counted at the socket |
| `sec_archive_requests` | counted at the socket |
| `source_accession` | `_answer_provenance(citations_out)` |
| `source_filing_url` | `_answer_provenance(citations_out)` |
| `verification_status` | `_answer_provenance(citations_out)` |
| `gate_bypass_blocked` | new — why a verified hit still called SEC |

**Identity is distinguished from authoritative fact requests**, as section 18
requires, and the two are never summed: `classify()` splits `company_tickers.json`
(the phone book) from `data.sec.gov` (asking the filer), `index.json` (filing
resolution) and other `/Archives/` documents (the instance).

Counting happens in `CountingClient`, which wraps the client `EdgarSearch._client`
returns. Wrapping the client rather than instrumenting call sites is what makes
the count trustworthy: `sec_dimensions` is handed the raw client and issues its
own requests, so a counter living inside `_get_json` would have missed every
Archives request — precisely the ones the invariant is about.

`source_accession` and friends are read off the **citations the user is shown**,
not off the passages, so telemetry and the answer cannot disagree about which
filing was cited.

`SearchMetadata` also now carries `question_class`, `local_evidence_status`,
`sec_invoked` and `sec_skip_reason`, which previously reached the WebSocket event
and were silently dropped by the REST response model.

---

## 13. Security

**STATUS: VERIFIED** for the code added here. No security control was weakened
for citation convenience.

| Concern | Finding | Action |
|---|---|---|
| Secrets | None added. `sec_user_agent` carries a contact address, which SEC requires; it is not a credential | none needed |
| Unsafe URL construction | `filing_url` interpolated `accn` after only `.replace("-","")`; `ARCHIVE_URL` interpolated a filename taken off the wire | `valid_accession` and `valid_instance_name` gate both |
| **Regex bug found by a new test** | `^\d{10}-\d{2}-\d{6}$` — `$` also matches before a trailing newline, so `"0001045810-25-000230\n"` validated | changed to `\A...\Z`; `test_a_malformed_accession_is_refused` covers 9 malformed inputs |
| SSRF | `find_instance_name` returned any name from `index.json` straight into an Archives URL | names are filtered by `valid_instance_name`; `test_a_traversing_filename_in_the_filing_index_is_not_fetched` proves a traversing or absolute-URL entry is not fetched |
| Arbitrary external URL fetching | None introduced. Every URL fetched is built from a constant template plus validated components | none needed |
| Untrusted accession handling | Validated before URL interpolation, before persistence and before display | 10 tests |
| Logging of credentials | New log lines are `sec_bad_accession` (input truncated to 40 chars) and `sec_instance_unparseable` (error truncated to 160). No credentials, no tokens | none needed |
| Unsafe persistence | `source_section` gains issuer / context / filename. `encode_provenance` neutralises the `;` and `=` delimiters; `loc` is validated before storage. Supabase REST, no SQL string building | none needed |
| Denial of service | `INSTANCE_MAX_BYTES` (16 MB) refuses a pathological instance; `parse_dimensional_facts` no longer raises on malformed input | `test_an_oversized_instance_is_refused_rather_than_parsed` |

**Residual risk, pre-existing and unchanged:** when a passage carries no filing
provenance, a URL emitted by the model is still used for the citation link
(`_normalize_citations`, `c.get("url")`). This change *reduced* its precedence —
an exact filing URL now outranks it — but did not remove it. Out of scope here;
recorded rather than hidden.

---

## 14. Performance — MEASURED

**STATUS: VERIFIED.** No latency claim is made, because latency was not measured.
Request counts were.

Measured through the real `SearchPipeline`, read from the `metadata` event:

| Scenario | total | identity | fact | filing | archive | gate status |
|---|---|---|---|---|---|---|
| VERIFIED_LOCAL_HIT (warm channel) | **0** | 0 | **0** | **0** | **0** | `VERIFIED_LOCAL_HIT` |
| VERIFIED_LOCAL_HIT (cold channel) | 1 | 1 | **0** | **0** | **0** | `VERIFIED_LOCAL_HIT` |
| LOCAL_MISS | 4 | 0 | 2 | 1 | 1 | `LOCAL_MISS` |
| SECOND QUERY (after persistence) | **0** | 0 | **0** | **0** | **0** | `VERIFIED_LOCAL_HIT` |

Section 3's invariant holds and is now instrumented rather than asserted by
substring matching: on a verified local hit, **SEC fact requests = 0, SEC filing
requests = 0, SEC Archives requests = 0**.

The one identity request on a cold channel is stated rather than rounded to zero.
It is the ticker map — the phone book, not a fact about a period — and production
runs one long-lived channel that caches it for a day, so steady-state traffic is
the warm row. `test_a_cold_verified_hit_costs_one_identity_request_and_nothing_else`
pins the difference.

Authoritative verification was not optimised away: the local-miss path still
fetches the concept, the filing index and the instance document, and still runs
`verify_fact` on the result.

---

## 15. Test results

### Deterministic CI

```
$ cd services/gravity-api && python -m pytest tests -q
758 passed, 51 skipped, 26 warnings in 310.01s
```

| | Before | After |
|---|---|---|
| passed | 644 | **758** (+114) |
| skipped | 27 | 51 (+24 = the live suite) |
| failed | 0 | **0** |

New tests by file: citation provenance 53, error handling 30, persistence
round-trip 18, provenance E2E 13 = 114.

**One flaky result, classified honestly.** The first full run reported
`1 failed: tests/test_auth_phase1.py::test_login_rate_limit_per_email_blocks_after_threshold`.
It is a **pre-existing wall-clock flake**, not a regression from this work:

* the test asserts a *10 logins per 5 minutes* window, and the full suite runs
  for 5m10s-5m44s — the window boundary falls inside the run
* it passes in isolation (1 passed, 37.0s) and within its own file (17 passed, 62.5s)
* it passes on a **second full run of identical code**: 758 passed, 0 failed
* nothing in this change is imported by the auth suite; `tests/conftest.py` gained
  only a non-autouse fixture and a marker registration

I am reporting it rather than omitting it. It is not fixed here, because fixing a
wall-clock-window auth test is unrelated to this task and would be an unrequested
change to a passing area.

### Live SEC

```
$ GRAVITY_LIVE_SEC=1 python -m pytest tests/live -v
24 passed in 31.39s          (18 real requests to sec.gov)
```

### Frontend

```
$ cd apps/gravity-ui && npx tsc --noEmit
TypeScript: No errors found
```

`apps/gravity-ui/src/lib/types.ts` declares the new optional citation fields.
TypeScript interfaces are compile-time only, so nothing was ever lost at runtime;
declaring them closes the document's `API response -> UI` hop and makes the exact
filing visible to the client, which needs no rendering change because the
citation's `url` now *is* the filing.

---

## 16. LOOP / graph / governance results

| Gate | Command | Result | Status |
|---|---|---|---|
| gate-guard | `node ~/.claude/scripts/gate-guard.mjs` | `gate-guard: clean · HEAD..working tree` | **PASS** |
| graph-lint | `node scripts/graph-lint.mjs` | `8 graph(s), 0 drifted, 0 decorative` | **PASS** |
| governance | `node scripts/governance.mjs` | `10/10 closed, 14 iterations logged, 0 violation(s)` | **PASS** |
| loop-lint | `node scripts/loop-lint.mjs` | `37 loop(s), 8 failing` | **PRE-EXISTING FAIL** |

**loop-lint, stated precisely.** 8 of 37 loops fail (missing stop-budget /
stop-stall conditions, and 5 prompts over the 3000-char cap). None of them was
touched: this change adds no `*_LOOP.sh` and no roadmap file, confirmed by
`git status`. The failures are the repository's existing baseline and are
unchanged by this commit — but "LOOP gates pass" is not literally true, and that
is why section 24's box is left unticked above.

**No gate was weakened.** gate-guard judges per file and reports clean. Three
existing test files were modified and every modification adds assertions or
makes an assertion stricter:

* `tests/test_verified_evidence_gate.py` — the exact-dict telemetry assertion
  gained `gate_bypass_blocked`
* `tests/test_evidence_gate.py`, `tests/test_verified_evidence_gate.py`,
  `tests/test_search_pipeline_sec_e2e.py` — gained an autouse fixture that runs
  them under the configuration in which the bypass they assert actually exists
* `tests/test_search_pipeline_sec_e2e.py` — the structured-channel double now
  carries the whole row, as the real channel does

---

## 17. Deployment status

**DEPLOYMENT = BLOCKED.**

Fly deploys are refused by an overdue-invoice 403 on the builder; production is
frozen at v228 (2026-07-07), roughly 460 commits behind. No attempt was made to
bypass the billing restriction, and none should be.

**Nothing in this audit describes production behaviour.** Every measurement above
was taken locally, against recorded fixtures or against live sec.gov, at commit
`f725f8d` on `verify/multi-entity-live`. The branch was **not** merged to `main`
and was **not** pushed; the document instructs not to merge without explicit
instruction.

---

## 18. Section 24 acceptance criteria

| | Criterion | Status |
|---|---|---|
| [x] | Verified local hit bypasses SEC fact/filing requests | VERIFIED — measured 0/0/0 |
| [x] | Local miss invokes SEC | VERIFIED — measured 2 fact + 1 filing + 1 archive |
| [x] | Second query uses persisted verified evidence | VERIFIED — measured 0/0/0 |
| [x] | Unverified evidence invokes SEC | VERIFIED |
| [x] | Conflicting evidence invokes SEC | VERIFIED |
| [x] | Exact XBRL dimensional fact is resolved | VERIFIED (fixture + live) |
| [x] | Fiscal period is verified | VERIFIED |
| [x] | Unit is verified | VERIFIED |
| [x] | Filing/accession is verified | VERIFIED |
| [x] | Canonical evidence retains full provenance | VERIFIED — 21 fields |
| [x] | Accession reaches user-facing citation | VERIFIED — both paths |
| [x] | Exact filing URL reaches user-facing citation | VERIFIED — both builders |
| [x] | Citation value matches verified value | VERIFIED |
| [x] | Citation period matches query | VERIFIED |
| [x] | Citation dimension matches query | VERIFIED |
| [x] | Citation unit matches query | VERIFIED |
| [x] | Empty-corpus regression passes | VERIFIED |
| [x] | Real SearchPipeline E2E passes | VERIFIED — 26 tests |
| [x] | Live SEC NVIDIA smoke test passes | VERIFIED — 24/24 live |
| [ ] | **Live SEC failures are handled truthfully** | **NOT TESTED LIVE** — 30 fixture tests; inducing a live failure violates section 11 |
| [x] | No accidental generic-ingestion dependency | VERIFIED |
| [x] | SEC rate limits are respected | VERIFIED — 18 requests, budget enforced by a test |
| [x] | Security review passes | VERIFIED — 1 real bug found and fixed |
| [ ] | **LOOP gates pass** | **PARTIAL** — gate-guard clean; loop-lint 8 pre-existing failures, untouched |
| [x] | graph-lint passes | VERIFIED — 0 drifted |
| [x] | governance passes | VERIFIED — 0 violations |
| [x] | all relevant tests pass | VERIFIED — 758/0; one unrelated wall-clock flake documented |

**24 of 26 proven. Two not. Therefore: NOT 10/10, and not a WORLD-CLASS
CANDIDATE by the document's own definition.**

---

## 19. Known limitations, stated

1. **Live SEC failure handling is not proven live.** Fixture-proven only (30
   tests). Inducing a real outage requires malformed requests or hammering; both
   violate section 11.
2. **Amended filings and conflicting filing metadata are fixture-based**, with
   the reason given in section 8 above.
3. **`structured_facts_enabled` is `False` by default**, so in a default
   deployment the verified-local-hit bypass never engages — the gate now
   correctly asks the filer instead of answering from prose. Enabling the flag is
   an escalation and was not taken.
4. **loop-lint has 8 pre-existing failures** unrelated to this work.
5. **`test_login_rate_limit_per_email_blocks_after_threshold` is wall-clock
   flaky.** Documented, not fixed — unrelated area.
6. **Nothing is deployed.** Fly is billing-blocked; production behaviour is
   unverified and unclaimed.
7. **No latency improvement is claimed.** Request counts were measured; wall-clock
   latency under production load was not.
8. **Concurrent writers racing to persist the same fact** remain untested, as in
   the previous report.
9. **The 90-day freshness window is a policy choice**, not a measured one.
