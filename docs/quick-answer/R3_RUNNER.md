# Round 3 runner

One-line invocation: **`/loop Execute docs/quick-answer/R3_RUNNER.md`**

No progress is written in this file. Progress lives in the R3 ledger, which is
the single place it is written and the single place it is read.

---

## 1. Where you are

Read in this order:

1. `docs/quick-answer/R3_GRAPH.md` — the T-IDs, their status, and **how each
   was established**. A row marked `UNVERIFIED` may not be actioned until a
   command has run.
2. `docs/quick-answer/R3_ROADMAP.md` — the nine parts, the loop order, the
   per-loop specs, and **the ledger at the bottom**.

The last ledger row is where you are. The next loop is the first in the loop
order whose defect is not `CLOSED` or `BLOCKED with a stated reason`.

`docs/quick-answer/refix-2.md` is the third external audit. It is **input, not
truth**. Do not re-derive the defect list from it — `R3_GRAPH.md` already
re-checked every claim, partly rebutted one, sharpened two, and found one the
audit missed.

Branch: `feat/web-research-sec-integration`. Baseline: `82a7d3d`.

---

## 2. Rules, all binding

- **Every new test runs against the UNFIXED code first and is observed to
  fail** — and **the failing output is pasted into the ledger row and
  committed.** A claim whose evidence lives only in a terminal is not evidence.
- **Never delete, skip, weaken, or loosen a test.** Run
  `node ~/.claude/scripts/gate-guard.mjs` before any commit claiming a fix.
- **Label every finding** `VERIFIED` (a command ran and you read the output),
  `READ` (static only), or `BLOCKED` (with the reason). `BLOCKED` never becomes
  `PASS` by re-reading code.
- **Line numbers are hints.** Re-grep.
- **Never write** `world class`, `certified`, `production ready` or `fixed`
  while any `LIVE` row remains. Three consecutive audits have declined the
  first label; the third rated the system ~8/10 and said so explicitly.
- **Append one ledger row per attempt. Never edit a row — supersede it.**
- **Do not touch Deep Research or the agentic orchestrator.**
- **Push before quoting a SHA to anyone outside the session.** Round 2 handed an
  auditor a range that existed only locally and lost a cycle to it. Check with
  `git status -sb`.

## 3. Escalate — halt and ask

Deploys, pushes to `main`, any spend, any file entering the repo the loop did
not write and has not read, anything unverifiable this iteration, and:

**Any change that makes FinalGate refuse, rewrite, or suppress an answer.** The
gate's report-only behaviour is deliberate and pinned by
`test_the_gate_never_rewrites_the_answer`.

**Any change to what the benchmark counts as correct.** M3 turns a credited
score into an ungraded one. A loop that can move its own measuring stick can
close anything by moving it. State the policy, get it agreed, then implement.

**Any type unification touching more than one layer (M4).** A half-done
canonical enum is worse than none — it adds a fifth vocabulary to the four that
caused this.

## 4. Evals — both, every loop

```bash
cd services/gravity-api
.venv/Scripts/python.exe -m pytest tests/ -q --ignore=tests/live --ignore=tests/eval
node ~/.claude/scripts/gate-guard.mjs
```

Baseline `2270 passed, 0 failed`, gate-guard clean. Record exact counts.

**Run the FULL suite, not the file.** Round 2 was caught three separate times by
tests a targeted run missed — twice on one string. When you change a shared
constant or a literal, grep every reference before running anything.

## 5. Stop — check all three every loop

- **Target:** every `LIVE` row is CLOSED or BLOCKED-with-reason, both evals ran.
- **Budget:** 8 loops.
- **Stall:** 3 loops with no verdict change → stop and report. Do not invent a
  hypothesis to keep the loop alive.

---

## 6. Operating notes

Earned in rounds 1 and 2. They cost real time to learn.

**The evaluator is part of the system under test.** Round 3's P1 cluster is
entirely in `eval/head_to_head/rubric.py`: it hands out primary-source credit
for `LOCAL_EVIDENCE`, for `structured`, and for any citation carrying a truthy
`accession` — including a fabricated one on a `WEB_EVIDENCE` citation. A
benchmark more permissive than the system it grades cannot certify it.

**Noticing is not closing.** Round 2's L8 notes record spotting that the
rubric's primary list looked more permissive than the gate's, and moving on
because it was outside that loop's scope. That observation was T1 and T2, six
weeks early. **If you notice something out of scope, write it into the graph as
a node before you move on.**

**Verify the roadmap, not just the code.** Round 1 falsified five of its own
governing assumptions. Round 2 falsified two more — R8's stated test case
already scored 0.0 before any fix, and R10's blanket "needs a live DB" block was
too wide. Expect round 3 to have its own.

**A test whose red depends on a fixture should assert the fixture still bites.**
Round 2's L2 fixture began passing for the wrong reason once R14 landed; a
premise assertion inside the test caught it. Three of round 1's stub failures
were the same shape.

**A false statement in a test is worse than no statement.** T5 is round 2's own:
`test_entity_attachment.py` says the bind reads `cik`, and the code does not.
Evidence pointing the wrong way is more expensive than a gap.

**`_YEAR` does not match the year inside `FY2024`** — its `\b` fails on the `Y`.

**Paths.** The rubric is `services/gravity-api/eval/head_to_head/rubric.py`;
`--ignore=tests/eval` does not exclude it.

**Standing decisions — do not reopen without new information.**

| Decision | Date | Effect |
|---|---|---|
| Numeric verification stays **advisory** | 2026-09-03 | Policy, not a technical gap. Never describe as "numeric correctness closed". |
| FinalGate stays **report-only** | round 1 | Reorder it freely; making it refuse is an escalation. |
| Live DB stays **unavailable** | 2026-09-03 | Blocks *which concept wins*, not determinism. |
| R7 stays **BLOCKED** | 2026-09-03 | Third audit independently agreed. Widening the punctuation list breaks three protected shapes. Do not retry with more regexes. |

**Still blocked on a human:** the blind head-to-head (no reference set exists)
and browser E2E for SEC links. Confirm in one line; do not spend an iteration.

**And one new one:** the suite count backing every round-2 closure has never been
executed outside the session that produced it (T10). Until a CI check or a
reproducible artefact exists, `2270 passed` is a well-evidenced claim, not an
independently verified fact — say it that way.
