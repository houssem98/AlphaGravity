# Beat Top ChatGPT — Finance Quick Answer Verification

Every number came from a command run in this repository on 2026-09-02. Gates
that could not be run say `BLOCKED` and why. **No claim is made anywhere in
this document that AlphaGravity beats ChatGPT** — the head-to-head could not be
run, and the roadmap forbids inferring it from green tests.

Branch `feat/web-research-sec-integration` · baseline commit `b6d8441`

Covers `BEAT_TOP_CHATGPT_FINANCE_QUICK_ANSWER_ROADMAP.md`. Items 1–8 and 15–16
were delivered by `8ccc1ed` and `29aa6f6` and are verified in
[FINAL_FIX_VERIFICATION.md](FINAL_FIX_VERIFICATION.md) and
[FINAL_FINANCE_QUICK_ANSWER_VERIFICATION.md](FINAL_FINANCE_QUICK_ANSWER_VERIFICATION.md).
This pass adds **9, 10, 11, 12, 13, 14**.

---

## 1. The headline result: the ~23 s is found

The previous pass measured ~27 s end to end and could account for ~3.4 s of it.
The remaining ~23 s was invisible because **an unmeasured stage and a fast stage
look identical in a report**.

`app/core/finance/stage_trace.py` instruments all twelve boundaries. Across 11
live traces captured on 2026-09-02:

| Stage | n | min | median | max | stdev |
|---|---|---|---|---|---|
| **retrieval** | 11 | 5,661 | **11,324** | 24,930 | 6,338 |
| **serialization** | 11 | 12 | **4,069** | 4,103 | 1,644 |
| **entity** | 11 | 2,003 | **4,007** | 4,079 | 607 |
| generation | 11 | 1,304 | 2,456 | 13,441 | 4,453 |
| planning | 11 | 1,525 | 1,974 | 2,384 | 282 |
| rerank | 11 | 383 | 634 | 8,347 | 2,346 |
| evidence_gate | 10 | 374 | 510 | 3,108 | 831 |
| provenance | 11 | 0 | 166 | 2,536 | 866 |
| **verification** | 11 | 2 | **14** | 63 | 18 |
| context | 11 | 0 | 0 | 7 | 3 |
| merge_dedup | 11 | 0 | 0 | 0 | 0 |

`unattributed_ms` fell from ~23,000 to **~3,000–4,100**.

**Verification costs 14 ms at the median.** It is the cheapest stage measured.
Any proposal to disable it for speed is trading a correctness guarantee for
0.05% of the request, and this table is the reason that trade will not be made.

### The defect the trace exposed

`entity` was a *constant* 2003 ms or 4007 ms. **Constant time is a timeout, not
work.** The log line that should have explained it read, on every request:

```
entity_resolution_skipped   error=
```

`asyncio.TimeoutError` has an empty `str()`, so `error=str(e)` printed nothing.
Two defects, one symptom:

1. `get_resolver` rebuilds whenever its singleton is not ready. With the SEC
   ticker file unreachable it never becomes ready, so **every request paid the
   full 2 s `wait_for` timeout with no possibility of success** — twice, in the
   4007 ms case.
2. The failure was invisible, which is how a ~15%-of-request defect survived.

There were **two** such calls inside the one stage — the primary resolution and
a deterministic recovery/augment pass — which is why the span read a flat
4007 ms rather than 2003 ms. Gating only the first left half the cost in place,
and the live trace said so immediately: 4055 ms on the first request, then a
stubborn ~2023 ms.

Fixed in `search_pipeline.py`: both call sites log `error_type`, both arm a
60-second backoff, and both are gated by it.

**Measured before and after, same code path, live:**

| request | `entity` before | `entity` after |
|---|---|---|
| 1 | 4,055 ms | 2,001 ms *(pays once, arms the backoff)* |
| 2 | 2,023 ms | **0 ms** |
| 3 | 2,028 ms | **0 ms** |
| 4 | — | **1 ms** |

Total request time fell from 30,440 / 25,867 / 35,544 ms to 27,908 / 22,744 /
23,431 / 21,694 ms on the same three questions plus one. **About four seconds
per request**, for a stage that was never going to succeed.

