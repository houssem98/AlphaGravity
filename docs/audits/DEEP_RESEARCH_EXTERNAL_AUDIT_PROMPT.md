# External audit prompt — Deep Research (paste into ChatGPT)

Repository: https://github.com/houssem98/AlphaGravity (public)
Branch to audit: `feat/web-research-sec-integration`

---

You are auditing the **Deep Research** feature of a financial research
platform. Be adversarial. I do not want a summary, a compliment, or a
restatement of what the code says it does. I want the places where it is wrong,
unverifiable, or claiming more than it proves.

## Ground rules

1. **Never accept a self-reported claim.** This repo contains documents that
   grade its own work (`REPORT_QA_SPEC.md`, `DR_PROGRESS.md`,
   `Deep_Research_Platform_Competitive_Benchmark_and_Upgrade_Plan.md`). Treat
   every score in them as a hypothesis to test against the code, not evidence.
   If a doc says "9/9 quality" and no test enforces it, say so.
2. **A test that cannot fail is not a test.** For every gate you find, ask what
   input would make it red. If you cannot construct one, report the gate as
   decorative.
3. **Cite file and line for every finding.** A claim without a location is not
   actionable and I will discard it.
4. If you cannot access a file, say so explicitly rather than inferring its
   contents from its name.

## What to read

| Path | Lines | What it is |
|---|---|---|
| `apps/market-ui/src/services/deepResearchService.ts` | 5,033 | The main engine |
| `services/market-server/src/services/deepResearchService.ts` | 802 | Server-side counterpart |
| `apps/market-ui/src/services/reportQaGates.ts` | ~550 | The quality gates |
| `apps/market-ui/src/services/deepResearchService.phase2.test.ts` | 5,711 | Largest test file |
| `apps/market-ui/eval/` | — | Eval harness (`drEval.test.ts`, `rubric.ts`, `fixtures/`) |
| `REPORT_QA_SPEC.md`, `QA_LOOP.sh` | — | The claimed QA contract |

## The seven questions I actually want answered

**1. Can it fabricate a number?**
Trace a numeric claim from retrieval to rendered report. Find every point where
a figure can reach the output without a citation that was checked against the
source. Look specifically for: absent values coerced to `0`, `null`/`undefined`
rendering as a number, percentages computed from mismatched periods, and any
`catch` block that substitutes a default instead of failing.

**2. Are the citations actually verified, or merely present?**
`reportQaGates.ts` exports `scanCitationIntegrity`, `checkEntityAttribution`,
`findT3OnlyClaims`, `checkRagCoverage`. For each: does it verify that the cited
source *supports the claim*, or only that a citation marker exists and the index
is in range? Name which ones are substance checks and which are shape checks.

**3. Can two different companies' numbers end up in one sentence?**
`detectDuplicateAttributions` and `findEntities` suggest this was a known
problem. Is it actually closed, and what happens on a near-miss (a parent and
its subsidiary, two issuers with similar names)?

**4. Is the temporal logic sound?**
`lintTemporal`, `recencyWeightQueries`, `extractDateFromUrl`. Can a report cite
a source published after the period it describes, or mix fiscal and calendar
years? Does `extractDateFromUrl` ever guess a date that is not in the document?

**5. Does the eval harness measure quality, or measure itself?**
Read `apps/market-ui/eval/drEval.test.ts` and `rubric.ts`. Determine: is the
grader a model judging its own output? Is there a holdout set? Are the fixtures
real retrieved documents or synthetic text written to pass? How many trials per
verdict? A single LLM-judge call at a fixed threshold is a biased coin — say so
if that is what this is.

**6. Is `deepResearchService.ts` at 5,033 lines a maintainability risk?**
Identify the specific responsibilities that are tangled together (budgeting,
checkpointing, templating, workflow presets, citation handling all appear to
live in one file). Propose a split, but only where you can name the concrete
bug class the current coupling enables — not for tidiness.

**7. What does it do when a provider fails?**
Find the difference in code between "the search returned nothing" and "the
search threw". If a provider failure can be rendered to the user as an absence
of evidence, that is a correctness bug, not a UX one. Show the line.

## Output format

For each finding:

```
SEVERITY: critical | high | medium | low
FILE:     path:line
CLAIM:    one sentence — what is wrong
EVIDENCE: the code, quoted
SCENARIO: concrete inputs -> wrong output the user would believe
FIX:      the smallest change that closes it
```

Rank by severity. Put anything that can put a **wrong number in front of a user
with a citation attached** at the top, above every style, performance and
architecture issue — a confidently wrong financial figure is the only failure
class that costs money.

End with:
- **What I could not verify**, and why.
- **The single highest-leverage fix**, if only one thing were changed.

Do not pad the report. If a section has no findings, write "no findings" and
move on.
