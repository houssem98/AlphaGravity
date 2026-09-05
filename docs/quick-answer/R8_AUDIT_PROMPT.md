# Round 8 audit prompt — paste everything below the line into ChatGPT

> **Push the branch first.** It is 41 commits ahead of origin. Until you push,
> none of the SHAs below resolve and the auditor cannot check a single claim.

---

You have audited the Quick Answer finance path of this repository seven times.
Round 8 has now run: 41 commits, 18 defects found, 16 closed, and a final audit
that **declines to certify**.

**Repo:** https://github.com/houssem98/AlphaGravity
**Branch:** `feat/web-research-sec-integration`
**Range to review:** `2689aa1..656b762` — 41 commits
**Scope fence, unchanged:** Quick Answer / `reasoning_depth="fast"` /
single-pass finance path.

Start from `docs/quick-answer/R8_FINAL_AUDIT.md` and `R8_LOOP.md` (80 ledger
rows). Both are claims with evidence attached. Neither is evidence.

---

## Attack these five things, in this order

I have ranked them by how much damage they do if I am wrong. Spend your effort
at the top.

### 1. The differential rig may have been blinded by this round's main refactor

This is the risk I most want you to hunt, and I am naming it because I am not
confident I have handled it.

Round 8's recurring fix was **"production defines, the evaluator imports"**.
`metric_spans`, `declared_scale`, `declared_scales`, `column_years`, `_periods`,
`_periods_disagree`, `currencies_in`, `currency_of` and `is_primary_class` are
now defined in `app/` and imported by `eval/head_to_head/rubric.py`.

The differential rig (`tests/test_grader_agrees_with_production_verifier.py`)
exists to catch cases where production and the grader disagree. **A bug in a
shared definition now produces perfect agreement.** The rig cannot see it, by
construction.

Concretely: `metric_spans` moved into production in QA-12 and both layers now
call it. If its span logic is wrong — the boundary rule, the `ROW_LABEL` list,
the fail-open on no-span — both layers are wrong identically and the rig reports
clean.

**Questions:** How many of this round's fixes are now un-cross-checkable? Is the
rig still measuring anything about shared code, or only about the parts that
remain independent? Does the round's claim of "one definition" trade a
correctness property for a testability one, and did I notice?

### 2. Fail-open may have swallowed the fixes

Almost every check I added abstains rather than refuses when it cannot decide,
and I called that "one-directional" throughout. Count the abstentions:

- `metric_spans` returns `None` when a metric has no numbered span → the caller
  searches the **whole excerpt**
- `metric_keys` returns the empty set for any metric outside a 25-entry
  vocabulary → **no constraint at all** (this is V16, still open)
- the column check forms no opinion unless the header parses ≥2 years AND the
  row has the same figure count
- the period check decides only when **both** sides name a period
- the currency check fires only when **both** sides name a currency
- V33's provenance gate falls back to the whole passage when the claim names no
  known metric

**Questions:** On a realistic corpus, what fraction of claims hit a fail-open
path and are therefore unconstrained by the fix that was supposedly landed?
Ledger rows 64 and 65 record two of my own predictions being wrong for exactly
this reason. Is the round's headline — "the layer no longer certifies wrong
claims" — true only for claims that happen to name a vocabulary metric, a
parseable period and an explicit currency?

### 3. The theatre audit is my instrument judging my own fixes

`tests/quick_answer/theatre_audit.py` reverts each fix and asserts its guard
goes red. Final state: 21 cases, 21 real guards, 0 theatre.

It found four theatre tests on its first run, including one (V1) that had gone
five rounds with no isolating test. Then I fixed those four and it reported
clean.

**Questions:** Is 21 cases adequate coverage of a suite of 2,756 tests? Which
fixes have NO case in the audit — and were they omitted because they are hard to
revert, which is also the shape of a fix with no real guard? The `reverted_snippet`
for each case is my reconstruction of the pre-fix code; verify a sample against
the actual diffs in the range. If a reverted snippet is not what the code really
was, that case proves nothing.

### 4. The pre-registered matrix — verify the pre-registration is real

`docs`-level claim: the QA-14 matrix expectations were committed at `c9afbe9`
**before** the matrix was first run, so the expected results could not have been
written to match observed behaviour.

**Check it.** `git show c9afbe9` should contain the full expectation table with
no results. The commit after it should be where behaviour was first observed.
If the ordering does not hold, section 11 of the final audit is worthless and
you should say so plainly.

Two predictions were wrong and are kept in the file labelled as wrong. Verify
they are labelled honestly and that no third wrong prediction was quietly
corrected.

### 5. The thing the round did not do

`R8_FINAL_AUDIT.md` §1 states that **whether Quick Answer answers questions
correctly was never measured** — no end-to-end accuracy benchmark was run.
Everything measured concerns whether the system's own verification is honest.

**Questions:** Given that, is the round's work worth what it cost? Is a
verification layer hardened against six named failure classes valuable when
nobody has demonstrated the answers are right in the first place? Should round 9
be an accuracy benchmark rather than more verification hardening — and if so,
say so bluntly.

---

## What I claim, so you can falsify it

Each of these has a red-before-fix measurement in the ledger. Pick the ones you
doubt and check them against the code, not the ledger.

| id | claim |
|---|---|
| V34 | production compared a passage's ticker with **itself**; a Microsoft claim cited to Apple's filing returned `verified` |
| V41 | production grounded by set membership; a figure from the row **beside** the named metric returned `verified` |
| V38 | a sentence whose **headline figure was fabricated** bound because the comparative beside it was true |
| V39 | a metric whose name contains another metric's name was **silently unconstrained** |
| V33 | a regex-valid accession was proof of a filing; a blog with an invented accession earned `SEC_EVIDENCE` |
| V30 | production read `($416,161 million)` as **negative** — a correct answer read as wrong |
| V42 | a currency-free claim lost its scale constraint; three readings a thousand apart all bound |

And the measurement I lean on most heavily, which you should try hardest to
break: **the rig's headline invariant had never fired.** Production returns
`UNSUPPORTED` zero times for any content mutation, so *"production says
UNSUPPORTED ⇒ the grader must not bind"* was vacuously true from round 6 to
round 8. If that is wrong, several conclusions collapse.

---

## Still open, by my own account

Do not spend time rediscovering these. Tell me if any is worse than I recorded.

| id | state |
|---|---|
| V16 | `operating expense` absent from production's metric vocabulary — owner chose to record, not widen |
| V29 | filing footnote markers parse as figures; no harm demonstrated |
| V40 | a bare per-share figure is never an asserted level, so a fabricated EPS is invisible |
| V31 residue | a passage naming no year still lets the filing date create a conflict |
| V42 residue | `6,744 billion` still binds against a dual-currency header |
| QA-10 | atomic decomposition — **PARTIAL**, and declared so rather than half-built |

---

## Rules for your report

1. **Do not grade generously.** The previous audit scored 8.3 / 5.8 and refused
   to certify; that refusal was correct and useful.
2. **Separate "the fix is wrong" from "the fix is narrow".** A fix that works
   only on tabular passages is not a broken fix, but it is not the fix the
   ledger claims either. Say which.
3. **Check at least three claims against the code**, not the documentation.
   Name the file and line.
4. **If the round's central claim survives, say so plainly** — I am not asking
   you to find fault, I am asking you not to miss it.
5. End with one number for the system, one for the evaluator, and a single
   certify / do-not-certify decision with the one change that would most move
   it.
