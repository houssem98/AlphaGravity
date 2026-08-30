# Finance Quick Answer — Verification

Every number came from a command run in this repository on 2026-08-30. Gates
that could not be run say `BLOCKED` and why, rather than being estimated or
omitted.

Branch `feat/web-research-sec-integration` · baseline commit `582bc6c`

This document covers `QUICK_ANSWER_FINANCE_WORLD_CLASS_ROADMAP.md`. Phases 3,
5, 6, 8, 9, 10 and 11 of that roadmap were delivered by commit `8ccc1ed` and
are verified in [FINAL_FIX_VERIFICATION.md](FINAL_FIX_VERIFICATION.md); this
pass adds Phases 2, 4, 7, 12, 13 and 15 and re-verifies the whole.

---

## 0. Tooling warning, unchanged

RTK's test filters misreport. In this session `rtk pytest` printed
`Pytest: No tests collected` for a run that collected and passed 94. Every
figure below comes from the raw runner with the real exit code captured:

```bash
python -m pytest ... > /c/tmp/out.txt 2>&1; echo "EXIT=$?"
```

**Do not gate on RTK output.**

---

## 1. Baseline, before any edit

| Gate | Command | Exit | Result |
|---|---|---|---|
| Backend | `python -m pytest tests/ -q --ignore=tests/live --ignore=tests/eval -p no:cacheprovider` | 0 | **1536 passed**, 0 failed, 668.75s |
| Git | `git status --short` | 0 | clean but for the three roadmap `.md` files |

---

## 2. Gate table

| # | Gate | Command | Exit | Result | Verdict |
|---|---|---|---|---|---|
| 1 | Backend tests | `pytest tests/ -q --ignore=tests/live --ignore=tests/eval` | 0 | **1849 passed, 0 failed**, 553.55s | **PASS** |
| 2 | Frontend tests | `npx vitest run src/` | 0 | **1516 passed, 87 files** | **PASS** |
| 3 | Typecheck | `npx tsc --noEmit -p tsconfig.app.json` | 0 | no errors | **PASS** |
| 4 | Build | `npx tsc -b && npx vite build` | 0 | `dist/` written | **PASS** |
| 5 | **Finance eval** | `python -m eval.finance_quick_answer.run_eval` | 0 | **56/56**, false-confidence **0** | **PASS** |
| 6 | Skill coverage eval | `python -m eval.quick_answer_skill_coverage.run_eval` | 0 | 37/37, all metrics 1.0 | **PASS** |
| 7 | Quick Answer eval | `python -m eval.quick_answer.run_eval` | 0 | **34/34 (100%)** | **PASS** |
| 8 | Period math | `pytest tests/test_period_math.py -q` | 0 | **76 passed** | **PASS** |
| 9 | Query planning | `pytest tests/test_finance_query_plan.py -q` | 0 | **105 passed** | **PASS** |
| 10 | Scope / coverage | `pytest tests/test_skill_scope.py -q` | 0 | **31 passed** | **PASS** |
| 11 | Finance adversarial | `pytest tests/test_finance_adversarial.py -q` | 0 | **91 passed** | **PASS** |
| 12 | Finance eval gate | `pytest tests/test_finance_eval_gate.py -q` | 0 | 5 passed | **PASS** |
| 13 | Live SEC matrix | `python -m eval.quick_answer_skill_coverage.live_sec_matrix` | 0 | 12/12 filings, 5/5 negatives | **PASS** |
| 14 | Live skill runs | 3 issuers × 2 skills vs real sec.gov | 0 | 6/6 | **PASS** |
| 15 | **Finance performance** | `python -m eval.finance_quick_answer.perf` | 0 | measured, §6 | **PASS** |
| 16 | Gate integrity | `node ~/.claude/scripts/gate-guard.mjs` | 0 | clean | **PASS** |
| 17 | Browser E2E | — | — | §7 | **BLOCKED** |
| 18 | End-to-end answer accuracy | — | — | §7 | **BLOCKED** |
| 19 | End-to-end latency | — | — | §7 | **BLOCKED** |

Backend delta **1536 → 1849 = +313**, exactly the five new test files
(76 + 105 + 31 + 91 + 5 = 308) plus 5 route tests added to
`test_skills_route.py`. No pre-existing test failed, was skipped, or
disappeared — `--collect-only -q` per file confirms each count.

