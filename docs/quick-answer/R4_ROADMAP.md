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

| # | Loop | Defect | Started | Verdict | Backend count | gate-guard | Commit | Red-before-fix evidence |
|---|---|---|---|---|---|---|---|---|
| 2 | N2 | U2 | 2026-09-04 | **CLOSED** · U10 opened and pinned | 2368 passed / 0 failed (591.69s) | clean | `8a71979` | `8 failed, 13 passed in 1.01s` on unfixed code — `test_a_token_embedded_inside_another_word_does_not_bind` for `apple`/`PINEAPPLE HOLDINGS`, `cat`/`CATERPILLAR INC`, `am`/`AMAZON COM INC`, `intel`/`INTELSAT SA`, `visa`/`VISANT CORP`, `target`/`TARGETED MEDICAL PHARMA INC`, `oracle`/`CORACLE BIOSCIENCES`, plus `test_the_audits_exact_case`. |

### N2 notes

**What closed.** The bind now asks whether an identity NAMES the token rather
than contains it. Intel/Intelsat and Visa/Visant are real collisions, and the
dimension whose job is catching a wrong-company answer was matching one company
inside another company's name.

**Lookarounds, not `\b`.** `\b` requires a word character on the far side, and
`\bat&t\b` fails against `AT&T INC` because the character after the final `t` is
a space. `(?<!\w)…(?!\w)` does not care. The token is `re.escape`d: `AT&T`, `3M`
and `J.P. Morgan` are company names, and an unescaped token would raise or match
wrongly. Both are asserted.

**Word boundaries, not entity resolution.** The audit argued for canonical
CIK-keyed identity. Right architecture, wrong next commit — it would have kept a
P1 open behind a registry project.

**The leniency survives and is pinned.** ANY identity field may carry the name
and ANY citation may be the one that does, because a real citation was measured
with `issuer='NVIDIA CORP'`, `ticker=''`. `AAPL` via ticker, `Apple 10-K FY2025`
via document_title, the multi-word `old dominion`, and a possessive all still
bind. **Those 13 guards passed before the fix as well as after** — a test
asserting only the new refusal would let a later loop tighten this into
uselessness and stay green.

**U10 — a side effect, surfaced rather than smuggled.** Under containment an
empty token sat inside every string, so a case carrying a blank
`expect_entity_tokens` silently earned the mark against any citation. Under the
lookaround it binds nothing. The change is an improvement, but `False` is not
obviously right either — `None` (ungraded, T4's discipline) is arguably better,
since a blank token means the *case* is malformed rather than the citation being
wrong. Left as `False` deliberately, because it is louder than the silent credit
it replaces, and pinned by a test so it is a decision on record. Changing it
further is a scoring decision and belongs to its own loop, not to a side effect
of this one.

**Count reconciled.** 2345 → 2368 is +23, the whole of the new file: seven
collisions, one audit case, six leniency cases, one possessive, three
regex-metacharacter cases, and one each for any-citation, no-identity,
wrong-issuer, plus two empty-token pins.

| # | Loop | Defect | Started | Verdict | Backend count | gate-guard | Commit | Red-before-fix evidence |
|---|---|---|---|---|---|---|---|---|
| 3 | N3 | U3 | 2026-09-04 | **CLOSED for contradiction** · general case remains a stated ceiling | 2380 passed / 0 failed (578.04s) | clean | `8b5e623` | `1 failed, 11 passed in 0.73s` on unfixed code — `test_the_audits_exact_case`: `assert True is False`, `_claim_is_bound('NVIDIA revenue was $130 billion.', [{'text': "NVIDIA's operating expenses were $130 billion while revenue was $120 billion in the period."}])`. |

### N3 notes

**What closed, stated precisely.** A citation that states a *different value for
the metric the answer named* no longer binds the claim. That is the audit's
demonstrated defect and it is shut. **What did not close** is the general
proposition-binding bar the audit describes — metric × entity × period × value ×
verified source. That remains a ceiling, and the graph row says so.

**The rule refuses to guess which metric owns each number.** It asks what the
excerpt says about the metric the *answer* named. A metric owns text from its own
mention to the next metric mention, so revenue's span in the audit's excerpt
yields `$120 billion` and the `$130 billion` is simply not revenue's. **This works
even though `operating expenses` is not in the vocabulary at all** — the rule
never needs to attribute the 130, only to read what the excerpt says about
revenue. That is what makes it robust rather than clever.

**Three fail-open paths, pinned.** No metric in the answer; no metric in the
excerpt; a metric named with no figure beside it (`"its highest revenue ever"`).
Under-firing is the deliberate direction in a function carrying six historical
over-tightening bugs. The refusal is also per-excerpt, so a correct citation
elsewhere still binds.

**The two cases a naive rule would have broken, both asserted:** an excerpt
carrying two periods of the same metric still binds, and a segment figure beside
the total still binds. A rule reading "some revenue figure differs, therefore
refuse" would have failed correct answers against ordinary filing prose.

**One red, and that is the honest count.** The second contradiction test already
returned `False` before the fix, because `130` is absent from that excerpt — it
tests absence, not contradiction. The defect requires both numbers present, and
exactly one test reproduces it.

**A coupling decision, made explicitly.** `_METRIC_RES` is imported from
production rather than restated. This module otherwise imports nothing from
`app`, and that independence is deliberate — but R14, T1 and T2 were each a
second vocabulary invented beside the first and left to drift, and twenty-five
restated metric patterns would be that mistake with a new name. **This is the
opposite call from `_ACCESSION_RE`, which is deliberately redeclared**, and the
distinction is written into the code: an accession format is a per-purpose rule,
a metric lexicon is a shared vocabulary both sides must read identically.

**Count reconciled.** 2368 → 2380 is +12, the whole of the new file. All 141
pre-existing claim-binding tests pass unchanged, including the six
over-tightening guards.
