# Round 7 audit prompt — paste everything below the line into ChatGPT

---

You have audited the Quick Answer finance path of this repository six times.
Your sixth audit (`docs/quick-answer/refix-r7.md`) scored it **system 8.3 /
grader 5.8, NOT CERTIFIED**, and gave two instructions:

1. *"One final evaluator round, then stop touching the grader."*
2. *"Introduce a canonical financial Quantity/Evidence object that survives from
   retrieval → citation → claim binding, instead of reconstructing financial
   meaning from citation text."*

Both were followed. Round 6 was the last grader round; round 7 is the evidence
layer and is partly done. Audit both, and answer the question at the end.

**Repo:** https://github.com/houssem98/AlphaGravity
**Branch:** `feat/web-research-sec-integration` — pushed, every SHA resolves.
**Range to review:** `d029f59..c48e264` — 9 commits, R6 and R7 together
**Scope fence, unchanged:** Quick Answer / `reasoning_depth="fast"` /
single-pass finance path.

Start from `docs/quick-answer/R6_LOOP.md` and `R7_LOOP.md`. Both are claims with
ledgers attached. Neither is evidence.

## Read this first — I want you to attack my central claim, not my findings

Your instruction #2 assumed the canonical evidence object had to be built. I
claim **it already existed**: `citation_provenance.provenance()` opens with the
words *"The canonical evidence object for one passage"* and holds 21 fields
including value, unit, `xbrl_concept`, scope, dimension, period_start,
period_end, fiscal_year and fiscal_quarter. I claim `payload()` — what
`search_pipeline` attaches to a citation — dropped all ten financial ones, and
that this single omission is why every reader below re-derives meaning from
prose.

**That claim is convenient for me.** It turns your "weeks, architectural" into
"one function", and I want it attacked on exactly one axis:

> **`provenance()` returns `None` without a valid accession.** So the object
> only exists for accession-bearing XBRL facts. Dense, sparse, SPLADE, tree-nav
> and web retrieval produce prose and carry no fields at all.

**What fraction of real Quick Answer citations carry fields? I have never
measured it, and nothing in this range does.** If the answer is small, then E1
and E3 improved a path that is rarely taken, and I have declared an
architectural problem solved on the strength of its narrowest instance. That is
the single most valuable thing this audit can settle, and it outranks any new
defect you find.

## What rounds 6 and 7 actually did

Round 6 closed the grader. Round 7 has done three of six rows.

| ID | Layer | What | State |
|---|---|---|---|
| V14 | grader | A table declaring `(in millions)` did not constrain its bare figures | CLOSED |
| V15 | grader | `_ASSERTED` truncated `"$3,582,835 thousand"` to `"$3,582,835 t"` and read the `t` as TRILLIONS — a factor of 10⁹ | CLOSED |
| V18 | rig | Differential contract: production verifier vs. grader on one independently-declared fact | BUILT |
| V19 | **production** | Production ignored a table's `(in millions)` header. A correct claim graded `conflicting`, `is_verified` False — and the claim wrong by 1000× got the **identical verdict** | CLOSED |
| V20 | **production** | `_scrub` did not remove `[3]`, so the marker's integer counted as a claim figure and demoted a fully grounded citation from `verified` to `partially_supported` | CLOSED |
| V21 | both | Metric↔figure transposed — both figures real, both metrics real, each on the other's row. Neither layer notices | **OPEN, pinned** |
| V22 | grader | `_cited_excerpts` fell open on a marker past the end of the citation list. Production calls that `UNSUPPORTED`; the grader bound the claim | CLOSED |
| V23 | **production** | `_fmt_value` wrote `($416.16B)` for "also expressed as"; parentheses mean NEGATIVE in a filing, so every exact fact ≥$1M stated a negative it does not hold | CLOSED |
| V24 | **production** | `_fmt_value` prints `${v/1e6:,.0f} million`, so below ~$120M the rendered text no longer contains the figure. A claim quoting the filing's **exact** value graded `conflicting` | CLOSED via E3 |
| V16 | both | The metric check needs a concept↔English map, which is the forbidden vocabulary | **OPEN by decision** |
| V17 | both | Period conflict: production returns `partially_supported`/`conflicting`, never `UNSUPPORTED`; the grader never looks | **OPEN** |

**Four of the eleven are production defects, and five audits read those files.**
V19 in particular is V14 restated one layer down, against the same fixture.
Every one was found by a test rig — differential or round-trip — and none by
inspection. I think that is the most important pattern in this range. Tell me if
I am over-reading it.

## Claims to attack

1. **V19 — production now reads a declared scale.** The reader is defined once,
   in `citation_verdict`, and `rubric.py` imports it. **Attack the coupling:**
   your fifth audit already flagged that a grader importing production's
   vocabulary can be tuned by changing production. This is the second such
   import. Is that now a systemic problem or the right call?

2. **E1 — `payload()` carries ten financial fields.** Additive, and `{}` for
   passages with no accession. **Attack the blast radius:** `payload()` output
   reaches the browser. Does adding `value`, `unit` and `xbrl_concept` to a
   citation expose anything that should not leave the backend, or change any
   consumer that iterates keys rather than reading named ones?

