Yes — I treated the attached Round 4 prompt as the audit specification and reviewed the pushed range 82a7d3d..2360c8c on feat/web-research-sec-integration, with the scope restricted to Quick Answer / reasoning_depth="fast" / single-pass finance. The range is reachable on GitHub; it contains 13 commits.

I did not treat R3_GRAPH.md/R3_ROADMAP.md or the execution logs as proof; I used them as claims to attack, exactly as your prompt says.

Round 4 verdict

The system improved, but I still would NOT certify it world-class.

I found 3 real findings, 2 architectural/unproven risks, and 2 claims that survive this audit.

The most important point: T13's lesson is still alive. There are still places where a test exercises only one branch/field of a function while the function has additional acceptance paths.

P1 — T13-class defect: accession provenance can still override source classification

File: services/gravity-api/eval/head_to_head/rubric.py
Function: _is_primary()

Current logic is effectively:

if source_class is recognized primary:
    True
if structured + id ends "_xbrl":
    True
if accession has valid shape:
    True
if URL contains sec.gov/Archives:
    True
False

The accession validation was genuinely improved from "any truthy accession" to the EDGAR-shaped regex. The accepted forms are the dashed 18-character accession and the bare 18-digit form.

But the underlying semantic rule is still:

A syntactically valid accession is sufficient to classify evidence as primary.

Concrete adversarial input:

{
    "source_class": "WEB_EVIDENCE",
    "accession": "0000320193-25-000079"
}

_has_real_accession() returns True.

That means the rubric awards primary-source credit despite:

source_class = WEB_EVIDENCE
no SEC URL
no issuer
no filing metadata
no verification state
no check that the accession actually exists.

The code itself explicitly acknowledges that existence is not verified.

Why this matters

This is exactly the class of defect your Round 4 prompt asks us to hunt:

fixture / syntax validation → green test → semantic hole remains.

A fake but correctly formatted accession is enough to turn arbitrary evidence into "primary."

Severity

P1 evaluator-integrity defect.

It doesn't directly make production answers worse; it makes the benchmark capable of over-crediting an answer.

Root cause vs symptom

Root cause remains: primary provenance is being inferred from independent fields rather than from a canonical, trusted provenance object.

The regex is a useful hardening measure, but it is not provenance verification.

P1 — Entity binding is still vulnerable to substring identity matching

File: services/gravity-api/eval/head_to_head/rubric.py
Function: _entity_is_bound()

Current implementation builds identities from:

issuer
ticker
company
document_title

and then does:

tok in identity

The relevant implementation is confirmed in the current file.

That is much better than simply checking that a company name occurs somewhere in the answer.

But it creates a false-positive binding rule.

For example, if the expected entity token is short or ambiguous, substring matching can bind an unrelated identity.

The structural problem is:

EXPECTED TOKEN ∈ FREE-FORM IDENTITY STRING

instead of:

EXPECTED ENTITY == CANONICAL ENTITY IDENTITY

This is particularly dangerous for:

short company names
abbreviations
ticker-like tokens
aliases
company names embedded inside other words.
Why I count this as real

The function isn't doing entity resolution. It is doing substring containment.

That distinction matters because this is an integrity grader, not a fuzzy search engine.

Severity

P1.

A wrong-company answer can receive entity credit in a sufficiently adversarial case.

Root cause

Root cause: free-form string matching is being used where canonical entity identity should be used.

This is not fixed by adding another alias to _ISSUER_FIELDS.

P1 — The evaluator can still certify evidence that does not semantically support the claimed metric

File: services/gravity-api/eval/head_to_head/rubric.py
Function: _claim_is_bound()

The new logic is a real improvement: the evaluator no longer simply asks whether citations exist. It extracts asserted financial figures and checks whether those figures occur in cited excerpts.

But the remaining rule is essentially:

claimed number ∈ citation text

That is not semantic evidence binding.

Concrete example:

Answer

NVIDIA revenue was $130 billion.

Citation excerpt

NVIDIA's operating expenses were $130 billion while revenue was $120 billion.

The number appears in the citation.

