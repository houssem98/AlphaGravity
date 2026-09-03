Quick Answer finance-path audit — feat/web-research-sec-integration

READ-only source audit. I did not run the service, tests, benchmark, browser, or any external provider.

I stayed inside your scope fence: Quick Answer / reasoning_depth="fast" / single-pass finance path only. I did not use findings from the agentic orchestrator or Deep Research path.

Executive verdict

I found 4 P0/P1 structural correctness problems, including one that is worse than the earlier audit:

FinalGate is implemented and tested, but I cannot find it being called anywhere in the Quick Answer pipeline.

The code constructs an AnswerContract, tells the model about it, then never invokes FinalGate.check() before emitting the answer.

There is also a second-order problem:

Cached answers bypass the entire verification pipeline before the contract is even constructed.

And the 56KB ratio_engine.py remains a genuine weak point: it injects values as “computed deterministically from audited filings”, but the fetched database rows are reduced to caption,value_float; their accession/document provenance is not carried into the calculation.

Finally, I found what I believe is the 7th head-to-head grader bug:

Evidence scoring gives full credit if any primary citation exists, without proving that the answer's individual claims are actually attributed to it.

That directly contradicts the benchmark's own claim-map philosophy.

1. 🔴 P0 — FinalGate is not actually executed on Quick Answer
READ

The pipeline builds the contract here:

services/gravity-api/app/core/search_pipeline.py ~lines 820–850

_fin = plan_finance_query(
    query,
    entities=_ents if isinstance(_ents, dict) else None,
)
query_plan["finance_plan"] = _fin.as_dict()

from app.core.finance.answer_contract import build_contract
_contract = build_contract(_fin)
query_plan["answer_contract"] = _contract.as_dict()

So the contract is real and deterministic.

But at the top of search_pipeline.py, the imports include:

from app.core.reasoning.prompts import (
    FINANCIAL_ANALYST_SYSTEM,
    build_user_message,
    build_reasoning_system_prompt,
    strip_ai_wording,
)

There is no FinalGate import.

More importantly, after generation, verification, citation normalization and metadata construction, the pipeline emits:

search_pipeline.py ~lines 2100–2145

yield SearchEvent(
    type="answer",
    data={
        "answer": parsed_answer,
        "citations": citations_out,
        ...
        "confidence": confidence_out,
        ...
    },
    trace_id=trace_id,
)

I inspected the remainder of the 2,862-line file: there is no FinalGate.check(...) execution in the Quick Answer path.

Meanwhile the class itself only defines:

services/gravity-api/app/core/finance/answer_contract.py ~lines 230–330

class FinalGate:
    ...
    @staticmethod
    def check(...):
        ...
        return GateResult(...)
Why this is severe

The contract is therefore:

PLAN
 ↓
CONTRACT
 ↓
PROMPT
 ↓
MODEL
 ↓
VERIFIERS
 ↓
ANSWER

not:

PLAN
 ↓
CONTRACT
 ↓
PROMPT
 ↓
MODEL
 ↓
FINAL GATE
 ↓
ANSWER

The tests prove that FinalGate works in isolation. They do not prove that Quick Answer invokes it.

What the user loses

A model can violate:

required primary source
minimum citations
abstention
scope disclosure
percentage-point reporting

and still be emitted.

This is P0.

2. 🔴 P0 — Cached answers bypass the contract and every downstream verification

This is separate from #1.

At the beginning of the Quick Answer path:

search_pipeline.py ~lines 650–675

if self.cache:
    try:
        cached = await self.cache.get(query, tickers=_cache_tickers)
    except Exception as e:
        logger.warning("cache_get_skip", ...)
        cached = None

    if cached:
        ...
        yield SearchEvent(type="answer", data=cached, trace_id=trace_id)
        yield SearchEvent(type="metadata", ...)
        return

This occurs before the finance contract is constructed at ~820 and before:

retrieval
calculator guard
ratio engine
numeric verification
temporal verification
citation normalization
FinalGate

So even if #1 were fixed tomorrow, a cached answer would still bypass it.

Production consequence

If a bad answer is ever cached:

bad generation
   ↓
cache
   ↓
future request
   ↓
RETURN IMMEDIATELY

No fresh contract evaluation.

No fresh numeric verification.

No fresh citation verification.

No FinalGate.

