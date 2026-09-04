# Round 4 — Execution Graph

Branch `feat/web-research-sec-integration`. Baseline `ad75be6`.
Built from `docs/quick-answer/refix-r3.md` (fourth external audit — **input, not
truth**). Every row was re-checked against the code on 2026-09-04, by running it,
before being written here. Line numbers are hints; re-grep.

**Status vocabulary.** `VERIFIED` = a command was run and its output read.
`READ` = static inspection only. `UNVERIFIED` = the auditor asserts it and this
graph has not checked it. `BLOCKED` = could not be checked, with the reason.
Nothing is `PASS` on inference.

**Node prefix is `U`** (round four) so nothing collides with `R1`–`R14` or
`T1`–`T15`.

---

## 1. The headline, and it is not what the audit led with

**All three P1 findings are in the evaluator. None is a production defect.**

`FinalGate.check` decides primary-source compliance with exactly one expression:

```python
classes = {str(c.get("source_class", "")) for c in cites}
if not any(is_primary_class(s) for s in classes):
```

`is_primary_class` takes a string. It cannot see an accession, an issuer, or a
claim. So the accession override, the substring entity bind and the lexical
claim bind are all confined to `eval/head_to_head/rubric.py`.

**That makes round 4 the same finding as round 3, one door along.** Round 3's
thesis was that the benchmark was more permissive than the system it grades.
L1 closed the class-name door (`local_evidence`, bare `structured`). **The
accession door was narrowed and left open**, and the audit walked through it.

Measured, on the code as shipped at `ad75be6`:

```
_is_primary([{'source_class':'WEB_EVIDENCE',  'accession':'0000320193-25-000079'}]) -> True
_is_primary([{'source_class':'LOCAL_EVIDENCE','accession':'0000320193-25-000079'}]) -> True
_is_primary([{'source_class':'news',          'accession':'0000320193-25-000079'}]) -> True
_is_primary([{'source_class':'',              'accession':'0000320193-25-000079'}]) -> True
```

The fourth line is the rule working as intended. The first three are the defect,
and the difference between them is the whole fix.

---

## 2. Defect nodes

