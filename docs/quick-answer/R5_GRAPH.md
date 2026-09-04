# Round 5 — Execution Graph

Branch `feat/web-research-sec-integration`. Baseline `5c4a1a5`.
Built from `docs/quick-answer/refix-r4.md` (fifth external audit — **input, not
truth**). Every row was re-checked by running it before being written here.

**Status vocabulary.** `VERIFIED` = a command was run and its output read.
`READ` = static only. `UNVERIFIED` = asserted, not yet checked. `BLOCKED` = could
not be checked, with the reason.

**Node prefix is `V`** (round five).

---

## 1. The headline, and the audit did not find it

The fifth audit ranked "unit + scale" second on a list of dimensions the
mutation rig should cover. It is not a gap in the rig. **It is a live P0 in the
grader, and it corrupts `correctness` — the 30-point dimension every other score
is weighted against.**

Measured on `5c4a1a5`:

```
_matches(130e9, "revenue was $130 million")            -> True
_asserts(130e9, "Revenue was $130 million.")           -> True
_asserts(130e9, "Revenue was $130 thousand.")          -> True
_asserts(416161e6, "Net sales were $416,161 thousand.") -> True

score_answer(expect_value=130e9, "NVIDIA revenue was $130 million [1].")
    correctness = 1.0
    evidence    = 1.0
```

**An answer wrong by a factor of one thousand scores perfect on both graded
dimensions.**

The mechanism: `numbers_in` emits the bare reading alongside the scaled one, so
`"$130 million"` yields `{130000000.0, 130.0}`. `_matches` then applies scale
multipliers `(1e3, 1e6, 1e9)` to every reading, so the bare `130.0` becomes
`130e9` and matches. The multiplier loop exists for a real case — `"416,161"`
meaning millions against an expected in base units — but it is applied to
figures that already stated their own magnitude.

**Five audits have graded this system with a benchmark that cannot tell millions
from billions.** Every score in every round-3 and round-4 document was produced
by it.

---

## 2. Defect nodes