P0.

The correct architecture is not necessarily “re-run expensive retrieval.” For Quick Answer, the cache should store the verified final artifact plus the contract/evidence verdict, and the replay path must reject entries that lack a valid verification state.

3. 🔴 P0 — ratio_engine.py bypasses typed Quantity entirely

Your period_math.py is genuinely strong.

It requires:

class Quantity:
    value: float
    metric: str
    period: FiscalPeriod
    company_id: str = ""
    unit: str = "USD"
    basis: Basis = Basis.FLOW

and rejects non-finite values:

if not math.isfinite(self.value):
    raise ValueError(...)

Its growth/margin/delta/CAGR operations enforce:

company compatibility
metric compatibility
unit compatibility
fiscal calendar compatibility
annual vs quarterly compatibility
interval correctness
zero-base handling
finite outputs

For example:

bad = _same_subject(current, prior, metric_must_match=True)

and:

if q is None:
    return Refusal("incomparable_periods", ...)
But the large ratio engine does none of that.

ratio_engine.py fetches:

rows = await supabase_rest.sb_select(
    "financials",
    {"ticker": f"eq.{ticker.upper()}", "period": f"eq.FY{yr}"},
    select="caption,value_float", limit=200,
)

services/gravity-api/app/core/finance/ratio_engine.py ~lines 1070–1090.

It then converts those directly into:

base[mkey] = float(val)

and computes ratios over those bare floats.

There is no Quantity.

Worse: provenance is discarded

The database schema actually has:

document_id
filing_date
metric_name
period
value_raw
value_float
unit
source_section
caption

supabase/migrations/0002_financials.sql ~lines 8–25.

But the ratio query selects only:

caption,value_float

So the engine does not carry:

document_id
filing_date
unit
source_section
accession

into the ratio calculation.

Yet its output tells the model:

"⚠ These values are computed deterministically from audited filings. Do NOT recompute them. Cite them directly."

ratio_engine.py ~lines 995–1010.

That claim is stronger than what this code has actually established.

What can happen

The ratio engine can produce:

Gross Margin: 42.31%

but the RatioResult knows:

ticker
period
numerator_metric
denominator_metric
numerator_value
denominator_value

It does not carry the filing identity that produced those values.

That means the calculation is deterministic, but determinism ≠ provenance.

P0 for a financial research product.

4. 🔴 P0 — ratio_engine can select an arbitrary duplicate fact

The fetch path does:

for r in rows:
    concept = r.get("caption")
    val = r.get("value_float")
    if concept in _CONCEPT_TO_METRIC and val is not None:
        mkey = _CONCEPT_TO_METRIC[concept]
        base.setdefault(mkey, float(val))

The comment says:

# first non-null wins

ratio_engine.py ~lines 1085–1095.

But the database permits multiple rows for a ticker/period:

id text primary key
-- {ticker}_{metric}_{period}_{document_id}

and does not define a uniqueness constraint on:

ticker + period + caption

0002_financials.sql ~lines 8–25.

The query also has:

limit=200

and no deterministic ordering.

Therefore the code's semantic rule is:

whichever matching row happens to arrive first wins.

That is not a financial-data selection policy.

READ: the code has this behaviour.

Inference: if multiple matching XBRL facts exist for a ticker/period, the selected fact can depend on database result ordering. I did not run the query, so I am not claiming that production currently contains such a duplicate.

Still P0/P1, because the implementation has no deterministic fact-selection rule.

5. 🔴 P1 — ratio_engine can produce non-finite values outside period_math

The typed layer explicitly prevents this:

if not math.isfinite(self.value):
    raise ValueError(...)

But ratio_engine._safe_div() is:

def _safe_div(n, d, pct=False):
    if d == 0 or d is None or n is None:
        return None
    result = n / d
    return result * 100 if pct else result

ratio_engine.py ~lines 55–62.

There is no:

math.isfinite(n)
math.isfinite(d)
math.isfinite(result)

Then compute() accepts the formula output:

value = defn.formula(num_val, den_val)

results.append(
    RatioResult(
        ...,
        value=value,
        ...
    )
)

ratio_engine.py ~lines 1180–1205.

So period_math has an explicit finite-result invariant, while ratio_engine does not.

READ: this path permits non-finite numeric inputs/results.

