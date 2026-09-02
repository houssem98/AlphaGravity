# Finance Quick Answer — Loop Ledger

Branch `feat/web-research-sec-integration`. Baseline `6c72822`.
Companion to `WORLD_CLASS_FINANCE_QUICK_ANSWER_GRAPH.md` — read that first; it
carries the node IDs and defect IDs used throughout.

---

## The nine parts

**1. Goal.** Close every `LIVE` and `PARTIAL` defect node in the graph, or
record why it cannot close. Not "make Quick Answer world class" — that phrase
is banned as a stop condition because it has no measurement.

**2. Context.** The graph file, `chatgpt answer.md` (audit input only), the
standing constraints in graph §5, and the existing 2097-test backend suite.

**3. Actions.** One loop per round. Inside a loop, one defect. The cycle is
fixed and does not vary: `INPUT → INSPECT → TEST → CLASSIFY → FIX → REGRESSION
→ RE-RUN → GRAPH UPDATE → CERTIFICATION DECISION`.

**4. Tools.** `services/gravity-api/**`, `apps/gravity-ui/**`,
`docs/quick-answer/**`. Read-only elsewhere. No deploys. No pushes to `main`.

**5. Evals.** Binary, exit-coded, no model judge:

```bash
cd services/gravity-api
.venv/Scripts/python.exe -m pytest tests/ -q --ignore=tests/live --ignore=tests/eval
node ~/.claude/scripts/gate-guard.mjs
```

Baseline to beat: **2097 passed, 0 failed**; gate-guard clean. A loop that
lowers either number has failed regardless of what it claims to have fixed.

**6. Memory.** Append to the ledger table at the bottom of this file, one row
per loop attempt. Never rewrite a row — a superseded verdict gets a new row.

**7. Guardrails + their checks.**

| Rule | The command that proves it held |
|---|---|
| No test weakened | `node ~/.claude/scripts/gate-guard.mjs` |
| Test count never drops | compare the pytest tail against the previous ledger row |
| New test actually catches the bug | `git stash push -- <fixed file>`, run the new test, expect failure, `git stash pop` |
| No secrets in logs | `grep -rn "error=str(e)" app/core/` must not grow |
| `main` untouched | `git rev-parse --abbrev-ref HEAD` |

The third row is not optional. A test written after a fix, never run against
the unfixed code, proves nothing — this happened once already in this project
and the passing test was hiding a live bug.

**8. Escalation — halt and ask.** Deploys, pushes to `main`, any spend, any
file entering the repo the loop did not write and has not read, any result that
would justify a certification claim, anything unverifiable this iteration.

**9. Stop — all three, checked every loop.**
- **Target:** every defect node is `FIXED`, `DISPROVED`, or `BLOCKED with a
  stated reason`, and the two eval commands were actually run.
- **Budget:** 14 loops, or 3 consecutive loops with no ledger verdict change.
- **Stall:** 3 loops with no verdict change and no new failure mode → stop and
  report. Do not invent a new hypothesis to keep the loop alive.

---

## Loop dependency graph

Fix upstream invariants before downstream symptoms. An edge means *must
complete first*.

```
                        L0  Baseline
                         |
        +----------------+----------------+
        |                |                |
       L1               L3               L6
   Cache safety     Calc provenance   Evidence binding
    (D2)             (D3)              (D8)
        |                |                |
        |          +-----+-----+          |
        |          |           |          |
        |         L4          L5          |
        |    Determinism   Non-finite     |
        |      (D4)          (D5)         |
        |          |           |          |
        +----------+-----+-----+----------+
                         |
                        L2  Enforcement decision  (D7)
                         |
        +----------------+----------------+
        |                |                |
       L7               L8               L11
  Asserted-number   Period/entity    Provenance schema
    (D9)              (D10)             (D11)
        |                |                |
        +----------------+----------------+
                         |
                        L12  Doc re-audit  (D12)
                         |
        +----------------+----------------+
        |                |                |
       L9               L10              L13
  Blind benchmark   Browser E2E      Latency
   (BLOCKED)         (BLOCKED)      (open, low priority)
```

**L1/L3/L6 are independent** and may run in any order — they touch different
files. **L2 is the hinge**: whether verification becomes blocking is a product
decision that changes what every downstream loop is measuring, so nothing after
it starts until it is settled. **L9/L10 are BLOCKED on human input** and are
placed last deliberately; do not burn loops re-confirming they are blocked.

Note the renumbering against the original spec: its LOOP 1 was FinalGate
enforcement, which **D1 disproved**. That loop is deleted rather than executed.

---

## The loops

Each follows the fixed nine-step cycle. Only the parts that differ are written out.

### L0 — Baseline

- **INPUT:** clean tree at `6c72822`.
- **TEST:** both eval commands. Record exact counts and wall time.
- **CERTIFICATION:** none. L0 asserts nothing; it establishes the number every
  later loop is compared against.
- **Exit:** ledger row with real counts, or halt.

### L1 — Cache safety · D2

- **INPUT:** graph N2, N16.
- **INSPECT:** `search_pipeline.py:659` — the early `return` after yielding a
  cached answer.
- **TEST (write first, must fail):** a cached entry whose stored
  `contract_gate.passed` is `false` is replayed; assert the caller can tell.
  Then: assert a cache hit re-runs the contract check, or that the entry is
  refused.
- **CLASSIFY:** is this *bypass* (no check ever ran) or *staleness* (a check ran
  once, long ago)? They need different fixes. The audit conflated them.
