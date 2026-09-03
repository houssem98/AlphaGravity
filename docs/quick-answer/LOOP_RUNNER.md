# Quick Answer loop — runner

One-line invocation: **`/loop Execute docs/quick-answer/LOOP_RUNNER.md`**

Everything the loop needs is here or reachable from here. Nothing about
progress is written in this file — progress lives in the ledger, which is the
single place it is recorded and the single place it is read from.

---

## 1. Where you are

Read, in this order:

1. `docs/quick-answer/WORLD_CLASS_FINANCE_QUICK_ANSWER_GRAPH.md` — node IDs,
   defect IDs, current per-defect status.
2. `docs/quick-answer/WORLD_CLASS_FINANCE_QUICK_ANSWER_LOOP.md` — the nine
   parts, the per-loop specs, and **the ledger table at the bottom**.

The last ledger row is where you are. The next loop is the first one in the
graph's dependency order whose defect is not already `CLOSED`, `DISPROVED`, or
`BLOCKED with a stated reason`.

Branch: `feat/web-research-sec-integration`. Baseline: `6c72822`.

---

## 2. Rules, all binding

- **Every new test runs against the UNFIXED code first and is observed to
  fail.** `git stash push` the fix, run, expect red, `git stash pop` — or write
  the test before the fix exists, which is stronger. A test written after a fix
  and never seen failing proves nothing. That already happened in this repo and
  the green test was hiding a live bug.
- **Never delete, skip, weaken, or loosen a test.** Run
  `node ~/.claude/scripts/gate-guard.mjs` before any commit claiming a fix.
- **Label every finding** `TESTED` (a command ran and you read the output),
  `READ` (static inspection only), or `BLOCKED` (with the reason). `BLOCKED`
  never becomes `PASS` by re-reading code. Only a run converts it.
- **Line numbers in both documents are hints, not references.** Re-grep. The
  graph's first draft had three wrong ones and has drifted again since.
- **`chatgpt answer.md` is audit input, not truth.** Do not re-derive the defect
  list from it. D1 is DISPROVED — do not "fix" it.
- **Never write** `world class`, `certified`, `production ready` or `fixed`
  while any certification rule in the loop file is unmet.
- **Append one ledger row per loop attempt. Never edit a row — supersede it**
  with a new row carrying a higher number.

## 3. Escalate — halt and ask

Deploys, pushes to `main`, any spend, any file entering the repo the loop did
not write and has not read, any result that would justify a certification
claim, anything unverifiable this iteration.

## 4. Evals — both, every loop

```bash
cd services/gravity-api
.venv/Scripts/python.exe -m pytest tests/ -q --ignore=tests/live --ignore=tests/eval
node ~/.claude/scripts/gate-guard.mjs
```

A loop that lowers the pass count or dirties gate-guard has failed, whatever it
claims to have fixed. Record the exact counts in the ledger row.

## 5. Stop — check all three every loop

- **Target:** every defect is `CLOSED`, `DISPROVED`, or `BLOCKED with a stated
  reason`, and both eval commands actually ran.
- **Budget:** 14 loops.
- **Stall:** 3 loops with no verdict change and no new failure mode. Stop and
  report. Do not invent a new hypothesis to keep the loop alive.

---

## 6. Operating notes

Things learned by running this loop that are not obvious from the specs.

**The dependency graph is unreliable.** Three of its edges were false —
L3→L5, L2→L7, L2→L8 all closed without their prerequisite running. The edges
encode "seemed related", not measured dependency. Re-check an edge before
inheriting it.

**`_YEAR` does not match the year inside `FY2024`.** Its `\b` fails against the
`Y`. A fix in L8 used it, changed nothing, and both defect tests stayed red
through it. Re-run after every fix; never conclude from the diff.

**Paths that the docs get wrong.** The rubric is at
`services/gravity-api/eval/head_to_head/rubric.py` — not `tests/eval/`, and
`--ignore=tests/eval` does not exclude it.

**Standing decisions.** Recorded with evidence in the ledger; do not reopen
without new information.

| Decision | Date | Effect |
|---|---|---|
| Numeric verification stays **advisory**, not blocking | 2026-09-03 | D7 closed by decision. The false-positive rate is unmeasurable here, and blocking without it refuses correct answers at an unknown rate. |
| Live DB stays **unavailable**; work offline | 2026-09-03 | `SUPABASE_SERVICE_KEY` is empty and the anon key is RLS-filtered to 0 rows. L4 and the L2 benchmark measurement stay BLOCKED. Do not retry the connection. |

**L9 and L10 are BLOCKED on human input** by design. Confirm in one line; do
not spend an iteration re-confirming.
