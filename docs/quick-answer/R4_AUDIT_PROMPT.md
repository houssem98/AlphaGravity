# Round 4 audit prompt — paste everything below the line into ChatGPT

---

You have audited the Quick Answer finance path of this repository three times.
Your third audit produced `docs/quick-answer/refix-2.md`, rated the system ~8/10
and said "world-class today: no". Work was done in response. Audit it again.

**Repo:** https://github.com/houssem98/AlphaGravity
**Branch:** `feat/web-research-sec-integration` — **pushed, so every SHA below
resolves.** Round 2 handed you a range that existed only locally and lost a
cycle to it.
**Range to review:** `82a7d3d..2360c8c` (13 commits, 15 files, +2298/−33)
**Scope fence, unchanged:** Quick Answer / `reasoning_depth="fast"` /
single-pass finance path. Ignore the agentic orchestrator and Deep Research.

Start from `docs/quick-answer/R3_GRAPH.md` (what was claimed, and how each row
was established) and `docs/quick-answer/R3_ROADMAP.md` (what was done, with the
failing output of every test pasted in before its fix). Both are claims.
Neither is evidence.

## Read this before anything else

**Round 3 changed exactly one non-test, non-doc file: `eval/head_to_head/rubric.py`.**

That is the grader. Not the system. **No answer this pipeline produces is better
than it was at `82a7d3d`** — the same retrieval, the same generation, the same
gate. What changed is that the benchmark stopped handing out credit the system
itself refuses.

So the first question to put to this round is whether that was worth doing, and
the second is whether I have quietly reframed "we made the measurement stricter"
as progress. Both are fair. I claim a benchmark more permissive than the system
it grades cannot certify it, and that fixing the grader is a precondition for
trusting any future number — but that is a claim, and "we spent a round moving a
measuring stick and shipped no user-visible improvement" is a defensible reading
of the same commits.

## The one thing I most want you to do

**Find the defect that hides inside a closure.**

Round 3's most useful finding was its own error. L1 closed T1 by removing
`local_evidence` from the rubric's primary-class set, wrote a test, watched it
go red then green, and moved on. The test passed. **The defect was still there.**

```python
_is_primary([{"source_class": "LOCAL_EVIDENCE", "accession": "junk"}])  # -> True
```

`_is_primary` reads several fields. The unvalidated accession rule sat directly
below the class check and readmitted exactly what the class check had just
refused. L1's fixture carried no accession, so its test could not see it. It was
caught in L2 by accident, while fixing something else, and is recorded as **T13**.

The generalisable shape: **a fixture narrower than the function under test, plus
red-then-green mistaken for proof that the hole is shut.** Every closure in this
round is a candidate. Go looking for more of them — in `_is_primary`,
`_entity_is_bound`, `_claim_is_bound`, `_asserts`, and in `FinalGate.check`.
Ask of each test: which of the branches this function reads does the fixture
actually exercise, and what happens on the ones it does not?

## Claims to attack

Each is something I assert. Treat each as possibly overstated.

1. **The rubric no longer out-permits the gate (T1, T2).** `local_evidence` is
   out; `structured` is primary only when the row id ends `_xbrl`. **But the
   subset relation M1 demanded still does not hold** — the rubric accepts
   `edgar` and `edgar_text`, which `FinalGate.is_primary_class` has never heard
   of. I claim this is harmless because nothing produces those values. That is
   claim 6; if claim 6 is wrong, this one is too.

2. **An accession is validated (T3).** `\A(?:\d{10}-\d{2}-\d{6}|\d{18})\Z`.
   Two attacks worth making. **Is it too tight** — does any genuine producer in
   this repo emit an accession shape this rejects, which would make the rubric
   blind exactly the way the class list did before? **Is it too loose** — I say
   openly that a well-formed invention still passes, because verifying existence
   needs an EDGAR lookup the rubric will not make. Decide whether "shape, not
   existence" is a real improvement or a rearrangement.

3. **Unknown issuer identity is UNGRADED, not credited (T4).** This was
   escalated and agreed before implementation, because it changes what the
   benchmark counts as correct. **It lowers coverage** — cases whose citations
   carry no issuer identity now contribute nothing to the entity score. Attack
   the direction: is a benchmark that grades less but grades honestly actually
   better, or did I make the denominator smaller and call it integrity? Also
   check the boundaries I drew — presence stays graded, the period half stays
   graded — for cases where they are wrong.