Pinned by `tests/test_resolver_backoff.py` (12 tests), including
`test_timeout_error_really_does_stringify_to_nothing`, which asserts the premise
rather than assuming it, and `test_both_resolver_calls_are_gated_by_the_backoff`,
which fails if a third build is ever added ungated.

### Where the rest of the time is

`retrieval` at a median 11.3 s dominates, and inside it the **`dense` channel is
the slowest, at 8.6–12.0 s, repeatedly hitting its own 12 s timeout**
(`channel_timeout channel=dense timeout_s=12.0`). Per-channel numbers exist
because the fan-out costs its slowest member, not the sum — one straggler is
invisible in an aggregate while setting the floor for the whole request.

`serialization` is bimodal: min 12 ms, median 4,069 ms. That window contains
Stage 9 (cache write). **Not yet diagnosed** — stated as an open finding rather
than guessed at.

---

## 2. Gate table

| # | Gate | Command | Exit | Result | Verdict |
|---|---|---|---|---|---|
| 1 | Backend tests | `pytest tests/ -q --ignore=tests/live --ignore=tests/eval` | 0 | **2097 passed, 0 failed**, 288.51s | **PASS** |
| 2 | Frontend tests | `npx vitest run src/` | 0 | **1516 passed, 87 files** | **PASS** |
| 2b | Typecheck | `npx tsc --noEmit -p tsconfig.app.json` | 0 | no errors | **PASS** |
| 2c | Build | `npx tsc -b && npx vite build` | 0 | `dist/` written, 74s | **PASS** |
| 3 | Stage trace | `pytest tests/test_stage_trace.py -q` | 0 | **19 passed** | **PASS** |
| 4 | Answer contract | `pytest tests/test_answer_contract.py -q` | 0 | **62 passed** | **PASS** |
| 5 | Head-to-head rubric | `pytest tests/test_head_to_head_rubric.py -q` | 0 | **89 passed** | **PASS** |
| 5b | Calculator guard | `pytest tests/test_calc_guard.py -q` | 0 | **52 passed** | **PASS** |
| 5c | Ratio provenance | `pytest tests/test_ratio_engine_provenance.py -q` | 0 | **8 passed** (8 failed pre-fix) | **PASS** |
| 5d | Cache gate verdict | `pytest tests/test_cache_gate_provenance.py -q` | 0 | **6 passed** (5 failed pre-fix) | **PASS** |
| 6 | Resolver backoff | `pytest tests/test_resolver_backoff.py -q` | 0 | **12 passed** | **PASS** |
| 7 | Query planning | `pytest tests/test_finance_query_plan.py -q` | 0 | 105 passed | **PASS** |
| 8 | Pipeline E2E | `pytest tests/test_quick_answer_pipeline_e2e.py tests/test_search_pipeline_sec_e2e.py -q` | 0 | 25 passed | **PASS** |
| 9 | Gate integrity | `node ~/.claude/scripts/gate-guard.mjs` | 0 | clean | **PASS** |
| 10 | **Live benchmark** | `python -m eval.head_to_head.run_benchmark --live` | 1 | 14 cases × **5 runs**; correctness spread **0.6154–0.8462**, §3 | **PARTIAL** |
| 11 | **Blind head-to-head** | same, `--reference refs.json` | — | no reference answers exist | **BLOCKED** |
| 12 | Latency forensics | 11 live stage traces | 0 | §1 | **PASS** |
| 13 | Browser E2E | — | — | no spec covers the SEC links | **BLOCKED** |

---

## 3. The golden benchmark

`eval/head_to_head/` — 14 cases, ground truth **fetched from SEC's XBRL
`companyconcept` API on 2026-09-02**, not from any model and not from a
reference answer. The 11 filed figures each carry their accession number and
XBRL tag in the top-level `cases.json:provenance` list; the 2 derived values
(`nvda-fy2026-growth`, `odfl-fy2025-decline`) are computed from two entries in
that same list rather than filed directly. If a reference answer disagrees with
these, the reference is wrong; that is what an independent key is for.

