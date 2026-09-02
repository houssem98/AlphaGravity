# Finance Quick Answer — Execution Graph

Branch `feat/web-research-sec-integration`. Baseline commit `6c72822`.

Built from `docs/quick-answer/chatgpt answer.md` (audit input, **not** proof of
anything) with every claim re-checked against the code on 2026-09-02. Line numbers are from commit `3f28856` and **will** drift — re-grep, do not trust
them. The first draft of this file cited three pre-edit line numbers in
`search_pipeline.py` and was wrong at its own stated baseline; the warning above
did not prevent that, so treat every number here as a hint, not a reference.

**Status vocabulary.** `TESTED` = a command was run and its output read.
`READ` = static inspection only, no runtime observation. `BLOCKED` = could not
be verified, with the reason. Nothing here is `PASS` on inference.

---

## 1. The path

```
USER QUESTION
  -> [N1]  QUERY CLASSIFICATION
  -> [N2]  CACHE READ ----------------+  (early return - see D2)
  -> [N3]  FINANCE PLAN               |
  -> [N4]  ANSWER CONTRACT            |
  -> [N5]  ENTITY / PERIOD RESOLUTION |
  -> [N6]  RETRIEVAL (fan-out)        |
  -> [N7]  EVIDENCE SELECTION         |
  -> [N8]  TYPED CALCULATION          |
  -> [N9]  PROVENANCE                 |
  -> [N10] CLAIM / CITATION MAPPING   |
  -> [N11] VERIFICATION               |
  -> [N12] SCOPE                      |
  -> [N13] GENERATION                 |
  -> [N14] CITATION NORMALIZATION     |
  -> [N15] FINAL GATE                 |
  -> [N16] CACHE WRITE                |
  -> [N17] API ANSWER  <--------------+
  -> [N18] UI
```

The branch on the right is the defect that matters most structurally: **N2
returns to N17 directly**, skipping N3 through N15.

---

## 2. Nodes

| ID | Node | File · symbol | Upstream | Downstream | Invariant | Status | Tests | Blocking? |
|---|---|---|---|---|---|---|---|---|
| N1 | Query classification | `search_pipeline.py` · `SearchPipeline.search` | — | N2 | Intent/complexity decided before retrieval | READ | `test_finance_query_plan.py` | advisory |
| N2 | Cache read | `search_pipeline.py:659` · `self.cache.get` | N1 | **N17** | A replayed answer must be at least as safe as a fresh one | **TESTED — violates** | `test_cache_gate_provenance.py` | blocking |
| N3 | Finance plan | `finance/query_plan.py` · `plan_finance_query` | N2 | N4 | Deterministic, no network, no model | TESTED | `test_finance_query_plan.py` (105) | advisory |
| N4 | Answer contract | `finance/answer_contract.py:138` · `build_contract` | N3 | N13, N15 | Obligations fixed before retrieval | TESTED | `test_answer_contract.py` (62) | advisory |
| N5 | Entity / period resolution | `search_pipeline.py` · resolver + 60s backoff | N4 | N6 | Never pays a timeout that cannot succeed | TESTED | `test_resolver_backoff.py` (12) | advisory |
| N6 | Retrieval fan-out | `retrieval/orchestrator.py` · `_safe_search` | N5 | N7 | Per-channel timing recorded incl. on timeout | TESTED | — | advisory |
| N7 | Evidence selection | `retrieval/fusion.py`, rerankers | N6 | N8 | — | READ | — | advisory |
| N8 | Typed calculation | `finance/period_math.py`, `calc_guard.py`, `ratio_engine.py` | N7 | N9 | Every operand carries company/metric/period/unit | **TESTED — partial** | `test_period_math.py`, `test_calc_guard.py` (52), `test_ratio_engine_provenance.py` (8) | mixed |
| N9 | Provenance | `retrieval/citation_provenance.py` · `source_payload` | N8 | N10 | A cited figure resolves to an accession | READ | `test_search_pipeline_sec_provenance_e2e.py` | advisory |
| N10 | Claim / citation mapping | **does not exist as a node** | N9 | N11 | Each asserted figure binds to the citation it came from | **ABSENT** | — | — |
| N11 | Verification | `reasoning/numeric_verifier.py`, called `search_pipeline.py:1679` | N10 | N12 | An ungrounded number does not ship | **TESTED — advisory only** | — | **advisory (should be blocking)** |
| N12 | Scope | `search_pipeline.py` · `scope_status` | N11 | N13 | Exhaustiveness is earned, not assumed | TESTED | rubric scope tests | advisory |
| N13 | Generation | `reasoning/prompts.py` · `build_user_message` + `contract_directives` | N4, N12 | N14 | Model is told every rule the gate will check | TESTED | `test_every_gate_clause_has_a_matching_directive` | advisory |
| N14 | Citation normalization | `search_pipeline.py` · `citations_out` | N13 | N15 | — | READ | `test_filing_links_contract.py` | advisory |
| N15 | **Final gate** | `finance/answer_contract.py:234` · `FinalGate.check`, called at `search_pipeline.py:2048` | N14 | N16, N17 | Reports, never rewrites | TESTED | `test_answer_contract.py` | **advisory by design** |
| N16 | Cache write | `search_pipeline.py:2074` · `self.cache.set` | N15 | — | Stores the gate verdict alongside the answer | TESTED | `test_cache_gate_provenance.py` (6) | advisory |
| N17 | API answer | `api/routes/search.py` · `/v1/search/stream` | N15 **or N2** | N18 | — | READ | `test_search_stream_contract.py` | — |
| N18 | UI | `apps/gravity-ui/src/lib/ws.ts` | N17 | — | SEC links resolve | **BLOCKED** | no spec covers `sec.gov` | — |

