# M4 — one canonical evidence class · STAGE 0 RUN, STAGES 1–5 NOT RECOMMENDED

**Stage 0 was approved and executed. It falsified the premise for the rest.**
Findings are at the top; the original plan follows unchanged below, so the
reasoning that led here stays readable.

---

## Stage 0 result — the vocabularies do not meet

Instrumented all three `is_primary` predicates, ran the full suite (2315 passed,
unchanged — the probe was inert), recorded every value each predicate was asked
about, then reverted the instrumentation. Raw counts:
`m4-stage0-observed-vocabulary.json`.

| Predicate | Observed | Never observed |
|---|---|---|
| `answer_contract.is_primary_class` | `SEC_EVIDENCE` 76 · `sec_filing` 9 · `sec_xbrl` 1 · `LOCAL_EVIDENCE`/`WEB_EVIDENCE`/`news`/`analyst`/`earnings_call`/`''`/`SOMETHING_NEW` | **`edgar`, `edgar_text`, `xbrl`** |
| `scope.PRIMARY_CLASSES` | `news` 1016 · `sec_filing` 678 · `edgar` 1 · `edgar_text` 1 · `xbrl` 1 · `blog`/`analyst`/`transcript`/`web`/`''` | **`sec_xbrl`, `SEC_EVIDENCE`** |
| `rubric._is_primary` | `sec_filing` 136 · `SEC_EVIDENCE` 42 · `web` 14 · `WEB_EVIDENCE` 11 · `news` 10 · `structured` 6 · `sec_xbrl` 4 · `LOCAL_EVIDENCE` 3 · `edgar`/`edgar_text`/`local_evidence`/`sec_evidence`/`unknown` 2 each | — |

**The `xbrl` vs `sec_xbrl` bug does not occur.** It was the concrete defect
justifying stages 2–5. The two spellings live in disjoint populations: predicate
1 never sees `xbrl`, predicate 2 never sees `sec_xbrl`. Nothing crosses, so
nothing is silently downgraded.

**`edgar`, `edgar_text` and `xbrl` are produced by nothing.** They appear
exactly once each, against `news` at 1016 and `sec_filing` at 678. Traced: no
production code assigns a `source_class` of `edgar`, `edgar_text` or `xbrl`
anywhere, and the single hits come from `test_skill_scope.py:76`, a
parametrisation that restates `PRIMARY_CLASSES` back at itself.

**`scope.py` is not on the production request path.** Nothing under `app/`
imports `app.core.skills.scope`. Its importers are `tests/` and the eval
harnesses `eval/finance_quick_answer/run_eval.py` and `perf.py`. So the third
`is_primary` predicate — the one T11 found and T6 missed — never executes when
the system answers a question. (Stated precisely: *not on the request path*, not
"dead code". It is exercised, just never in production.)

### What this does to T12

**T12 dissolves rather than being fixed.** M1's certification asked the rubric's
primary set to be a subset of the gate's, and it fails only on `edgar` and
`edgar_text` — spellings nothing produces, checked by a predicate that never runs
in production. The subset relation was measuring a disagreement between two dead
entries. Recorded as resolved-by-measurement, not by code.

### Revised recommendation

**Do not run stages 1–5.** There is no observed defect to justify a
cross-layer type unification, and the roadmap's own instruction covers this
case: if stage 0 shows the vocabularies never meet, M4 shrinks to documentation
and should be re-scoped. It does, so it does.

What is worth doing instead, in rough order of value, each small enough to be
its own change:

1. **Delete `edgar`, `edgar_text`, `xbrl` from `scope.PRIMARY_CLASSES`**, or
   prove something produces them. A frozenset whose only exerciser is a test
   restating it is a vocabulary with no speakers.
2. **Decide what `app/core/skills/scope.py` is for.** It is a well-built module
   answering a real question that the pipeline never asks. Either wire it in or
   mark it eval-only, but do not leave a third primary-source predicate looking
   live.
3. **Rename `answer_contract._PRIMARY_CLASSES`.** It holds QUESTION classes
   (`EXACT_FINANCIAL_FACT`, …), not source classes, and shares its name with
   `scope.PRIMARY_CLASSES`, which holds source classes. Two different things,
   one name, one file apart.

### The honest limit of this measurement

**These are the counts the TEST SUITE produced, not production traffic.** They
show what 2315 tests exercise. A crossing that no test covers would not appear
here, and the `news` 1016 / `sec_filing` 678 volumes are test loops, not user
queries. The claim is "no crossing observed under the suite", which is weaker
than "no crossing exists" and is the only claim the method supports.

Stage 0 was still worth running: it cost one instrumented suite run and replaced
a plausible assumption with a measurement that points the other way.

---

## The original plan, as escalated

**Status of stages 1–5: NOT EXECUTED and no longer recommended.** Retained
because the reasoning below is what stage 0 was designed to test.

