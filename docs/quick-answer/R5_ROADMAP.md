# Round 5 — Roadmap and Ledger

Branch `feat/web-research-sec-integration`. Baseline `5c4a1a5`.
Companion to `R5_GRAPH.md` — read that first.

---

## The nine parts

**1. Goal.** Close every `LIVE` row in `R5_GRAPH.md`, or record why it cannot.

Round 5's goal is narrower and harder than round 4's: **the grader must be
correct, not merely strict.** V1 is not permissiveness — it is a wrong answer
from the instrument. Rounds 3 and 4 made the benchmark refuse things it should
refuse; round 5 has to make it stop being wrong.

**2. Context.** `R5_GRAPH.md`, `refix-r4.md` (audit input only), and the round-4
ledger `R4_ROADMAP.md`.

**3. Actions.** One loop per defect:
`INPUT → INSPECT → TEST(red) → FIX → REGRESSION → RE-RUN(green) → GRAPH UPDATE
→ LEDGER ROW`.

**4. Tools.** `services/gravity-api/**`, `apps/gravity-ui/**`,
`docs/quick-answer/**`. Read-only elsewhere. No deploys. No pushes to `main`.
**Do not modify Deep Research or the agentic orchestrator.**

**5. Evals.**

```bash
cd services/gravity-api
.venv/Scripts/python.exe -m pytest tests/ -q --ignore=tests/live --ignore=tests/eval
node ~/.claude/scripts/gate-guard.mjs
```

Baseline: **2394 passed, 0 failed**; gate-guard clean. Runs take 9–16 minutes and
pytest buffers its dots — an empty output file is not a hang.

**6. Memory.** One ledger row per loop attempt. Never rewrite a row — supersede.

**7. Guardrails.**

| Rule | The command that proves it held |
|---|---|
| No test weakened | `node ~/.claude/scripts/gate-guard.mjs` |
| Test count never drops | compare the pytest tail to the previous row |
| New test catches the bug | run against unfixed code, **paste the failing output into the ledger row** |
| `main` untouched | `git rev-parse --abbrev-ref HEAD` |
| Every claimed SHA reachable | `git status -sb` shows no `ahead` before quoting |
| Every delta reconciled | a rise larger than the tests added means duplication; smaller means something stopped running |

**8. Escalation — halt and ask.** Deploys, pushes to `main`, spend, unread files,
anything unverifiable, **any change making the gate refuse an answer**, and:

**V1 is exempt from the measuring-stick escalation.** Rounds 3 and 4 required
agreement before making the rubric stricter, because that moves scores. V1 does
not move the stick — it repairs a stick that reports the wrong number. Fixing a
1000× error needs no permission. **Its regression risk still requires the full
suite**, because `_matches` is upstream of every mechanical dimension.

**V2 and V3 DO move the stick** and need agreement before implementation.

**9. Stop — all three, every loop.**
- **Target:** every `LIVE` row CLOSED or BLOCKED-with-reason, both evals ran.
- **Budget:** 6 loops.
- **Stall:** 3 loops with no verdict change → stop and report.

---

## Loop order

`P1` is first because everything else is measured with the instrument it repairs.

```
P1  scale may not be invented        (V1)   <- P0, fix before measuring anything
      |
P2  a claim binds its own citation   (V2)   <- P1, moves the stick, ESCALATE
P3  unverified evidence is not equal (V3)   <- P1, moves the stick, ESCALATE
      |
P4  rig covers the missing dimensions (V4)  <- must fire against pre-fix code
P5  report V5/V6/V7 honestly          (V5, V6, V7, V8)
```

---

## The loops

### P1 — A figure that states its magnitude keeps it · V1

- **MEASURED:** `_matches(130e9, "revenue was $130 million")` → `True`.
  `score_answer` gives a 1000×-wrong answer `correctness 1.0`, `evidence 1.0`.
- **CAUSE:** `numbers_in` emits the bare reading beside the scaled one, so
  `"$130 million"` yields `{130e6, 130.0}`. `_matches` then applies
  `(1e3, 1e6, 1e9)` to every reading, and `130.0 × 1e9` matches.
- **THE MULTIPLIER LOOP IS NOT THE BUG.** It exists for `"416,161"` meaning
  millions against an expected in base units, and that case must keep working.
  The bug is applying it to a figure that already declared its own magnitude.
