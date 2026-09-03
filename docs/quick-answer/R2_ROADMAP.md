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
| 1 | L1 | R1, R5 | 2026-09-03 | **CLOSED** | 2199 passed / 0 failed | clean | `68874a3` | 5 failed, 1 passed — verbatim in §Red evidence L1 |

### Red evidence — L1 (R13: committed, not merely observed)

Run against **unfixed** code, `tests/test_gate_runs_before_publication.py`:

```
E  AssertionError: the answer was published before the gate ran
   (order: ['answer', 'gate']); the verdict can only be a post-mortem
E  AssertionError: the answer event carries no contract_gate; the verdict
   exists only on the later metadata event
E  AssertionError: the no-evidence exit published a refusal with no gate
   verdict at all (order: ['answer'])
E  AssertionError: the refusal carries no contract_gate, so a reader cannot
   tell a checked refusal from an unchecked one
E  AssertionError: answer yield #2 publishes with no gate consultation above
   it; nothing in ('_gate_check(', 'gate_verdict_failed(') appears between it
   and the previous yield
5 failed, 1 passed in 53.95s
```

`order: ['answer', 'gate']` is R1 stated as a measurement rather than as a line
number. The sixth test passed before the change and after it: it is the
report-only guard, and a guard that goes red on a reorder would mean the reorder
had changed the answer.

The fifth line is the source-order assertion **after** it was rewritten. The
first version anchored on the first answer yield and was wrong about the code,
not about the property: the cache-hit yield consults a RECORDED verdict
(`gate_verdict_failed`) rather than recomputing one, which is correct on a
replay — re-running the gate would grade the same text twice and could disagree
with the verdict stored beside it. The rewrite checks all three publication
sites in per-yield windows, so a new ungated yield cannot inherit the gate call
belonging to the yield above it. It was re-run against unfixed code to confirm
it was red for the right reason before being kept.

### What the full suite caught that a targeted run did not

Five files passed (89 tests) while two suite tests failed. Both had one cause:
extracting `_gate_check` moved the string `FinalGate.check` out of
`SearchPipeline.search`, so `test_the_gate_runs_before_the_answer_is_cached`
raised `ValueError` on `src.index("FinalGate.check")`, and
`test_verification_doc_citations` then failed because it subprocess-runs that
file and reads its pass count (6, dropped to 5). The property never stopped
holding; the marker moved. Re-anchored on `_gate_check(` with `index` → `rindex`
— a strengthening, recorded in the commit message and accepted by gate-guard.

The operating note earned its place a second time: **re-run the full suite, not
the file.**

### R5 surfaced an escalation the loop did not take

The no-evidence exit builds an ordinary contract, so its refusal is graded as a
failed answer rather than as an abstention — `must_abstain` is never set on that
path, though "no supporting evidence found" is exactly the condition that clause
describes. Measured verdict on the fixture query: `passed: false`, violating
`min_citations` and `primary_source`. Setting `must_abstain` there would make
these refusals pass cleanly instead of logging two violations apiece.

That is contract policy, the same class of decision as D7, so it is **recorded
for the owner and not taken by the loop** (`R2_GRAPH.md` §3b). The loop's change
leaves the emitted refusal text byte-identical.

---

## Loop 2 — L2 (R4), and R14 which blocked it

| # | Loop | Defect | Started | Verdict | Backend count | gate-guard | Commit | Red-before-fix evidence |
|---|---|---|---|---|---|---|---|---|
| 2a | L2 | **R14** (new) | 2026-09-03 | **CLOSED** | 2211 passed / 0 failed | clean | `6d24502` | 2 failed, 5 passed — verbatim below |
| 2b | L2 | R4 | 2026-09-03 | **CLOSED** | 2211 passed / 0 failed | clean | `4ce93b9` | 2 failed, 3 passed — verbatim below |

### R14 — the loop found the roadmap's own blocker

L2 says: cache only a verdict that passed. Writing its guard test —
*the cache must keep working, or this empties the cache* — surfaced that the
guard could not pass, because **no answer passed the gate at all**.

`FinalGate` compares `source_class` against `{sec_filing, sec_xbrl}`.
`citation_provenance.payload()` stamps `SEC_EVIDENCE`. Two vocabularies for one
idea, never reconciled:

```
contract layer     sec_filing · sec_xbrl · earnings_call · analyst · news · web
provenance layer   SEC_EVIDENCE · LOCAL_EVIDENCE · WEB_EVIDENCE
```

So a citation to a real 10-K — accession, CIK, `verification_status: verified` —
failed *"contract requires a primary filing"*. Every SEC-cited answer failed the
clause, which means `answer_contract_violated` has been firing on essentially
every finance answer and carrying no signal at all.

It survived because the gate's own tests supply the literal string the gate
wants, `[{"source_class": "sec_filing"}]` — **a vocabulary the pipeline never
produces.** The gate was tested against something that does not exist upstream
of it. This is the round-1 lesson in a new costume: an inherited assumption
(*"the gate's verdicts mean something"*) that nobody had checked.

Red, on unfixed code:

```
E  AssertionError: a citation to a real filing was rejected as non-primary
   because the pipeline spells the class SEC_EVIDENCE and the gate expects
   sec_filing: ["contract requires a primary filing; no citation is
   sec_filing or sec_xbrl (saw ['SEC_EVIDENCE'])"]
E  AssertionError: a well-formed, correctly cited SEC answer fails its own
   contract, so the gate's verdict carries no signal
2 failed, 5 passed
```

Reconciled at the gate boundary, not upstream: `SEC_EVIDENCE` is a wire value
the API schema, the frontend and `core/research/evidence.py` all branch on, and
renaming it to satisfy an internal check would be a wide, outward-facing change
made to close a narrow one. Only the SEC member maps in — `LOCAL_EVIDENCE` is a
prose chunk and `WEB_EVIDENCE` is a web page, and four guard tests pin that both
stay non-primary along with `news`, `analyst` and `earnings_call`.

### R4 — the write, once the verdict meant something

Red, on unfixed code:

```
E  AssertionError: an answer whose gate verdict FAILED was written to the
   cache; the read path will now refuse it on every hit for the life of the
   entry
E  AssertionError: a cached entry does not carry a passing verdict:
   {'passed': False, 'violations': ['a rate change is reported in percent
    rather than percentage points'], 'checked': ['min_citations',
    'primary_source', 'change_unit']}
2 failed, 3 passed
```

`_gated = _gate_result is not None` — and a FAILED verdict is very much not
None. The rejected answer was written, then refused by `gate_verdict_failed` on
every subsequent hit for the life of the entry: the system recording a defect in
order to keep re-detecting it. Now `... and passed`. The read-path refusal is
**kept, not moved** — entries written before this are still in Redis — and a
test pins that both defences exist.

### A fixture that went green for the wrong reason, and the assertion that caught it

L2's first fixture was an uncited answer. R14's fix correctly made it **pass**,
because the pipeline attaches an `SEC_EVIDENCE` citation even when the model
returns none. The test would have gone quietly green while asserting nothing —
except that it opened with a premise check:

```python
assert gate is not None and gate["passed"] is False, (
    "the fixture no longer produces a failing verdict, so this test is "
    "not exercising the defect")
```

That fired, and the fixture was replaced with a real violation: a margin move
reported as `25%` instead of in percentage points — the classic finance error
the contract exists to catch — then re-verified red on unfixed code.

**Worth keeping as a habit.** A test whose red depends on a fixture should
assert that the fixture is still doing its job. Three of round 1's stub failures
were this same shape.