Inference: whether Supabase currently contains NaN/Infinity is not observable from this static audit.

6. 🟠 P1 — The calculator guard is only a negative heuristic, and the pipeline explicitly admits it

This is not the old bug you already know. The code now correctly rejects the famous:

2026 / 10 → 20,160%

case.

The guard says plainly:

Returns False for the pairs that are provably not a comparison.
It cannot return True with any confidence.

calc_guard.py ~lines 45–75.

The test suite even deliberately accepts:

assert plausible_operand_pair(
    4_000_000_000,
    5_000_000_000,
    "yoy_growth"
)

while explicitly calling those numbers unrelated. test_calc_guard.py ~lines 110–125.

That's logically honest about what the guard can do.

But the pipeline still takes the first two surviving numbers:

uniq = [
    n for n in dict.fromkeys(candidate_numbers)
    if not calc_guard.looks_like_a_year(n)
][:4]

_calc_ok = len(uniq) >= 2 and calc_guard.plausible_operand_pair(
    uniq[0], uniq[1], calc_type
)

search_pipeline.py ~lines 1380–1400.

If accepted, it computes using:

{
    "old": uniq[1],
    "new": uniq[0],
    "current": uniq[0],
    "prior_year": uniq[1],
    ...
}

~lines 1405–1420.

The block is now honestly labelled:

NOT period- or metric-verified.

That is good.

But it remains an arbitrary-number arithmetic assistant.

Verdict

Not a new regression, but it means:

calc_guard is not a financial correctness gate.

It is only a “this pair is obviously impossible” filter.

That is acceptable if the output is never treated as verified. It becomes dangerous when the LLM chooses to use the block.

7. 🔴 P0 — The Quick Answer numeric-grounding check is advisory, not a rejection gate

After generation:

_ungrounded = _numeric_grounding_check(
    parsed_answer, top_passages, ratio_context_block
)

If it finds unsupported figures:

confidence_out = "MEDIUM" if _anchored else "LOW"
...
caveats = caveats + [_cav]

It does not reject the answer.

search_pipeline.py ~lines 1890–1930.

The comment explicitly says:

not hard refuse — that over-refuses

So:

unsupported financial number
        ↓
LOW confidence + caveat
        ↓
still emitted

That is a deliberate product decision.

For ordinary factual chat, that can be reasonable.

For a system whose requirement is:

“Can a wrong number reach a user as verified?”

the answer is yes.

The only thing preventing the user from treating it as correct is the confidence label/caveat.

And because #1 shows FinalGate is not actually run, there is no authoritative final barrier.

8. 🔴 P1 — The benchmark has its seventh grader bug: evidence is not claim-level

I agree with your suspicion. I found one.

The benchmark says its evidence dimension measures:

claims carry citations, and to primary sources where required

eval/head_to_head/rubric.py ~lines 30–55.

And the research evidence architecture explicitly says:

“claim-to-evidence mapping” is critical.

app/core/research/evidence.py ~lines 1–20.

But the actual rubric only does:

has_marker = bool(re.search(r"\[\d+\]", text))
classes = {str(c.get("source_class", "")) for c in cites}
primary = _is_primary(cites)

...

elif cites and primary:
    card.scores["evidence"] = 1.0

eval/head_to-head/rubric.py ~lines 400–425.

It never verifies that each material claim has a citation.

Concrete counterexample

This answer would receive full evidence credit:

Apple revenue was $416.161B [1].
Apple's debt was $900B.
Apple has 17,000 employees.

with:

citations = [
    {"source_class": "sec_filing"}
]

The rubric sees:

primary = True
cites = True

and awards:

evidence = 1.0

even though the debt and employee claims have no citation.

That is exactly the failure the benchmark says it is designed to prevent.

Why this is likely the seventh

The six previous bugs were mostly false negatives: correct answers marked wrong.

This one is the opposite:

a bad answer can receive evidence credit it has not earned.

That is arguably more dangerous because it can make optimization move toward an actually defective answer.

P0/P1 benchmark-integrity defect.

9. 🟠 P1 — Benchmark correctness can be fooled by a correct number appearing anywhere

_matches() checks whether the expected number appears anywhere among the extracted numbers:

for got in numbers_in(text):
    ...
    if abs(got - expected) / abs(expected) <= tol:
        return True

rubric.py ~lines 240–255.

