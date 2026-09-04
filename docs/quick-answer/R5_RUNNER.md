# Round 5 runner

One-line invocation: **`/loop Execute docs/quick-answer/R5_RUNNER.md`**

Progress lives in the R5 ledger, which is the single place it is written and the
single place it is read.

---

## 1. Where you are

1. `docs/quick-answer/R5_GRAPH.md` — the V-IDs and how each was established.
2. `docs/quick-answer/R5_ROADMAP.md` — the loop order, per-loop specs, ledger.

The last ledger row is where you are. The next loop is the first in the loop
order whose defect is not `CLOSED` or `BLOCKED with a stated reason`.

`docs/quick-answer/refix-r4.md` is the fifth audit. **Input, not truth.** It
ranked unit/scale as a missing rig dimension; the graph found it is a live P0
that corrupts `correctness`. Do not re-derive the defect list from it.

Branch: `feat/web-research-sec-integration`. Baseline: `5c4a1a5`.

## 2. Rules, all binding

- **Every new test runs against UNFIXED code first and is observed to fail**,
  and the failing output is pasted into the ledger row and committed.
- **Never delete, skip, weaken, or loosen a test.** Run
  `node ~/.claude/scripts/gate-guard.mjs` before any commit claiming a fix.
- **Label every finding** `VERIFIED` / `READ` / `BLOCKED`.
- **Line numbers are hints.** Re-grep.
- **Never write** `world class`, `certified`, `production ready` or `fixed`
  while any `LIVE` row remains. Five audits have declined the first label.
- **Append one ledger row per attempt. Never edit a row — supersede it.**
- **Do not touch Deep Research or the agentic orchestrator.**
- **Push before quoting a SHA outside the session.**
- **Reconcile every count delta** against the tests that commit adds.

## 3. Escalate — halt and ask

Deploys, pushes to `main`, spend, unread files entering the repo, anything
unverifiable, **any change making FinalGate refuse an answer**, and **any change
to what the benchmark counts as correct** — which covers V2 and V3.

**V1 is exempt.** It repairs an instrument that reports the wrong number rather
than moving where the instrument points. A 1000× error needs no permission to
fix. Its regression risk is still real: `_matches` is upstream of `correctness`
and `evidence`, so the full suite is mandatory.

**Enabling CI remains a decision, not a task.** `ruff check app/` reports 1347
errors and `ruff format --check` 211 files, neither enforced. Renaming
`ci.yml.disabled` turns `main` red on lint while tests pass.

## 4. Evals — both, every loop

```bash
cd services/gravity-api
.venv/Scripts/python.exe -m pytest tests/ -q --ignore=tests/live --ignore=tests/eval
node ~/.claude/scripts/gate-guard.mjs
```

Baseline `2394 passed, 0 failed`. Run the FULL suite, not the file. Grep every
reference before changing a shared constant.

## 5. Stop — check all three every loop

- **Target:** every `LIVE` row CLOSED or BLOCKED-with-reason, both evals ran.
- **Budget:** 6 loops.
- **Stall:** 3 loops with no verdict change → stop and report.

---

## 6. Operating notes

**The instrument was wrong, not just lenient.** Rounds 3 and 4 made the rubric
refuse evidence it should refuse. V1 is different in kind: `_matches` cannot
tell `$130 million` from `$130 billion`, so an answer wrong by three orders of
magnitude scores `correctness 1.0`. **Every number in every round-3 and round-4
document was produced by that instrument**, including the audits' own scores.
Say so plainly; do not let it be softened into "the grader was permissive".

**Fix the instrument before measuring anything with it.** P1 is first for that
reason, not by convenience.

**A fixture narrower than the function under test is the class that has survived
five audits.** T13, U1, U2, U3 and now V1 and V2. Red-then-green does not prove
the hole is shut — ask which branches the fixture reaches.

**Prove every detector fires.** T8's publication counter and round 4's mutation
rig were both proven by breaking the code and watching them fail, then
restoring. A new rig mutation that passes on both sides of a fix measures
nothing.

**Under-firing is the cheaper direction.** Six of seven historical grader bugs in
`rubric.py` came from over-tightening. Every rule added in rounds 4 and 5 fails
open on ambiguity, and that is deliberate.

**Narrow the remedy before implementing it.** The audits have proposed a
canonical provenance object, canonical entity resolution and full proposition
extraction. Each is the right long-run architecture and the wrong next commit.
V1, V2 and V3 are three closable dimensions of V5; close them and say that is
what happened.

**Standing decisions — do not reopen without new information.**

| Decision | Effect |
|---|---|
| Numeric verification stays **advisory** | Policy, not a technical gap |
| FinalGate stays **report-only** | An audit gate, not a safety barrier |
| R7 stays **BLOCKED** | Two audits agreed; more regexes break three shapes |
| Unknown identity is **UNGRADED** (T4) | Owner-agreed |
| U3's narrow contradiction scope | Owner-agreed |
| U10 empty token stays **False** | Decided on record; `None` arguable |
| M4 stages 1–5 **not recommended** | Round 3 measured the vocabularies disjoint |

**Still blocked on a human:** blind head-to-head (no reference set), browser
E2E, independent CI execution. Confirm in one line; do not spend an iteration.

**And the one round 5 adds:** the fifth audit and this roadmap agree that **R5 is
the last grader-dominant round.** Rounds 3 and 4 each changed exactly one
non-test, non-doc file and it was the grader both times. R6 must be system-level
work — canonical provenance, a real claim/evidence graph — or the trajectory
itself is the finding. **V1 does not excuse that; it sharpens it.**
