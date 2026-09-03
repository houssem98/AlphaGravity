# Round 2 — Roadmap and Ledger

Branch `feat/web-research-sec-integration`. Baseline `6003631`.
Companion to `R2_GRAPH.md` — read that first; it carries the R-IDs and records
how each was established.

---

## The nine parts

**1. Goal.** Close every `LIVE` row in `R2_GRAPH.md`, or record why it cannot
close. Not "pass the re-audit" — that phrase is banned as a stop condition
because an auditor can be satisfied by wording.

**2. Context.** `R2_GRAPH.md`, `refix.md` (audit input only), and the round-1
ledger `WORLD_CLASS_FINANCE_QUICK_ANSWER_LOOP.md`, which records what was
already tried and why.

**3. Actions.** One loop per round, one defect per loop. Cycle is fixed:
`INPUT → INSPECT → TEST(red) → FIX → REGRESSION → RE-RUN(green) → GRAPH UPDATE
→ LEDGER ROW`.

**4. Tools.** `services/gravity-api/**`, `apps/gravity-ui/**`,
`docs/quick-answer/**`. Read-only elsewhere. No deploys. No pushes to `main`.
**Do not modify Deep Research or the agentic orchestrator** — the audit's scope
fence, and it binds.

**5. Evals.** Binary, exit-coded, no model judge:

```bash
cd services/gravity-api
.venv/Scripts/python.exe -m pytest tests/ -q --ignore=tests/live --ignore=tests/eval
node ~/.claude/scripts/gate-guard.mjs
```

Baseline to beat: **2193 passed, 0 failed**; gate-guard clean. A loop that
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

**R13 changes this section.** The auditor could not verify "red before green"
from the diff, and was right that it is unverifiable there. So the failing
output is no longer merely observed — **it is pasted into the ledger row and
committed.** A claim whose evidence lives only in a terminal is not evidence.

**8. Escalation — halt and ask.** Deploys, pushes to `main`, any spend, any
file entering the repo the loop did not write and has not read, anything
unverifiable this iteration, **and any change that makes the gate refuse an
answer** (see L1 below).

**9. Stop — all three, every loop.**
- **Target:** every `LIVE` row is CLOSED or BLOCKED-with-reason, and both eval
  commands ran.
- **Budget:** 10 loops.
- **Stall:** 3 loops with no verdict change → stop and report.

---

## Loop order

`L1` first: it is the P0 and every other cache/gate loop reads differently once
the gate has moved. `L2`–`L4` are the cache invariant and are best done
together-but-separately. `L5`–`L8` are grader semantics and are independent of
everything else — **round 1 proved the "grader depends on pipeline" edges were
false, so do not re-inherit them.**

```
L1  gate before publication        (R1, R5)   <- P0, do first
      |
      +-- L2  cache only a PASSED verdict     (R4)
      +-- L3  refuse unverdicted entries      (R3)
      +-- L4  ungated answer policy           (R2)   <- may ESCALATE

L5  per-claim binding              (R6)   ]
L6  proposition structure          (R7)   ]  independent of L1-L4
L7  period attachment hole         (R8)   ]
L8  entity binding                 (R9)   ]

L9  deterministic fact ordering    (R10)  <- static half only
L10 wording + evidence artefacts   (R11, R13)
```

---

## The loops

### L1 — The gate must run before the answer is published · R1, R5

- **INPUT:** graph R1. Answer yield 2030, gate 2085, cache 2131.
- **VERIFIED ALREADY:** the reorder is mechanically safe. `parsed_answer` final
  at 1903, `citations_out` at 2017, `scope_status` from `query_plan`, none
  reassigned in 2030–2085.
- **TEST (red first):** assert no `type="answer"` event can be emitted before
  `FinalGate.check` has run on a finance query. A source-order assertion is
  acceptable *in addition to* a behavioural one, never instead of it.
- **FIX:** move the gate above the yield and carry `contract_gate` on the
  answer event as well as the metadata event.
