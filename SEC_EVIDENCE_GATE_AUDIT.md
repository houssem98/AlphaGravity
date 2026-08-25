# SEC Verified-Evidence Gate — Audit

Execution of `VERIFY_SEC_EVIDENCE_GATE.md` against the AlphaGravity repository.

Every number below was produced by running the code on this machine. Claims are
labelled **VERIFIED**, **FAILED**, **BLOCKED**, or **NOT TESTED**. Nothing is
labelled VERIFIED on the strength of an earlier report.

---

## 1. Gate implementation file

**VERIFIED** — `services/gravity-api/app/core/retrieval/evidence_gate.py`

Pre-existing (commit `e6678b7`, hardened in `517da60`). This execution renamed the
entry point and added the shared routing rule; it did not create a second gate.

## 2. Gate function

**VERIFIED** — `check_verified_local_evidence(...)`

Renamed from `check()` in this change, per §5's requirement that the decision be
easy to find. It is the only entry point; `search_pipeline` calls it and nothing
re-makes the decision downstream. The §5 comment is on the function itself:

> SEC is only invoked when no exact verified local evidence satisfies the
> financial query. This function is that decision; nothing downstream re-makes
> it and no ranking stage can override it.

Supporting functions in the same module:

| Function | Role |
|---|---|
| `evaluate(rows, ...)` | pure decision over candidate rows |
| `check_verified_local_evidence(...)` | the `financials` lookup + `evaluate` |
| `channels_after_gate(channels, decision)` | the routing rule (new in this change) |
| `encode_provenance` / `decode_provenance` | the evidence identity record |
| `GateDecision.telemetry()` | §6 observability |

## 3. Orchestrator integration point

**VERIFIED** — `services/gravity-api/app/core/search_pipeline.py`

- `SearchPipeline._evidence_gate(query, tickers, company_terms)` — line ~308.
  Derives ticker, CIK, concept, fiscal year and quarter deterministically from
  the question using the same parsers the EDGAR channel uses, then calls the gate.
- `SearchPipeline.search()` — line ~757. Runs the gate **before** the retrieval
  fan-out and applies the decision:

```python
from app.core.retrieval import evidence_gate as _eg

_gate = await self._evidence_gate(query, _tickers, _names)
# SEC is only invoked when no exact verified local evidence
# satisfies the financial query.
_channels = _eg.channels_after_gate(_channels, _gate)
```

Before this change the pipeline inlined `if not _gate.sec_invoked: [c for c in
_channels if c != "edgar"]` and the tests re-implemented that same line. Both now
call `channels_after_gate`, so a test cannot stay green against a pipeline that
stopped honouring the decision.

**Runtime-verified**, not only asserted — the real method on a real instance:

```
runtime decision : VERIFIED_LOCAL_HIT | sec_invoked: False
telemetry        : {'local_evidence_status': 'VERIFIED_LOCAL_HIT', 'sec_invoked': False,
                    'sec_skip_reason': 'VERIFIED_LOCAL_HIT',
                    'gate_reason': 'exact verified local evidence', 'gate_conflicts': 0}
channels_after   : ['dense', 'bm25']
```

## 4. Evidence model used

**VERIFIED** — the existing `financials` table. No second evidence model, no new
table, no new database.

Identity travels in the existing `source_section` column as structured text
(`PROVENANCE_KIND = "sec_verified_v1"`), because `financials` has no columns for
CIK, period bounds or verification state and adding them is a schema migration
this work was not authorised to make. Fields carried:

`src`, `cik`, `concept`, `fy`, `fq`, `dim`, `scope`, `fact`, `start`, `end`,
`accn`, `form`, `unit`, `filed`, `restated`, `ver`, `pv`

Written by `app/core/retrieval/fact_persistence.py::fact_row()`.

## 5. Verification conditions

**VERIFIED** — a row bypasses SEC only when **all** hold:

1. `id` carries the `_xbrl` suffix (exact-XBRL population)
2. provenance decodes and is `sec_verified_v1`
3. ticker matches
4. CIK matches when the question resolved one
5. concept is in `concept_family(concept)` — the metric family, not one tag name
6. fiscal year and quarter match
7. period start/end present
8. dimension matches when the question names a breakdown; a consolidated row may
   not answer a segment question
9. unit matches
10. `ver == "verified"`
11. `created_at` present and within `DEFAULT_MAX_AGE_DAYS = 90`
12. no second row contradicts the value

