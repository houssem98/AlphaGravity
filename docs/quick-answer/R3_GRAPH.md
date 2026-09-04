# Round 3 — Execution Graph

Branch `feat/web-research-sec-integration`. Baseline `82a7d3d`.
Built from `docs/quick-answer/refix-2.md` (third external audit — **input, not
truth**). Every row below was re-checked against the code on 2026-09-04 before
being written here. Line numbers are hints; re-grep.

**Status vocabulary.** `VERIFIED` = a command was run and its output read.
`READ` = static inspection only. `UNVERIFIED` = the auditor asserts it and this
graph has not yet checked it. `BLOCKED` = could not be checked, with the reason.
Nothing is `PASS` on inference.

**Node prefix is `T`** (third round) so nothing collides with round 2's `R1`–`R14`.

**The lesson that governs this file.** Round 1 falsified five of its own
governing assumptions. Round 2 falsified two more of its roadmap's claims and
found two defects neither audit had (R5, R14). This graph therefore records
*how* each row was established, and an `UNVERIFIED` row may not be actioned
until a command has run.

---

## 1. What the third audit got right

The headline is correct and round 2 missed it — including one instance round 2
*noticed in passing and did not act on*.

The evaluator's source semantics are weaker than production's. Measured:

```
_is_primary([{'source_class':'LOCAL_EVIDENCE'}])                        -> True
_is_primary([{'source_class':'structured'}])                            -> True
_is_primary([{'source_class':'WEB_EVIDENCE','accession':'invented'}])   -> True
_is_primary([{'source_class':'news','accession_number':'x'}])           -> True
_is_primary([{'source_class':'WEB_EVIDENCE'}])                          -> False
```

Round 2 fixed `FinalGate` so that `LOCAL_EVIDENCE` and `WEB_EVIDENCE` are **not**
primary, then left the rubric asserting the opposite. The benchmark that grades
the system is more permissive than the system. That is the same producer/
consumer vocabulary failure as R14, pointing the other way.

**Round 2 saw this and did not act.** The L8 working notes record noticing that
`_PRIMARY_CLASS_NAMES` already contained `sec_evidence` — the R14 lesson learned
locally in the rubric — and flagged that the rubric's list looked "more
permissive" than the gate's, then moved on because it was outside L8's scope.
Noticing is not closing. That is the round-3 lesson.

---

## 2. Defect nodes