- **FIX:** the cheap correct move is refusing to serve an entry whose stored
  verdict failed. Re-running N3–N15 on every hit costs the entire point of the
  cache — if you propose that, measure it first.
- **CERTIFICATION:** D2 closes only when a failing-gate answer cannot be served
  from cache.

### L2 — Enforcement decision · D7

- **INPUT:** graph N11.
- **INSPECT:** `search_pipeline.py:1689`. Confirm mismatches only warn.
- **ESCALATE BEFORE FIXING.** Making verification blocking converts some wrong
  answers into refusals *and* some right answers into refusals. That trade is
  the user's call, not the loop's. Present measured false-positive rate first.
- **TEST:** count how often `deterministic_verification_warnings` fires across
  the 14 benchmark cases before proposing anything.
- **CERTIFICATION:** D7 closes on a *decision recorded with evidence*, not
  necessarily on a code change.

### L3 — Calculation provenance · D3

- **INPUT:** graph N8. `6c72822` already added the `*_xbrl` filter and the
  honest label; do not redo that.
- **REMAINING:** ratio operands are bare floats, never `period_math.Quantity`,
  and carry no accession.
- **TEST:** a ratio computed from two facts of *different periods* must be
  refused. Currently nothing stops it.
- **FIX:** route ratio operands through `Quantity`. This is the largest single
  change in the roadmap and is the one that makes D4, D5 and D6 tractable.

### L4 — Deterministic fact selection · D4

- **INPUT:** `ratio_engine.py:1127`.
- **TEST:** two rows for one metric, returned in both orders, must produce the
  same ratio. Currently order-dependent.
- **FIX:** an explicit precedence rule (`ORDER BY` plus a documented concept
  preference), not reliance on insert order.
- **WARNING:** changing which row wins changes published numbers. Verify
  against live data before committing, or mark `BLOCKED — needs live DB`.

### L5 — Non-finite protection · D5

- **TEST:** operands that overflow to `inf` must not reach a ratio. Mirror
  `test_every_operation_routes_through_the_finiteness_gate`, which already does
  this for `period_math`.
- **FIX:** route through the existing gate rather than writing a second one.

### L6 — Claim-level evidence binding · D8

- **INPUT:** `rubric.py` evidence block; `6c72822` removed the perfect score,
  nothing more.
- **HARD CONSTRAINT:** recorded excerpts truncate at 220 characters. A previous
  rescore had to be discarded for exactly this. Either widen what the runner
  records first, or mark claim-level binding `BLOCKED — excerpt truncation`.
- **DO NOT** invent a penalty the data cannot support. Six of seven grader bugs
  were created by over-tightening.

### L7 — Asserted-number correctness · D9

- **TEST:** an answer that states a wrong headline figure and mentions the right
  one in an aside must not score 1.0.
- **FIX:** score the figure the answer *asserts*, not any figure present.
- **GUARD:** a correct answer that also quotes a prior-year comparison must
  still score 1.0.

### L8 — Period/entity attachment · D10

- **TEST:** an answer naming the right company and right period but attaching
  the figure to the wrong one must lose points.
- **GUARD:** same as L7 — do not punish answers that mention context.

### L9 — Independent blind benchmark

**BLOCKED.** Needs a human to record what a top ChatGPT finance answer actually
said for the 14 cases. Writing them is forbidden — it scores the system against
itself. Loop action: confirm still blocked, one line, move on.

### L10 — Browser E2E

**BLOCKED.** No spec references `EdgarLink`, "View filing", "Filing details" or
`sec.gov`. Unblocking = writing those specs, which is real work, not a loop
iteration. Escalate for scope approval before starting.

### L11 — Benchmark provenance schema · D11

- **FIX:** convert the prose provenance list into
  `{accession, concept, unit, period, value}` per case, and assert every filed
  `expect_value` resolves to one. The existing string test becomes the fallback.

### L12 — Documentation consistency · D12

- **INPUT:** `FINAL_BEAT_TOP_CHATGPT_VERIFICATION.md` and the graph file.
- **TEST:** every file path, test name, and count cited in the doc must exist.
  This has caught a false claim once already.
- **RUN LAST** — the doc describes code that earlier loops change.

### L13 — Latency

Open, explicitly **lowest priority**. The audit's own closing note: do not spend
a cycle squeezing 500 ms while correctness enforcement is unresolved. Known:
`retrieval` median 11.3 s, `dense` hitting its 12 s cap, `serialization`
bimodal 12 ms / 4069 ms with cause unfound.

---

## Certification rules

`WORLD CLASS`, `PRODUCTION READY`, `CERTIFIED` and `FIXED` may not be written
while any of these holds:

- a cache hit can serve an answer whose stored gate verdict failed (D2)
- ratio operands are untyped or non-deterministically selected (D3, D4)
- a non-finite value can reach a ratio (D5)
- the benchmark scores a number's mere presence as correctness (D9)
- the blind benchmark is unrun (L9)
- any P0 remains open

`BLOCKED` never becomes `PASS` by re-reading the code. Only a run converts it.

---

## Ledger

Append one row per loop attempt. Never edit a row; supersede it with a new one.

| # | Loop | Defect | Started | Verdict | Backend count | gate-guard | Commit | Note |
|---|---|---|---|---|---|---|---|---|
| 0 | L0 | — | 2026-09-02 | BASELINE | 2097 passed / 0 failed | clean | `6c72822` | Established before any loop ran |