Five live runs, 14 cases each, against a locally booted API. Run 2 followed the
first three grader defects being fixed; run 3 followed the entity-resolver
latency fix; run 4 followed `calc_guard`; run 5 followed grader bugs 4 and 5:

| Dimension | run 1 | run 2 | run 3 | run 4 | run 5 |
|---|---|---|---|---|---|
| **mean weighted** | 0.5433 | 0.7506 | 0.6866 | 0.6660 | 0.6482 |
| **correctness** | 0.6154 | **0.8462** | 0.6923 | 0.6923 | **0.6154** |
| evidence | 0.3571 | 0.7071 | 0.7071 | 0.7071 | 0.7571 |
| period_entity | 0.9167 | 0.9167 | 0.9167 | 0.9167 | 0.9167 |
| scope | 1.0 | 1.0 | 1.0 | 0.0* | 0.0* |
| latency | 0.1551 | 0.1604 | **0.1871** | 0.1843 | 0.1779 |
| false_confidence | — | — | — | 2 | **1** |
| false_abstention | — | — | — | 2 | **4** |
| reasoning | ungraded | ungraded | ungraded | ungraded | ungraded |
| clarity | ungraded | ungraded | ungraded | ungraded | ungraded |

Graded weight 62.1% throughout. The false-confidence / false-abstention split
was added after run 3. **The `evidence` row predates grader bug 7's fix** —
every run above scored a mixed citation list at 1.0, so those figures are
upper bounds and a sixth run would report them lower. They are left as
recorded rather than retro-adjusted, because a rescore against 220-character
truncated excerpts is what had to be discarded once already.

\* The run 4 and 5 scope zeros are **grader bug 6**, not a regression: a clean
refusal was scored as an overstated scan. Rescoring run 5's recorded answer with
the corrected rubric gives `scope 1.0 (coverage refused outright)`.

**The run-to-run spread is the finding, not the score.** Correctness moved
0.6154 → 0.8462 → 0.6923 → 0.6923 → 0.6154 across five runs. Reporting any
single one as "the" correctness number would be a coin flip dressed as a
measurement — which is why all five are recorded and why the head-to-head
verdict stays `UNVERIFIED` rather than being read off one sample.

**The most useful number is the split, not the mean.** Run 5: **1 false
confidence, 4 false abstentions.** Four of the five misses are the system
declining rather than guessing — which is the behaviour `calc_guard` was built
to produce, and which a single "correctness 0.6154" hides completely.

Per-case, the instability is concentrated in the derived (growth) questions.
Runs 1–3 are the ones tabulated per case; runs 4 and 5 were recorded as the
failure-mode split above rather than case by case:

| case | run 1 | run 2 | run 3 |
|---|---|---|---|
| `aapl-fy2025-growth` | FAIL | pass | FAIL |
| `nvda-fy2026-growth` | pass | pass | FAIL |
| every exact-fact case | pass | pass | pass |

Lookups are stable. Anything requiring two figures and an operation is not.

**Three of the five failures were my grader's fault, not the system's**, and
finding that out is the reason the rubric has its own test suite:

