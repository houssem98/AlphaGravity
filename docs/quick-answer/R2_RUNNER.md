# Round 2 runner

One-line invocation: **`/loop Execute docs/quick-answer/R2_RUNNER.md`**

No progress is written in this file. Progress lives in the R2 ledger, which is
the single place it is written and the single place it is read.

---

## 1. Where you are

Read in this order:

1. `docs/quick-answer/R2_GRAPH.md` — the R-IDs, their status, and **how each
   was established**. A row marked `UNVERIFIED` may not be actioned until a
   command has run.
2. `docs/quick-answer/R2_ROADMAP.md` — the nine parts, the loop order, the
   per-loop specs, and **the ledger at the bottom**.

The last ledger row is where you are. The next loop is the first in the loop
order whose defect is not `CLOSED` or `BLOCKED with a stated reason`.

`docs/quick-answer/refix.md` is the second external audit. It is **input, not
truth**. Do not re-derive the defect list from it — `R2_GRAPH.md` already
re-checked every claim, rebutted one, and found one the audit missed.

Branch: `feat/web-research-sec-integration`. Baseline: `6003631`.

---

## 2. Rules, all binding

- **Every new test runs against the UNFIXED code first and is observed to
  fail** — and **the failing output is pasted into the ledger row and
  committed.** The second auditor could not verify "red before green" from the
  diff and was right that it is unverifiable there. A claim whose evidence
  lives only in a terminal is not evidence.
- **Never delete, skip, weaken, or loosen a test.** Run
  `node ~/.claude/scripts/gate-guard.mjs` before any commit claiming a fix.
- **Label every finding** `VERIFIED` (a command ran and you read the output),
  `READ` (static only), or `BLOCKED` (with the reason). `BLOCKED` never becomes
  `PASS` by re-reading code.
- **Line numbers are hints.** Re-grep. They have drifted three times in this
  project already, once within a single session.
- **Never write** `world class`, `certified`, `production ready` or `fixed`
  while any `LIVE` row remains.
- **Append one ledger row per attempt. Never edit a row — supersede it.**
- **Do not touch Deep Research or the agentic orchestrator.**

## 3. Escalate — halt and ask

Deploys, pushes to `main`, any spend, any file entering the repo the loop did
not write and has not read, anything unverifiable this iteration, and:

**Any change that makes FinalGate refuse, rewrite, or suppress an answer.**
Moving the gate earlier is a loop action. Making it block is a product decision
of the same class as D7, which the owner already decided (advisory). The gate's
report-only behaviour is deliberate and pinned by
`test_the_gate_never_rewrites_the_answer`: *a gate that edits an answer to
satisfy itself is grading its own work.*

## 4. Evals — both, every loop

```bash
cd services/gravity-api
.venv/Scripts/python.exe -m pytest tests/ -q --ignore=tests/live --ignore=tests/eval
node ~/.claude/scripts/gate-guard.mjs
```

Baseline `2193 passed, 0 failed`, gate-guard clean. Record exact counts.

## 5. Stop — check all three every loop

- **Target:** every `LIVE` row is CLOSED or BLOCKED-with-reason, both evals ran.
- **Budget:** 10 loops.
- **Stall:** 3 loops with no verdict change → stop and report. Do not invent a
  hypothesis to keep the loop alive.

---

## 6. Operating notes

Earned in round 1. They cost real time to learn.

**Verify the roadmap, not just the code.** Round 1 falsified five of its own
governing assumptions: three dependency edges (L3→L5, L2→L7, L2→L8 — all closed
without their prerequisite), an over-broad "220-char truncation" blocker, and
"the working graph faithfully captures the audit" (it had 12 nodes for 13
findings). Round 2 found a sixth: round 1 verified the gate *is invoked* and
never asked whether it runs *before publication*. **Check an inherited claim
before building on it.**

**A stub can stop being a stub.** Three test files stubbed `_fetch_metrics`
after `compute` moved to `_fetch_facts`. They did not error — they fell through
to the real fetch and passed against another file's leaked `sb_select` patch.
One was feeding `inf` and scoring a clean margin from someone else's fixture.
It passed alone and failed only under full-suite ordering. **Re-run the full
suite, not the file.**

**`_YEAR` does not match the year inside `FY2024`** — its `\b` fails on the
`Y`. A fix once used it, changed nothing, and both tests stayed red through it.

**Paths.** The rubric is `services/gravity-api/eval/head_to_head/rubric.py`;
`--ignore=tests/eval` does not exclude it.

**Standing decisions — do not reopen without new information.**

| Decision | Date | Effect |
|---|---|---|
| Numeric verification stays **advisory** | 2026-09-03 | Policy, not a technical fix. Never describe as "numeric correctness closed". |
| Live DB stays **unavailable** | 2026-09-03 | `SUPABASE_SERVICE_KEY` empty, anon RLS returns 0 rows. Blocks *which concept wins*, **not** determinism — see L9. |
| FinalGate stays **report-only** | round 1 | Reorder it freely; making it refuse is an escalation. |

**Still blocked on a human:** the blind head-to-head (no reference set exists)
and browser E2E for SEC links. Confirm in one line; do not spend an iteration.
