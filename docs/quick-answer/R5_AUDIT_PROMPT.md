# Round 5 audit prompt — paste everything below the line into ChatGPT

---

You have audited the Quick Answer finance path of this repository four times.
Your fourth audit produced `docs/quick-answer/refix-r3.md`, scored it 8.2/10 and
said "not yet world-class". All three of its P1s were closed. Audit it again.

**Repo:** https://github.com/houssem98/AlphaGravity
**Branch:** `feat/web-research-sec-integration` — pushed, so every SHA resolves.
**Range to review:** `ad75be6..cd1a83a` (9 commits, 10 files, +1870/−15)
**Scope fence, unchanged:** Quick Answer / `reasoning_depth="fast"` /
single-pass finance path. Ignore the agentic orchestrator and Deep Research.

Start from `docs/quick-answer/R4_GRAPH.md` (what was claimed, and how each row
was established by running it) and `docs/quick-answer/R4_ROADMAP.md` (what was
done, with the failing output of every test pasted in before its fix). Both are
claims. Neither is evidence.

## Read this first, because it is the thing I am most exposed on

**Round 4 changed exactly one non-test, non-doc file: `eval/head_to_head/rubric.py`.**
**So did round 3.**

Two consecutive rounds have changed only the grader. **No answer this pipeline
produces is better than it was at `82a7d3d`, five weeks and twenty-two commits
ago.** Same retrieval, same generation, same gate. What improved is that the
benchmark stopped crediting evidence the system itself refuses.

I have a defence and you should test it: a benchmark more permissive than the
system it grades cannot certify anything, so fixing the grader is a precondition
for trusting any future number. All three of your P1s were evaluator defects,
and `FinalGate.check` — which reads `source_class` alone — had none of them.

But "we spent two rounds making the measurement honest and shipped no
user-visible improvement" is a fair reading of the same commits, and **if the
real finding is that this project is optimising its own scoreboard, say so
plainly.** That would be the most valuable thing this audit could produce.

## The one thing I most want you to do

**Extend the rig, do not hunt by hand.**

Round 4 built `tests/test_provenance_mutation_rig.py` on your recommendation. It
takes a real citation — `citation_provenance.payload()`'s actual output, not an
invented shape — breaks exactly one provenance dimension, and asserts the
grader's verdict moves.

Run against the pre-fix rubric it fails on exactly U1, U2 and U3. **It found all
three of your P1s unaided.** It also found one you did not report: the rubric
never reads `verification_status`, so a citation the pipeline itself flagged
UNVERIFIED grades identically to a verified one (**U11**, left open on purpose).

So the highest-value thing you can tell me is not another hand-found bug. It is:

**Which provenance dimension should that rig mutate that it does not?**

It currently mutates source class, accession, issuer, cited value, metric
attribution, CIK, form and verification status. Name what is missing — period,
segment/consolidated scope, unit and scale, currency, filing date, document
section, restated figures, the citation-index mapping — and say what a mutation
of it should do to which verdict. A dimension nobody has thought to break is
exactly where the next defect is, and that is the class that has survived five
audits.

## Claims to attack

1. **U1 — an accession may no longer overrule a declared non-filing.** I added
   `_DENIES_FILING_PROVENANCE = {web_evidence, local_evidence, web, news, blog,
   analyst, earnings_call, transcript}` and skip the accession rule for those.
   Attack the set: is it missing a class that should be in it, or containing one
   that should not? **And note what I deliberately did NOT change:** the
   `sec.gov/Archives` URL rule still fires for `WEB_EVIDENCE`, on the reasoning
   that a web fetch of an SEC archive page IS the filing. If that is wrong, it
   is the same hole one door further along.

2. **U2 — the entity bind now uses word boundaries.** `apple` no longer matches
   `PINEAPPLE HOLDINGS`. Attack it for false NEGATIVES, which is the expensive
   direction here: a real issuer string this now fails to bind. Non-ASCII names,
   hyphenation, `Inc.` vs `Incorporated`, abbreviations, or a ticker token
   against a name-only citation.