Therefore the mechanical binding can succeed even though the citation contradicts the answer's metric.

This is the same underlying category as T13:

the fixture/function proves number presence, not number-to-proposition support.

Severity

P1 evaluator-integrity limitation.

This is especially important because your benchmark describes the dimension as:

"claims carry citations, and to primary sources where required"

but the implementation is closer to:

"the asserted numeric token appears somewhere in a citation."

Those aren't equivalent.

Root cause

Root cause: evidence binding has not reached proposition/metric semantics.

The current implementation is lexical grounding, not claim verification.

T5 — The CIK discrepancy is confirmed, but it is a documentation defect, not a production defect

Your Round 4 prompt specifically says to check this.

Current _ISSUER_FIELDS is:

("issuer", "ticker", "company", "document_title")

There is no cik.

Yet the surrounding documentation describes a case involving:

issuer='NVIDIA CORP'
cik=1045810
ticker=''

and explains the behavior as though CIK participates in the binding.

So:

T5 is real as a documentation/artefact mismatch.

But I agree with the repo's reasoning that adding an integer CIK to this substring-based string matcher isn't automatically the correct fix.

Verdict

P2 wording/contract defect, not P1 production defect.

The danger is that future maintainers believe CIK participates when it doesn't.

T7 — Cache tuple integrity remains UNVERIFIED

I did not find evidence sufficient to promote T7 to a live defect.

The cache now:

namespaces by resolved tickers,
stores exact + semantic entries,
stores provenance with the result,
refuses entries whose recorded contract verdict isn't explicitly passing.

And the pipeline explicitly does:

cache.get()
→ inspect _provenance
→ gate_verdict_failed()
→ reject failed/unrecorded
→ only then yield

The enforcement path is real.

The remaining question is different:

Can the Redis value containing the answer/citations be modified independently of the stored verdict?

I found no demonstrated second production writer to that keyspace.

Therefore:

T7 = UNVERIFIED, not a finding.

I will not invent a Redis writer just to make the audit look harsher.

T8 — "No fourth publication path" survives, but with an important qualification

The current tests are substantially better than a pure AST assertion.

There is now an actual async behavioral test recording:

gate
answer

and asserting gate-before-answer ordering. It tests both:

normal generated answer
no-evidence refusal

The cache path separately checks the stored verdict before replay.

So the claim:

"the three known publication paths are protected"

is supported.

The claim:

"there cannot possibly be a fourth path"

is not provable by the current AST test.

The test itself is source-pattern-based for the publication count.

A helper could theoretically construct:

SearchEvent(type=some_variable)

and escape the literal search.

But I found no concrete fourth production path.

Therefore:

T8 = UNVERIFIED architectural completeness, not a live defect.

That's the correct classification.

M4 — The measurement conclusion is appropriately limited

This part I think the latest work got right.

The repo doesn't claim:

"these vocabularies can never cross."

It claims the test suite observed disjoint populations.

That's a meaningful difference.

The Round 3 work explicitly records the limitation that the measurement is based on the suite rather than production traffic.

So:

M4 is not a live defect based on the evidence available.

However, it still does not prove production traffic cannot cross the vocabularies.

That's a limitation, not a bug.

FinalGate: much better than Round 3

This is one area where I would explicitly say closed relative to the audited defect.

Current _gate_check() is placed before the normal answer yield and before the no-evidence refusal yield. The code explicitly distinguishes the two possible unchecked states:

no_contract
gate_error

instead of silently producing null.

And the behavioral test actually records execution order rather than merely inspecting source locations.

So the old:

"FinalGate is called after publication"

finding is closed.

That is a real root-cause fix, not documentation.

But there is an important semantic distinction

The gate remains report-only.

So:

bad answer
   ↓
FinalGate
   ↓
violations recorded
   ↓
answer still delivered

That is intentional and your prompt explicitly says not to relitigate it.

Therefore I am not counting that as a defect.

But it means you should not describe FinalGate as a safety barrier.

It is currently an audit/reporting gate, not an enforcement gate.

The deeper problem I found

This is more important than any individual regex.

