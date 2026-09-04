# Round 3 — Roadmap and Ledger

Branch `feat/web-research-sec-integration`. Baseline `82a7d3d`.
Companion to `R3_GRAPH.md` — read that first; it carries the T-IDs and records
how each was established.

---

## The nine parts

**1. Goal.** Close every `LIVE` row in `R3_GRAPH.md`, or record why it cannot
close. Not "satisfy the auditor" — that phrase is banned as a stop condition,
because an auditor can be satisfied by wording.

The round-3 goal has a second half the earlier rounds did not: **the evaluator
must not be semantically weaker than the thing it evaluates.** T1–T3 are all
instances of the benchmark being more permissive than production.

**2. Context.** `R3_GRAPH.md`, `refix-2.md` (audit input only), and the round-2
ledger `R2_ROADMAP.md`, which records what was tried and why.

**3. Actions.** One loop per round, one defect per loop. Cycle is unchanged:
`INPUT → INSPECT → TEST(red) → FIX → REGRESSION → RE-RUN(green) → GRAPH UPDATE
→ LEDGER ROW`.

**4. Tools.** `services/gravity-api/**`, `apps/gravity-ui/**`,
`docs/quick-answer/**`. Read-only elsewhere. No deploys. No pushes to `main`.
**Do not modify Deep Research or the agentic orchestrator.**

**5. Evals.** Binary, exit-coded, no model judge:

```bash
cd services/gravity-api
.venv/Scripts/python.exe -m pytest tests/ -q --ignore=tests/live --ignore=tests/eval
node ~/.claude/scripts/gate-guard.mjs
```

Baseline to beat: **2270 passed, 0 failed**; gate-guard clean. A loop that
lowers either has failed whatever it claims.

**6. Memory.** Append one row per loop attempt to the ledger below. Never
rewrite a row — supersede it.

**7. Guardrails.**

| Rule | The command that proves it held |
|---|---|
| No test weakened | `node ~/.claude/scripts/gate-guard.mjs` |
| Test count never drops | compare the pytest tail to the previous row |
| New test catches the bug | run it against unfixed code, **paste the failing output into the ledger row** |
| `main` untouched | `git rev-parse --abbrev-ref HEAD` |
| **Every claimed SHA is reachable** | `git status -sb` shows no `ahead`, before any SHA is quoted to an outsider |

The last row is new. Round 2 handed an auditor a commit range that existed only
locally; the audit correctly refused to proceed and a full cycle was lost to it.
**Push before quoting a SHA.**

**8. Escalation — halt and ask.** Deploys, pushes to `main`, any spend, any file
entering the repo the loop did not write and has not read, anything unverifiable
this iteration, **any change that makes the gate refuse an answer**, and:

**Any change to what the benchmark counts as correct.** T4 changes a score from
credited to ungraded. That moves the measuring stick, and a loop that can move
its own measuring stick can close anything. State the policy, get it agreed,
then implement.

**9. Stop — all three, every loop.**
- **Target:** every `LIVE` row is CLOSED or BLOCKED-with-reason, both evals ran.
- **Budget:** 8 loops.
- **Stall:** 3 loops with no verdict change → stop and report.

---

## Loop order

`M1`–`M2` are one function (`_is_primary`) and are the P1 cluster: the evaluator
handing out primary-source credit it has not earned. `M3` is the entity
dimension and is a policy call before it is a code change. `M4` is the
generator of all of them and is almost certainly larger than one loop. `M5`–`M7`
are method and wording.

```
M1  rubric source-class set        (T1, T2)   <- P1, do first
M2  accession must be validated    (T3)       <- P1, same function
      |
M3  unknown identity is UNGRADED   (T4, T5)   <- may ESCALATE (moves the stick)

M4  one canonical evidence class   (T6)       <- likely BLOCKED / staged
M5  cache tuple binding            (T7)       <- BLOCKED until a mutation path exists
M6  a fourth publication path?     (T8)
M7  wording + independent run      (T9, T10)
```

---

## The loops

### M1 — The rubric must not out-permit the gate · T1, T2

- **INSPECT:** `_PRIMARY_CLASS_NAMES` in `eval/head_to_head/rubric.py`.
- **MEASURED:** `local_evidence` → primary `True`; `structured` → primary `True`.
  `FinalGate` excludes both. The benchmark is more permissive than the system.
- **TEST (red first):** a `LOCAL_EVIDENCE` citation must not earn primary
  credit. A `WEB_EVIDENCE` citation must not either (already true — pin it).
- **FIX:** drop `local_evidence`. For `structured`, **do not drop it** — key on
  the `_xbrl` id suffix that `structured_search` already uses to separate exact
  XBRL rows from backfill. A `structured` row whose id ends `_xbrl` IS a filed
  figure; one that does not is not.
- **GUARD:** every class the gate accepts must still score primary, or M1 has
  traded a permissive rubric for a blind one. `sec_filing`, `sec_xbrl`,
  `sec_evidence`, `edgar`, `edgar_text` all keep passing.