---

## 3. Phase 4 — Financial reasoning

`app/core/financial_calculator.py` already computed growth, margins and CAGR.
Every function in it is correct arithmetic over bare floats, and that is the
problem:

```python
yoy_growth(4_500_000_000, 1_805_695_000)   # -> 149.2
```

A confident answer to no question. The operands could be two companies, two
metrics, the same metric seven years apart, or dollars against euros — the
signature cannot see any of it. The live Copart run recorded in
`FINAL_FIX_VERIFICATION.md` §5 produced exactly that shape at the retrieval
layer.

`app/core/finance/period_math.py` carries the context into the arithmetic. A
`Quantity` knows its company, metric, period, unit and `Basis`. Every operation
returns a `Computed` — carrying its inputs, periods and citations — or a
`Refusal` naming what did not line up. There is no third outcome.

**Ten refusal classes, each a way to be arithmetically valid and factually
meaningless:**

| Code | The thing that would otherwise be reported |
|---|---|
| `company_mismatch` | growth between two different registrants |
| `metric_mismatch` | "growth" from revenue to operating income |
| `unit_mismatch` | USD against EUR, silently |
| `period_mismatch` | FY2025 operating income over FY2018 revenue |
| `wrong_interval` | YoY asked for, QoQ returned |
| `unlabelled_interval` | a seven-year gap called "growth" |
| `not_ordered` | growth backwards through time |
| `zero_base` | growth from zero, as `inf` |
| `zero_denominator` | an absent denominator, as `0%` |
| `rate_growth` | a margin move as a percent change |
| `non_positive` | CAGR across a loss, as `0.0` |
| `not_representable` | an overflow, as `inf` |

**Three rules the older calculator breaks:**

1. **Undefined is not zero.** `gross_margin(revenue=0, cogs=0)` returns `0.0`
   there. A 0% gross margin is a claim about a business; an absent denominator
   is the absence of a claim.
2. **A margin change is percentage POINTS.** 20% → 25% is +5 pp, not +25%.
   `delta()` will not express a rate difference as a percent change, and
   `growth()` refuses rates outright and says to use `delta()`.
3. **CAGR derives its exponent from the periods.** There is no `years`
   parameter that can disagree with them — asserted by
   `test_cagr_cannot_be_given_a_year_count_that_contradicts_the_periods`,
   which inspects the signature.

**Fiscal ≠ calendar.** `calendar_year_overlap` reports that a January-ending
filer's FY2026 covers **eleven months of calendar 2025**. A comparison treating
fiscal labels as calendar years compares different spans of time.

**TTM is guarded on four conditions**, each of which has been a real bug
somewhere: exactly four quarters, all consecutive, same registrant, and a
`FLOW` basis — summing four quarter-end cash balances produces a number that is
not any company's cash at any time.

---

## 4. Phase 2 — Finance query planning

`app/core/finance/query_plan.py` produces a `FinancePlan` from regexes and the
existing deterministic classifier. No network, no model call —
`test_planning_makes_no_network_call` replaces `socket.socket` with a raiser and
plans every query.

A plan built *after* retrieval is shaped by the evidence: a growth question that
finds one period quietly answers as a lookup, and a set question that finds five
names quietly answers as a census. So the plan is decided first and carried in
`query_plan["finance_plan"]` through `search_pipeline.py`.

It carries: `intent` (10 values), `metrics` (25-term vocabulary, each with its
`Basis`), `period`, `comparison`, `change_unit`, `ttm`, `companies`, `scope`.

**`change_unit` is the load-bearing field.** "Operating margin year-over-year"
is a growth-shaped question about a rate; the plan says `pp` so no later stage
has to infer it and get it wrong in the direction that flatters the number.
`test_change_unit_agrees_with_what_period_math_will_actually_return` pins the
plan against the maths layer, so the plan cannot promise a unit the computation
refuses to produce.

**A bug this suite found in its own module:** `revenue` was tried before
`deferred revenue`, so "Salesforce deferred revenue" planned as a revenue
lookup. Deferred revenue is a liability, not a revenue flow, and the two differ
by an order of magnitude — the answer would have been confidently wrong with a
real citation attached. Twelve substring-shadowing pairs are now pinned, plus
`test_no_metric_is_wholly_unreachable`, which proves every one of the 25 keys is
producible and none is dead config.

