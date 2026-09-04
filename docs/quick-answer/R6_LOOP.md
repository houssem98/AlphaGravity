# Round 6 — graph, loops and ledger in one file

Branch `feat/web-research-sec-integration`. Baseline `d029f59`.
Built from `docs/quick-answer/refix-r7.md` (sixth audit — **input, not truth**).
Every row was verified by running it.

Invocation: **`/loop Execute docs/quick-answer/R6_LOOP.md`**

One file on purpose. Rounds 3–5 each produced a graph, a roadmap and a runner,
and the separation stopped earning its keep.

---

## 1. Where this round starts

The sixth audit scored **system 8.3 / grader 5.8 / NOT CERTIFIED** and said one
useful thing: *"one final evaluator round, then stop touching the grader."*

It found one real P1 (V14). Verifying it turned up two more the audit missed and
two shared blind spots no audit has ever named.

| ID | What | Status |
|---|---|---|
| **V14** | A table declaring `(in millions)` did not constrain its bare figures, so a claim of `$59.07 million` bound against `59,070` in a millions table. Scorecard read **`correctness 0.0, evidence 1.0`** — "wrong answer, fully supported by the filing" | **CLOSED**, this round |
| **V15** | `_ASSERTED` truncated `"$3,582,835 thousand"` to `"$3,582,835 t"` and read the dangling `t` as **trillions**. A claim of $3.58 billion parsed as $3.58 quintillion — **10⁹**. One branch of the pattern had a boundary guard; the other did not | **CLOSED**, this round. **Found by the loop, in no audit** |
| **V16** | U3's metric check only fires when the claim's metric is in `query_plan._METRIC_RES`. `operating expense` is not, so a claim attributing revenue's figure to expenses gets **no metric checking at all** | **OPEN — known shared gap** |
| **V17** | `_claim_is_bound` never looks at periods, and production returns `partially_supported` rather than `UNSUPPORTED` for a period conflict. A figure quoted against the wrong fiscal year still binds as evidence | **OPEN — known shared gap** |
| **V18** | The differential contract now exists: production verifier vs. grader on one independently-declared fact. It found V16 and V17 on its first run | **BUILT**, this round |
| **V19** | Production ignored a table's `(in millions)` header. A correct claim — `$59,070 million` against real UAL filing text — graded `conflicting`, `is_verified` False, and the claim wrong by a factor of a thousand got the **identical verdict**. The exact dual of V14, one layer down | **CLOSED**, this round. **Found by W2's edge rig, in no audit** |
| **V20** | `_scrub` removed form designators and item references but not `[3]`. The marker's integer counted as a claim figure, was in no source, and demoted a fully grounded citation from `verified` to `partially_supported` — **citing a source lowered the citation's verdict** | **CLOSED**, this round. **Found by W2's edge rig, in no audit** |
| **V21** | `edge-metric-figure-transposed`: both figures real, both metrics real, each attached to the other's row. The grader binds because `_claim_is_bound` works per SENTENCE, not per proposition — its own T9 caveat. Production's `conflicting` was V19's artefact, not a catch | **OPEN — third shared gap, pinned** |
| **V22** | `_cited_excerpts` failed open on a marker past the end of the citation list, so a claim marking `[7]` against one citation bound by searching every excerpt. Production calls that `UNSUPPORTED / citation_index_out_of_range` — the invented-citation case its own module docstring opens with | **CLOSED**, this round. **First hard breach of the one-directional invariant** |

**V15 is why this round exists.** A 10⁹ parsing error sat in the claim parser
through six audits and five rounds of work on that same file. Nobody wrote a
test for `"$X thousand"` in the currency form, so nobody found it.

**V19 and V20 are why W2 exists.** Both are PRODUCTION defects on the live
request path, and the differential rig found both on the first run of its edge
layer — before it had found anything about the grader. Six audits read this
verifier and neither surfaced. V19 in particular is V14 restated one layer down
and against the same fixture, which is the strongest available evidence that
this class of defect is found by differential testing rather than by reading.

---

## 2. The two loops left

Everything else in the sixth audit is either done, blocked, or explicitly out of
scope. These are the only open items a loop can close.

### W1 — close V16, or prove it needs the evidence layer

The claim's metric governs U3's contradiction check, and the lexicon does not
cover every line item a filing names. Three options, and **the deliverable is
the decision**:

1. **Widen production's `_METRICS`** — a production change made for an eval
   need, which is the direction R14 warns against.