- **FIX:** carry an `explicit` flag with each reading. A figure that stated a
  magnitude word matches only at its stated magnitude; a bare figure may still
  be scaled.
- **GUARD:** `"Net sales were $416,161 million"` against `416161e6` must still
  bind, and so must bare `"416,161"` against the same expected.
- **NO ESCALATION.** This repairs a wrong instrument rather than moving it.

### P2 — A claim binds the citation it names · V2

- **MEASURED:** answer `"NVIDIA revenue was $130 billion [1]."`, figure absent
  from citation 1 and present in citation 2 → binds.
- `_claim_is_bound` searches every excerpt and never reads the bracket index.
  The provenance edge can be wrong while every field is valid.
- **FIX:** parse the citation markers in each sentence and, when a sentence
  names them, bind that sentence only against the citations it names.
- **FAIL OPEN, as always here:** a sentence carrying no marker keeps searching
  everything. An out-of-range marker keeps searching everything. Six of seven
  historical grader bugs came from over-tightening.
- **ESCALATE:** this makes the rubric stricter and moves scores down.

### P3 — Unverified evidence is not equal to verified · V3

- Round 4 found it and left it open on purpose; the fifth audit ranks it 🔴.
- **The decision is the deliverable.** Options: ignore it (today); refuse
  primary credit to `unverified`; or leave the dimension ungraded when status is
  absent, matching T4's discipline.
- **ESCALATE with a recommendation.** Note the pipeline may not set the field on
  every path — measure the population before choosing, or this repeats T4's
  mistake of scoring an unanswerable question.

### P4 — The rig covers the dimensions that matter · V4

- Add mutations the fifth audit ranks, **led by the one that is an edge rather
  than a field**: claim → citation index. Then unit/scale, period, segment vs
  consolidated scope, currency, restated/superseded state.
- **Each new mutation must fire against pre-fix code**, as round 4's did. A
  mutation that passes on both sides is measuring nothing.
- V1, V2 and V3 must each be reachable by a rig mutation once fixed, so the
  rig — not an auditor — is what catches their regression.

### P5 — Report the rest honestly · V5, V6, V7, V8

- **V5** stays a stated ceiling. V1–V3 close three of its dimensions; say that
  and no more.
- **V6** stays BLOCKED on round 3's measurement. A restatement is not a new
  observation.
- **V7** stays BLOCKED. CI fails on a 1347-error lint debt, not on tests.
- **V8:** record that the fifth audit and this roadmap agree — **R5 is the last
  grader-dominant round.** R6 must be system-level or the trajectory is the
  finding. Note that V1 does not excuse the trajectory; it sharpens it, because
  the instrument was not merely permissive, it was wrong.

---

## Ledger

| # | Loop | Defect | Started | Verdict | Backend count | gate-guard | Commit | Red-before-fix evidence |
|---|---|---|---|---|---|---|---|---|
| 0 | — | — | 2026-09-04 | BASELINE | 2394 passed / 0 failed | clean | `5c4a1a5` | n/a — established, asserts nothing |
| 1 | P1 | V1 | 2026-09-04 | **CLOSED** · V9, V10 opened | 2409 passed / 0 failed (790.87s) | clean | `2483e7d` | `8 failed, 7 passed in 1.59s` on unfixed code — `test_a_smaller_stated_magnitude_does_not_match_a_larger_expected[$130 million, $130 thousand, $130 k, $130m]`, `test_a_larger_stated_magnitude_does_not_match_a_smaller_expected[$130 billion, $130 trillion]`, `test_the_audits_exact_thousandfold_case`, `test_a_thousandfold_wrong_answer_no_longer_scores_correct`. |

### P1 notes

**What closed.** A figure that declares its magnitude keeps it. `"$130 million"`
matches at `130e6` and at its bare `130`, and is never multiplied further. A bare
`"416,161"` still scales, because a number carrying no unit has no magnitude to
contradict — that is reading it rather than inventing it.

**Nothing regressed.** `_matches` is upstream of `correctness`, `evidence` and
every claim bind, and 2409 tests pass with the only delta being the fifteen
added here. That is worth stating: no existing test depended on the scale
invention, which means the defect was never load-bearing — only wrong.

**No escalation, and the distinction matters.** Rounds 3 and 4 escalated every
change that made the rubric stricter, because those move scores. V1 does not
move where the instrument points; it stops it reporting a number that was
false. A grader that cannot separate millions from billions is not a strict
grader or a lenient one — it is a broken one, and repairing it needs no
permission.