| ID | Claim | Status | How established |
|---|---|---|---|
| **V9** | Production already had V1's correct rule, documented, and the grader never got it | **VERIFIED — found by the loop in P1** | `app/core/verification/citation_verdict.py:144` reads: *"The tolerance is deliberately one-sided. A claim that states its unit explicitly and states it WRONG — `$130,497 billion` against a source reading `$130,497 million` — is a real error and must still fail, so the implied-scale allowance applies only to numbers that carry no unit of their own."* That is precisely V1's fix, written in production, before V1 was found. **The system was right and the grader was wrong, on a rule the system had already reasoned through in a comment.** Same shape as R14 and T1 — two layers, one concept, never reconciled — and pointing the same direction as round 3's thesis: the benchmark was weaker than the thing it grades. |
| **V10** | `verification_status` has five values, not two, and two of them are positive statements that the evidence fails | **VERIFIED — sharpens V3** | `citation_verdict.VERDICTS` is `(verified, partially_supported, unsupported, conflicting, not_verifiable)`. V3 was framed by the audit, and by this graph's first draft, as "unverified grades like verified". **The real defect is worse:** the pipeline can conclude `conflicting` or `unsupported` — its own verdict that the citation contradicts or fails to support the claim — and the rubric credits it identically to `verified`. **The system already knows the evidence is bad and the grader does not ask.** |
| **V1** | Scale multipliers are applied to figures that already declared their magnitude | **CLOSED — P1, `2483e7d`, no escalation required** | Ran the four `_matches`/`_asserts` calls above, and a full `score_answer`. A 1000× error scores `correctness 1.0`, `evidence 1.0`. **Found by this loop while verifying the audit's mutation list, not by the audit.** The audit ranked unit/scale as a missing *rig dimension*; it is a live defect in `_matches`, which is upstream of both graded mechanical dimensions. |
| **V11** | V1's closure was incomplete, and P1's own test did not catch it | **VERIFIED — CLOSED in P2, `6714f2a`** | Repairing `_matches` stopped a claimed `130e9` being *multiplied* into an excerpt's `$130 million`. But `_asserted_split` called `numbers_in`, so `"$130 billion"` also asserted a bare `130`, and `"$130 million"` produces a bare `130` too — they matched directly. The 1000× error survived through a second door. **Found by V2's test fixture, not by P1.** Third instance of the same shape: T13, U1, and this. A fix verified by the test that motivated it is verified against the author's own idea of the defect. |
| **V12** | U3's metric span over-extends on a real flattened table | **VERIFIED — CLOSED in P2, `6714f2a`, found by the real fixtures on their first run** | The span stopped at the next *lexicon* metric, and `operating expense` is not in the lexicon, so in `revenue $ 59,070 $ 57,063 $ 53,717 Operating expense 54,356 51,967` the expense row sat inside revenue's span and a claim of `"revenue was $54,356 million"` bound against an expense figure. **The invented fixture hid it by accident of word order** — it put the competing label *before* the claimed metric, where the span began after it. A real United Airlines table puts revenue first. **That test passed for a reason nobody chose.** Fixed with `_ROW_LABEL`, a boundary detector rather than a vocabulary. |
| **V13** | Every rubric test validated the grader against invented prose | **VERIFIED — CLOSED in P2, `6714f2a`** | R14's blind spot one level down: the gate was tested with `{"source_class": "sec_filing"}`, a value the pipeline never emits, and passed for a year. Round 4's rig fixed the citation *shape* by recording it from `citation_provenance.payload()`; the excerpt *text* stayed hand-written. `tests/real_sec_fixtures.py` now carries three verbatim corpus excerpts with real issuer, ticker, date and section, plus real accessions from 10-K filenames on disk. **They found V12 on their first run.** They also corrected an assumption behind V1: real filings declare scale once in a table header and leave the figures bare, so the case V1 must NOT break is the common one. |
| **V2** | A claim binds on a citation the answer did not attach | **CLOSED — P2, `6714f2a`, policy agreed first** | The audit's own finding, and correct. Ran: answer `"NVIDIA revenue was $130 billion [1]."` with the figure absent from citation 1 and present only in citation 2 → `_claim_is_bound` → `True`. The provenance edge `claim ──[1]──> citation[0]` can be wrong while every field on every citation is valid. `_claim_is_bound` searches all excerpts and never reads the bracket index. |
| **V3** | `verification_status` is ignored, so an unverified citation grades as verified | **VERIFIED — LIVE, P1, carried from U11** | Found by round 4's rig and deliberately left open then. The audit independently ranks it 🔴 third. A citation the pipeline itself marked `unverified` earns identical credit. |
| **V4** | The rig does not mutate period, scope, currency, unit/scale, restatement or citation index | **VERIFIED — LIVE, method** | Read the rig: it mutates source class, accession, issuer, cited value, metric attribution, CIK, form, verification status. The audit's ranked list is right, and its first item — the claim→evidence *edge* — is a relationship rather than a field, which is the part worth taking seriously. A rig that only mutates fields cannot see a wrong edge. |
| **V5** | Evidence binding is not atomic claim→evidence verification | **ACCEPTED — ARCHITECTURAL, not one loop** | Correct and already stated as a ceiling in `R4_GRAPH.md`'s U3 row. The audit's target shape — every claim satisfying entity × period × metric × value × unit × scope × source × provenance — is an architecture. **V1, V2 and V3 are three of its dimensions and are individually closable**, which is the honest way to approach it. |
| **V6** | Canonical provenance across all layers | **BLOCKED — measured against in round 3** | `m4-stage0-observed-vocabulary.json` recorded the vocabularies as disjoint in the suite, `skills/scope.py` off the request path, and the disputed spellings emitted by nothing. Reopening needs a **new observation**, not a restatement that duplication exists. The audit restates it. |
| **V7** | Production certification — live DB, browser E2E, independent CI, failure injection | **BLOCKED — not producible by this loop** | Unchanged across five rounds. CI additionally fails on a 1347-error lint debt (T15), not on tests. Recorded, not actionable here. |
| **V8** | The project is optimising its scoreboard rather than the system | **ACCEPTED — METHOD, and the audit agrees with the framing** | Rounds 3 and 4 each changed exactly one non-test, non-doc file, and it was the grader both times. The audit's verdict: the grader work "was not fake progress" because the defects were genuine and the rig demonstrated rather than asserted them — **but R5 should be the last grader-dominant round.** That is accepted. **V1 sharpens it rather than excusing it:** a grader that cannot tell millions from billions was not a scoreboard being polished, it was a broken instrument. |

**Score: 4 live (V1 P0, V2, V3, V4) · 1 architectural (V5) · 2 blocked (V6, V7) · 1 method (V8).**

---

## 3. What this graph does NOT accept

- **That unit/scale is a rig gap.** It is a live P0. Adding a mutation for it
  without fixing `_matches` would produce a rig that reports the defect forever.
- **That V6 justifies reopening M4.** Round 3 measured it. A restatement is not
  a new observation.
- **That 8.3/10 is meaningful while V1 stands.** The score was produced by a
  benchmark that cannot distinguish `$130M` from `$130B`. Every rating in rounds
  3 through 5 rests on it.
- **"World class" remains unavailable.** Fifth audit in a row declining it.

---

## 4. Certification

`NOT CERTIFIED`, and V1 makes the reason worse than any previous round's.

Rounds 1–4 could say the blockers were external or that the grader was merely
permissive. **Round 5 finds the grader was wrong** — not lenient, wrong — on the
dimension carrying the most weight. Until V1 closes, no number this repository
has ever published means what it says, and that includes every count and every
audit score in `R3_*`, `R4_*` and `refix-r4.md`.

The words `world class`, `certified`, `production ready` and `fixed` may not be
written while any row above is LIVE.