- **CERTIFICATION:** the rubric's primary set is a subset of, or equal to, what
  `FinalGate.is_primary_class` accepts, and a test asserts that relationship
  directly rather than restating both lists.

### M2 — An accession is evidence only if it is an accession · T3

- **INSPECT:** `if c.get("accession") or c.get("accession_number"): return True`.
- **MEASURED:** `WEB_EVIDENCE` + `accession="totally-invented-value"` → primary.
  `news` + `accession_number="x"` → primary.
- **THE RULE IS DELIBERATE.** Its comment says a citation carrying a *real*
  accession came from a filing whatever anyone labelled it. That intent is
  sound. Nothing checks "real".
- **TEST:** a fabricated accession must not confer primary status; a genuine
  one (`0001045810-25-000023`, the 10-2-6 digit form) still must.
- **FIX:** validate the format, and consider requiring it to co-occur with SEC
  provenance (a `sec.gov` URL or a verified status) rather than standing alone.
- **WARNING:** this is where over-tightening lives in this file's history. A
  citation with a real accession and a sloppy `source_class` is exactly what the
  rule was written to rescue. Do not regress that.

### M3 — Unknown identity is UNGRADED, not credited · T4, T5

- **INSPECT:** `_entity_is_bound` returns `None`; `score_answer` penalises only
  on `False`, so `None` keeps the presence credit.
- **THE DECISION, not the code, is the deliverable.** The helper is honest
  ("cannot check"); the scorer hears "passed". Three options: leave as is and
  document that the entity dimension is presence-only when identity is absent;
  drop the token from `checks` so the dimension is genuinely ungraded; or treat
  absent identity as a failure. The middle one is what the auditor argues for
  and is probably right, because it changes a silent credit into a visible gap.
- **ESCALATE** with the options and a recommendation. This moves the measuring
  stick — see part 8.
- **T5 rides along and is not optional.** `_ISSUER_FIELDS` omits `cik` while
  round 2's own test docstring claims it is included. Either add `cik` (and
  explain how an integer is meant to match a name token) or **correct the
  docstring**. A false statement in a test is worse than no statement: it is
  evidence pointing the wrong way.

### M4 — One canonical evidence class · T6

- Four vocabularies exist: `answer_contract.SourceClass`,
  `research/evidence.py`, API `Citation.source_class`, `SourcePassage.evidence_kind`.
- R14 happened because two layers invented their own enum. T1–T3 are the same
  generator firing again.
- **This is almost certainly larger than one loop, and a half-done type
  unification is worse than none** — it adds a fifth vocabulary.
- **Deliverable is a STAGED PLAN, not a big-bang refactor:** name the canonical
  enum, name the single `is_primary` predicate all layers call, list every call
  site, and stage it so each step is independently green. Then **ESCALATE the
  plan** before executing it.
- **BLOCK** if the plan cannot be staged safely, and say why.

### M5 — Cache tuple binding · T7

- The stored invariant is "we recorded passed: true", not "this answer,
  these citations and this contract are what passed".
- **BLOCKED until a mutation path is demonstrated.** The auditor concedes it is
  not a live defect without one. Spend at most one iteration looking for a path
  by which a cached entry's answer or citations can change while its verdict
  does not; if none is found, record `BLOCKED — no mutation path` and stop.
- Do not build a content hash to close a defect nobody has shown exists.

### M6 — Is there a fourth publication path? · T8

- The audit's framing is **partly wrong** and the graph says so: all three known
  paths have behavioural tests, not just a source scan.
- The real question is completeness. **FIX:** a test that enumerates every
  `yield SearchEvent(type="answer")` in `SearchPipeline.search` and asserts the
  count, so a new path added later fails loudly instead of inheriting.
- That is the same technique the round-2 source test used, applied to the thing
  it was actually good for.

### M7 — Wording and independent execution · T9, T10

- **T9:** no document may describe the rubric as doing "claim-level grounding".
  It is per-sentence. Say per-sentence.
- **T10:** the suite count has never been executed outside the session that
  produced it. **Deliverable:** a committed artefact an outsider can reproduce —
  the exact command, its output, and ideally a CI workflow so a SHA carries a
  status check. `2270 passed` with nobody able to re-run it is a claim.

---

## Ledger

Append one row per loop attempt. Never edit a row; supersede it.

| # | Loop | Defect | Started | Verdict | Backend count | gate-guard | Commit | Red-before-fix evidence |
|---|---|---|---|---|---|---|---|---|
| 0 | — | — | 2026-09-04 | BASELINE | 2270 passed / 0 failed | clean | `82a7d3d` | n/a — established, asserts nothing |
| 1 | M1 | T1, T2 | 2026-09-04 | **CLOSED** · T11, T12 opened | 2280 passed / 0 failed (939.46s) | clean | `4ce49b0` | `4 failed, 5 passed in 1.73s` on unfixed code — `test_local_evidence_is_not_a_primary_filing[LOCAL_EVIDENCE]`, `[local_evidence]`, `test_a_structured_backfill_row_is_not_a_primary_filing`, `test_a_structured_row_with_no_id_is_not_a_primary_filing`. All four `AssertionError: assert True is False`. |