There is no requirement that the expected number is the number asserted as the answer.

So:

Apple revenue was $500B.
The filing actually reports $416.161B.

contains the correct figure and can score:

correctness = 1.0

even though the first sentence—the answer the user would consume—is wrong.

The benchmark's own test:

def test_a_wrong_figure_scores_zero_however_confident():

only tests a response containing one figure.

It does not test the multi-number counterexample.

This is another benchmark weakness adjacent to the seventh bug.

10. 🟠 P1 — Period/entity scoring checks token presence, not attachment

The rubric computes:

for token in case.get("expect_period_tokens", []):
    hits += int(token.lower() in low)

for token in case.get("expect_entity_tokens", []):
    hits += int(token.lower() in low)

rubric.py ~lines 400–415.

That means the answer can mention:

Apple FY2025...
Microsoft FY2026...

and satisfy the expected entity/period tokens without proving that the figure belongs to the expected company/period.

Again, this is not claim-level semantic evaluation.

11. 🟠 P1 — The benchmark provenance is human-readable, not structurally bound to cases

cases.json has:

"provenance": [
  "AAPL FY2025 revenue 416161000000 accn ...",
  ...
]

and the tests check:

assert str(int(v)) in prov

test_head_to_head_rubric.py ~lines 315–330.

That's useful, but weak.

The case itself does not contain:

{
  "expect_value": 416161000000,
  "accession": "...",
  "xbrl_concept": "...",
  "period_end": "..."
}

Instead, the test searches for the numeric value inside a free-form provenance string.

So the relationship is:

case.expect_value
       ↓
string search
       ↓
some provenance line contains same number

rather than:

case
 ↓
structured evidence record
 ↓
accession + concept + period
 ↓
expected value

The current benchmark is therefore traceable by convention, not strongly typed by construction.

I would call this P1 benchmark hygiene, not a production answer bug.

12. 🔴 Item 6 — FINAL_BEAT_TOP_CHATGPT_VERIFICATION.md materially overstates the implementation

This is the most important documentation finding.

The document says:

The half that matters is FinalGate.check().

and:

The gate reports violations and never rewrites

and presents the pipeline as:

QUESTION -> PLAN -> CONTRACT -> RETRIEVE -> NORMALIZE -> COMPUTE
-> VERIFY -> SCOPE -> GENERATE -> FINAL GATE -> ANSWER

docs/quick-answer/FINAL_BEAT_TOP_CHATGPT_VERIFICATION.md ~lines 1–20 and ~lines 130–145.

That is not the Quick Answer implementation I read.

The actual code does:

PLAN
 ↓
CONTRACT
 ↓
RETRIEVE
 ↓
COMPUTE
 ↓
GENERATE
 ↓
NUMERIC/TEMPORAL/LOGIC VERIFICATION
 ↓
PARSE
 ↓
NUMERIC GROUNDING
 ↓
TEMPORAL GROUNDING
 ↓
CITATION NORMALIZATION
 ↓
EMIT ANSWER

I found the contract construction:

_contract = build_contract(_fin)

but no corresponding:

FinalGate.check(...)

in the hot path.

Therefore the verification document is certifying an architectural stage that is not actually wired into the path it claims to certify.

That's exactly the kind of self-certification error you warned about.

13. 🟠 The verification document also calls the calculator result “deterministic” in a way that is easy to misread

The document describes the calculator as a deterministic safety fix, while the actual pipeline does:

candidate_numbers = []
...
uniq = [...]
_calc_ok = plausible_operand_pair(...)

then produces:

Arithmetic only.
The operands ... are NOT period- or metric-verified.

The code is honest here.

The problem is the surrounding documentation/test narrative still treats the pre-pass as part of the correctness machinery.

It is more accurate to call it:

deterministic arithmetic over heuristically selected operands

not:

deterministic financial calculation.

That distinction matters.

14. What I found sound

I am deliberately not padding this section.

✅ period_math.py is the strongest finance component

The typed Quantity architecture is exactly the right abstraction:

company
metric
period
unit
basis
citation

and operations return:

Computed | Refusal

rather than silently returning zero.

✅ Fiscal period handling is substantially correct

FiscalPeriod distinguishes:

FY
Q
fiscal-year-end month

and growth refuses annual/quarterly mixing.

✅ Rate deltas correctly use percentage points