- **DO NOT** make the gate refuse, rewrite, or suppress the answer. That is a
  policy change of the same class as D7, which the owner decided. Reordering
  preserves report-only; refusal is **ESCALATE**.
- **R5:** the `no_evidence_exit` yield at 1257 is also ungated. Decide whether a
  refusal answer needs a contract check at all — the contract's `must_abstain`
  clause is exactly about this — and record the decision either way.
- **CERTIFICATION:** R1 closes when no answer event precedes a gate verdict on
  a finance query, proven by a test that failed before the move.

### L2 — Cache only a verdict that PASSED · R4

- **INSPECT:** `_gated = _gate_result is not None`.
- **TEST:** a FAILED verdict must not be written. Currently it is written and
  then refused on read — a defence at the wrong end.
- **FIX:** `_gate_result is not None and _gate_result["passed"]`.
- **GUARD:** the read-path refusal stays. Two defences, not one moved.

### L3 — An entry with no verdict is a miss · R3

- **INSPECT:** `gate_verdict_failed` returns `False` for `prov=None`.
- **TEST:** a legacy entry with no `_provenance` must not be served.
- **NOTE:** round 1 argued TTL makes this self-correcting. The auditor called
  that "operationally convenient, not logically sufficient" and is right — TTL
  proves expiry, not verification. Reverse the round-1 call.
- **GUARD:** a passing verdict must still serve, or this empties the cache.

### L4 — What happens when there is no contract · R2

- **INSPECT:** the `try`/`except finance_plan_failed` around `_contract`.
- **THE DECISION, not the code, is the deliverable.** Three options: refuse the
  answer; build a deterministic fallback contract; or state that ungated
  answers are permitted and label them as such on the wire.
- **ESCALATE** with the options and a recommendation. Do not pick silently.

### L5 — Per-claim binding · R6

- **TEST:** the audit's counterexample — three claims, one citation supporting
  only the first — must not score full evidence.
- **WARNING:** this is where over-tightening lives. Six of seven historical
  grader bugs came from it. A claim with no figure is not an unsupported claim.

### L6 — Proposition structure · R7

- **TEST:** an assertion moved into an em-dash, a semicolon clause or an
  appositive must be treated the same as one in the main clause.
- **FIX or BLOCK:** if robust proposition extraction is not achievable without
  a parser, mark `BLOCKED — needs sentence parsing` and say so. Do not widen
  the punctuation list and call it solved.

### L7 — The underspecified answer · R8

- **TEST:** "Apple revenue was $416.161B" for a case asking FY2025 must not
  score full period marks purely because no competing year appears.
- **GUARD:** an answer that names the right period must still score 1.0.

### L8 — Entity binding · R9

- **FIX:** bind on `cik`/`ticker` from the citation, not on surface strings.
  "Apple", "AAPL", "Apple Inc." and "the registrant" are one entity.
- **BLOCK** if the citations do not carry an issuer id — and check, do not
  assume.

### L9 — Deterministic fact ordering · R10

- The round-1 BLOCK was too wide. **Determinism is checkable offline.**
- **FIX:** add `ORDER BY` and an explicit, documented concept precedence, so
  the winner is stated rather than incidental.
- **STILL BLOCKED:** *which* concept should win needs production rows. Ship
  determinism; escalate the choice.

### L10 — Wording and evidence artefacts · R11, R13

- **R11:** no document may read as "numeric correctness closed". It is
  "policy deliberately remains advisory".
- **R13:** record red-before-green as a committed artefact, not a claim.

---

## Ledger

Append one row per loop attempt. Never edit a row; supersede it.

| # | Loop | Defect | Started | Verdict | Backend count | gate-guard | Commit | Red-before-fix evidence |
|---|---|---|---|---|---|---|---|---|
| 0 | — | — | 2026-09-03 | BASELINE | 2193 passed / 0 failed | clean | `6003631` | n/a — established, asserts nothing |
