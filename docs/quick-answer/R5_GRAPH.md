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
| **V1** | Scale multipliers are applied to figures that already declared their magnitude | **VERIFIED — LIVE, P0** | Ran the four `_matches`/`_asserts` calls above, and a full `score_answer`. A 1000× error scores `correctness 1.0`, `evidence 1.0`. **Found by this loop while verifying the audit's mutation list, not by the audit.** The audit ranked unit/scale as a missing *rig dimension*; it is a live defect in `_matches`, which is upstream of both graded mechanical dimensions. |
| **V2** | A claim binds on a citation the answer did not attach | **VERIFIED — LIVE, P1** | The audit's own finding, and correct. Ran: answer `"NVIDIA revenue was $130 billion [1]."` with the figure absent from citation 1 and present only in citation 2 → `_claim_is_bound` → `True`. The provenance edge `claim ──[1]──> citation[0]` can be wrong while every field on every citation is valid. `_claim_is_bound` searches all excerpts and never reads the bracket index. |
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
