# Closing `refix-r4.md` completely — the plan to 9+/10

The fifth audit scored the system **8.3/10, NOT CERTIFIED**, and named five
things it would need closed to reach 9+. This document maps **every ask in that
audit** to a stage, an owner, and the thing that proves it done. Nothing here is
marked closed by assertion.

**Read `R5_GRAPH.md` first.** It records one finding the audit did not make:
`_matches` could not distinguish `$130 million` from `$130 billion`, so an answer
wrong by 1000× scored `correctness 1.0`. **The 8.3 was produced by that
instrument**, as were the 8.0 and 8.2 before it. Every score in this project's
history is provisional until V1 lands.

---

## 1. The complete inventory

The audit makes eight ranked mutation asks and five architectural asks. They
overlap. Deduplicated, this is the whole of it:

| # | The ask | Node | Stage | Verdict |
|---|---|---|---|---|
| 1 | Claim → citation-index mapping (an **edge**, not a field) | V2 | **R5** | Fixable now |
| 2 | Unit + scale semantics | V1 | **R5** | **P0, fix in — worse than the audit knew** |
| 3 | `verification_status` first-class | V3 | **R5** | Fixable now, moves scores |
| 4 | Period mutation | V4 | **R5** | Rig coverage |
| 5 | Segment vs consolidated scope | V4 | **R5** | Rig coverage |
| 6 | Currency | V4 | **R5** | Rig coverage |
| 7 | Restated / amended / superseded state | V4 | **R6** | Needs a data model first |
| 8 | Document / evidence location | V4 | **R5** | Rig coverage |
| 9 | Atomic claim→evidence verification | V5 | **R6** | Architecture |
| 10 | Canonical provenance, one model end to end | V6 | **R6** | Architecture, and see the caveat |
| 11 | Production certification | V7 | **R7** | **Blocked on a human** |

**R5 closes 1–6 and 8. R6 owns 7, 9 and 10. R7 is not reachable from inside this
loop and never has been.**

---

## 2. R5 — the grader stops being wrong

Entry: `5c4a1a5`, 2394 passed. Budget 6 loops. Detail in `R5_ROADMAP.md`.

| Loop | Node | Deliverable | Proof |
|---|---|---|---|
| P1 | V1 | A figure that states its magnitude keeps it | A 1000×-wrong answer scores `correctness 0.0`; bare `"416,161"` still scales |
| P2 | V2 | A sentence binds against the citations it names | Answer cites `[1]`, figure only in `[2]` → no bind. Fails open with no marker |
| P3 | V3 | `unverified` evidence is not equal to verified | Escalated: refuse credit, or leave ungraded per T4's discipline |
| P4 | V4 | Rig mutates period, scope, currency, location, unit/scale, citation index | **Each mutation must fail against pre-fix code**, as round 4's did |
| P5 | V5–V8 | Honest reporting of what remains | No banned words while any row is LIVE |

**The rule that makes R5 different from R3 and R4:** those rounds made the
rubric *stricter*. V1 makes it *correct*. That is not the same achievement and
the documents must not blur them.

**Exit criteria.** Every V-row CLOSED or BLOCKED-with-reason; suite ≥ 2394 with
every delta reconciled; gate-guard clean; **and every fix reachable by a rig
mutation**, so regressions are caught by the rig rather than by a sixth audit.

---

## 3. R6 — the system, not the grader

**This is the round the audit is really asking for**, and it agrees with the
diagnosis: rounds 3 and 4 each changed exactly one non-test, non-doc file, and
it was the grader both times. R5 does too. **R6 must change the system or the
trajectory is itself the finding.**

The audit's target shape:

```
Answer
 └── Claim C1 ── Evidence E17, E23
```

with each claim satisfying entity × period × metric × value × unit × scope ×
source × provenance.

### R6.1 — The evidence/claim contract (V5)

**Deliverable:** a typed `Claim` object carrying the dimensions above, produced
by the pipeline and checked by `FinalGate`, not reconstructed by the grader from
prose.

**Why this is the keystone.** Every grader defect in rounds 3–5 exists because
the rubric re-derives from text what the pipeline never recorded. `_is_primary`
guesses provenance from a class name, an accession and a URL. `_entity_is_bound`
greps issuer strings. `_claim_is_bound` matches numbers. **All three are
compensating for a missing contract.** Build the contract and the grader stops
guessing.

**Stage it, and do not big-bang it:**

1. Define `Claim` and emit it alongside the existing answer — nothing consumes
   it, nothing changes. Reversible by deletion.
2. `FinalGate` reads it *additively*: report claim-level violations, refuse
   nothing. The gate stays report-only, which is a standing decision.
3. The rubric grades from `Claim` where present, from prose where absent, and
   **reports which**. Coverage becomes visible rather than assumed.
4. Only then consider removing a prose fallback, one dimension at a time.

**Escalate the plan before stage 1.** A half-built claim graph is worse than
none: it adds a sixth vocabulary to the five round 3 counted.

### R6.2 — Restatement and amendment state (ask 7)

Needs R6.1's `Claim` first — a superseded figure is a property of the *filing*,
and there is nowhere to record it today. **Do not attempt before R6.1 stage 3.**