Anything short of that is `LOCAL_UNVERIFIED` or `LOCAL_CONFLICT` — never a
silent miss (§3).

## 6. Test file names

| File | Tests | Role |
|---|---|---|
| `services/gravity-api/tests/test_verified_evidence_gate.py` | 17 | **new** — §7 A–E at the SEC client boundary |
| `services/gravity-api/tests/test_evidence_gate.py` | 37 | gate decision logic, channel-level counts |
| `services/gravity-api/tests/test_sec_query_time_regression.py` | 37 | EDGAR channel behaviour |
| `services/gravity-api/tests/test_sec_fact_persistence.py` | 17 | the persisted row's shape |
| `services/gravity-api/tests/test_sec_amendments.py` | 18 | restatement authority |
| `services/gravity-api/tests/test_question_class.py` | 47 | pre-retrieval classification |

### Why a new file rather than extending the old one

`test_evidence_gate.py` counts calls on stub channel objects. A stub that is
never called proves the orchestrator skipped a channel — it does not prove no
HTTP request reached sec.gov, which is what §8 asks for. The new file injects the
counting client as `EdgarSearch(http_client=...)`, which is the object `_client()`
returns, so **both** SEC paths are counted: `_get_json` (ticker map,
companyconcept) and the client handed to `resolve_dimensional_fact` (filing
index, XBRL instance).

## 7. Test names

**TEST A — verified local hit**
- `TestA_VerifiedLocalHit::test_no_sec_request_is_made`
- `TestA_VerifiedLocalHit::test_the_skip_reason_is_reported`

**TEST B — empty local corpus**
- `TestB_EmptyLocalCorpus::test_sec_is_called`
- `TestB_EmptyLocalCorpus::test_the_exact_filing_and_fact_come_back_verified`
- `TestB_EmptyLocalCorpus::test_the_instance_document_was_actually_fetched`
- `TestB_EmptyLocalCorpus::test_the_answer_is_persistable`

**TEST C — second query after persistence**
- `TestC_SecondQueryAfterPersistence::test_the_second_ask_makes_no_sec_request`

**TEST D — unverified local data**
- `TestD_UnverifiedLocalData::test_a_legacy_backfill_row_still_calls_sec`
- `TestD_UnverifiedLocalData::test_a_row_marked_unverified_still_calls_sec`
- `TestD_UnverifiedLocalData::test_a_row_with_no_timestamp_still_calls_sec`
- `TestD_UnverifiedLocalData::test_it_is_not_reported_as_a_plain_miss`

**TEST E — conflicting local data**
- `TestE_ConflictingLocalData::test_two_disagreeing_rows_call_sec`
- `TestE_ConflictingLocalData::test_a_stale_row_calls_sec`
- `TestE_ConflictingLocalData::test_it_is_not_reported_as_a_plain_miss`

**§5 / §9 — the rule actually controls execution**
- `TestTheRoutingRuleIsTheOneThePipelineUses::test_a_verified_hit_removes_edgar_and_nothing_else`
- `TestTheRoutingRuleIsTheOneThePipelineUses::test_every_sec_state_leaves_the_fan_out_intact`
- `TestTheRoutingRuleIsTheOneThePipelineUses::test_an_absent_decision_never_silently_skips_sec`

## 8. SEC call-count results

**VERIFIED** — measured, not asserted. `EDGAR` = channel invocations;
`SEC HTTP` = requests that actually reached the injected SEC client.

```
SCENARIO                          STATUS               EDGAR  SEC HTTP
----------------------------------------------------------------------
A verified local hit              VERIFIED_LOCAL_HIT       0         0
B empty local corpus              LOCAL_MISS               1         5
C second query (persisted)        VERIFIED_LOCAL_HIT       0         0
D unverified local                LOCAL_UNVERIFIED         1         5
E conflict (two values)           LOCAL_CONFLICT           1         5
E conflict (stale)                LOCAL_CONFLICT           1         5
```

Required by §8: verified 0, miss 1, unverified 1, conflict 1 — **all match**.

The 5 HTTP requests behind one EDGAR invocation on a miss:

```
https://www.sec.gov/files/company_tickers.json
https://data.sec.gov/api/xbrl/companyconcept/CIK0001045810/us-gaap/RevenueFromContractWithCustomerExcludingAssessedTax.json
https://data.sec.gov/api/xbrl/companyconcept/CIK0001045810/us-gaap/Revenues.json
https://www.sec.gov/Archives/edgar/data/1045810/000104581025000230/index.json
https://www.sec.gov/Archives/edgar/data/1045810/000104581025000230/nvda-20251026_htm.xml
```