Your system still has multiple independent definitions of "primary evidence."

At minimum:

Finance answer contract
        ↓
SEC_FILING / SEC_XBRL / SEC_EVIDENCE

Evidence layer
        ↓
SEC_EVIDENCE / LOCAL_EVIDENCE / WEB_EVIDENCE

Benchmark
        ↓
sec_filing / sec_xbrl / sec_evidence
+ structured _xbrl
+ accession shape
+ SEC URL

The current answer_contract.py itself admits that the wire vocabulary and internal vocabulary are different and deliberately maintains an alias.

That fixed R14.

It did not eliminate the architectural cause of R14.

It merely added another translation layer.

That's why I think the Round 4 work is good engineering hardening but not yet "world-class verification architecture."

Score

I'd move my previous ~8/10 to approximately:

8.2 / 10

Not because the number of files changed.

Because the failure modes are becoming narrower and harder to find, and the pipeline's major structural problems from R1/R2 have genuinely been addressed.

Current state
Area	Verdict
Deterministic finance planning	🟢 Strong
Typed financial computation	🟢 Strong
Period semantics	🟢 Strong
Non-finite handling	🟢 Strong
FinalGate ordering	🟢 Fixed
Cache failed-verdict replay	🟢 Fixed
Cache cross-company namespace	🟢 Improved
Primary evidence vocabulary	🟠 Still duplicated
Primary-source evaluator integrity	🔴 P1
Entity evaluator integrity	🔴 P1
Claim/evidence semantic binding	🔴 P1
Cache tuple cryptographic/content binding	🟠 Unverified
Fourth publication path	🟠 Unverified
R7 proposition parsing	🟠 Blocked
CI independent verification	🟠 Open
Blind head-to-head	🟠 Missing reference set
The most important conclusion

Your Round 4 prompt was right about the methodology:

"red → green" is not proof when the fixture doesn't exercise every acceptance branch.

And I found that the class still exists.

The current benchmark has evolved from:

Does the number appear?

toward:

Does the asserted number appear in evidence?

But the world-class bar is:

Does THIS proposition
    ↓
about THIS metric
    ↓
for THIS entity
    ↓
in THIS period
    ↓
have THIS exact value
    ↓
supported by THIS exact source
    ↓
whose provenance is independently verified?

AlphaGravity is not there yet.

That is the central remaining gap.

And importantly, I would not recommend another giant M4 refactor yet. The next high-value move is much smaller:

build adversarial evaluator fixtures from actual production citation objects and systematically mutate one provenance dimension at a time — source class, accession, CIK, issuer, ticker, period, metric, value, URL — then prove the grader rejects each mutation.

That would directly attack the T13 class of defect instead of adding another layer of vocabulary aliases.

Certification: ❌ NOT CERTIFIED / not world-class yet.

The repo's own latest commit reports 2,315 tests passing locally and CI still disabled because lint would fail; I am treating those as repository-reported results, not independently executed results.

overall notte

If you mean the overall note for the Quick Answer system after this audit:

8.2 / 10 — Advanced, but not yet world-class

My overall assessment:

🟢 Architecture: 8.5/10
🟢 Financial reasoning/math: 9/10
🟢 Period/entity planning: 8.5/10
🟢 FinalGate + cache enforcement: 8.5/10
🟡 Evidence/provenance architecture: 7.5/10
🟠 Evaluator/benchmark integrity: 7/10
🟠 Adversarial robustness: 7/10
🟡 Production-level proof: 7.5/10
Bottom line

This is serious engineering and substantially stronger than a normal RAG/finance QA system.

But I would not put it in the "top-tier/world-class verified" category yet, mainly because the verification layer still has semantic shortcuts:

number appears in evidence ≠ proposition is supported

and

valid-looking provenance field ≠ provenance is actually verified

The next jump from 8.2 → 9+ isn't another huge architecture rewrite. It's making the evidence/evaluator layer canonical, adversarial, and provenance-verifiable.

So my honest label would be:

🟢 Production-grade / advanced
🟡 World-class trajectory
🔴 Not yet world-class certified