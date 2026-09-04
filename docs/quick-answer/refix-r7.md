I re-audited 5c4a1a5..d029f59 against the actual branch, not the R5/R6 roadmap claims. The range is indeed 7 commits / 12 files, and critically, the only non-test/non-doc production change is still eval/head_to_head/rubric.py.

R6 verdict
No — the grader is not trustworthy enough to stop working on it.

But this is a much narrower conclusion than previous rounds:

System quality: 8.3/10
Grader trustworthiness: 5.8/10
Certification: NOT CERTIFIED
R6: should be one final evaluator-hardening round, then stop touching the grader unless a system change exposes another evaluator defect.

The reason is very specific:

V1 is still semantically broken for real filing tables.

The multiplication loop is not itself wrong. The problem is that the grader knows a number is bare, but it does not know the table's declared scale.

1. P1 — V1 is still capable of false evidence binding
File

services/gravity-api/eval/head_to_head/rubric.py

Function

_matches() → _claim_is_bound() → _binds()

The current _matches() explicitly allows scale multiplication for a bare figure:

for scale in (1e3, 1e6, 1e9):
    if got * scale == expected:
        return True

That is necessary for a table like:

(in millions) ... Operating revenue $ 59,070

because 59,070 itself carries no unit. The real fixture explicitly documents this shape.

But the grader has lost the header semantics by the time _matches() sees the number.

Concrete failure

Real-shaped evidence:

(in millions)
2025 2024 2023
Operating revenue $ 59,070 $ 57,063 $ 53,717

Answer:

United operating revenue was $59.07 million [1].

The answer's explicit $59.07 million is correctly rejected by _asserts() when the ground truth is $59.07B.

But when checking evidence, _claim_is_bound() extracts 59.07e6, and the citation contains bare 59,070.

_matches() is allowed to do:

59,070 × 1,000 = 59,070,000

and therefore declares the citation supportive.

So you get:

correctness = 0
evidence    = potentially 1

The real-filing fixture demonstrates exactly the table shape that creates this ambiguity.

User cost

The benchmark can say:

"Wrong answer, fully supported by the filing."

That is a materially false evidence measurement.

It does not recreate the original V1 P0, because _asserts() now correctly rejects explicitly wrong units. But the evidence dimension is still wrong.

Root cause

Not _matches().

The root cause is:

The grader reduces a context-dependent financial quantity to a scalar before the table's unit/scale context has been preserved.

This is exactly the kind of bug that a financial evidence engine cannot ultimately solve with increasingly clever regexes.

2. P1 — V2 deliberately fails open around citation edges

This one is more nuanced.

The implementation now correctly handles:

Revenue ... [1]

against citation [0] versus [1].

The test explicitly proves the crossed-citation case fails.

However, _cited_excerpts() deliberately does this:

no marker        → search all citations
out-of-range     → search all citations
short citation   → search all citations

and the tests explicitly lock that behavior in.

Concrete input
"NVIDIA revenue was $130 billion [9]."

with:

citation[0] = irrelevant
citation[1] = contains $130B revenue

The grader still returns bound.

User cost

A malformed or incorrect citation edge can be silently rescued by an unrelated citation.

That means:

the grader verifies "some evidence exists" rather than necessarily "the evidence I cited supports this claim."

I am not calling this a regression, because you've explicitly chosen this behavior and documented the tradeoff. But it remains a real limitation of the evaluator.

The important distinction is:

implementation is intentional; guarantee is weak.

3. V12 — _ROW_LABEL is a legitimate boundary detector, but not a complete solution

I agree with the defense partially.

Calling _ROW_LABEL a sixth metric vocabulary would be misleading.

It doesn't map:

"expense" → operating_expense

It simply says:

"a new row probably begins here."

That is genuinely different from _METRIC_RES.

The implementation demonstrates the intent clearly: a real UAL table has:

Operating revenue ...
Operating expense ...
Operating income ...

and the row-label boundary prevents revenue's span from consuming the next row.

But

The vocabulary is still a hand-maintained list of nouns:

expenses
costs
margins
income
loss
assets
liabilities
equity
cash
taxes
earnings
shares

That is not guaranteed to cover SEC tables.

So I would classify this:

V12 architecture: correct.

V12 coverage: unproven.

I would not invent a P1 here without a real corpus counterexample.

The next real corpus mutation should be the way to prove it.

4. V13 — three real filings are a major improvement, but still nowhere near coverage

This round genuinely improved the benchmark.

The fixtures are not invented prose anymore. They contain real issuer metadata and verbatim corpus text.

And importantly, the fixtures deliberately contain:

millions
thousands
multi-period tables
multiple metrics
negative parenthetical figures
segment data

That is good.

But three excerpts cannot establish that the parser handles SEC financial language generally.

Highest-risk missing shape

My ranking:

Restated / revised figures
Non-USD currency
Footnote markers embedded in figures
Per-share amounts
Negative parentheses

Why restatements first?

Because this isn't merely formatting:

2024
2024 (as previously reported)
2024 (as revised)

The same period can legitimately have two values, and a lexical period/metric matcher can associate the wrong one without ever encountering an obviously malformed number.

That is much more dangerous than a simple parentheses parser failure.

So V13 is:

REAL improvement — not proof of general filing robustness.

5. The production coupling is now acceptable — but only temporarily

I don't consider:

from app.core.finance.query_plan import _METRIC_RES

a mistake by itself.

R4 correctly identified vocabulary drift as a real problem. The current grader is deliberately sharing the production metric vocabulary rather than silently maintaining a second copy.