delta() requires both operands to be rates and returns pp or bps.

✅ TTM has meaningful structural guards

It requires exactly four consecutive quarters and refuses stock metrics.

✅ The calculator regression itself is genuinely fixed

The 2026 / 10 → 20,160% shape is now refused.

✅ The calculator block no longer falsely calls its operands verified

This change is correct:

NOT period- or metric-verified.
✅ Scope semantics are well designed

The scope module correctly distinguishes:

confirmed_exhaustive
confirmed_partial
insufficient_evidence

and explicitly prevents a known-size-but-not-enumerated universe from being called exhaustive.

✅ The S&P 500 planner itself does not claim enumeration

The planner records:

("the S&P 500", 503, ...)

but the scope abstraction explicitly keeps:

enumerable = False

until membership is actually retrieved.

That is the correct separation.

✅ Retrieval failure semantics are conceptually good

The pipeline distinguishes:

channels_dark
channels_failed
degraded

instead of treating every empty result as a successful search.

Final severity ranking
Rank	Finding	Severity	User impact
1	FinalGate is implemented but not invoked	🔴 P0	Contract violations can ship
2	Cache returns answers before finance verification	🔴 P0	Bad answer can persist/replay
3	RatioEngine bypasses typed financial arithmetic/provenance	🔴 P0	Deterministic wrong/stale ratio can look authoritative
4	RatioEngine arbitrary “first row wins” fact selection	🔴 P0/P1	Wrong underlying filing fact can feed ratio
5	Numeric grounding only lowers confidence; doesn't block	🔴 P1	Unsupported number can still reach user
6	Benchmark evidence grader does not verify claim→citation mapping	🔴 P1	Bad answers can receive evidence credit
7	Benchmark correctness accepts expected number anywhere in answer	🟠 P1	Wrong headline can score correct
8	Period/entity grader checks token presence, not attachment	🟠 P1	Misattributed figure can score well
9	RatioEngine lacks finite-value invariant	🟠 P1	NaN/Inf path exists
10	Benchmark provenance is convention/string-based	🟠 P1	Ground truth is less independently auditable
11	Verification document claims a FinalGate stage that isn't wired	🔴 P1 documentation	Certification materially overstates implementation
The most important conclusion

The finance work is not fake. period_math.py, query planning, scope semantics, citation provenance and the calculator regression are legitimate improvements.

But there is a fundamental mismatch between the architecture described by the verification documents and the architecture actually executing.

The critical distinction is:

                CURRENT
MODEL
 ↓
VERIFIERS
 ↓
NORMALIZE
 ↓
EMIT

versus what the certification document claims:

MODEL
 ↓
VERIFIERS
 ↓
FINAL GATE
 ↓
EMIT

That missing connection is not cosmetic.

And the cache makes it worse:

CACHE HIT
   ↓
EMIT
   ↓
RETURN

So even a perfectly implemented FinalGate would not yet protect the entire Quick Answer surface.

What I could not check
Runtime occurrence rates: I did not run the service, so I cannot claim these defects are currently firing in production.
Actual contents of the financials table: the schema permits the problematic cases, but I did not query Supabase, so I cannot claim duplicate facts/NaN values currently exist.
Live SEC/XBRL responses: not queried.
The ~2,078 tests: I sampled the relevant finance/contract/benchmark tests; I did not execute or exhaustively inspect all 2,078.
Live benchmark runs: I did not run them, so the numerical results in FINAL_BEAT_TOP_CHATGPT_VERIFICATION.md are treated as author-reported, not independently verified by me.
Browser E2E: not run; I stayed inside the Quick Answer source audit.
Deep Research / agentic path: intentionally not audited, per your scope fence.

Bottom line: I would block a “world-class finance Quick Answer” certification until #1–#4 are fixed. The typed finance layer is good enough to build on; the problem is that the strongest guarantees are currently not the guarantees actually sitting on the final answer path.

Today 4:37 PM
check that could not check , go for “world-class finance Quick Answer” certification  

I checked the previously BLOCKED / unverified certification items against the current feat/web-research-sec-integration branch. I’m going to be strict: I cannot certify AlphaGravity as “world-class finance Quick Answer” yet.

Certification verdict: ❌ NOT CERTIFIED

