# Round 6 audit prompt — paste everything below the line into ChatGPT

---

You have audited the Quick Answer finance path of this repository five times.
Your fifth audit (`docs/quick-answer/refix-r4.md`) scored it **8.3/10, NOT
CERTIFIED**, named five things needed for 9+, and said one thing that turned out
to matter more than the score: *"R5 should be the last grader-dominant round."*

R5 is done. Audit it, and answer the question at the end.

**Repo:** https://github.com/houssem98/AlphaGravity
**Branch:** `feat/web-research-sec-integration` — pushed, every SHA resolves.
**Range to review:** `5c4a1a5..d029f59` (7 commits, 12 files, +1931/−21)
**Scope fence, unchanged:** Quick Answer / `reasoning_depth="fast"` /
single-pass finance path.

Start from `docs/quick-answer/R5_GRAPH.md` and `R5_ROADMAP.md`. Both are claims.
Neither is evidence.

## Read this first — your score was produced by a broken instrument

**Your #2 ranked mutation was not a missing rig dimension. It was a live P0.**

`_matches` could not distinguish `$130 million` from `$130 billion`. Measured on
the code you scored:

```
_asserts(130e9, "Revenue was $130 million.")  -> True

score_answer(expect_value=130e9, "NVIDIA revenue was $130 million [1].")
    correctness = 1.0
    evidence    = 1.0
```

An answer wrong by a factor of one thousand scored perfect on both graded
mechanical dimensions. `_matches` sits upstream of `correctness` — thirty of the
hundred points, and the denominator every other score is renormalised against.

**Every number this project has ever published came out of that instrument**,
including your 8.0, your 8.2 and your 8.3. So the first thing this audit should
do is decide whether those scores meant anything, and what the score is now that
the instrument reports the right number.

Worse, and this is the part I want you to weigh: **production already had the
correct rule.** `citation_verdict.py:144` says the implied-scale allowance
applies only to numbers carrying no unit of their own, *because an
explicitly-wrong unit "is a real error and must still fail"* — written before
anyone found V1. The system was right. The grader never got it. That is R14's
shape for the third time.

## The one thing I most want you to do

**Decide whether the grader is now trustworthy, and say what would prove it.**

This is not rhetorical. In five rounds the grader has been:

- **wrong** — V1, unable to tell millions from billions
- **incompletely fixed** — V11: the V1 fix repaired the multiplication path and
  missed the bare-reading path, so the 1000× error survived through a second
  door until the *next* loop's fixture caught it
- **validated against invented prose** — V13: every rubric test until R5 used
  sentences written by whoever was fixing the bug, which is exactly how R14
  survived for a year

Round 5 fixed all three. But "we fixed the three we found" is the argument that
has been made after every round, and it has been wrong every time.

**So: what is the actual evidence that this grader is now correct?** If the
answer is "the tests pass", say why that is insufficient given the above. If
there is a stronger form of evidence available — differential testing against
`citation_verdict`, property-based generation over figures and units,
cross-checking the grader against the pipeline's own verdicts — name it. That is
worth more than another finding.

## Claims to attack

1. **V1 — scale is no longer invented.** A figure that states its magnitude
   keeps it; a bare figure may still be scaled. **Attack the second half:** real
   filings declare scale in a table header and leave figures bare
   (`"(in millions) 2025 2024 Operating revenue $ 59,070"`), so the multiplier
   loop still runs on essentially every real table figure. Can you construct a
   real-shaped excerpt where that scales a number into a wrong match?

2. **V2 — a claim binds only the citations it names.** `[1]` now resolves.
   **Fails open three ways** — no marker, out-of-range marker, marker naming an
   excerpt under 20 characters. Attack the fail-open: can an answer dodge the
   check by omitting markers, and is that materially different from before?

3. **V12 — `_ROW_LABEL` bounds a metric's span at line-item nouns.** I argue it
   is a boundary detector rather than a sixth vocabulary, because it names no
   metric and maps to no key. **Decide whether that distinction is real or
   self-serving**, and whether the noun list is complete enough to matter on
   filings other than the three fixtures.

