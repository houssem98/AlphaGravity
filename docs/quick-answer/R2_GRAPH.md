# Round 2 — Execution Graph

Branch `feat/web-research-sec-integration`. Baseline `6003631`.
Built from `docs/quick-answer/refix.md` (second external audit — **input, not
truth**). Every row below was re-checked against the code on 2026-09-03 before
being written here. Line numbers are hints; re-grep.

**Status vocabulary.** `VERIFIED` = a command was run and its output read.
`READ` = static inspection only. `UNVERIFIED` = the auditor asserts it and this
graph has not yet checked it. `BLOCKED` = could not be checked, with the reason.
Nothing is `PASS` on inference.

**The round-1 lesson that governs this file:** five round-1 assumptions were
falsified by checking rather than inheriting — three dependency edges, an
over-broad truncation constraint, and "the graph faithfully captures the
audit". This graph therefore records *how* each row was established, and an
`UNVERIFIED` row may not be actioned until a command has run.

---

## 1. What the second audit got right

The headline is correct and round 1 missed it.

```
  line 2030   yield SearchEvent(type="answer", ...)      <-- answer leaves here
     ...
  line 2085   _gate_result = FinalGate.check(...)        <-- gate runs here
     ...
  line 2131   await self.cache.set(...)
```

`FinalGate.check` runs **55 lines after the answer has already been yielded to
the consumer.** Round 1 verified that the gate *is invoked* and stopped there.
It never asked whether the gate runs *before publication*, which is the property
that actually matters. The audit's framing is exact: this moved the defect from
"gate absent" to "gate post-publication", and the second is still a defect.

---

## 2. Defect nodes

| ID | Claim | Status | How established |
|---|---|---|---|
| **R1** | FinalGate runs AFTER the answer is yielded | **CLOSED — L1, 2026-09-03** | Was: answer yield 2030, gate 2085, cache 2131. Gate now runs above the yield and its verdict rides on the answer event. Red-before-green recorded in the L1 ledger row (`order: ['answer', 'gate']`). |
| **R2** | A planning failure produces an ungated answer | **CLOSED — L4, 2026-09-03** | Permitted by decision, and now LABELLED: distinct `no_contract` / `gate_error` reasons replace a bare `null` that read like a silent pass. The fallback-contract option was rejected on measurement — `contract_directives(None) == ''`, so a fallback would grade the model on rules it never received. |
| **R3** | Legacy cache entries with no verdict are served | **CLOSED — L3, 2026-09-03** | Reversed the round-1 call on NEW information: L2 closed the write path, so the unverdicted population is finite. `gate_verdict_failed` now returns True unless a stored verdict says PASSED. A refused entry recomputes, so no answer is withheld. |
| **R4** | The cache writes on `gate_ran`, not `gate_passed` | **CLOSED — L2, 2026-09-03** | Was: `_gated = _gate_result is not None`, so a FAILED verdict was written then refused on read. Now `... and passed`; the read-path refusal is kept, not moved. Blocked on R14 until R14 closed. |
| **R5** | The no-evidence exit yields an answer with no gate | **CLOSED — L1, 2026-09-03** | Was: answer yield at 1257 (`no_evidence_exit`) reached before the contract was ever checked. **Not found by either audit — found while checking R1.** Now gated report-only; decision and the escalation it surfaced recorded in §3b. |
| **R6** | Claim-binding is any-claim/any-excerpt, not per-claim | **CLOSED — L5, 2026-09-03** | The `any` moved from whole-answer scope to per-claim scope; every documented leniency kept. Derived rates are excused when the levels beside them bind, so a correct computed answer is not punished. |
| **R7** | `_asserts` uses punctuation as a proxy for proposition structure | **BLOCKED — needs sentence parsing (L6, 2026-09-03)** | Real and measured: 5 of 7 probed shapes score a wrong headline as asserting the truth. But widening the punctuation list is measurably WRONG — it breaks 3 shapes this file protects, including the two-period case whose regression it 'already paid for once'. Telling a demoted truth from a legitimate second clause needs clause-level period attribution. Constraint suite left in `tests/test_asserts_proposition_scope.py`. |
| **R8** | Period attachment does not fire when no period is named | **CLOSED — L7, 2026-09-03** | **The stated case is FALSIFIED**: "Apple revenue was $416,161 million." already scores 0.0, because `present` requires the token at all. The real hole is one step in — a token attached to a DIFFERENT figure lent to a yearless sentence scored 1.0. Fixed narrowly; a figureless preamble still scopes the answer. |
| **R9** | Entity attachment is unimplemented | **CLOSED — L8, 2026-09-03** | Not blocked: citations DO carry issuer identity — measured `issuer='NVIDIA CORP'`, `cik=1045810`, `document_title` set, **`ticker` EMPTY**. So the bind reads all four fields; a ticker-only rule would have called a real SEC citation unidentified. Returns None when no identity is present at all. |
| **R10** | "No DB" should not block the STATIC half of duplicate-fact selection | **CLOSED — L9, 2026-09-03** | The challenge was right. `period.desc` ordered but did not SELECT — `period` is not unique, so ties went to the query planner. Now `period.desc,id.asc`, verified offline by capturing the PostgREST filter. *Which* label wins still needs production rows and stays escalated. |
| **R11** | Numeric grounding should not be described as "closed" | **VERIFIED — WORDING** | It is a recorded policy decision, not a technical fix. The ledger says so; any wording that reads as "numeric correctness closed" is wrong. |
| **R12** | Benchmark `supports` may be optional metadata | **VERIFIED — REBUTTED** | `test_every_filed_expectation_resolves_to_exactly_one_record` requires exactly one backing record per filed case AND a matching value. Measured: 11 filed cases, 11 records, 0 unbacked. The auditor's provisional CLOSED is upgraded, not downgraded. |
| **R14** | The gate rejects every citation the pipeline actually produces | **CLOSED — L2, 2026-09-03** | **Found while writing L2's guard; in neither audit.** `FinalGate` accepted `{sec_filing, sec_xbrl}`; `citation_provenance.payload()` stamps `SEC_EVIDENCE`. Measured: a verified 10-K citation failed `primary_source`. Reconciled at the gate boundary. |
| **R13** | "Red before green" cannot be established from the diff | **ACCEPTED — METHOD** | Correct. The claim is true but its evidence lives in this session's transcript, not in the commits. Round 2 must leave artefacts in-repo. |