### L1 notes

**What closed.** `local_evidence` is out of `_PRIMARY_CLASS_NAMES` (T1).
`structured` stayed in, keyed on the `_xbrl` id suffix rather than dropped
wholesale as the audit proposed (T2) — dropping it would have blinded the rubric
to the most authoritative rows in `financials`. Both directions pinned: an
`_xbrl` row still scores primary, a `_backfill` row no longer does.

**Count arithmetic.** 2270 → 2280 is +10, and +10 is exactly the tests added:
nine in `test_rubric_not_wider_than_gate.py`, net +1 in
`test_head_to_head_rubric.py` where two parametrize cases moved out and two
functions carrying three assertions moved in. No test was deleted, skipped or
loosened, and gate-guard judged the supersede a rewrite at equal strength.

**Deliberately not done.** The accession rule stays reachable for a `structured`
citation. Gating it behind the class check would stop a row with a genuine
accession from qualifying, which is the over-tightening this file's history
already paid for once. Validating the accession is T3 / M2.

**Two findings opened, neither in any audit.**

- **T11** — `app/core/skills/scope.py:192` holds a fifth `PRIMARY_CLASSES` set
  that T6 does not count, and it spells XBRL a sixth way (`xbrl`). M4 is scoped
  one call site short before it starts.
- **T12** — M1's CERTIFICATION contradicts M1's GUARD. The subset relation it
  asks for cannot hold while `edgar`/`edgar_text` must keep passing, because the
  gate does not know those names. **The certification is not met**, and L1 says
  so rather than satisfying it by quietly dropping `edgar` from the rubric. The
  safe half is implemented and tested: every class the gate credits still scores
  primary, asserted against `answer_contract`'s own sets rather than by
  restating a list.

Recorded as nodes before moving on, which is the one thing round 2's L8 did not
do when it saw T1 six weeks early.

| # | Loop | Defect | Started | Verdict | Backend count | gate-guard | Commit | Red-before-fix evidence |
|---|---|---|---|---|---|---|---|---|
| 2 | M2 | T3 | 2026-09-04 | **CLOSED** · T13 opened and closed | 2298 passed / 0 failed (572.22s) | clean | `79660a6` | `11 failed, 6 passed in 0.70s` on unfixed code — nine `test_a_fabricated_accession_does_not_confer_primary_status` cases (`invented`, `totally-invented-value`, `x`, `true`, `0000320193`, `0000320193-25`, `0000320193-25-00007`, `000032019-25-000079`, `0000320193/25/000079`), plus `test_a_bogus_accession_number_does_not_confer_primary_status` and `test_a_bogus_accession_cannot_rescue_a_class_the_gate_refuses`. |

### L2 notes

**What closed.** `_is_primary` now validates the accession's shape instead of
its truthiness. The rule itself is kept, deliberately: a real accession still
outranks a wrong or missing `source_class`, because that is the case it exists
to rescue.

**L1 had not actually shut T1.** This is the loop's own error and is recorded as
**T13**. After `4ce49b0`, `LOCAL_EVIDENCE` plus any junk accession still scored
primary — the unvalidated accession rule sits directly below the class check and
readmitted precisely what the class check had just refused. L1's test passed
because its fixture carried no accession. A fixture exercising one field cannot
close a defect in a function that reads several, and red-then-green does not
prove the hole is shut. `test_a_bogus_accession_cannot_rescue_a_class_the_gate_refuses`
now pins the interaction.

**Two departures from M2's text, both deliberate and both the anti-over-tightening
direction.**

- **Both accession forms are accepted**, not only the dashed 10-2-6 M2 names.
  `sec_filing_resolver.nodash()` and `ingestion/sources/earnings.py` both strip
  the dashes, so either form can reach a citation legitimately. A dashed-only
  rule would refuse genuine filings. The validator is declared in the rubric
  rather than imported from `sec_filing_resolver`, following that module's own
  stated reason for redeclaring: it governs what may enter a URL path, where
  strictness is right; this governs what counts as evidence.
- **The "co-occur with SEC provenance" condition is not added.** The
  `sec.gov/Archives` URL rule already admits any citation carrying such a link,
  so requiring it would make the accession rule redundant and destroy the case
  it rescues — real accession, sloppy class, no URL.

**What this does NOT establish.** Shape, not existence. A well-formed invention
passes. Closing that needs an EDGAR lookup the rubric will not make. The claim
is "the bar moved from any truthy string to the shape EDGAR issues" and nothing
larger; the code comment carries the same caveat so it cannot be overstated
later from the docs alone.

**Six guard assertions were written before the fix and passed before it**, so
that a later loop cannot delete the accession rule outright and stay green.