## What is actually there

T6 names four vocabularies. **There are six**, and T11 found the fifth during
L1. Counted against the code on 2026-09-04:

| # | Where | Shape | What it calls primary |
|---|---|---|---|
| 1 | `app/core/finance/answer_contract.py` | `SourceClass` enum + `PRIMARY` + `PRIMARY_ALIASES` + `is_primary_class()` | `sec_filing`, `sec_xbrl`, `SEC_EVIDENCE` |
| 2 | `app/core/research/evidence.py` | module constants, `.kind` | `SEC_EVIDENCE` / `LOCAL_EVIDENCE` / `WEB_EVIDENCE` |
| 3 | `app/api/schemas/search.py:136` | `evidence_kind: str` wire field | documents #2's vocabulary |
| 4 | API `Citation.source_class` | wire field | free-form string |
| 5 | `app/core/skills/scope.py:192` | `PRIMARY_CLASSES` frozenset | `sec_filing`, `edgar_text`, `edgar`, **`xbrl`** |
| 6 | `eval/head_to_head/rubric.py` | `_PRIMARY_CLASS_NAMES` + conditional `structured` | `sec_filing`, `sec_xbrl`, `edgar`, `edgar_text`, `sec_evidence`, `structured` iff `_xbrl` |

**Three predicates answer "is this primary" and no two agree.** That is not a
tidiness problem — it is T1, T2, T3 and R14 all being instances of one
generator, and it will keep firing.

Two concrete disagreements worth naming before any refactor:

- **`xbrl` vs `sec_xbrl`.** Vocabulary 5 spells it `xbrl`; vocabulary 1 spells
  it `sec_xbrl`. If a value ever crosses between them it is silently
  non-primary. **This is an unproven bug and must be measured, not assumed** —
  see stage 0.
- **`edgar` / `edgar_text`.** Vocabularies 5 and 6 call them primary;
  vocabulary 1 does not know them. This is exactly T12: M1's certification asked
  the rubric to be a subset of the gate, which cannot hold while these are
  legitimately primary and the gate has never heard of them.

## The target

**One enum**, `app/core/finance/evidence_class.py::EvidenceClass`, new file so no
existing importer changes meaning mid-flight.

**One predicate**, `EvidenceClass.is_primary(value: str) -> bool`, accepting any
spelling in the table above and normalising. Every layer calls it. Nobody keeps
a private frozenset.

**The rubric calls it too.** The benchmark being able to disagree with the system
is what round 3 was about; importing the same predicate makes T12 true by
construction rather than by a test that restates two lists.

## Staging — each stage independently green

**Stage 0 · measure, change nothing.** Instrument the three predicates to log
every value each is asked about, run the suite and the evals, and dump the
observed vocabulary. **This decides whether `xbrl` vs `sec_xbrl` is live or
theoretical**, and whether any spelling exists that no table above lists. No
production behaviour changes. If stage 0 shows the vocabularies never actually
meet, M4 shrinks to documentation and should be re-scoped rather than executed.

**Stage 1 · add the canonical enum, unused.** New module, full test coverage of
the normalisation table, zero call sites. Reversible by deletion.

**Stage 2 · route `answer_contract.is_primary_class` through it.** Its behaviour
must not change: the existing gate tests are the guard, and any diff in what the
gate accepts is a stop-and-escalate, because widening the gate changes what gets
published.

**Stage 3 · route `scope.py::PRIMARY_CLASSES` through it.** Here behaviour
*will* change if stage 0 showed `xbrl`/`sec_xbrl` diverging. That is a real
behaviour change on a live path and needs its own escalation with the measured
before/after.

**Stage 4 · route the rubric through it.** Closes T12 by construction. Expect the
rubric's accepted set to change; every change must be justified against stage 0's
measurements, not against tidiness.

**Stage 5 · delete the private frozensets.** Only after 2–4 are green
independently.

## Why this is not one loop

Stages 2, 3 and 4 each touch a different layer's notion of what counts as
evidence, and stage 3 can change what the system publishes. Round 3's budget is
eight loops and seven are spent. **Attempting M4 in the remainder would produce
exactly the half-done unification the roadmap warns against.**

## The decision being escalated

1. Run **stage 0 only** (measurement, no behaviour change), and let its findings
   re-scope the rest — *recommended*. It is cheap, it is reversible, and it
   answers whether the `xbrl`/`sec_xbrl` split is a real bug or a theoretical
   one before anyone refactors on the assumption that it is.
2. Approve stages 0–5 as a round-4 workstream with its own budget.
3. Decline, and record M4 as `BLOCKED — larger than the remaining budget`, with
   T6, T11 and T12 carried forward.

**Not recommended: starting at stage 1 or later.** Every stage after 0 is a
change justified by a belief about which spellings actually meet in production,
and that belief is currently untested.