2. **Refuse to bind when the claim names a metric-shaped phrase the lexicon
   does not know**, rather than falling through to whole-excerpt matching.
   Stricter, and it moves scores, so it escalates.
3. **Record it as a limit the evidence layer closes**, since a `Claim` carrying
   its own metric would not need the lexicon at all.

Option 2 is the only one closable inside this round. **Escalate before
implementing** — it makes the rubric stricter.

**Escalated and answered: option 3.** V16 is recorded as a limit the evidence
layer closes and stays OPEN-with-reason. No code changed. A `Claim` carrying
its own metric does not consult the lexicon, so widening production's
`_METRICS` for an eval need (option 1, the direction R14 warns against) or
refusing to bind on unknown metric-shaped phrases (option 2, which moves
scores) would both be work R7 discards. The `metric-wrong` entry stays in
`KNOWN_SHARED_GAPS`.

### W2 — extend the differential rig to edges

The current mutations are node mutations: value, unit, period, metric. The
audit's sharpest observation is that the missing class is **edges** —
`claim → citation`, and beyond that `claim → {metric, unit, scale, period,
scope, entity}`.

`test_grader_agrees_with_production_verifier.py` has the harness. Add edge
mutations to it. **Every new mutation must be shown to change at least one
grader's verdict**, or it is measuring nothing — the rule that made T8's
detector and R4's rig credible.

`KNOWN_SHARED_GAPS` is the mechanism that matters: a *third* shared blind spot
fails the suite loudly instead of waiting for a seventh audit.

**Done, and it did not behave as predicted.** The edge layer added four
mutations against `tests/real_sec_fixtures` — `edge-marker-points-elsewhere`,
`edge-marker-out-of-range`, `edge-scale-borrowed-across-tables` and
`edge-metric-figure-transposed` — plus a true-wiring anchor. Three bite. What
they found first was not a grader defect:

- Building the anchor showed **production rejects the true wiring** (V19),
  which is why `test_the_true_wiring_is_accepted_by_the_grader` could not
  assert `VERIFIED` until V19 was closed.
- `edge-marker-out-of-range` is the **first hard breach of the one-directional
  invariant** ever measured: production `UNSUPPORTED`, grader bound.
  Escalated, answered *fix the grader*, closed as V22. The refusal is narrow —
  it fires only when EVERY marker in a sentence is out of range, so `[1][7]`
  still binds on `[1]`, and an in-range marker naming a too-short excerpt
  still fails open.
- `edge-metric-figure-transposed` is the third shared gap (V21) and is pinned
  in `KNOWN_SHARED_EDGE_GAPS`, not closed. Its cause is the sentence-scope
  leniency `_claim_is_bound` documents under T9, and closing it is claim-level
  decomposition — R7 work, not a regex.

**One edge was measured and deliberately not added to the rig.** A citation
whose `chunk_id` names nothing in the answer's sources is `UNSUPPORTED` in
production and bound by the grader — but the grader is never given chunk ids,
so the check is not expressible against `list[dict]` citations. That is an
input-shape gap for the evidence layer, not a grader laxity, and pretending
the rig covers it would be the more dishonest of the two options.

---

## 3. Rules, all binding

- **Every new test runs against UNFIXED code first and is observed to fail**,
  and the failing output goes into the ledger row and the commit.
- **Never delete, skip, weaken or loosen a test.** Run
  `node ~/.claude/scripts/gate-guard.mjs` before any commit claiming a fix.
- **Reconcile every count delta** against the tests that commit adds. A rise
  larger than that means duplication; smaller means something stopped running.
- **Never write** `world class`, `certified`, `production ready` or `fixed`
  while any row is OPEN. Six audits have declined the first label.
- **Append one ledger row per attempt. Never edit a row — supersede it.**
- Push before quoting a SHA outside the session.

**Evals, both, every loop:**

```bash
cd services/gravity-api
.venv/Scripts/python.exe -m pytest tests/ -q --ignore=tests/live --ignore=tests/eval
node ~/.claude/scripts/gate-guard.mjs
```

Baseline **2457 passed** at `d029f59`. Runs take 9–16 minutes; pytest buffers
its dots, so an empty output file is not a hang.

**Escalate:** deploys, pushes to `main`, spend, unread files, anything
unverifiable, any change making FinalGate refuse, and **any change to what the
benchmark counts as correct** — which covers W1 option 2.

**Stop:** every row CLOSED or OPEN-with-reason and both evals ran; budget 4
loops; 3 loops with no verdict change.

---

## 4. What this round must NOT do

