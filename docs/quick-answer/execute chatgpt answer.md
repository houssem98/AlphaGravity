READ THIS FIRST:

docs/quick-answer/chatgpt answer.md

This file contains the two previous ChatGPT outputs:
1. The ruthless audit of Finance Quick Answer.
2. The graph/loop roadmap for fixing the identified defects.

DO NOT treat either document as proof that something is fixed.
They are requirements/audit input only.

MISSION

Convert the contents of:

docs/quick-answer/chatgpt answer.md

into an executable LoopGraph roadmap for AlphaGravity Finance Quick Answer.

BRANCH SAFETY

Work ONLY on:

feat/web-research-sec-integration

Do NOT modify main.
Do NOT create a fake certification.
Do NOT claim tests passed unless you actually execute them.

PHASE 1 — RECONSTRUCT THE GRAPH

Read the entire chatgpt answer.md.

Create:

docs/quick-answer/WORLD_CLASS_FINANCE_QUICK_ANSWER_GRAPH.md

The graph must represent the actual execution path:

USER QUESTION
→ QUERY CLASSIFICATION
→ FINANCE PLAN
→ ANSWER CONTRACT
→ ENTITY/PERIOD RESOLUTION
→ RETRIEVAL
→ EVIDENCE SELECTION
→ TYPED CALCULATION
→ PROVENANCE
→ CLAIM/CITATION MAPPING
→ VERIFICATION
→ SCOPE
→ GENERATION
→ CITATION NORMALIZATION
→ FINAL GATE
→ API ANSWER
→ UI

For every node record:

- node ID
- source file
- function/class
- upstream dependencies
- downstream dependencies
- invariant
- current implementation status
- tests covering it
- known failure modes
- bypass paths
- whether it is blocking or advisory

Also create explicit defect nodes for every defect identified in chatgpt answer.md.

Do NOT invent additional defects.

PHASE 2 — CREATE THE LOOP FILE

Create:

docs/quick-answer/WORLD_CLASS_FINANCE_QUICK_ANSWER_LOOP.md

It must define executable loops.

At minimum:

LOOP 0 — Discovery / baseline
LOOP 1 — FinalGate enforcement
LOOP 2 — Cache safety
LOOP 3 — Calculation provenance
LOOP 4 — Deterministic fact selection
LOOP 5 — Non-finite numeric protection
LOOP 6 — Claim-level evidence binding
LOOP 7 — Asserted-number correctness
LOOP 8 — Period/entity attachment
LOOP 9 — Independent blind benchmark
LOOP 10 — Browser E2E
LOOP 11 — Documentation consistency
LOOP 12 — Latency
LOOP 13 — Adversarial verification

Each loop must have:

INPUT
→ INSPECT
→ TEST
→ FAILURE CLASSIFICATION
→ FIX
→ REGRESSION TEST
→ RE-RUN
→ GRAPH UPDATE
→ CERTIFICATION DECISION

PHASE 3 — EXECUTE, DON'T JUST DOCUMENT

After creating the graph and loop files, execute the loops in dependency order.

Start with:

LOOP 0

Establish the actual baseline by inspecting the current branch and running the relevant existing tests.

Then execute LOOP 1 before cosmetic/performance work.

CRITICAL DEFECTS TO VERIFY FIRST

1. Is FinalGate actually called by the Quick Answer production path?

2. Can cache-hit responses bypass finance contract, verification, citation normalization, and FinalGate?

3. Does ratio_engine preserve source/provenance and typed financial quantities?

4. Is financial fact selection deterministic when duplicate facts exist?

5. Can NaN/Inf enter ratio calculations?

6. Does evidence scoring verify claim-level citation attachment, or merely the existence of one primary citation?

7. Can benchmark correctness pass merely because the expected number appears somewhere in the answer?

8. Are period/entity checks attached to the asserted figure or merely token-presence checks?

9. Is benchmark provenance structurally bound to source/period/concept, or merely free-form text?

10. Does the documentation claim FinalGate/certification behavior that the production code does not actually implement?

For each item:

READ THE ACTUAL CODE.

Do not trust the previous audit blindly.

If the audit is wrong, mark it WRONG and explain why.

If it is correct, reproduce the exact evidence.

PHASE 4 — FIX DEPENDENCY ORDER

Do not fix downstream symptoms before upstream invariants.

Preferred order:

A. FinalGate wiring
B. Cache certification path
C. Evidence/provenance integrity
D. Deterministic fact selection
E. Numeric safety
F. Claim-level evidence binding
G. Benchmark correctness
H. Period/entity binding
I. Independent blind benchmark
J. Browser E2E
K. Documentation
L. Latency
M. Adversarial testing

After every major fix:

1. Run focused regression tests.
2. Run affected test suite.
3. Update the graph.
4. Record exact command.
5. Record exact result.
6. Continue only if the gate passes.

PHASE 5 — NO FALSE CERTIFICATION

You may NOT declare "world class", "production ready", "certified", or "fixed" if:

- FinalGate is not enforced on the real answer path.
- cache can bypass certification.
- provenance is detached from calculations.
- fact selection is nondeterministic.
- benchmark has false-positive scoring.
- blind benchmark remains blocked.
- browser E2E remains blocked where it is required.
- a P0/P1 defect remains unresolved.

If something cannot be verified because infrastructure/data/browser/service access is unavailable:

mark it:

UNVERIFIED — BLOCKED

Do not convert BLOCKED into PASS.

FINAL OUTPUT

At the end produce:

1. Exact branch + commit
2. Files changed
3. Graph created
4. Loop file created
5. Defects confirmed
6. Defects disproved
7. Defects fixed
8. Tests actually executed
9. Exact test results
10. Remaining P0/P1/P2 issues
11. Blind benchmark status
12. Browser E2E status
13. Latency status
14. Documentation consistency status
15. Final certification decision

The final answer must distinguish:

TESTED
READ/INSPECTED
UNVERIFIED/BLOCKED

Never claim a test was run if it wasn't.
Never infer runtime behavior from static code without labeling it as static inspection.