| ID | Claim | Status | How established |
|---|---|---|---|
| **U1** | A shape-valid accession confers primary status even on a class that positively denies filing provenance | **CLOSED — N1, `0947849`, policy agreed first** | Ran the four lines above. **The audit's framing is right but its remedy is too broad.** It treats the accession rule as unverifiable provenance needing a canonical provenance object. The narrower truth: the rule exists to rescue a citation whose class is *absent or unknown*, and `''` → `True` is that rescue working. `WEB_EVIDENCE` and `LOCAL_EVIDENCE` are not sloppy labels — they are positive assertions that this is a web page or a corpus chunk, which **contradict** filing provenance. Rescue the unknown; do not overrule the denial. |
| **U2** | `_entity_is_bound` does substring containment, not entity identity | **CLOSED — N2, `8a71979`, policy agreed first** | Ran it: `_entity_is_bound('apple', [{'issuer':'PINEAPPLE HOLDINGS'}])` → `True`. Also `'cat'` vs `CATERPILLAR INC` → `True`, `'am'` vs `AMAZON COM INC` → `True`. The audit is correct. **Note the constraint it does not mention:** the leniency exists because a real citation was measured with `ticker=''`, so no single field can be trusted. A fix must keep multi-field leniency and kill the substring, which word-boundary matching does and canonical entity resolution is not required for. |
| **U3** | `_claim_is_bound` proves a number is present, not that the citation supports the proposition | **CLOSED for contradiction — N3, `8b5e623`, policy agreed first. The general case remains a known ceiling.** | Ran the audit's own example: answer `"NVIDIA revenue was $130 billion."` against excerpt `"NVIDIA's operating expenses were $130 billion while revenue was $120 billion."` → `True`. The citation **contradicts** the answer and the bind succeeds. The audit's statement of the world-class bar (proposition × metric × entity × period × value × source × verified provenance) is correct and is not one loop's work. |
| **U4** | The three P1s are evaluator-only; production is stricter | **VERIFIED — FRAMING, found by this graph** | Read `FinalGate.check`. Its primary test reads `source_class` alone. **The rubric is more permissive than the gate on exactly the axis round 3 was about.** T1/T2 closed one door; U1 is the other. Recorded because it changes what round 4 is: not new territory, but the unfinished half of round 3. |
| **U5** | The audit credits round 3 with the behavioural gate-ordering test | **PARTIALLY REBUTTED** | It writes "There is now an actual async behavioral test recording gate/answer ordering", presented as new. `test_gate_runs_before_publication.py` is **round 2's**, not round 3's. The observation is true and the attribution is wrong. Recorded so round 4 does not claim credit that a later audit would take back. |
| **U6** | The score moved 8.0 → 8.2 for a round that changed only the grader | **ACCEPTED — METHOD, with a caveat the audit does not state** | Round 3 changed one non-test file, `rubric.py`. No answer improved. The audit's stated reason — "failure modes are becoming narrower and harder to find" — is a reasonable basis for re-scoring *confidence*, but it is not evidence the *system* improved. **A rising score for an unchanged system is a measurement artefact and should be read as such.** |
| **U7** | The next high-value move is adversarial provenance-mutation fixtures, not another refactor | **ACCEPTED — METHOD, and it is the best thing in this audit** | Build fixtures from real production citation objects, mutate one provenance dimension at a time (source class, accession, CIK, issuer, ticker, period, metric, value, URL), and prove the grader rejects each mutation. This is a **detector for the T13 class**, which is the defect shape that has now survived four audits. It would have found U1, U2 and U3 without an auditor. |
| **U8** | Multiple independent definitions of "primary evidence" persist; the alias fixed R14's symptom, not its cause | **ACCEPTED — ARCHITECTURAL, but see M4 stage 0** | Correct as stated. **Already measured in round 3 and the audit did not read that result:** `m4-stage0-observed-vocabulary.json` shows the vocabularies do not meet in the suite, `skills/scope.py` is not on the request path, and the values the sets disagree about are emitted by nothing. The duplication is real; the *defect* it is claimed to generate remains unobserved. Do not reopen the refactor on this row alone. |

**Score: 3 live (U1–U3, all evaluator) · 0 live production defects · 1 framing (U4) · 1 partial rebuttal (U5) · 2 method (U6, U7) · 1 architectural (U8).**

---

## 3. What this graph does NOT accept

- **U1's remedy as the audit states it.** "Primary provenance should come from a
  canonical trusted provenance object" is the right long-run architecture and
  the wrong next commit. The immediate defect is that a positive non-filing
  class is overruled by an accession. That is a three-line fix with a clear
  test, and it does not require the object.
- **That U2 needs canonical entity resolution.** It needs word boundaries. Entity
  resolution is a larger, separate argument and dragging it in would block a
  cheap correctness win behind an architecture project.
- **That the 8.2 score means the system improved.** See U6. Nothing shipped to
  production in round 3.
- **That U8 justifies reopening M4.** Round 3 measured this and recorded the
  measurement's limit. A new refactor needs a new observation, not a restatement.
- **"World class" remains unavailable.** The fourth audit in a row declines it.

---

## 4. Certification

`NOT CERTIFIED` stands, now for a reason sharper than round 3's.

Rounds 1–3 could say the blockers were external: no reference set, no browser
E2E, no independent CI run. **Round 4 names an internal one.** The evaluator
that would certify the system credits evidence it has not verified — a
fabricated-but-well-formed accession, a substring entity match, and a number
that appears in a citation that contradicts it. A grader with those three holes
cannot certify anything, and the score it produces is an upper bound rather than
a measurement.

The words `world class`, `certified`, `production ready` and `fixed` may not be
written while any row above is LIVE.
