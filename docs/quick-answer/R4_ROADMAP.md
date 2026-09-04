# Round 4 — Roadmap and Ledger

Branch `feat/web-research-sec-integration`. Baseline `ad75be6`.
Companion to `R4_GRAPH.md` — read that first; it carries the U-IDs and records
how each was established.

---

## The nine parts

**1. Goal.** Close every `LIVE` row in `R4_GRAPH.md`, or record why it cannot
close. Not "satisfy the auditor" — an auditor can be satisfied by wording.

Round 4's goal has a sharper second half than round 3's. Round 3 established
that the evaluator must not be weaker than the system. **Round 4 must make the
evaluator refuse evidence it cannot verify** — U1, U2 and U3 are all cases where
it accepts a syntactic proxy for a semantic fact.

**2. Context.** `R4_GRAPH.md`, `refix-r3.md` (audit input only), and the round-3
ledger `R3_ROADMAP.md`, which records what was tried and why.

**3. Actions.** One loop per round, one defect per loop:
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

Baseline to beat: **2315 passed, 0 failed**; gate-guard clean. A loop that lowers
either has failed whatever it claims. Runs take 10–16 minutes; pytest buffers
its progress dots, so an empty output file is not a hang.

**6. Memory.** Append one row per loop attempt to the ledger below. Never
rewrite a row — supersede it.

**7. Guardrails.**

| Rule | The command that proves it held |
|---|---|
| No test weakened | `node ~/.claude/scripts/gate-guard.mjs` |
| Test count never drops | compare the pytest tail to the previous row |
| New test catches the bug | run it against unfixed code, **paste the failing output into the ledger row** |
| `main` untouched | `git rev-parse --abbrev-ref HEAD` |
| Every claimed SHA is reachable | `git status -sb` shows no `ahead` before any SHA is quoted out |
| **Every delta is reconciled** | a count that rises by more than the tests added means something duplicated; by less, something stopped running |

**8. Escalation — halt and ask.** Deploys, pushes to `main`, any spend, any file
entering the repo the loop did not write and has not read, anything unverifiable
this iteration, **any change that makes the gate refuse an answer**, and:

**Any change to what the benchmark counts as correct.** U1, U2 and U3 all make
the rubric stricter, which moves scores down. That is still moving the measuring
stick. State the change, get it agreed, then implement.

**Any change to `_claim_is_bound`'s leniency.** Six of seven historical grader
bugs in that file came from over-tightening. U3's fix is the highest-risk change
in this round for exactly that reason.

**9. Stop — all three, every loop.**
- **Target:** every `LIVE` row is CLOSED or BLOCKED-with-reason, both evals ran.
- **Budget:** 6 loops.
- **Stall:** 3 loops with no verdict change → stop and report.

---

## Loop order

`N1` and `N2` are bounded correctness fixes with clear tests. `N3` is the large
one and may not close. `N4` is the audit's own recommendation and is the only
item that attacks the *class* rather than the instances.

```
N1  accession may not overrule a denial   (U1)   <- P1, smallest, do first
N2  entity bind on word boundaries        (U2)   <- P1, bounded
      |
N3  claim binding needs the metric        (U3)   <- P1, largest, may be PARTIAL
      |
N4  adversarial provenance mutation rig   (U7)   <- the class detector
N5  wording + attribution                 (U5, U6)
```

**A note on order.** There is an argument for running `N4` first: a mutation rig
would independently rediscover U1–U3, which would prove the rig works before it
is trusted — the technique that made T8's detector credible. It is second in the
list only because U1 and U2 are three-line fixes and leaving known-live P1s open
while building a harness is the wrong risk. **If N1 or N2 turns out larger than
stated, reorder and build the rig first.**

---

## The loops

### N1 — An accession may not overrule a positive denial · U1

- **INSPECT:** `_has_real_accession` and its position in `_is_primary`.
- **MEASURED:** `WEB_EVIDENCE`, `LOCAL_EVIDENCE` and `news`, each with
  `accession="0000320193-25-000079"`, all return `True`. So does `''`.
- **THE DISTINCTION IS THE FIX.** The rule rescues a citation whose class is
  *absent or unknown*; `''` → `True` is it working. A class of `WEB_EVIDENCE` is
  not a missing label, it is an assertion that this is a web page. Rescue the
  unknown; do not overrule the denial.
- **TEST (red first):** the three denial classes must lose primary status while
  `''`, an unrecognised class, and a genuinely absent key keep it.
- **FIX:** name the classes that positively deny filing provenance and skip the
  accession rule for them. Keep it for everything else.
- **WARNING:** do not implement this as an allow-list of classes that may use
  the accession rule. That inverts the rescue — an unknown class would stop
  qualifying, which is the exact case the rule exists for.

### N2 — The entity bind needs word boundaries · U2

- **INSPECT:** `_entity_is_bound`, `tok in i`.
- **MEASURED:** `'apple'` binds `PINEAPPLE HOLDINGS`; `'cat'` binds
  `CATERPILLAR INC`; `'am'` binds `AMAZON COM INC`.
- **FIX:** match on word boundaries rather than substring.
- **GUARD, and it is not optional:** the multi-field leniency exists because a
  real citation was measured carrying `issuer='NVIDIA CORP'`, `ticker=''`. Every
  existing binding case must still bind — `AAPL` via ticker, `Apple 10-K FY2025`
  via document_title, multi-word tokens like `old dominion`. A fix that kills
  the substring and also kills those has traded a false positive for a false
  negative.