| ID | Claim | Status | How established |
|---|---|---|---|
| **T1** | Rubric counts `local_evidence` as a primary filing | **CLOSED — L1, `4ce49b0`** | Ran `_is_primary([{'source_class':'LOCAL_EVIDENCE'}])` → `True`. Contradicts `FinalGate`, where round 2 deliberately excluded it. A corpus prose chunk is not a filed figure. **Fixed:** dropped from `_PRIMARY_CLASS_NAMES`. Red before fix pasted in the L1 ledger row. |
| **T2** | Rubric counts `structured` as a primary filing | **CLOSED — L1, `4ce49b0`** | Ran it → `True`. The auditor says `structured ≠ primary`. **Partly wrong:** `structured_search` reads `financials`, where `%_xbrl`-suffixed ids ARE exact XBRL facts and everything else is backfill (`flt["id"] = "like.*_xbrl"` exists for this reason). So `structured` is primary *iff the row is an `_xbrl` row* — not never. **Fixed in that shape, not the audit's:** `structured` keys on the `_xbrl` id suffix. Both directions are pinned — an `_xbrl` row still scores primary, a `_backfill` row no longer does. |
| **T3** | Any truthy accession makes a citation primary | **CLOSED — L2, `79660a6`** | `_is_primary([{'source_class':'WEB_EVIDENCE','accession':'invented'}])` → `True`; `news` + `accession_number` also `True`. **The rule is deliberate**, documented as "a citation carrying a *real* accession came from a filing whatever anyone labelled it". Nothing checks "real". Intent/implementation gap, so the fix is to validate the accession, not to delete the rule. **Fixed:** `_ACCESSION_RE` accepts the dashed 10-2-6 form and the bare 18-digit form, both of which this repo produces. Validates SHAPE, not existence — a well-formed invention still passes, and the code says so. |
| **T4** | An absent issuer identity still earns the entity mark | **VERIFIED — LIVE, P1, policy** | `_entity_is_bound` returns `None`, and `score_answer` only penalises on `False`, so `None` keeps the presence credit. Correct as a *helper* contract ("could not check"); wrong as a *scoring* outcome. Unknown identity should leave the dimension UNGRADED, not credited. |
| **T5** | `_ISSUER_FIELDS` omits `cik`, and round 2's own test docstring says it does not | **VERIFIED — LIVE, DOC FALSE** | Code is `("issuer","ticker","company","document_title")`. `test_entity_attachment.py` says the bind "reads issuer, **cik**, ticker and document_title together". Measured: `_entity_is_bound('apple', [{'cik':1045810}])` → `None`. **Found by the loop, not the audit** — and it is round 2's own error. Note the code is arguably RIGHT to omit `cik` (an int never substring-matches a name token); the DOCSTRING is the false artefact. |
| **T6** | Four independent source-class vocabularies remain | **VERIFIED — ARCHITECTURAL RISK, not a live defect** | `answer_contract.SourceClass`, `research/evidence.py`, API `Citation.source_class`, `SourcePassage.evidence_kind`. The auditor labels this UNPROVEN as a bug and that is right: today's SEC case is handled. It is the *generator* of T1–T3 and R14, so it is recorded as a risk with a named fix, not as a defect to close by patching. |
| **T7** | A cache hit trusts a stored verdict with no binding to the answer it graded | **UNVERIFIED — needs a mutation path** | The auditor concedes this is not a live defect without one. The stored invariant is "we recorded passed: true", not "this exact answer/citations/contract tuple passed". **Do not action until a mutation path is demonstrated** — inventing one to justify the work is the failure this loop exists to avoid. |
| **T8** | "All publication paths" rests on a source scan | **PARTIALLY REBUTTED** | Wrong as stated: all three known paths have *behavioural* async tests — generated answer and no-evidence exit in `test_gate_runs_before_publication.py`, cache hit in `test_cache_gate_enforcement.py` and `test_cache_refuses_an_unverdicted_entry.py`. The auditor's own text concedes the behavioural test is "the valuable part". What is genuinely unproven is narrower: **that no FOURTH path exists.** Recorded in that narrower form. |
| **T9** | "Claim-level grounding" overstates a per-sentence implementation | **VERIFIED — WORDING** | Correct. `_claim_is_bound` splits on `.!?`/newline, so a three-proposition sentence is one claim object. The R6 fix is real; the terminology is stronger than the model. |
| **T10** | 2270 passed is repository-reported, not independently executed | **ACCEPTED — METHOD** | Fair, and the same shape as R13. The auditor cannot run the suite, and GitHub reports no status checks for `1e0b3dd`. A count nobody outside the session can reproduce is a claim, not evidence. |
| **T11** | A FIFTH source-class vocabulary exists that T6 did not count | **VERIFIED — RISK, found by the loop in L1** | `app/core/skills/scope.py:192` defines its own `PRIMARY_CLASSES = frozenset({"sec_filing", "edgar_text", "edgar", "xbrl"})`. T6 enumerates four vocabularies and this is not among them, so M4's staged plan is scoped one call site short before it starts. Note `xbrl` — a sixth spelling of `sec_xbrl`. Recorded as a node rather than actioned, per the round-3 lesson. |
| **T13** | L1's closure of T1 was incomplete, and L1's own test did not catch it | **VERIFIED — FOUND AND CLOSED IN L2, `79660a6`** | After `4ce49b0` dropped `local_evidence` from `_PRIMARY_CLASS_NAMES`, `_is_primary([{'source_class':'LOCAL_EVIDENCE','accession':'junk'}])` was still `True` — the unvalidated accession rule sat directly below the class check and readmitted everything the class check had just refused. L1's test passed because its fixture carried no accession. **The lesson is about test design, not about T1:** a fixture that exercises one field cannot close a defect in a function that reads several, and "the new test goes red then green" does not prove the hole is shut. Round 2's L2 note — a test whose red depends on a fixture should assert the fixture still bites — generalises to this. |
| **T12** | M1's own CERTIFICATION is unsatisfiable as written | **VERIFIED — ROADMAP FALSIFIED, found by the loop in L1** | M1 requires the rubric's primary set be "a subset of, or equal to, what `FinalGate.is_primary_class` accepts". The gate accepts only `sec_filing`, `sec_xbrl` and the alias `SEC_EVIDENCE`. M1's own GUARD, three lines earlier, requires `edgar` and `edgar_text` keep scoring primary — and T11 shows `scope.py` independently calls them primary. The two clauses contradict: satisfying the subset means blinding the rubric to real EDGAR sources. **Not satisfied.** L1 implemented the safe half — every class the gate credits must still score primary, asserted against `answer_contract`'s own sets so widening the gate cannot leave the rubric behind. Closing the gap needs the gate widened or `edgar` dropped, and that is an M4 decision, not an M1 one. |

**Score: 2 live (T4, T5) · 4 closed (T1, T2, T3, T13) · 2 architectural risk (T6, T11) · 1 unverified (T7) · 1 partially rebutted (T8) · 1 wording (T9) · 1 method (T10) · 1 roadmap defect (T12).**

**T5 was found by the loop, not the audit — the third round running to find one of these.
T11, T12 and T13 were also found by the loop, and none is in any audit. T13 is the
loop finding a hole in its own previous iteration's closure, which is the first
time in three rounds that has happened inside the round rather than in the next
audit.**

---

## 3. What this graph does NOT accept

Recorded so the loop does not over-correct in the direction the auditor pushed.

- **`structured` is not uniformly non-primary.** T2's fix must key on the
  `_xbrl` id suffix, which the retrieval layer already uses for exactly this
  distinction. Excluding `structured` wholesale would make the rubric blind to
  the most authoritative rows in the table.
- **The accession rule should be validated, not deleted.** Its intent — an
  accession is stronger evidence than a label — is sound and deliberate. T3 is a
  gap between that intent and an unvalidated `if c.get("accession")`.
- **T4 is a policy change, and its direction is not obvious.** Making unknown
  identity ungraded is defensible; so is the current abstention. What is NOT
  defensible is the present state, where the helper says "cannot check" and the
  scorer hears "passed". Whichever way it goes, the two must agree.
- **T7 is not actionable yet.** No mutation path, no defect. Round 2's operating
  note stands: do not invent a hypothesis to keep a loop alive.
- **"World class" remains unavailable.** The auditor rates the system ~8/10 and
  explicitly says "world-class today: no". That is the third audit in a row
  declining the label.

---

## 4. Certification

`NOT CERTIFIED` stands, and for the same reason as round 2 rather than a new
one: the blind head-to-head is unrun because **no reference set exists**, and
browser E2E for SEC links is unrun. Neither is producible by this loop.

T10 adds a second, sharper reason: the suite count that backs every "closed"
claim in round 2 has never been executed by anyone outside the session that
produced it. Until it is, `2270 passed` is a well-evidenced claim, not an
independently verified fact.

The words `world class`, `certified`, `production ready` and `fixed` may not be
written while any row above is LIVE.