3. **E2 — `scale` deliberately NOT added.** Argument: only the accession-gated
   XBRL path reaches a citation, XBRL values are absolute, so `scale` would be a
   constant 1. **Attack the premise:** find a producer of non-absolute values
   that can reach `provenance()`. `rehydrate()` and the `financials` table are
   the places to look.

4. **E3 — the verifier grades from the fact's value.** A claim figure equal to
   the fact's value is grounded regardless of the prose, and when a fact is
   present the leftover/contradiction scan is skipped in favour of
   `partially_supported`. **Attack the second half specifically.** I removed a
   contradiction detector on the fact path, reasoning that an exact fact states
   one figure and the prose leftovers are its own rounded twin. Construct the
   case where that hides a real contradiction.

5. **The differential rig's invariant may be nearly vacuous.** It asserts
   *production says UNSUPPORTED ⇒ the grader must not bind*. But
   `verdict_for_citation` returns UNSUPPORTED **only** when the citation fails
   to resolve; every value, entity and period disagreement returns
   `CONFLICTING`. So for the node mutations the antecedent is almost never true.
   I noticed this and did not fix it. **Decide whether the rig measures what its
   docstring claims**, and whether widening "rejects" to include `CONFLICTING`
   is correct or would simply re-file V17 as a violation.

6. **`KNOWN_SHARED_GAPS` grew rather than shrank.** R7 says it must only shrink;
   round 6 added `KNOWN_SHARED_EDGE_GAPS = {"edge-metric-figure-transposed"}`.
   I argue pinning a found gap is the mechanism working. **Decide whether that
   is honest bookkeeping or a ratchet that lets known-bad behaviour pass.**

## What is NOT done — do not let me imply otherwise

- **E4** — the grader still re-parses prose. `rubric.py` reads none of the
  fields E1 added.
- **E5 / V21** — `_claim_is_bound` works per SENTENCE, not per proposition. A
  sentence with three propositions binds if any one figure matches. The
  `Claim ──supports──> EvidenceFact` half of your diagram is not built.
- **V16 stays open by decision**, not by oversight: the fact carries an XBRL
  tag, the claim carries English, and I refused to add the mapping.
- **V17 stays open.**
- **No answer quality has been measured in this range or the last.** Every
  number in both ledgers is a test count. There is still **no reference set**,
  so "is this better than ChatGPT" remains unanswerable — it has blocked
  certification since round 1 and no loop can produce it.
- **Browser E2E** — `apps/gravity-ui` still has no test directory.
- **Live database** — still blocked.
- **CI still disabled** behind a large `ruff` backlog.

## What NOT to re-litigate

- **V16's direction** — owner-decided: recorded as a limit the claim layer
  closes, rather than widening production's metric vocabulary for an eval need.
- **E2's decision** not to add a constant field.
- **E3's scope** — fields decide the fact's own figure; the text path still runs
  for every other figure in the sentence. Owner-decided, deliberately the more
  conservative of the two options.
- Numeric verification stays **advisory**; FinalGate stays **report-only**.
- Argue implementations, not these choices.

## Known self-reported errors — check I have not under-reported

- **I undercounted my own headline finding.** `R7_LOOP.md` first said nine
  dropped fields; it is ten — `scope` was dropped too. Superseded in the ledger
  rather than edited.
- **I predicted E1 would break two contract tests and it broke neither.**
  `test_provenance_mutation_rig.py` and
  `test_gate_accepts_real_pipeline_citations.py` pin a hardcoded literal
  citation rather than `payload()`'s key set, so they are blind to additive
  change. Recorded as a missed prediction. **That also means they would be blind
  to a field being dropped again.**
- **I claimed in `R7_LOOP.md` that V16 and V17 would fall to E3. Neither did**,
  and I corrected it only after implementing.
- **A commit appeared mid-loop that the loop did not make** (`4c2c434`,
  committing work the session had verified but not committed). Content was
  identical; flagged rather than absorbed silently.
- **V21's pin was added by the same session that found it**, which is the
  gate-integrity hazard in its purest form. Check that the pin is bidirectional
  — it asserts the gap is still open and fails if it closes.

## The question this audit exists to answer

Your sixth audit's thesis was that the system is ~8.3, the instrument was ~5.8,
and the next move is to make the evidence representation strong enough that the
grader becomes boring.

So:

1. **Is the evidence representation actually stronger, or only stronger on the
   XBRL path?** Quantify the coverage if you can — that is the question I most
   want answered and the one I have not asked of myself.
2. **Is the grader boring yet?** It should be getting less load-bearing, not
   more. If E1–E3 have not moved that, say so.
3. **What is the smallest next move?** E4 and E5 are written down, but if the
   coverage answer to (1) is "small", the right next move may be neither of them
   — it may be making prose citations carry fields, or admitting that most of
   this pipeline will never have them and grading accordingly.
4. **Give the system and the instrument separate numbers again.** Conflating
   them is what let a broken instrument score 8.3.

## Method

- **Re-derive before reading my claims.** All six audits found things nobody
  asked about, and this range found four production defects that six audits
  read past.
- **Verify red-before-green from the commits.** Every fix commit pastes its
  test's failing output and its count reconciliation.
- **Assume the ledger is wrong somewhere.** Rounds 1–7 have falsified their own
  governing assumptions repeatedly, including three times in this range.

## Output

Severity, file, function, the concrete input, and what it costs a user.
**Separate "this is wrong" from "this is unproven."** A short list of real
findings beats a long list of maybes.