## 9. NVDA empty-corpus result

**VERIFIED** — `LOCAL_MISS` → SEC → exact fact:

```
value                : 51,215,000,000 USD
accession            : 0001045810-25-000230
CIK                  : 1045810
form                 : 10-Q
verification_status  : verified
dimensions           : [{'axis': 'srt:ProductOrServiceAxis',
                         'member': 'nvda:DataCenterMember'}]
```

The segment figure exists **only** in the filing's XBRL instance —
`companyconcept` cannot carry it — and
`test_the_instance_document_was_actually_fetched` asserts the instance was
fetched, so the number came from where the citation says it did.

## 10. Persistence result

**VERIFIED** — with one correction found during this execution.

TEST C initially **FAILED**: the row `fact_persistence.fact_row()` actually
produces was judged `LOCAL_UNVERIFIED`, reason `local row has no usable
timestamp`. `fact_row` does not set `created_at`; the column carries a database
default that Postgres assigns on insert.

This is a **test-harness gap, not a production defect**, and that was confirmed
against the live table rather than assumed: query-time rows `CROX`, `DUOL`,
`FIVE` and `WING` all carry non-null `created_at` that no writer gave them. The
harness had appended the pre-insert dict, a row shape that never reaches the gate
in production. `_as_stored()` now models the insert.

Worth recording plainly: `test_evidence_gate.py`'s own TEST C passed throughout,
because it appends a hand-built `_row()` rather than the real persisted row. The
round-trip through `fact_row()` is what exposed the gap.

The assertion was **not** weakened — `status == VERIFIED_LOCAL_HIT` still stands,
and the observed behaviour was pinned by a **new** test,
`test_a_row_with_no_timestamp_still_calls_sec`, which fails closed.

## 11. Unverified-local result

**VERIFIED** — `LOCAL_UNVERIFIED`, EDGAR = 1, SEC HTTP = 5, for all three of:
a legacy `xbrl_companyfacts` backfill row, a row whose provenance says
`ver=unverified`, and a row with no `created_at`. Reported as its own state, not
folded into `LOCAL_MISS`.

## 12. Conflict result

**VERIFIED** — `LOCAL_CONFLICT`, EDGAR = 1, SEC HTTP = 5, for two rows carrying
different values for the same fact, and for a row older than the 90-day window.

## 13. LOOP results

**VERIFIED (pre-existing failures, unchanged)** — `node scripts/loop-lint.mjs`:

```
37 loop(s), 8 failing, 41317 prompt chars total
```

The 8 failures are pre-existing and deliberate (recorded in the repo's loop
history). This change adds no loop files and touches none. Governance:

```
governance · docs/COMMAND_TERMINAL_V2_ROADMAP.md · 10/10 closed,
             14 iterations logged, 0 violation(s)
```

## 14. Graph-lint result

**VERIFIED** — `node scripts/graph-lint.mjs`:

```
8 graph(s), 0 drifted, 0 decorative
```

## 15. Gate-guard result

**VERIFIED** — `node ~/.claude/scripts/gate-guard.mjs`:

```
gate-guard: clean · HEAD..working tree
```

No assertion was deleted, muted, or loosened. The one test file edited for
reasons other than addition (`test_evidence_gate.py`) changed only the imported
function name and replaced its private copy of the routing rule with the
production function — a strengthening, since the test now exercises the code the
pipeline runs.

---

## 16. End-to-end through the real `SearchPipeline.search()`

**VERIFIED** — `services/gravity-api/tests/test_search_pipeline_sec_e2e.py`, 13 tests.

This closes the item previously recorded here as NOT TESTED. `SearchPipeline` is
the real class, `RetrievalOrchestrator` the real orchestrator, `EdgarSearch` the
real channel, and the gate runs where the pipeline runs it. Nothing substitutes
for the pipeline itself.

Mocks sit only on boundaries that leave the process: the LLM router and query
understander (inference APIs), SEC HTTP (`EdgarSearch(http_client=...)`, recorded
fixtures), and Supabase (`sb_select` for the gate's lookup, `sb_insert` for
persistence). `reranker`, `citation_validator` and `semantic_cache` are passed as
`None`, which the pipeline already supports — they are Cohere and Redis, and
neither participates in the SEC decision.