---

## 3. Defect nodes

Only defects named in `chatgpt answer.md`. **No invented defects.** Every status
below was re-derived from code on 2026-09-02, not copied from the audit.

| ID | Audit claim | Verified status | Evidence |
|---|---|---|---|
| **D1** | FinalGate never invoked | **DISPROVED** | `FinalGate.check` at `search_pipeline.py:2048`; verdict ships as `contract_gate` in the metadata event. The audit looked and missed it. **Do not "fix" this.** |
| **D2** | Cache bypasses contract + all verification | **PARTIAL** | Fixed in `6c72822`: gate moved above the cache write, verdict stored in `_provenance`, `replay_metadata` reports `recorded:false` when absent. **Still live:** a cache *hit* returns at N2 without re-running N3–N15. |
| **D3** | ratio_engine bypasses typed Quantity + provenance | **PARTIAL** | Fixed in `6c72822`: fetch gates on `id=like.*_xbrl`, selects `id`, label no longer claims "audited filings" nor forbids recomputation. **Still live:** values are bare floats, never `period_math.Quantity`; no accession carried. |
| **D4** | Arbitrary duplicate-fact selection | **LIVE** | `ratio_engine.py:1127-1128` — `base.setdefault(mkey, float(val))` under the comment `# first non-null wins (CORE concept preferred by insert order)`. PostgREST guarantees no order without `ORDER BY`. |
| **D5** | Non-finite values escape ratio_engine | **LIVE** | `grep -c isfinite app/core/finance/ratio_engine.py` returns **0**. `period_math` has the finiteness gate; ratio_engine never routes through it. |
| **D6** | calc_guard is only a negative heuristic | **LIVE BY DESIGN** | Asserted in `test_the_guard_is_conservative_by_design`. Cannot be "fixed" without typed operands — this is D3's tail, not a separate defect. |
| **D7** | Numeric grounding is advisory, not a gate | **LIVE** | `search_pipeline.py:1689` — mismatches produce `logger.warning("deterministic_verification_warnings")` and nothing else. Compounding: the fast path also skips the NLI and LLM citation validators, so this warning is Quick Answer's only numeric check. |
| **D8** | Evidence grader not claim-level | **PARTIAL** | Fixed in `6c72822`: all-primary keeps 1.0, mixed drops to 0.8 with the reason noted. **Still live:** no claim-to-citation binding; 0.8 is a haircut, not a verification. |
| **D9** | Correctness accepts the number anywhere | **LIVE — demonstrated** | `rubric.py:286` `_matches` iterates `numbers_in(text)` over the entire reply. Executed 2026-09-02: an answer stating the wrong headline (`$500,000 million`) with the right figure in a parenthetical scored **correctness 1.0**. Whether any of the 5 recorded benchmark runs actually hit this is **UNVERIFIABLE** — their per-case outputs were never persisted, so the mechanism is proven and the historical impact is not. |
| **D10** | Period/entity is token presence | **LIVE** | `rubric.py:426-434` — `token.lower() in low` over the whole reply, unattached to the asserted figure. |
| **D11** | cases.json provenance is free-form | **PARTIAL** | `b777977` added `test_every_filed_expectation_appears_in_the_provenance_list`, binding all 11 filed values to an accession string. **Still live:** provenance is prose, not `{accession, concept, unit, period}` fields. |
| **D12** | Verification doc overstates the implementation | **PARTIAL** | Corrected in `b777977` and `6c72822`. Needs one re-audit pass at the end of this roadmap, since the doc now describes code that changed underneath it. |

**Score: 1 disproved · 5 partial · 5 live · 1 by-design.**

---

## 4. Bypass paths

The real risk surface: routes around a node that is supposed to constrain the answer.

| Bypass | From → To | Skips | Status |
|---|---|---|---|
| Cache hit | N2 → N17 | N3–N15 entirely | **LIVE** (D2) |
| Advisory verification | N11 → N12 | nothing blocks on mismatch | **LIVE** (D7) |
| Report-only gate | N15 → N17 | gate never rejects | **BY DESIGN** — pinned by `test_the_gate_never_rewrites_the_answer` |
| ratio_engine injection | N8 → N13 | `period_math` typing entirely | **LIVE** (D3/D4/D5) |
| Fast-path validator skip | N11 | NLI + LLM CitationValidator | **BY DESIGN** — latency; documented in source |

---

## 5. Standing constraints

Carried from the roadmaps that produced this branch. They bind every loop.

- Never delete, skip, weaken, or loosen a test.
- Never hard-code a company allowlist.
- Never invent live, browser, timing, or benchmark results.
- Never turn Quick Answer into Deep Research.
- Never claim "beats ChatGPT" from green tests.
- Log exception **types**, never messages — provider errors carry DSNs and keys.
- RTK's test filters misreport; never use them as a gate.