The audit's own instruction, and it is right: **this is the last grader round.**
After W1 and W2, further grader work is lower value than the evidence layer.

Do not start the canonical `EvidenceFact` object inside this round. It is R7,
it is weeks not loops, and a half-built evidence graph adds a seventh vocabulary
to the six round 3 counted.

---

## 5. Certification — stated plainly

`NOT CERTIFIED`, and this round does not change that. Six audits have declined
it. What blocks it, and who can move each:

| Blocker | Who |
|---|---|
| **Blind head-to-head — no reference set exists.** Recorded answers with ground-truth figures, authored before the run | **Human.** No loop can produce this. It has blocked certification since round 1 |
| **Live database** | Infrastructure |
| **Independently executed suite** — CI is disabled behind 1347 `ruff` errors and 211 unformatted files | Human decision, then a lint round |
| **Browser E2E** — `apps/gravity-ui` has no test directory at all | A loop, once an app instance is runnable |
| **Canonical evidence layer** | R7 |

Three of five are outside this loop's reach. **The single highest-leverage
human action is authoring the reference set** — without it the question "is this
better than ChatGPT" cannot be answered at all, and no amount of grader work
substitutes for it.

**V15 is the argument against certifying now.** A 10⁹ error survived six audits
in the most-examined file in the repository. The correct inference is not that
the remaining defects are small; it is that this class of defect is found by
differential and property testing rather than by inspection — which is what W2
builds, and why it is the last thing this round does before the work moves to
the system.

---

## Ledger

| # | Loop | Defect | Verdict | Backend | gate-guard | Commit | Red-before-fix |
|---|---|---|---|---|---|---|---|
| 0 | — | — | BASELINE | 2457 passed / 0 failed | clean | `d029f59` | n/a |
| 1 | 1 | V14 declared table scale | CLOSED | 2481 passed / 0 failed | clean | `4c2c434` | 6 assertions failed on unfixed `rubric.py` @ `d029f59`: `_claim_is_bound("$59.07 million") -> True` (want False), `score_answer` gave `evidence == 1.0` alongside `correctness == 0.0`, and `$59.07 thousand` / `$59,070 billion` both bound |
| 2 | 1 | V15 `"$X thousand"` currency form | CLOSED | 2481 passed / 0 failed | clean | `4c2c434` | `_ASSERTED` on unfixed code matched `'$3,582,835 t'` and `_asserted_split` returned `{3.582835e+18}`; fixed code matches `'$3,582,835 thousand'` and returns `{3582835000.0}`. Factor of 10⁹, measured |
| 3 | 1 | V18 differential rig | BUILT | 2481 passed / 0 failed | clean | pending | n/a — the rig is the deliverable; it reported V16 and V17 on its first run |
| 4 | 1 | V19 production discards declared scale | CLOSED | 2497 passed / 0 failed | clean | `5bbc55d` | On unfixed `citation_verdict.py`, all of `$59,070 million`, `$59.07 billion`, `59,070` **and** the 1000×-wrong `$59,070 billion` returned `conflicting / numeric_not_in_source` against `UAL_RESULTS`. After: first three `verified`, the wrong one still `conflicting` |
| 5 | 1 | V20 citation marker counted as a figure | CLOSED | 2497 passed / 0 failed | clean | `5bbc55d` | `_extract_numbers(_scrub("Revenue was $416,161 million [1]."))` returned `[1.0, 416161000000.0]` on unfixed code, and the verdict was `partially_supported` where the identical sentence without `[1]` was `verified` |
| 6 | 1 | V21 metric↔figure transposed | OPEN — pinned | 2497 passed / 0 failed | clean | `5bbc55d` | Both graders accept it. Pinned in `KNOWN_SHARED_EDGE_GAPS`; cause is per-sentence scope (T9), closure is R7 |
| 7 | 1 | V22 out-of-range marker fails open | CLOSED | 2497 passed / 0 failed | clean | `5bbc55d` | Production `unsupported / citation_index_out_of_range`; unfixed grader `_claim_is_bound(... "[7]") -> True`; fixed `-> False`. `[1][7]` still `True`, in-range-but-short-excerpt still `True` |
| 8 | 1 | V22 supersedes an existing test | SUPERSEDED | 2497 passed / 0 failed | clean | `5bbc55d` | `test_a_marker_past_the_end_of_the_list_searches_everything` asserted the fail-open V22 withdraws, and failed in the 2495-test run. Replaced by three assertions — refusal, `[2][9]` still binds, no cross-sentence rescue — so the rule is pinned tighter than the behaviour it superseded |