3. **U3 — the highest-risk change in the round, and the one I most want broken.**
   A claim no longer binds when the excerpt names the claim's metric and
   associates only different values with it. The metric owns text from its own
   mention to the next metric mention. **That association is proximity-based and
   therefore fragile.** Construct a CORRECT answer that this now scores as
   unbound. Six of seven historical grader bugs in that file came from
   over-tightening, and I have just added a rule to it.

4. **The grader now imports production's metric vocabulary.** `rubric.py` does
   `from app.core.finance.query_plan import _METRIC_RES`. It imports nothing
   else from `app`, and that independence was deliberate — a grader coupled to
   the thing it grades can be tuned by changing the thing. I judged a metric
   lexicon the exception, because R14, T1 and T2 were each a second vocabulary
   invented beside the first and left to drift. **Decide whether I traded a
   drift risk for a tuning risk**, and note it is a private symbol crossing a
   package boundary.

5. **U11 was found and deliberately left open.** The rubric ignores
   `verification_status`. I asserted the current behaviour and named it as the
   next dimension rather than fixing it inside a loop scoped to something else.
   **Is that discipline or a dodge?** Argue it either way, but decide.

6. **The rig itself might be theatre.** It passed the moment it was written,
   which is worthless, so I reverted the rubric to baseline, watched five
   mutations fail, and restored. Check that the proof is real: does the rig
   assert anything that would not also be caught by the individual tests beside
   it, and are its negative controls (`cik`, `form` must change nothing)
   actually meaningful or just decoration?

## What NOT to re-litigate

Recorded decisions with stated reasons. Challenge only with new information.

- Numeric verification stays **advisory**. Policy, not a technical gap.
- FinalGate stays **report-only** — an audit gate, not a safety barrier. Do not
  describe it as one, and do not propose making it refuse.
- **R7 stays BLOCKED.** Two audits agreed. Widening the punctuation list in
  `_asserts` breaks three protected shapes.
- The blind head-to-head is unrun because **no reference set exists**.
- **Unknown identity is UNGRADED** (T4) and **U3's narrow scope** were both
  owner-agreed before implementation. Argue the implementations; do not reopen
  the choices.
- **M4 stages 1–5 are not recommended.** Round 3 measured the vocabularies as
  disjoint in `m4-stage0-observed-vocabulary.json`. Reopening needs a new
  observation, not a restatement that duplication exists.

## Known self-reported errors — check I have not under-reported

- **U9:** round 3 shipped a `SyntaxWarning` in its own wording fix — an
  unescaped `\s` in a non-raw docstring — which survived two full-suite runs
  because nobody reads the warning summary.
- **U10:** the U2 fix silently changed empty-token behaviour from "binds
  everything" to "binds nothing". Caught, pinned, and recorded as a decision
  rather than left as an accident. `None` may in fact be more correct than
  `False` there.
- **T13, from round 3 and still the governing lesson:** a closure whose test
  passed while the defect stayed live, because the fixture exercised one field
  of a multi-field function.
- **CI is still disabled** because `ruff check app/` reports 1347 errors and
  `ruff format --check` reports 211 files, neither ever enforced. Out of the
  Quick Answer scope fence and not fixed. Say so if you think that is a dodge.

## The certification question

Four audits have declined "world-class". `NOT CERTIFIED` still stands, and round
4 made the reason sharper rather than softer: no reference set, browser E2E
unrun, no count independently executed, and a grader that still credits evidence
the pipeline marked unverified.

**Given two rounds of grader-only work, what would actually have to change in
the SYSTEM — not the benchmark — for this to be world-class?** Name it
concretely enough to be a roadmap. That is the question I cannot answer from
inside.

## Method

- **Re-derive before reading my claims.** All four of your audits found things
  nobody asked about.
- **Verify red-before-green from the commits.** Every fix commit pastes its
  test's failing output. Check it is consistent with the test that landed beside
  it, and that the test would actually have produced it.
- **Assume the roadmap is wrong somewhere.** Round 1 falsified five of its own
  assumptions, round 2 two, round 3 two, round 4 one (its own certification
  contradicted its own guard). Expect a fifth round to find its own.

## Output

For each finding: severity, file and function, the concrete input that triggers
it, and what it costs a user. **Separate "this is wrong" from "this is
unproven."** If a claim above is right, say so in one line and move on. A short
list of real findings beats a long list of maybes, and I am not looking for
reassurance.