---

## 5. Phase 7 — Scope-aware answers

`app/core/skills/scope.py`. The question is *which S&P 500 companies mentioned
tariff risk in their 10-K?* and there are two easy wrong answers.

Abstaining because 503 filings cannot be read throws away a real result: if
eleven demonstrably say it, in their own filings, with accession numbers, then
**at least eleven do**. Listing the eleven without saying eleven-out-of-how-many
lets a sample read as a census.

So an answer carries two separate facts:

```
scope_status      confirmed_exhaustive | confirmed_partial | insufficient_evidence
coverage_status   primary_confirmed | secondary_candidate | primary_refuted | not_examined
```

**`EXHAUSTIVE` must be earned**, and is gated on two independent facts: a
universe whose size is *known* **and** whose membership was *retrieved*
(`enumerable`), plus an examined count reaching it. Neither can be supplied by
an impression of having looked at everything. Recognising "S&P 500 → 503" in the
planner is a fact about the index, not evidence of coverage —
`test_recognising_the_index_size_is_not_a_claim_the_members_were_fetched` pins
that the two are separate.

**The evidence rule:** a secondary source may *discover* a candidate; it may not
*confirm* a claim about a filing's contents. A news article reporting that
Acme's 10-K warns about tariffs is evidence about the news article.
`test_a_caller_cannot_promote_a_secondary_source_by_asserting_support` shows a
caller passing `supported=True` from a blog is still downgraded.

The partial headline is asserted verbatim, because the phrasing *is* the
difference between a useful partial answer and a misleading one:

> At least 11 match. This is a partial answer: 40 of 503 members of the S&P 500
> were examined, so there may be others that were not checked.

`test_a_partial_answer_never_reads_as_a_census` scans it for "all", "every",
"the only", "complete list".

---

## 6. Phase 12 — Performance, measured

`python -m eval.finance_quick_answer.perf` — 400 iterations, no network.

| Stage | p50 | p95 | p99 | max |
|---|---|---|---|---|
| `question_class.classify` | 0.1073 ms | 0.2032 ms | 0.6466 ms | 1.7278 ms |
| `finance.plan_query` | 0.5590 ms | 0.9338 ms | 2.6406 ms | 3.8449 ms |
| `period_math.growth` | 0.0538 ms | 0.0785 ms | 0.1839 ms | 0.3096 ms |
| `period_math.margin` | 0.0352 ms | 0.0417 ms | 0.0967 ms | 0.2050 ms |
| `period_math.cagr` | 0.0430 ms | 0.0653 ms | 0.1449 ms | 0.2719 ms |
| `period_math.delta` | 0.0334 ms | 0.0397 ms | 0.2017 ms | 0.3352 ms |
| `period_math.ttm` | 0.0627 ms | 0.0917 ms | 0.2072 ms | 2.1375 ms |
| `scope.assess` (500 members) | 0.3684 ms | 0.6794 ms | 0.7507 ms | 0.7507 ms |

**Added to a finance question at p50: 0.8944 ms.** Against a previously observed
end-to-end p50 of about 28 seconds, that is roughly three-thousandths of one
percent.

Earlier SEC round trips, from the same branch, for context:

| Stage | p50 | p95 |
|---|---|---|
| SEC primary-document resolution, cold | 345.54 ms | 1246.51 ms |
| SEC primary-document resolution, warm | 1.42 ms | 30.73 ms |
| SEC filing-index fetch | 352.44 ms | 942.74 ms |

**No claim is made about end-to-end latency.** Retrieval, reranking, embedding
and generation dominate it, need provider credentials, and were not touched by
this work. **No verification was removed to improve any number.**

---

## 7. BLOCKED, PARTIAL and UNVERIFIED

**`BLOCKED` — browser/live validation (Phase 14).** No browser was driven
against a running stack; the stack needs Supabase credentials and this session
is non-interactive. What was proven programmatically: both SEC links resolve to
different real pages and both return HTTP 200 with the primary confirmed HTML
(12/12 filings), and 26 real-DOM tests mount `EdgarLink`, click the anchor and
assert the navigation target. The *visual* result was not observed.