| # | Grader bug | What it did | Found in |
|---|---|---|---|
| 1 | The sign was not parsed | `-5.48%` read as `5.48`, so a **correctly reported decline** scored zero against an expected `-5.476` | run 1 |
| 2 | Any figure failed an abstention | An answer that correctly declined FY2031 *and then cited the newest filed quarter* scored zero — training the system toward abstentions that cannot say what **is** known | run 1 |
| 3 | Wrong evidence vocabulary | The rubric knew `answer_contract.SourceClass` names; the pipeline emits `research.evidence` names (`SEC_EVIDENCE`), so **every real SEC citation scored as non-primary** | run 1 |
| 4 | A complete refusal scored as an overstated scan | *"No source passage identifies which S&P 500 companies mentioned tariff risk… does not name individual companies"* scored **0.0 for "partial scan presented as complete"**. It names nobody — the strongest possible statement of limited coverage — but the hedge list only recognised *partial* answers | run 4 |
| 5 | Declining one metric while reporting another read as false confidence | *"FY2025 net sales were $416.161B. The sources do not contain FY2024, so growth cannot be computed"* was labelled `false_confidence`, punishing precisely the behaviour `calc_guard` was added to produce | run 4 |
| 6 | The refusal vocabulary missed plain negations, twice | The first fix for bug 4 did not work, because `_DECLINE_PHRASES` contained `"does not"` but not `"do not"`, and no leading `"no <noun>"` form at all — so *"The sources **do not** identify…"* and *"**No source** passage identifies…"* both still scored zero. It also scanned the whole reply, where a bulleted list of the **sources consulted** is indistinguishable from a list of member companies. Now judged on the opening sentence, with the negations added | run 5 |
| 7 | A perfect evidence score for an unverified property | `_is_primary` is an ANY over the citation list, so `elif cites and primary: 1.0` paid the **full 20 points** when one SEC filing sat among four news articles, with nothing checking that the stated figure came from the filing. The rubric cannot prove claim-level attribution (excerpts truncate at 220 chars), so it no longer invents a penalty — it stops paying a PERFECT score for something it never verified: all-primary keeps 1.0, mixed scores 0.8 with the reason in the note | external audit |

**Six of the seven marked a right answer wrong; the seventh marked a
possibly-wrong answer right.** The first six are the worst class of grader
defect in one direction: they do not merely mis-score, they aim optimisation at
the wrong target — and bugs 4 and 5 would have aimed it directly against the
honesty fixes made earlier in the same session.

Bug 7 runs the other way, and for a benchmark used to argue quality that is
arguably worse. Harshness surfaces as a bad score somebody investigates.
Leniency surfaces as a good score somebody believes. It was found by an
external audit rather than by any run of the benchmark itself, because a
lenient grader has no failing case to point at.

`test_an_answer_cited_entirely_to_filings_still_scores_full_evidence` guards the
fix from becoming bug 8 — six of the seven were created by exactly that kind of
over-tightening. Each is fixed and pinned by regression tests in
`test_head_to_head_rubric.py`, including
`test_a_list_of_names_with_no_hedge_still_scores_zero_scope` and
`test_a_genuinely_wrong_growth_rate_is_still_false_confidence`, which check that
the fixes did not simply make the rubric lenient.

### Genuine system defects the benchmark found

**Reproducible across every run, unfixed in this pass:**

- **`cprt-fy2025-revenue` and `odfl-fy2025-revenue`** answered "No supporting
  evidence found" after **225,767 ms / 220,047 ms** (run 1) and
  **221,401 ms / 221,645 ms** (run 2), with **zero citations**, and failed the
  same way in runs 3–5. Both are registrants outside the ~30-ticker local
  corpus. A real coverage failure and the worst latency in the suite,
  reproduced five times.

### Found by an external audit, and fixed

An external ChatGPT audit was run against this branch, scoped to the Quick
Answer path. It made four claims. **Its headline P0 was wrong** — it reported
that `FinalGate` is never called, and `FinalGate.check()` runs at
`search_pipeline.py:2087` with its verdict shipped as `contract_gate` in the
metadata event. The other three held, and two were real correctness defects:

**`ratio_engine.py` computed ratios from rows it could not vouch for, then
labelled the result audited.** `_fetch_metrics` selected `caption,value_float`
from `financials` filtered on ticker and period **alone**. That table holds
three populations and only the `*_xbrl` rows are exactly tagged.
`structured_search.py` already gates on this and records why:

```
NVDA_CostOfRevenue_FY2026_xbrl           = 62,475,000,000   (dollars, as filed)
NVDA_Cost_of_revenue_2026-05-20_backfill = 39.5             (a unitless scrape)
```

The engine was free to pick up the second number, divide by it, and inject the
result under *"⚠ These values are computed deterministically from audited
filings. Do NOT recompute them. Cite them directly."* — the same
authoritative-label-on-an-unverified-operand shape as the 20,160% growth rate,
in a path `calc_guard` does not cover, and with the additional problem that its
own docstring already promised "the Supabase XBRL financials table" while the
query never filtered for XBRL. A docstring is not a filter.