Measured, through the real pipeline:

```
SCENARIO                        GATE STATUS         SEC?   HTTP  PERSIST
------------------------------------------------------------------------
1 verified local                VERIFIED_LOCAL_HIT  False     0        0
1 verified (cold channel)       VERIFIED_LOCAL_HIT  False     1        0
2 local removed                 LOCAL_MISS          True      4        1
3 identical query again         VERIFIED_LOCAL_HIT  False     0        0
4 unverified local              LOCAL_UNVERIFIED    True      4        1
4 stale local                   LOCAL_CONFLICT      True      4        1
5 conflicting local             LOCAL_CONFLICT      True      4        1

Scenario 2 answer       : NVIDIA reported Data Center revenue of $51,215,000,000 in Q3 FY2026.
Scenario 2 persisted id : NVDA_Revenues_DataCenter_FY2026Q3_xbrl
Scenario 2 persisted val: 51215000000
```

The pipeline log confirms the decision is acted on, not merely computed:

```
question_classified  question_class=EXACT_FINANCIAL_FACT needs_primary_source=True
evidence_gate        local_evidence_status=VERIFIED_LOCAL_HIT sec_invoked=False
retrieval_complete   channels_queried=['structured']          ← edgar removed
```

### Two findings this run produced

**A verified hit costs one SEC request on a cold channel, not zero.** The gate's
own CIK resolution downloads `https://www.sec.gov/files/company_tickers.json`.
That is identity, not facts: no filing, no companyconcept, no XBRL instance. In
production `EdgarSearch` is one long-lived channel caching that map for a day, so
a steady-state query makes zero requests — which is what row 1 shows, with the
map warmed exactly as production warms it. Rather than round this to zero, it is
asserted:
`test_a_cold_channel_costs_one_identity_request_and_no_facts` pins the URL list
to exactly `["https://www.sec.gov/files/company_tickers.json"]` and asserts no
`data.sec.gov` or `Archives` request occurs.

**The emitted citation does not carry the accession number.** The `sources` event
and the answer's `citations` carry the exact figure, the ticker, the filing title
(`NVDA 10-Q — FY2026 Q3`) and the filing date, but the accession
`0001045810-25-000230` appears in neither, and the citation `url` is the generic
EDGAR *browse* URL rather than the filing. The accession **is** present on the
retrieval result's metadata and **is** written to persistence — only the
client-facing payload drops it. This is the same known gap as the unimplemented
`/v1/documents/filing-url`. It is recorded here rather than asserted, because a
test locking in current behaviour would fail the day someone fixes it. The
positive assertions
(`test_the_exact_verified_fact_reaches_the_answer_path`,
`test_the_citation_names_the_filing_it_came_from`) check what does arrive.

### Test names

```
TestScenario1_VerifiedLocalFact::test_the_pipeline_makes_zero_sec_calls
TestScenario1_VerifiedLocalFact::test_the_pipeline_still_answers
TestScenario1_VerifiedLocalFact::test_a_cold_channel_costs_one_identity_request_and_no_facts
TestScenario2_LocalFactRemoved::test_the_pipeline_calls_sec
TestScenario2_LocalFactRemoved::test_the_instance_document_is_fetched
TestScenario2_LocalFactRemoved::test_the_exact_verified_fact_reaches_the_answer_path
TestScenario2_LocalFactRemoved::test_the_citation_names_the_filing_it_came_from
TestScenario2_LocalFactRemoved::test_the_fact_is_persisted
TestScenario2_LocalFactRemoved::test_the_persisted_row_carries_verified_provenance
TestScenario3_IdenticalQueryAgain::test_the_second_run_makes_zero_sec_calls
TestScenario4_StaleOrUnverifiedLocalFact::test_an_unverified_row_calls_sec
TestScenario4_StaleOrUnverifiedLocalFact::test_a_stale_row_calls_sec
TestScenario5_ConflictingLocalFact::test_two_disagreeing_rows_call_sec
```

---

## What was NOT done
- **BLOCKED** — deployment. Fly rejects both the remote builder and
  `--local-only` with `status 403: Your account has overdue invoices`. Production
  remains on version 228 (2026-07-07). None of this is running in production.
- **NOT TESTED** — behaviour against the live SEC API. All SEC responses in these
  tests are recorded fixtures, so the numbers are deterministic and offline.
