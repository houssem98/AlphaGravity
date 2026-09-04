# M4 — one canonical evidence class · STAGED PLAN, awaiting approval

**Status: NOT EXECUTED.** M4's deliverable is this plan, and the roadmap requires
it be escalated before any of it runs. A half-done type unification is worse
than none, because it adds one more vocabulary to the pile that caused the
problem.

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