### R6.3 — Canonical provenance (V6) — with the caveat the audit skipped

The audit restates that competing vocabularies exist. **Round 3 measured this.**
`m4-stage0-observed-vocabulary.json` recorded the three `is_primary` predicates
seeing *disjoint* value populations, `skills/scope.py` off the request path, and
the disputed spellings emitted by no production code.

**So R6.3 is not "unify the vocabularies".** It is: *if R6.1's `Claim` becomes
the single carrier of provenance, the vocabularies stop mattering, because
nothing re-derives provenance from a string.* Canonical provenance is a
consequence of the contract, not a separate refactor.

**Reopening M4 as a standalone refactor still needs a new observation.** A
restatement is not one.

---

## 3b. The eight certification requirements, measured

The fifth audit lists eight things it wants before certification. They were
measured against the repository rather than assumed, and the result corrected
two entries in this document's first draft — **one too generous, one too
harsh.**

| # | Requirement | Status | Evidence |
|---|---|---|---|
| 1 | Unit tests | ✅ **Strong** | 118 files, 2457 passing, every delta reconciled to the tests that explain it |
| 2 | Integration tests | ✅ **Strong** | 4 pipeline e2e files exercising the real `SearchPipeline` with stubbed boundaries |
| 3 | Real SEC fixtures | ✅ **Strong** — R5 | `tests/real_sec_fixtures.py`: three verbatim corpus excerpts, real issuer/ticker/date/section, real accessions from 10-K filenames. **Found V12 on their first run** |
| 4 | Mutation tests | ✅ **Strong** | `test_provenance_mutation_rig.py`, proven to fire against pre-fix code |
| 5 | Browser / **API** E2E | 🟡 **API strong, browser absent** | `test_search_stream_contract.py` drives real `TestClient` WebSocket sessions against the actual FastAPI app. **Browser** E2E does not exist: `apps/gravity-ui` — the only WebSocket client of this path — has no test directory. **Unwritten, not blocked** |
| 6 | Live database | ❌ **Absent** | Genuinely blocked; no environment. Blocks *which concept wins*, not determinism |
| 7 | Performance measurements | ✅ **Strong** — R5 | Was worse than absent: `eval/*/perf.py` existed and was never collected, so the file listing implied latency was measured while nothing measured it. Now four guards in the suite |
| 8 | Failure injection | ✅ **Strong** — R5 | Was one channel-isolation file. Now six injected boundaries — model raises, `content=None`, malformed output, total retrieval failure, cache read, cache write — plus a control proving the healthy path publishes |

**Two corrections to this document's first draft, both worth stating.**

Item 5 was called absent. That was wrong: API-level E2E is real and good. Only
the *browser* half is missing.

Item 7 was called "blocked on a human". That was too generous. Nothing blocked
it — the harnesses were simply never wired into the suite, which is worse than
absent because the file listing implied coverage that did not exist.

**Six of eight are now strong. Item 5's browser half and item 6 remain**, and
only item 6 is genuinely blocked.

---

## 4. R7 — certification, and what actually blocks it

Every item here is **blocked on a human**, and has been for five rounds. Stating
the unblock condition precisely, because "blocked" without one is an excuse.

| Blocker | Unblock condition | Who |
|---|---|---|
| Blind head-to-head unrun | **A reference set must be authored** — recorded answers with ground-truth figures, written before the run. Nobody has made one. This is not a coding task | Human |
| Browser E2E for SEC links | **Not blocked — unwritten.** `apps/gravity-ui` has no test directory at all, and it is the only WebSocket client of this path. Needs a Playwright harness against a running app; `apps/market-ui` already has one to copy the shape from | Loop, once an app instance is runnable |
| No independently executed count | **CI enable + lint debt.** `ruff check app/` = 1347 errors, `ruff format --check` = 211 files, neither enforced. Enabling `ci.yml.disabled` turns `main` red on lint while tests pass | Human decision, then a lint round |
| Live DB unavailable | Blocks *which concept wins*, not determinism | Human/infra |
| Performance + failure injection | Needs the above | Human |

**The cheapest real progress here is a narrow CI workflow running only the
suite**, scoped to this branch, leaving `ci.yml.disabled` untouched. The test
scope is already verified green (`2394 passed, 56 skipped` with no `--ignore`
flags). That converts "repository-reported" into "independently executed" for
the count, without paying the lint debt first.

---

## 5. What this plan will not claim

- **Not "everything fixed".** R5 closes seven of eleven asks. R6 closes three
  more and is a genuine architecture round. R7 closes one and **cannot start
  from inside this loop**.
- **Not a score.** 8.3 was produced by a grader that could not tell millions
  from billions. Any number quoted before V1 lands, including that one, is
  provisional. The next credible score comes after R5 exits — and the honest
  expectation is that **it may go down**, because a correct instrument grades
  more harshly than a broken one.
- **Not certification.** Five audits have declined it. R7 is the round that
  could change that, and R7 is blocked on a reference set nobody has written.

**The single highest-leverage action available to a human right now is authoring
the reference set.** It has blocked certification since round 1, it is the one
item no amount of loop work can produce, and without it the blind head-to-head —
the thing that would actually answer "is this better than ChatGPT" — cannot run
at all.