**V9 — the system already had the answer.** `citation_verdict.py:144` documents
exactly this rule and explains it, in production, before V1 was found: the
implied-scale allowance applies only to numbers carrying no unit of their own,
because an explicitly-wrong unit "is a real error and must still fail". **The
grader never got it.** Same shape as R14 and T1, and pointing the same way as
round 3's thesis — the benchmark weaker than the system it grades. The fix
aligns the two; it did not invent a rule.

**V10 — V3 is worse than the audit framed it.** `citation_verdict.VERDICTS` is
five values, not two: `verified`, `partially_supported`, `unsupported`,
`conflicting`, `not_verifiable`. The audit and this roadmap's first draft both
said "unverified grades like verified". The real defect is that the pipeline can
return `conflicting` — its own conclusion that the citation contradicts the
claim — and the rubric credits it exactly as if it read `verified`. **The system
already knows, and the grader never asks.**

**Count reconciled.** 2394 → 2409 is +15, the whole of the new file.

| # | Loop | Defect | Started | Verdict | Backend count | gate-guard | Commit | Red-before-fix evidence |
|---|---|---|---|---|---|---|---|---|
| 2 | P2 | V2 | 2026-09-04 | **CLOSED** · V11, V12, V13 opened and closed | 2443 passed / 0 failed (567.93s) | clean | `6714f2a` | `3 failed, 9 passed in 1.55s` — `test_the_audits_exact_case`, `test_each_sentence_carries_its_own_markers`, `test_scale_invention_stays_fixed_under_the_cited_excerpt` (the last being V11). Then, once real fixtures landed, `1 failed, 21 passed in 1.90s` — `test_a_figure_belonging_to_another_metric_does_not_bind` (V12). |

### P2 notes

**What closed.** A sentence binds against the citations it names. Fails open
three ways, all asserted: no marker, an out-of-range marker, and a marker naming
an excerpt too short to use all search everything. The strict reading would
rescore answers on formatting rather than correctness.

**V11 — P1 had not fully closed V1.** Repairing `_matches` stopped the
*multiplication* path, but `_asserted_split` called `numbers_in`, so a claim of
`"$130 billion"` still carried a bare `130` that `"$130 million"` also produces.
They matched directly and the 1000× error survived. A claim that stated its
magnitude now asserts that magnitude only — keeping the bare reading is right
when *reading a source*, whose expected value may be recorded in millions, and
wrong when stating what an answer *claimed*.

**Found by V2's fixture, not by P1's.** That is the third instance: T13, U1, and
now this. **A fix verified by the test that motivated it is verified against the
author's own idea of the defect.** The pattern is consistent enough that it
should be treated as a rule rather than a recurring surprise.

**V13 — real SEC fixtures, and they earned their keep immediately.** Every rubric
test before this validated the grader against prose the person fixing the bug had
written. `tests/real_sec_fixtures.py` carries three verbatim excerpts from this
repository's own corpus — United Airlines results, Live Nation deferred revenue
*in thousands*, FedEx capex — with real issuer, ticker, date and section, plus
real accessions from 10-K filenames on disk. No network call: the data was
already here.

**V12 — the real fixtures found a defect on their first run.** U3's span stopped
at the next lexicon metric, and `operating expense` is not in the lexicon, so in
`revenue $ 59,070 $ 57,063 $ 53,717 Operating expense 54,356 51,967` the expense
row fell inside revenue's span. **The invented fixture had hidden it by accident
of word order** — competing label before the claimed metric, so the span began
after it. A real table puts revenue first. That test had been passing for a
reason nobody chose.

`_ROW_LABEL` bounds a span at financial line-item nouns as well as lexicon
metrics. **A boundary detector, not a vocabulary** — it names no metric, maps to
no key, classifies nothing — which is what keeps it from being R14's mistake
again.

**Real filings corrected an assumption behind V1.** Scale is declared once in a
table header — `(in millions) 2025 2024 Operating revenue $ 59,070` — and the
figures are bare. Every V1 test used `"$130 million"`, a unit welded to its
number. So the case V1 must **not** break is the common one and the case it does
break is rarer. V1 drew the line correctly, and there is now evidence for that
rather than an assumption.

**Count reconciled.** 2409 → 2443 is +34: twelve from V2's tests, twenty-two
from the real-filing tests.