Fixed: the fetch gates on `id=like.*_xbrl`, selects `id` so provenance exists at
all, and the injected label now states only what can be shown — exact tagged
facts, tag- and period-matched, explicitly **not** attributable to a named
filing, and with the instruction not to recompute removed. 8 tests in
`tests/test_ratio_engine_provenance.py`, verified to fail against the unfixed
file before the fix landed.

**A replayed answer reported no gate verdict at all.** The audit framed this as
cached answers bypassing verification, which overstates it — the answer was
gated before being cached. The real defect sat underneath: the cache was written
at line 2045 and the gate ran at line 2087, so the verdict **did not exist yet**
at the moment it would have been stored, and `replay_metadata` had no
`contract_gate` key. `metadata.get("contract_gate")` therefore returned `None`
for both "passed silently" and "never checked" — the exact mistake that
function's own docstring warns about for channels ("an empty channel list
presented as a measurement is worse than one labelled as missing") and did not
apply to itself.

Fixed: the gate now runs before the cache write, the verdict travels in
`_provenance`, and an entry that carries none reports
`{"recorded": false, "passed": null}` rather than nothing. 6 tests in
`tests/test_cache_gate_provenance.py`.


**The most serious defect found, and fixed: a fabricated growth rate labelled
"deterministic".** Run 3 produced:

```
NVIDIA's revenue grew 20,160% year over year in fiscal 2026, from $10.0B to
$215.9B. This is the deterministic calculation result provided
(yoy_growth(current=2026.0, prior_year=10.0) = 20160.0).
```

**2026 was the fiscal year.** The "Deterministic Calculator Pre-Pass" regex-
scrapes every number out of the top five passages, takes the first two distinct
ones, feeds them to `financial_calculator.yoy_growth`, and injects the result
into the prompt under the heading *Deterministic Calculation Result* with the
instruction *"Use this verified result in your answer. Do not recompute."*

Nothing on that path knows what the two numbers are — no metric, no period, no
company — so a page number, a footnote marker and a fiscal year are all equally
eligible operands. The model reported the figure as authoritative because it was
handed to it as authoritative.

This is precisely the failure `period_math.py` was built to prevent, arriving
through a path that never had typed quantities to check. `app/core/finance/
calc_guard.py` does the one thing possible with floats alone: reject pairs that
**cannot** be one metric in two periods — a four-digit year in either position,
a zero operand, a sign flip, or a ratio beyond 100x. When it refuses, nothing is
injected and the model answers from the passages, which is the honest fallback.
The block's label no longer claims the result is verified.

The asymmetry is deliberate and asserted in `test_the_guard_is_conservative_by_design`:
a false refusal costs an injected convenience; a false acceptance costs a
fabricated figure presented to a user as verified. 52 tests.

**A third invisibility, caught before it became a fourth bug.** After the guard
shipped, `calculator_injected` stopped appearing in the logs entirely — which
could mean the guard was refusing every bad pair, or that the pre-pass had
stopped running at all. Those two look identical when only the success path
logs, and that is the same blindness that hid a 2 s timeout and a 20,160%
growth rate. A `calculator_refused` line now carries the calc type and the
operands it declined, so the guard working and the guard being bypassed are
distinguishable without attaching a debugger.

**Also non-deterministic, and corrected rather than left overstated:**

