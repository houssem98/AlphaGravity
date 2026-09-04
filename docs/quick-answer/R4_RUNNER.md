# Round 4 runner

One-line invocation: **`/loop Execute docs/quick-answer/R4_RUNNER.md`**

No progress is written in this file. Progress lives in the R4 ledger, which is
the single place it is written and the single place it is read.

---

## 1. Where you are

Read in this order:

1. `docs/quick-answer/R4_GRAPH.md` — the U-IDs, their status, and **how each
   was established**. A row marked `UNVERIFIED` may not be actioned until a
   command has run.
2. `docs/quick-answer/R4_ROADMAP.md` — the nine parts, the loop order, the
   per-loop specs, and **the ledger at the bottom**.

The last ledger row is where you are. The next loop is the first in the loop
order whose defect is not `CLOSED` or `BLOCKED with a stated reason`.

`docs/quick-answer/refix-r3.md` is the fourth external audit. It is **input, not
truth**. Do not re-derive the defect list from it — `R4_GRAPH.md` already ran
every claim, narrowed two remedies, caught one misattribution, and found the
framing the audit missed.

Branch: `feat/web-research-sec-integration`. Baseline: `ad75be6`.

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
  while any `LIVE` row remains. Four consecutive audits have declined the first
  label; the fourth rated the system 8.2/10 and said "not yet world-class".
- **Append one ledger row per attempt. Never edit a row — supersede it.**
- **Do not touch Deep Research or the agentic orchestrator.**
- **Push before quoting a SHA to anyone outside the session.** Check with
  `git status -sb`.
- **Reconcile every count delta.** 2315 → N must be explained by the tests that
  commit adds. A rise larger than that means something duplicated; smaller means
  something stopped running. Both are invisible if you only compare totals.

## 3. Escalate — halt and ask

Deploys, pushes to `main`, any spend, any file entering the repo the loop did
not write and has not read, anything unverifiable this iteration, and:

**Any change that makes FinalGate refuse, rewrite, or suppress an answer.** The
gate's report-only behaviour is deliberate and pinned by
`test_the_gate_never_rewrites_the_answer`.

**Any change to what the benchmark counts as correct.** U1, U2 and U3 all make
the rubric stricter and move scores down. That is moving the measuring stick in
the honest direction, but it is still moving it. State the change, get it
agreed, then implement.

**N3 specifically.** `_claim_is_bound` carries six historical over-tightening
bugs. Escalate before changing it, and prefer an honest `BLOCKED` to a fragile
heuristic.

**Enabling CI.** `ruff check app/` reports 1347 errors and `ruff format --check`
reports 211 files, neither enforced. Renaming `ci.yml.disabled` turns `main` red
on lint while the tests pass. This is recorded in `R3_REPRODUCE.md` and is a
decision, not a task.

## 4. Evals — both, every loop

```bash
cd services/gravity-api
.venv/Scripts/python.exe -m pytest tests/ -q --ignore=tests/live --ignore=tests/eval
node ~/.claude/scripts/gate-guard.mjs
```

Baseline `2315 passed, 0 failed`, gate-guard clean. Record exact counts.

**Run the FULL suite, not the file.** Round 2 was caught three separate times by
tests a targeted run missed. When you change a shared constant or a literal,
grep every reference before running anything. Runs take 10–16 minutes and pytest
buffers its dots — an empty output file is not a hang.

## 5. Stop — check all three every loop

- **Target:** every `LIVE` row is CLOSED or BLOCKED-with-reason, both evals ran.
- **Budget:** 6 loops.
- **Stall:** 3 loops with no verdict change → stop and report. Do not invent a
  hypothesis to keep the loop alive.

---

## 6. Operating notes

Earned in rounds 1–3. They cost real time to learn.

**Round 4 is the unfinished half of round 3, not new territory.** Round 3's
thesis was that the benchmark must not out-permit the system it grades. L1
closed the class-name door. **U1 is the accession door, and it was narrowed and
left open.** All three P1s are in `rubric.py`; `FinalGate.check` reads
`source_class` alone and has none of them. Production is stricter than its own
grader.

**A fixture narrower than the function under test is the defect class that has
survived four audits.** T13 was round 3's own instance: L1 closed T1, its test
went red then green, and the hole was still open because the fixture carried no
accession. U1, U2 and U3 are three more. **Red-then-green does not prove the
hole is shut** — ask which branches the fixture actually reaches. N4 exists to
detect this class mechanically.

**Prove a detector fires before trusting it.** T8's publication-path test passed
the moment it was written, which is worthless on its own; a fourth path was
appended temporarily, both assertions failed, and the tree was reverted. Do the
same for N4: it must rediscover U1–U3 against pre-fix code.

**Narrow the remedy before implementing it.** The audit proposed a canonical
provenance object for U1 and canonical entity resolution for U2. Both are the
right long-run architecture and the wrong next commit; the graph records the
three-line versions that close the measured defects. An architecture project is
a good way to leave a P1 open for a month.

**Verify the roadmap, not just the code.** Round 1 falsified five of its own
assumptions, round 2 two, round 3 two more (M1's certification contradicted its
own guard; T6's count of four vocabularies was five). Expect round 4 to have its
own.

**Measurement can close a row.** M4 stage 0 refuted a planned refactor for one
instrumented suite run. But state the limit: those were suite counts, not
production traffic, and the conclusion is "not observed", never "cannot happen".

**A false statement in a test is worse than no statement.** T5 was round 2's
own: a docstring claimed the entity bind reads `cik`; it does not.

**`_YEAR` does not match the year inside `FY2024`** — its `\b` fails on the `Y`.

**Paths.** The rubric is `services/gravity-api/eval/head_to_head/rubric.py`;
`--ignore=tests/eval` does not exclude it. `search_pipeline.py` carries a BOM —
read it with `encoding="utf-8-sig"` if you parse it.

**Standing decisions — do not reopen without new information.**

| Decision | Date | Effect |
|---|---|---|
| Numeric verification stays **advisory** | 2026-09-03 | Policy, not a technical gap. |
| FinalGate stays **report-only** | round 1 | It is an audit gate, not a safety barrier — do not describe it as one. |
| Live DB stays **unavailable** | 2026-09-03 | Blocks *which concept wins*, not determinism. |
| R7 stays **BLOCKED** | 2026-09-03 | Two audits agreed. Do not retry with more regexes. |
| Unknown identity is **UNGRADED** | 2026-09-04 | Owner-agreed in round 3. Argue the implementation, not the choice. |
| M4 stages 1–5 **not recommended** | 2026-09-04 | Stage 0 measured the vocabularies as disjoint. Needs a new observation to reopen, not a restatement. |

**Still blocked on a human:** the blind head-to-head (no reference set exists),
browser E2E for SEC links, and independent execution of the suite (CI disabled;
enabling it fails on lint, not tests). Confirm in one line; do not spend an
iteration.

**And the one round 4 adds:** the evaluator credits evidence it has not
verified — a fabricated-but-well-formed accession, a substring entity match, and
a number appearing in a citation that contradicts it. **Until U1–U3 close, every
benchmark number this repository reports is an upper bound rather than a
measurement**, and should be described that way.