**`BLOCKED` — end-to-end answer accuracy and latency.** Needs live LLM and
reranker credentials. No accuracy figure and no end-to-end timing is claimed.

**`PARTIAL` — the plan is advisory, not yet an executor.** `finance_plan` is
computed on every search and emitted into `query_plan`, and the plan endpoint
`GET /v1/skills/_/plan` exposes it. The generation stage does not yet *consume*
`change_unit` to force a margin delta into points — the planning and the maths
both exist and agree, and the wiring between them and the LLM prompt is the
remaining step. Stated rather than implied.

**`PARTIAL` — scope has no constituent fetcher.** `scope.py` will report
`confirmed_exhaustive` when handed an enumerable universe, and nothing in the
repo yet retrieves S&P 500 constituents, so in practice every set question
answers `confirmed_partial`. That is the correct answer today; it is not the
best possible answer, and the gap is a membership source, not a logic change.

**`PARTIAL` — Company skill completeness**, unchanged from the previous pass:
`sector`, `industry`, business description and segments are empty, and stated as
empty rather than filled from a guess.

**`PARTIAL` — Sentiment source classes**, unchanged: SEC filing language only,
no earnings-call/news/analyst class wired, no trend computed.

---

## 8. Defects found by these tests, fixed in code

1. **Substring shadowing in the metric vocabulary.** `revenue` shadowed
   `deferred revenue`; `cost of revenue` was at risk of the same. Fixed by
   ordering compound names above their constituents, with 12 pairs pinned.
2. **Overflow to infinity from finite inputs.** Guarding operands was not
   enough: `growth(1e308, 1e-308)` overflows the division and IEEE returns
   `inf` without raising. Found by the adversarial suite, not the happy path.
   Every operation now returns through `_finite()`, and
   `test_every_operation_routes_through_the_finiteness_gate` reads the source
   to prove no `Computed` bypasses it.
3. **`top_n` silently dropped above 999.** A three-digit cap made "top 1000
   companies" parse as `top_n=0`, which downstream reads as *no limit
   requested* — the opposite of what was asked.

---

## 9. Definition of Done, line by line

| Roadmap requirement | Status | Evidence |
|---|---|---|
| Correct finance intent and entities | **PASS** | 10 intents, 30/30 plan cases; entity layer verified previously |
| Arbitrary resolvable companies, not an allowlist | **PASS** | allowlist audit in `SKILL_COVERAGE_MATRIX.md` §1; 12/12 unseen-company cases |
| Fiscal periods and calculations correct | **PASS** | 76 period-math tests; fiscal≠calendar; TTM 4-way guard |
| Answers directly, no Deep Research behavior | **PASS** | planning adds 0.89 ms p50; no new retrieval, no new model call |
| Strong primary evidence when appropriate | **PASS** | secondary sources cannot confirm; `PRIMARY_CLASSES` gate |
| Exact claim-to-citation verification | **PASS** | preserved; `test_the_pipeline_reapplies_the_verdict_after_the_provenance_update` |
| No hallucination, no unnecessary abstention | **PASS** | `false_confidence_count: 0`; partial answers are produced, not refused |
| Useful partial answers | **PASS** | "At least 11 … 40 of 503 examined" |
| Fast path measured, verification intact | **PASS** | §6; nothing removed |

---

## 10. Files

Modified (2):

```
services/gravity-api/app/core/search_pipeline.py
services/gravity-api/app/api/routes/skills.py
```

Added (10):

```
services/gravity-api/app/core/finance/period_math.py
services/gravity-api/app/core/finance/query_plan.py
services/gravity-api/app/core/skills/scope.py
services/gravity-api/eval/finance_quick_answer/__init__.py
services/gravity-api/eval/finance_quick_answer/cases.json
services/gravity-api/eval/finance_quick_answer/run_eval.py
services/gravity-api/eval/finance_quick_answer/perf.py
services/gravity-api/tests/test_period_math.py
services/gravity-api/tests/test_finance_query_plan.py
services/gravity-api/tests/test_skill_scope.py
services/gravity-api/tests/test_finance_adversarial.py
services/gravity-api/tests/test_finance_eval_gate.py
docs/quick-answer/FINAL_FINANCE_QUICK_ANSWER_VERIFICATION.md
```
