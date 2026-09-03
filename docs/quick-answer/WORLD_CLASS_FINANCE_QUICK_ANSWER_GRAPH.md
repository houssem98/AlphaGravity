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
| N2 | Cache read | `search_pipeline.py:673` · `self.cache.get` | N1 | N17 **or** N3 (refused) | A replayed answer must be at least as safe as a fresh one | **TESTED — holds** (`504246f`) | `test_cache_gate_provenance.py`, `test_cache_gate_enforcement.py` (5) | blocking |
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
| **D2** | Cache bypasses contract + all verification | **CLOSED** (`504246f`, L1) | `6c72822` stored the verdict; `504246f` acts on it — `gate_verdict_failed` refuses a hit whose stored `contract_gate.passed` is `false`, falling through to recompute. Observed red first: the poisoned entry replayed verbatim as `cache_hit:true`. `test_cache_gate_enforcement.py` (5). **Accepted residue:** a hit still skips N3–N15 when the stored verdict passed or was never recorded. That is replay of an answer already gated, not an ungated answer; re-running the pipeline per hit costs the cache's whole purpose and is not taken without measurement. |
| **D3** | ratio_engine bypasses typed Quantity + provenance | **CLOSED (period)** / **BLOCKED (accession)** (`54f730e`, L3) | `_fetch_facts` returns typed `Fact`s carrying `fiscal_year`, `unit`, `document_id`, `concept`. Same-period ratios must agree; `*_prior` ratios must be exactly one year apart; an unknown year is not a mismatch. `RatioResult` now records `numerator_period`/`denominator_period` — the period each operand *came from*, not the one that was asked for. `test_ratio_engine_period_typing.py` (8). **Accession BLOCKED at the schema:** `supabase/migrations/0002_financials.sql` defines no accession column, so there is nothing to carry; `document_id` is the nearest real handle. Unblocking needs a schema change plus a backfill, not a code change. Deliberately not `period_math.Quantity`: that class refuses to hold a non-finite value, and the engine must carry a bad figure far enough to report it as a refusal with a reason. |
| **D4** | Arbitrary duplicate-fact selection | **LIVE** | `ratio_engine.py:1127-1128` — `base.setdefault(mkey, float(val))` under the comment `# first non-null wins (CORE concept preferred by insert order)`. PostgREST guarantees no order without `ORDER BY`. |
| **D5** | Non-finite values escape ratio_engine | **CLOSED** (`ad2fd7a`, L5) | Was: `grep -c isfinite ratio_engine.py` = **0**. Now routes through `period_math.is_finite_value` — one shared gate, imported, with a structural test forbidding a local copy. Operands and results both gated (`1e308/1e-308` overflows out of two finite inputs), `_derive_metrics` sanitised on the way in and out, `compute` states a reason instead of returning a silent `None`. `test_ratio_engine_finiteness.py` (15). The demonstrated case was `_safe_div(1, inf) -> 0.0`: not an obvious `inf` but a plausible-looking zero. |
| **D6** | calc_guard is only a negative heuristic | **LIVE BY DESIGN** | Asserted in `test_the_guard_is_conservative_by_design`. Cannot be "fixed" without typed operands — this is D3's tail, not a separate defect. |
| **D7** | Numeric grounding is advisory, not a gate | **CLOSED by decision** (`d4ca94a`, L2) | Advisory is now the *chosen* behaviour, not the accidental one. The audit's "and nothing else" was too strong — the counts are put in the metadata event — but understated the real defect: the REST route filters metadata to declared `SearchMetadata` fields and `contract_gate`, `numeric_mismatches`, `temporal_mismatches` were **all dropped**, so D1's disproof held on the WebSocket path only. All three are now declared, `contract_gate` defaulting to `None` rather than to a pass. Escalated 2026-09-03; user chose advisory, because the false-positive rate is unmeasurable in this environment and blocking without it refuses correct answers at an unknown rate. `test_rest_metadata_verification_fields.py` (4). Still true: the fast path skips the NLI and LLM citation validators, so this remains Quick Answer's only numeric check. |
| **D8** | Evidence grader not claim-level | **CLOSED** (`5460fbb`, L6) | `6c72822` demoted the unearned perfect score to 0.8; that was a haircut, identical whether the figure was in the cited filing or nowhere near it. `_claim_is_bound` now checks the stated figure against the cited excerpts — absent from all of them scores 0.5 and names the reason. `test_rubric_claim_binding.py` (9). **The stated block did not hold:** the 220-char truncation is on the *persisted* `answer_excerpt`, while `score_answer` receives the untruncated answer with per-citation `text`. It blocks re-scoring history, not live scoring. Intentionally lenient — engages only where excerpts exist, so the prior behaviour is unchanged wherever the data cannot answer the question. |
| **D9** | Correctness accepts the number anywhere | **CLOSED** (`f2477d6`, L7) | Reproduced red before the change at `eval/head_to_head/rubric.py` (the audit's `rubric.py:286` was right): `$500,000 million` asserted with the truth in a parenthetical scored **1.0**. `_asserts` now replaces `_matches` at the grading call site — a parenthetical is an aside unless nothing outside it makes a competing claim. `test_rubric_asserted_number.py` (9), 89 existing rubric assertions unchanged. Historical impact stays **UNVERIFIABLE**: the 5 recorded runs never persisted per-case outputs, and closing the mechanism does not retroactively tell us whether it fired. |
| **D10** | Period/entity is token presence | **PARTIAL** (`3ab9bc6`, L8) | **Period half closed.** Was `token.lower() in low` over the whole reply; a figure stated for FY2024 with "fiscal 2025" mentioned elsewhere scored `period_entity` **1.0** (reproduced red). A period token now misses when every asserted-figure sentence names a different year and never the expected one — sentence scope, the granularity `_figures_attributed_to` already uses. Fires only on a positive competing period. `test_rubric_period_attachment.py` (7). **Still live: the entity half.** Deciding that a figure sentence names the wrong *company* needs a company vocabulary the grader does not have; `forbid_tokens` remains the only mechanism. Not invented, per L6's constraint against penalties the data cannot support. |
| **D11** | cases.json provenance is free-form | **CLOSED** (`2d98940`, L11) | `b777977` bound all 11 filed values to an accession by substring scan over one joined blob — which cannot say *which* filing backs *which* case. `provenance_records` now carries `{ticker, fiscal_period, metric, value, accession, concept, unit, period_end, supports}`; resolution is by identity and the 3 derived cases recompute from their own endpoints. Prose list retained as the fallback, with a consistency test against drift. `test_benchmark_provenance_schema.py` (14). **Recorded gaps, not closed:** 8 of 11 entries name no us-gaap concept (`null`, deliberately not guessed) and 2 of 11 back no case. |
| **D12** | Verification doc overstates the implementation | **PARTIAL** | Corrected in `b777977` and `6c72822`. Needs one re-audit pass at the end of this roadmap, since the doc now describes code that changed underneath it. |

**Score: 1 disproved · 7 closed · 1 blocked · 2 partial · 1 by-design.** (D3 closed on its period half, accession blocked at the schema; D10 closed on its period half.)

Closure is per-defect and carries no claim about the system. The certification
rules in the loop file remain unmet: D3 and D4 are both named there and neither
is closed, and the blind benchmark (L9) is still unrun. Open: D3, D4 (blocked), D10 (entity half), D12.

**Three graph edges did not hold.** The dependency graph places L5 downstream
of L3, on the reasoning that typed operands make non-finite protection
tractable. L5's own stated fix — "route through the existing gate rather than
writing a second one" — needed no typing at all: a shared `is_finite_value`
over bare floats closed D5 before L3 ran.

L7 and L8 sit below L2 for the same kind of reason, and the edge is likewise
not real. L2 decides whether the *pipeline* blocks on a numeric mismatch; L7
and L8 change how the *benchmark grader* scores a stated figure. Different
subsystems, different files, no shared state — `eval/head_to_head/rubric.py`
does not import the pipeline. Both closed with L2 untouched.

The pattern: these edges encode "seemed related", not a measured dependency.
Re-check each before inheriting it. L4's edge to L3 was never tested either —
L4 blocked on a live-DB gap that has nothing to do with L3.

---

## 4. Bypass paths

The real risk surface: routes around a node that is supposed to constrain the answer.

| Bypass | From → To | Skips | Status |
|---|---|---|---|
| Cache hit | N2 → N17 | N3–N15 entirely | **NARROWED** (`504246f`) — a stored `passed:false` no longer replays; a passed or unrecorded verdict still skips N3–N15 |
| Advisory verification | N11 → N12 | nothing blocks on mismatch | **ACCEPTED** (`d4ca94a`) — advisory by decision, not by accident; the mismatch counts and gate verdict now reach REST callers, who could not see them at all before |
| Report-only gate | N15 → N17 | gate never rejects | **BY DESIGN** — pinned by `test_the_gate_never_rewrites_the_answer` |
| ratio_engine injection | N8 → N13 | `period_math` typing entirely | **NARROWED** (`ad2fd7a`) — the finiteness gate is now shared with `period_math`; operand *typing* (company/metric/period/unit) is still bypassed (D3), and row selection is still order-dependent (D4) |
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
