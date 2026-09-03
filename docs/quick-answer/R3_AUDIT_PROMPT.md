# Round 3 audit prompt — paste everything below the line into ChatGPT

---

You have audited the Quick Answer finance path of this repository twice. Your
second audit produced `docs/quick-answer/refix.md`. Work was done in response.
Audit it again.

**Repo:** https://github.com/houssem98/AlphaGravity
**Branch:** `feat/web-research-sec-integration`
**Range to review:** `6003631..1e0b3dd` (13 commits, 22 files, +3660/-65)
**Scope fence, unchanged:** Quick Answer / `reasoning_depth="fast"` / single-pass
finance path only. Ignore the agentic orchestrator and Deep Research.

Start from `docs/quick-answer/R2_GRAPH.md` (what was claimed) and
`docs/quick-answer/R2_ROADMAP.md` (what was done, with the failing output of
every test pasted in before its fix). Both are claims. Neither is evidence.

## The one thing I most want you to do

**Find the class of defect that survives audits.**

Round 2 closed a defect neither of your audits found, and its shape is the
useful part. `FinalGate` decided "is this citation a primary filing?" by
comparing `source_class` against `{"sec_filing", "sec_xbrl"}`. The pipeline
stamps `"SEC_EVIDENCE"`. Two vocabularies for one concept, never reconciled —
so **every SEC-cited answer had been failing its primary-source clause**, and
`answer_contract_violated` had been firing on essentially every finance answer
while carrying no signal at all.

It survived two audits and a full test suite because the gate's own unit tests
supply the literal string the gate expects:

```python
SEC = [{"source_class": "sec_filing"}]     # a value the pipeline never produces
```

**The gate was tested against a vocabulary that does not exist upstream of it.**
The rubric had already hit the identical mismatch and fixed it locally, and
nobody propagated it.

So: go hunting for more of that class. Wherever a test constructs an input by
hand, ask whether the real producer of that input actually emits that shape.
Candidates worth checking are `source_class`, `verification_status`,
`answer_state`, `scope_status`, citation field names, and anything in
`app/core/research/evidence.py` versus `app/core/finance/answer_contract.py`.
A green test proves the code matches the test's imagination of the data.

## Claims to attack

Every item below is something I assert. Treat each as possibly overstated.

1. **The gate now runs before publication.** `FinalGate.check` used to run 55
   lines after `yield SearchEvent(type="answer")`. I claim it now runs above
   every answer yield, that `contract_gate` rides on the answer event, and that
   all three publication sites are covered — the cache hit, the no-evidence
   refusal, and the generated answer. Check whether a fourth path can publish an
   answer. Check whether the cache-hit path, which consults a *stored* verdict
   rather than recomputing, is actually safe.

2. **The cache stores only a verdict that passed, and refuses entries with no
   verdict.** This REVERSES a round-1 decision. The justification is that L2
   closed the write path so the unverdicted population is finite. Verify that
   `search_pipeline` really does hold the only `cache.set` in the service — the
   entire reversal rests on it, and I checked it with one grep.

3. **The rubric binds evidence per claim, not per answer.** Six of seven
   historical grader bugs in that file came from over-tightening. I claim the
   only behaviour change is the scope of an `any`, and that derived rates are
   excused when their levels bind. **Try to construct a correct answer that this
   now scores as unbound.** That is the failure mode with history.

4. **Entity binding reads issuer/ticker/company/document_title together.**
   I claim citations carry issuer identity, measured as `issuer='NVIDIA CORP'`,
   `cik=1045810`, `ticker=''`. Check whether real production citations look like
   the fixture. If `issuer` is empty in production the way `ticker` was in the
   fixture, this check silently returns None and grades nothing.

5. **Fact ordering is deterministic.** `period.desc` became
   `period.desc,id.asc`. I claim `id` is unique in `financials`. If it is not,
   the ordering is still not total. Note `app/api/routes/company.py` uses
   `period.desc,filing_date.desc`, which I flagged and did not fix.

6. **R7 is BLOCKED, not dodged.** `_asserts` treats only parentheses as asides,
   so a wrong headline with the truth after an em-dash, a semicolon, or in an
   appositive scores as asserting the truth. I claim widening the punctuation
   list is measurably wrong because it breaks three shapes the file protects.
   **If you can produce a rule that fixes R7 without breaking those three, the
   block is wrong and I want to know.**

## What NOT to re-litigate

These are recorded decisions with stated reasons. Challenge them only with new
information, not by re-arguing the same facts:

- Numeric verification stays **advisory**. It is a policy decision, not a
  technical gap, and describing it as "numeric correctness closed" is wrong.
- FinalGate stays **report-only**. Making it refuse an answer is a product
  decision the owner has taken. Reordering it was in scope; blocking is not.
- The blind head-to-head is unrun because **no reference set exists**. Saying it
  should be run is not a finding; it is the thing that is missing.

## Method

- **Re-derive before reading my claims.** If you only check what I say I
  changed, you will miss what I did not think to look at. Both your audits found
  things nobody asked about. Do that again.
- **Verify red-before-green from the commits, not from my word.** Every fix
  commit pastes the failing output of its test into the message. Your last audit
  correctly said this was unverifiable from a diff. Check whether the pasted
  output is consistent with the test that landed beside it.
- **Assume the roadmap is wrong somewhere.** Round 1 falsified five of its own
  governing assumptions. Round 2 falsified two more: R8's stated test case
  already scored 0.0 before any fix, and R10's blanket "needs a live DB" block
  was too wide. A third round should expect to find its own.

## Known self-reported errors — check I have not under-reported

- L8's implementation landed in commit `4c1dc02` under an L7-only message,
  because `git add` on a whole file staged edits from two loops.
- One test fixture went green for the wrong reason after an earlier fix landed;
  a premise assertion inside the test caught it.
- A one-line ordering change broke three test files; a targeted run found one,
  the full suite found the other two.

## Output

For each finding: severity, the file and function, the concrete input that
triggers it, and what it costs a user. Separate **"this is wrong"** from
**"this is unproven"** — the second round conflated them once and it cost a
loop. If a claim above is right, say so briefly and move on; I am not looking
for reassurance, and a short list of real findings beats a long list of
maybes.
