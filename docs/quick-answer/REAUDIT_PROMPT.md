# Re-audit prompt — paste everything below the line into ChatGPT

---

You audited the Quick Answer finance path of this repository previously and
produced `docs/quick-answer/chatgpt answer.md`. Work has since been done in
response. Re-audit it.

**Repo:** https://github.com/houssem98/AlphaGravity
**Branch:** `feat/web-research-sec-integration`
**Range to review:** `5d31ca8..5e5b29a` (24 commits)
**Scope fence, unchanged:** Quick Answer / `reasoning_depth="fast"` / single-pass
finance path only. Ignore the agentic orchestrator and Deep Research path.

## What I want from you

Not confirmation. I want you to try to break the claims below. Every one of
them is a claim I am making, not a fact you should assume — treat this document
the way you treated the code the first time: as something that might be
overstating itself.

Three things specifically:

1. **Re-derive your own findings first, before reading my claims.** If you only
   check what I tell you I changed, you will miss whatever I did not think to
   look at. Your original audit found things nobody had asked about; do that
   again.

2. **Attack the disproof of your headline P0.** Your #1 was "FinalGate is
   implemented but never invoked." I claim that is wrong — `FinalGate.check`
   runs in `SearchPipeline.search` immediately before the cache write. I also
   claim two conditions on it that you did not identify: it sits inside
   `if _c is not None:` where `_c = locals().get("_contract")`, and `_contract`
   is bound inside a `try` whose `except` only logs `finance_plan_failed`. So a
   planning failure silently skips the gate. **Check whether I have this right,
   and whether there are further conditions I have also missed.** If my
   disproof is wrong, say so plainly — it is the single most load-bearing claim
   here and everything downstream assumed it.

3. **Judge whether the fixes are real or cosmetic.** Several were closed with
   tests I wrote myself. A test written by the same person who wrote the fix,
   and never seen failing, proves nothing. I claim every one was run against
   the unfixed code first and observed red — verify that claim against the
   commit history rather than believing it.

## What I claim was done

State per item whether you agree, disagree, or cannot tell.

| Your item | My claim | Commit |
|---|---|---|
| 1. FinalGate never invoked | **Disproved** — it runs. But the REST route was dropping its verdict, so a REST caller genuinely could not see it. That part of your instinct was right | `d4ca94a` |
| 2. Cache bypasses verification | Closed. A failed stored verdict is refused on read; an answer the gate never ran on is not cached at all | `504246f`, `891c6e0` |
| 3. ratio_engine bypasses typed Quantity | Closed in part. Operands are now typed and carry period/unit/document_id/filing_date/source_section. **`accession` is not carried** — the table has no such column | `54f730e`, `891c6e0` |
| 4. Arbitrary duplicate-fact selection | **NOT FIXED. Blocked.** No service-role key in the environment, anon RLS returns 0 rows, so the concept-precedence decision cannot be verified against real data | — |
| 5. Non-finite values escape | Closed. One shared finiteness gate with `period_math` | `ad2fd7a` |
| 6. calc_guard only a negative heuristic | Unchanged, by design — you agreed it was acceptable while labelled honestly | — |
| 7. Numeric grounding advisory | Closed **as a decision, not a code change**. The owner chose to keep it advisory because the false-positive rate is unmeasurable in this environment | `d4ca94a` |
| 8. Evidence not claim-level | Closed. The stated figure is now checked against the cited excerpts | `5460fbb` |
| 9. Correctness accepts number anywhere | Closed. A parenthetical no longer rescues a wrong headline | `f2477d6` |
| 10. Period/entity token presence | Period half closed. **Entity half NOT fixed** — needs a company-name vocabulary the grader does not have | `3ab9bc6` |
| 11. Benchmark provenance free-form | Closed, but in a different shape than you proposed — structured records with `supports` links rather than fields on each case. Judge whether that is equivalent | `2d98940` |
| 12. Doc overstates implementation | Closed | `4edf154` |
| 13. Doc calls the calculator "deterministic" misleadingly | Closed. **This one had no defect ID and was nearly missed** — the working graph had 12 entries for your 13 items | `891c6e0` |

## What I am explicitly NOT claiming

- **Not certified.** Your blind head-to-head (#1 of your certification list)
  is still unrun. No reference set exists. "Beats ChatGPT" remains unverified
  and I have not claimed otherwise anywhere in the repo.
- **Browser E2E still blocked.** No spec covers the SEC link path.
- **Items 4 and 10-entity are open**, with reasons recorded, not fixed.
- **Latency is uncorrected.** I found why the `serialization` stage was bimodal
  (the span enclosed a Redis write and a `yield`, so it was measuring the cache
  and the client, not serialization) and split it. But the 11.3 s retrieval
  median and the dense channel hitting its 12 s cap are **unmeasured** — no
  live pipeline in this environment.
- **No live verification of anything.** No service was run, no benchmark
  executed, no database queried, no browser driven. Same limitation you had.

## Things I would most like you to be suspicious of

I am naming these because I think they are the weakest points, and an auditor
who has been handed a list of successes tends to grade the list.

- **The cache still serves entries with no recorded verdict** when those are
  genuinely legacy. I argued they age out on TTL. Decide whether that argument
  holds or whether it is convenient.
- **The evidence claim-binding is deliberately lenient** — it fires only when
  citations carry excerpts, and accepts a match in any cited excerpt rather
  than a primary one. I justified this as avoiding over-tightening. It could
  equally be a way of making the check rarely fire. Check how often it actually
  can fire.
- **`_asserts` treats a parenthetical as an aside** unless nothing outside it
  makes a competing claim. Find the answer shape that defeats this.
- **The period-attachment rule only fires on a positive competing year.** An
  answer that names no period at all is not penalised. Decide if that is a hole.
- **Test counts are self-reported.** 2097 → 2193. I have not had you or anyone
  else re-run them.

## Deliverable

Same format as your first audit. A severity-ranked list, with `READ` /
`INFERENCE` labels distinguishing what you verified in the source from what you
concluded. Add a fourth judgement I did not ask for last time: for each item I
claim closed, say whether the fix addresses the **cause** or only the **symptom
you named**. I would rather find out now that I patched the example instead of
the class.

If you conclude the branch is in worse shape than I have described, say that
directly. A re-audit that agrees with the person who commissioned it is worth
nothing.