- `aapl-fy2025-growth` failed run 1 reporting FY2024 revenue as `$391.535B`
  against a filed `391,035,000,000`, **passed** run 2, and failed run 3 for a
  different reason ("the sources provided do not contain Apple's FY2024 total
  net sales figure"). Calling this a single systematic defect would have been
  wrong. It is retrieval and generation variance on derived questions, and the
  five runs are the evidence.

**Latency is the standing failure.** 0.155–0.187 across five runs, on a
dimension where 1.0 means meeting the roadmap's 5–10 s budgets. Median case
~35 s. §1 says where it goes.

---

## 4. Items 9–12, what was built

**#9 Channel status.** `ChannelResults` now carries `timings` beside `failed`.
`_safe_search` records the duration **including on timeout** — the timeout is
the most interesting duration to keep, since it is the channel that set the
fan-out's floor. Per-channel latency, error type and result count reach the
trace and the metadata.

**#10 Latency forensics.** §1.

**#11 Answer Contract.** `app/core/finance/answer_contract.py`. Six answer
modes, evidence obligations, source priority, abstention, scope and shape —
computed from the plan alone, before retrieval, and carried in
`query_plan["answer_contract"]`.

The half that matters is `FinalGate.check()`. Whether an answer needs a filing
was previously argued for **inside a prompt**, and a prompt is a request, not a
constraint: if the model decided a news article was good enough, nothing
downstream disagreed, and the citation looked fine because a citation existed.
The gate reports violations and **never rewrites** — a gate that edits an answer
to satisfy itself is grading its own work, asserted by
`test_the_gate_never_rewrites_the_answer`.

**#12 Answer quality.** `prompts.contract_directives()` renders the contract as
instructions. `test_every_gate_clause_has_a_matching_directive` pins that the
two halves cannot drift: if the gate can fail an answer for a rule the model was
never given, the system is punishing the model for a secret.

---

## 5. BLOCKED, and why no number is invented

**`BLOCKED` — the blind head-to-head (#14).** The harness is complete: rubric
with the roadmap's exact weights (30/20/15/10/10/10/5, asserted to sum to 100),
seeded blinding so a grader cannot tell which side is ours, and a runner that
takes `--reference`. What does not exist is **a recording of what a top ChatGPT
finance answer actually said**. Producing one requires a human running the same
14 questions.

The runner therefore reports `reference_status: BLOCKED` and
`verdict: UNVERIFIED`. Writing reference answers myself would make the benchmark
score the system against itself, which is the specific failure the roadmap
names. **No "beats ChatGPT" claim appears in this document or in the code.**

**`UNGRADED` — 25 of 100 rubric points.** `reasoning` and `clarity` need human
or multi-trial judgement. Repeated identical LLM-judge calls flip their pairwise
preference often enough that a single call at a fixed threshold is a biased
coin, so those dimensions are reported as ungraded and the weighted score is
renormalised over the graded weight — otherwise both systems get an identical
25-point hole and it gets called a total.

**`BLOCKED` — browser E2E (#15, partial).** `playwright.config.ts` and
`npm run e2e` exist and target the deployed build, but **no spec references
`EdgarLink`, "View filing", "Filing details" or `sec.gov`**, so running the
suite proves nothing about the SEC work.

**Open, unfixed, and named rather than closed:**

1. CPRT/ODFL: 220 s+, zero citations, for registrants outside the local corpus.
   Reproduced in all five runs.
2. Latency overall: 0.155-0.187 against the roadmap's 5-10 s budgets.
3. `serialization`'s bimodal 12 ms / 4,069 ms — window identified, cause not.
4. `dense` channel hitting its 12 s timeout repeatedly.
5. Generation variance on the derived cases — `aapl-fy2025-growth` passed run 2
   and failed runs 1 and 3, for two different reasons.

---

## 6. Files

Modified (6): `search_pipeline.py`, `retrieval/orchestrator.py`,
`reasoning/prompts.py`, `finance/ratio_engine.py`,
`eval/head_to_head/rubric.py`, `tests/test_finance_query_plan.py`.

Added (13): `finance/stage_trace.py`, `finance/answer_contract.py`,
`finance/calc_guard.py`,
`eval/head_to_head/{__init__,cases.json,rubric.py,run_benchmark.py}`,
`tests/{test_stage_trace,test_answer_contract,test_head_to_head_rubric,test_resolver_backoff,test_calc_guard,test_ratio_engine_provenance,test_cache_gate_provenance}.py`.

One test was **rewritten, not weakened**:
`test_a_planning_failure_cannot_take_down_a_search` scanned a fixed 700-character
window of source text and broke when a statement was added inside the same
`try`. It now walks the AST and asserts the call sits inside a `try` with a
broad handler that logs — a strictly stronger check. gate-guard reports clean.