4. **V13 — real SEC fixtures.** Three verbatim corpus excerpts with real
   metadata. **Three is not many.** Name the filing shape most likely to break
   the grader that these three do not cover — non-USD, negative parentheses,
   restated figures, per-share amounts, footnote references inside numbers.

5. **The grader now imports from production twice** — `_METRIC_RES` (R4) and,
   by argument, the rule in `citation_verdict`. `rubric.py` was deliberately
   independent of `app/`. Decide whether the coupling has now gone too far, and
   note that a grader importing production's vocabulary can be tuned by changing
   production.

6. **Certification checklist — six of eight now strong.** Measured, not assumed,
   in `FIX_ROADMAP_REFIX_R4.md` §3b. Two entries corrected: API E2E was called
   absent and is not (real `TestClient` WebSocket sessions), and performance was
   called blocked when it was merely unwired — harnesses in the tree that
   nothing collected, which is worse than absent because the listing implied
   coverage. **Check both corrections.**

## What is NOT done — do not let me imply otherwise

**Round 5 is incomplete.** Two loops remain open and are not in this range:

- **P3 / V3** — the pipeline emits five verdicts (`verified`,
  `partially_supported`, `unsupported`, `conflicting`, `not_verifiable`) and the
  rubric reads **none** of them. `conflicting` is the system's own conclusion
  that a citation contradicts the claim, and the grader credits it exactly as if
  it read `verified`. Approved, not implemented.
- **P4 / V4** — the mutation rig still does not cover period, segment scope,
  currency, restatement or unit/scale.

Also still absent: **browser E2E** (`apps/gravity-ui` has no test directory at
all — unwritten, not blocked) and the **live database** (genuinely blocked).

## What NOT to re-litigate

- Numeric verification stays **advisory**; FinalGate stays **report-only**.
- **R7 stays BLOCKED** — two audits agreed; more regexes break three shapes.
- **T4** (unknown identity ungraded), **U3's narrow scope**, **U10** (empty
  token `False`), **V2's fail-open** and **V3's chosen direction** were all
  owner-agreed before implementation. Argue implementations, not choices.
- **M4 stages 1–5** — round 3 measured the vocabularies disjoint
  (`m4-stage0-observed-vocabulary.json`). Reopening needs a new observation.

## Known self-reported errors — check I have not under-reported

- **V11**, above: V1's own closure was incomplete and P1's test did not catch it.
- A `_RaisingCache` written in R5's own failure-injection commit used a chained
  assignment that set both flags from one argument, so a cache test **passed
  with nothing injected**. Caught, fixed, and both tests now assert the
  injection fired before asserting anything else.
- A 32 KB pytest parameter blew Windows' environment-variable limit through a
  plugin and surfaced as a harness `INTERNALERROR` rather than a test failure.
- **CI still disabled**: `ruff check app/` reports 1347 errors, `ruff format
  --check` 211 files, neither enforced. Enabling it reddens `main` on lint while
  tests pass.

## The question this audit exists to answer

You said R5 should be the last grader-dominant round. **It was the third.**
Rounds 3, 4 and 5 each changed exactly one non-test, non-doc file, and it was
`eval/head_to_head/rubric.py` every time. No answer this pipeline produces is
better than it was at `82a7d3d`.

So:

1. **Is the grader now good enough to stop working on it?** Not perfect —
   good enough that further grader work is lower value than system work.
2. **If yes, what is the minimum viable R6?** Your five-item list is an
   architecture. Name the smallest system-level change that would actually move
   the answer quality, not the measurement of it.
3. **If no, say so plainly** — that the evaluator still cannot be trusted, and
   that R6 must be a fourth grader round. That is a legitimate answer and I
   would rather have it than a polite yes.

## Method

- **Re-derive before reading my claims.** All five of your audits found things
  nobody asked about, and R5 found a P0 that five audits missed.
- **Verify red-before-green from the commits.** Every fix commit pastes its
  test's failing output.
- **Assume the roadmap is wrong somewhere.** Rounds 1–5 falsified twelve of
  their own governing assumptions between them.

## Output

Severity, file, function, the concrete input, and what it costs a user.
**Separate "this is wrong" from "this is unproven."** A short list of real
findings beats a long list of maybes. **And give me a number for the grader's
trustworthiness separately from a number for the system** — conflating them is
what let a broken instrument score 8.3.