4. **T7 is BLOCKED, not dodged.** I claim a cached entry's answer and its gate
   verdict cannot diverge, because they are written in one `cache.set` and
   `SemanticCache` has no partial update. **The whole block rests on "one
   writer, one reader", established by grep and an AST test.** Break it: is
   there any other writer to that Redis keyspace — another service, a migration,
   an admin path, a test helper that leaks, anything constructing the same key
   format? If one exists, T7 is live and I dismissed it.

5. **There is no fourth publication path (T8).** An AST test counts
   `SearchEvent(type="answer")` and asserts 3, all inside `SearchPipeline.search`.
   Attack the instrument: an event constructed dynamically, built by a helper
   and returned, or a `type` passed as a variable rather than a literal would all
   be invisible to it. Does such a path exist?

6. **M4's refactor is unnecessary, and I have the measurement to prove it.**
   This is the claim I most want attacked. I instrumented all three `is_primary`
   predicates, ran the suite, and concluded the vocabularies never meet —
   `answer_contract` never sees `xbrl`, `scope` never sees `sec_xbrl` — so T12
   and T14 dissolve and stages 1–5 are unnecessary. Raw counts are in
   `m4-stage0-observed-vocabulary.json`.

   **The obvious hole is that these are test-suite counts, not production
   traffic.** I say so in the document, but saying so is not the same as being
   entitled to the conclusion. `news` at 1016 and `sec_filing` at 678 are test
   loops. If the suite systematically fails to exercise a crossing that
   production hits, the measurement is confirming the tests' blind spot and I
   have used it to cancel a refactor. **Decide whether the conclusion survives
   its own caveat.**

7. **`app/core/skills/scope.py` is not on the request path.** Nothing under
   `app/` imports it; its importers are `tests/` and the eval harnesses. I use
   this to argue its `PRIMARY_CLASSES` does not matter. Check for a dynamic
   import, a registry, or a string-keyed dispatch I missed — I checked with grep.

## What NOT to re-litigate

Recorded decisions with stated reasons. Challenge only with new information.

- Numeric verification stays **advisory**. Policy, not a technical gap. Never
  describe it as "numeric correctness closed".
- FinalGate stays **report-only**. Making it refuse is a product decision the
  owner has taken.
- **R7 stays BLOCKED.** Your third audit independently agreed. Widening the
  punctuation list in `_asserts` breaks three protected shapes. Do not retry
  with more regexes.
- The blind head-to-head is unrun because **no reference set exists**. Saying it
  should run is not a finding; it is the missing thing.
- **T4's direction was agreed by the owner**, with the three options on the
  table. Argue it is wrongly *implemented* if you can; do not re-open the choice.

## Known self-reported errors — check I have not under-reported

- **T13**, above: L1's closure of T1 was incomplete and its own test did not
  catch it. Found in L2.
- In M1 I nearly shipped a `continue` that would have stopped a `structured`
  citation with a genuine accession from counting as primary — the
  over-tightening this file has undone six times. Caught before commit, but the
  reasoning that produced it was wrong, not the typing.
- **T15:** `ruff check app/` reports **1347 errors** and `ruff format --check`
  reports **211 files**. Neither is enforced anywhere. It is out of the Quick
  Answer scope fence and I did not fix it; say so if you think that is a dodge.

## The certification question

I have not written `world class`, `certified`, `production ready` or `fixed`
anywhere in round 3, and the documents say `NOT CERTIFIED` still stands. The
stated reasons: no reference set for the blind head-to-head, browser E2E unrun,
and **no count in this repository has been executed by anyone outside the
session that produced it** — CI exists but is disabled, and enabling it would
fail on the lint debt above rather than on tests.

**Is that the honest list, or is it a comfortable one?** If there is a reason
this system is not world-class that none of the four audits has named, that is
the finding I want most.

## Method

- **Re-derive before reading my claims.** If you check only what I say I
  changed, you will miss what I did not think to look at. All three of your
  audits found things nobody asked about.
- **Verify red-before-green from the commits.** Every fix commit pastes its
  test's failing output into the message. Check the pasted output is consistent
  with the test that landed beside it, and that the test would actually have
  produced it.
- **Assume the roadmap is wrong somewhere.** Round 1 falsified five of its own
  assumptions, round 2 falsified two, round 3 falsified two more — M1's
  certification contradicted M1's own guard (T12), and T6's count of four
  vocabularies was five (T11). Expect a fourth round to find its own.

## Output

For each finding: severity, file and function, the concrete input that triggers
it, and what it costs a user. **Separate "this is wrong" from "this is
unproven"** — round 2 conflated them once and it cost a loop. If a claim above
is right, say so in one line and move on. A short list of real findings beats a
long list of maybes, and I am not looking for reassurance.