However, you have traded:

drift risk

for:

coupling/tuning risk.

That's a reasonable trade only if the shared object becomes a stable public contract.

Right now it's a private symbol:

_METRIC_RES

crossing a package boundary.

I would eventually replace that with something like:

financial_metric_registry

or a public immutable metric specification.

But I would not spend another grader round fixing that.

6. The certification correction: API E2E is real

This correction is valid.

test_search_stream_contract.py actually constructs a real FastAPI TestClient, opens real WebSocket sessions, exercises the real route and substitutes only the pipeline boundary.

So:

API E2E = genuinely present.

Browser E2E remains absent.

That's an honest correction.

7. But the "performance is strong" correction is overstated

This is the other place where I disagree with the R6 certification document.

The new test_grader_performance.py measures:

the grader

not:

Quick Answer end-to-end performance.

The test itself explicitly says that. It reports roughly 1.5 ms for score_answer() and tests scaling with citation count, but also explicitly states that it says nothing about real retrieval/model latency.

Therefore:

Grader performance

Strong regression coverage.

Quick Answer system performance

Still unmeasured.

So calling certification requirement #7 "Performance measurements — Strong" is too generous if the requirement means production Quick Answer latency.

That's a P1 certification/documentation issue, not a grader-code bug.

The most important question: is the grader now trustworthy?
No. 5.8/10.

Not because it is bad.

Because the remaining failure is in exactly the class of mechanism that produced the historical disasters:

a financial quantity is interpreted without preserving all of its provenance/context.

You have now fixed:

explicit magnitude mismatch
bare-reading residual
citation-index binding
metric/value confusion
production metric vocabulary drift
real filing fixture blindness

Those are substantial improvements.

But the table-scale problem demonstrates that the grader still thinks too much in terms of:

number → scalar

instead of:

quantity =
    value
    unit
    scale
    currency
    period
    metric
    scope
    entity
    provenance
What would actually prove the grader trustworthy?

This is the most important answer to your prompt.

Not another 20 hand-written tests.

I would require a differential/property-based contract test between the production financial verifier and the evaluator.

Something like:

                 same financial fact
                        │
             ┌──────────┴──────────┐
             ▼                     ▼
     production verifier       benchmark grader
             │                     │
             └──────────┬──────────┘
                        ▼
                  verdict agreement

Generate/mutate:

value
unit
scale
currency
sign
period
scope
segment
metric
issuer
accession
verification_status
citation index
restatement status

and require:

Invariants
correct quantity
      → production = supported
      → grader    = supported

wrong unit
      → production = unsupported
      → grader    = unsupported

wrong scale
      → production = unsupported
      → grader    = unsupported

wrong period
      → production = unsupported
      → grader    = unsupported

wrong entity
      → production = unsupported
      → grader    = unsupported

wrong citation edge
      → production = unsupported
      → grader    = unsupported

And critically:

Do not generate the expected answer from the same code being tested.

Ground truth should come from an independent representation of the filing fact.

That's the real antidote to the V13 problem.

The mutation rig also needs one major evolution

The current rig is good.

It starts from a real production-shaped citation and mutates:

source class
accession
issuer
cited value
metric
CIK
form
verification status

and it proved that several mutations actually changed the grader.

But notice something important:

Most mutations are node mutations.

The missing class is edge mutations.

You've already discovered why that matters with [1] vs [2].

So the next rig should mutate:

claim ──→ citation

not just:

citation fields

And then mutate financial-context edges:

claim
 ├──→ metric
 ├──→ value
 ├──→ unit
 ├──→ scale
 ├──→ currency
 ├──→ period
 ├──→ scope
 ├──→ entity
 └──→ citation

That would be much closer to an actual evidence graph test.

Final score

I would revise the numbers from the previous audit to:

Component	Score
Financial reasoning/math architecture	9.0
Retrieval architecture	8.5
Provenance architecture	8.0
Answer contract / FinalGate	8.5
Evidence binding	7.0
Evaluator correctness	5.8
Adversarial testing	8.5
Production validation	6.5
Overall system	8.3/10
Grader trustworthiness	5.8/10
And my decision on your three questions
1. Stop working on the grader?

No.

There is still a real financial-semantic hole: table-declared scale is not carried into evidence matching.

But I would make this the last dedicated grader round.

2. Minimum viable R6 system change?

After that final grader fix:

Introduce a canonical financial Quantity/Evidence object that survives from retrieval → citation → claim binding, instead of reconstructing financial meaning from citation text.

That is the smallest architectural move that attacks the underlying class of failures rather than another symptom.

Something like:

EvidenceFact
 ├─ entity
 ├─ metric
 ├─ value
 ├─ currency
 ├─ unit
 ├─ scale
 ├─ period
 ├─ scope
 ├─ segment
 ├─ filing/accession
 ├─ section
 └─ evidence_id

Then:

Claim C17
      │
      └── supports → EvidenceFact E42

That is the transition from "RAG with sophisticated guards" to a real financial evidence system.

3. Are you world-class?

Not yet.

But I would change the diagnosis from earlier rounds:

You are no longer primarily missing clever retrieval.

You are missing a canonical semantic evidence layer.

And that is a much more important architectural observation.

The system is ~8.3. The measurement instrument is ~5.8. The next move should be to make the system's evidence representation strong enough that the grader becomes almost boring.

One final evaluator round to establish that contract, then stop optimizing the scoreboard and move the engineering effort into the production evidence graph.