- **NOT canonical entity resolution.** The audit argues for it; it is a separate,
  larger question and must not block this.

### N3 — Claim binding must know which metric the number belongs to · U3

- **MEASURED:** answer `"NVIDIA revenue was $130 billion."` binds against excerpt
  `"NVIDIA's operating expenses were $130 billion while revenue was $120 billion."`
  The citation contradicts the answer and the bind succeeds.
- **THIS IS THE LARGEST ROW IN THE ROUND** and probably cannot close fully. The
  bar the audit states — proposition × metric × entity × period × value ×
  source × verified provenance — is an architecture, not a loop.
- **What can plausibly be done in one loop:** when the answer's sentence names a
  metric and the excerpt associates that same number with a *different* named
  metric, refuse the bind. That is narrower than semantic support and catches
  the demonstrated case.
- **ESCALATE before implementing.** This changes scores and touches the function
  with six historical over-tightening bugs.
- **BLOCK honestly if the narrow rule cannot be made safe.** `BLOCKED — lexical
  binding is a known upper bound` with the measured example recorded is a better
  outcome than a fragile heuristic that breaks three correct answers.

### N4 — Adversarial provenance mutation rig · U7

- The audit's own recommendation and the best thing in it.
- Take real production citation objects, mutate **one** provenance dimension at
  a time — source class, accession, CIK, issuer, ticker, period, metric, value,
  URL — and assert the grader's verdict changes in the expected direction.
- **This is a detector for the T13 class**, the defect shape that has survived
  four audits: a fixture narrower than the function under test.
- **Prove the rig fires before trusting it**, the way T8's detector was proven:
  it must independently rediscover U1, U2 and U3 when run against pre-fix code.
  A rig that reports nothing on known-defective code is measuring nothing.
- Fixtures must come from **real** citation objects. A rig built from invented
  shapes reproduces the blind spot it exists to find.

### N5 — Wording and attribution · U5, U6

- **U5:** the behavioural gate-ordering test is round 2's work
  (`test_gate_runs_before_publication.py`). Round 4 documents must not inherit
  credit for it.
- **U6:** the 8.0 → 8.2 movement covers a round in which one non-test file
  changed and no answer improved. Record it as re-scored confidence, not as
  system improvement, so no later document cites it as evidence of progress.

---

## Ledger

Append one row per loop attempt. Never edit a row; supersede it.

| # | Loop | Defect | Started | Verdict | Backend count | gate-guard | Commit | Red-before-fix evidence |
|---|---|---|---|---|---|---|---|---|
| 0 | — | — | 2026-09-04 | BASELINE | 2315 passed / 0 failed | clean | `ad75be6` | n/a — established, asserts nothing |
| 1 | N1 | U1 | 2026-09-04 | **CLOSED** · U9 opened and closed | 2345 passed / 0 failed (679.21s) | clean | `0947849` | `21 failed, 9 passed in 1.90s` on unfixed code — `test_an_accession_cannot_make_a_declared_non_filing_primary` across ten declared-media classes × two accession fields, plus `test_the_audits_exact_case`. |

### N1 notes

**What closed.** The accession rule now rescues a class that makes no claim and
does not overrule one that denies filing provenance. `''`, `'unknown'` and any
unrecognised label still bind on a real accession — that is the rule working.
`WEB_EVIDENCE`, `LOCAL_EVIDENCE`, `news`, `web`, `blog`, `analyst`,
`earnings_call` and `transcript` no longer do.

**The distinction is the fix, and the audit did not draw it.** `refix-r3.md`
argued the accession rule is unverifiable provenance needing a canonical
provenance object. That is the right long-run architecture and the wrong next
commit — it would have left a P1 open behind an architecture project. The
measured defect was narrower: an accession outranking a producer that told us
what the source is.

**`_DENIES_FILING_PROVENANCE` is a set of declared media, deliberately.** Not
"everything not primary". An unrecognised class must stay outside it or the fix
inverts the rule it protects and the rescue case dies — the over-tightening this
file has undone six times.

**Scope held.** N1 bounds the accession rule only. The `sec.gov/Archives` URL
rule is untouched, because a web fetch of an SEC archive page is the filing
rather than a page about it, and a test pins that so a later change is visible
rather than silent.

**Three round-3 tests superseded, not weakened.** They used `news` as the "wrong
class" an accession should outrank — precisely the behaviour removed here. They
now use an unrecognised class, which is the rule's real subject, and the denial
half is asserted in the new file. The undashed-accession test also moved off
`news`: it exists to test the regex and should not have depended on the class
rule at all. gate-guard read the change as a rewrite at equal strength.

**U9 — a bug the loop shipped in round 3 and found here.** An unescaped `\s`
sat in a non-raw docstring at `rubric.py:573`, introduced by round 3's own T9
wording fix, emitting a `SyntaxWarning` through two full-suite runs without
anyone reading it. Fixed; warning count 25 → 24. Recorded rather than quietly
repaired, because a warning nobody reads is how a real one gets missed.

**Count reconciled.** 2315 → 2345 is +30: twenty from ten declared-media classes
× two accession fields, one audit case, five rescue cases, four scope pins. The
superseded tests changed fixtures without changing count.