The problem is not that the system lacks sophisticated components. It has several genuinely strong ones. The problem is that the certification evidence is not yet strong enough to prove the whole production path is safe and correct.

1. Blind head-to-head — still BLOCKED

I searched the branch for refs.json and found no result.

The verification document itself says the blind reference set does not exist and therefore the blind head-to-head cannot run.

That means:

ChatGPT superiority = UNVERIFIED.

The live benchmark is useful, but it cannot establish “beats ChatGPT” without an independent reference/evaluation protocol.

This is not a minor paperwork issue. For a world-class certification, the benchmark must be independently anchored.

2. Browser E2E — still BLOCKED

The verification document explicitly records:

“no spec covers the SEC links”

and marks Browser E2E BLOCKED.

So we have not established end-to-end that:

backend evidence → citation normalization → API payload → frontend → clickable SEC filing

actually works in the browser.

Given your project is explicitly about financial research, this matters.

3. More serious: FinalGate is still not actually connected

This is the biggest certification blocker I found.

answer_contract.py contains a real FinalGate.check() implementation. It checks minimum citations, primary sources, abstention, scope labeling, and percentage-point reporting.

But the Quick Answer pipeline merely constructs the contract:

_fin = plan_finance_query(...)
query_plan["finance_plan"] = _fin.as_dict()

from app.core.finance.answer_contract import build_contract
_contract = build_contract(_fin)
query_plan["answer_contract"] = _contract.as_dict()

There is no corresponding FinalGate.check(...) invocation in the inspected Quick Answer path.

That's a P0 certification failure.

The architecture says:

PLAN
  ↓
CONTRACT
  ↓
...
GENERATE
  ↓
FINAL GATE
  ↓
ANSWER

but the actual path currently behaves more like:

PLAN
  ↓
CONTRACT
  ↓
...
GENERATE
  ↓
ANSWER

The contract exists.

The gate exists.

The enforcement connection is the missing piece.

4. Even worse: cache can bypass the entire finance safety path

The cache is checked before the finance contract is constructed.

The code does:

cached = await self.cache.get(...)

if cached:
    ...
    yield SearchEvent(type="answer", data=cached, ...)
    ...
    return

So a cache hit can return an answer without reaching the subsequent finance planning/contract/retrieval/verification path.

This creates an architectural rule that should absolutely hold for certification:

No answer may escape through a path that bypasses the final correctness/provenance gate.

Currently that rule is not enforced.

Certification impact

P0.

Even if FinalGate were wired into the normal path tomorrow, the cache path would still need to be brought under the same invariant.

5. The benchmark itself still has a serious false-positive problem

The benchmark evidence scorer can give full evidence credit when a primary citation exists, rather than proving that the material claims are actually supported by that citation.

So an answer conceptually like:

Apple revenue was $416.161B [SEC].

Apple debt was $900B.
Apple has 17,000 employees.

can receive evidence credit because an SEC citation exists.

That's not claim-level provenance.

For a finance research system, that's a major distinction.

Your own evidence.py architecture recognizes claim-to-evidence mapping as the important abstraction, but the benchmark does not fully enforce it.

Certification impact

P1 benchmark-integrity failure.

The benchmark can therefore produce a score that is more favorable than the actual research quality.

6. Benchmark correctness has another loophole

The grader searches the answer's numbers and accepts a matching expected number.

That means an answer could contain:

Apple revenue was $500B.

The filing actually reports $416.161B.

and the expected $416.161B is present.

A naive number-presence grader can therefore mark correctness as passing even though the asserted answer is wrong.

That's a fundamentally different problem from the evidence-scoring issue.

So there are two independent benchmark weaknesses:
Problem	What it allows
Evidence scorer	Unsupported claims can receive evidence credit
Number matcher	Wrong asserted figure can receive correctness credit if expected figure appears elsewhere

That means the current benchmark is not yet a sufficiently adversarial certification harness.

7. ratio_engine remains outside the typed finance safety model

period_math.py has the right architecture: typed quantities carrying things like metric, period, company, unit and basis, with finite-value checks.

But ratio_engine.py directly retrieves:

select="caption,value_float"

and then converts the values into bare floats.

The result therefore loses important provenance metadata before calculation.

That's particularly problematic because the ratio output describes itself as something calculated deterministically from audited filings and tells downstream consumers to cite it directly.

So you have:

strong deterministic mathematics