**Score at intake: 10 live · 1 fair challenge · 1 rebutted · 1 method.**
**Final: 0 live · 10 closed · 1 BLOCKED-with-reason (R7) · 1 rebutted (R12) · 2 method/wording (R11, R13).**
**R14 was not in the intake count — it was found by the loop, like R5.**
**Two roadmap claims were falsified by checking: R8's stated test case (already scored 0.0) and R10's blanket block (determinism is checkable offline).**

---

## 3. What this graph does NOT accept

Recorded so the loop does not over-correct in the direction the auditor pushed.

- **"Move the gate before the yield" ≠ "make the gate blocking."** They are
  separate changes. Reordering preserves the existing report-only contract,
  which is pinned by `test_the_gate_never_rewrites_the_answer` and is
  deliberate: *a gate that edits an answer to satisfy itself is grading its own
  work.* Making the gate **refuse** is a product decision of the same class as
  D7, which the owner already decided (advisory). **R1's fix is the reorder.
  Any refusal policy is an ESCALATION, not a loop action.**
- **The reorder is mechanically safe, and this was checked, not assumed.**
  `parsed_answer` is final at 1903, `citations_out` at 2017, `scope_status`
  comes from `query_plan`; none is reassigned between 2030 and 2085. So the
  gate can move above the yield without restructuring.
- **R5 is not in either audit.** It is included because it was verified, and
  excluded from any claim that "the audit found everything".

---

## 3b. The R5 decision, recorded

L1 required a decision on whether a refusal needs a contract check at all, and
this is it.

**Decided: gate it, report-only.** The no-evidence exit now runs the gate before
its yield and carries `contract_gate` on the answer event. Three reasons:

1. An early `return` is still a publication. "No answer event without a verdict
   above it" is one rule with no exceptions, and a rule with no exceptions is
   the only kind that survives the next edit to this function.
2. The contract is bound at line 872, far above the exit at 1218. Nothing made
   the check impossible; nobody had asked for it.
3. The verdict is substantive rather than ceremonial. Measured on the fixture
   query, the refusal returns:

   ```
   passed: false
   violations: ["contract requires at least 1 citation(s); the answer carries 0",
                "contract requires a primary filing; no citation is sec_filing
                 or sec_xbrl (saw none)"]
   checked: ["min_citations", "primary_source"]
   ```

   A reader can now tell a refusal that was checked from one that was not.

   *Measured before R14 closed.* The `primary_source` wording has since changed
   to name `SEC_EVIDENCE` as well, and on this path the clause still fails
   because the refusal carries no citations at all. The verdict's substance is
   unchanged; only the message text moved.

**What this surfaced, and did NOT decide.** The exit builds an ordinary contract,
so its refusal is graded as a *failed answer* rather than as an *abstention* —
`must_abstain` is never set on this path even though "we found no evidence" is
exactly the condition that clause describes. Setting it would make these
refusals pass cleanly instead of logging two violations apiece.

That is a contract-policy change, not an ordering fix, and it is the same class
of decision as D7. **Recorded as an open question for the owner; not taken by
the loop.** The loop's fix leaves the emitted refusal text byte-identical.

---

## 4. Certification

Not met. `NOT CERTIFIED` stands, and closing every row does not change that.

Ten rows are closed and R7 is BLOCKED with a stated reason, so the loop's Target
condition is satisfied. Certification is a different claim and remains blocked
on a human: **the blind head-to-head is unrun because no reference set exists**,
and **browser E2E for the SEC links is unrun**. Neither can be produced by this
loop. The words `world class`, `certified`, `production ready` and `fixed` stay
unavailable until those exist — a defect list reaching zero is evidence about
the defect list, not about the product. Closing the
P0 changes the ordering defect, not the certification status — the two were never
the same claim. The words `world class`, `certified`, `production ready` and
`fixed` may not be written while any row above is LIVE.