but weaker:

calculation → source-fact provenance binding

Certification impact

P0/P1 depending on how ratio results are exposed.

For a genuinely world-class finance system, I would require every computed financial result to carry its source quantities, not merely the final number.

8. Ratio fact selection is still “first non-null wins”

The current implementation effectively does:

if concept in _CONCEPT_TO_METRIC and val is not None:
    ...
    base.setdefault(mkey, float(val))

with the explicit comment:

# first non-null wins

The database query doesn't establish a deterministic ordering for those candidates.

So if multiple qualifying records exist, the selected fact can depend on returned row ordering.

This is unacceptable as a certification-grade financial fact-selection rule.

You need something closer to:

company
→ metric/concept
→ exact period
→ filing/accession
→ filing date / canonical precedence
→ deterministic winner

not:

first row that happens to arrive
9. Non-finite ratio values bypass the stronger period_math protections

The ratio engine's division helper essentially does:

if d == 0 or d is None or n is None:
    return None

result = n / d

There is no explicit finite-value validation there.

So the stronger Quantity safety model isn't universal.

Again, this doesn't prove bad values currently exist in your database.

It proves the code path doesn't enforce the same invariant.

That's exactly the sort of thing a certification audit should catch.

10. The verification document is now useful—but it still cannot certify the system

One thing I actually like about the new verification document:

It explicitly records the unresolved areas instead of pretending everything is green.

It says the live benchmark had correctness ranging:

0.6154 → 0.8462 → 0.6923 → 0.6923 → 0.6154

and correctly refuses to interpret one run as “the” score.

That's good scientific hygiene.

But there's an important contradiction:

The document describes FinalGate as part of the verification architecture, while the implementation currently doesn't enforce it in the Quick Answer path.

The code documentation itself says:

“A contract nothing verifies is just a longer prompt.”

That statement is correct.

And unfortunately, that's exactly where the current implementation stands.

What I can certify right now
✅ Strong / credible
Deterministic finance query planning
Period-aware calculation architecture
Fiscal-year / quarterly separation
Percentage-point vs percent-change distinction
TTM structural constraints
Calculator plausibility guard
Scope-state model
SEC/XBRL routing architecture
Resolver backoff work
Stage-level latency instrumentation
Honest recording of benchmark instability
Explicit refusal behavior in several finance cases
Contract construction
FinalGate implementation
Significant automated test coverage as reported by the repository's own verification document

The repository's verification document reports 2,078 backend tests and 1,516 frontend tests passing, plus the specialized finance/Quick Answer gates. I have not independently rerun those commands, so I treat those as repository-reported results, not my own certification evidence.

❌ What prevents certification

I would put these into the certification blocker list:

P0 — must fix
Wire FinalGate.check() into the actual Quick Answer answer path.
Make cache-hit answers pass the same final invariant.
Bind computed ratios to their exact source facts/provenance.
Replace nondeterministic “first non-null wins” financial fact selection.
P1 — must fix before “world-class”
Make benchmark evidence claim-level, not citation-presence-level.
Make correctness verify the asserted answer, not merely number presence.
Make period/entity verification claim-attached rather than token-presence-based.
Add finite-value enforcement to every financial calculation path.
Create an independent blind reference set.
Complete browser E2E specifically for SEC citation/link behavior.
The certification status I would put on the project
ALPHAGRAVITY — FINANCE QUICK ANSWER

Architecture:                 STRONG
Finance math:                 STRONG
Period safety:                STRONG
Scope safety:                 STRONG
Retrieval architecture:       STRONG / LATENCY LIMITED
Evidence architecture:        INCOMPLETE
Final enforcement:            FAIL
Cache safety invariant:       FAIL
Benchmark integrity:          INCOMPLETE
Blind head-to-head:            BLOCKED
Browser E2E:                   BLOCKED

WORLD-CLASS CERTIFICATION:    ❌ NOT YET

Most important: I would not spend the next cycle trying to squeeze another 500 ms out of retrieval. The bigger issue is correctness enforcement.

You are now at the stage where the difference between a sophisticated finance RAG and a genuinely certifiable finance research system is:

Every answer, including cached and computed answers, must have an enforceable chain from claim → calculation → exact fact → source → citation → final gate.

Until that invariant is true, calling it “world-class certified” would be overstating the evidence.